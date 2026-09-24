# ZeroWork

办公 AI Agent 桌面端。Electron + React 19，Agent 内核基于
[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)（pi agent harness）。

支持多场景（代码开发 / 日常办公 / 文档处理 / 数据分析 / 深度研究 / 幻灯片）、
专家与技能体系、MCP 连接器、自动化任务、会话归档与审计。

---

## 关于本仓库

源码以 **JavaScript + JSDoc** 提供，类型检查走 `tsc --checkJs`（见 `tsconfig.json`）。
动手之前，有两处结构性事实值得先知道：

1. **没有编译期类型信息。** 应用主体以 JS 提供，只有一个名为 `typebox` 的
   **运行时**类型库（用于工具参数校验）。类型靠 JSDoc 渐进补，
   路径见 [docs/architecture.md](./docs/architecture.md) 的「类型检查」一节。

2. **渲染层是 chunk 粒度，不是组件粒度。** `src/renderer/src/` 下的文件对应
   构建时的 chunk（`app.js` / `workspace.js` / `code-preview.js` …），
   `app.js` 单个文件就有 6.8 万行。原因与拆分路径见
   [docs/architecture.md](./docs/architecture.md) 的「渲染层现状」一节。

---

## 快速开始

```bash
npm install

# 开发模式（渲染层热更新）
npm run dev

# 构建
npm run build

# 运行构建产物
npm start
```

### 开发模式需要的环境变量

主进程按 `process.env` 定位资源与配置目录，未打包运行时需要显式指定：

| 变量 | 说明 |
| --- | --- |
| `ZEROWORK_CONFIG_DIR` | 配置目录（默认 `~/.zerowork`）。建议开发时指向临时目录，避免污染真实配置 |
| `ZEROWORK_RESOURCES_DIR` | 资源目录（scenes / modes / styles / skills 等）。默认取自打包环境 |

```bash
ZEROWORK_CONFIG_DIR=/tmp/zerowork-dev \
ZEROWORK_RESOURCES_DIR=$PWD/resources \
npm start
```

> 这三个环境变量前缀与产品名一致（`ZeroWork` → `ZEROWORK_`），沿用这个约定即可。

## 目录结构

```
src/
  main/                       主进程
    index.js                  应用入口：窗口、菜单、IPC 注册、CSP
    daemon/                   Agent 内核守护进程（独立 utility process）
      index.js                入口：模块装配、IPC 处理、启动流程
      session-host.js         会话宿主（核心运行循环）
      session-view.js         会话视图投影（时间线、diff、文件呈现）
      session-state.js        状态归约、宿主池、上下文用量、会话检索
      session-files.js        会话文件读写、分支、用量统计
      command-exec.js         命令执行与权限闸门
      permission-rules.js     权限判定与危险模式匹配
      runtimes.js             运行时管理（安装、探测、注入、诊断）
      doc-extract.js          文档读取（PDF / Office / docx 转换）
      tool-factories.js       各类工具工厂
      mcp-client.js / mcp.js  MCP 客户端与配置解析
      prompt-compose.js       提示词组装
      experts.js / skills.js  专家与技能加载
      …                       共 40 个领域模块，完整清单见 daemon/ 目录
    sandbox/
      index.js                沙箱探测与执行
      prepare-worker.js       沙箱准备 worker
  preload/
    index.js                  contextBridge 暴露的 IPC 面（60+ 通道）
  shared/
    ipc.js                    IPC 通道常量（主进程与 preload 共用）
  renderer/                   渲染层（React SPA）
    index.html
    src/                      渲染层源码（chunk 粒度）
resources/                    运行时资源：场景、模式、专家、技能、样式、提示词
tools/                        开发脚本（daemon 模块图检查等）
tests/
  unit/                       Vitest 单元测试
  e2e/                        Playwright 驱动的 Electron 端到端测试
docs/                         架构与治理文档
```

### 进程架构

```
┌─────────────── Electron 主进程 (src/main) ───────────────┐
│  窗口 / 菜单 / 全局快捷键 / CSP / 文件对话框               │
│  IPC 本地应答（dialog、文件读取等需要 Electron 能力的）    │
└───────────────┬──────────────────────────────────────────┘
                │ utilityProcess fork
┌───────────────▼───────────────┐   ┌──────────────────────┐
│  daemon (src/main/daemon)      │   │ 沙箱 worker           │
│  Agent 会话 / 模型 / MCP /      │   │ (sandbox/)           │
│  自动化 / 审计 / 归档           │   └──────────────────────┘
└───────────────┬───────────────┘
                │ IPC
┌───────────────▼──────────────────────────────────────────┐
│  渲染层 (src/renderer, sandboxed)  ← preload 桥接          │
└──────────────────────────────────────────────────────────┘
```

