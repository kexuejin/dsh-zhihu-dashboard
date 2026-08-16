# dsh-zhihu-dashboard

English | [中文](README.zh.md)

A Zhihu (知乎) dashboard plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness): hot list, follow feed, post tracking, and app-idea distillation — usable from the DSH UI **and** directly in agent conversations as native tools.

Built on the official [zhihu-cli](https://developer.zhihu.com/zhihu-cli) (知乎开放平台). Requires a free Zhihu Open Platform **Access Secret**.

## Features

### Panel (UI)

- **热榜 (Hot list)** — today's trending questions/articles, with **trend arrows** (新上榜 / ↑ / ↓) computed by diffing successive snapshots
- **关注动态 (Feed)** — your recent favorites, your own creations (sort by latest or **most-liked**), and the people you follow
- **帖子追踪 (Post tracking)** — watch a **question** (all its answers), a **keyword** (similar new content), or a **person** (their new posts, author-filtered). New content is flagged `NEW`; optional **auto-brief** distills newly found posts into app-idea briefs via Zhihu Zhida; optional **system notifications + a sidebar unread badge** alert you to new findings
- Access Secret and limits are configured in the panel's own Settings dialog (stored in browser `localStorage` only)

### Agent tools (conversation)

| Tool | What it does |
|---|---|
| `zhihu_search` | Search Zhihu content (titles/authors/summaries/links) |
| `zhihu_hot` | Current hot list |
| `zhihu_answer` | Zhihu Zhida (retrieval-augmented answer / app-idea distillation) |
| `zhihu_global_search` | Whole-web search with a recency window (`sinceHours`) and realtime index |
| `zhihu_followees` | List the users your account follows |

## Install

```sh
dsh plugin --profile web add dsh-zhihu-dashboard
```

Or add it to your profile's `cordis.patch.yml` bundle layer. Restart `dsh web`.

### Prerequisites

1. Install the **zhihu-cli skill** (`dsh skill install zhihu` or your harness's skill flow) so the CLI binary is on PATH / standard install location — the plugin auto-detects it (`cliPath` config → `ZHIHU_CLI_HOME` → `PATH` → platform default)
2. Get an **Access Secret** at [developer.zhihu.com/profile](https://developer.zhihu.com/profile)
3. Provide the secret to the CLI: `printf '%s' 'zh-…' | zhihu-cli auth set --secret-stdin`, or set `ZHIHU_ACCESS_SECRET` env for agent tools, or enter it in the panel (browser-local)

> 💡 **First launch**: with no secret configured, the panel shows a three-step onboarding card (open the platform → create an Access Secret → paste & verify); it loads data automatically once verification passes.

## How it works

- **Host half** (`lib/`): serves `/zhihu-dashboard` routes behind the same Host/Origin trust fence as the DSH API gateway, drives the zhihu-cli binary, and registers the five agent tools via `ctx.tools.register`
- **Client half** (`src/client/`, bundled to `client/client.js`): a **知乎面板** button in the official sidebar foot (`sidebar.footer.action`) opens a right-hand drawer (`shell.overlay`) embedding the panel — global, shared across sessions, no third-party sidebar dependency

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `cliPath` | auto-detect | Path to the zhihu-cli binary |
| `hotLimit` | 10 | Hot list item count (1-30) |
| `feedLimit` | 10 | Feed item count (1-50) |
| `refreshSeconds` | 0 | Auto-refresh for hot/feed (0 = off) |

Panel-only options (browser localStorage): Access Secret, track-check interval, auto-brief toggle, system-notification toggle.

## Quotas

Zhihu Open Platform trial quotas (shared across all your secrets): hot list **100/day**, Zhida **100/day**, search **5,000/day**. Auto-brief and question-title resolution each cost one Zhida call; tracking checks use search.

## Security

- Access Secret never leaves the browser's `localStorage` except as a same-origin request header to the host; it is injected into the CLI via `ZHIHU_ACCESS_SECRET` (never in argv, never written to the keychain by the plugin)
- Routes enforce the same trusted-Host/Origin fence as DSH's `/api` gateway
- No telemetry, no external calls beyond the Zhihu Open Platform API

## Development

```sh
pnpm install
npx tsdown --config tsdown.config.ts   # build client/client.js
npx tsc -p tsconfig.client.json        # typecheck client sources
```

## License

MIT
