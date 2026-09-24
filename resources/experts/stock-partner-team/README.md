# 股票投研专家团（stock-partner-team）

team 型专家团：6 位投研专家兼擅产业策略、信号捕捉、估值定价、逆向布局、基本面与短线，基于实时行情做多视角研判。

## 角色与分工

主理人人格写在 `expert.md`（圆汇众 · 投研主编），6 位成员人格在 `agents/`：

| Agent ID | 花名 | 视角 |
|---|---|---|
| `industry-strategist` | 星望远 | 产业策略 |
| `signal-chief` | 洲四方 | 信号捕捉 |
| `valuation-analyst` | 文衡价 | 估值定价 |
| `contrarian-investor` | 坤候底 | 逆向布局 |
| `fundamental-researcher` | 钊审财 | 基本面研究 |
| `shortterm-surfer` | 磊追浪 | 短线节奏 |

## 技能（3 个）

| 技能 | 说明 |
|------|------|
| `stock-data` | 通过 stock-mcp 连接器查询 A股/港股/美股个股、指数、ETF 数据——行情、K线、财报、资金、技术指标、板块成份、宏观等。需已连接 stock-mcp。 |
| `stock-tool` | 通过 stock-mcp 连接器做条件选股 / 策略选股 / 标签选股。需已连接 stock-mcp。 |
| `md-to-html` | 把圆桌报告渲染成单文件 HTML：主理人写完 `<主题>-圆桌报告.md` 与 body 片段后，调用 `scripts/render.py` 合成最终 HTML（CSS 内联、头像 base64 嵌入），可直接打开或分享。 |

## 目录结构

```
stock-partner-team/
├── expert.md          # 主理人人设（含 expertType: team）
├── agents/            # 6 位成员人格，文件名即 Agent ID
├── skills/            # 3 个私有技能
│   └── md-to-html/    # SKILL.md + components.md + shell.html + avatar-mapping.md + scripts/
├── avatars/           # 8 张角色头像（6 位成员 + 主理人）+ team.png
├── bin/               # init_task / init_task.cmd / init_task.py（本地任务标记，见下）
└── README.md          # 本文件
```

## 加载方式与协作语义

- `expertType: team`；`agents/` 下成员文件名必须等于其 frontmatter `name`（Agent ID 即文件名），每位成员都要声明 `tools`。
- 建团与调度用 `team_create`（`name` 填花名、`agent` 填 Agent ID）/ `team_send` / `team_status` / `team_delete`。
- 成员产出留在成员自己的会话记录里，主理人用 `team_read` 取回；并行副本必须使用唯一 `name`。
- `skills/` 作为额外技能搜索路径挂载；`expert.md` 的正文注入系统提示词。

## 已知限制

- **行情依赖**：取数走 stock-mcp 连接器。成员的工具面不含 `use_skill`，且用户未必连了该数据源——未连接时降级为 `web_search` / `web_fetch` 取公开行情与财报，精度与时效性无法保证，产出需注明数据来源与获取时间。
- 成员是长会话，没有硬性轮次上限（`team_send` 可唤醒）；成员看不到专家包，包内路径不对成员下发。
- `bin/init_task` 是**本地 no-op**：只写删本地标记 `~/.zerowork/expert-task.json`，不做任何网络上报。保留该命令是为了让 `expert.md` 与 `skills/md-to-html/SKILL.md` 里的多处调用无需改写即可跑通，不产生「调用不存在的命令」这类失败。
- `md-to-html` 渲染会内嵌 `avatars/` 下头像（头衔 → 文件名映射见 `skills/md-to-html/avatar-mapping.md`）。