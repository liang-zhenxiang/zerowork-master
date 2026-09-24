# 图说说（Eva / 视觉叙事专家）

擅长将复杂信息转化为引人入胜的视觉故事：把内容、数据与品牌信息做成有叙事线的视觉呈现。

## 能力定位

- **视觉叙事方案**：为品牌内容设计视觉叙事结构与表达方式
- **数据可视化**：把数据转化为信息图
- **品牌视觉手册**：品牌宣传视觉的规范与素材组织

## 技能（3 个）

| 技能 | 说明 |
|------|------|
| `content-factory` | 多智能体内容生产：一份源内容派生出多种格式——社媒帖、邮件、脚本、标题等，含 Writer / Remixer / Editor / Scriptwriter / Headline Machine 五种角色 |
| `marketing-skills` | 23 个营销手册（CRO、SEO、文案、分析、实验、定价、发布、广告、社媒），产出清单与可直接复用的交付物 |
| `minimax-docx` | DOCX 文档的创建、编辑与排版，基于 OpenXML SDK（.NET），三条流水线：从零新建 / 填充编辑既有文档 / 套用模板并做 XSD 校验 |

## 目录结构

```
visual-storytelling-expert/
├── expert.md   # 人设正文 + frontmatter
├── skills/     # 3 个私有技能，每个 <技能名>/SKILL.md
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `visual-storytelling-expert`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- `minimax-docx` 需要 .NET SDK（`dotnet`）与 `DocumentFormat.OpenXml` NuGet 包，环境不具备时该技能不可用。
- `content-factory` 与 `marketing-skills` 的正文为英文，术语与本项目其他部分未统一。
- 3 个技能与 `resources/skills/` 下的全局技能未做交集裁剪。