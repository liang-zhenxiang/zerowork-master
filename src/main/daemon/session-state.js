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
import { getResourcesDir } from "./config-paths.js";
import { readMcpConfig } from "./mcp.js";
import { generatingLabel } from "./ledger.js";
import {
	mergePresentedArtifacts,
	splitSkillBlocks,
} from "./session-view.js";
import {
	createSessionDir,
	isAutoSessionDirName,
	isWorktreePath,
} from "./git-worktree.js";

const CONNECT_TIMEOUT_MS = 3e4;

const MAX_RECONNECT_ATTEMPTS = 5;

const MAX_TOOL_NAME_LENGTH = 64;

function createMcpClient(options) {
  let runtime;
  const usedToolNames = /* @__PURE__ */ new Set();
  return {
    registeredToolNames: () => [...usedToolNames],
    extension: async (pi) => {
      const log = options.log ?? ((message) => console.log(`[mcp] ${message}`));
      const readConfig = options.readConfig ?? readMcpConfig;
      const connect = options.connect ?? connectMcpServer;
      const servers = /* @__PURE__ */ new Map();
      let tearingDown = false;
      const scheduleReconnect = (state) => {
        if (tearingDown) return;
        if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          log(`server「${state.name}」重连 ${MAX_RECONNECT_ATTEMPTS} 次均失败，放弃；重启会话后再试`);
          return;
        }
        const delayMs = Math.min(1e3 * 2 ** state.reconnectAttempts, 8e3);
        state.reconnectAttempts += 1;
        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = void 0;
          void attemptReconnect(state);
        }, delayMs);
        state.reconnectTimer.unref();
      };
      const attemptReconnect = async (state) => {
        try {
          const connection = await connect(state.name, state.config, () => onConnectionLost(state));
          if (tearingDown) {
            await connection.close().catch(() => {
            });
            return;
          }
          state.connection = connection;
          state.error = void 0;
          state.reconnectAttempts = 0;
          log(`server「${state.name}」重连成功`);
        } catch (error) {
          state.error = errText(error);
          log(`server「${state.name}」重连失败：${state.error}`);
          scheduleReconnect(state);
        }
      };
      const onConnectionLost = (state) => {
        if (tearingDown) return;
        state.connection = void 0;
        state.error = "连接已断开";
        log(`server「${state.name}」连接断开，准备指数退避重连`);
        scheduleReconnect(state);
      };
      const connectAndRegister = async (state) => {
        try {
          const connection = await connect(state.name, state.config, () => onConnectionLost(state));
          if (tearingDown) {
            await connection.close().catch(() => {
            });
            return;
          }
          state.connection = connection;
          state.error = void 0;
          state.reconnectAttempts = 0;
          state.toolCount = registerServerTools(pi, state, connection.tools, usedToolNames, log);
          state.toolsRegistered = true;
          log(`server「${state.name}」已连接，注册 ${state.toolCount} 个工具`);
        } catch (error) {
          state.error = errText(error);
          log(`server「${state.name}」连接失败：${state.error}`);
        }
      };
      const detachConnection = (state) => {
        if (state.reconnectTimer !== void 0) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = void 0;
        }
        const connection = state.connection;
        state.connection = void 0;
        state.reconnectAttempts = 0;
        if (connection !== void 0) void connection.close().catch(() => {
        });
      };
      const reloadNow = async () => {
        if (tearingDown) return;
        const next = readConfig(options.cwd);
        for (const [name, state] of [...servers]) {
          if (!(name in next.servers)) {
            detachConnection(state);
            state.error = "已从配置移除";
            servers.delete(name);
          }
        }
        await Promise.all(
          Object.entries(next.servers).map(async ([name, serverConfig]) => {
            const existing = servers.get(name);
            if (existing !== void 0 && sameServerConfig(existing.config, serverConfig)) return;
            if (existing === void 0) {
              const state = newServerState(name, serverConfig);
              servers.set(name, state);
              if (serverConfig.disabled !== true) await connectAndRegister(state);
              return;
            }
            detachConnection(existing);
            existing.config = serverConfig;
            existing.error = void 0;
            if (serverConfig.disabled === true) return;
            if (existing.toolsRegistered) await attemptReconnect(existing);
            else await connectAndRegister(existing);
          })
        );
      };
      let reloadQueue = Promise.resolve();
      const reload = () => {
        const run = reloadQueue.then(() => reloadNow());
        reloadQueue = run.catch(() => {
        });
        return run;
      };
      runtime = {
        getServerStates: () => [...servers.values()].map(snapshotOf),
        reload
      };
      pi.on("session_shutdown", () => {
        tearingDown = true;
        runtime = void 0;
        for (const state of servers.values()) {
          if (state.reconnectTimer !== void 0) clearTimeout(state.reconnectTimer);
          void state.connection?.close().catch(() => {
          });
        }
      });
      let config;
      try {
        config = readConfig(options.cwd);
      } catch (error) {
        log(`配置读取失败，本会话不加载 MCP 工具：${errText(error)}`);
        return;
      }
      await Promise.all(
        Object.entries(config.servers).map(async ([name, serverConfig]) => {
          const state = newServerState(name, serverConfig);
          servers.set(name, state);
          if (serverConfig.disabled === true) return;
          await connectAndRegister(state);
        })
      );
    },
    getServerStates: () => runtime?.getServerStates() ?? [],
    reload: async () => {
      await runtime?.reload();
    }
  };
}

