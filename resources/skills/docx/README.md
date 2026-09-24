# docx 技能包

`resources/skills/docx/` 是一整套**中文文档生产**能力：从选题、组稿、排版到
HTML → DOCX 转换与质量门禁。本文件说明这包里有哪些东西、各自干什么、
谁加载它、以及当前哪些环节还没接线。

加载方式与其他技能一致：pi 递归发现技能目录下的 `SKILL.md`，
`resources/skills/` 已在会话的技能搜索路径里。本 `README.md` 不是技能正文，
不参与加载。

## 入口与编排

| 条目 | 作用 |
|---|---|
| `SKILL.md`（根守门） | 定「何时进本技能 / 何时退出」与「必须走 orchestrator」的强制规则。进技能后所有请求先交给 orchestrator 路由，不允许绕过它直接调子技能 |
| `orchestrator/SKILL.md` + `references/pipeline-state-protocol.md`、`references/log-schema.md` | 主编排。Stage 0 路由判定；S1 / S2 / S3 三阶段的输入输出契约；`pipeline-state` 的状态字段与转移协议；待填合同类任务的出口判据 |
| `agents/`（doc-writer / doc-formatter / doc-converter） | 三个子代理定义：组稿（writer）、排版（formatter）、转换（converter）。三者共用「HTML 是唯一中间态」的约定，衔接字段在 S1→S2→S3 之间传递 |
| `brief-compose/SKILL.md` | 短篇快速通道：目标成品 < 1000 字时跳过完整流水线，直接成稿 |

**流水线口径**：正文一律先落成 HTML，再由 `docx_convert` 工具转 DOCX；
HTML 必须过 `html-review` 门禁才算完成；编辑意图（改字、调措辞）不进流水线。

## 能力组件

| 条目 | 作用 |
|---|---|
| `typeset/`（SKILL.md + 8 模板 + 8 提示词 + 4 组件） | 版式排版：按文种选模板，产出可直接转 DOCX 的 HTML |
| `html-review/`（SKILL.md + `scripts/review_html.py` + 6 篇 references） | HTML 静态质量门禁，是流水线里唯一的放行判据 |
| `format-extract/SKILL.md` | 「照既有文档的版式重排」的入口。只写职责边界、调用契约与不可复原项，能力本体在 `resources/docx-engine/docx_to_html/`（python-docx + stdlib `zipfile`，零新增依赖，与正向引擎共用同一托管 venv） |
| `generate-fillable-contract-html/SKILL.md` | 生成待填合同 / 报价单 / 授权委托书类 HTML，交给 `docx_convert` 转换；frontmatter 带 `version: "1.0.0"` |
| `design-token/SKILL.md` + `scripts/build_tokens.py` | 设计 token 的查表协议与编译脚本；`tokens/compiled/` 的运行时读取契约在这里定 |
| `engines/critic-generator/`、`engines/deep-research/` | 两个评审/研究引擎的定义（各含 `README.md` + `engine.md`）。文体专家通过 `<docx_root>/engines/…` 引用它们 |
| `experts/`（9 个文体专家） | 学术论文 / 商业文案 / 通用写作 / 法律合同 / 诗词散文 / 科技写作 / 股票研报 / 技术博客 / 工作报告。各自带 `references/` `assets/` `scripts/` |

## 设计 token

- `tokens/themes/` —— 5 套主题；
- `tokens/rules/` —— GB/T 7713、GB/T 7714、GB/T 9704 三份国标规则；
- `tokens/compiled/` —— 编译产物：general / business-report / academic-paper /
  government-doc / marketing-doc / index。

`compiled/` 由 `themes/` + `rules/` 经 `design-token/scripts/build_tokens.py` 生成，
运行时读的是 `compiled/`。**改主题或国标规则后必须重跑编译脚本**，
否则运行时拿到的还是旧产物。

## 已知边界

- **不做 HTML 转换质量的量化评估**：本包的量化工具有且只有 `html-review`
  一套静态门禁，`format-extract` 只负责提取版式，不重复造第二套评分。
- **`format-extract` 不产出预构建二进制**：它不依赖任何 node 产物，
  目标机器无需 Node ≥ 18。
- **不可复原项如实上报**：页眉页脚 / 页码 / 分节 / 浮动对象 / 域代码 / 图表
  本身不反向提取，只在 `docx_to_html` 的 `not_restorable` 里按实际命中列出
  （详见 `resources/docx-engine/README.md`）。