import { basename } from "node:path";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { extname } from "node:path";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { normalize as normalize$1 } from "node:path";
import { relative } from "node:path";
import { resolve } from "node:path";
import { sep } from "node:path";
import {
	cacheHitRate,
	reportsCacheActivity,
	stepDecode,
} from "./model-catalog.js";
import {
	listLedgerFiles,
	readLedgerEntries,
} from "./ledger.js";

const MAX_RUNS_PER_SESSION = 20;

const RUN_CARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1e3;

const CACHE_TTL_MS = 5 * 60 * 1e3;

const CACHE_MISS_NOISE_FLOOR_TOKENS = 1024;

const MAX_CACHE_MISSES = 50;

function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 11904 && code <= 40959 || code >= 63744 && code <= 64255 || code >= 65280 && code <= 65519) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}

function estimateComposition(entries, systemPromptTokens) {
  if (entries.length === 0 && systemPromptTokens === 0) return void 0;
  const composition = {
    system: systemPromptTokens,
    user: 0,
    assistant: 0,
    thinking: 0,
    tools: 0
  };
  for (const entry of entries) {
    if (entry.role === "user") {
      composition.user += estimateTokens(entry.text);
    } else if (entry.role === "assistant") {
      composition.assistant += estimateTokens(entry.text);
      composition.thinking += estimateTokens(entry.thinking ?? "");
    } else if (entry.role === "tool") {
      composition.tools += estimateTokens(
        `${entry.summary}
${entry.detail ?? ""}`
      );
    }
  }
  return composition;
}

function mutableUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    reasoning: void 0,
    cacheWrite1h: void 0,
    costBreakdown: void 0
  };
}

function addUsage(total, delta) {
  total.input += delta.input;
  total.output += delta.output;
  total.cacheRead += delta.cacheRead;
  total.cacheWrite += delta.cacheWrite;
  total.totalTokens += delta.totalTokens;
  total.cost += delta.cost;
  if (delta.reasoning !== void 0) {
    total.reasoning = (total.reasoning ?? 0) + delta.reasoning;
  }
  if (delta.cacheWrite1h !== void 0) {
    total.cacheWrite1h = (total.cacheWrite1h ?? 0) + delta.cacheWrite1h;
  }
  if (delta.costBreakdown !== void 0) {
    const bd = delta.costBreakdown;
    if (total.costBreakdown === void 0) {
      total.costBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }
    total.costBreakdown.input += bd.input;
    total.costBreakdown.output += bd.output;
    total.costBreakdown.cacheRead += bd.cacheRead;
    total.costBreakdown.cacheWrite += bd.cacheWrite;
  }
}

function freezeUsage(usage) {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    ...usage.reasoning === void 0 ? {} : { reasoning: usage.reasoning },
    ...usage.cacheWrite1h === void 0 ? {} : { cacheWrite1h: usage.cacheWrite1h },
    ...usage.costBreakdown === void 0 ? {} : { costBreakdown: { ...usage.costBreakdown } }
  };
}

function mutableSessionStats() {
  return {
    runs: 0,
    turns: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftCalls: 0,
    decodeMs: 0,
    decodeTokens: 0,
    usage: mutableUsage(),
    lastActiveAt: 0,
    cacheReported: false,
    cacheMissedTokens: 0,
    cacheMissCount: 0,
    currentRunModel: void 0,
    prevRequest: void 0
  };
}

function missedCost(usage, missedTokens) {
  const bd = usage.costBreakdown;
  if (bd === void 0) return 0;
  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0 ? (bd.input + bd.cacheWrite) / paidTokens : 0;
  const readPerToken = usage.cacheRead > 0 ? bd.cacheRead / usage.cacheRead : 0;
  return missedTokens * Math.max(0, paidPerToken - readPerToken);
}