daemon 单独一个进程的理由：Agent 要 `await import` 整个 pi SDK，
初始化慢且可能崩溃；隔离开才不会拖垮界面。

启动时有个**已知竞态**值得留意：daemon 的 ready 推送与渲染进程注册监听器谁先完成
取决于机器。若推送早于监听器注册就会永久丢失，界面卡在「正在启动」。
`INVOKE.daemonStatus` 就是为消除这个竞态存在的——渲染进程挂载后主动查一次。
详见 `src/preload/index.js` 中该通道的注释。

## 测试

共 387 项断言，分二十二层：

```bash
npm run test              # ① 单元测试（Vitest）111 项
npm run test:gui:smoke    # ② 启动健康度：窗口、样式、daemon、IPC（17 项）
npm run test:gui:sections # ③ 分区域：逐个导航七个功能区（14 项）
npm run test:gui:settings # ④ 设置页：逐个打开九个设置分组（22 项）
npm run test:gui:ipc      # ⑤ IPC 功能性：逐个驱动桥接方法（63 项）
npm run test:gui:bridge   # ⑥ 桥接面补测：此前未被驱动过的 IPC 方法（28 项）
npm run test:gui:state    # ⑦ 本地状态读写：设置 / 工作区 / 自动化 / 审计（29 项）
npm run test:gui:dialog   # ⑧ 对话框与原生模块降级（9 项）
npm run test:gui:widget   # ⑨ 可视化卡片渲染（6 项，用 mock 模型）
npm run test:gui:artifact # ⑩ 产物交付：present_files → 界面卡片（6 项，用 mock 模型）
npm run test:gui:subagent # ⑪ 子代理委派：task → 隔离子会话 → 结果回传（6 项，用 mock 模型）
npm run test:gui:team     # ⑫ Agent 团队：建团 → 成员独立会话 → 产出回收（10 项，用 mock 模型）
npm run test:gui:preview  # ⑬ 文件预览：xlsx / pptx / js / json 渲染 + 样式生效（7 项）
npm run test:gui:model    # ⑭ 主链路：**在界面上打字发送** → 模型 → 回复渲染出来（11 项）
npm run test:gui:loop     # ⑮ Agent 循环：工具调用 → 执行 → 回传（6 项）
npm run test:gui:real     # ⑯ 真实端点对话（4 项，需本机有可用端点）
npm run test:gui:doc      # ⑰ 文档解析：真实模型读 PDF/DOCX（4 项，需端点）
npm run test:gui:docx     # ⑱ docx 引擎往返 + 运行时安装（9 项）
npm run test:gui:skill    # ⑲ 技能调用与 MCP 连接器（10 项，需端点）
npm run test:gui:cmd      # ⑳ 命令执行链路：权限门 → 沙箱/降级 → 输出回传（5 项，需端点）
npm run test:gui:auto     # ㉑ 定时任务执行：入队 → 起会话 → 跑提示词 → 落记录（4 项，需端点）
npm run test:gui:branch   # ㉒ 会话分支：从历史某条消息分叉出新会话（6 项，需端点）
npm run test:gui          # ②–⑬ 一起跑（不依赖真实模型）
npm run test:e2e          # ②–㉒ 全部端到端
npm run test:all          # lint + typecheck + 单元 + test:gui
```

各层各管一件事，缺一不可：

