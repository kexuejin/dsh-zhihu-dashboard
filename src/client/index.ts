/**
 * dsh-zhihu-dashboard client half: contributes a "知乎面板" button to the
 * official left sidebar foot (sidebar.footer.action) that opens a full-screen
 * shell.overlay embedding the /zhihu-dashboard page. Global, shared across
 * sessions, with no better-sidebar or conversation-view dependency.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; externals resolve through the loader module table (react
 * entries only).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-layout SlotMap merges into the program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, NS, zh } from './locales.ts'
import { registerZhihuLauncher } from './ZhihuLauncher.tsx'

export const name = 'zhihu-dashboard'

/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the sidebar launcher.
 * @param ctx - client root context with slots and locale available.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'zhihu-dashboard: dictionaries')
  registerZhihuLauncher(ctx)
}
