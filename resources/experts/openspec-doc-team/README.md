# 专业文档生成团队（openspec-doc-team）

team 型专家团：主理人 + 3 位成员协作，完成企业级长文档的深度调研、大纲规划、内容撰写与合规审核全流程，最终输出可交付的专业文档。

## 角色与分工

主理人人格写在 `expert.md`（章成文 · 总编辑），3 位成员人格在 `agents/`：

| Agent ID | 花名 | 职责 |
|---|---|---|
| `doc-researcher` | 苏寻源 | 文献检索员：按章节要点检索并整理资料 |
| `doc-generator` | 支笔生 | 内容生成员：根据章节要点与检索报告撰写正文 |
| `doc-auditor` | 严审之 | 质量审核员：审核待审章节与检索报告，给出审核结论 |

## 工作流

按 **6 阶段工作流（Workflow A–F）** 推进：调研 → 大纲 → 逐章生成（审核退回循环）→ 成稿。跨阶段通过**项目参数卡**传递，设 **6 维审核标准**与退回规则，另有铁律与禁止行为约束。

## 目录结构

```
openspec-doc-team/
├── expert.md   # 主理人人设（含 expertType: team）
├── agents/     # 3 位成员人格，文件名即 Agent ID
└── README.md   # 本文件
```

无私有技能：本目录不含 `skills/`。

## 加载方式与协作语义

- `expertType: team`；`agents/` 下成员文件名必须等于其 frontmatter `name`（Agent ID 即文件名），每位成员都要声明 `tools`。
- 建团与调度用 `team_create`（`name` 填花名、`agent` 填 Agent ID）/ `team_send` / `team_status` / `team_delete`。
- 成员产出留在成员自己的会话记录里，主理人用 `team_read` 取回；并行副本必须使用唯一 `name`。
- `expert.md` 的正文注入系统提示词；frontmatter 的 `quickPrompts` 恰好 3 条、`tags` 恰好 3 个。

## 已知限制

- 无私有技能：检索与写作能力依赖平台通用工具与全局技能，成员的工具面在各自的 frontmatter `tools` 中限定。
- 成员是长会话，没有硬性轮次上限，需要继续时用 `team_send` 唤醒。
- 审核环节依赖审核员按 6 维标准逐项给出结论，不会自动跳过；追求速度时只能由用户显式要求缩减。