/**
 * dsh-zhihu-dashboard host half: serves /zhihu-dashboard (standalone page)
 * plus /zhihu-dashboard/hot|feed|learn|auth JSON endpoints, and registers
 * zhihu_search / zhihu_hot / zhihu_answer agent tools — all driving the
 * zhihu-cli binary (知乎开放平台) installed by the zhihu skill. The page works
 * from any browser that passes the same Host/Origin trust fence the sidebar
 * uses.
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerZhihuTools } from './tools.js'

export const name = 'zhihu-dashboard'

/** Services required: webServer for routes, webRuntime for the live trust list, loader for the connection row, tools for agent tools. */
export const inject = ['webServer', 'webRuntime', 'loader', 'tools']

const dir = fileURLToPath(new URL('.', import.meta.url))
const pagePath = join(dir, 'dashboard.html')

/** Quota ledger path: ~/.dsh/zhihu-quota.json (writeable by the host). */
function quotaPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'zhihu-quota.json')
}

/** Read today's quota counters. */
function readQuota() {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const raw = readFileSync(quotaPath(), 'utf8')
    const d = JSON.parse(raw)
    if (d?.date === today) return { hot: Number(d.hot) || 0, zhida: Number(d.zhida) || 0 }
    return { hot: 0, zhida: 0 }
  } catch {
    return { hot: 0, zhida: 0 }
  }
}

/** Count one successful hot / zhida call for today (best-effort). */
function countQuota(kind) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const q = readQuota()
    if (kind === 'hot') q.hot += 1
    else if (kind === 'zhida') q.zhida += 1
    writeFileSync(quotaPath(), JSON.stringify({ date: today, ...q }))
  } catch { /* quota ledger is best-effort */ }
}

/** Expand a leading `~/` in a configured path. */
function expandHome(path) {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/**
 * Resolve the zhihu-cli binary: configured cliPath > ZHIHU_CLI_HOME >
 * PATH > platform default install locations (the zhihu skill's setup.sh
 * layout: <cli-home>/current/zhihu-cli).
 * @param configured - optional cliPath from the plugin config.
 * @returns an absolute path to the zhihu-cli binary, or null when not found.
 */
function resolveCliPath(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return expandHome(configured.trim())
  }
  if (process.env.ZHIHU_CLI_HOME) {
    return join(process.env.ZHIHU_CLI_HOME, 'current', 'zhihu-cli')
  }
  if (process.env.PATH) {
    for (const segment of process.env.PATH.split(':')) {
      if (segment === '') continue
      const candidate = join(segment, 'zhihu-cli')
      if (candidate === '/usr/bin/zhihu-cli' || candidate === '/bin/zhihu-cli') continue
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch { /* not in this PATH segment */ }
    }
  }
  // Platform defaults mirroring the skill's setup.sh.
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'zhihu-cli', 'current', 'zhihu-cli')
  }
  const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.startsWith('/')
    ? process.env.XDG_DATA_HOME
    : join(homedir(), '.local', 'share')
  return join(dataHome, 'zhihu-cli', 'current', 'zhihu-cli')
}

/**
 * Derive a search query from a pasted Zhihu link (question/answer/article) or
 * use the raw keyword text as-is.
 * @param input - a Zhihu URL or free-form keywords.
 * @returns a non-empty query string.
 */
function queryFromLink(input) {
  const text = String(input ?? '').trim()
  if (text === '') return ''
  const url = /^https?:\/\//.test(text) ? new URL(text) : undefined
  if (url === undefined) return text
  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'zhihu.com' && host !== 'zhuanlan.zhihu.com') return text
  const pathname = url.pathname
  // zhihu.com/question/<id>[/answer/<id>] | zhihu.com/p/<id> | zhuanlan.zhihu.com/p/<id>
  const m = pathname.match(/^\/(?:question\/(\d+)|p\/(\d+))/)
  if (m === null) return text
  const id = m[1] ?? m[2]
  return `知乎 ${id}`.trim()
}

/**
 * Extract a Zhihu question id from a pasted link (question/answer/article) or
 * treat the input as an id / title directly.
 * @param input - a Zhihu URL, numeric question id, or free text.
 * @returns the question id when the input is a link or plain digits, else null.
 */