function newServerState(name, config) {
  return {
    name,
    config,
    connection: void 0,
    error: void 0,
    toolsRegistered: false,
    toolCount: 0,
    reconnectAttempts: 0,
    reconnectTimer: void 0
  };
}

function snapshotOf(state) {
  let status;
  if (state.config.disabled === true) status = "disabled";
  else if (state.connection !== void 0) status = "connected";
  else if (state.reconnectTimer !== void 0) status = "connecting";
  else if (state.error !== void 0) status = "failed";
  else status = "connecting";
  return {
    name: state.name,
    status,
    toolCount: state.toolCount,
    ...state.error !== void 0 ? { error: state.error } : {}
  };
}

function sameServerConfig(a, b) {
  if (a.transport !== b.transport) return false;
  if ((a.disabled ?? false) !== (b.disabled ?? false)) return false;
  if (a.transport === "stdio" && b.transport === "stdio") {
    return a.command === b.command && a.args.length === b.args.length && a.args.every((arg, index) => arg === b.args[index]) && sameStringRecord(a.env, b.env);
  }
  if (a.transport === "http" && b.transport === "http") return a.url === b.url;
  return false;
}

function sameStringRecord(a, b) {
  const entries = Object.entries(a);
  if (entries.length !== Object.keys(b).length) return false;
  return entries.every(([key, value]) => b[key] === value);
}

function registerServerTools(pi, state, tools, usedToolNames, log) {
  let registered = 0;
  for (const tool of tools) {
    const name = sanitizeToolName(state.name, tool.name);
    if (usedToolNames.has(name)) {
      log(`server「${state.name}」的工具「${tool.name}」清洗后与已有工具撞名（${name}），跳过`);
      continue;
    }
    usedToolNames.add(name);
    pi.registerTool({
      name,
      label: tool.title ?? tool.name,
      description: tool.description ?? `MCP server「${state.name}」的 ${tool.name} 工具`,
      parameters: tool.inputSchema,
      async execute(_toolCallId, params) {
        if (state.connection === void 0) {
          throw new Error(
            `MCP server「${state.name}」未连接${state.error !== void 0 ? `：${state.error}` : ""}。请检查 mcp.json 配置，或等自动重连成功后重试。`
          );
        }
        const args = isRecord(params) ? params : {};
        const result = await state.connection.callTool(tool.name, args);
        if (result.isError) throw new Error(flattenErrorText(result.content));
        return {
          content: result.content.length > 0 ? [...result.content] : [{ type: "text", text: "（工具执行成功，无输出）" }],
          details: { server: state.name, tool: tool.name }
        };
      }
    });
    registered += 1;
  }
  return registered;
}

function sanitizeToolName(serverName, toolName) {
  const clean = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  const full = `mcp__${clean(serverName)}__${clean(toolName)}`;
  return full.length > MAX_TOOL_NAME_LENGTH ? full.slice(0, MAX_TOOL_NAME_LENGTH) : full;
}

function flattenErrorText(content) {
  const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n").trim();
  return text !== "" ? text : "MCP 工具执行失败（server 未返回错误说明）";
}

