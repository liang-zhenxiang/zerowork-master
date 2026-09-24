import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readSync } from "node:fs";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { sep } from "node:path";
import { statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import {
	getBuiltinSkillDirs,
	getConfigDir,
	getSessionsDir,
} from "./config-paths.js";
import { memoryReminder } from "./memory.js";
import { toModelKey } from "./auth.js";
import {
	generatingLabel,
	toolOutcomeFrom,
} from "./ledger.js";
import {
	composeHiddenBlock,
	formatRunTime,
} from "./prompt-compose.js";
import {
	DEFAULT_TOOLS,
	DELEGATE_MODE_TOOLS,
	DELTA_FLUSH_MS,
	STREAM_CARD_TOOLS,
	changeFromEdit,
	changeFromWrite,
	childAgentsOf,
	doneLabel,
	nextHostGeneration,
	parseSources,
	parseTodoArgs,
	renderRuntimeEnvSection,
	restoredToolLabel,
	runningLabel,
	splitSkillBlocks,
	summarizeArgs,
	textOf,
	toPiImages,
	toTokenUsage,
	toolResultDetails,
	toolResultText,
	userContentOf,
	writeDoneLabel,
	writeStreamProgress,
} from "./session-view.js";
import {
	buildMessageRefs,
	composeRequestComposition,
	entryTokens,
	thinkingOf,
} from "./messages.js";

class SessionHost {
  constructor(session, options, sceneId, interactionId, expertId, skills) {
    this.session = session;
    this.options = options;
    this.sceneId = sceneId;
    this.interactionId = interactionId;
    this.expertId = expertId;
    this.skills = skills;
    this.ledger = options.createLedger?.(session.sessionId);
    if (this.ledger !== void 0) this.installRequestSnapshot();
  }
  session;
  options;
  sceneId;
  interactionId;
  expertId;
  skills;
  /**
   * 本实例的代际号，进 id 的第二段（见 nextId）。
   * 在字段初始化时取号，构造函数体之前就位 —— 测试里绕过私有构造器直接 new
   * 也照样拿到号，不会退化成无前缀的 id。
   */
  idGeneration = nextHostGeneration();
  /** 自增 id 计数器。比 UUID 好在可预测、日志可读、测试可断言。 */
  idSeq = 0;
  /** 当前正在流式输出的助手消息 id。message_start 时生成，message_end 时清空。 */
  currentAssistantId;
  /**
   * 流式正文/思考 delta 的时间窗缓冲（spec: optimize-stream-rendering）。
   *
   * 原先每个 delta 直接 emit，一个 token 就走完整条 daemon → main → renderer 链路
   * 并让 renderer 重跑渲染。这里把**连续同类型**的 delta 累积到约一帧再发一条。
   *
   * 缓冲成立的前提是「同一助手消息内、同类型连续」，所以类型切换、message_end、
   * turn_end 与 agent_end（含 abort 收尾）都必须先 flush（见 flushDeltas 的调用点），
   * 否则最后一批会丢或与终态校正串序。messageId 一并记下：flush 时
   * currentAssistantId 可能已被清（agent_end 路径），不能现读。
   */
  pendingDeltas;
  /** 当前 run 的 id，供 run_error / run_finished 关联。 */
  currentRunId;
  /**
   * 本 run 最近一次失败的助手消息（stopReason "error"）的 errorMessage 记账。
   * pi 自动重试期间失败的 message_end 先到、终态后到 —— run_error 不能随消息发，
   * 必须等 agent_end（willRetry=false）确认重试耗尽/未开重试。成功的助手消息清账。
   */
  pendingRunError;
  /**
   * 本 run 期间用户是否按过停止（abort() 置位，run 收尾清除）。
   * 终态判定用：见 abort() 的注释——pi 的中断收尾不保证 stopReason "aborted"。
   */
  abortRequested = false;
  /** 已发出的工具卡片，tool_execution_end 时要在原卡上补 outcome 与 detail。 */
  toolCards = /* @__PURE__ */ new Map();
  /**
   * write/edit 执行前暂存的现场：真实 diff 所需的旧内容与变更统计。
   * 执行成功才落到卡片上（失败不算产物）。changeType 在启动时查文件存在性得出，
   * 即使 args 形状异常导致 change 算不出，完成标签也能区分 已生成/已修改。
   */
  pendingChanges = /* @__PURE__ */ new Map();
  /**
   * 会话的技术 cwd（= options.cwd）。解析模型给的相对路径、读 write/edit 的旧内容都用它。
   */
  sessionCwd = "";
  /**
   * 生成阶段的工具调用追踪（key = assistant 消息的 contentIndex）。
   *
   * rawArgs 自己按 delta 累积，而不是读 content block 上的暂存字段：
   * 那个字段是各 provider 的私有草稿，名字都不统一（anthropic 叫 partialJson、
   * openai-completions 叫 partialArgs），而 toolcall_delta.delta 是公开契约。
   *
   * 卡片（tool_stream_started）不在 toolcall_start 时立刻发，要等首个 delta
   * 里读到稳定的 id 与 name —— openai 协议下 start 时 id 可能是空串、
   * 后续才补上（openai-completions.ts 的 block.id 回填逻辑）。
   */
  streamToolCalls = /* @__PURE__ */ new Map();
  /* ── 运行台账记账（spec: add-observability-ledger）──────────────────
   * 台账与 UI 事件是两套独立账本：UI 的 currentRunId 跨 willRetry 保持
   * （流式态不闪），台账的 run 按真实 agent 尝试闭合（agent_end 无论
   * willRetry 都闭合 —— 一次失败的尝试就是一个 endedReason=error 的 run，
   * 否则重试链会留一堆永不闭合的孤儿 run）。
   */
  /** 运行台账。缺省（未注入 createLedger）= 不记 —— 所有写入点都要判空。 */
  ledger;
  /** 当前未闭合的台账 run id（agent_start / 空闲压缩开，agent_end / 压缩终态合）。 */
  ledgerRunId;
  /**
   * 最近闭合的台账 run id。retry 条目的归属靠它：pi 的事件序是
   * agent_end(willRetry) → auto_retry_start（此刻当前 run 已闭合），
   * start 条目归到刚失败的尝试上；end(success) 在新 run 内到达，归新 run。
   */
  lastClosedRunId;
  /** 台账 run 内的 turn 计数（llm_call 条目的 turnIndex）。 */
  ledgerTurnIndex = 0;
  /** 当前 turn 的开始时刻（turn_start 记账，助手 message_end 结算 llm_call）。 */
  turnStartedAt;
  /** 当前 turn 首个输出 delta 的到达时刻（TTFT 基准，见 markFirstOutput）。 */
  turnFirstDeltaAt;
  /** 执行中的工具调用（toolCallId → 开始现场），tool_execution_end 结算 tool_call 条目。 */
  openLedgerTools = /* @__PURE__ */ new Map();
  /** 最近一次 auto_retry_start 的退避参数（auto_retry_end 不携带，转发 run_retry 时补齐）。 */
  pendingRetry;
  /**
   * 进行中的压缩的锁（compaction_start 落，compaction_end 清）。
   *
   * 进程内不变量：同一时刻最多一次压缩（pi 自己保证），所以这是个单值而不是
   * 集合。锁的**持有者与原因在 start 时取定**：空闲手动压缩会在自己的分支里
   * 起一个新 run，若到 end 时才现读 currentRunId，同一次压缩的首尾就会记成
   * 两把不同的锁 —— 成对判定必须两端同值（dsh 的 compaction/end 用同一个
   * numeric-or-null 释放）。
   */
  pendingCompaction;
  /**
   * 本 run 的 hidden context **环境块**（F5）全文。
   *
   * **按 run 冻结**（prompt() 时算一次，agent_end 清）。注入本身由
   * extensions/prompt-switch.ts 的 before_agent_start handler 取这份全文、
   * 经 pi 的持久 `message` 落进会话文件（内容未变则不追加，见
   * shared/hidden-context.ts 的 shouldAppendSnapshot）—— 冻结在这里是因为
   * 时间要取 run 开始时刻，且「同一类事实只有一个来源」。
   *
   * steer / followUp 不刷新本字段：排队消息落进的是**当前 run**，run 的
   * 冻结内容理应保持不变（它们也不触发 before_agent_start）。
   */
  pendingHidden;
  /**
   * 最近一次冻结的环境块全文（与 pendingHidden 同时写，但 agent_end **不清**）。
   *
   * pendingHidden 是 run 期的账（run 终即清，防压缩调用等非 run 请求误注入）；
   * 这个是「最近一次注入了什么」的展示语义 —— 任务诊断面板的
   * 「hidden context 快照」靠它：run 结束后用户仍该能看到刚才冻结并落盘的
   * 快照内容。下一次 freeze 覆盖。
   */
  lastHiddenContext;
  /**
   * 最近一次冻结的时间块全文（`zerowork-run-time` 通道的注入读口 + 展示语义）。
   *
   * **没有 pending 那一半**（与 pendingHidden 不同）：`pendingHidden` 存在的理由是
   * 「`request_snapshot` 的 `hiddenContextChars` 只该记 run 内的那次冻结」—— 环境块
   * 有台账消费者，时间块没有（台账里没有单列它的字段，加字段属另一件事）。所以这里
   * 一个字段同时服务注入与展示，run 结束也不清（语义同 lastHiddenContext）。
   */
  lastRunTime;
  static async create(options) {
    const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
    const model = options.modelKey === void 0 ? void 0 : options.catalog.resolveModel(options.modelKey);
    if (options.modelKey !== void 0 && model === void 0) {
      throw new Error(
        `选中的模型「${options.modelKey}」已不可用，请到设置里重新选择`
      );
    }
    const agentDir = getConfigDir();
    const cwd = options.cwd;
    mkdirSync(cwd, { recursive: true });
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalSkillPaths: [...getBuiltinSkillDirs()],
      extensionFactories: [...options.extensions ?? []]
    });
    await resourceLoader.reload();
    const initialMode = options.resources.modes.find((m) => m.id === options.interactionId);
    const initialBase = initialMode === void 0 ? [...DEFAULT_TOOLS] : [...initialMode.tools];
    const initialExtra = options.getExpertExtraTools?.() ?? [];
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      // 复用 ModelCatalog 已建好的 runtime，避免重复读 auth.json / models.json。
      modelRuntime: options.catalog.modelRuntime,
      ...model === void 0 ? {} : { model },
      // 恢复历史会话时由 daemon 注入 open 出来的 manager（含全部落盘条目）；
      // 缺省开全新会话文件。
      sessionManager: options.sessionManager ?? SessionManager.create(cwd, getSessionsDir()),
      settingsManager,
      resourceLoader,
      // 仅新会话注入全局默认档；resume 不传（pi 从会话文件还原，见 options 注释）。
      ...options.thinkingLevel === void 0 ? {} : { thinkingLevel: options.thinkingLevel },
      tools: options.toolsOverride !== void 0 ? [...options.toolsOverride] : [
        ...initialBase,
        ...initialExtra.filter((tool) => !initialBase.includes(tool)),
        // MCP 等扩展工具的名字（extraActiveTools）：必须**构造时**进
        // tools —— pi 的 _refreshToolRegistry 对扩展工具按 allowedToolNames
        // （即本数组）过滤后才放行进注册表（agent-session.js:2117），
        // 事后 setActiveToolsByName 对名单外的名字一律无效（不在注册表）。
        // 名字此刻已就绪：扩展工厂在上方 reload() 里同步跑完。
        ...options.extraActiveTools?.() ?? []
      ]
    });
    const skills = resourceLoader.getSkills().skills.map((s) => ({
      name: String(s.name ?? ""),
      description: String(s.description ?? ""),
      filePath: String(s.filePath ?? "")
    }));
    const host = new SessionHost(
      session,
      options,
      options.sceneId,
      options.interactionId,
      options.expertId,
      skills
    );
    host.sessionCwd = cwd;
    session.subscribe((event) => host.translate(event));
    return host;
  }
  /* ── 对外操作 ────────────────────────────────────────────────── */
  /**
   * 当前激活的工具名集合（pi getActiveToolNames 现读）。冒烟（smoke-mcp-activation）
   * 验证「MCP 工具注册后对模型可见」用；诊断视图将来要展示工具面也从这取。
   */
  activeToolNames() {
    return this.session.getActiveToolNames();
  }
  /**
   * 投一条消息。返回**是否仅入了 followUp 队列**。
   *
   * 返回值说明 pi 的 `followUp()` 是**入队即 resolve**：await 完它**无法判断
   * 消息是否已进入上下文**，本返回值只能告诉调用方这一发有没有真的起一轮。
   *
   * ⚠️ **不要拿它当送达回执**。团队产出曾经就是栽在这里 —— 三次复现
   * 「成员跑完但领导收不到产出」，最后一版的根因正是把 `queued: false`
   * 当成「已送达」去清留痕。拉模式（spec: add-team-pull-model 批次 ④）之后
   * 产出不再走这条路，`getFollowUpQueue` 与那套销账协议一并删除。
   *
   * 现在没有调用方需要这个区分（普通用户输入、成员 followUp 都忽略返回值），
   * 保留返回值是为了让「入队 ≠ 送达」这件事在签名层可见，别让后来者再猜一次。
   */
  async prompt(text, whileStreaming, images) {
    const piImages = toPiImages(images);
    if (this.session.isStreaming) {
      if (whileStreaming === "steer") await this.session.steer(text, piImages);
      else await this.session.followUp(text, piImages);
      return { queued: true };
    }
    if (whileStreaming !== void 0) {
      this.freezeHiddenContext();
      await this.session.prompt(text, {
        ...piImages === void 0 ? {} : { images: piImages },
        streamingBehavior: whileStreaming
      });
      return { queued: false };
    }
    this.freezeHiddenContext();
    await this.session.prompt(text, piImages === void 0 ? void 0 : { images: piImages });
    return { queued: false };
  }
  /**
   * 冻结本 run 的两份快照正文（prompt 的两个非流式入口共用这一个写点）。
   * steer / followUp（流式分支）不经过这里：排队消息落进的是当前 run，
   * run 的冻结内容不变（见 pendingHidden 注释）。
   */
  freezeHiddenContext() {
    try {
      const frozen = this.composeRunHiddenContext();
      this.pendingHidden = frozen.hidden;
      this.lastHiddenContext = frozen.hidden;
      this.lastRunTime = frozen.runTime;
    } catch (error) {
      this.pendingHidden = void 0;
      this.ledger?.reportFailure(
        `hidden context 组装失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * 最近一次冻结的 hidden context **环境块**全文。还没有过 prompt（或组装一直失败）为 undefined。
   *
   * 两个用途，值在同一次 freeze 里取定、不会分叉：
   *   1. 任务诊断面板的展示口（run 结束后仍可读，见 lastHiddenContext 注释）；
   *   2. **daemon 的注入读口** —— extensions/prompt-switch.ts 的
   *      `composeHiddenContext` 回调接的就是它。时序成立：`before_agent_start`
   *      只在 pi 的 `session.prompt()` 里 emit，而本类的 prompt()（两个非流式入口）
   *      在调 `session.prompt()` **之前**同步调过 freezeHiddenContext()，
   *      所以该事件触发时本读口必然已是本 run 的冻结值（不是上一轮的残留）。
   */
  peekHiddenContext() {
    return this.lastHiddenContext;
  }
  /**
   * 最近一次冻结的 hidden context **时间块**全文（`zerowork-run-time` 通道的读口）。
   *
   * 与环境块分开读：两条通道各自去重（判定按各自的 customType 读基线），
   * 合并成一个读口就又回到「分钟一变整块重发」那件事上。
   * 时序约束与 peekHiddenContext 相同（freeze 在 session.prompt() 之前）。
   */
  peekRunTime() {
    return this.lastRunTime;
  }
  /**
   * 重排等待队列：删除 / 编辑排队消息的底层动作。
   *
   * pi 只有整队清空（AgentSession.clearQueue），没有按条删除 —— 这里用
   * 「清空 + 按序重入队」合成按条语义：重入队的就是删除/编辑后剩下的条目。
   * 两个代价，都有界：
   *   - **图片丢失**：clearQueue 只回文字（pi 的 _steeringMessages 是 string[]），
   *     带图排队一旦被删除/编辑过一次，重入队的就是纯文本；
   *   - **清空 → 重入队之间有个无队列窗口**：若 run 恰在此间收尾，重入队的消息
   *     会挂在队列上等下一次 run 才被消费（agent 循环只在 run 内清队列）——
   *     chips 仍显示、不丢，只是晚一轮生效。
   */
  async rewriteQueue(steering, followUp) {
    this.session.clearQueue();
    for (const text of steering) await this.session.steer(text);
    for (const text of followUp) await this.session.followUp(text);
  }
  async abort() {
    if (this.currentRunId !== void 0) this.abortRequested = true;
    await this.session.abort();
    this.session.abortCompaction();
    this.flushDeltas();
  }
  /**
   * 手动压缩上下文（pi TUI 的 /compact 等价物）。
   *
   * pi 的 compact() 会先中断当前 agent 操作且**不续跑**（agent-session.d.ts:510），
   * 所以调用方（daemon）在流式期间直接拒绝，而不是依赖 pi 的中断语义。
   * 压缩本身要调模型写摘要，耗时与一轮对话相当 —— 期间的流式态与停止键
   * 由 translate 的 compaction_start/end 分支维持（复用 run 记账）。
   *
   * @param customInstructions 用户对摘要的侧重要求（/compact 的参数文本）。
   */
  async compact(customInstructions) {
    await this.session.compact(customInstructions);
    this.emitState();
  }
  /**
   * 把当前会话导出为单文件 HTML，返回导出文件的绝对路径。
   *
   * 空会话（还没有任何消息）时 pi 会抛 message 含 "Nothing to export" 的错误，
   * 这里改抛中文文案 —— 这是面向用户的提示，daemon 会原样透传给 UI。
   * 判断依赖 pi 的错误文案：pi 升级若改了文案，会落回原始英文错误，
   * 不会误判其他错误 —— 可接受的耦合。其余错误原样重抛。
   */
  async exportHtml(outputPath) {
    try {
      return await this.session.exportToHtml(outputPath);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Nothing to export")) {
        throw new Error("该会话还没有内容可导出");
      }
      throw error;
    }
  }
  /**
   * 释放底层会话。切换工作空间时旧会话整个作废——
   * cwd 在建会话时一次性注入工具集，不存在「换目录继续聊」。
   */
  dispose() {
    if (this.pendingDeltas !== void 0) {
      clearTimeout(this.pendingDeltas.timer);
      this.pendingDeltas = void 0;
    }
    this.session.dispose();
  }
  /**
   * 重命名当前会话（写入 pi 的 session_info 条目）。
   *
   * 必须走本实例持有的活 SessionManager：pi 的 SessionManager 各自缓存
   * entries，同一文件出现两个活写者会互相覆盖。非当前会话的重命名
   * 由 daemon 临时 open 一个实例完成（用完即弃，不注册到任何地方）。
   */
  renameSession(name) {
    this.session.sessionManager.appendSessionInfo(name);
  }
  /** 产物清单持久化（appendCustomEntry），恢复历史会话时重建产物卡。 */
  persistArtifacts(files, focusFile) {
    this.session.sessionManager.appendCustomEntry("artifacts_presented", { files, focusFile });
  }
  /**
   * 定时任务 run 的溯源标记（automation_run custom 条目，taskId 定位任务的运行会话）。
   * 会话列表/导出链路经会话文件天然可追（spec：add-automation-scheduler）。
   */
  markAutomationRun(taskId) {
    this.session.sessionManager.appendCustomEntry("automation_run", { taskId });
  }
  /**
   * 子代理 run 的溯源标记（subagent_run custom 条目，agent 名定位这次会话
   * 是哪个子代理跑的）。子代理会话与主会话同落 sessions 目录，没有这条
   * 条目就会在会话列表里混入一条看不出来历的「普通会话」。
   */
  markSubagentRun(agentName) {
    this.session.sessionManager.appendCustomEntry("subagent_run", { agent: agentName });
  }
  /**
   * 团队成员会话的溯源标记（team_member custom 条目，spec:
   * add-team-foundations 批 5）。与 subagent_run 同理：成员会话不该混进
   * 会话列表；listSessions 的头部扫描按两个标记一起过滤。
   */
  markTeamMemberRun(memberName) {
    this.session.sessionManager.appendCustomEntry("team_member", { member: memberName });
  }
  /**
   * 当前会话文件名。daemon 用它标会话列表的 current、判定 rename/delete
   * 的目标是不是这个活会话。in-memory 会话为 undefined —— 本应用的会话
   * 都是持久化的，但 pi 的类型如此，调用方必须处理。
   */
  get sessionFilePath() {
    return this.session.sessionManager.getSessionFile();
  }
  /* ── 会话分支的窄出口（spec: add-session-branching）──────────────────
   * 会话分支要「回退到某条用户消息之前」与「从那里派生新会话」，需要 pi 的
   * 用户消息清单 / 条目树指针 / 叶子。**只开窄方法、不暴露 AgentSession 对象**：
   * daemon 拿到的就是普通数据（字符串 id 与 parentId），pi 的类型仍然止步于
   * 本文件（适配层纪律）。
   */
  /**
   * 可分支的用户消息（用户消息序号 → 落盘条目 id 的桥接）。
   *
   * 为什么必须由宿主桥接（spec「实测修订」）：渲染层在线路径的 user 消息 id 是
   * `nextId("user")` 造的（translate 的 message_start 分支），与落盘条目 id
   * **不一致**，所以 IPC 只传用户消息序号，真 id 在这里现取。技能消息在条目里
   * 就是普通 user 消息，不额外拆条（同一条只出现一次）。
   */
  listForkableUserMessages() {
    return this.session.getUserMessagesForForking();
  }
  /**
   * 条目树指针（id / parentId + 消息条目的 role）。
   * 会话分支用：抽枝判定与分叉点定位只需要树指针，role 供「下一轮从哪开始」
   * 的轮末定位（session-branch.ts 的 endOfTurn）—— 非消息条目（model_change
   * 等）没有 role，属性缺席。
   */
  listEntryRefs() {
    return this.session.sessionManager.getEntries().map((entry) => ({
      id: entry.id,
      parentId: entry.parentId ?? null,
      ...entry.type === "message" ? { role: entry.message.role } : {}
    }));
  }
  /** 当前叶子条目 id（空会话为 null）—— 「重新开始」抽枝时抽到哪一条。 */
  currentLeafId() {
    return this.session.sessionManager.getLeafId();
  }
  async setModel(modelKey) {
    const model = this.options.catalog.resolveModel(modelKey);
    if (model === void 0) throw new Error("该模型不可用");
    await this.session.setModel(model);
    this.emitState();
  }
  /**
   * 切换当前会话的推理强度档位。
   *
   * pi 的 setThinkingLevel 恒 clamp 到当前模型可用档位、不抛错
   * （agent-session.ts:1684），实际变化时才落 thinking_level_change 条目 ——
   * 逐会话持久化与 resume 还原全由 pi 负责，我们不做第二份持久化。
   * 生效值以 emitState 里 getter 现读为准（clamp 后的值可能与入参不同）。
   */
  setThinkingLevel(level) {
    this.session.setThinkingLevel(level);
    this.emitState();
  }
  /**
   * 切换场景 / 交互模式。
   *
   * 提示词的每轮重组在 prompt-switch 扩展里发生（before_agent_start），
   * 这里只负责存轴 + 换工具集。工具白名单是模式 frontmatter 声明的
   * （resources/modes/<id>.md），白名单语义：未列出的工具被禁用，
   * 含扩展注册的自定义工具。
   */
  setScene(sceneId) {
    const scene = this.options.resources.scenes.find((s) => s.id === sceneId);
    if (scene === void 0) throw new Error(`未知的场景：${sceneId}`);
    this.sceneId = sceneId;
    this.emitState();
  }
  /**
   * 切换交互模式。只切模式轴、换工具集 —— 专家绑定（expertId）与模式正交，
   * 不在这里读也不在这里写（spec: rework-expert-orthogonal-and-skills）。
   * 工具集经 effectiveToolNames 合并专家 extraTools（切模式不清专家的追加工具）。
   */
  setInteraction(interactionId) {
    const mode = this.options.resources.modes.find(
      (m) => m.id === interactionId
    );
    if (mode === void 0) throw new Error(`未知的交互模式：${interactionId}`);
    this.interactionId = interactionId;
    this.session.setActiveToolsByName([...this.effectiveToolNames()]);
    this.emitState();
  }
  /**
   * 绑定 / 清除专家。与交互模式正交：只改 expertId，不动模式轴。
   * 工具集重新应用：extraTools 是专家的声明（spec: add-team-foundations），
   * 绑定/清除都要即时生效 —— 与「创建即模式工具面」的既有纪律同源
   * （工具面是一等公民，不该等下一次切模式才对上）。
   */
  setExpert(expertId) {
    this.expertId = expertId;
    if (this.options.toolsOverride === void 0) {
      this.session.setActiveToolsByName([...this.effectiveToolNames()]);
    }
    this.emitState();
  }
  /**
   * 生效工具集 = 当前模式白名单 ∪ 专家 extraTools（spec: add-team-foundations）。
   * 专家只能增不能删：extraTools 不出现在白名单里就追加，出现了去重跳过。
   */
  /** 委派模式开关（会话内策略，语义见 setDelegateMode）。 */
  delegateMode = false;
  effectiveToolNames() {
    const mode = this.options.resources.modes.find((m) => m.id === this.interactionId);
    const base = mode === void 0 ? [...DEFAULT_TOOLS] : [...mode.tools];
    const extra = this.options.getExpertExtraTools?.() ?? [];
    const merged = extra.length === 0 ? base : [...base, ...extra.filter((tool) => !base.includes(tool))];
    if (!this.delegateMode) return merged;
    return merged.filter((tool) => DELEGATE_MODE_TOOLS.includes(tool));
  }
  /**
   * 开关委派模式（spec: add-team-collaboration-parity 批次 ③）。
   *
   * 只改工具面并重应用（同 setExpert 的即时生效纪律），不动提示词：模式语义由
   * team_delegate_mode 工具的回执与团队工具描述承载，提示词字节保持稳定
   * （避免为了一个开关把整段前缀打碎，KV 缓存口径同 team-tools 文件头）。
   * 子代理会话（toolsOverride 非空）不参与 —— 与 setExpert 的守卫同款。
   */
  setDelegateMode(enabled) {
    this.delegateMode = enabled;
    if (this.options.toolsOverride === void 0) {
      this.session.setActiveToolsByName([...this.effectiveToolNames()]);
    }
    this.emitState();
  }
  /** 当前技能描述符，供 daemon 组装提示词的技能段。 */
  get skillDescriptors() {
    return this.skills;
  }
  /**
   * 一条请求里由宿主负责的入模成分（口径见 composeRequestComposition）。
   *
   * 给 daemon 在**挂载 / 恢复**宿主时读：那时还没有请求，reportContextComposition
   * 也就没触发过，不现算一次圆环的分类全是残差。运行期的每一步都走上报通道，
   * 两条路径共用同一个函数，不各算一遍。
   */
  getContextComposition() {
    const messages = this.session.messages;
    return composeRequestComposition(
      buildMessageRefs(messages),
      messages,
      this.session.agent.state.tools
    );
  }
  get state() {
    const usage = this.session.getContextUsage();
    const model = this.session.model;
    return {
      sessionId: this.session.sessionId,
      // 临时任务也是真实 cwd（该任务自己的目录）——契约不再用 undefined 表达「无目录」。
      cwd: this.options.cwd,
      isTempTask: this.options.isTempTask,
      sceneId: this.sceneId,
      interactionId: this.interactionId,
      // 无专家时缺省（不占字段），与 SessionState.expertId 的可选契约一致。
      ...this.expertId === void 0 ? {} : { expertId: this.expertId },
      // 委派模式：常态不占字段（与 expertId 同款）。
      ...this.delegateMode ? { delegateMode: true } : {},
      modelId: model === void 0 ? void 0 : toModelKey(model.provider, model.id),
      // 不能透传 pi 的 session.isStreaming：pi 要到 finally 的 _emitAgentSettled
      // 才把它置 false（agent-session.ts:631/1113），agent_end 事件分发时它仍是 true。
      // 曾经透传导致 agent_end 处理中的 emitState 把 isStreaming:true 推给 renderer，
      // 覆盖 run_finished 刚置的 false —— UI 永久卡在「正在思考…」。
      // 用自家的 run 记账：agent_start 置、agent_end 清，时序完全由本文件控制。
      isStreaming: this.currentRunId !== void 0,
      /*
       * 档位两字段都从 getter 现读，不落成员字段：
       * pi 的 thinking_level_changed 事件 payload 只有 level（无 availableLevels），
       * 而 setModel 后可用档位会联动 re-clamp —— 任何一处缓存副本都会和
       * pi 的真实状态漂移。非推理模型 getAvailableThinkingLevels 返回 ["off"]，
       * UI 据此不显示档位行。
       */
      thinkingLevel: this.session.thinkingLevel,
      availableThinkingLevels: this.session.getAvailableThinkingLevels(),
      // tokens 可能为 null（刚压缩完、还没下一次响应），此时不下发用量。
      ...usage === void 0 || usage.tokens === null ? {} : {
        contextUsage: {
          usedTokens: usage.tokens,
          maxTokens: usage.contextWindow
        }
      }
    };
  }
  /* ── 事件翻译 ────────────────────────────────────────────────── */
  /**
   * 生成一个条目 id：`<prefix>-g<代际>-<本代序号>`。
   *
   * 三段缺一不可：prefix 供人读（user / assistant / run）、代际段保证跨宿主重建
   * 不撞名（见 hostGeneration 注释）、序号段是本宿主内的顺序。**非整数样字符串**：
   * turnTimings 用它作键，而 JS 对象对整数样键会按数值排序（shared/conversation.ts
   * 的 recordTurnTiming 依赖插入序来裁剪最旧回合）。
   */
  nextId(prefix) {
    this.idSeq += 1;
    return `${prefix}-g${this.idGeneration}-${this.idSeq}`;
  }
  emitState() {
    this.options.emit({ type: "session_state", state: this.state });
  }
  /**
   * 把一条流式 delta 并入缓冲；类型切换或换消息时先把上一批 flush 出去。
   *
   * 定时器到期是唯一「无外部事件驱动」的 flush 时机；另外三个（类型切换、
   * message_end、turn/agent_end）由下面的调用点主动触发，缺一即丢内容。
   */
  bufferDelta(kind, messageId, delta) {
    const pending = this.pendingDeltas;
    if (pending !== void 0 && (pending.kind !== kind || pending.messageId !== messageId)) {
      this.flushDeltas();
    }
    const current = this.pendingDeltas;
    if (current === void 0) {
      this.pendingDeltas = {
        kind,
        messageId,
        text: delta,
        timer: setTimeout(() => this.flushDeltas(), DELTA_FLUSH_MS)
      };
      return;
    }
    current.text += delta;
  }
  /**
   * 立即把缓冲的 delta 按原事件类型发出去（无缓冲时 no-op）。
   *
   * `delta` 是拼接结果，事件类型与字段语义与未合批时完全一致 —— 下游零改动。
   */
  flushDeltas() {
    const pending = this.pendingDeltas;
    if (pending === void 0) return;
    this.pendingDeltas = void 0;
    clearTimeout(pending.timer);
    this.options.emit(
      pending.kind === "text" ? { type: "assistant_text_delta", messageId: pending.messageId, delta: pending.text } : { type: "assistant_thinking_delta", messageId: pending.messageId, delta: pending.text }
    );
  }
  /**
   * pi 事件 → 领域事件。
   *
   * 用 pi 的真实类型 `AgentSessionEvent` 而不是宽松的 Record —— 这是有意的：
   * 适配层的价值在于「pi 升级只塌这一个文件，而且响亮地塌」。
   * 若用 Record + 字符串索引，pi 改字段名（如 toolCallId → toolCallID）
   * 会照样编译通过，然后工具卡片静默不再渲染 —— 那是最难查的失败方式
   * （不写防御性兜底掩盖真问题）。
   *
   * 只处理 UI 真正需要的那几类；turn_start / turn_end 不上传但进台账
   * （llm_call 的起止，见 settleLlmCall），auto_retry / queue_update 台账与转发都做
   * （renderer 的重试状态行 / 排队徽标）。其余未知类型忽略。
   * 不写 default 分支抛错：pi 会持续新增事件类型，未知类型忽略才是正确行为。
   */
  translate(event) {
    const emit = this.options.emit;
    switch (event.type) {
      case "compaction_start": {
        const lock = this.currentRunId ?? null;
        this.pendingCompaction = { lock, reason: event.reason };
        this.ledger?.append("compaction_start", { lock, reason: event.reason });
        if (this.currentRunId !== void 0) {
          emit({ type: "compaction_started", reason: event.reason });
          return;
        }
        const runId = this.nextId("run");
        this.currentRunId = runId;
        this.ledgerRunId = runId;
        this.ledger?.append("run_start", { runId, ...this.modelIdForLedger() });
        emit({ type: "run_started", runId });
        this.emitState();
        emit({ type: "compaction_started", reason: event.reason });
        return;
      }
      case "compaction_end": {
        const pending = this.pendingCompaction;
        this.pendingCompaction = void 0;
        const shadow = event.result === void 0 ? void 0 : this.compactionShadow();
        this.ledger?.append("compaction", {
          reason: event.reason,
          ...event.result?.tokensBefore === void 0 ? {} : { tokensBefore: event.result.tokensBefore },
          aborted: event.aborted,
          ...event.errorMessage === void 0 ? {} : { errorMessage: event.errorMessage },
          ...pending === void 0 ? {} : { lock: pending.lock },
          ...shadow === void 0 ? {} : { shadow }
        });
        emit({
          type: "compaction_finished",
          aborted: event.aborted,
          ...event.errorMessage === void 0 ? {} : { errorMessage: event.errorMessage }
        });
        if (event.willRetry) return;
        const runId = this.currentRunId;
        if (runId === void 0) return;
        this.currentRunId = void 0;
        if (!event.aborted && event.errorMessage === void 0) {
          this.closeLedgerRun("completed");
          emit({ type: "run_finished", runId, outcome: "completed" });
        } else {
          const message = event.errorMessage ?? "上下文压缩已中断";
          this.closeLedgerRun("error", message);
          emit({
            type: "run_error",
            runId,
            message
          });
        }
        this.emitState();
        return;
      }
      case "agent_start": {
        const runId = this.nextId("run");
        this.currentRunId = runId;
        this.pendingRunError = void 0;
        this.abortRequested = false;
        this.ledgerRunId = runId;
        this.ledgerTurnIndex = 0;
        this.ledger?.append("run_start", { runId, ...this.modelIdForLedger() });
        emit({ type: "run_started", runId });
        this.emitState();
        return;
      }
      case "agent_end": {
        this.flushDeltas();
        if (event.willRetry) {
          this.closeLedgerRun("error", this.pendingRunError);
          return;
        }
        const runId = this.currentRunId ?? this.nextId("run");
        this.currentRunId = void 0;
        this.currentAssistantId = void 0;
        this.streamToolCalls.clear();
        for (const orphan of this.toolCards.values()) {
          emit({
            type: "tool_stream_started",
            card: {
              ...orphan,
              generating: void 0,
              outcome: "aborted",
              label: restoredToolLabel(orphan.toolName, "aborted")
            }
          });
        }
        this.toolCards.clear();
        this.pendingHidden = void 0;
        const cancelled = this.abortRequested || event.messages.some((m) => m.role === "assistant" && m.stopReason === "aborted");
        this.abortRequested = false;
        if (this.pendingRunError !== void 0 && !cancelled) {
          const message = this.pendingRunError;
          this.pendingRunError = void 0;
          this.closeLedgerRun("error", message);
          emit({ type: "run_error", runId, message });
        } else {
          this.pendingRunError = void 0;
          this.closeLedgerRun(cancelled ? "cancelled" : "completed");
          emit({ type: "run_finished", runId, outcome: cancelled ? "cancelled" : "completed" });
        }
        this.emitState();
        return;
      }
      case "auto_retry_start": {
        this.pendingRetry = { maxAttempts: event.maxAttempts, delayMs: event.delayMs };
        const runId = this.ledgerRunId ?? this.lastClosedRunId;
        this.ledger?.append("retry", {
          ...runId === void 0 ? {} : { runId },
          phase: "start",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage
        });
        emit({
          type: "run_retry",
          status: "start",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage
        });
        return;
      }
      case "auto_retry_end": {
        const last = this.pendingRetry;
        this.pendingRetry = void 0;
        const runId = this.ledgerRunId ?? this.lastClosedRunId;
        this.ledger?.append("retry", {
          ...runId === void 0 ? {} : { runId },
          phase: "end",
          attempt: event.attempt,
          success: event.success,
          ...event.finalError === void 0 ? {} : { finalError: event.finalError }
        });
        emit({
          type: "run_retry",
          status: event.success ? "success" : "finalError",
          attempt: event.attempt,
          maxAttempts: last?.maxAttempts ?? event.attempt,
          delayMs: last?.delayMs ?? 0,
          ...event.finalError === void 0 ? {} : { errorMessage: event.finalError }
        });
        return;
      }
      case "queue_update": {
        this.ledger?.append("queue", {
          steering: event.steering,
          followUp: event.followUp
        });
        emit({
          type: "queue_changed",
          steering: event.steering,
          followUp: event.followUp
        });
        return;
      }
      case "turn_start": {
        this.ledgerTurnIndex += 1;
        this.turnStartedAt = Date.now();
        this.turnFirstDeltaAt = void 0;
        return;
      }
      case "turn_end": {
        this.flushDeltas();
        return;
      }
      case "message_start": {
        const message = event.message;
        this.streamToolCalls.clear();
        if (message.role === "user") {
          const { text, images } = userContentOf(message.content);
          const { skillNames, text: displayText } = splitSkillBlocks(text);
          emit({
            type: "user_message",
            message: {
              id: this.nextId("user"),
              role: "user",
              text: displayText,
              // 无图不带字段：UserMessage.images 是可选契约，UI 按缺省渲染。
              ...images === void 0 ? {} : { images },
              // 无技能同理，不带空数组（口径同 images）。
              ...skillNames.length === 0 ? {} : { skillNames },
              at: message.timestamp
            }
          });
          return;
        }
        if (message.role === "assistant") {
          const id = this.nextId("assistant");
          this.currentAssistantId = id;
          emit({
            type: "assistant_started",
            messageId: id,
            at: message.timestamp
          });
        }
        return;
      }
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "toolcall_start") {
          this.markFirstOutput();
          this.streamToolCalls.set(inner.contentIndex, { rawArgs: "" });
          return;
        }
        if (inner.type === "toolcall_delta") {
          this.translateToolCallDelta(inner);
          return;
        }
        if (inner.type === "toolcall_end") {
          this.streamToolCalls.delete(inner.contentIndex);
          return;
        }
        if (inner.type === "text_delta" || inner.type === "thinking_delta") {
          this.markFirstOutput();
        }
        const id = this.currentAssistantId;
        if (id === void 0) return;
        if (inner.type === "text_delta") {
          this.bufferDelta("text", id, inner.delta);
        } else if (inner.type === "thinking_delta") {
          this.bufferDelta("thinking", id, inner.delta);
        }
        return;
      }
      case "message_end": {
        this.flushDeltas();
        const message = event.message;
        if (message.role !== "assistant") return;
        this.settleLlmCall(message);
        this.emitState();
        const id = this.currentAssistantId;
        this.currentAssistantId = void 0;
        if (id === void 0) return;
        const thinking = thinkingOf(message.content);
        emit({
          type: "assistant_done",
          message: {
            id,
            role: "assistant",
            text: textOf(message.content),
            ...thinking === "" ? {} : { thinking },
            // usage 服务于诊断页的 run 级聚合（shared/observability.ts），
            // 聊天 UI 不展示。pi 的 Usage 止步于此，出口是 shared 的 TokenUsage
            //（全字段翻译函数与 session-rebuild 同源，两条路径不漂移）。
            usage: toTokenUsage(message.usage),
            at: message.timestamp
          }
        });
        if (message.errorMessage !== void 0 && message.errorMessage !== "" && message.stopReason === "error") {
          this.pendingRunError = message.errorMessage;
        } else if (message.stopReason !== "aborted") {
          this.pendingRunError = void 0;
        }
        return;
      }
      case "tool_execution_start": {
        const existing = this.toolCards.get(event.toolCallId);
        const argSummary = summarizeArgs(event.args);
        this.openLedgerTools.set(event.toolCallId, {
          toolName: event.toolName,
          summary: argSummary.summary,
          startedAt: Date.now()
        });
        let stash;
        if (event.toolName === "write" || event.toolName === "edit") {
          const oldContent = this.readOverwriteTarget(event.args);
          const changeType = oldContent === void 0 ? "created" : "modified";
          const change = event.toolName === "write" ? changeFromWrite(event.args, oldContent) : changeFromEdit(event.args, oldContent);
          stash = { change, changeType };
          this.pendingChanges.set(event.toolCallId, stash);
        }
        const todos = event.toolName === "todo_write" ? parseTodoArgs(event.args) : void 0;
        const card = {
          id: event.toolCallId,
          role: "tool",
          toolName: event.toolName,
          // write/edit 执行期沿用生成期标签（标签词汇表里没有「写入中」，
          // 生成中/修改中 一直显示到完成态翻成 已生成/已修改）。
          label: stash !== void 0 ? generatingLabel(event.toolName, stash.changeType) : runningLabel(event.toolName),
          summary: argSummary.summary,
          outcome: void 0,
          detail: void 0,
          // 摘要顶掉入参原值（shell 的描述顶掉命令）时把原值带上，卡头 hover 才看得到。
          ...argSummary.title === void 0 ? {} : { summaryTitle: argSummary.title },
          // show_widget：reducer 的 tool_started 是整卡替换，生成期累积的
          // streamArgs 会被丢掉，而执行结果（detail）还没回来 —— 渲染层在
          // 这个窗口仍靠 streamArgs 出图，用完整 args 回填一次。
          ...event.toolName === "show_widget" ? { streamArgs: JSON.stringify(event.args) } : {},
          ...todos === void 0 ? {} : { todos },
          at: existing?.at ?? Date.now()
        };
        this.toolCards.set(event.toolCallId, card);
        emit({ type: "tool_started", card });
        return;
      }
      case "tool_execution_update": {
        const subagents = childAgentsOf(toolResultDetails(event.partialResult));
        if (subagents !== void 0) {
          emit({ type: "subagent_progress", id: event.toolCallId, agents: subagents });
          return;
        }
        const delta = toolResultText(event.partialResult);
        if (delta === "") return;
        emit({ type: "tool_progress", id: event.toolCallId, delta });
        return;
      }
      case "tool_execution_end": {
        const started = this.toolCards.get(event.toolCallId);
        this.toolCards.delete(event.toolCallId);
        const stash = this.pendingChanges.get(event.toolCallId);
        this.pendingChanges.delete(event.toolCallId);
        const outcome = toolOutcomeFrom(event.isError, toolResultDetails(event.result));
        const detail = toolResultText(event.result);
        const ledgerTool = this.openLedgerTools.get(event.toolCallId);
        this.openLedgerTools.delete(event.toolCallId);
        if (ledgerTool === void 0) {
          this.ledger?.reportFailure(
            `tool_execution_end 缺少配对的 start（${event.toolName}/${event.toolCallId}），tool_call 条目未记`
          );
        } else {
          this.ledger?.append("tool_call", {
            ...this.ledgerRunId === void 0 ? {} : { runId: this.ledgerRunId },
            toolCallId: event.toolCallId,
            toolName: ledgerTool.toolName,
            summary: ledgerTool.summary,
            startedAt: ledgerTool.startedAt,
            endedAt: Date.now(),
            outcome
          });
        }
        const sources = event.toolName === "web_search" ? parseSources(toolResultDetails(event.result)) : void 0;
        const subagents = childAgentsOf(toolResultDetails(event.result));
        emit({
          type: "tool_finished",
          card: {
            id: event.toolCallId,
            role: "tool",
            toolName: event.toolName,
            // 完成标签：write/edit 按新建/覆盖分 已生成/已修改，
            // 其余工具走 已读取/已列出…。started 缺失说明漏了 start 事件
            // （理论上不该发生），回落到工具名而不是编一个假标签。
            label: stash !== void 0 ? writeDoneLabel(stash.changeType, outcome) : started === void 0 ? event.toolName : doneLabel(event.toolName, outcome),
            summary: started?.summary ?? "",
            outcome,
            detail: detail === "" ? void 0 : detail,
            // hover 提示从执行态卡继承（summarizeArgs 只在 start 拿到 args）。
            ...started?.summaryTitle === void 0 ? {} : { summaryTitle: started.summaryTitle },
            // 失败的写入不产生变更（文件可能只写了一半，统计会误导）。
            ...outcome === "ok" && stash?.change !== void 0 ? { change: stash.change } : {},
            // todo_write 的清单从执行态卡继承（args 在 execution_start 解析，
            // tool_execution_end 事件不携带 args，见该处注释）。
            ...started?.todos === void 0 ? {} : { todos: started.todos },
            ...sources === void 0 ? {} : { sources },
            // task 卡的终态投影（提取见上方 subagents 注释）。
            ...subagents === void 0 ? {} : { subagents },
            at: started?.at ?? Date.now()
          }
        });
        return;
      }
      /*
       * 档位/会话信息变化：不重造任何成员字段，直接重推权威 state。
       * thinking_level_changed 的 payload 只有 level（无 availableLevels），
       * 而 state 两字段都从 getter 现读（见 state 注释），一次 emitState
       * 同时覆盖「切档位」与「切模型后档位联动 re-clamp」两种来源。
       */
      case "thinking_level_changed":
      case "session_info_changed":
        this.emitState();
        return;
    }
  }
  /**
   * 结算一次模型调用（台账 llm_call）。
   *
   * **挂在助手 message_end，不挂 turn_end**（2026-09-17 修正）：pi 的 turn_end 是
   * 「这一轮全部结束」—— 助手消息与每个工具结果都 append 完才 emit
   *（agent-session.js "A turn ends after its assistant message and every tool
   * result has been appended"）。挂 turn_end 有三处后果，多 agent 场景尤其明显
   *（一个 task 子代理工具就是几分钟）：
   *   1. endedAt − startedAt 里混进本轮工具执行时间 → 解码窗口（shared 的
   *      stepDecode）跟着虚高，tok/s 的分母被撑大（面板实测出现过 3 tok/s，
   *      而同一步扣掉 task 工具后约 200 tok/s）；
   *   2. llmMs 与 toolMs 相互重叠，「模型耗时 · 工具耗时」并列展示等于重复计时；
   *   3. 写入顺序变成「先本轮工具、后本轮 llm_call」，而 renderer 的
   *      foldRunSteps 按位置归属工具 → 每轮的工具都挂到上一步头上，每轮开头
   *      还多出一个假的「台账截尾」组（2026-09-17 面板实测）。
   *
   * 失败路径也走这里：pi 的 abort / 报错收尾同样先发 message_end（带 errorMessage
   * 与 stopReason），每次 attempt 各自成一条，语义比挂 turn_end 更细。
   */
  settleLlmCall(message) {
    const startedAt = this.turnStartedAt;
    if (startedAt === void 0) return;
    this.turnStartedAt = void 0;
    const firstDeltaAt = this.turnFirstDeltaAt;
    this.turnFirstDeltaAt = void 0;
    this.ledger?.append("llm_call", {
      ...this.ledgerRunId === void 0 ? {} : { runId: this.ledgerRunId },
      turnIndex: this.ledgerTurnIndex - 1,
      startedAt,
      endedAt: Date.now(),
      ...firstDeltaAt === void 0 ? {} : { ttftMs: firstDeltaAt - startedAt },
      stopReason: message.stopReason,
      usage: toTokenUsage(message.usage),
      ...message.errorMessage === void 0 ? {} : { errorMessage: message.errorMessage }
    });
  }
  /**
   * 首个模型输出到达的记账（TTFT 基准与解码窗口的左端点）。
   *
   * 正文 / 思考 / 工具调用参数任一先到都算首字：纯工具调用的轮次（模型直接吐一个
   * write 的参数、不写正文）以前拿不到 ttftMs，于是那一轮既没有首字延迟读数、
   * 也拿不到解码速度样本（stepDecode 要求 ttftMs 与 usage 兼备）—— 长任务里
   * 这类轮次占比不低。
   */
  markFirstOutput() {
    if (this.turnStartedAt !== void 0 && this.turnFirstDeltaAt === void 0) {
      this.turnFirstDeltaAt = Date.now();
    }
  }
  /** 台账 run_start 的模型快照（provider/model）；模型未选定（异常路径）键缺席。 */
  modelIdForLedger() {
    const model = this.session.model;
    return model === void 0 ? {} : { modelId: toModelKey(model.provider, model.id) };
  }
  /**
   * 闭合当前台账 run（无开着的是 no-op —— 空闲压缩的 compaction_end 在
   * currentRunId 缺失时根本走不到这里，agent_end 的 runId 兜底分支同理）。
   * 闭合后把 id 记入 lastClosedRunId：retry 条目的归属靠它（见该字段注释）。
   */
  closeLedgerRun(reason, error) {
    const runId = this.ledgerRunId;
    this.ledgerRunId = void 0;
    if (runId === void 0) return;
    this.lastClosedRunId = runId;
    this.ledger?.append("run_end", {
      runId,
      reason,
      ...error === void 0 ? {} : { error }
    });
  }
  /**
   * 刚落地的这次压缩遮蔽了哪一段历史（dsh `shadowedRange`/`shadowedSeqs`/
   * `shadowedTokenCount` 的最小等价物）。
   *
   * **取法只用 pi 落盘的条目树，不推断压缩内部**：pi 的 compaction 条目
   * （session-manager.ts `appendCompaction`）parentId 指向压缩前的叶子、
   * firstKeptEntryId 指向保留段的第一条 —— 于是「从这个 compaction 条目沿
   * parentId 走到根」恰好就是被这次压缩遮蔽掉的整段可见路径（含上一次压缩的
   * 摘要条目：迭代摘要把它也遮蔽掉，与 dsh 的 shadowedSeqs 同语义）。
   *
   * 不按文件顺序切片：条目树允许分叉，只有本次压缩的父链定义「被遮蔽的可见
   * 那一串」；文件序会混进别的枝。
   *
   * 算不出来时返回 undefined 并**响亮上报**（reportFailure 进 event-log），
   * 不编一个范围出来 —— 记不上的事实必须看得见。
   */
  compactionShadow() {
    const entries = this.session.sessionManager.getEntries();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    let latest;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry !== void 0 && entry.type === "compaction") {
        latest = entry;
        break;
      }
    }
    if (latest === void 0) {
      this.ledger?.reportFailure("压缩遮蔽范围未记录：条目树里找不到刚落下的 compaction 条目");
      return void 0;
    }
    const shadowed = [];
    let parentId = latest.parentId ?? null;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (parent === void 0) {
        this.ledger?.reportFailure(
          `压缩遮蔽范围未记录：条目 ${latest.id} 的父链在 ${parentId} 处断了`
        );
        return void 0;
      }
      shadowed.push(parent);
      parentId = parent.parentId ?? null;
    }
    shadowed.reverse();
    const first = shadowed[0];
    const last = shadowed[shadowed.length - 1];
    if (first === void 0 || last === void 0) return void 0;
    let shadowedTokenCount = 0;
    for (const entry of shadowed) shadowedTokenCount += entryTokens(entry);
    return {
      shadowedRange: { start: first.id, end: last.id },
      shadowedSeqs: shadowed.map((entry) => entry.id),
      shadowedTokenCount
    };
  }
  /**
   * 组装本 run 的快照正文：**按 role 各产一个块**（环境块 / 时间块）。
   * 快照的 section 范围由「每 run 冻结一次 + 内容未变则不追加」定，
   * 见 shared/hidden-context.ts：
   *
   *   1. workspace_context（user-context）—— cwd + 场景 + 交互模式 + 专家。
   *      **cwd 的唯一来源（用户会话）**：系统提示词里已经没有它了（骨架那行随 spec:
   *      stabilize-prompt-prefix 删掉；pi 内置的那行 `cwd` 又被
   *      before_agent_start 的整串替换换掉），中途切场景/换专家
   *      （setScene/setExpert 不重组系统提示词）也只有这里跟得上。
   *      （子代理/成员会话例外：composeSubagentPrompt 会把同一个 cwd 写进自己的
   *      提示词，值同源同为 cwd，不产生两份漂移 —— 见 prompt-compose.js 文件头。）
   *   2. python_env（user-context）—— **托管运行时清单 + 状态**（spec:
   *      add-managed-runtimes 阶段 5）：逐项 id / 版本 / 状态 / 用途，就绪时附
   *      目录与可执行文件绝对路径，被用户禁用或未就绪时附该走的那一步。
   *      **机器事实与开关事实的唯一来源**：它们随机器（homedir、安装位置、
   *      HTML_TO_DOCX_VENV）与用户开关变，不能再进系统提示词（片段 python-env.md
   *      曾用 `{{pythonPath}}` 把它拼进骨架，那就是「换机 / 重建 venv 即断前缀」）。
   *      段名沿用 `python_env`（片段与提示词缓存契约文档都按它指代）。
   *      缺省（宿主拿到 undefined）整段缺席 —— 子代理/成员会话本来就没有这条信息。
   *   3. memory_and_skills_reminder（user-context）—— 记忆三层短指针
   *      （core/memory.ts memoryReminder），全空则整段缺席。
   *   4. current_time（additional-data）—— run 冻结时刻，一次性容器。
   *
   * **两个 role 各出一条消息**（spec: add-supersede-note-and-time-split）：时间
   * 按分钟变、其余三段的字节几乎不变，挤在同一条消息里会让分钟一变整条重发
   * （实测每条 1,066 字符里只有约 20 字符是真新信息）。拆开后两条消息各自按
   * 各自的 customType 去重。
   *
   * 每个 role 没有非空段时该值为 undefined（调用方零成本跳过该通道）——
   * 实际上时间恒有值，环境块在子代理之外的会话也恒有 workspace_context。
   */
  composeRunHiddenContext() {
    const scene = this.options.resources.scenes.find((s) => s.id === this.sceneId);
    const mode = this.options.resources.modes.find((m) => m.id === this.interactionId);
    const cwd = this.sessionCwd === "" ? this.options.cwd : this.sessionCwd;
    const expertLabel = this.options.getExpertLabel?.() ?? this.expertId;
    const workspaceLines = [`工作目录：${cwd}`];
    if (scene !== void 0) workspaceLines.push(`场景：${scene.label}（${scene.id}）`);
    if (mode !== void 0) workspaceLines.push(`交互模式：${mode.label}（${mode.id}）`);
    if (expertLabel !== void 0) workspaceLines.push(`专家：${expertLabel}`);
    const sections = [
      { tag: "workspace_context", role: "user-context", body: workspaceLines.join("\n") }
    ];
    if (this.options.getRuntimeInventory !== void 0) {
      const body = renderRuntimeEnvSection(this.options.getRuntimeInventory());
      if (body !== "") {
        sections.push({ tag: "python_env", role: "user-context", body });
      }
    }
    const memory = memoryReminder(cwd);
    if (memory !== void 0) {
      sections.push({ tag: "memory_and_skills_reminder", role: "user-context", body: memory });
    }
    sections.push({
      tag: "current_time",
      role: "additional-data",
      body: formatRunTime(/* @__PURE__ */ new Date())
    });
    return {
      hidden: composeHiddenBlock(sections, "user-context"),
      runTime: composeHiddenBlock(sections, "additional-data")
    };
  }
  /**
   * 挂 pi 的 transformContext 钩子记请求快照（request_snapshot）。
   *
   * transformContext 是 agent-loop 每次模型调用前的官方观察口
   * （agent-loop.ts streamAssistantResponse：transformContext → convertToLlm → LLM），
   * pi 在 sdk.ts 已把它接到扩展链（emitContext）—— 这里**包一层而不是替换**：
   * 先调原钩子（含全部扩展的改写），对改写结果记快照，然后原样透传返回，
   * 不改写任何消息（快照是观测，不是新的改写点）。
   *
   * 钩子的 pi 侧契约是「must not throw」：记录出错经台账上报通道进 event-log，
   * 绝不炸 run（台账纪律同 run-ledger.ts 文件头）。
   */
  installRequestSnapshot() {
    const agent = this.session.agent;
    const inner = agent.transformContext?.bind(agent);
    agent.transformContext = async (messages, signal) => {
      const transformed = inner === void 0 ? messages : await inner(messages, signal);
      try {
        this.recordRequestSnapshot(transformed);
      } catch (error) {
        this.ledger?.reportFailure(
          `request_snapshot 记录失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
      return transformed;
    };
  }
  /**
   * 记一条 request_snapshot：system 分段 provenance + 消息分类计数 + 逐条标识。
   *
   * **不记正文**（口径钉住）：消息正文在会话 JSONL 已有，台账只记
   * 「这轮往模型里送了什么结构」——分段来源、各类条数/字符数、以及每条消息的
   * 稳定标识与体量（LOG13）。正文双写既膨胀又会与会话 JSONL 漂移，所以逐条
   * 也只落 id / 字符数 / token 估算 / 内容指纹，不落文本。
   *
   * 类别聚合由逐条清单累加而来（同一次循环、同一份文本）：两处各统计一遍
   * 必然漂移，而这两个数字在面板上是并排显示的。
   */
  recordRequestSnapshot(messages) {
    const messageList = buildMessageRefs(messages);
    const byClass = {
      user: { count: 0, chars: 0 },
      assistant: { count: 0, chars: 0 },
      toolResult: { count: 0, chars: 0 },
      other: { count: 0, chars: 0 }
    };
    for (const ref of messageList) {
      byClass[ref.role].count += 1;
      byClass[ref.role].chars += ref.chars;
    }
    this.options.reportContextComposition?.(
      composeRequestComposition(messageList, messages, this.session.agent.state.tools)
    );
    const segments = this.options.getSystemPromptSegments?.();
    this.ledger?.append("request_snapshot", {
      ...this.ledgerRunId === void 0 ? {} : { runId: this.ledgerRunId },
      turnIndex: this.ledgerTurnIndex - 1,
      ...segments === void 0 ? {} : { systemSegments: segments },
      // 快照在注入之后记录（钩子包装顺序见构造器）。hidden context 快照是
      // pi 落盘的普通历史条目（custom_message，落在本轮用户消息之后），它的
      // 字符数计入 messages.other —— 这里把它单独亮出，成分视图好单列一行
      // （口径见 RequestSnapshotData）。**只算环境块**：时间已独立成
      // `zerowork-run-time` 一条，不并进本字段。
      ...this.pendingHidden === void 0 ? {} : { hiddenContextChars: this.pendingHidden.length },
      messages: byClass,
      messageList
    });
  }
  /**
   * 读 write/edit 目标文件的旧内容（执行前调用，此后旧内容就被写掉了）。
   * 返回 undefined 表示目标原本不存在（新建）；存在但不可读时按空串处理
   * 不如让它响 —— 读盘失败说明环境有问题，掩成「新建」会把 diff 全算错。
   */
  readOverwriteTarget(args) {
    if (typeof args !== "object" || args === null) return void 0;
    const { path } = args;
    if (typeof path !== "string" || path === "") return void 0;
    const abs = resolve(this.sessionCwd, path);
    if (!existsSync(abs)) return void 0;
    return readFileSync(abs, "utf8");
  }
  /**
   * toolcall_delta 的处理：累积参数原文，并在 id/name 稳定后发出生成中卡片。
   *
   * 生成期上屏的工具范围见 STREAM_CARD_TOOLS：write/edit 生成期长，
   * web_search/web_fetch 执行期长（网络请求），show_widget 的内容全在参数里，
   * 都需要尽早占位消除空白窗；read/ls/grep/find/read_me 本地瞬时完成，
   * 生成期上屏反而闪一下。
   *
   * write 额外发行数进度（「生成中 +N」的 N 从这里来）。edit 不发 ——
   * 它的参数是嵌套的 edits 数组，流式数行要维护部分 JSON 解析状态机，
   * 成本高收益低，生成中只显示卡片本身（event 注释里也是这个口径）。
   * show_widget 发累积的参数原文（rawArgs）：widget_code 在参数里逐步变长，
   * 渲染层拿半截 JSON 做渐进提取，流式期间即可渲染半成品 widget。
   */
  translateToolCallDelta(inner) {
    const track = this.streamToolCalls.get(inner.contentIndex);
    if (track === void 0) return;
    const block = inner.partial.content[inner.contentIndex];
    if (block === void 0 || block.type !== "toolCall") return;
    if (block.id === "" || block.name === "") return;
    if (!STREAM_CARD_TOOLS.includes(block.name)) return;
    const emit = this.options.emit;
    if (track.emittedId === void 0) {
      track.emittedId = block.id;
      const card = {
        id: block.id,
        role: "tool",
        toolName: block.name,
        // web_search/web_fetch 没有「生成中」语义（标签词汇表里它们
        // 只有执行态标签），直接给执行中标签 —— 执行开始的 tool_started
        // upsert 同一张卡，标签不跳变。write/edit 的 path 还没解析出来，
        // changeType 未知：先按新建给标签，进度事件到达时 reducer 会按
        // 真实 changeType 刷新（生成中→修改中）。
        label: block.name === "write" || block.name === "edit" ? generatingLabel(block.name, "created") : runningLabel(block.name),
        summary: "",
        outcome: void 0,
        detail: void 0,
        generating: true,
        at: Date.now()
      };
      this.toolCards.set(block.id, card);
      emit({ type: "tool_stream_started", card });
    }
    if (block.name === "write") {
      track.rawArgs += inner.delta;
      const progress = writeStreamProgress(track.rawArgs);
      if (progress.path !== void 0) {
        track.changeType ??= existsSync(resolve(this.sessionCwd, progress.path)) ? "modified" : "created";
        emit({
          type: "tool_stream_progress",
          id: block.id,
          path: progress.path,
          added: progress.added,
          changeType: track.changeType
        });
      }
    }
    if (block.name === "show_widget") {
      track.rawArgs += inner.delta;
      emit({
        type: "tool_stream_progress",
        id: block.id,
        // path/added/changeType 是 write 的行数口径，对 show_widget 无意义；
        // 它的进度是参数本体（rawArgs），reducer 见 path===undefined 不动行数。
        path: void 0,
        added: 0,
        changeType: "created",
        rawArgs: track.rawArgs
      });
    }
  }
}

export {
	SessionHost,
};