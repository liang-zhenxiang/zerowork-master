---
name: stock
description: |
  股票数据查询与条件选股工具集。包含两个子工具：
  stock-data：查询已知股票/指数的详细数据（行情、K线、财报、资金流向、技术指标、机构评级等）
  stock-tool：按条件筛选股票（PE<20、市值>500亿、ROE>15% 等）
  触发词：查行情、看K线、查财报、资金流向、技术指标、选股、筛选、帮我找股票
---

# Stock Data — 股票数据查询与条件选股

本 skill 包含两个子工具，覆盖"查数据"和"选股票"两大场景。

## 分工

| 工具 | 用途 | 调用方式 |
|------|------|---------|
| **stock-data** | 查已知股票/指数的详细数据（行情、K线、财报、资金、技术指标等） | `stock-data <命令> <参数>` |
| **stock-tool** | 按条件从市场里筛选股票（PE、市值、ROE、涨跌幅等） | `stock-tool <命令> <参数>` |

**配合流程**：stock-tool 筛选候选池 → stock-data 查详细数据 → 基于数据做分析。

## 快速示例

```bash
# 搜索股票代码
stock-data search 阿里巴巴

# 查实时行情
stock-data quote hk09988

# 查K线数据
stock-data kline sh600519 day 60 qfq

# 查财报
stock-data finance sh600519 4

# 条件选股
stock-tool filter "pe<20 AND roe>15"
```

命令已加入 PATH（通过 `bin/` 目录），无需指定完整路径。

## 代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪市 | `sh` + 代码 | `sh600519`（茅台） |
| 深市 | `sz` + 代码 | `sz000001`（平安银行） |
| 港股 | `hk` + 代码 | `hk09988`（阿里巴巴） |
| 美股 | `us` + 代码 | `usAAPL`（苹果） |

## 详细文档

- **stock-data 完整命令手册**：`SKILL-stock-data.md`
- **stock-tool 完整命令手册**：`SKILL-stock-tool.md`
- **stock-data AI 使用指南**：`references/data-ai-guide.md`
- **stock-data 场景指南**：`references/data-scenarios-guide.md`
- **stock-tool AI 使用指南**：`references/tool-ai-guide.md`
- **stock-tool 字段参考**：`references/tool-fields-guide.md`

## 环境要求

Node.js >= v18（脚本为单文件打包，无需 npm install）

## 降级策略

如果脚本不可用，使用 WebSearch 搜索相关信息作为替代：
- 行情数据：搜索"XX股票 实时行情""XX股票 PE PB"
- 财务数据：搜索"XX公司 最新财报"
- 资金流向：搜索"XX股票 资金流向"
- 条件选股：搜索"低估值高分红股票""PE低于15的银行股"

联网搜索的数据同样**必须标注来源**，禁止编造。
