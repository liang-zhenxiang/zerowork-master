# MVP开发专家团（mvp-dev-expert-team）

team 型专家团：说出想法，8 位专家从调研、设计、编码、测试到部署全流程协作，帮你快速开发出 MVP 产品。

## 角色与分工

主理人人格写在 `expert.md`（大湾区靓仔 · 项目总监），7 位成员人格在 `agents/`：

| Agent ID | 花名 | 角色 |
|---|---|---|
| `mvp-dev-expert-team-pm` | 许清楚 | 产品经理 |
| `mvp-dev-expert-team-designer` | 颜好看 | 设计师 |
| `mvp-dev-expert-team-architect` | 高见远 | 架构师 |
| `mvp-dev-expert-team-frontend` | 贾思敏 | 前端 |
| `mvp-dev-expert-team-backend` | 贝洛奇 | 后端 |
| `mvp-dev-expert-team-qa` | 严过关 | 测试 |
| `mvp-dev-expert-team-devops` | 卜宕机 | 运维 |

## 知识库

`references/` 下 24 篇参考资料，含工程纪律标准（`01-standards/` 11 篇）、行业设计规范（`industries/`）、平台规范（`platforms/`）、架构模式（`architecture/`）、成本模型（`cost-models/`）与设计系统（`design-systems/`）。目录索引与「谁在哪个 Phase 读哪一篇」的引用机制见 `references/README.md`。

主理人在每个 Phase 开始时读取对应篇目，把要点摘进成员的任务说明——成员的工作目录是用户项目，**看不到专家包**，所以包内路径不会下发给成员。

## 目录结构

```
mvp-dev-expert-team/
├── expert.md    # 主理人人设（含 expertType: team）
├── agents/      # 7 位成员人格，文件名即 Agent ID
├── references/  # 知识库 24 篇 + README.md 索引
├── avatars/     # 8 张角色头像（7 位成员 + 主理人）+ team.png
├── LICENSE      # MIT
└── README.md    # 本文件
```

无私有技能：本目录不含 `skills/`。

## 加载方式与协作语义

- `expertType: team`；`agents/` 下成员文件名必须等于其 frontmatter `name`（Agent ID 即文件名），每位成员都要声明 `tools`。
- 建团与调度用 `team_create`（`name` 填花名、`agent` 填 Agent ID）/ `team_send` / `team_status` / `team_delete`。
- 成员产出留在成员自己的会话记录里，主理人用 `team_read` 取回；并行副本必须使用唯一 `name`。
- `expert.md` 的正文注入系统提示词；frontmatter 的 `quickPrompts` 恰好 3 条、`tags` 恰好 3 个。

## 工具面分配

| 成员 | tools |
|---|---|
| pm / architect | read、read_document、find、grep、ls、web_search、web_fetch、write |
| designer | read、find、grep、ls、web_search、web_fetch、write |
| frontend / backend / devops | read、write、edit、find、grep、ls、powershell |
| qa | read、write、edit、find、grep、ls、powershell、web_search |

一律不含 `task`（深度锁：成员不许再委派）、`questionnaire`（成员没有用户在场）、`automation_*`（定时任务由主会话统一管理）。

## 已知限制

- 成员是长会话，没有硬性轮次上限；需要继续时用 `team_send` 唤醒。
- 成员看不到专家包，知识库内容必须由主理人摘进任务说明；成员自己找不到 `references/` 下的文件。
- 头像目前仅供展示层取用，未接入 HTML 渲染链路。
- 无私有技能，开发能力依赖平台通用工具与全局技能。