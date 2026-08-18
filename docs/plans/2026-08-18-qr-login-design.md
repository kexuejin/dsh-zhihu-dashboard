# v0.8.5 知乎扫码登录设计

## 目标

实现推荐的账号态数据源：知乎扫码登录。登录成功后 host 端保存只读会话，面板和智能简报优先使用该会话读取账号态内容。前端不展示 Cookie，模型 prompt、导出、日志不包含 Cookie。

## 保存策略

用户选择“本机持久保存”。会话保存在 DSH_HOME 下插件私有文件：`~/.dsh/zhihu-session.json`。文件只保存知乎只读请求所需的 Cookie header 和元数据。UI 提供清除会话，清除后删除该文件。

## Host API

- `POST /zhihu-dashboard/api/qr-login/start`：创建一次扫码登录尝试，返回二维码内容、过期时间和 login id。
- `GET /zhihu-dashboard/api/qr-login/status?id=...`：轮询扫码状态，返回 waiting/scanned/confirmed/expired/failed/succeeded。成功时保存会话。
- `POST /zhihu-dashboard/api/qr-login/logout`：删除本机会话文件并清理内存状态。
- `GET /zhihu-dashboard/api/session-status`：返回是否已有可用只读会话、保存时间、过期提示和最近验证状态。

## 实现约束

- 不保存账号密码。
- 不把 Cookie 返回前端。
- 不把 Cookie 写入日志、模型 prompt 或导出内容。
- 只做读取请求，不做点赞、评论、关注等写操作。
- 扫码登录协议如果知乎接口变更或风控阻断，需要清晰返回失败原因，并保留 Access Secret fallback。

## UI

设置页「数据源」中的“知乎扫码登录（推荐）”改为真实操作区：

- 显示状态：未登录、等待扫码、已扫码待确认、登录成功、过期、失败。
- 按钮：生成二维码、刷新状态、清除只读会话。
- 显示二维码图片或可扫码文本。
- 成功后显示保存时间，不显示 Cookie。

## 数据源接入

智能简报/机会报告的数据源统计保留“会话”。会话读取优先使用扫码登录保存的 session；Access Secret 继续用于开放平台 CLI 数据；旧 browser-session API 只保留内部 fallback。

## 验证

实现后运行 dashboard 脚本语法检查、`node -c lib/index.js`、`npm run check`、`git diff --check`，同步 runtime，提交 checkpoint，发布 `v0.8.5` tag。
