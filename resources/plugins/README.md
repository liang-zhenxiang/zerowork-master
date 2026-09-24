# 预装插件

首页胶囊点下去要用的能力。我们没有插件市场链路，插件一律**随包预装**：
插件原样落在这里，daemon 建会话时把它们纳入技能搜索路径
（`src/main/daemon/session-host.js` 的 `additionalSkillPaths` 加了 `resources/plugins`，
pi 会递归发现所有 `SKILL.md`）。

## 插件清单

| 插件 | 版本 | 许可 | 技能数 | 大小 |
|---|---|---|---|---|
| `document-skills` | 1.0.0 | Apache-2.0 | 2（pdf、pdfkit-py） | 538KB |
| `data` | 1.0.0 | Apache-2.0 | 8（data-analysis-workflows、data-context-extractor、data-exploration、data-validation、data-visualization、interactive-dashboard-builder、sql-queries、statistical-analysis） | 123KB |
| `deep-research` | 1.0.0 | Apache-2.0 | 1（wechat-article-search） | 62KB |
| `ppt-implement` | 1.0.13 | Apache-2.0 | 1（ppt-implement） | 2.6MB |
| `modern-webapp` | 1.0.0 | Apache-2.0 | 3（modern-web-app、ui-ux-pro-max、lucide-icons） | 1.0MB |

插件的元数据在各目录的 `.zerowork-plugin/plugin.json` 里（本仓库的运行时**不解析**它，
只作为结构信息保留）。

## 与首页胶囊的对应

| 我们的胶囊 | 依赖的插件 | 本目录 |
|---|---|---|
| 文档处理 | `document-skills` | ✅ |
| 数据分析及可视化 | `data-analysis`（市场里实际叫 `data`，API 名是旧的） | ✅ 用 `data` |
| 深度研究 | `deep-research` | ✅ |
| 幻灯片 | `ppt-implement` | ✅ |
| 网站开发 | `modern-webapp` | ✅（除 agent-browser，见下） |
| 日常开发 / CI/CD / 文档 | 无 | — |

## 目录约定

```
resources/plugins/<marketplace>/<plugin>/<version>/
├── .zerowork-plugin/plugin.json   # 插件原清单（本仓库不解析它）
├── skills/<skill>/SKILL.md         # ← 只有这部分被 pi 加载
├── agents/  hooks/  rules/  .genie/  # 原样保留，但我们的运行时目前不消费
```

保持插件原始结构（而不是把技能摊平进 `resources/skills/`）是为了让
「哪个技能属于哪个插件的哪个版本」一眼可见，升级或替换时不用猜。

## 未搬 / 待适配（对比测试时按这张表看）

| 项 | 状态 | 原因 |
|---|---|---|
| `modern-webapp` 的 `agent-browser` 技能 | **未搬** | 它的 `allowed-tools: Bash(agent-browser:*)` 依赖 `agent-browser` CLI（playwright 系），我们既没有那个 CLI 也没有 Bash 工具（只有 powershell）。搬进来就是点开必失败的假入口 |
| `ppt-implement` 的 `${ZEROWORK_PLUGIN_ROOT}` / `${ZEROWORK_PROJECT_DIR}` | **未适配** | 它的 SKILL.md 与 5 个脚本用宿主注入的插件根 / 项目根占位符，pi 的技能机制不展开这些变量（pi 的约定是「SKILL.md 里写相对技能目录的路径」）。这是唯一一个带占位符的插件 |
| `ppt-implement` 的 `hooks/hooks.json` | **未接线** | 它靠 SessionStart / PreToolUse(Skill) / PostToolUse(Edit\|Write) / Stop 四组 hook 跑 `setup-project.js`、`post-slide.js`、`export-ppt.js`。我们没有插件 hook 运行器（项目约定不自造插件加载器），所以这四个脚本目前不会被自动触发 |
| `deep-research` 的 `agents/research-subagent.md`、`rules/deep_research.md` | **未接线** | 前者是插件格式的子代理定义（我们的子代理在 `resources/agents/`，格式不同），后者是插件级规则（我们无消费方） |
| 各插件的 `allowed-tools` 含 `Bash(...)` | **未适配** | `pdfkit-py`、`lucide-icons` 的技能白名单里有 Bash；我们会话里没有 Bash 工具，模型会改用 powershell（工具描述对得上，但技能里写的命令要按 Windows 路径核对） |