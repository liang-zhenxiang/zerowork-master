# 深度研究团队（gpt-researcher-team）

team 型专家团：主理人 + 6 位成员按 5 阶段工作流协作，把多源信息聚合成带行内超链接引用的专业研究报告。适用于行业研究、竞品分析、技术综述、学术文献综述等场景。

## 角色与分工

主理人人格写在 `expert.md`（顾全之 · 研究主编），6 位成员人格在 `agents/`：

| Agent ID | 花名 | 职责 |
|---|---|---|
| `topic-researcher` | 谭溯源 | 课题研究员：多源检索与聚合，撰写带行内超链接引用的研究摘要或章节草稿 |
| `research-planner` | 季要纲 | 研究编辑：从研究摘要提炼核心观点，确定报告标题并规划不重叠、逻辑递进的章节大纲 |
| `draft-reviewer` | 明鉴秋 | 草稿审稿人：按 6 维标准审查草稿，输出 PASS 或带具体修改项的 REVISE |
| `draft-reviser` | 任润泽 | 内容修订员：按审稿意见逐条回应修改、补充真实来源，保持未受批评部分不变 |
| `report-writer` | 程文成 | 报告撰写人：汇总全部章节撰写引言、结论、目录与 APA 参考文献列表 |
| `report-publisher` | 傅梓铭 | 报告发布员：整合章节与框架为完整报告，统一格式、检查链接，落盘 Markdown 交付 |

## 工作流

- **Workflow A（默认）**：Phase 1 初始调研 → Phase 2 规划大纲 → Phase 3 逐章深度调研 + 审稿修订循环 → Phase 4 撰写报告框架 → Phase 5 发布输出。跨成员的信息流全部经主理人中转，由**研究参数卡**传递给下一阶段。
- **Workflow B（快速研究）**：章节减为 3 章、跳过审稿修订循环，产出会显式标注「本次为快速研究，未经审稿」。
- **Workflow C（单章研究）**：只针对某个子课题收窄范围做研究。
- 用户只问单一动作时，主理人直接调度对应成员，不走完整 Workflow。

## 目录结构

```
gpt-researcher-team/
├── expert.md   # 主理人人设（含 expertType: team）
├── agents/     # 6 位成员人格，文件名即 Agent ID
├── avatars/    # 7 张角色头像（6 位成员 + 主理人）+ team.png
└── README.md   # 本文件
```

无私有技能：本目录不含 `skills/`。

## 加载方式与协作语义

- `expertType: team`；`agents/` 下成员文件名必须等于其 frontmatter `name`（Agent ID 即文件名），每位成员都要声明 `tools`。
- 建团与调度用 `team_create`（`name` 填花名、`agent` 填 Agent ID）/ `team_send` / `team_status` / `team_delete`。
- 成员产出留在成员自己的会话记录里，主理人用 `team_read` 取回；并行副本必须使用唯一 `name`。
- `expert.md` 的正文注入系统提示词；frontmatter 的 `quickPrompts` 恰好 3 条、`tags` 恰好 3 个。

## 已知限制

- 成员是长会话，**没有硬性轮次上限**：正文里的轮次表只是「软预期」，成员跑完一轮自然收尾，需要继续时用 `team_send` 唤醒。
- 无私有技能，成员的取数与写作依赖平台通用工具与全局技能。
- 并行加速依赖成员名唯一（副本命名规则已写进正文）；成员级模型选择暂未支持。
- 未与 `resources/skills/` 下的全局技能做交集裁剪。