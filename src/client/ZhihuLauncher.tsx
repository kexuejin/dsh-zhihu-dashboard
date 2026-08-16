/**
 * Zhihu dashboard launcher: an official-sidebar foot button
 * (sidebar.footer.action) that opens a full-screen shell.overlay embedding
 * the /zhihu-dashboard page. Global (root scope) — no better-sidebar or
 * conversation-view dependency; the panel is shared across sessions.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-layout SlotMap merges ('sidebar', 'shell.overlay')
// into the program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-sidebar SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import { startTrackTimer } from './track-checker.ts'

const PANEL_PATH = '/zhihu-dashboard'
const UNREAD_KEY = 'zhihu.unread'

/** Foot button rendered in the official left sidebar (wide row or rail icon). */
function ZhihuFootButton({ wide }: { wide: boolean }) {
  const [open, setOpen] = useState(false)
  // Unread badge: the dashboard iframe (same origin) writes zhihu.unread via
  // localStorage; the storage event fires in every same-origin window/iframe.
  const [unread, setUnread] = useState<number>(() => {
    try { return Math.max(Number(localStorage.getItem(UNREAD_KEY) || '0'), 0) } catch { return 0 }
  })
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === UNREAD_KEY) {
        setUnread(Math.max(Number(e.newValue || '0'), 0))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const openPanel = () => {
    setOpen((v) => !v)
    if (!open) {
      // Opening the panel clears the badge.
      try { localStorage.setItem(UNREAD_KEY, '0') } catch { /* private mode */ }
      setUnread(0)
    }
  }
  // Keep the overlay mounted while open; toggling re-renders it.
  return h('div', { style: { display: 'contents' } }, [
    h('button', {
      key: 'btn',
      type: 'button',
      title: unread > 0 ? `知乎面板（${unread} 条新内容）` : '知乎面板',
      'aria-label': '知乎面板',
      'aria-expanded': open,
      onClick: openPanel,
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
    ]),
    open
      ? h(ZhihuOverlay, { key: 'overlay', onClose: () => { setOpen(false); setUnread(0) } })
      : null,
  ])
}

/** Right-side drawer overlay embedding the dashboard page. The shell's
 *  overlayLayer covers the viewport but passes events through, so the drawer
 *  sits on the right while the DSH UI stays visible and interactive behind it. */
function ZhihuOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
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
 * Register the sidebar foot button and the overlay it opens, plus the
 * background track checker (runs in the DSH top window, so reminders fire
 * while the user is using DSH even with the panel drawer closed).
 * @param ctx - client root context with slots and locale available.
 */
export function registerZhihuLauncher(ctx: Context): void {
  ctx.locale.bind(NS) // keep the namespace referenced for future copy
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'zhihu-dashboard',
    order: 10,
  }, ZhihuFootButton))
  // Background tracking reminders, independent of the panel iframe.
  ctx.effect(() => startTrackTimer(), 'zhihu-dashboard: track checker')
}
