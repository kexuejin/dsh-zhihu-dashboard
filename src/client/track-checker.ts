/**
 * Background track checker running in the DSH top window (not the panel
 * iframe), so tracking reminders work whenever the user is using DSH —
 * regardless of whether the panel drawer is open.
 *
 * State lives in localStorage (shared same-origin with the panel iframe):
 * - zhihu.tracks    : the track list with per-track `seen` ContentID sets
 * - zhihu.secret    : Access Secret (sent as x-zhihu-secret header)
 * - zhihu.trackInterval : minutes between checks (0 = off)
 * - zhihu.trackNotify   : whether to fire system notifications
 * - zhihu.autoBrief     : whether to auto-distill briefs (zhida)
 * - zhihu.unread    : running unread counter for the sidebar badge
 * - zhihu.blockKeywords / blockAuthors / blockRegex: browser-local filters honored before NEW notifications
 */

const KEYS = {
  tracks: 'zhihu.tracks',
  secret: 'zhihu.secret',
  trackInterval: 'zhihu.trackInterval',
  trackNotify: 'zhihu.trackNotify',
  autoBrief: 'zhihu.autoBrief',
  unread: 'zhihu.unread',
  unreadItems: 'zhihu.unreadItems',
  blockKeywords: 'zhihu.blockKeywords',
  blockAuthors: 'zhihu.blockAuthors',
  blockRegex: 'zhihu.blockRegex',
}

/** One unread item surfaced in the panel's 未读 tab. */
export interface UnreadItem {
  trackQuery: string
  title: string
  url: string
  author: string
  summary: string
  cid: string
  foundAt: number
}

interface Track {
  id: string
  query: string
  type?: string
  questionId?: string
  seen?: Record<string, boolean>
  checkedAt?: number
  lastNew?: number
  lastItems?: Array<{ title: string; url: string; author: string; summary: string; cid: string; isNew: boolean }>
  brief?: string
  briefAt?: number
  briefs?: Array<{ text: string; at: number }>
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode */ }
}

