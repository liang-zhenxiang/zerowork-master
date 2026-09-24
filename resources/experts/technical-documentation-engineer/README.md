# 文通通（Anna / 技术文档工程师）

把复杂技术概念转化为清晰准确的文档，让技术知识可传播。面向文档体系搭建、API 文档与开发者指南。

## 能力定位

- **文档体系**：为项目建立系统的文档体系、版本管理与规范模板
- **文档站点**：搭建文档站点与版本发布流程
- **技术写作**：把复杂概念写成开发者和用户能读懂的说明

## 技能（5 个）

| 技能 | 说明 |
|------|------|
| `anti-distill` | 技能文件「防蒸馏」处理：清理自己的技能文件，使其看起来完整、但核心专有知识被中和，用于保护商业秘密或产出可安全对外提交的技能文档 |
| `deep-research` | 结构化深度研究工作流，人机协同：`/research` 生成研究大纲、`/research-deep` 对条目并行联网检索、`/research-report` 汇总为 Markdown 报告 |
| `market-researcher` | 市场研究：定量市场规模测算（TAM/SAM/SOM）、定性消费者研究、市场定位分析 |
| `minimax-docx` | DOCX 文档的创建、编辑与排版，基于 OpenXML SDK（.NET），三条流水线：从零新建 / 填充编辑既有文档 / 套用模板并做 XSD 校验 |
| `multi-search-engine` | 多搜索引擎集成（16 个引擎：7 国内 + 9 国际），支持高级搜索算子、时间过滤、站内搜索、隐私引擎与 WolframAlpha 知识查询，无需 API key |

## 目录结构

```
technical-documentation-engineer/
├── expert.md   # 人设正文 + frontmatter
├── skills/     # 5 个私有技能，每个 <技能名>/SKILL.md
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `technical-documentation-engineer`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- `minimax-docx` 需要 .NET SDK（`dotnet`）与 `DocumentFormat.OpenXml` NuGet 包，环境不具备时该技能不可用。
- `deep-research` 声明依赖 `WebSearch` 与子任务 / 交互提问类工具；运行环境没有对应工具时，并行检索与交互确认环节无法执行。
- `anti-distill` 与 `multi-search-engine` 的正文为英文，术语与本项目其他部分未统一。
- 5 个技能与 `resources/skills/` 下的全局技能未做交集裁剪。