| 层次 | 回答的问题 |
| --- | --- |
| 单元 | 纯逻辑对不对（IPC 契约、模块依赖图、自有 agent 工具、**权限判定规则**、**定时任务的时间计算**） |
| 启动健康度 | 应用能不能起来、daemon 活没活、样式加载没有 |
| 分区域 | 顶层七个功能区能不能渲染出来 |
| 设置页分组 | **设置对话框里九个分组逐个点开，面板有没有内容** |
| IPC 功能性 | **每个具体功能能不能用** |
| 桥接面补测 | **那些没人调过的通道，调一下答什么**（挂起、静默成功、含糊报错都在这里露出来） |
| 本地状态读写 | **设置项写进去读得回来吗、任务 CRUD 真的落盘了吗** |
| 对话框/降级 | **用户取消对话框会怎样、缺原生模块会不会崩** |
| 可视化渲染 | **卡片到底画出来没有**（工具返回对了但渲染层没接上，用户看到的是空白） |
| 产物交付 | **任务收尾那一环：成果文件交付后，界面上有没有那张卡** |
| 子代理委派 | **委派是真的起了隔离子会话、并且把结果并回来了，还是只发了个工具调用** |
| 主链路 | **在界面上打字发送，模型真的回话了吗、回复真的画出来了吗** |
| Agent 循环 | **模型要求执行工具时，agent 真的执行并回传了没有** |
| 真实端点 | **协议对接对不对**（鉴权头格式、流式事件类型、token 计数） |
| 文档解析 | **PDF / DOCX 提取链路通了没有** |
| docx/运行时 | **格式转换往返对不对、运行时跨平台装得上装不上**（引擎往返为确定性验证，不依赖模型） |
| 技能/MCP | **技能正文注没注入、MCP 工具调不调得动、有没有被静默放行** |
| 命令执行 | **命令真的跑起来了吗、缺沙箱时会不会静默无约束执行** |
| 定时任务执行 | **到点真的把任务跑起来了吗、运行记录落盘没有** |
| 会话分支 | **真能从历史中间分叉出新会话吗、母会话会不会被改坏** |

第四层最难被替代：通道名拼错、daemon 侧 handler 未注册、返回结构变了，
**界面可能照常渲染**（数据区空白或停在加载态），只有真正调用才会暴露。

第五层补上了此前唯一的空白 —— 常规做法下它需要真实 API Key。
应用支持自定义 provider（`baseUrl` 可配），所以在本地起一个 OpenAI 兼容的
mock 服务即可把整条链路串起来：`window.kami.prompt()` → preload → daemon →
pi agent harness → HTTP → mock 服务 SSE 流式回包 → 会话状态。

```bash
npm run test:gui:model
```

### 技能调用与 MCP 连接器

```bash
npm run test:gui:skill
```

这两块此前一行都没测过，而它们都不属于「环境做不到」：

- **技能调用**：`/skill:<name>` 的展开发生在 daemon 的 **prompt 入口**。
  测试要求模型回报技能正文里的**第一个标题** —— 只有「解析技能 → 读文件 →
  剥 frontmatter → 注入提示词 → 模型收到」整条链路都在，它才答得出来。
- **MCP 连接器**：起一个最小 stdio MCP server（`tests/e2e/mock-mcp-server.mjs`，
  手写四个方法，不引官方 SDK —— 引了会分不清是谁的锅），注册进应用，
  断言连接建立、工具被识别、模型能调用并拿到结果、以及**权限请求确实发出**。

最后一条是安全断言而非功能断言：MCP 工具的权限判定是 `ask`
（等同「执行用户配置的任意命令」），若权限请求数为 0，说明审批链路被绕过了。

#### 一个容易踩的时序坑（本测试的注释里也记了）

MCP 客户端是**按会话桶**建的，连接发生在**会话构造期** —— 扩展工厂在
`resourceLoader.reload()` 里被 `await` 跑完，连完才求值 `extraActiveTools()`，
所以「连接完成」与「工具名进白名单」的顺序在构造内部就保证了。

但桶里**还没构造过会话**时，`mcpConfigGet` 取不到活句柄，只能按配置
**合成**一个 `connecting` 占位。那个 `"connecting"` 不是「正在连」，
而是「还没开始连」—— 轮询它等 `connected` 会一直等下去。

正确的做法是**直接发消息**：发消息才会构造会话。这条坑曾让两个用例长时间失败。

### 本地状态读写（不需要模型）

```bash
npm run test:gui:state
```

这一层补的是 IPC 通道里此前**完全没被驱动过**的一大片，它们有个共同点：
不依赖模型、不依赖网络，纯粹是「界面写进去 → 落盘 → 读回来」——
恰好是用户天天在设置页里点的那些开关，没有任何理由不测。

覆盖：设置往返（风格、推理强度、记忆开关与正文、用户画像、个性化、权限、
Agent 团队、默认工作区路径、Web 搜索）、工作区创建与显示名校验、
会话列表与补全项、用量统计与运行台账、审计的列表/导出/清空、
定时任务 CRUD 与非法入参拒绝、技能开关往返、`statPath` 三种结果。

断言取向是**往返优先**：「调用了不报错」证明不了任何事 ——
通道名拼对但 handler 是个空函数，照样不报错。所以设置类一律
「读当前值 → 写新值 → 读回来断言变了 → 还原 → 断言变回去」。

