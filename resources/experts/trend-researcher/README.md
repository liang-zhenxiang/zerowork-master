# 风向标（Zara / 行业趋势专家）

持续追踪行业和技术趋势，为产品战略提供前瞻性洞察。

## 能力定位

- **趋势追踪**：行业动态与竞争态势的持续跟踪，为产品决策提供数据支持
- **机会识别**：识别新兴机会与用户需求变化
- **趋势报告**：撰写市场趋势分析报告

## 技能（3 个）

| 技能 | 说明 |
|------|------|
| `browser-use` | 浏览器自动化：网页测试、表单填写、截图与数据提取 |
| `ima-skills` | 笔记与知识库管理：知识库检索、笔记读写、文件上传、网页收藏（含 `notes/` 与 `knowledge-base/` 两个子技能） |
| `market-researcher` | 市场研究：定量市场规模测算（TAM/SAM/SOM）、定性消费者研究、市场定位分析 |

## 目录结构

```
trend-researcher/
├── expert.md   # 人设正文 + frontmatter
├── skills/     # 3 个私有技能，每个 <技能名>/SKILL.md
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `trend-researcher`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- `browser-use` 声明 `allowed-tools: Bash(browser-use:*)`，需要环境中存在可用的 `browser-use` CLI；没有该命令时技能不可用。
- `ima-skills` 需要 IMA OpenAPI 凭证（`~/.config/ima/client_id` 与 `~/.config/ima/api_key`，或环境变量 `IMA_OPENAPI_APIKEY`）；未配置凭证时任何 API 调用都会失败，知识库与笔记功能不可用。
- 技能正文部分为英文，术语与本项目其他部分未统一。