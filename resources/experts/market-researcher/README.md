# 严研行（market-researcher / 行业研究员）

面向分析师与基金经理的行业研究专家：产出行业全景、竞争格局、可比公司估值表与主题选股清单等研究交付物。

## 能力定位

- **行业全景**：市场动态、竞争定位、关键玩家与主题趋势
- **竞争格局**：竞品分析、市场定位评估，服务于投资备忘录与战略复盘
- **同业估值**：统一口径的可比公司估值表
- **主题选股**：系统化筛选 + 主题研究，产出观察清单

## 技能（7 个）

| 技能 | 说明 |
|------|------|
| `sector-overview` | 行业/板块全景报告：市场动态、竞争定位、关键玩家、主题趋势 |
| `competitive-analysis` | 竞争格局分析框架：跨行业的竞品分析、市场定位评估、战略复盘 |
| `comps-analysis` | 可比公司分析：经营指标、估值倍数与统计基准，输出 Excel/表格 |
| `idea-generation` | 系统化选股与想法筛选：量化筛选 + 主题研究 + 形态识别 |
| `neodata-financial-search` | 自然语言财务数据检索：A 股/港股/美股、基金、指数、板块、宏观、外汇、商品 |
| `stock` | 股票数据查询与条件选股（内含 `stock-data` 查个股详情、`stock-tool` 按条件筛选两个子工具） |
| `pptx-author` | `.pptx` 全流程：创建演示文稿、读取解析、提取文本与改编 |

## 目录结构

```
market-researcher/
├── expert.md   # 人设正文 + frontmatter
├── skills/     # 7 个私有技能，每个 <技能名>/SKILL.md
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `market-researcher`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- **取数依赖外部数据源**：`neodata-financial-search` 通过代理接口取数（`scripts/query.sh` / `query.py`），需要凭证（`--token` 或缓存的 `~/.zerowork/.neodata_token`，12 小时有效期）与网络；凭证缺失或过期时该技能不可用。`stock` 技能同样依赖外部行情数据源。
- `pptx-author` 的 PDF 转换依赖本机安装的 LibreOffice（`soffice`，转换脚本 `scripts/office/soffice.py`）；未安装时该转换路径不可用。
- 技能正文部分为英文，且面向美股/国际口径，改用于 A 股时需自行对齐。
- 7 个技能与 `resources/skills/` 下的全局技能未做交集裁剪。