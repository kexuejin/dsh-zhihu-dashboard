# v0.6.0 内容工作台设计

## 目标

把知乎面板从“内容浏览面板”升级为“内容工作台”：用户可以把热榜、关注动态、收藏夹、未读和追踪新增里的内容沉淀到本地队列或研究项目，再复制给 Agent 做批量分析。实现仍保持轻量、浏览器本地优先，不引入知乎 Cookie 登录或账号写操作。

## 范围

### 稍后处理队列

每张内容卡片增加工作台操作：稍后读、待分析、已处理。操作只写入浏览器 localStorage。新增“工作台”tab，按状态展示队列，支持状态切换、删除、复制 Markdown/CSV。队列条目沿用现有标准内容字段：来源、标题、作者、摘要、链接、时间、点赞。

### 研究项目

工作台内支持创建轻量研究项目，并把当前条目加入项目。项目保存在 localStorage，项目页展示项目内条目，支持导出 Markdown/CSV。项目不做复杂协作、同步或服务端存储。

### 批量分析入口

工作台和项目页提供“复制 Agent 分析提示”按钮，生成结构化提示词：要求总结主题、机会点、风险点、反方观点和下一步行动。默认只复制提示词和研究包文本，不自动消耗知乎直答额度。

## 不做

- 不做知乎 Cookie/扫码登录。
- 不做点赞、关注、评论、发回答等账号写操作。
- 不做云同步或跨浏览器同步。
- 不做 embedding 聚类；后续可用标题相似度做轻量去重。

## 数据结构

- `zhihu.workspaceItems`: 本地工作台条目数组。字段：`id`、`status`、`source`、`title`、`author`、`summary`、`url`、`time`、`likes`、`addedAt`、`updatedAt`。
- `zhihu.researchProjects`: 本地研究项目数组。字段：`id`、`name`、`createdAt`、`updatedAt`、`items`。

## 验证

每个实现 checkpoint 运行 dashboard 脚本语法检查、`npm run check`、`git diff --check`，同步 runtime 后提交。整批完成后统一打 `v0.6.0` tag。