async function connectMcpServer(_serverName, config, onClosed) {
  const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js")
  ]);
  const client = new Client({ name: "zerowork", version: "0.1.0" });
  const transport = config.transport === "stdio" ? new StdioClientTransport({
    command: config.command,
    args: [...config.args],
    // 任务要求：process.env + 配置的 env 合并（配置的优先）。
    env: mergedEnv(config.env)
  }) : new StreamableHTTPClientTransport(new URL(config.url));
  client.onclose = onClosed;
  await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor === void 0 ? void 0 : { cursor });
    for (const t of page.tools) {
      tools.push({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema
      });
    }
    cursor = page.nextCursor;
  } while (cursor !== void 0);
  return {
    tools,
    callTool: async (toolName, args) => mapCallResult(await client.callTool({ name: toolName, arguments: args })),
    close: () => client.close()
  };
}

function mergedEnv(configEnv) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) env[key] = value;
  }
  return { ...env, ...configEnv };
}

function mapCallResult(result) {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
  }
  const content = [];
  for (const item of result.content) {
    switch (item.type) {
      case "text":
        content.push({ type: "text", text: item.text });
        break;
      case "image":
        content.push({ type: "image", data: item.data, mimeType: item.mimeType });
        break;
      case "audio":
        content.push({ type: "text", text: `[音频内容（${item.mimeType}），当前无法展示]` });
        break;
      case "resource":
        content.push({
          type: "text",
          text: "text" in item.resource && typeof item.resource.text === "string" ? item.resource.text : `[二进制资源 ${item.resource.uri}（${item.resource.mimeType ?? "未知类型"}），当前无法展示]`
        });
        break;
      case "resource_link":
        content.push({ type: "text", text: `[资源链接] ${item.name}: ${item.uri}` });
        break;
    }
  }
  return { content, isError: result.isError === true };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errText(error) {
  return error instanceof Error ? error.message : String(error);
}

function createTeamOutputHook(options) {
  return (pi) => {
    pi.on("tool_result", (event) => {
      const block = options.composePending();
      if (block === void 0 || block.trim() === "") return void 0;
      return { content: [...event.content, { type: "text", text: block }] };
    });
  };
}

function parseBuiltinCommand(text) {
  if (!text.startsWith("/")) return void 0;
  const space = text.indexOf(" ");
  const name = space === -1 ? text.slice(1) : text.slice(1, space);
  const args = space === -1 ? "" : text.slice(space + 1).trim();
  if (name === "new" && args === "") return { name: "new", args };
  if (name === "plan" && args === "") return { name: "plan", args };
  if (name === "compact") return { name: "compact", args };
  return void 0;
}

function replaceEntry(entries, id, update, match = "first") {
  const index = match === "last" ? entries.findLastIndex((e) => e.id === id) : entries.findIndex((e) => e.id === id);
  if (index === -1) return entries;
  const existing = entries[index];
  if (existing === void 0) return entries;
  const next = entries.slice();
  next[index] = update(existing);
  return next;
}

function taggedWithRun(entry, runId) {
  return runId === void 0 ? entry : { ...entry, runId };
}

function runOf(entry, fallback) {
  return entry.runId ?? fallback;
}

function abortOrphanedGenerating(entries) {
  if (!entries.some((e) => e.role === "tool" && e.generating === true)) return entries;
  return entries.map(
    (e) => e.role === "tool" && e.generating === true ? { ...e, generating: void 0, outcome: "aborted" } : e
  );
}

function stopTurn(turn, cancelled) {
  if (turn === void 0 || turn.endedAt !== void 0) return turn;
  return cancelled ? { ...turn, endedAt: Date.now(), cancelled: true } : { ...turn, endedAt: Date.now() };
}

function markTurnCancelled(entries, cancelledTurns) {
  const index = lastUserEntryIndex(entries);
  const lastUser = index === -1 ? void 0 : entries[index];
  if (lastUser === void 0 || cancelledTurns.includes(lastUser.id)) return cancelledTurns;
  return [...cancelledTurns, lastUser.id];
}

const MAX_TURN_TIMINGS = 100;

function lastUserEntryIndex(entries) {
  return entries.findLastIndex((e) => e.role === "user");
}

function lastTurnId(entries) {
  const index = lastUserEntryIndex(entries);
  return index === -1 ? void 0 : entries[index]?.id;
}