class ObservabilityStore {
  startedAt;
  now;
  /** 全进程累计用量（回放历史 + 实时增量）。 */
  totalUsage = mutableUsage();
  totalRuns = 0;
  totalErrors = 0;
  /** sessionId → run 卡片（新的在前 unshift，按 MAX_RUNS_PER_SESSION 截尾）。 */
  runsBySession = /* @__PURE__ */ new Map();
  /** runId → 进行中的 run，run_finished / run_error 时回填终态。 */
  currentRun;
  tools = /* @__PURE__ */ new Map();
  /** toolCallId → 开始时间，tool_finished 时算耗时。 */
  openTools = /* @__PURE__ */ new Map();
  /** sessionId → 最近一次 session_state 的模型与两轴，作为该会话下一条 run_started 的快照信息。 */
  axesBySession = /* @__PURE__ */ new Map();
  /** sessionId → 会话级统计累计（台账 fold，重启经回放续上）。 */
  sessions = /* @__PURE__ */ new Map();
  /** 缓存浪费合计与明细（新的在前 unshift，按 MAX_CACHE_MISSES 截尾）。 */
  cacheWaste = { missedTokens: 0, missedCost: 0, missCount: 0 };
  cacheMisses = [];
  constructor(now = Date.now) {
    this.startedAt = now();
    this.now = now;
  }
  /* ── 台账 fold（历史回放 + 增量共用同一条 fold）────────────────── */
  /**
   * 启动回放：fold 目录下全部台账文件重建聚合。
   * 只在启动时调一次（重复调用会把历史重复累计）；调用前必须先
   * RunLedger.sealOrphans —— 否则中断的 run 没有合成闭合，回放会把它们
   * 当成「至今仍在跑」。
   */
  replayLedgerDir(dir, report) {
    for (const filePath of listLedgerFiles(dir)) {
      const sessionId = basename(filePath, ".jsonl");
      this.replaySessionLedger(sessionId, readLedgerEntries(filePath, report));
    }
  }
  /** 回放单会话台账：run 卡片重建 + 会话级/缓存 fold（与增量共用 foldLedgerEntry）。 */
  replaySessionLedger(sessionId, entries) {
    let open;
    for (const entry of entries) {
      this.foldLedgerEntry(sessionId, entry);
      switch (entry.kind) {
        case "run_start": {
          const data = entry.data;
          open = {
            runId: data.runId,
            sessionId,
            startedAt: entry.at,
            endedAt: void 0,
            status: "running",
            error: void 0,
            modelId: data.modelId,
            // 台账不记两轴（run_start 只有模型），回放卡片的两轴留空。
            sceneId: "",
            interactionId: "",
            usage: void 0,
            toolCalls: 0,
            toolErrors: 0,
            toolSpans: /* @__PURE__ */ new Map()
          };
          break;
        }
        case "llm_call": {
          const data = entry.data;
          if (data.usage !== void 0) {
            addUsage(this.totalUsage, data.usage);
            if (open !== void 0) {
              if (open.usage === void 0) open.usage = mutableUsage();
              addUsage(open.usage, data.usage);
            }
          }
          break;
        }
        case "tool_call": {
          const data = entry.data;
          const ms = Math.max(0, data.endedAt - data.startedAt);
          const stat2 = this.toolStat(data.toolName, data.toolName);
          stat2.calls += 1;
          stat2.totalMs += ms;
          stat2.finished += 1;
          if (data.outcome === "error") stat2.errors += 1;
          if (open !== void 0) {
            open.toolCalls += 1;
            if (data.outcome === "error") open.toolErrors += 1;
            open.toolSpans.set(data.toolCallId, {
              toolName: data.toolName,
              label: data.toolName,
              summary: data.summary,
              startedAt: data.startedAt,
              endedAt: data.endedAt,
              outcome: data.outcome
            });
          }
          break;
        }
        case "run_end": {
          if (open === void 0) break;
          const data = entry.data;
          open.endedAt = entry.at;
          if (data.reason === "error") {
            open.status = "error";
            open.error = data.error;
            this.totalErrors += 1;
          } else if (data.reason === "interrupted") {
            open.status = "error";
            open.error = "进程中断，台账合成闭合";
          } else {
            open.status = "ok";
          }
          this.pushRunCard(open);
          this.totalRuns += 1;
          open = void 0;
          break;
        }
      }
    }
    if (open !== void 0) {
      open.status = "error";
      open.error = "台账缺少 run_end（疑似写入丢失）";
      this.pushRunCard(open);
      this.totalRuns += 1;
    }
  }
  /**
   * 增量 fold：一条台账条目到账即投影（RunLedger onAppended 钩子喂入）。
   * 只进会话级统计与缓存浪费 —— 实时 run 卡片由 record() 建，两边都建就双计了。
   */
  foldLedgerEntry(sessionId, entry) {
    const stats = this.sessionStats(sessionId);
    if (entry.at > stats.lastActiveAt) stats.lastActiveAt = entry.at;
    switch (entry.kind) {
      case "run_start": {
        stats.runs += 1;
        stats.currentRunModel = entry.data.modelId;
        return;
      }
      case "run_end": {
        stats.currentRunModel = void 0;
        return;
      }
      case "llm_call": {
        this.foldLlmCall(sessionId, stats, entry.data);
        return;
      }
      case "tool_call": {
        const data = entry.data;
        stats.toolMs += Math.max(0, data.endedAt - data.startedAt);
        return;
      }
      case "compaction": {
        stats.prevRequest = void 0;
        return;
      }
      default:
        return;
    }
  }
  /** llm_call 的会话级累计 + 缓存浪费归因（pi cache-stats 的 scan 移植）。 */
  foldLlmCall(sessionId, stats, data) {
    stats.turns += 1;
    const elapsedMs = Math.max(0, data.endedAt - data.startedAt);
    stats.llmMs += elapsedMs;
    const ttftMs = data.ttftMs === void 0 ? void 0 : Math.max(0, data.ttftMs);
    if (ttftMs !== void 0) {
      stats.ttftMs += ttftMs;
      stats.ttftCalls += 1;
    }
    const usage = data.usage;
    if (usage === void 0) return;
    const decode = stepDecode(data);
    if (decode !== void 0) {
      stats.decodeMs += decode.ms;
      stats.decodeTokens += decode.tokens;
    }
    addUsage(stats.usage, usage);
    if (reportsCacheActivity(usage)) stats.cacheReported = true;
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    if (promptTokens <= 0) return;
    const prev = stats.prevRequest;
    const modelKey = stats.currentRunModel;
    if (prev !== void 0 && (usage.cacheRead + usage.cacheWrite > 0 || prev.reportedCache)) {
      const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
      if (missedTokens > CACHE_MISS_NOISE_FLOOR_TOKENS) {
        const idleMs = Math.max(0, data.startedAt - prev.endedAt);
        const modelChanged = modelKey !== void 0 && prev.modelKey !== void 0 && modelKey !== prev.modelKey;
        const reason = modelChanged ? "model_change" : idleMs >= CACHE_TTL_MS ? "idle_ttl" : "other";
        const cost = missedCost(usage, missedTokens);
        this.cacheWaste.missedTokens += missedTokens;
        this.cacheWaste.missedCost += cost;
        this.cacheWaste.missCount += 1;
        stats.cacheMissedTokens += missedTokens;
        stats.cacheMissCount += 1;
        this.cacheMisses.unshift({
          sessionId,
          at: data.startedAt,
          missedTokens,
          missedCost: cost,
          idleMs,
          reason
        });
        if (this.cacheMisses.length > MAX_CACHE_MISSES) this.cacheMisses.pop();
      }
    }
    stats.prevRequest = {
      promptTokens,
      modelKey,
      endedAt: data.endedAt,
      reportedCache: (prev?.reportedCache ?? false) || usage.cacheRead + usage.cacheWrite > 0
    };
  }
  sessionStats(sessionId) {
    let stats = this.sessions.get(sessionId);
    if (stats === void 0) {
      stats = mutableSessionStats();
      this.sessions.set(sessionId, stats);
    }
    return stats;
  }
  pushRunCard(run) {
    let bucket = this.runsBySession.get(run.sessionId);
    if (bucket === void 0) {
      bucket = [];
      this.runsBySession.set(run.sessionId, bucket);
    }
    bucket.unshift(run);
    if (bucket.length > MAX_RUNS_PER_SESSION) bucket.pop();
  }
  /* ── 实时事件投影（本进程新产生的 run 卡片 / 工具统计 / 进程累计）─── */
  record(sessionId, event) {
    switch (event.type) {
      case "session_state": {
        this.axesBySession.set(sessionId, {
          modelId: event.state.modelId,
          sceneId: event.state.sceneId,
          interactionId: event.state.interactionId
        });
        return;
      }
      case "run_started": {
        const axes = this.axesBySession.get(sessionId);
        const run = {
          runId: event.runId,
          sessionId,
          startedAt: this.now(),
          endedAt: void 0,
          status: "running",
          error: void 0,
          modelId: axes?.modelId,
          sceneId: axes?.sceneId ?? "",
          interactionId: axes?.interactionId ?? "",
          usage: void 0,
          toolCalls: 0,
          toolErrors: 0,
          toolSpans: /* @__PURE__ */ new Map()
        };
        this.currentRun = run;
        this.pushRunCard(run);
        this.totalRuns += 1;
        return;
      }
      case "assistant_done": {
        const usage = event.message.usage;
        if (usage === void 0) return;
        addUsage(this.totalUsage, usage);
        const run = this.currentRun;
        if (run !== void 0) {
          if (run.usage === void 0) run.usage = mutableUsage();
          addUsage(run.usage, usage);
        }
        return;
      }
      case "tool_started": {
        this.openTools.set(event.card.id, event.card.at);
        const run = this.currentRun;
        if (run !== void 0) {
          run.toolCalls += 1;
          run.toolSpans.set(event.card.id, {
            toolName: event.card.toolName,
            label: event.card.label,
            summary: event.card.summary,
            startedAt: event.card.at,
            endedAt: void 0,
            outcome: void 0
          });
        }
        const stat2 = this.toolStat(event.card.toolName, event.card.label);
        stat2.label = event.card.label;
        stat2.calls += 1;
        return;
      }
      case "tool_finished": {
        const started = this.openTools.get(event.card.id);
        this.openTools.delete(event.card.id);
        const span = this.currentRun?.toolSpans.get(event.card.id);
        if (span !== void 0) {
          span.endedAt = this.now();
          span.outcome = event.card.outcome;
        }
        const stat2 = this.toolStat(event.card.toolName, event.card.label);
        if (event.card.outcome === "error") {
          stat2.errors += 1;
          if (this.currentRun !== void 0) this.currentRun.toolErrors += 1;
        }
        if (started !== void 0) {
          stat2.totalMs += this.now() - started;
          stat2.finished += 1;
        }
        return;
      }
      case "run_finished": {
        this.finishRun("ok", void 0);
        return;
      }
      case "run_error": {
        this.finishRun("error", event.message);
        return;
      }
      default:
        return;
    }
  }
  finishRun(status, error) {
    const run = this.currentRun;
    if (run === void 0) return;
    if (status === "error") this.totalErrors += 1;
    run.status = status;
    run.error = error;
    run.endedAt = this.now();
    this.currentRun = void 0;
  }
  toolStat(toolName, label) {
    let stat2 = this.tools.get(toolName);
    if (stat2 === void 0) {
      stat2 = { label, calls: 0, errors: 0, totalMs: 0, finished: 0 };
      this.tools.set(toolName, stat2);
    }
    return stat2;
  }
  /**
   * 会话累计 → 对外快照卡。snapshot() 与 sessionCard() 共用**这一处**构造 ——
   * 两处各构造一份必然漂移（同 shared/conversation.ts 的「两端不各算一份」）。
   */
  freezeSessionCard(sessionId, s) {
    const usage = freezeUsage(s.usage);
    return {
      sessionId,
      runs: s.runs,
      turns: s.turns,
      llmMs: s.llmMs,
      toolMs: s.toolMs,
      ttftMs: s.ttftMs,
      ttftCalls: s.ttftCalls,
      decodeMs: s.decodeMs,
      decodeTokens: s.decodeTokens,
      usage,
      cacheReported: s.cacheReported,
      cacheHitRate: cacheHitRate(usage, s.cacheReported),
      cacheMissedTokens: s.cacheMissedTokens,
      cacheMissCount: s.cacheMissCount,
      lastActiveAt: s.lastActiveAt
    };
  }
  /**
   * 单个会话的统计卡（daemon 推送 session_stats 事件用）。
   * 该会话还没有任何台账条目时返回 undefined —— 调用方据此**不推**，
   * 而不是推一张全零的卡让聊天页显示「0 轮 · 0 步」。
   */
  sessionCard(sessionId) {
    const stats = this.sessions.get(sessionId);
    return stats === void 0 ? void 0 : this.freezeSessionCard(sessionId, stats);
  }
  snapshot(args) {
    const tools = [...this.tools.entries()].map(([toolName, s]) => ({
      toolName,
      label: s.label,
      calls: s.calls,
      errors: s.errors,
      avgMs: s.finished === 0 ? 0 : Math.round(s.totalMs / s.finished)
    })).sort((a, b) => b.calls - a.calls);
    const windowStart = this.now() - RUN_CARD_WINDOW_MS;
    const runs = [...this.runsBySession.values()].flat().filter((r) => r.startedAt >= windowStart).sort((a, b) => b.startedAt - a.startedAt).map((r) => {
      const { toolSpans, ...rest } = r;
      return {
        ...rest,
        usage: r.usage === void 0 ? void 0 : freezeUsage(r.usage),
        toolSpans: [...toolSpans.values()].map((s) => ({ ...s }))
      };
    });
    const sessions = [...this.sessions.entries()].map(([sessionId, s]) => this.freezeSessionCard(sessionId, s)).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return {
      startedAt: this.startedAt,
      totalUsage: freezeUsage(this.totalUsage),
      totalRuns: this.totalRuns,
      totalErrors: this.totalErrors,
      runs,
      tools,
      sessions,
      cacheWaste: {
        ...this.cacheWaste,
        misses: this.cacheMisses.map((m) => ({ ...m }))
      },
      composition: estimateComposition(args.entries, args.systemPromptTokens),
      contextUsage: args.contextUsage,
      logDir: args.logDir
    };
  }
}

export {
	CACHE_MISS_NOISE_FLOOR_TOKENS,
	CACHE_TTL_MS,
	MAX_CACHE_MISSES,
	MAX_RUNS_PER_SESSION,
	ObservabilityStore,
	RUN_CARD_WINDOW_MS,
	addUsage,
	estimateComposition,
	estimateTokens,
	freezeUsage,
	missedCost,
	mutableSessionStats,
	mutableUsage,
};