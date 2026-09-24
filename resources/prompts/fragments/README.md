# prompts/fragments — 共享提示词片段

## 概览

本目录是主提示词的**可复用片段**：按本仓库工具面、产品名「ZeroWork」与中文
提示词风格写成，由组装器按 include 指令拼进各场景骨架。

## 片段清单与要点

| 文件 | 覆盖的提示面 | 要点 |
| --- | --- | --- |
| delivery-rules.md | 最终回复的交付纪律：结果呈现 / 文件分享 / 收尾回复 | 保留本仓库的交付段原文（2026-09-09 present_files 漏挂事故后的护栏）；删掉本仓库没有的交付方式（本地起服务、在线文档链接格式）；URL 交付口径按本仓库实现写实（URL 只进清单不自动打开） |
| tool-discipline.md | 工具使用纪律：工具选择与调用政策 / 提问 / 个人文件安全 | 工具名映射到本仓库白名单（read / write / edit / find / grep / ls / web_search / web_fetch / powershell / questionnaire / present_files）；删掉本仓库没有的能力引用（Bash、TodoWrite、Agent/Explore 子代理、MCP 连接器、hooks）；powershell 受控按本仓库危险命令检查器（command-guard）的五类拦截写实 |
| narration.md | 过程叙述：「一批工具前一句、做完后一句」+ 失败要说人话 | 三段机制共同支撑这条纪律：① 界面把工具与思考折叠起来，用户能读到的过程只有正文（`src/renderer/src/app.js` 的折叠渲染）；② 主提示词把「里程碑处写进展」写成正面条款（`cli/product.json` 的 `tool-todowrite-description`：Mid-Session Checkpoints「每 3-5 项小结一次 / 说明还剩几项」是 CRITICAL 级硬条款）；③ CLI 的 `# Tone and style` 段明确承认「工具调用前那句话」的存在（"text like \"Let me read the file:\" followed by a read tool call"）。中文句式示例为本仓库自写 |
| windows-notes.md | Windows 差异条款 | 只留 Windows 差异：绝对路径、破坏性命令的目标校验与失败不重试、.ps1/.bat 非 ASCII 编码坑、时间戳用 PowerShell 现取；删 cmd /c 套壳条（本仓库只有一种 shell） |
| regional-conventions.md | 地域约定 | 默认中国用户、A 股红涨绿跌、¥ 默认 |
| python-env.md | 托管 Python 运行时的落点引导 | **零槽位**：解释器绝对路径随机器变，不进系统提示词（spec: stabilize-prompt-prefix —— 进去就是「重建 venv / 换机器 / 换安装位置即断前缀」），改由 daemon 现取（`src/main/daemon/runtimes.js` 的 `venvPython`）注入 hidden context 的 `python_env` 段，本片段只留恒定的纪律文字并指向那一段。**为什么必须写**：模型缺库的第一反应是 `pip install`，而它在沙箱里必失败（`docs/architecture.md` 已知边界第 8 条），所以要把 Python 的落点引导到托管 venv。两条不许改：① 不得写成「去跑 pip」（那里只有解释器可用）；② 必须留着「不要用 tempfile」那条 |

身份与边界**不单独成片段**：写在 `resources/scenes/work/prompt.md` 的
「你是ZeroWork…」与「能力与边界」段里 —— 身份与能力边界与本产品的场景骨架
强耦合，不往外抽。

## 机制约定

- 片段由 `src/main/daemon/prompt-compose.js` 的 `{{> name}}` 指令展开：递归展开、
  环检测、超深（8 层）与缺失一律抛错；片段内可继续 include 与使用槽位
  （{{interaction}} 等）。展开发生在槽位替换之前。
- 文件名必须匹配 `^[a-zA-Z][a-zA-Z0-9_-]*$` 且内容非空，否则加载时抛错
  （响亮失败，不静默带死文件/空洞上线）。
- 本 README 也会被加载成名为 `README` 的片段：不被引用即零 token 成本，
  但**不要**从任何骨架里 include 它。