function questionIdOf(input) {
  const text = String(input ?? '').trim()
  if (/^\d+$/.test(text)) return text
  if (!/^https?:\/\//.test(text)) return null
  const url = new URL(text)
  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'zhihu.com') return null
  const m = url.pathname.match(/^\/question\/(\d+)/)
  return m === null ? null : m[1]
}

/** Clamp a page-supplied limit into the CLI's accepted range. */
function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), 1), max)
}

/**
 * Run the zhihu CLI once and parse its JSON; reject with a structured error.
 * The CLI reports business failures (AUTH_REQUIRED, quota, rate limit) with a
 * NON-ZERO exit code while still printing a structured JSON payload on
 * stdout — so a non-zero exit must not discard stdout: parse it and surface
 * the CLI's own error instead of the raw spawn message.
 * @param cliPath - absolute path to the zhihu-cli binary.
 * @param args - CLI arguments.
 * @param secret - optional Access Secret injected as ZHIHU_ACCESS_SECRET.
 */
function runCli(cliPath, args, secret) {
  return new Promise((resolve, reject) => {
    const env = secret ? { ...process.env, ZHIHU_ACCESS_SECRET: secret } : process.env
    execFile(cliPath, args, { maxBuffer: 16 * 1024 * 1024, env }, (error, stdout) => {
      // stdout may still hold a structured CLI error when the exit code is non-zero.
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        parsed = undefined
      }
      if (error) {
        if (parsed !== undefined) {
          resolve(parsed)
        } else {
          reject(new Error(`zhihu-cli 执行失败: ${error.message}`))
        }
        return
      }
      if (parsed !== undefined) {
        resolve(parsed)
      } else {
        reject(new Error('zhihu-cli 输出非 JSON'))
      }
    })
  })
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('请求内容过大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (body.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('请求 JSON 格式无效'))
      }
    })
    req.on('error', reject)
  })
}

async function runDshAnalysis(ctx, prompt) {
  const llm = ctx.get?.('llm')
  const defaults = ctx.get?.('agentDefaultModel')
  if (!llm || !defaults) {
    return { ok: false, error: '当前 DSH 组合未暴露模型服务，已保留复制 prompt 作为兜底。' }
  }
  const selection = defaults.currentSelection()
  if (!selection?.provider || !selection?.model) {
    return { ok: false, error: '当前 DSH 未配置默认 provider/model。' }
  }
  const textByIndex = new Map()
  let output = ''
  let failure = ''
  const stream = llm.stream({
    provider: selection.provider,
    model: selection.model,
    system: '你是本地产品和开发机会分析助手。只基于用户给出的知乎机会候选，输出中文、结构化、可执行的开发方向建议。',
    messages: [{
      id: `zhihu-opportunity-${Date.now()}`,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: prompt }],
    }],
    temperature: 0.2,
    maxTokens: 2200,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      textByIndex.set(chunk.index, `${textByIndex.get(chunk.index) || ''}${chunk.text}`)
      output += chunk.text
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && !textByIndex.has(chunk.index)) {
      output += chunk.block.text
    } else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
      failure = chunk.reason.failure?.message || '模型调用失败'
    }
  }
  if (failure) return { ok: false, error: failure, provider: selection.provider, model: selection.model }
  if (output.trim() === '') return { ok: false, error: '模型未返回文本', provider: selection.provider, model: selection.model }
  return { ok: true, provider: selection.provider, model: selection.model, content: output.trim() }
}

