/**
 * Zhihu dashboard launcher: an official-sidebar foot button
 * (sidebar.footer.action) that opens a right-hand drawer registered as its
 * own shell.overlay entry. The two slots are separate registrations —
 * embedding the overlay inside the button component would render it inside
 * the sidebar footer's DOM (zero-size). A tiny module store coordinates
 * open/close between them.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-layout SlotMap merges ('sidebar.footer.action',
// 'shell.overlay') into the program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-sidebar SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import { startTrackTimer } from './track-checker.ts'

const PANEL_PATH = '/zhihu-dashboard'
const UNREAD_KEY = 'zhihu.unread'

// ── tiny shared store: open state bridged between the two slot registrations ──
let panelOpen = false
const listeners = new Set<() => void>()
function setPanelOpen(v: boolean): void {
  panelOpen = v
  for (const fn of listeners) fn()
}
function subscribePanelOpen(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function usePanelOpen(): boolean {
  const [open, setOpen] = useState(panelOpen)
  useEffect(() => subscribePanelOpen(() => setOpen(panelOpen)), [])
  return open
}

/** Foot button rendered in the official left sidebar (wide row or rail icon). */
function ZhihuFootButton({ wide }: { wide: boolean }) {
  const open = usePanelOpen()
  const [unread, setUnread] = useState<number>(() => {
    try { return Math.max(Number(localStorage.getItem(UNREAD_KEY) || '0'), 0) } catch { return 0 }
  })
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === UNREAD_KEY) setUnread(Math.max(Number(e.newValue || '0'), 0))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const toggle = () => setPanelOpen(!panelOpen)
  return h('button', {
    type: 'button',
    title: unread > 0 ? `知乎面板（${unread} 条新内容）` : '知乎面板',
    'aria-label': '知乎面板',
    'aria-expanded': open,
    onClick: toggle,
    style: {
      width: '100%',
      height: 36,
      border: 'none',
      borderRadius: 8,
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, #8b98a5)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: wide ? 'flex-start' : 'center',
      gap: 8,
      padding: wide ? '0 12px' : 0,
      fontSize: 13,
    },
  }, [
    h('span', { key: 'icon', style: { fontSize: 15, lineHeight: 1 } }, '知'),
    wide ? h('span', { key: 'label' }, '知乎面板') : null,
    unread > 0
      ? h('span', {
          key: 'badge',
          style: {
            marginLeft: 'auto',
            background: '#00ba7c',
            color: '#06281c',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 8px',
          },
        }, unread > 99 ? '99+' : String(unread))
      : null,
  ])
}

/** Right-side drawer overlay registered as its own shell.overlay entry, so it
 *  renders in the shell's overlay layer (full-viewport) rather than inside the
 *  sidebar footer. Always mounted; `open` toggles visibility/transform only,
 *  so the iframe page survives open/close cycles. */
function ZhihuOverlay() {
  const open = usePanelOpen()
  const onClose = () => setPanelOpen(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setPanelOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return h('div', {
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 'min(960px, 92vw)',
      background: 'var(--dsw-alias-bg-base, #0f1419)',
      borderLeft: '1px solid var(--dsw-alias-border-l2, #2f3a45)',
      boxShadow: '-12px 0 32px rgba(0,0,0,.35)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 21,
      visibility: open ? 'visible' : 'hidden',
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform .18s ease, visibility .18s',
      pointerEvents: open ? 'auto' : 'none',
    },
  }, [
    h('div', {
      key: 'bar',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #2f3a45)',
        background: 'var(--dsw-alias-bg-layer-1, #171e26)',
      },
    }, [
      h('strong', { key: 'title', style: { fontSize: 14 } }, '知乎面板'),
      h('span', { key: 'hint', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8b98a5)' } }, '热榜 · 关注动态 · 帖子追踪'),
      h('span', { key: 'spacer', style: { flex: 1 } }),
      h('button', {
        key: 'close',
        type: 'button',
        onClick: onClose,
        style: {
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--dsw-alias-border-l2, #2f3a45)',
          background: 'var(--dsw-alias-bg-layer-2, #1c2530)',
          color: 'var(--dsw-alias-label-primary, #e7e9ea)',
          fontSize: 13,
          cursor: 'pointer',
        },
      }, '关闭 (Esc)'),
    ]),
    h('iframe', {
      key: 'frame',
      src: PANEL_PATH,
      style: { flex: 1, width: '100%', border: 'none', background: 'var(--dsw-alias-bg-base, #0f1419)' },
      title: 'Zhihu dashboard',
    }),
  ])
}

/**
 * Register the sidebar foot button, the overlay drawer (separate shell.overlay
 * entry), and the background track checker.
 * @param ctx - client root context with slots and locale available.
 */
export function registerZhihuLauncher(ctx: Context): void {
  ctx.locale.bind(NS) // keep the namespace referenced for future copy
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'zhihu-dashboard',
    order: 10,
  }, ZhihuFootButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'zhihu-dashboard-drawer',
    order: 10,
  }, ZhihuOverlay))
  // Background tracking reminders, independent of the panel iframe.
  ctx.effect(() => startTrackTimer(), 'zhihu-dashboard: track checker')
}
