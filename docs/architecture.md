# 架构说明

## 进程模型

```
┌──────────────────────── Electron 主进程 (src/main/index.js) ────────────────────────┐
│                                                                                      │
│  createWindow()          主窗口（sandbox 渲染层）                                     │
│  installCsp()            按 dev/prod 下发 CSP                                        │
│  registerIpc()           IPC 路由：本地应答 + 转发 daemon                             │
│  startDaemon()           fork Agent 内核（Electron utilityProcess）                   │
│  setupGlobalShortcut()   全局快捷键（默认 Shift+Alt+W）                                │
│  appMenuTemplate()       应用菜单（macOS 走原生菜单栏）                                │
│                                                                                      │
└──────────────┬──────────────────────────────────────────┬────────────────────────────┘
               │ utilityProcess.fork                       │ ipcMain / ipcRenderer
┌──────────────▼───────────────────────┐   ┌──────────────▼──────────────────────────┐
│  daemon (src/main/daemon/index.js)    │   │  preload (src/preload/index.js)          │
│                                       │   │  contextBridge 暴露 60+ IPC 通道          │
│  · 会话生命周期与事件流                │   └──────────────┬──────────────────────────┘
│  · 模型目录与供应商凭据                │                  │
│  · MCP 连接器管理                     │   ┌──────────────▼──────────────────────────┐
│  · 自动化任务调度                     │   │  renderer (src/renderer, sandboxed)      │
│  · 会话归档 / 审计日志 / 运行账本      │   │  React 19 SPA                            │
│  · 沙箱调度（probe / start / run）     │   └─────────────────────────────────────────┘
│  · 资源加载（agents / skills / modes） │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  sandbox worker (sandbox/index.js)    │
│  · 沙箱能力探测 (probeSandbox)         │
│  · 沙箱化执行 (startSandboxed / run)   │
│  · 失败分类 (classifyFailure)          │
└──────────────────────────────────────┘
```

### 为什么 daemon 是独立进程

Agent 内核需要 `await import` 整个 pi SDK，初始化耗时长，且作为执行不可信内容的
组件有崩溃风险。放进 utilityProcess 隔离：崩了不会带走界面，慢启动不会卡住窗口。

### daemon 启动竞态

daemon 就绪后向渲染层推送 `daemon:ready`。但**推送可能在渲染进程注册监听器之前
就发生**——双方完成时间取决于机器，谁快谁慢不确定。一旦推送早于监听器注册，
事件永久丢失，界面会卡在「正在启动」且无法恢复。

解法是 `INVOKE.daemonStatus`：渲染进程挂载后主动查询一次当前状态，
不依赖推送。这是个**必须保留**的通道，删掉会重新引入竞态。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `src/main/index.js` | 应用入口：窗口、菜单、快捷键、CSP、IPC 注册、daemon 拉起 |
| `src/main/daemon/` | Agent 内核，40 个领域模块（见下） |
| `src/main/sandbox/` | 沙箱探测与执行，独立 worker |
| `src/preload/index.js` | contextBridge 桥接层，定义渲染层可见的 IPC 面 |
| `src/shared/ipc.js` | IPC 通道常量与文档类型判定，主进程与 preload 共用 |
| `src/renderer/src/` | React SPA（chunk 粒度，见「渲染层现状」） |
| `resources/` | 运行时内容资源：场景、模式、专家、技能、样式、提示词、可视化规范 |
| `tools/` | 开发脚本（daemon 模块图检查等） |

### daemon 模块划分

daemon 共 19,467 行，按领域拆为 40 个模块。主要模块：

| 模块 | 职责 |
| --- | --- |
| `index.js` | 入口：模块装配、IPC 处理、启动流程 |
| `session-host.js` | 会话宿主：核心运行循环 |
| `session-view.js` | 会话视图投影：时间线、diff、文件呈现、对话条目 |
| `session-state.js` | 状态归约、宿主池、上下文用量、会话检索 |
| `session-files.js` | 会话文件读写、分支、用量统计、自动化调度 |
| `command-exec.js` | 命令执行、权限闸门、危险模式匹配 |
| `permission-rules.js` | 命令与路径的权限判定 |
| `runtimes.js` | 运行时管理：安装、探测、环境注入、诊断 |
| `doc-extract.js` | 文档读取：PDF / Office / docx 转换 |
| `tool-factories.js` | 问卷、技能安装、后台任务、待办、可视化等工具工厂 |
| `mcp-client.js` / `mcp.js` | MCP 客户端连接与配置解析 |
| `prompt-compose.js` | 提示词组装：隐藏上下文、专家人设、风格、片段 |
| `prompt-templates.js` | 提示词模板与会话级模板列表 |
| `experts.js` / `skills.js` | 专家 / Agent / 技能的加载、导入、成本估算 |
| `ledger.js` | 运行账本（RunLedger） |
| `observability.js` | token 估算、缓存命中、会话统计 |
| `automation.js` / `automation-tools.js` | 自动化任务存储、调度与工具 |
| `audit.js` / `event-log.js` | 审计日志与事件日志 |
| `teams.js` / `mailbox.js` / `subagent.js` | 团队、会话邮箱、子 agent |
| `git-worktree.js` / `workspace.js` | Git worktree 与工作区管理 |
| `models.js` / `model-catalog.js` / `auth.js` | 模型、目录、凭据 |
| `config-paths.js` / `preferences.js` / `permissions.js` | 路径、偏好、权限预设 |
| `memory.js` / `schedule.js` / `archive.js` | 记忆系统、调度、归档 |
| `web-tools.js` / `preview-server.js` | 联网工具、预览服务 |