function recordTurnTiming(timings, turnId, timing) {
  const next = { ...timings ?? {}, [turnId]: timing };
  const keys = Object.keys(next);
  if (keys.length <= MAX_TURN_TIMINGS) return next;
  const trimmed = {};
  for (const key of keys.slice(keys.length - MAX_TURN_TIMINGS)) {
    const value = next[key];
    if (value !== void 0) trimmed[key] = value;
  }
  return trimmed;
}

function conversationReducer(view, action) {
  const event = action.event;
  switch (event.type) {
    case "history_reset":
      return {
        ...view,
        state: { ...view.state, sessionId: "", isStreaming: false },
        entries: [],
        usageDetail: void 0,
        sessionStats: void 0,
        turn: void 0,
        turnTimings: {},
        cancelledTurns: [],
        artifacts: [],
        retry: void 0,
        queued: void 0,
        // 压缩态同属运行现场，一并清零（历史都清了，不该还挂着「正在压缩」）。
        compacting: void 0,
        // run 身份随之作废：新历史的条目不该被旧 run 盖章。
        activeRunId: void 0
      };
    case "run_started": {
      const turnId = lastTurnId(view.entries);
      const liveTurn = view.turn;
      return {
        ...view,
        state: { ...view.state, isStreaming: true },
        // 本 run 的身份就位：此后追加的条目都盖这个章（currentRunStartIndex 的判据）。
        activeRunId: event.runId,
        turnTimings: liveTurn !== void 0 && liveTurn.endedAt === void 0 && turnId !== void 0 ? recordTurnTiming(view.turnTimings, turnId, liveTurn) : view.turnTimings,
        retry: void 0
      };
    }
    case "run_finished": {
      const cancelled = event.outcome === "cancelled";
      const turn = stopTurn(view.turn, cancelled);
      const turnId = lastTurnId(view.entries);
      return {
        ...view,
        state: { ...view.state, isStreaming: false },
        entries: abortOrphanedGenerating(view.entries),
        turn,
        // 停表结果同步进映射：键取最后一条 user 消息 id，无 user 消息则无从
        // 起键、跳过（不凭空造回合）。已停表回合 stopTurn 原样返回，写回值不变。
        turnTimings: turn === void 0 || turnId === void 0 ? view.turnTimings : recordTurnTiming(view.turnTimings, turnId, turn),
        // 取消的回合记入名单：指示行要在新回合开始后仍留在历史里。
        cancelledTurns: cancelled ? markTurnCancelled(view.entries, view.cancelledTurns) : view.cancelledTurns,
        // run 落定后重试态必须清掉，避免终态后还挂「N 秒后重试」。
        retry: void 0
      };
    }
    case "run_error": {
      const turn = stopTurn(view.turn, false);
      const turnId = lastTurnId(view.entries);
      return {
        ...view,
        state: { ...view.state, isStreaming: false },
        entries: [
          ...abortOrphanedGenerating(view.entries),
          {
            id: `error-${event.runId}`,
            role: "error",
            message: event.message,
            runId: event.runId,
            at: Date.now()
          }
        ],
        turn,
        turnTimings: turn === void 0 || turnId === void 0 ? view.turnTimings : recordTurnTiming(view.turnTimings, turnId, turn),
        retry: void 0
      };
    }
    case "user_message":
      return {
        ...view,
        entries: [...view.entries, taggedWithRun(event.message, view.activeRunId)],
        turn: { startedAt: event.message.at },
        // 以「开轮 user 消息 id」为键记入计时映射：与 renderer 的轮切分
        // （turn-fold.ts 用 user.id 作 turnId）同一口径，历史回合头部据此查回计时。
        turnTimings: recordTurnTiming(view.turnTimings, event.message.id, {
          startedAt: event.message.at
        }),
        retry: void 0
      };
    case "assistant_started":
      return {
        ...view,
        entries: [
          ...view.entries,
          taggedWithRun({ id: event.messageId, role: "assistant", text: "", at: event.at }, view.activeRunId)
        ]
      };
    case "assistant_text_delta":
      return {
        ...view,
        entries: replaceEntry(
          view.entries,
          event.messageId,
          (entry) => entry.role === "assistant" ? { ...entry, text: entry.text + event.delta } : entry,
          "last"
        )
      };
    case "assistant_thinking_delta":
      return {
        ...view,
        entries: replaceEntry(
          view.entries,
          event.messageId,
          (entry) => entry.role === "assistant" ? { ...entry, thinking: (entry.thinking ?? "") + event.delta } : entry,
          "last"
        )
      };
    case "assistant_done": {
      const done = event.message;
      const replaced = replaceEntry(view.entries, done.id, (entry) => taggedWithRun(done, runOf(entry, view.activeRunId)), "last");
      return {
        ...view,
        entries: replaced === view.entries ? [...view.entries, taggedWithRun(done, view.activeRunId)] : replaced
      };
    }
    case "tool_stream_started":
    case "tool_started": {
      const card = event.card;
      const replaced = replaceEntry(view.entries, card.id, (entry) => taggedWithRun(card, runOf(entry, view.activeRunId)));
      return {
        ...view,
        entries: replaced === view.entries ? [...view.entries, taggedWithRun(card, view.activeRunId)] : replaced
      };
    }
    case "tool_stream_progress":
      return {
        ...view,
        entries: replaceEntry(view.entries, event.id, (entry) => {
          if (entry.role !== "tool") return entry;
          const withArgs = event.rawArgs !== void 0 ? { ...entry, streamArgs: event.rawArgs } : entry;
          if (event.path === void 0) return withArgs;
          return {
            ...withArgs,
            label: generatingLabel(entry.toolName, event.changeType),
            summary: event.path,
            change: {
              path: event.path,
              added: event.added,
              removed: 0,
              changeType: event.changeType
            }
          };
        })
      };
    case "tool_progress":
      return {
        ...view,
        entries: replaceEntry(
          view.entries,
          event.id,
          (entry) => entry.role === "tool" ? { ...entry, detail: (entry.detail ?? "") + event.delta } : entry
        )
      };
    case "subagent_progress":
      return {
        ...view,
        entries: replaceEntry(
          view.entries,
          event.id,
          (entry) => entry.role === "tool" ? { ...entry, subagents: event.agents } : entry
        )
      };
    case "team_member_progress": {
      let teamCardIndex = -1;
      for (let i = view.entries.length - 1; i >= 0; i -= 1) {
        const entry = view.entries[i];
        if (entry !== void 0 && entry.role === "tool" && entry.toolName === "team_create") {
          teamCardIndex = i;
          break;
        }
      }
      if (teamCardIndex === -1) return view;
      return {
        ...view,
        entries: view.entries.map(
          (entry, i) => i === teamCardIndex && entry.role === "tool" ? { ...entry, subagents: event.members } : entry
        )
      };
    }
    case "tool_finished": {
      const card = event.card;
      const replaced = replaceEntry(view.entries, card.id, (entry) => taggedWithRun(card, runOf(entry, view.activeRunId)));
      return {
        ...view,
        entries: replaced === view.entries ? [...view.entries, taggedWithRun(card, view.activeRunId)] : replaced
      };
    }
    case "session_state":
      return {
        ...view,
        state: event.state,
        usageDetail: event.state.contextUsage === void 0 ? void 0 : view.usageDetail,
        // 换了会话（新建 / 切换）时旧会话的统计对新会话是错的，清掉；
        // 同一会话则保留 —— 统计由 session_stats 事件独立更新（session_state
        // 不携带它），无条件清会让指标条在每次状态重推后闪空一下。
        sessionStats: event.state.sessionId === view.state.sessionId ? view.sessionStats : void 0,
        compacting: void 0
      };
    case "context_usage":
      return { ...view, usageDetail: event.usage };
    case "session_stats":
      return { ...view, sessionStats: event.stats };
    case "artifacts_presented":
      return {
        ...view,
        artifacts: mergePresentedArtifacts(view.artifacts, event.files, Date.now())
      };
    case "run_retry":
      if (event.status === "start") {
        return {
          ...view,
          retry: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            retryAt: Date.now() + event.delayMs,
            ...event.errorMessage === void 0 ? {} : { errorMessage: event.errorMessage }
          }
        };
      }
      return { ...view, retry: void 0 };
    case "queue_changed": {
      const queued = { steering: event.steering, followUp: event.followUp };
      const empty = queued.steering.length === 0 && queued.followUp.length === 0;
      return { ...view, queued: empty ? void 0 : queued };
    }
    case "compaction_started":
      return { ...view, compacting: { reason: event.reason, startedAt: Date.now() } };
    case "compaction_finished":
      return { ...view, compacting: void 0 };
    default:
      return view;
  }
}