写这个测试时踩到的三条**产品真实语义**（都不是 bug，但和直觉相反，
所以都写进了断言与注释）：

| 行为 | 直觉 | 实际 |
| --- | --- | --- |
| `auditClear()` | 清空后 0 条 | 剩 **1 条** `audit/cleared` —— 「擦除审计日志」本身必须留痕，否则谁都能悄悄清干净 |
| `removeWorkspace()` | 删掉磁盘目录 | **不删**目录（那是用户真实文件），只把该空间的会话移进回收站并清掉显示名 |
| `statPath()` 传不存在的路径 | 抛错 | 返回 `{ kind: "missing" }` —— 调用方要靠它决定「先读还是先建」 |

### 真实模型测试（可选，需要本机有可用端点）

```bash
npm run test:gui:real
```

mock 只能证明管道不漏，证明不了**协议对接正确** —— 真实端点的鉴权头格式、
流式事件类型、token 计数都可能与 mock 不同。这一层用真实 LLM 验证端到端对话。

凭据处理：**运行时**从 `~/.claude/settings.json` 的 `env` 读取
`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`，
**不进仓库、不打印**。端点不可用时整轮跳过（exit 0），
不会让 CI 因缺少本机环境而失败。

断言里会埋一个唯一标记（如 `ZW608933`）要求模型原样回复，
并校验回复携带真实 token 用量 —— 后者是"确实调用了真实模型"的硬证据。

它断言的是**链路真的通了**（mock 收到请求、请求体含用户消息、携带 Authorization、
回复落到会话状态），不是模型能力。mock 服务在 `tests/e2e/mock-model-server.mjs`，
用 `node:http` 手写无第三方依赖。

### 测试的隔离约定

所有 e2e 测试都会显式设置这两个环境变量，避免污染真实环境：

| 变量 | 作用 |
| --- | --- |
| `ZEROWORK_CONFIG_DIR` | 配置目录（默认 `~/.zerowork`） |
| `ZEROWORK_WORKSPACE_DIR` | 工作区根目录（默认 `~/ZeroWork`） |

⚠️ 只设 `CONFIG_DIR` 是不够的 —— 工作区根目录会落在用户真实家目录下。
创建类测试必须在两者都隔离的环境里跑。

端到端测试会真实启动 Electron、驱动 DOM、断言 daemon 存活与 IPC 应答，
并截图到 `artifacts/`。**不要**只做「能启动不报错」的冒烟——Electron 应用
最常见的故障是「界面看着在，但 IPC 全挂」，只断言文本存在是抓不到的。
测试里包含样式加载断言（无样式时 body 字体是浏览器默认衬线字体），
这类问题肉眼容易忽略。

## 模块图检查

```bash
npm run check:daemon-graph
```

校验 `src/main/daemon/` 的 40 个模块之间 import 是否闭合：相对 import 指向真文件、
具名 import 对得上导出。这层错误构建期抓不到，只会在运行时冷门分支上抛
`ReferenceError`。CI 里有一道同名检查（`daemon-module-graph`）。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 平台支持说明

应用的安装包与**托管运行时规格**是面向 Windows 的。在 macOS / Linux 上：

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 应用本体 / 界面 / IPC | ✅ 可用 | 已在 macOS 验证 |
| 模型对话 / agent 循环 | ✅ 可用 | 真实模型验证过 |
| docx 引擎（Python 实现） | ✅ 可用 | 往返测试通过 |
| PDF / Office 文本提取 | ✅ 可用 | Node 实现 |
| 命令执行 | ⚠️ **受限** | 见下方「关于命令沙箱」——默认档下会被**拒绝执行** |
| 系统文件对话框 | ✅ 可用 | 主进程 stub 验证过处理逻辑 |
| **托管 Node 运行时安装** | ✅ **可用** | 已按 platform-arch 适配，macOS 实测装上并跑通探针 |
| 托管 Bash 运行时 | ➖ **不适用** | Windows 专有产物（PortableGit）。macOS/Linux 自带 bash，已按平台从清单中过滤 |

### 关于命令沙箱（macOS / Linux 上必读）

命令沙箱靠 `koffi` 调 Windows 的 `kernel32` / `advapi32` —— **Windows 专有**。
所以在 macOS / Linux 上 `sandbox.probe()` 必然返回 `available: false`，于是：