⚠️ **改动 daemon 时请留意跨模块的初始化期依赖**。40 个模块的顶层求值顺序
由 import 图决定；在顶层引入新的跨模块引用可能触发 TDZ 错误
（`Cannot access 'x' before initialization`）。

## 渲染层现状

**当前状态：chunk 粒度，不是组件粒度。**

`src/renderer/src/` 下的 30 个文件对应构建时的 chunk
（`app.js` / `workspace.js` / `code-preview.js` …），不是逐组件的源文件。
`app.js` 单个文件就有 68,152 行、1,724 个顶层声明（含 React 及其它内联库）。

### 为什么不拆到组件级

渲染层与 daemon 的情况不同：daemon 是应用自身逻辑，领域边界清晰；
渲染层这一个 chunk 里混了 React 运行时、各类第三方库和应用组件，
1724 个顶层声明构成一个连通块。自动区分「哪些是第三方库、哪些是应用代码、
哪些是组件」需要语义判断，无法靠工具可靠完成。**强行自动拆分会产出既不可读
也不可靠的模块划分，不如保持现状并说清限制。**

要拆到组件级，需要人工判断组件边界。已知的模块切分线索：

| 模块 | 作用 |
| --- | --- |
| `lib-chat-ui` | 对话 UI 组件库（`.cr-input-footer-item` 等 `cr-` 前缀类名） |
| `home` | 首页 |
| `ui-docs-viewer` | 文档查看器 |
| `safe-delete-events` | 安全删除事件处理 |

`app.css` 的注释引用这些模块里的类名来交代取值来由 —— 类名本身都还在
`app.css` 里，可直接搜索核对。

## 资源系统

`resources/` 下的内容是产品可配置性的来源，daemon 启动时加载：

| 目录 | 内容 |
| --- | --- |
| `scenes/` | 场景（代码开发 / 日常办公 …） |
| `modes/` | 交互模式（问答 / 创作 / 规划）。含 `tools` 白名单 |
| `experts/` | 专家角色，每个含技能与 agent 定义 |
| `skills/` | 技能（docx、前端设计、会议纪要…） |
| `agents/` | Agent 定义（planner / reviewer / scout / worker） |
| `styles/` | 回答风格 |
| `prompts/` | 提示词片段与语言、记忆系统提示 |
| `visualizer/` | 可视化规范（图表、配色、图表类型） |
| `welcome/` | 首屏案例与快捷入口 |
| `runtimes/` | 运行时（gitbash 等） |
| `plugins/` | 插件市场内容 |
| `bin/` | 随包分发的工具二进制（rg、fd、uv） |
| `docx-engine/` | 文档转换引擎（Python） |

资源目录通过 `ZEROWORK_RESOURCES_DIR` 环境变量可覆盖，
这使得把资源目录指向仓库外成为可能（开发模式依赖此项）。

## 沙箱与权限

两层控制：

1. **权限预设**（`PERMISSION_PRESETS` / `APPROVAL_POLICIES`）
   ——决定某些操作是否需要用户确认
2. **沙箱模式**（`SANDBOX_MODES`）——决定命令在何种隔离环境执行

沙箱能力在启动时探测（`probeSandbox`），探测失败会被分类
（`classifyFailure`）并降级，而不是让整个 daemon 挂掉。

审计日志记录四类事件：`command`、`sandbox`、`runtime`、`audit`。

## 类型检查

**当前状态：`checkJs` 关闭。**

原因：应用主体以 JS 提供，没有编译期类型信息。
只有 `typebox` 这一个**运行时**类型库（用于工具参数校验）。
直接开启 `checkJs` 会产生数以万计的 `noImplicitAny` 报错——这些报错
反映的是「类型还没补」，不是「代码有问题」，开着只会淹没真正的问题。

**渐进补类型的路径：**

1. 从 `src/shared/` 开始（体量小、被依赖广、契约价值最高）
2. 补完一个目录，就把对应路径从 `tsconfig.json` 的 `exclude` 里移出
3. 工具函数与纯逻辑优先（易验证），React 组件次之
4. 补到报错量可控时，开启 `checkJs` 并在 CI 中固化

**这个限制无法绕过**：编译期类型信息没有随代码保留下来，只能靠人补。
