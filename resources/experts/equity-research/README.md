# 严估深（equity-research / 股票研究专家）

覆盖买方卖方完整研究工作流的股票研究专家，随包 15 个私有技能：财报分析、首次覆盖、DCF 与可比估值、多空推介、投资备忘录、事件驱动分析与组合风险管理。

## 能力定位

- **首次覆盖**：投行级首次覆盖研报的全流程（公司研究 → 财务建模 → 估值 → 图表 → 报告组装）
- **估值建模**：DCF 三表联动模型与可比公司相对估值
- **投资决策材料**：多空推介、投资备忘录、公司速览、晨会纪要
- **跟踪与风控**：投资逻辑跟踪、模型更新、催化剂日历、事件情景分析、组合风险

## 技能（15 个）

| 技能 | 一句话说明 |
|------|-----------|
| `initiating-coverage` | 投行级首次覆盖研报 5 步流程：公司研究 → 财务建模 → 估值 → 图表生成 → 报告组装（Task 1/2 可并行）。 |
| `earnings-analysis` | 盈利分析，含「财报前瞻」与「财报深度」两种模式（原 `earnings-preview` 已并入此技能）。 |
| `dcf-model-builder` | DCF 现金流折现 + 利润表/资产负债表/现金流量表三表联动建模。 |
| `comps-valuation` | 可比公司（Comps）相对估值：选同业组合、算关键倍数、推导估值区间。 |
| `long-short-pitch` | 结构化多头/空头投资推介：论点框架、催化路径、估值支撑、风险与仓位。 |
| `memo-builder` | 投资备忘录撰写：把投资逻辑与分析组织成供投委会/团队讨论的结构化备忘。 |
| `model-update` | 模型更新：财报/指引/宏观或假设变化后调估算、重算估值、标记重大变动。 |
| `company-tearsheet` | 公司一页纸速览（Tearsheet）：业务描述、关键财务、估值、股东结构、近期催化。 |
| `sector-overview` | 行业/板块综述：市场动态、竞争格局、关键玩家、主题趋势。 |
| `event-scenario-analyzer` | 事件驱动与情景敏感性分析：拆解事件（业绩/政策/并购/监管）对股价的影响并做多情景定量。 |
| `catalyst-calendar` | 催化剂日历：跟踪财报日、会议、产品发布、监管决定与宏观事件。 |
| `thesis-tracker` | 投资逻辑跟踪：维护持仓/观察名单的论点、数据点、催化与里程碑。 |
| `idea-generation` | 系统化选股与想法筛选：量化筛选 + 主题研究 + 形态识别。 |
| `portfolio-risk` | 组合风险管理：把论点转成仓位大小、对冲策略、暴露管理与监控规则。 |
| `morning-note` | 晨会纪要：隔夜动态、交易想法、覆盖标的的关键事件，7 点晨会体例。 |

## 目录结构

```
equity-research/
├── expert.md   # 人设正文 + frontmatter
├── skills/     # 15 个私有技能，每个 <技能名>/SKILL.md
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `equity-research`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `expert.md` 的正文注入系统提示词，并带上 `displayName`（严估深）与 `profession`（股票研究专家）作为当前身份。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`，且其 frontmatter 合法、带 `description`，否则模型看不到该技能。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- 技能多在**美股语境**下编写：数据源引 SEC EDGAR（10-K/10-Q/DEF 14A/8-K），研报体例对标 JPMorgan/Goldman/Morgan Stanley；`catalyst-calendar`、`model-update`、`thesis-tracker`、`morning-note`、`idea-generation`、`sector-overview` 描述全文为英文，改用 A 股语境时需替换披露渠道（交易所公告、巨潮资讯、招股说明书等）与语言。
- `comps-valuation` / `dcf-model-builder` / `long-short-pitch` / `memo-builder` / `portfolio-risk` / `event-scenario-analyzer` / `company-tearsheet` / `earnings-analysis` 为中文，但仍带国际准则语境（IFRS/GAAP 对照、美元示例）。
- `skills/` 下**没有** `earnings-preview`：该目录的 `SKILL.md` 自标 `[DEPRECATED] Merged into earnings-analysis skill` 且 `disable: true`，职责已由 `earnings-analysis` 承接。
- 15 个技能与 `resources/skills/` 下的全局技能当前无重名，未做交集裁剪。