| 权限档 | 本机行为 |
| --- | --- |
| `read-only` / `workspace-write`（**含默认档**） | ⚠️ **命令被直接拒绝**，理由是「为避免在没有操作系统写入约束的情况下执行命令」，并给出逃生指引 |
| `danger-full-access` | ✅ 可以执行（不经沙箱、直接 spawn） |

**这是有意的安全设计**：宁可不执行，也不静默地无约束执行 —— 否则「受限档」就成了摆设。
`tests/e2e/command-exec.mjs` 对两侧都做了断言：默认档必须被拦下并留下审计痕迹，
切到完全访问档后命令必须真的跑起来。

> 若要在 macOS / Linux 上正常用命令执行，需要把权限档切到「允许完全访问」，
> 或为该平台实现一个等价的沙箱后端。

### 关于托管运行时

**Node 运行时已跨平台**：`NODE_PLATFORM_SPECS` 按 `process.platform-arch`
取规格，当前支持 `win32-x64` / `darwin-arm64` / `darwin-x64`，各自的产物名、
归档格式、可执行文件路径与两个 sha256 都在表里。新增平台按表内注释补齐即可。

**Bash 运行时只在 Windows 出现**：`GITBASH_ARTIFACT` 是
`PortableGit-...-64-bit.7z.exe` —— Windows 专有产物。macOS/Linux 自带 bash、
不需要托管，因此 `RUNTIME_PLATFORMS` 把它限定为 `["win32"]`，
非 Windows 平台**根本不会出现在运行时清单里**。

（此前不过滤，UI 会在 macOS 上显示「bash 运行时：未安装」并给出安装按钮，
用户点下去会下载一个跑不起来的 .7z.exe —— 属于界面误导。）

> ⚠️ **但这不阻塞功能。** 托管运行时是**可选加速器**：
> `planRuntimeInjection` 对未就绪的运行时给出 `not-ready` 决策并**跳过注入**，
> 脚本照常用系统 PATH 里的工具执行。`tests/e2e/docx-runtime.mjs` 对此有断言。
>
> 沙箱（`koffi` 调 kernel32/advapi32）是真正的 Windows 专有能力，
> 在非 Windows 平台上会降级，不影响其余功能。

**若要继续扩展到 Linux**：在 `NODE_PLATFORM_SPECS` 里补 `linux-x64` /
`linux-arm64` 两项即可 —— 产物名与 `artifactSha` 取自官方 `SHASUMS256.txt`，
`exeSha` 为本地下载解包后实测。解压层已支持 `zip` 与 `tar.gz`；
Linux 发行包是 `tar.xz`，需要再加一个 xz 解码器（Node 无内置）。

## 外部请求与发布前核对

两件事分开看：

- **[EXTERNAL_REQUESTS.md](./EXTERNAL_REQUESTS.md)** —— 逐条列出**运行时会向外部发起的请求**：
  请求到哪个地址、做什么用、由什么触发、能不能关掉。含随包技能发起的请求
  （金融数据、知识库上传、公众号检索、首屏封面图）以及**已移除**的遥测上报器。
- **[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)** —— **发布前必须由权利人确认**的事项：
  许可证选型、版权主体、依赖条款，以及随包内容的授权状态确认清单。

## 许可

**Apache License 2.0**，见 [LICENSE](./LICENSE)。

> ⚠️ **权利人请确认这一项。**
>
> 选择哪个许可证是权利人的法律决定。这里的
> Apache-2.0 是**基于以下理由给出的默认值**：
>
> - 本项目源自企业产品，Apache-2.0 含**明确的专利授权条款**（第 3 节），
>   下游企业采用时的法务顾虑最小；
> - 相比 MIT 多一层专利保护，相比 AGPL 对下游更友好。
>
> **发布前请确认三件事：**
>
> 1. 确认 Apache-2.0 是你们想要的许可证，不是的话直接替换 `LICENSE` 文件
>    与 `package.json` 的 `license` 字段（MIT / AGPL-3.0 都是常见选择）
> 2. 确认 `LICENSE` 末尾的版权署名 —— 当前写的是
>    `Copyright 2026 zerowork contributors`，应替换为**真实的版权主体**
> 3. 核对第三方依赖的许可条款：本项目依赖
>    `@earendil-works/pi-coding-agent` 等包，它们的条款会对再分发构成
>    额外约束。运行 `npx license-checker --summary` 可查看汇总
>
> 在这些确认完成前，请勿假设任何使用授权。