function chromiumProfileRoots() {
  const home = homedir()
  if (process.platform !== 'darwin') return []
  return [
    { browser: 'Chrome', root: join(home, 'Library', 'Application Support', 'Google', 'Chrome') },
    { browser: 'Edge', root: join(home, 'Library', 'Application Support', 'Microsoft Edge') },
    { browser: 'Brave', root: join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser') },
    { browser: 'Arc', root: join(home, 'Library', 'Application Support', 'Arc', 'User Data') },
  ]
}

function browserProfiles() {
  const profiles = []
  for (const { browser, root } of chromiumProfileRoots()) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      if (name !== 'Default' && !/^Profile \d+$/.test(name)) continue
      const profilePath = join(root, name)
      const cookieDb = existsSync(join(profilePath, 'Network', 'Cookies'))
        ? join(profilePath, 'Network', 'Cookies')
        : join(profilePath, 'Cookies')
      profiles.push({
        id: Buffer.from(cookieDb).toString('base64url'),
        browser,
        name,
        path: profilePath,
        type: 'chromium',
        cookieDb,
        hasCookieDb: existsSync(cookieDb),
      })
    }
  }
  if (process.platform === 'darwin') {
    const firefoxRoot = join(homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles')
    if (existsSync(firefoxRoot)) {
      for (const name of readdirSync(firefoxRoot)) {
        const profilePath = join(firefoxRoot, name)
        const cookieDb = join(profilePath, 'cookies.sqlite')
        profiles.push({
          id: Buffer.from(cookieDb).toString('base64url'),
          browser: 'Firefox',
          name: basename(name),
          path: profilePath,
          type: 'firefox',
          cookieDb,
          hasCookieDb: existsSync(cookieDb),
        })
      }
    }
  }
  return profiles.filter((p) => p.hasCookieDb)
}

function runSqliteJson(dbPath, query) {
  return new Promise((resolve, reject) => {
    execFile('sqlite3', ['-json', dbPath, query], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error('无法读取浏览器 Cookie 数据库：需要 sqlite3，或数据库被系统限制访问'))
        return
      }
      try {
        resolve(JSON.parse(stdout || '[]'))
      } catch {
        reject(new Error('浏览器 Cookie 数据库返回内容无法解析'))
      }
    })
  })
}

async function extractZhihuCookies(profile) {
  if (!profile?.cookieDb || !existsSync(profile.cookieDb)) throw new Error('Cookie 数据库不存在')
  const dir = mkdtempSync(join(tmpdir(), 'zhihu-cookies-'))
  const copy = join(dir, 'cookies.sqlite')
  try {
    copyFileSync(profile.cookieDb, copy)
    const rows = profile.type === 'firefox'
      ? await runSqliteJson(copy, "select host, name, value from moz_cookies where host like '%zhihu.com%'")
      : await runSqliteJson(copy, "select host_key as host, name, value, length(encrypted_value) as encryptedLen from cookies where host_key like '%zhihu.com%'")
    const usable = rows.filter((row) => row.name && row.value)
    const encrypted = rows.filter((row) => row.name && !row.value && Number(row.encryptedLen || 0) > 0)
    if (usable.length === 0 && encrypted.length > 0) {
      throw new Error('检测到 zhihu.com Cookie，但该浏览器 Cookie 已加密，当前版本无法自动解密；请使用手动 Cookie 导入。')
    }
    if (usable.length === 0) throw new Error('未在该 profile 中找到可用的 zhihu.com Cookie')
    const cookie = usable.map((row) => `${row.name}=${row.value}`).join('; ')
    return { cookie, names: usable.map((row) => row.name), encryptedCount: encrypted.length }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp cleanup is best-effort */ }
  }
}

function profileById(id) {
  return browserProfiles().find((profile) => profile.id === id)
}

