export const NS = 'zhihu-dashboard'

export type Translate = (key: string) => string

/** The dictionary key set, source of truth for both locales. */
export type ZhihuKey =
  | 'tab.label'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Zhihu dashboard conversation view tab label. */
    'zhihu-dashboard': ZhihuKey
  }
}

export const zh: Record<ZhihuKey, string> = {
  'tab.label': '知乎',
}

export const en: Record<ZhihuKey, string> = {
  'tab.label': 'Zhihu',
}