function artifactsFromEntries(entries) {
  let acc = [];
  for (const entry of entries) {
    if (entry.role !== "artifacts_presented") continue;
    acc = mergePresentedArtifacts(acc, entry.files, entry.at);
  }
  return acc;
}

const MAX_IDLE_HOSTS = 5;

const SPAWN_BUDGET_PER_SESSION = 20;

function createBucket(options) {
  return {
    hostPromise: void 0,
    sessionId: "",
    sessionFilePath: void 0,
    conversation: options.conversation,
    cwd: options.cwd,
    pendingWorktreeBranch: void 0,
    worktree: void 0,
    running: false,
    hasTeam: false,
    pendingApprovals: 0,
    spawnBudgetRemaining: options.spawnBudget ?? SPAWN_BUDGET_PER_SESSION,
    pendingOps: 0,
    tail: Promise.resolve(),
    lastUsedAt: Date.now(),
    lastNonPlanInteraction: "craft",
    systemPromptTokens: 0,
    skillsTokens: 0,
    systemPromptSegments: void 0,
    contextComposition: void 0,
    skippedLines: void 0
  };
}

function enqueue(bucket, op) {
  bucket.pendingOps += 1;
  const run = bucket.tail.then(op, op);
  bucket.tail = run.finally(() => {
    bucket.pendingOps -= 1;
  });
  return run;
}

