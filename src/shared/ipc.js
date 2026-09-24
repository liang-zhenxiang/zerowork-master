const PDF_EXTENSION = ".pdf";
const OFFICE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".odp",
  ".ods"
]);
const LEGACY_DOC_EXTENSIONS = /* @__PURE__ */ new Set([".doc", ".xls", ".ppt"]);
function extensionOf(path) {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}
function docKindOf(path) {
  const ext = extensionOf(path);
  if (ext === PDF_EXTENSION) return "pdf";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (LEGACY_DOC_EXTENSIONS.has(ext)) return "legacy";
  return "unsupported";
}
const INVOKE = {
  /**
   * 查询 daemon 当前是否就绪。由 main 本地应答，不转发。
   *
   * 存在的必要性：daemon 的 ready 推送与渲染进程注册监听器之间存在竞态
   * （daemon 要 await import 整个 pi SDK，渲染进程要加载自己的 bundle，
   * 谁先完成取决于机器）。若推送早于监听器注册就会永久丢失，
   * 界面卡在"正在启动"且无法恢复。渲染进程挂载后主动查一次即可消除竞态。
   */
  daemonStatus: "daemon:status",
  /**
   * 拉取完整会话状态。渲染进程挂载、或 HMR 之后调用。
   * sessionId 缺省 = 当前活动会话（保持既有调用方语义）；
   * 指定 id 时拉取对应会话的快照——多任务并发后 renderer 按 id 缓存
   * 各会话视图，后台会话的现场恢复/兜底重拉走这里。
   */
  snapshot: "session:snapshot",
  /** 发送一条用户消息。 */
  prompt: "session:prompt",
  /** 中断当前 run。 */
  abort: "session:abort",
  /**
   * 当前会话最近一次注入的 hidden context 全文（任务诊断面板的展示口）。
   * 还没跑过任何一轮为 undefined —— 注入块按 run 冻结，这里是展示语义
   * （agent_end 不清，run 结束后仍可看）。
   */
  hiddenContext: "session:hidden-context",
  /**
   * 重排 steer / followUp 等待队列（排队 chips 的删除/编辑底层动作）。
   * 传入的就是**重排后**的完整队列 —— daemon 清空后按序重入队。
   */
  queueRewrite: "session:queue-rewrite",
  /** 新建任务：作废旧会话、开全新会话。 */
  newTask: "session:new-task",
  /**
   * 拉取输入框补全数据源：`@` 的文件列表（当前工作空间内）与 `/` 的命令列表。
   * 返回相对路径/命令名，renderer 自己做过滤与下拉。
   */
  completions: "session:completions",
  /**
   * 弹出系统文件选择框（图片 + 文档多选，filters 分「所有支持的文件/图片/文档」三组），
   * 返回 PickedInputFiles：图片读出内容编码成 ImagePart，文档只回路径不读内容
   * （内容读取是 read_document 工具的职责，模型按需读、有截断与续读；
   * 在这里预读会把整份大文档一次性挤进首条消息）。
   * 由 main 本地应答（dialog 与文件读取都要 Electron/Node 能力），
   * 用户取消返回 undefined。main 读图片的理由：渲染进程是沙箱 web 环境，
   * 拿不到任意路径的字节；与其开两条通道不如在 dialog 应答里一并完成。
   */
  pickInputFiles: "session:pick-input-files",
  /** 切换场景（work / code / design）。对应 welcomemode 轴。 */
  setScene: "session:set-scene",
  /** 切换交互模式（ask / craft / plan）。对应 interactionmode 轴。 */
  setInteraction: "session:set-interaction",
  /**
   * 选择专家（绑定人格）或清除专家（undefined）。
   *
   * 专家是与交互模式**正交**的会话绑定（spec: rework-expert-orthogonal-and-skills）：
   * 本通道只读写 expertId，不改交互模式；setInteraction 也不清 expertId。
   */
  setExpert: "session:set-expert",
  /**
   * 专家列表（模式菜单「专家 ▸」子菜单、对话头部与起手 chips 的展示数据源）。
   * 只带展示字段 —— 人格正文不经 IPC，compose 时 daemon 从专家库自取。
   */
  listExperts: "session:list-experts",
  /** 团队任务板投影（只读，spec: add-team-ux-parity 批次 ③）：Ctrl+T 面板的数据源。 */
  getTeamTasks: "session:get-team-tasks",
  /** 切换模型。 */
  setModel: "session:set-model",
  /**
   * 切换当前会话的推理强度。pi 恒 clamp 到模型可用档位（不抛错），
   * 生效档位随下一条 session_state 下发（renderer 不本地乐观改）。
   * 逐会话持久化与 resume 还原由 pi 负责（thinking_level_change 条目）。
   */
  setThinkingLevel: "session:set-thinking-level",
  /**
   * 历史会话列表（全部工作目录，含临时任务）。
   * title / isTempTask 等展示字段由 daemon 组装好，UI 不再推导。
   */
  sessionList: "session:list",
  /**
   * 恢复指定历史会话为当前活动会话。path 来自 SessionSummary.path，
   * daemon 侧有路径守卫（限会话目录内的 .jsonl，防 ../ 穿越）。
   */
  sessionResume: "session:resume",
  /** 归档 / 取消归档会话（archive.json 索引，会话文件不动；详见 InvokeMap）。 */
  sessionArchive: "session:archive",
  /** 重命名会话（写入 pi 的 session_info 条目）。path 定位，name 为新名。 */
  sessionRename: "session:rename",
  /**
   * 「重新开始」：把会话回退到锚点消息**之前**并继续，被放弃的后续
   * （若确有内容）抽成一条新会话留在侧栏，不丢东西。
   * 锚点用**用户消息序号（0 基）**而非条目 id：在线路径下渲染层的 user 消息
   * id 是 session-host 自己造的，与落盘条目 id 不一致，daemon 侧按序号
   * 用 `getUserMessagesForForking()` 解析真实条目 id（spec「实测修订」）。
   */
  sessionRestart: "session:restart",
  /**
   * 「分支出新会话」：从锚点消息（同样是用户消息序号）之前派生一条新会话，
   * 母会话原样不动（对比 sessionRestart 的「就地回退 + 抽枝」）。
   */
  sessionBranch: "session:branch",
  /** 删除会话文件。当前活动会话由 daemon 拒删（需先新建任务）。 */
  sessionDelete: "session:delete",
  /**
   * 把当前会话导出为单文件 HTML（pi 的 AgentSession.exportToHtml）。
   * path 来自 SessionSummary.path 定位会话；产物落在默认根 exports/ 下，
   * 返回导出文件的绝对路径。
   */
  sessionExport: "session:export",
  /** 拉取当前工作空间与可选列表（默认根 + 已有子目录）。 */
  workspaceSnapshot: "workspace:snapshot",
  /** 在默认根下新建工作空间并切换过去。返回生效的目录路径。 */
  createWorkspace: "workspace:create",
  /**
   * 切换到指定目录。目录经 daemon 校验（配置目录/应用目录会拒）。返回生效的目录路径。
   * 传空字符串表示临时任务待分配（不选命名空间，不建目录，首次执行才分配独立时间戳目录）。
   */
  setWorkspace: "workspace:set",
  /**
   * 弹出系统目录选择框。由 main 本地应答（要用 Electron dialog）。
   * 用户取消返回 undefined。
   */
  pickWorkspaceDirectory: "workspace:pick-directory",
  /**
   * 列某个目录的本地分支（含是否 git 仓库的一次性判定）。
   * 代码场景的 worktree 芯片用它填基准分支下拉；非 git 仓库时
   * isGitRepo=false 而**不是**报错 —— 用户选个普通文件夹是正常情形。
   */
  worktreeBranches: "worktree:branches",
  /**
   * 设置「下一次新建任务在哪个基准分支上建 worktree 副本」；undefined = 关闭。
   *
   * 与 workspace:set 同语义：只改**后续新建任务**的落点，既有会话原地不动
   *（副本一经创建就与会话终身绑定，换分支不是「改偏好」而是「换工作副本」，
   * 那需要重建会话，属另一件事）。新建任务时该意图被重置（对齐
   * newTask 重置工作空间选择的口径）。
   */
  setWorktreeBranch: "worktree:set-branch",
  /**
   * 空间分组元数据列表：侧栏「空间」区的组头信息。
   * 组集合由 daemon 从会话文件的 cwd 去重派生，这里只额外携带显示名覆盖。
   */
  workspaceGroups: "workspace:groups",
  /**
   * 重命名空间组。只写显示名覆盖（workspaces.json），不动真实目录——
   * 真实目录可能有会话/进程占用，改名会引发路径失效；显示名覆盖零风险。
   * 名称经 daemon 校验（validateDisplayName），非法时 reject 原因。
   */
  workspaceRename: "workspace:rename",
  /**
   * 从列表移除空间组：该 cwd 下全部会话文件移入回收目录（trash），
   * 同时清掉显示名覆盖。不删真实目录本身。
   */
  workspaceRemove: "workspace:remove",
  /**
   * 在系统文件管理器中打开空间目录（main 侧 shell.openPath）。
   *
   * 路径必须在 daemon 侧校验「是已知工作空间」后才能放行：
   * renderer 是半可信环境，若不校验，任意网页/XSS 都能让 main 对
   * 任意路径调 shell.openPath（弹 ~\.ssh、系统目录等）。校验放 daemon
   * 而不是 main，是因为「已知工作空间」的知识只在 daemon（会话文件集合）。
   */
  workspaceReveal: "workspace:reveal",
  /** 应答 daemon 发来的 UI 请求（确认框/选择框/输入框）。 */
  uiResponse: "ui:response",
  /** 应答权限审批。 */
  permissionResponse: "permission:response",
  /** 应答结构化提问（questionnaire 工具的问卷卡）。 */
  questionnaireResponse: "questionnaire:response",
  /** 在系统默认程序里打开产物文件。 */
  openArtifact: "artifact:open",
  /**
   * 弹出应用菜单的某一项（自绘标题栏用，§4.32 修正）。
   *
   * 为什么不让渲染层自己画下拉：菜单项与 role（撤销/复制/粘贴/最小化…）都在原生
   * `Menu` 里，重画一份等于把同一套命令实现两遍，而 macOS 的快捷键本就依赖原生菜单。
   * 渲染层只画三个**标签**，内容交给 `Menu.popup()`。
   */
  menuPopup: "app:menu-popup",
  /** 另存为。返回用户选择的路径，取消则返回 undefined。 */
  saveArtifactAs: "artifact:save-as",
  /**
   * 读产物文件内容（预览面板用）。路径限当前工作区内，
   * 返回大小与文本（二进制/超大不给文本）。
   */
  readArtifact: "artifact:read",
  /**
   * 路径存在性探测（对话正文行内 code 的路径徽章用）。
   * 只报存在性与文件/目录类型，不报内容，故不受 readArtifact 的工作区边界限制。
   */
  statPath: "artifact:stat",
  /**
   * 查询指定 cwd 的产物预览服务 base URL（http://127.0.0.1:端口，根=该目录）。
   *
   * PreviewServer 按 cwd 多实例（每 cwd 一个端口，懒建），renderer 按
   * 当前会话的 cwd 查询——不同 cwd 的会话预览互不影响。
   * 该 cwd 的服务未启动时返回 undefined：面板显示引导文案即可，不视为错误。
   * 形状在此钉死，daemon 多根实现（Task 2.7）与 renderer 取用（Task 3.4）并行不漂移。
   */
  previewBaseUrl: "preview:base-url",
  /* ── 设置 ─────────────────────────────────────────────────────── */
  /** 拉取服务商与模型列表。打开设置页时调用。 */
  settingsSnapshot: "settings:snapshot",
  /**
   * 存入某家服务商的 API Key。
   *
   * 密钥经 renderer → main → daemon 传递，最终由 pi 写进 auth.json（0600）。
   * main 是哑转发器、daemon 的请求日志只记通道名不记参数 —— 密钥不会落到任何日志里。
   */
  setApiKey: "settings:set-api-key",
  /** 删除某家服务商的 API Key（仅能删 auth.json 里的，环境变量删不掉）。 */
  removeApiKey: "settings:remove-api-key",
  /** 新增或更新自定义服务商。 */
  saveCustomProvider: "settings:save-custom-provider",
  /** 删除自定义服务商，连带清掉其凭据。 */
  deleteCustomProvider: "settings:delete-custom-provider",
  /** 读回自定义服务商配置，供编辑表单回填。 */
  readCustomProvider: "settings:read-custom-provider",
  /**
   * 往预置（内置）服务商追加/替换单个模型（「添加模型」弹层选预置的路径，
   * spec: rework-settings-layout）：落 models.json 但不写 baseUrl/api、不打
   * 归属标记（core/custom-providers.ts upsertProviderModel 的三点硬差异）。
   */
  addProviderModel: "settings:add-provider-model",
  /** 联网刷新模型目录。启动时不联网，只在用户主动点击时调。 */
  refreshCatalog: "settings:refresh-catalog",
  /**
   * 测试某个模型的连通性（设置-模型页卡片上的「测试」按钮）：
   * 发一个最小非流式请求，回答网络通不通 / Key 认不认 / 模型在不在。
   */
  testModel: "settings:test-model",
  /**
   * 测试**表单里还没保存**的服务商配置（自定义服务商表单右下角的「测试」按钮）。
   *
   * 与 testModel 的区别：那条从**已保存的目录**里解析模型，表单里刚填的
   * baseUrl / 模型 id 在保存前不在目录里 —— 用 testModel 一律报
   * 「目录里找不到该模型」。这条直接拿表单的当前值构造探测，所以用户能
   * 「填完就试」，不必先存一遍再回来改。
   */
  testDraftModel: "settings:test-draft-model",
  /** 读回联网搜索配置（不含 key，只给 provider + 是否已配）。 */
  getWebSearchConfig: "settings:get-web-search-config",
  /** 保存联网搜索配置（服务商 + API Key，Key 落偏好文件）。 */
  setWebSearchConfig: "settings:set-web-search-config",
  /** 清除联网搜索配置。 */
  clearWebSearchConfig: "settings:clear-web-search-config",
  /** 测试联网搜索：用已存的配置真实搜索一次，返回可展示的结果。 */
  testWebSearch: "settings:test-web-search",
  /**
   * 读默认存储路径。effective 为生效根（env ZEROWORK_WORKSPACE_DIR > 设置项 > 内置默认
   * ~/ZeroWork，逐级回落）；custom 为用户设置项
   * （未设置时为 undefined）；isDefault 标记 effective 是否就是内置默认。
   */
  getDefaultWorkspacePath: "settings:get-default-workspace-path",
  /**
   * 设置默认存储路径。传空字符串 = 还原内置默认（清除设置项）。
   * 只影响之后新建的任务与工作空间，已有会话 cwd 不变
   * （修改后不影响已有数据）。
   */
  setDefaultWorkspacePath: "settings:set-default-workspace-path",
  /* ── 推理强度（全局默认） ─────────────────────────────────────────── */
  /** 读全局默认推理强度。未配置时 daemon 回 "medium"（与 pi 内置默认一致）。 */
  getThinkingLevelDefault: "settings:get-thinking-level-default",
  /** 写全局默认推理强度。只影响之后新建的会话，既有会话不回溯。 */
  setThinkingLevelDefault: "settings:set-thinking-level-default",
  /* ── 回复风格 ─────────────────────────────────────────────────── */
  /** 读回复风格配置（全部可选项 + 当前值）。未配置时 daemon 回默认风格 professional。 */
  getStyle: "settings:get-style",
  /** 写回复风格。传空串 = 关闭风格注入；只影响之后的新 run，不回溯既有会话。 */
  setStyle: "settings:set-style",
  /* ── 记忆（spec: add-memory-system） ─────────────────────────── */
  /** 读记忆系统开关。未配置时 daemon 回 true（缺省开启）。 */
  getMemoryEnabled: "settings:get-memory-enabled",
  /** 写记忆系统开关；daemon 同时把内置「记忆整理」任务的启停对齐过来。 */
  setMemoryEnabled: "settings:set-memory-enabled",
  /* ── 团队协作开关（spec: add-team-foundations 批 5） ───────────── */
  /** 读团队协作开关。未配置时 daemon 回 false（缺省关闭，实验特性）。 */
  getAgentTeamsEnabled: "settings:get-agent-teams-enabled",
  /** 写团队协作开关。只影响之后新建的会话（工具注册发生在会话建立时）。 */
  setAgentTeamsEnabled: "settings:set-agent-teams-enabled",
  /* ── 团队成员会话操作（spec: add-team-foundations 批 8） ───────── */
  /** 向成员会话投一条消息（followUp 语义：idle 唤醒 / running 排队）。 */
  memberPrompt: "team:member-prompt",
  /** 中止成员当前轮（聚焦成员视图的停止键）。 */
  memberAbort: "team:member-abort",
  /** 读用户画像全文（PROFILE.md）。文件不存在回空串 —— 新用户本来就没有画像，不是错误。 */
  getProfile: "settings:get-profile",
  /** 覆盖写用户画像全文。下一轮对话生效（画像在 compose 时现读）。 */
  setProfile: "settings:set-profile",
  /** 清空用户画像（文件内容置空）。内置「记忆整理」任务下一轮蒸馏会重新生成。 */
  resetProfile: "settings:reset-profile",
  /**
   * 画像导入的「选文件 + 读内容」：弹系统文件框选 .md，返回其内容；
   * 取消返回 undefined。由 main 本地应答 —— 系统对话框与任意路径的文件字节
   * 只在 main 可得（同 pickInputFiles 的理由），daemon 不 import electron。
   * 注意不写 PROFILE.md：画像文件的唯一写点是 daemon 的 setProfile，
   * renderer 拿到内容后再调 setProfile 完成导入（两段组合，见设置页）。
   */
  importProfile: "settings:import-profile",
  /* ── 个性化（spec: rework-settings-layout） ──────────────────── */
  /** 读个性化六键（daemon 合并缺省：字符串回空串、两个 boolean `?? true`）。 */
  getPersonalization: "settings:get-personalization",
  /** 部分更新个性化（只动传入的键；字符串 trim 后为空 = 删该键）。 */
  setPersonalization: "settings:set-personalization",
  /** 读长期记忆全文（~/.zerowork/MEMORY.md）。不存在回空串，与 getProfile 同口径。 */
  getMemory: "settings:get-memory",
  /** 覆盖写长期记忆全文。下一轮对话生效（compose 时现读）。 */
  setMemory: "settings:set-memory",
  /* ── 提示词预览 ─────────────────────────────────────────────── */
  /**
   * 现场组装系统提示词供设置页预览：按 {场景, 模式, 风格, 专家} 走
   * composePromptWithMeta 同一条组装路径（不需要活会话），
   * 返回带来源标注的分段与总字数。scene/mode/style/expert 非法即 reject。
   */
  promptPreview: "prompt:preview",
  /* ── 权限 ─────────────────────────────────────────────────────── */
  /** 读回当前权限设置（沙箱模式 + 审批策略 + 强制力）。 */
  getPermissions: "settings:get-permissions",
  /**
   * 保存权限设置。旋钮是权威值，presetId 由 daemon 按旋钮反算，
   * 不信任前端传来的 —— 两者不一致时界面会显示成错误的档位。
   */
  setPermissions: "settings:set-permissions",
  /* ── 技能 ─────────────────────────────────────────────────────── */
  /** 已安装技能清单 + 启停状态 + 清单段成本（独立页面用，不再借道设置快照）。 */
  skillsSnapshot: "skills:snapshot",
  /**
   * 启用 / 停用一个技能（技能页卡片上的开关）。停用是**用户级覆盖**，不改 SKILL.md。
   * 返回**新的完整快照**：列表、已启用数与 token 数字一次到位，页面不必再拉一次。
   */
  setSkillEnabled: "skills:set-enabled",
  /**
   * 导入技能：把含 SKILL.md 的文件夹（或单个 .md）复制进用户技能目录。
   * 返回安装后的技能信息；同名已存在、缺 SKILL.md、frontmatter 不全都会报错。
   */
  importSkill: "skills:import",
  /**
   * 弹出系统目录选择框，供导入流程选技能文件夹。由 main 本地应答
   * （要用 Electron dialog），用户取消返回 undefined。
   */
  pickSkillDirectory: "skills:pick-directory",
  /* ── MCP 连接器 ─────────────────────────────────────────────── */
  /**
   * MCP 配置快照：各 server 的运行态（连接状态 + 工具数）+ 生效层级 mcp.json
   * 的原文（JSONC，供 JSON 编辑器显示）。连接器设置页打开时调用。
   */
  mcpConfigGet: "mcp:config-get",
  /**
   * 整体写入 mcp.json（JSON 编辑器的保存）。daemon 写入前做 schema 校验，
   * 坏了拒写（reject 原因带回），写成功后触发扩展重连。
   * 写入层级：当前会话有工作区写项目级 <工作区>/.mcp.json，临时任务写用户级。
   */
  mcpConfigSet: "mcp:config-set",
  /**
   * 切换单个 server 的启用状态：在定义它的那级 mcp.json 里写 disabled 字段
   * （jsonc-parser 最小编辑，注释与格式保留），写成功后触发扩展重连。
   */
  mcpServerToggle: "mcp:server-toggle",
  /* ── 诊断 ─────────────────────────────────────────────────────── */
  /**
   * 拉取可观测性快照（累计用量、缓存命中率、run 记录、工具统计、上下文成分）。
   * 诊断页打开时调一次，之后随会话事件刷新，不配专用推送通道——
   * 会话事件本身就是「该刷新了」的信号，多开一条通道只是重复投递。
   */
  statsSnapshot: "stats:snapshot",
  /**
   * 拉取跨会话使用统计（spec: add-usage-stats）：全历史会话数/消息数/用量/
   * 连续活跃天数/每日活动与 token/模型与工具排行。统计页的数据源。
   *
   * 与 statsSnapshot 的分工：statsSnapshot 是「本进程 + 台账全历史」的运行侧
   * 聚合（轮次、缓存、时间线），这里读的是**会话文件全历史**的使用侧聚合
   * （含早于台账存在的旧会话）。无参数、无时间范围，
   * 与 `/api/v1/stats` 同口径。
   */
  usageStats: "stats:usage",
  /**
   * 拉取运行台账（run ledger）条目级数据：诊断页「会话时间线」的数据源。
   *
   * 与 statsSnapshot 的分工：快照是进程级聚合（算好的结果），这里是每会话
   * append-only 的原始台账（诊断页自己 fold 成泳道——fold 是渲染的一部分，
   * 口径钉在 renderer/run-timeline.ts）。sessionId 缺省 = 当前活动会话
   * （无活动会话时 daemon 退最新台账文件）；返回同时带全部台账会话 id
   * 列表，会话选择器不用再开一条通道。
   */
  runLedger: "stats:run-ledger",
  /**
   * 查询全局唤起热键的注册状态。由 main 本地应答，不转发 daemon：
   * globalShortcut 是 main 进程的独有状态，daemon 不知道也不该知道
   * （与 daemonStatus 同一条透出路径的理由）。
   */
  globalShortcutStatus: "app:global-shortcut-status",
  /**
   * 查询 docx 引擎 venv 的四态状态（诊断页状态行）。
   * 只探测不安装 —— 诊断页不该有环境副作用；安装是**用户在设置页点「安装/重置」**的事
   *（core/runtimes/python.ts 的 installPythonRuntime；探测与安装/发布都走托管运行时内核）。
   * 转换前的 ensurePythonRuntime 从 2026-09-18 起也只探不装（纯按需，不自动下载）。
   */
  docxEnvStatus: "diagnostics:docx-env-status",
  /* ── 审计中心（spec: add-managed-runtimes 阶段 4） ─────────────── */
  /**
   * 拉取审计记录（拦截/放行留痕：命令安全 / 沙箱 / 运行时三类 + 审计管理动作）。
   *
   * 类别过滤与展示上限都在 daemon 侧的同一条查询里做（core/audit-log.ts 的
   * readAuditRecords），renderer 不再过滤一遍 —— 两处各筛一次就会出现
   * 「面板显示 3 条、导出 5 条」这类对不上。返回同时带过滤后的总数，
   * 面板据此如实说明「只显示了最近 N 条」。
   */
  auditList: "audit:list",
  /**
   * 清空全部审计记录（需面板侧二次确认后再调）。daemon 先删后补，
   * **清空动作本身**会成为清空后唯一的一条记录（spec Scenario: 清空记录）。
   * 返回清空后的新状态（含那条留痕），面板不必再拉一次。
   */
  auditClear: "audit:clear",
  /**
   * 导出全部审计记录到文本文件，返回文件绝对路径与条数（由 daemon 写盘，
   * 与面板同一条查询 + 同一份渲染；面板只负责把路径摆给用户）。
   */
  auditExport: "audit:export",
  /**
   * 托管运行时的开关与清单（设置页「内置运行时」一级分区，spec:
   * add-managed-runtimes 阶段 3）。只读磁盘事实、**不 spawn**：状态口径与模型侧
   * `python_env` 段是同一份（core/runtime-inventory.ts）——
   * 深度四态探测在 runtimeDiagnostics。
   */
  runtimesSnapshot: "runtimes:snapshot",
  /** 总开关（「内置运行时」那一级）。返回更新后的完整清单（开关立即生效，无需重启）。 */
  setRuntimeMaster: "runtimes:set-master",
  /** 逐运行时开关（false = 显式的「已禁用」标记）。返回更新后的完整清单。 */
  setRuntimeEnabled: "runtimes:set-enabled",
  /** 单个运行时的可复制诊断报告 + 落盘日志路径（按需 spawn 的深度探测）。 */
  runtimeDiagnostics: "runtimes:diagnostics",
  /**
   * 按需安装一个尚未安装的运行时（阶段 7：三运行时纯按需，**没有任何静默自动下载**）。
   * 需联网、按体积量级下载；进度经 PUSH.runtimeInstallProgress 推送，可中途取消。
   * 返回更新后的完整清单；失败 reject（原因带相位与底层错误，供界面给可执行原因）。
   */
  runtimeInstall: "runtimes:install",
  /** 取消进行中的安装（下一次推进前生效，见 core/runtime-inventory.ts 的取消语义）。 */
  runtimeCancelInstall: "runtimes:cancel-install",
  /** 重置并重新安装（内核的幂等链路，需联网、可能几分钟）。返回更新后的完整清单。 */
  runtimeReset: "runtimes:reset",
  /* ── 定时任务 ─────────────────────────────────────────────────── */
  /** 全部定时任务（管理页列表）。 */
  automationList: "automation:list",
  /**
   * 新建或编辑定时任务（AutomationSaveInput：新建不带 id，编辑带 id）。
   * 返回落盘后的完整任务（status / nextRunAt / 时间戳由 daemon 算好）。
   */
  automationSave: "automation:save",
  /** 删除定时任务。正在运行（含排队中）的任务由 daemon 拒删。 */
  automationDelete: "automation:delete",
  /** 启停切换（active ↔ paused；missed 重新启用走这里）。返回切换后的任务。 */
  automationToggle: "automation:toggle",
  /** 立即运行一次（进同一串行队列，不影响既有 nextRunAt 的周期语义）。 */
  automationRunNow: "automation:run-now"
};
const PUSH = {
  /** 会话事件流。payload 为 SessionEventEnvelope（sessionId 路由键 + 事件本体）。 */
  sessionEvent: "session:event",
  /**
   * 任务列表有变更（run 开始/结束、会话增删改），payload 为**完整最新列表**
   * （与 INVOKE.sessionList 同元素类型），renderer 收到直接替换本地 state。
   *
   * 为什么新推一条而不是沿用旧机制：现状是 renderer 在 run_finished 事件里
   * 重新 invoke sessionList 拉取（拉式），run 开始/结束都要刷新 running 标记后，
   * 拉式得在两类事件里各挂一次重拉、每个 run 边界多一次往返，且刷新时机
   * 依赖 renderer 记得订阅；daemon 是列表真相的持有者，变了就推是单向数据流。
   * 为什么全量而非增量：列表条数小（几十到几百条小对象），增量协议要为
   * 增/删/改/排序各写一套；daemon 已把 title/current/running 组装好，
   * 全量替换与重拉等价但少一次往返。首屏仍走 invoke 主动拉一次。
   */
  taskListChanged: "session:list-changed",
  /** daemon 请求 UI 交互，需要 renderer 用 INVOKE.uiResponse 应答。 */
  uiRequest: "ui:request",
  /** 权限审批请求，需要用 INVOKE.permissionResponse 应答。 */
  permissionRequest: "permission:request",
  /** 结构化提问请求（questionnaire 工具），需要用 INVOKE.questionnaireResponse 应答。 */
  questionnaireRequest: "questionnaire:request",
  /** daemon 就绪。renderer 收到后才拉 snapshot。 */
  daemonReady: "daemon:ready",
  /**
   * daemon 挂了。UI 应进入不可用态并提示重启。
   * 不做自动重连——试用阶段静默重连会掩盖真问题（让它响亮地失败）。
   */
  daemonDown: "daemon:down",
  /** 定时任务事件（数据变更 / 一次运行结束），payload 为 AutomationEvent。 */
  automationEvent: "automation:event",
  /**
   * 托管运行时安装进度（payload 为 RuntimeInstallProgress）。
   * 安装跑在 daemon、可能持续几分钟；进度走推送而非 invoke 返回值，
   * 于是用户切走设置页再切回来仍能看到「正在安装」，终态也由推送触发回读清单。
   */
  runtimeInstallProgress: "runtimes:install-progress"
};
const DEFAULT_GLOBAL_SHORTCUT = "Shift+Alt+W";
export {
  DEFAULT_GLOBAL_SHORTCUT,
  INVOKE,
  LEGACY_DOC_EXTENSIONS,
  OFFICE_EXTENSIONS,
  PDF_EXTENSION,
  PUSH,
  docKindOf,
};
