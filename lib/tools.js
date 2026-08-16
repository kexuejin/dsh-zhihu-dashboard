/**
 * DSH agent tools for the zhihu dashboard: zhihu_search / zhihu_hot /
 * zhihu_answer — registered on ctx.tools so the conversation model can call
 * the zhihu-cli directly. The Access Secret rides ZHIHU_ACCESS_SECRET (the
 * CLI's preferred source); when unset the tool reports the missing-credential
 * state so the agent can guide the user.
 */
import { execFile } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'

const SECRET_ENV = 'ZHIHU_ACCESS_SECRET'

function secretOf() {
  return process.env[SECRET_ENV] ?? ''
}

/**
 * Register the three zhihu tools.
 * @param ctx - host context with the tools registry available.
 * @param resolved - resolved plugin config ({ cliPath, hotLimit }).
 */
export function registerZhihuTools(ctx, resolved) {
  const run = (args, secret) => new Promise((resolve, reject) => {
    const env = secret ? { ...process.env, ZHIHU_ACCESS_SECRET: secret } : process.env
    execFile(resolved.cliPath, args, { maxBuffer: 16 * 1024 * 1024, env }, (error, stdout) => {
      let parsed
      try { parsed = JSON.parse(stdout) } catch { parsed = undefined }
      if (error && parsed === undefined) {
        reject(new Error(`zhihu-cli 执行失败: ${error.message}`))
        return
      }
      resolve(parsed ?? { ok: false, error: 'zhihu-cli 输出非 JSON' })
    })
  })

  const tool = (definition) => ctx.tools.register(defineTool(definition))

  tool({
    name: 'zhihu_search',
    description: 'Search Zhihu (知乎) content: questions, answers, and articles matching the query. Returns title, author, summary, link, and like count for each hit. Use this to find community opinions, experiences, and original sources.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search keywords or a zhihu.com question/article link.' },
      count: { type: 'number', description: 'Number of results (1-10, default 5).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const count = Number.isFinite(args.count) ? Math.min(Math.max(Math.trunc(args.count), 1), 10) : 5
      const data = await run(['search', 'zhihu', '--query', String(args.query), '--count', String(count)], secret)
      return { ok: true, query: String(args.query), hits: data?.Data?.Items ?? [], raw: data }
    },
  })

  tool({
    name: 'zhihu_hot',
    description: 'Get the current Zhihu hot list (知乎热榜): trending questions and articles with links and summaries. Quota: 100 calls/day per account.',
    parameters: {
      limit: { type: 'number', description: 'Number of hot entries (1-30, default 10).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 30) : 10
      const data = await run(['hot', '--limit', String(limit)], secret)
      return { ok: true, limit, items: data?.Data?.Items ?? [], raw: data }
    },
  })

  tool({
    name: 'zhihu_answer',
    description: 'Ask 知乎直答 (Zhihu direct answer): a retrieval-augmented model synthesizes an answer from Zhihu content. Use for quick conclusions or distilling app ideas from a topic/link. Quota: 100 calls/day.',
    parameters: {
      query: { type: 'string', required: true, description: 'The question, topic, or zhihu link to analyze — e.g. "从 AI 学习工具话题提炼应用创意".' },
      model: { type: 'string', enum: ['zhida-fast-1p5', 'zhida-thinking-1p5'], description: 'Model tier: fast (default) or thinking (deep reasoning).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value.answer ?? JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const model = args.model === 'zhida-thinking-1p5' ? 'zhida-thinking-1p5' : 'zhida-fast-1p5'
      const data = await run(['answer', '--query', String(args.query), '--model', model], secret)
      const answer = data?.choices?.[0]?.message?.content ?? ''
      return { ok: true, query: String(args.query), model, answer }
    },
  })

  tool({
    name: 'zhihu_global_search',
    description: 'Search the whole web (not just Zhihu) via the Zhihu open platform: news, official sites, and external sources. Supports a recency window (sinceHours) and the realtime index. Use when facts or news from outside Zhihu matter, e.g. monitoring what was published in the last 24h about a topic.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search keywords.' },
      count: { type: 'number', description: 'Number of results (1-20, default 10).' },
      sinceHours: { type: 'number', description: 'Only results published within the last N hours (0 = any time, default 0).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const count = Number.isFinite(args.count) ? Math.min(Math.max(Math.trunc(args.count), 1), 20) : 10
      const sinceHours = Number.isFinite(args.sinceHours) && args.sinceHours > 0 ? Math.trunc(args.sinceHours) : 0
      const cliArgs = ['search', 'global', '--query', String(args.query), '--count', String(count)]
      if (sinceHours > 0) {
        const sinceTs = Math.floor(Date.now() / 1000) - sinceHours * 3600
        cliArgs.push('--filter', `publish_time>=${sinceTs}`)
      }
      cliArgs.push('--search-db', 'realtime')
      const data = await run(cliArgs, secret)
      return { ok: true, query: String(args.query), sinceHours, hits: data?.Data?.Items ?? [], raw: data }
    },
  })

  tool({
    name: 'zhihu_followees',
    description: 'List the users the current Access Secret account follows on Zhihu: name, profile URL, avatar, headline, and follower count. Use to review who you follow and to spot whose new content might matter.',
    parameters: {
      limit: { type: 'number', description: 'Number of followees (1-50, default 20).' },
      offset: { type: 'number', description: 'Pagination offset (default 0).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 50) : 20
      const offset = Math.max(Number(args.offset) || 0, 0)
      const cliArgs = ['me', 'followees', '--limit', String(limit)]
      if (offset > 0) cliArgs.push('--offset', String(offset))
      const data = await run(cliArgs, secret)
      return { ok: true, limit, offset, followees: data?.Data?.Items ?? [], raw: data }
    },
  })

  tool({
    name: 'zhihu_my_contents',
    description: 'Read the current Access Secret account\'s own Zhihu creations (answers/articles/videos/pins/questions): titles, summaries, and like counts. Use to review your own output or find your best-performing content (sort by like_count).',
    parameters: {
      type: { type: 'string', enum: ['all', 'answer', 'article', 'zvideo', 'pin', 'question'], description: 'Content type filter (default all).' },
      sort: { type: 'string', enum: ['ts', 'like_count'], description: 'Sort by creation time (ts) or likes (like_count, default).' },
      limit: { type: 'number', description: 'Number of items (1-50, default 20).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const type = ['all', 'answer', 'article', 'zvideo', 'pin', 'question'].includes(args.type) ? args.type : 'all'
      const sort = args.sort === 'ts' ? 'ts' : 'like_count'
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 50) : 20
      const cliArgs = ['me', 'contents', '--type', type, '--sort', sort, '--order', 'desc', '--limit', String(limit)]
      const data = await run(cliArgs, secret)
      return { ok: true, type, sort, limit, contents: data?.Data?.Items ?? [], raw: data }
    },
  })

  tool({
    name: 'zhihu_favorites',
    description: 'Read the current Access Secret account\'s Zhihu favorites: list favorite collections (favlists), or read the items inside one collection by its UrlToken. Use to review saved material or understand what you are collecting.',
    parameters: {
      action: { type: 'string', enum: ['lists', 'items'], description: 'lists = list collections; items = read one collection\'s content.' },
      urlToken: { type: 'number', description: 'Required for action=items: the collection UrlToken from action=lists.' },
      limit: { type: 'number', description: 'Number of items (1-50, default 20).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const secret = secretOf()
      if (!secret) return { ok: false, error: '缺少 ZHIHU_ACCESS_SECRET 环境变量。请在 dsh 环境配置知乎 Access Secret，或在面板设置中填入。' }
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 50) : 20
      if (args.action === 'items') {
        const token = Number(args.urlToken)
        if (!Number.isFinite(token) || token <= 0) {
          return { ok: false, error: 'action=items 需要 urlToken（来自 action=lists 的 UrlToken）' }
        }
        const data = await run(['me', 'favorites', 'items', '--url-token', String(token), '--limit', String(limit)], secret)
        return { ok: true, urlToken: token, limit, items: data?.Data?.Items ?? [], raw: data }
      }
      const data = await run(['me', 'favorites', 'lists', '--limit', String(limit)], secret)
      return { ok: true, limit, favlists: data?.Data?.Items ?? [], raw: data }
    },
  })
}