function pickEvictions(buckets, current, maxIdle = MAX_IDLE_HOSTS) {
  const idle = [];
  for (const bucket of buckets) {
    if (bucket === current) continue;
    if (bucket.hostPromise === void 0) continue;
    if (bucket.hasTeam) continue;
    if (bucket.running || bucket.pendingApprovals > 0 || bucket.pendingOps > 0) continue;
    idle.push(bucket);
  }
  if (idle.length <= maxIdle) return [];
  idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  return idle.slice(0, idle.length - maxIdle);
}

const LEGACY_TEMP_TASKS_DIR_NAME = "临时任务";

function isTaskPrivateCwd(cwd, configDir) {
  const name = basename(cwd);
  return isAutoSessionDirName(name) || name === LEGACY_TEMP_TASKS_DIR_NAME || cwd === join(configDir, "playground") || /*
  * worktree 副本（对齐清单 C22 / L27）：启用副本的会话 cwd 指向
  * `<配置目录>/worktrees/<仓库名>/<分支 id>`。归任务区的理由是它不是用户
  * 经营的工作空间 —— 进空间区会以 `main-a1b2c3d4` 这种目录名成组。
  */
  isWorktreePath(cwd);
}

function isTaskCwd(cwd, configDir) {
  return cwd === "" || isTaskPrivateCwd(cwd, configDir);
}

function isSelectableWorkspaceDir(dir) {
  const name = basename(dir);
  return !isAutoSessionDirName(name) && name !== LEGACY_TEMP_TASKS_DIR_NAME;
}

function allocatePendingCwd(cwd, root, now) {
  return cwd === "" ? createSessionDir(root) : cwd;
}

function isRevealableCwd(cwd, knownCwds) {
  const target = resolve(cwd);
  return knownCwds.some((known) => resolve(known) === target);
}

function isDaemonRequest(frame) {
  return typeof frame === "object" && frame !== null && frame.kind === "request";
}

const BUNDLED_BINARIES = ["fd", "rg"];

async function ensureAgentTools(options = {}) {
  const platform = options.platform ?? process.platform;
  const sourceDir = options.sourceDir ?? join(getResourcesDir(), "bin");
  const targetDir = options.targetDir ?? join((await import("@earendil-works/pi-coding-agent")).getAgentDir(), "bin");
  const binaries = options.binaries ?? BUNDLED_BINARIES;
  if (platform !== "win32") {
    return {
      targetDir,
      installed: [],
      present: [],
      missing: [],
      skipped: `随包资产只有 Windows x64（当前 ${platform}）`
    };
  }
  const installed = [];
  const present = [];
  const missing = [];
  for (const name of binaries) {
    const file = `${name}.exe`;
    const target = join(targetDir, file);
    if (existsSync(target)) {
      present.push(name);
      continue;
    }
    const source = join(sourceDir, file);
    if (!existsSync(source)) {
      missing.push(name);
      continue;
    }
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, target);
    installed.push(name);
    present.push(name);
  }
  return { targetDir, installed, present, missing };
}

