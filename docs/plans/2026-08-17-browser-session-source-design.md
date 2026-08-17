# v0.8.0 只读浏览器会话数据源设计

## 目标

降低知乎开放平台 rate limit 对内容发现的影响，同时不把插件做成完整知乎客户端。v0.8.0 增加显式高级模式：从本机浏览器 profile 中只读 `zhihu.com` Cookie，验证登录态后作为机会发现的数据源补充。插件不保存账号密码，不做写操作，不把 Cookie 发送给模型。

## 原则

- 用户显式启用，不静默读取浏览器 Cookie。
- 只读取 `.zhihu.com`、`www.zhihu.com` 相关 Cookie。
- 默认只在内存中组装 Cookie header；不持久化完整 Cookie。
- 所有浏览器会话请求都是只读：验证、读取页面/API、提取标题摘要链接。
- Cookie 不进入日志、模型 prompt、导出包或错误详情。
- 官方 API 保留为默认和 fallback。

## v0.8.0 范围

### Profile 检测

Host 端扫描常见浏览器 profile 路径，返回候选 profile 的浏览器名、profile 名称、路径、是否存在 Cookie 数据库。第一版优先支持 macOS 常见路径：Chrome、Edge、Brave、Arc、Firefox。其他平台返回可解释的“不支持/未检测到”。

### Cookie 只读提取

Host 端从选定 profile 复制 Cookie DB 到临时位置再读取，避免浏览器锁库。只查询 `zhihu.com` 域 Cookie。第一版优先处理可直接读取或本机可解密的浏览器；如果 Cookie 加密不可解，返回明确错误，并提供手动 Cookie 导入 fallback。

### 登录态验证

用 Cookie 访问一个轻量只读知乎页面/API，判断：可用、未登录、Cookie 不可解密、被风控、网络失败。验证结果只展示状态，不暴露 Cookie。

### 面板高级模式

设置/机会报告页新增“浏览器会话（只读）”入口：检测 profile、选择 profile、验证登录态。验证成功后机会报告可从浏览器会话数据源补充内容。失败时回退本地缓存/工作台/官方 API。

### 机会发现接入

机会报告优先聚合浏览器会话最近内容，再合并本地缓存、追踪、未读、工作台和研究项目。DSH provider/model 继续负责分析报告；浏览器 Cookie 只用于内容读取。

## 不做

- 不做账号密码登录。
- 不做手机验证码/短信登录。
- 不做自动扫码登录。
- 不做点赞、关注、评论、发回答。
- 不长期保存完整 Cookie。
- 不直接吸收 zhihu-plus-plus 代码；只参考其“Cookie 登录、登录态/非登录态数据源、zse96/Web API 思路”。

## 验证

实现后运行 dashboard 脚本语法检查、`node -c lib/index.js`、`npm run check`、`git diff --check`，同步 runtime，提交 checkpoint。整批稳定后发布 `v0.8.0` tag。