async function verifyZhihuCookie(cookie) {
  if (!cookie || !/\S+=/.test(cookie)) return { ok: false, error: 'Cookie 为空' }
  const hasAuthCookie = /(?:^|;\s*)z_c0=/.test(cookie)
  try {
    const res = await fetch('https://www.zhihu.com/', {
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
    })
    return { ok: true, loggedIn: hasAuthCookie && res.status < 500, status: res.status, hasAuthCookie }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function stripHtml(text) {
  return String(text || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

async function fetchBrowserSessionItems(cookie, limit = 20) {
  const res = await fetch('https://www.zhihu.com/', {
    headers: {
      cookie,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  })
  const html = await res.text()
  const items = []
  const seen = new Set()
  const re = /<a\b[^>]*href=["']([^"']*(?:question\/\d+|zhuanlan\.zhihu\.com\/p\/\d+|\/p\/\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = re.exec(html)) && items.length < limit) {
    const title = stripHtml(match[2])
    if (title.length < 6 || title.length > 120) continue
    const url = match[1].startsWith('http') ? match[1] : `https://www.zhihu.com${match[1]}`
    const key = `${title}|${url}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ source: '浏览器会话', title, url, summary: '', author: '', time: '', likes: '' })
  }
  return { ok: true, status: res.status, items }
}

// ---- browser-trust fence (same semantics as better-sidebar / the /api gateway) ----

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

function isTrustedApiRequest(req, trustedHosts) {
  const host = req.headers.host
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * The deployment's trusted authorities: union of the connection row's literal
 * trustedHosts (the /api gateway source) and the web runtime's live list
 * (better-sidebar's fence source). Both fences admit the same loopback-or-
 * trusted Host, so admitting either list keeps this plugin usable from every
 * browser the other plugins accept.
 */
function trustedHostsOf(ctx) {
  const hosts = new Set()
  for (const entry of ctx.loader.entries()) {
    if (entry.options.id === 'connection') {
      const config = entry.options.config
      if (Array.isArray(config?.trustedHosts)) for (const h of config.trustedHosts) hosts.add(h)
    }
  }
  for (const h of ctx.webRuntime?.trustedHosts ?? []) hosts.add(h)
  return [...hosts]
}

// ---- HTTP helpers ----

function writeJson(res, payload, status = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function writePage(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Map a CLI response into the dashboard wire shape: pass through the CLI's
 * JSON verbatim, plus an ok flag. The CLI nests business errors as
 * `{ ok:false, error:{ code, message, action_url } }` (AUTH_REQUIRED,
 * quota/rate-limit codes); flatten that into { ok:false, error, actionUrl }
 * for the page banner.
 */
function wire(cliJson) {
  const payload = { ok: true, ...(cliJson ?? {}) }
  if (cliJson && typeof cliJson === 'object') {
    const err = cliJson.error
    const code = String(cliJson.Code ?? cliJson.code ?? (err?.code ?? ''))
    if (code.toUpperCase() === 'AUTH_REQUIRED' || code === '401') {
      payload.ok = false
      payload.error = err?.message ?? cliJson.Message ?? cliJson.message ?? '需要知乎开放平台 Access Secret'
      payload.actionUrl = err?.action_url ?? cliJson.action_url ?? 'https://developer.zhihu.com/profile'
    } else if (code !== '' && code !== '0' && code !== '200' && cliJson.ok !== true) {
      payload.ok = false
      payload.error = err?.message ?? cliJson.Message ?? cliJson.message ?? `知乎接口返回 ${code}`
    }
  }
  return payload
}

export function apply(ctx, config) {
  const resolved = {
    cliPath: resolveCliPath(config?.cliPath),
    hotLimit: Number(config?.hotLimit) || 10,
    feedLimit: Number(config?.feedLimit) || 10,
    refreshSeconds: Number(config?.refreshSeconds) || 0,
  }
  ctx.inject(['webServer', 'webRuntime', 'loader', 'tools'], (hostCtx) => {
    registerZhihuTools(hostCtx, resolved)
    const trustedHosts = trustedHostsOf(hostCtx)
    const fence = (req) => isTrustedApiRequest(req, trustedHosts)
    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'prefix',
      path: '/zhihu-dashboard',
      handler: async (req, res) => {
        if (!fence(req)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const pathname = url.pathname
        try {
          if (pathname === '/zhihu-dashboard' || pathname === '/zhihu-dashboard/') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405)
              res.end()
              return
            }
            writePage(res, await readFile(pagePath, 'utf8'))
            return
          }
          if (!pathname.startsWith('/zhihu-dashboard/')) {
            res.writeHead(404)
            res.end('not found')
            return
          }
          const api = pathname.slice('/zhihu-dashboard/'.length).replace(/^api\//, '')
          // Page-supplied Access Secret: header beats query (query never appears in logs).
          const secret = req.headers['x-zhihu-secret'] || undefined
          if (api === 'dsh-analyze' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const prompt = String(body?.prompt ?? '').trim()
            if (prompt === '') {
              writeJson(res, { ok: false, error: '缺少分析 prompt' })
              return
            }
            writeJson(res, await runDshAnalysis(hostCtx, prompt.slice(0, 80_000)))
            return
          }
          if (api === 'browser-profiles' && (req.method === 'GET' || req.method === 'HEAD')) {
            writeJson(res, { ok: true, platform: process.platform, profiles: browserProfiles().map((profile) => ({
              id: profile.id,
              browser: profile.browser,
              name: profile.name,
              type: profile.type,
              path: profile.path,
              hasCookieDb: profile.hasCookieDb,
            })) })
            return
          }
          if (api === 'browser-session-verify' && req.method === 'POST') {
            const body = await readJsonBody(req)
            let cookie = String(body?.cookie ?? '').trim()
            let cookieNames = []
            if (cookie === '') {
              const profile = profileById(String(body?.profileId ?? ''))
              if (!profile) {
                writeJson(res, { ok: false, error: '未选择有效的浏览器 profile' })
                return
              }
              const extracted = await extractZhihuCookies(profile)
              cookie = extracted.cookie
              cookieNames = extracted.names
            }
            const verified = await verifyZhihuCookie(cookie)
            writeJson(res, { ...verified, cookieNames, cookieCount: cookieNames.length })
            return
          }
          if (api === 'browser-session-items' && req.method === 'POST') {
            const body = await readJsonBody(req)
            let cookie = String(body?.cookie ?? '').trim()
            if (cookie === '') {
              const profile = profileById(String(body?.profileId ?? ''))
              if (!profile) {
                writeJson(res, { ok: false, error: '未选择有效的浏览器 profile' })
                return
              }
              cookie = (await extractZhihuCookies(profile)).cookie
            }
            const limit = clampLimit(body?.limit, 20, 50)
            writeJson(res, await fetchBrowserSessionItems(cookie, limit))
            return
          }
          if (api === 'hot' && (req.method === 'GET' || req.method === 'HEAD')) {
            const limit = clampLimit(url.searchParams.get('limit'), resolved.hotLimit, 30)
            const data = await runCli(resolved.cliPath, ['hot', '--limit', String(limit)], secret)
            if (wire(data).ok === true) countQuota('hot')
            writeJson(res, wire({ ...data, _limit: limit }))
            return
          }
          if (api === 'quota' && (req.method === 'GET' || req.method === 'HEAD')) {
            const q = readQuota()
            writeJson(res, { ok: true, hot: q.hot, zhida: q.zhida, hotLimit: 100, zhidaLimit: 100 })
            return
          }
          if (api === 'cli-check' && (req.method === 'GET' || req.method === 'HEAD')) {
            // CLI 存在性检查：缺失时面板显示安装引导，而不是报"执行失败"。
            let exists = false
            try { exists = statSync(resolved.cliPath).isFile() } catch { exists = false }
            writeJson(res, { ok: true, installed: exists, cliPath: resolved.cliPath })
            return
          }
          if (api === 'feed' && (req.method === 'GET' || req.method === 'HEAD')) {
            const source = url.searchParams.get('source') === 'contents' ? 'contents' : 'favorites'
            const limit = clampLimit(url.searchParams.get('limit'), resolved.feedLimit, 50)
            const args = source === 'contents'
              ? ['me', 'contents', '--type', 'all', '--limit', String(limit)]
              : ['me', 'favorites', 'recent', '--limit', String(limit)]
            // 创作分析：按点赞数排序（sort=like_count）。
            if (source === 'contents' && url.searchParams.get('sort') === 'like_count') {
              args.push('--sort', 'like_count', '--order', 'desc')
            }
            const data = await runCli(resolved.cliPath, args, secret)
            writeJson(res, wire({ ...data, _source: source, _limit: limit }))
            return
          }
          if (api === 'followees' && (req.method === 'GET' || req.method === 'HEAD')) {
            // 我关注的人：名字/主页/头像/简介/粉丝数。
            const limit = clampLimit(url.searchParams.get('limit'), 20, 50)
            const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
            const args = ['me', 'followees', '--limit', String(limit)]
            if (offset > 0) args.push('--offset', String(offset))
            const data = await runCli(resolved.cliPath, args, secret)
            writeJson(res, wire({ ...data, _limit: limit }))
            return
          }
          if (api === 'favlists' && (req.method === 'GET' || req.method === 'HEAD')) {
            // 我的收藏夹列表：名称/描述/链接/URL Token/公开状态。
            const limit = clampLimit(url.searchParams.get('limit'), 50, 50)
            const data = await runCli(resolved.cliPath, ['me', 'favorites', 'lists', '--limit', String(limit)], secret)
            writeJson(res, wire({ ...data, _limit: limit }))
            return
          }
          if (api === 'favitems' && (req.method === 'GET' || req.method === 'HEAD')) {
            // 指定收藏夹的内容：标题/摘要/原文链接/收藏时间/互动数。
            const token = url.searchParams.get('token') ?? ''
            if (!/^\d+$/.test(token)) {
              writeJson(res, { ok: false, error: '缺少有效的收藏夹 URL Token' })
              return
            }
            const limit = clampLimit(url.searchParams.get('limit'), 20, 50)
            const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
            const args = ['me', 'favorites', 'items', '--url-token', token, '--limit', String(limit)]
            if (offset > 0) args.push('--offset', String(offset))
            const data = await runCli(resolved.cliPath, args, secret)
            writeJson(res, wire({ ...data, _token: token, _limit: limit }))
            return
          }
          if (api === 'global' && (req.method === 'GET' || req.method === 'HEAD')) {
            // 全网搜索：支持时间窗（sinceHours → publish_time 过滤）+ 实时索引。
            const q = url.searchParams.get('q') ?? ''
            if (q === '') {
              writeJson(res, { ok: false, error: '请输入搜索关键词' })
              return
            }
            const count = clampLimit(url.searchParams.get('count'), 10, 20)
            const sinceHours = Number(url.searchParams.get('sinceHours')) || 0
            const searchDb = url.searchParams.get('searchDb') === 'realtime' ? 'realtime' : 'all'
            const args = ['search', 'global', '--query', q, '--count', String(count)]
            if (sinceHours > 0) {
              const sinceTs = Math.floor(Date.now() / 1000) - sinceHours * 3600
              args.push('--filter', `publish_time>=${sinceTs}`)
            }
            args.push('--search-db', searchDb)
            const data = await runCli(resolved.cliPath, args, secret)
            writeJson(res, wire({ ...data, _query: q, _sinceHours: sinceHours, _searchDb: searchDb }))
            return
          }
          if (api === 'auth' && (req.method === 'GET' || req.method === 'HEAD')) {
            // 带 x-zhihu-secret 头时通过环境变量注入，反映浏览器里的 secret；
            // ?verify=1 → 实际调用一次接口验证有效性（消耗少量额度）。
            const args = ['auth', 'status']
            if (url.searchParams.get('verify') === '1') args.push('--verify')
            const data = await runCli(resolved.cliPath, args, secret)
            writeJson(res, wire(data))
            return
          }
          if (api === 'learn' && (req.method === 'GET' || req.method === 'HEAD')) {
            // Search first (5000/day, not rate-limited like hot), then let the
            // user optionally ask zhida (100/day) to distill app ideas.
            const input = url.searchParams.get('q') ?? ''
            const query = queryFromLink(input)
            if (query === '') {
              writeJson(res, { ok: false, error: '请输入知乎链接或关键词' })
              return
            }
            const count = clampLimit(url.searchParams.get('count'), 5, 20)
            const data = await runCli(resolved.cliPath, ['search', 'zhihu', '--query', query, '--count', String(count)], secret)
            const payload = wire({ ...data, _query: query })
            if (payload.ok === true) {
              payload.query = query
              payload.searched = true
            }
            writeJson(res, payload)
            return
          }
          if (api === 'analyze' && (req.method === 'GET' || req.method === 'HEAD')) {
            // Distill app ideas from a pasted link / keywords via zhida (100/day).
            const input = url.searchParams.get('q') ?? ''
            const query = queryFromLink(input)
            if (query === '') {
              writeJson(res, { ok: false, error: '请输入知乎链接或关键词' })
              return
            }
            const model = url.searchParams.get('model') === 'thinking' ? 'zhida-thinking-1p5' : 'zhida-fast-1p5'
            const prompt = `请分析知乎内容「${query}」，提炼其中可以做的应用创意：\n1. 核心创意（产品形态、目标用户）\n2. 关键功能点\n3. 可行性/难点\n4. 类似竞品\n用中文简明回答。`
            const data = await runCli(resolved.cliPath, ['answer', '--query', prompt, '--model', model], secret)
            if (wire(data).ok === true) countQuota('zhida')
            writeJson(res, wire({ ...data, _query: query, _model: model }))
            return
          }
          if (api === 'question-title' && (req.method === 'GET' || req.method === 'HEAD')) {
            // Resolve a question's title so the tracker can search its answers.
            // Chain: zhida first (100/day), fall back to searching "知乎 <id>"
            // (5000/day) — zhida sometimes cannot retrieve a fresh question id,
            // while zhihu_search indexes the Question row itself (ContentID == id).
            const input = url.searchParams.get('q') ?? ''
            const qid = questionIdOf(input)
            if (qid === null) {
              writeJson(res, { ok: false, error: '请输入知乎问题链接或问题 ID' })
              return
            }
            let title = ''
            let source = ''
            const zhidaPrompt = `知乎问题 ${qid} 的完整标题是什么？请直接回答标题文字本身，不要任何多余说明、引号或解释。如果无法确定，只回答「不知道」。`
            const zhidaData = await runCli(resolved.cliPath, ['answer', '--query', zhidaPrompt, '--model', 'zhida-fast-1p5'], secret)
            countQuota('zhida') // zhida call attempted (regardless of outcome)
            const zhidaPayload = wire({ ...zhidaData, _questionId: qid })
            if (zhidaPayload.ok === true) {
              const content = String(zhidaPayload.choices?.[0]?.message?.content ?? '').trim()
              const candidate = content.replace(/^["'“”\s]+|["'“”\s]+$/g, '')
              if (candidate !== '' && !/^(不知道|无法|未能|不清楚|无标题)$/.test(candidate) && candidate.length < 120) {
                title = candidate
                source = 'zhida'
              }
            }
            if (title === '') {
              // Fallback: the search index carries the Question row with ContentID == qid.
              const searchData = await runCli(resolved.cliPath, ['search', 'zhihu', '--query', `知乎 ${qid}`, '--count', '10'], secret)
              const searchPayload = wire({ ...searchData, _questionId: qid })
              if (searchPayload.ok === true && Array.isArray(searchPayload.Data?.Items)) {
                const hit = searchPayload.Data.Items.find(
                  (it) => it.ContentType === 'Question' && String(it.ContentID) === qid,
                )
                if (hit?.Title) {
                  title = String(hit.Title)
                  source = 'search'
                }
              }
            }
            if (title === '') {
              writeJson(res, { ok: false, error: '未能解析出问题标题：直答检索不到该问题，知乎搜索也未索引到该问题行。请在面板中手动输入标题。' })
              return
            }
            writeJson(res, { ok: true, questionId: qid, title, source, _questionId: qid })
            return
          }
          if (api === 'answers' && (req.method === 'GET' || req.method === 'HEAD')) {
            // Track a question's answers: search its title and return the hits
            // (each carries ContentID/EditTime) for the page to diff.
            const input = url.searchParams.get('q') ?? ''
            const qid = questionIdOf(input)
            if (qid === null) {
              writeJson(res, { ok: false, error: '请输入知乎问题链接或问题 ID' })
              return
            }
            const title = url.searchParams.get('title') ?? ''
            if (title === '') {
              writeJson(res, { ok: false, error: '缺少问题标题（先用 question-title 获取）' })
              return
            }
            const count = clampLimit(url.searchParams.get('count'), 10, 20)
            const data = await runCli(resolved.cliPath, ['search', 'zhihu', '--query', title, '--count', String(count)], secret)
            const payload = wire({ ...data, _questionId: qid, _query: title })
            if (payload.ok === true) {
              payload.questionId = qid
              payload.title = title
              payload.answers = payload.Data?.Items ?? []
            }
            writeJson(res, payload)
            return
          }
          res.writeHead(404)
          res.end('not found')
        } catch (error) {
          writeJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'zhihu-dashboard: routes')
  })
}