const TIMEOUT_MS = 1e4;

function buildRequest(target) {
  const base = target.baseUrl.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...target.extraHeaders
  };
  const key = target.apiKey;
  const bearer = key === void 0 ? {} : { authorization: `Bearer ${key}` };
  if (target.api === "openai-completions") {
    return {
      url: `${base}/chat/completions`,
      init: {
        method: "POST",
        headers: { ...headers, ...bearer },
        body: JSON.stringify({
          model: target.modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false
        })
      }
    };
  }
  if (target.api === "openai-responses" || target.api === "azure-openai-responses" || target.api === "openai-codex-responses") {
    return {
      url: `${base}/responses`,
      init: {
        method: "POST",
        headers: { ...headers, ...bearer },
        body: JSON.stringify({ model: target.modelId, input: "ping", max_output_tokens: 16 })
      }
    };
  }
  if (target.api === "anthropic-messages") {
    const auth = key === void 0 ? {} : target.authHeader === true ? { authorization: `Bearer ${key}` } : { "x-api-key": key };
    return {
      url: `${base}/v1/messages`,
      init: {
        method: "POST",
        headers: {
          ...headers,
          ...auth,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: target.modelId,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      }
    };
  }
  if (target.api === "google-generative-ai") {
    return {
      url: `${base}/models/${encodeURIComponent(target.modelId)}:generateContent`,
      init: {
        method: "POST",
        headers: { ...headers, ...key === void 0 ? {} : { "x-goog-api-key": key } },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
      }
    };
  }
  return void 0;
}

function statusError(status) {
  if (status === 401 || status === 403) return "API Key 无效或权限不足";
  if (status === 404) return "模型不存在或接口路径不对";
  if (status === 429) return "触发服务商限流，稍后再试";
  if (status >= 500) return "服务商接口异常，稍后再试";
  return `请求被拒绝（${status}）`;
}

async function probeModel(target, fetchImpl = fetch) {
  const request = buildRequest(target);
  if (request === void 0) {
    return { ok: false, error: `该协议（${target.api}）暂不支持连通测试` };
  }
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("abort") || message.includes("timeout") || message.includes("Timeout")) {
      return { ok: false, error: `连接超时（${TIMEOUT_MS / 1e3} 秒无响应）` };
    }
    return { ok: false, error: "网络连接失败，请检查网络与接口地址" };
  }
  const latencyMs = Date.now() - startedAt;
  if (response.ok) return { ok: true, latencyMs };
  if (response.status === 429) return { ok: true, latencyMs, error: "连通正常，但正在限流" };
  return { ok: false, error: statusError(response.status) };
}

function buildContextUsage(args) {
  const skills = Math.min(Math.max(args.skillsTokens, 0), Math.max(args.systemPromptTokens, 0));
  const systemPrompt = Math.max(args.systemPromptTokens, 0) - skills;
  const byCategory = {
    systemPrompt,
    skills,
    conversation: args.composition.conversation,
    toolResults: args.composition.toolResults,
    toolDefinitions: args.composition.toolDefinitions
  };
  return {
    used: args.used,
    total: args.total,
    byCategory: {
      ...byCategory,
      other: Math.max(0, args.used - contextUsageCategorized(byCategory))
    }
  };
}

function contextUsageCategorized(category) {
  return category.systemPrompt + category.skills + category.conversation + category.toolResults + category.toolDefinitions;
}

const EMPTY_COMPOSITION = {
  conversation: 0,
  toolResults: 0,
  toolDefinitions: 0
};

function deriveContextUsageDetail(args) {
  if (args.contextUsage === void 0) return void 0;
  return buildContextUsage({
    used: args.contextUsage.usedTokens,
    total: args.contextUsage.maxTokens,
    systemPromptTokens: args.systemPromptTokens,
    skillsTokens: args.skillsTokens,
    composition: args.composition ?? EMPTY_COMPOSITION
  });
}

const SCAN_LIMIT = 200;

const SNIPPET_RADIUS = 200;

const SESSION_TITLE_MAX = 40;