function linesOf(value: string | null): string[] {
  return String(value ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

interface FilterableItem {
  title?: string
  summary?: string
  author?: string
  trackQuery?: string
}

function filterTextOf(item: FilterableItem): string {
  return [item.title, item.summary, item.author, item.trackQuery].filter(Boolean).join('\n')
}

function isFiltered(item: FilterableItem): boolean {
  const text = filterTextOf(item)
  const lower = text.toLowerCase()
  for (const author of linesOf(lsGet(KEYS.blockAuthors))) {
    if (item.author && String(item.author).trim() === author) return true
  }
  for (const keyword of linesOf(lsGet(KEYS.blockKeywords))) {
    if (lower.includes(keyword.toLowerCase())) return true
  }
  for (const pattern of linesOf(lsGet(KEYS.blockRegex))) {
    try {
      if (new RegExp(pattern, 'i').test(text)) return true
    } catch { /* invalid user regex */ }
  }
  return false
}

function readTracks(): Track[] {
  try {
    const raw = lsGet(KEYS.tracks)
    const list = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function writeTracks(list: Track[]): void {
  lsSet(KEYS.tracks, JSON.stringify(list))
}

/** Read the unread feed (newest first). */
export function readUnreadItems(): UnreadItem[] {
  try {
    const raw = lsGet(KEYS.unreadItems)
    const list = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** Clear the unread feed and counter (after the user views the 未读 tab). */
export function clearUnread(): void {
  lsSet(KEYS.unreadItems, '[]')
  lsSet(KEYS.unread, '0')
}

/** Queue new items into the unread feed, deduped by cid, capped at 100. */
function appendUnreadItems(track: Track, fresh: Array<{ title: string; url: string; author: string; summary: string; cid: string }>): void {
  const existing = readUnreadItems()
  const seen = new Set(existing.map((i) => i.cid))
  const now = Date.now()
  for (const it of fresh) {
    if (it.cid === '' || seen.has(it.cid)) continue
    seen.add(it.cid)
    existing.push({
      trackQuery: track.query, title: it.title, url: it.url, author: it.author,
      summary: it.summary, cid: it.cid, foundAt: now,
    })
  }
  // Newest first, capped.
  existing.sort((a, b) => b.foundAt - a.foundAt)
  lsSet(KEYS.unreadItems, JSON.stringify(existing.slice(0, 100)))
}

/** One check round: search every tracked query, diff ContentIDs, persist. */
export async function checkAllTracks(): Promise<{ totalNew: number; perTrack: Array<{ query: string; count: number }> }> {
  const tracks = readTracks()
  if (tracks.length === 0) return { totalNew: 0, perTrack: [] }
  const secret = lsGet(KEYS.secret) ?? ''
  if (!secret) return { totalNew: 0, perTrack: [] }
  const autoBrief = lsGet(KEYS.autoBrief) === '1'
  const perTrack: Array<{ query: string; count: number }> = []
  let totalNew = 0
  for (const track of tracks) {
    const newCount = await checkOne(track, secret, autoBrief)
    if (newCount > 0) perTrack.push({ query: track.query, count: newCount })
    totalNew += newCount
  }
  return { totalNew, perTrack }
}

async function checkOne(track: Track, secret: string, autoBrief: boolean): Promise<number> {
  const before = new Set(Object.keys(track.seen ?? {}))
  const isFirstCheck = before.size === 0
  let payload: any
  try {
    const headers: Record<string, string> = { 'x-zhihu-secret': secret }
    if (track.questionId && track.query) {
      payload = await fetch(`/zhihu-dashboard/api/answers?q=${encodeURIComponent(track.questionId)}&title=${encodeURIComponent(track.query)}&count=10`, { headers, cache: 'no-store' }).then(r => r.json())
    } else {
      payload = await fetch(`/zhihu-dashboard/api/learn?q=${encodeURIComponent(track.query)}&count=10`, { headers, cache: 'no-store' }).then(r => r.json())
    }
  } catch {
    return 0
  }
  if (payload?.ok !== true || !Array.isArray(payload.Data?.Items)) return 0
  let items = payload.Data.Items as Array<any>
  if (track.type === 'person') {
    const name = String(track.query ?? '').trim()
    items = items.filter((it) => String(it.AuthorName ?? '').trim() === name)
  }
  const normalizedItems = items.map((it) => ({
    title: it.Title ?? '', url: it.Url ?? '', author: it.AuthorName ?? '',
    summary: it.ContentText ?? '', cid: String(it.ContentID ?? ''),
    isNew: !isFirstCheck && !before.has(String(it.ContentID ?? '')),
  }))
  const lastItems = normalizedItems.filter((it) => !isFiltered(it))
  const seenNow: Record<string, boolean> = {}
  for (const it of normalizedItems) {
    const cid = String(it.cid ?? '')
    if (cid) seenNow[cid] = true
  }
  let newCount = lastItems.filter((it) => it.isNew).length
  if (isFirstCheck) newCount = 0
  // Persist merged state back into the shared store.
  const list = readTracks()
  const cur = list.find((t) => t.id === track.id)
  if (cur) {
    cur.seen = { ...(cur.seen ?? {}), ...seenNow }
    cur.checkedAt = Date.now()
    cur.lastNew = newCount
    cur.lastItems = lastItems
    writeTracks(list)
    // Queue newly found items into the unread feed (panel's 未读 tab).
    if (!isFirstCheck && newCount > 0) {
      appendUnreadItems(track, lastItems.filter((it) => it.isNew))
    }
  }
  // Auto-brief on new content (one zhida call). Keep a small history so the
  // panel can show a 创意简报 timeline, not just the latest one.
  if (newCount > 0 && autoBrief && cur?.lastItems) {
    const fresh = cur.lastItems.filter((it) => it.isNew).slice(0, 5)
    if (fresh.length > 0) {
      const brief = await distillBrief(track, fresh, secret)
      const again = readTracks().find((t) => t.id === track.id)
      if (again) {
        const now = Date.now()
        again.brief = brief
        again.briefAt = now
        again.briefs = [...(again.briefs ?? []), { text: brief, at: now }].slice(-10)
        writeTracks(readTracks())
      }
    }
  }
  return newCount
}

async function distillBrief(track: Track, items: Array<any>, secret: string): Promise<string> {
  const subjects = items.map((it) => `- ${it.title}（${it.author || '匿名'}）\n  ${String(it.summary ?? '').slice(0, 200)}`).join('\n')
  const prompt = `追踪主题「${track.query}」发现了这些新内容：\n${subjects}\n\n请生成一份"创意简报"：\n1. 新增内容概览（谁在聊什么）\n2. 其中有价值的想法/创意点\n3. 可以产品化/做成的应用方向\n简明扼要，用中文。`
  try {
    const payload = await fetch(`/zhihu-dashboard/api/analyze?q=${encodeURIComponent(prompt)}&model=thinking`, { headers: { 'x-zhihu-secret': secret }, cache: 'no-store' }).then(r => r.json())
    if (payload?.ok !== true) return `（自动简报失败：${payload?.error ?? '直答不可用'}）`
    return payload?.choices?.[0]?.message?.content ?? payload?.content ?? payload?.Answer ?? '（直答未返回内容）'
  } catch (error: any) {
    return `（自动简报失败：${error?.message ?? error}）`
  }
}

/** Fire a system notification and bump the unread counter. */
export function notifyNew(total: number, perTrack: Array<{ query: string; count: number }>): void {
  const prev = Number(lsGet(KEYS.unread) ?? '0') || 0
  lsSet(KEYS.unread, String(prev + total))
  if (lsGet(KEYS.trackNotify) !== '1') return
  const lines = perTrack.slice(0, 3).map((t) => `${t.query}: ${t.count} 条`).join('\n')
  const body = `${lines}${perTrack.length > 3 ? `\n…共 ${total} 条` : ''}`
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('知乎追踪有新内容', { body, tag: 'zhihu-track' })
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch { /* notifications unavailable */ }
}

/** Run one background check round; returns the new-count summary. */
export async function runTrackCheck(): Promise<{ totalNew: number }> {
  const { totalNew, perTrack } = await checkAllTracks()
  if (totalNew > 0) notifyNew(totalNew, perTrack)
  return { totalNew }
}

/** Start (or restart) the interval timer from zhihu.trackInterval. */
export function startTrackTimer(): () => void {
  const minutes = Number(lsGet(KEYS.trackInterval) ?? '0') || 0
  if (minutes <= 0) return () => {}
  const id = setInterval(() => { void runTrackCheck() }, minutes * 60 * 1000)
  return () => clearInterval(id)
}
