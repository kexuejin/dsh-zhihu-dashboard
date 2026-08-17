# dsh-zhihu-dashboard

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的知乎面板插件：热榜、关注动态、帖子追踪与应用创意提炼 —— 既能在 DSH 界面里用，也能作为原生工具直接在对话中调用。

基于知乎官方 [zhihu-cli](https://developer.zhihu.com/zhihu-cli)（知乎开放平台）。需要免费的知乎开放平台 **Access Secret**。

## 功能

### 面板（界面）

- **热榜** —— 今日热点，带**趋势标记**（新上榜 / ↑ 上升 / ↓ 下降），通过相邻两次快照对比得出
- **关注动态** —— 我的近期收藏、我的创作（可按最新或**点赞最多**排序）、我关注的人
- **帖子追踪** —— 可追踪**问题**（该问题下所有回答）、**关键词**（同类新内容）、或**关注的人**（TA 发布的新内容，按作者精确过滤）。新内容标 `NEW` 并直接在追踪项下方内联展示，免去自己翻找；可选**自动简报**，把新发现的帖子经知乎直答提炼成应用创意简报；可选**系统通知 + 侧边栏未读徽标** —— 后台检查器运行在 DSH 顶层窗口，**使用 DSH 期间（无需打开面板）即可收到新内容提醒**
- **收藏夹** —— 收藏夹内容直接按收藏夹分组内联展示，支持本地搜索、收藏夹专属排序、新收藏内容 `NEW` 标记和研究包导出，无需再点进查看
- **未读** —— 聚合所有追踪项新发现的内容（追踪来源/作者/时间/摘要），侧边栏徽标点击即跳转，支持一键全部标记已读
- **内容工作台** —— 任意内容卡片可加入“稍后读 / 待分析 / 已处理”，在独立工作台 tab 分组复盘，并可导出 Markdown 或 CSV
- **阅读模式** —— 任意内容卡片可在面板内打开清爽阅读页，展示来源信息、原文入口，并支持一键复制本文 Markdown
- **追踪搜索控制** —— 可配置每个追踪项的检查条数、内容类型和时间窗，最近追踪过的关键词会回填为输入建议
- **本地排序 / 评分** —— 可选择平台默认、新增优先、点赞优先、时间优先，或按偏好关键词加权的本地评分排序
- **导出 / 研究包** —— 当前热榜、动态、收藏夹、未读流、追踪新增可一键复制为 Markdown 或 CSV，方便直接粘给 Agent 分析
- **本地内容过滤** —— 关键词、作者、正则屏蔽规则只存在浏览器本地，作用于热榜、关注动态、收藏夹、未读流和帖子追踪检查；卡片提供快捷屏蔽按钮，设置里保留最近过滤历史并支持一键撤销
- Access Secret 与条数等配置在面板自己的「设置」里（仅存浏览器 localStorage）

### 对话工具（Agent tools）

| 工具 | 作用 |
|---|---|
| `zhihu_search` | 搜索知乎内容（标题/作者/摘要/链接） |
| `zhihu_hot` | 当前热榜 |
| `zhihu_answer` | 知乎直答（检索增强回答 / 应用创意提炼） |
| `zhihu_global_search` | 全网搜索，支持时间窗（`sinceHours`）与实时索引 |
| `zhihu_followees` | 列出当前账号关注的人 |
| `zhihu_my_contents` | 我的创作（可按点赞排序分析最佳内容） |
| `zhihu_favorites` | 收藏夹列表 / 单个收藏夹内容 |

## 安装

```sh
dsh plugin --profile web add dsh-zhihu-dashboard
```

或把它加入 profile 的 `cordis.patch.yml` bundle 层。重启 `dsh web`。

### 前置条件

1. 安装 **zhihu-cli skill**（`dsh skill install zhihu`），使 CLI 二进制在 PATH 或标准安装位置 —— 插件会自动探测（`cliPath` 配置 → `ZHIHU_CLI_HOME` → `PATH` → 平台默认）
2. 在 [developer.zhihu.com/profile](https://developer.zhihu.com/profile) 申请 **Access Secret**
3. 把 Secret 提供给 CLI：`printf '%s' 'zh-…' | zhihu-cli auth set --secret-stdin`；或为对话工具设置 `ZHIHU_ACCESS_SECRET` 环境变量；或在面板里填写（仅浏览器本地）

> 💡 **首次打开面板**：未配置 Secret 时会显示三步引导卡片（打开开放平台 → 申请 Access Secret → 粘贴并验证），验证通过后自动加载数据。

## 工作原理

- **宿主半端**（`lib/`）：在 `/zhihu-dashboard` 提供路由（与 DSH `/api` 网关同等的 Host/Origin 信任栅栏），驱动 zhihu-cli，并通过 `ctx.tools.register` 注册 7 个对话工具
- **客户端半端**（`src/client/`，构建产物 `client/client.js`）：官方左侧边栏底部新增「知乎面板」按钮（`sidebar.footer.action`），点击打开右侧抽屉（`shell.overlay`）嵌入面板 —— 全局共享、不依赖任何第三方侧边栏；同时挂载**后台追踪检查器**（`track-checker.ts`，随 DSH 顶层窗口运行），按配置间隔检查追踪项，发现新内容时弹系统通知并更新侧边栏未读徽标

## 配置

| 选项 | 默认 | 说明 |
|---|---|---|
| `cliPath` | 自动探测 | zhihu-cli 二进制路径 |
| `hotLimit` | 10 | 热榜条数 (1-30) |
| `feedLimit` | 10 | 动态条数 (1-50) |
| `refreshSeconds` | 0 | 热榜/动态自动刷新秒数（0=关） |

面板专属配置（浏览器 localStorage）：Access Secret、追踪检查间隔、自动简报开关、系统通知开关，以及关键词、作者、正则本地屏蔽规则。

今日额度（热榜/直答）显示在面板顶部，避免悄悄用尽。

## 额度

知乎开放平台邀测额度（同账号所有 Secret 共享）：热榜 **100 次/天**、直答 **100 次/天**、搜索 **5,000 次/天**。自动简报与问题标题解析各消耗 1 次直答；追踪检查走搜索。

## 安全

- Access Secret 只存浏览器 `localStorage`，经同源请求头传给宿主，再以 `ZHIHU_ACCESS_SECRET` 注入 CLI（不进 argv、插件不写钥匙串）
- 路由沿用 DSH `/api` 网关的受信 Host/Origin 栅栏
- 无遥测，除知乎开放平台 API 外不做任何外部调用

## 开发

```sh
pnpm install
npx tsdown --config tsdown.config.ts   # 构建 client/client.js
npx tsc -p tsconfig.client.json        # 类型检查客户端源码
```

## License

MIT