function deriveSessionTitle(name, firstMessage) {
  if (name !== void 0 && name !== "") return name;
  const { skillNames, text } = splitSkillBlocks(firstMessage);
  const source = text !== "" ? text : skillNames[0] ?? "";
  const oneLine = source.replace(/\s+/g, " ").trim();
  if (oneLine === "") return "（空会话）";
  return oneLine.length > SESSION_TITLE_MAX ? `${oneLine.slice(0, SESSION_TITLE_MAX)}…` : oneLine;
}

function entryText(entry) {
  if (entry.type !== "message") return void 0;
  const message = entry.message;
  if (message === void 0) return void 0;
  if (message.role !== "user" && message.role !== "assistant") return void 0;
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return void 0;
  let text = "";
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") text += block.text;
  }
  return text === "" ? void 0 : text;
}

function extractSnippet(text, matchStart, matchEnd) {
  const start2 = Math.max(0, matchStart - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchEnd + SNIPPET_RADIUS);
  const body = text.slice(start2, end).replace(/\s+/g, " ").trim();
  return `${start2 > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function searchOneFile(content, terms) {
  const lines = content.split("\n");
  let sessionId;
  let sawHeader = false;
  let name;
  let firstUserText = "";
  let hit;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!sawHeader) {
      if (entry.type !== "session" || typeof entry.id !== "string") return null;
      sawHeader = true;
      sessionId = entry.id;
      continue;
    }
    if (entry.type === "session_info") {
      if (typeof entry.name === "string" && entry.name.trim() !== "") {
        name = entry.name.trim();
      } else {
        name = void 0;
      }
      continue;
    }
    const text = entryText(entry);
    if (text === void 0) continue;
    if (firstUserText === "" && entry.message?.role === "user") firstUserText = text;
    if (hit === void 0) {
      const lower = text.toLowerCase();
      let matchStart = Number.POSITIVE_INFINITY;
      let matchEnd = 0;
      let allFound = true;
      for (const term of terms) {
        const at = lower.indexOf(term);
        if (at === -1) {
          allFound = false;
          break;
        }
        matchStart = Math.min(matchStart, at);
        matchEnd = Math.max(matchEnd, at + term.length);
      }
      if (allFound) hit = { text, matchStart, matchEnd };
    }
  }
  if (!sawHeader || sessionId === void 0 || hit === void 0) return null;
  return {
    sessionId,
    title: deriveSessionTitle(name, firstUserText),
    text: hit.text,
    matchStart: hit.matchStart,
    matchEnd: hit.matchEnd
  };
}

export {
	BUNDLED_BINARIES,
	CONNECT_TIMEOUT_MS,
	EMPTY_COMPOSITION,
	LEGACY_TEMP_TASKS_DIR_NAME,
	MAX_IDLE_HOSTS,
	MAX_RECONNECT_ATTEMPTS,
	MAX_TOOL_NAME_LENGTH,
	MAX_TURN_TIMINGS,
	SCAN_LIMIT,
	SESSION_TITLE_MAX,
	SNIPPET_RADIUS,
	SPAWN_BUDGET_PER_SESSION,
	TIMEOUT_MS,
	abortOrphanedGenerating,
	allocatePendingCwd,
	artifactsFromEntries,
	buildContextUsage,
	buildRequest,
	connectMcpServer,
	contextUsageCategorized,
	conversationReducer,
	createBucket,
	createMcpClient,
	createTeamOutputHook,
	deriveContextUsageDetail,
	deriveSessionTitle,
	enqueue,
	ensureAgentTools,
	entryText,
	errText,
	extractSnippet,
	flattenErrorText,
	isDaemonRequest,
	isRecord,
	isRevealableCwd,
	isSelectableWorkspaceDir,
	isTaskCwd,
	isTaskPrivateCwd,
	lastTurnId,
	lastUserEntryIndex,
	mapCallResult,
	markTurnCancelled,
	mergedEnv,
	newServerState,
	parseBuiltinCommand,
	pickEvictions,
	probeModel,
	recordTurnTiming,
	registerServerTools,
	replaceEntry,
	runOf,
	sameServerConfig,
	sameStringRecord,
	sanitizeToolName,
	searchOneFile,
	snapshotOf,
	statusError,
	stopTurn,
	taggedWithRun,
};