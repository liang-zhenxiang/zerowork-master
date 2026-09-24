import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { INVOKE } from "../../shared/ipc.js";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { LEGACY_DOC_EXTENSIONS } from "../../shared/ipc.js";
import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { OFFICE_EXTENSIONS } from "../../shared/ipc.js";
import { openSync } from "node:fs";
import { PDF_EXTENSION } from "../../shared/ipc.js";
import { PUSH } from "../../shared/ipc.js";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { readSync } from "node:fs";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { sep } from "node:path";
import { stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import {
	getAppDir,
	getAuthPath,
	getBuiltinSkillDirs,
	getConfigDir,
	getModelsPath,
	getResourcesDir,
	getSessionsDir,
	getSpillsDir,
	getTempTasksDir,
} from "./config-paths.js";
import { AutomationStore } from "./automation.js";
import { SessionArchive } from "./archive.js";
import {
	loadMemorySystemPrompt,
	profilePath,
	userMemoryPath,
} from "./memory.js";
import {
	ensureBuiltinMemoryTask,
	nextRunAfter,
	validateSchedule,
} from "./schedule.js";
import { ensureBuiltinProviders } from "./models.js";
import {
	AUDIT_PANEL_LIMIT,
	clearAuditRecords,
	clipAuditDetail,
	exportAuditRecords,
	isAuditCategory,
	readAuditRecords,
	writeAuditRecord,
} from "./audit.js";
import { EventLog } from "./event-log.js";
import {
	loadAgents,
	loadExperts,
	mergeAgentPools,
	optionalBoolean,
	parseFrontmatter,
} from "./experts.js";
import {
	McpConfigError,
	readMcpConfigSource,
	toggleMcpServer,
	writeMcpConfig,
} from "./mcp.js";
import {
	isWebSearchProviderId,
	parseModelKey,
	readApiKey,
} from "./auth.js";
import { ModelCatalog } from "./model-catalog.js";
import {
	RunLedger,
	isStreamingEvent,
	isThinkingLevel,
	ledgerFileName,
	listLedgerFiles,
	readLedgerEntries,
} from "./ledger.js";
import { ObservabilityStore } from "./observability.js";
import {
	DEFAULT_PERMISSIONS,
	appendPermissionRule,
	isApprovalPolicy,
	isGranted,
	isSandboxMode,
	loadPermissionRules,
	normalizeApprovalOutcome,
	presetIdFor,
	savePermissionRules,
} from "./permissions.js";
import {
	SKILL_NAME_PATTERN,
	filterEnabledSkills,
	getEffectiveWorkspaceRoot,
	isSkillEnabled,
	readPreferences,
	writePreferences,
} from "./preferences.js";
import { PreviewServers } from "./preview-server.js";
import {
	DEFAULT_STYLE_ID,
	formatRuntimeContext,
	requireExpertPersona,
	resolveSessionExpert,
	sessionSkillPaths,
} from "./prompt-compose.js";
import {
	buildPromptPreview,
	createSystemPromptComposerFromDefaults,
	loadLanguagePrompt,
	loadResources,
	toDescriptors,
} from "./resources.js";
import {
	buildSessionMemorySection,
	listSessionPromptTemplates,
	readSessionArtifact,
	readSessionMcpConfig,
	statSessionArtifact,
} from "./prompt-templates.js";
import {
	computeSkillsCost,
	importSkill,
	listSkillDependencyWriteDirs,
	packSkillDir,
	readInstalledMeta,
	removeAgentSkill,
	skillScopeOf,
	userSkillsDir,
} from "./skills.js";
import {
	SKILL_COMMAND_PREFIX,
	SKILL_INVOCATION_PREFIX,
	buildConversationEntries,
	buildExportPath,
	countSkippedLines,
	normalizeLegacyInteraction,
	restoredToolLabel,
	skillBlockText,
	takeSkillCommands,
	validateSessionFilePath,
} from "./session-view.js";
import { SessionHost } from "./session-host.js";
import {
	SessionMailbox,
	readMemberTranscript,
	readMemberTranscriptView,
} from "./mailbox.js";
import {
	collectRuntimeDiagnosticsText,
	collectRuntimeInventory,
	defaultPythonRuntimeOptions,
	defaultSpawn,
	inspectPythonRuntime,
	installManagedRuntime,
	planRuntimeShellInjection,
	resetManagedRuntime,
	writeRuntimeEnabled,
	writeRuntimeMaster,
} from "./runtimes.js";
import {
	createDocReadTool,
	createDocxConvertTool,
	createDocxExtractTool,
} from "./doc-extract.js";
import {
	defaultProtectedDirs,
	rememberRuleFromApproval,
} from "./permission-rules.js";
import {
	createPermissionGate,
	createPresentFiles,
	createProjectTrust,
	createPromptSwitch,
	createSandboxedBackgroundStarter,
	createSandboxedRunner,
	createSubagentRunner,
	createWebTools,
	isPathInside,
	powershellExtensionFactory,
	runCommand,
	searchWeb,
	spawnMember,
	spillExtensionFactory,
	startDirectBackground,
	warmUpSandbox,
} from "./command-exec.js";
import {
	collectFingerprintsFromSession,
	collectTeamOutputMembers,
} from "./subagent.js";
import {
	TeamRegistry,
	composePendingTeamOutput,
} from "./teams.js";
import { TeamTaskBoard } from "./workspace.js";
import {
	TEAM_STORE_VERSION,
	createWorkspace,
	createWorktree,
	getBranchList,
	isGitRepo,
	listWorkspaces,
	readDisplayNames,
	readTeams,
	removeDisplayName,
	removeTeam,
	requireBranchName,
	setDisplayName,
	validateDisplayName,
	validateWorkspacePath,
	worktreeInfoFromCwd,
	writeTeam,
} from "./git-worktree.js";
import {
	automationExtensionFactory,
	conversationSearchExtensionFactory,
	createJobTools,
	indexFiles,
} from "./automation-tools.js";
import {
	createBackgroundJobRegistry,
	createSkillInstallTool,
	createSkillUninstallTool,
	questionnaireExtensionFactory,
	taskExtensionFactory,
	teamExtensionFactory,
	teamTaskExtensionFactory,
} from "./tool-factories.js";
import {
	createUseSkillTool,
	todoExtensionFactory,
	visualizerExtensionFactory,
} from "./mcp-client.js";
import {
	SCAN_LIMIT,
	allocatePendingCwd,
	artifactsFromEntries,
	conversationReducer,
	createBucket,
	createMcpClient,
	createTeamOutputHook,
	deriveContextUsageDetail,
	deriveSessionTitle,
	enqueue,
	ensureAgentTools,
	extractSnippet,
	isRevealableCwd,
	isSelectableWorkspaceDir,
	isTaskCwd,
	isTaskPrivateCwd,
	parseBuiltinCommand,
	pickEvictions,
	probeModel,
	searchOneFile,
} from "./session-state.js";

async function searchSessionFiles(query, limit, options) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t !== "");
  if (terms.length === 0 || limit <= 0) return [];
  let fileNames;
  try {
    fileNames = await readdir(options.sessionsDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const candidates = [];
  for (const name of fileNames) {
    if (!name.toLowerCase().endsWith(".jsonl")) continue;
    const path = join(options.sessionsDir, name);
    try {
      candidates.push({ path, mtimeMs: (await stat(path)).mtimeMs });
    } catch {
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const hits = [];
  for (const candidate of candidates.slice(0, SCAN_LIMIT)) {
    if (hits.length >= limit) break;
    let content;
    try {
      content = await readFile(candidate.path, "utf8");
    } catch {
      continue;
    }
    const found = searchOneFile(content, terms);
    if (found === null) continue;
    if (options.excludeSessionId !== void 0 && found.sessionId === options.excludeSessionId) {
      continue;
    }
    hits.push({
      sessionId: found.sessionId,
      title: found.title,
      modifiedAt: candidate.mtimeMs,
      snippet: extractSnippet(found.text, found.matchStart, found.matchEnd)
    });
  }
  return hits;
}

function assertInsideSessionsDir(path) {
  const reason = validateSessionFilePath(path, getSessionsDir());
  if (reason !== void 0) throw new Error(reason);
}

function parseSessionFile$1(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const entries = [];
  let headerIndex = -1;
  let headerLine;
  let header;
  let skippedLines = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === void 0 || line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedLines += 1;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      skippedLines += 1;
      continue;
    }
    const record = parsed;
    if (record["type"] === "session") {
      if (headerIndex === -1) {
        headerIndex = index;
        headerLine = line;
        header = parsed;
      }
      continue;
    }
    const id = record["id"];
    if (typeof id !== "string" || id === "") {
      skippedLines += 1;
      continue;
    }
    const parentId = record["parentId"];
    entries.push({ line, id, parentId: typeof parentId === "string" ? parentId : null });
  }
  return { lines, headerIndex, headerLine, header, entries, skippedLines };
}

function readSessionHeader(path) {
  assertInsideSessionsDir(path);
  return parseSessionFile$1(path).header;
}

function sessionPrefixLines(path, entryId) {
  assertInsideSessionsDir(path);
  const parsed = parseSessionFile$1(path);
  const { headerLine } = parsed;
  if (headerLine === void 0) throw new Error("会话文件缺少头部，无法取前缀");
  const byId = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  const target = byId.get(entryId);
  if (target === void 0) return void 0;
  const chain = [];
  let current = target;
  while (current !== void 0) {
    chain.push(current);
    current = current.parentId === null ? void 0 : byId.get(current.parentId);
  }
  chain.reverse();
  return {
    headerLine,
    entryLines: chain.map((entry) => entry.line),
    skippedLines: parsed.skippedLines
  };
}

function writeSessionFileLines(path, lines) {
  assertInsideSessionsDir(path);
  const tmp = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(tmp, lines.length === 0 ? "" : `${lines.join("\n")}
`, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true, recursive: true });
    throw error;
  }
}

function truncateSessionTo(path, entryId) {
  const prefix = sessionPrefixLines(path, entryId);
  if (prefix === void 0) return false;
  writeSessionFileLines(path, [prefix.headerLine, ...prefix.entryLines]);
  return true;
}

function truncateSessionToStart(path) {
  assertInsideSessionsDir(path);
  const parsed = parseSessionFile$1(path);
  if (parsed.headerLine === void 0) throw new Error("会话文件缺少头部，无法清空历史");
  writeSessionFileLines(path, [parsed.headerLine]);
}

async function createBranchedSessionFile(sourcePath, leafId) {
  assertInsideSessionsDir(sourcePath);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const temp = SessionManager.open(sourcePath, getSessionsDir());
  return temp.createBranchedSession(leafId);
}

function setSessionParentSession(path, parentSession) {
  assertInsideSessionsDir(path);
  const parsed = parseSessionFile$1(path);
  const { header, headerLine, headerIndex } = parsed;
  if (header === void 0 || headerLine === void 0) {
    throw new Error("会话文件缺少头部，无法写入来源会话");
  }
  const lines = [...parsed.lines];
  lines[headerIndex] = JSON.stringify({ ...header, parentSession: resolve(parentSession) });
  writeSessionFileLines(path, lines);
}

async function setSessionName(path, name) {
  assertInsideSessionsDir(path);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.open(path, getSessionsDir());
  if (manager.getSessionName() === name) return;
  manager.appendSessionInfo(name);
}

async function newSessionHeader(cwd, parentSession) {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.create(cwd, getSessionsDir(), {
    parentSession: resolve(parentSession)
  });
  const header = manager.getHeader();
  const path = manager.getSessionFile();
  if (header === null || path === void 0) throw new Error("pi 未生成会话 header");
  return { path, header };
}

async function createEmptySessionFile(cwd, parentSession) {
  const created = await newSessionHeader(cwd, parentSession);
  writeSessionFileLines(created.path, [JSON.stringify(created.header)]);
  return created.path;
}

async function createSessionFileFromPrefix(sourcePath, entryId) {
  const prefix = sessionPrefixLines(sourcePath, entryId);
  if (prefix === void 0) return void 0;
  const sourceHeader = readSessionHeader(sourcePath);
  if (sourceHeader === void 0) throw new Error("会话文件缺少头部，无法派生新会话");
  const created = await newSessionHeader(sourceHeader.cwd, sourcePath);
  writeSessionFileLines(created.path, [JSON.stringify(created.header), ...prefix.entryLines]);
  return created.path;
}

function resolveAnchorForIndex(anchors, userIndex) {
  if (!Number.isInteger(userIndex) || userIndex < 0) return void 0;
  return anchors[userIndex];
}

function endOfTurn(entries, anchorEntryId) {
  const children = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.parentId === null) continue;
    const siblings = children.get(entry.parentId);
    if (siblings === void 0) children.set(entry.parentId, [entry]);
    else siblings.push(entry);
  }
  let current = anchorEntryId;
  const seen = /* @__PURE__ */ new Set([anchorEntryId]);
  for (; ; ) {
    const next = (children.get(current) ?? []).find((entry) => !seen.has(entry.id));
    if (next === void 0 || next.role === "user") return current;
    seen.add(next.id);
    current = next.id;
  }
}

function decideExtract(entries, anchorEntryId) {
  const children = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.parentId === null) continue;
    const siblings = children.get(entry.parentId);
    if (siblings === void 0) children.set(entry.parentId, [entry.id]);
    else siblings.push(entry.id);
  }
  const seen = /* @__PURE__ */ new Set([anchorEntryId]);
  const stack = [...children.get(anchorEntryId) ?? []];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === void 0 || seen.has(id)) continue;
    seen.add(id);
    const grand = children.get(id);
    if (grand !== void 0) stack.push(...grand);
  }
  return seen.size > 1;
}

const EMPTY_TITLE_PLACEHOLDER = "（空会话）";

const BRANCH_SUFFIX = " · 分支";

function buildBranchTitle(parentTitle, existingTitles) {
  const trimmed = parentTitle.trim();
  const base = trimmed === "" ? EMPTY_TITLE_PLACEHOLDER : trimmed;
  const taken = new Set(existingTitles);
  const first = `${base}${BRANCH_SUFFIX}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function branchOk(branch) {
  if (branch === void 0) return { ok: true };
  return { ok: true, branchPath: branch.path, branchTitle: branch.title };
}

const FAIL_MESSAGES = {
  busy: "正在生成，稍后再试",
  "no-file": "这个任务还没有会话记录，无法从这里重新开始",
  "no-such-entry": "找不到这条消息，可能历史已变化，请刷新后重试",
  "write-failed": "保存分支失败，当前会话未改动"
};

function branchFail(reason, message = FAIL_MESSAGES[reason]) {
  return { ok: false, reason, message };
}

function emptyUsageStats() {
  return {
    totalSessions: 0,
    totalMessages: 0,
    activeDays: 0,
    totalDays: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    totalCost: 0,
    streakDays: 0,
    longestStreakDays: 0,
    peakHour: void 0,
    longestSessionMs: void 0,
    averageSessionMs: 0,
    firstSessionAt: void 0,
    lastSessionAt: void 0,
    heatmap: [],
    dailyTokens: [],
    modelUsage: [],
    toolUsage: []
  };
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const UNKNOWN_MODEL = "unknown";

const SUBAGENT_CUSTOM_TYPE = "subagent_run";

const READ_CONCURRENCY = 8;

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function entryTimeMs(entry, message) {
  const fromEntry = entry["timestamp"];
  if (typeof fromEntry === "number" && Number.isFinite(fromEntry)) return fromEntry;
  if (typeof fromEntry === "string") {
    const parsed = Date.parse(fromEntry);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fromMessage = message["timestamp"];
  if (typeof fromMessage === "number" && Number.isFinite(fromMessage)) return fromMessage;
  return void 0;
}

function parseUsage(value) {
  if (value === null || typeof value !== "object") return void 0;
  const usage = value;
  const input = asNumber(usage["input"]);
  const output = asNumber(usage["output"]);
  const cacheRead = asNumber(usage["cacheRead"]);
  const cacheWrite = asNumber(usage["cacheWrite"]);
  const cost = usage["cost"];
  const costTotal = cost !== null && typeof cost === "object" ? asNumber(cost["total"]) : 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: asNumber(usage["totalTokens"]) || input + output + cacheRead + cacheWrite,
    cost: costTotal
  };
}

function collectToolCalls(content, into) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const candidate = block;
    if (candidate["type"] !== "toolCall") continue;
    const id = candidate["id"];
    const name = candidate["name"];
    if (typeof id !== "string" || typeof name !== "string" || name === "") continue;
    into.push({ toolCallId: id, toolName: name });
  }
}

function parseSessionFile(content) {
  let sessionId;
  let sawHeader = false;
  let isSubagent = false;
  const messages = [];
  const toolCalls = [];
  const toolErrorIds = /* @__PURE__ */ new Set();
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!sawHeader) {
      if (entry["type"] !== "session" || typeof entry["id"] !== "string") return null;
      sawHeader = true;
      sessionId = entry["id"];
      continue;
    }
    if (entry["type"] === "custom") {
      if (entry["customType"] === SUBAGENT_CUSTOM_TYPE) isSubagent = true;
      continue;
    }
    if (entry["type"] !== "message") continue;
    const message = entry["message"];
    if (message === null || typeof message !== "object") continue;
    const body = message;
    const role = body["role"];
    if (typeof role !== "string") continue;
    if (role === "toolResult") {
      const toolCallId = body["toolCallId"];
      if (typeof toolCallId === "string" && body["isError"] === true) toolErrorIds.add(toolCallId);
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    const at = entryTimeMs(entry, body);
    if (at === void 0) continue;
    const model = body["model"];
    messages.push({
      at,
      role,
      model: typeof model === "string" && model !== "" ? model : void 0,
      usage: parseUsage(body["usage"])
    });
    if (role === "assistant") collectToolCalls(body["content"], toolCalls);
  }
  if (!sawHeader || sessionId === void 0) return null;
  return { sessionId, isSubagent, messages, toolCalls, toolErrorIds };
}

function isIdentifiedModel(model) {
  return model !== void 0 && model !== UNKNOWN_MODEL;
}

function isLegacySession(messages) {
  const assistants = messages.filter((m) => m.role === "assistant");
  if (assistants.length === 0) return false;
  return assistants.every((m) => !isIdentifiedModel(m.model));
}

function aggregateUsageStats(sessions, options = {}) {
  const stats = {
    totalSessions: 0,
    totalMessages: 0,
    totalCost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokenTotal: 0
  };
  const byDate = /* @__PURE__ */ new Map();
  const byHour = /* @__PURE__ */ new Map();
  const byModel = /* @__PURE__ */ new Map();
  const byTool = /* @__PURE__ */ new Map();
  let longestMs;
  let totalSpanMs = 0;
  let spanCount = 0;
  let firstAt;
  let lastAt;
  for (const session of sessions) {
    if (session.messages.length === 0) continue;
    if (isLegacySession(session.messages)) continue;
    if (!session.isSubagent) {
      stats.totalSessions++;
      stats.totalMessages += session.messages.length;
      let sessionStart = Number.POSITIVE_INFINITY;
      let sessionEnd = Number.NEGATIVE_INFINITY;
      for (const message of session.messages) {
        if (message.at < sessionStart) sessionStart = message.at;
        if (message.at > sessionEnd) sessionEnd = message.at;
        const key = localDateKey(new Date(message.at));
        const bucket = byDate.get(key);
        if (bucket === void 0) byDate.set(key, { count: 1, tokens: 0 });
        else bucket.count++;
        const hour = new Date(message.at).getHours();
        byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
      }
      const span = sessionEnd - sessionStart;
      if (span > 0) {
        totalSpanMs += span;
        spanCount++;
        if (longestMs === void 0 || span > longestMs) longestMs = span;
      }
      if (sessionStart < Number.POSITIVE_INFINITY) {
        if (firstAt === void 0 || sessionStart < firstAt) firstAt = sessionStart;
        if (lastAt === void 0 || sessionEnd > lastAt) lastAt = sessionEnd;
      }
      for (const call of session.toolCalls) {
        const bucket = byTool.get(call.toolName);
        const isError = session.toolErrorIds.has(call.toolCallId);
        if (bucket === void 0) byTool.set(call.toolName, { count: 1, errors: isError ? 1 : 0 });
        else {
          bucket.count++;
          if (isError) bucket.errors++;
        }
      }
    }
    for (const message of session.messages) {
      if (message.role !== "assistant") continue;
      const model = message.model;
      const usage = message.usage;
      if (!isIdentifiedModel(model) || usage === void 0) continue;
      stats.totalCost += usage.cost;
      stats.input += usage.input;
      stats.output += usage.output;
      stats.cacheRead += usage.cacheRead;
      stats.cacheWrite += usage.cacheWrite;
      stats.tokenTotal += usage.total;
      let accumulator = byModel.get(model);
      if (accumulator === void 0) {
        accumulator = {
          count: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0
        };
        byModel.set(model, accumulator);
      }
      accumulator.count++;
      accumulator.input += usage.input;
      accumulator.output += usage.output;
      accumulator.cacheRead += usage.cacheRead;
      accumulator.cacheWrite += usage.cacheWrite;
      accumulator.cost += usage.cost;
      const key = localDateKey(new Date(message.at));
      const bucket = byDate.get(key);
      if (bucket === void 0) byDate.set(key, { count: 0, tokens: usage.total });
      else bucket.tokens += usage.total;
    }
  }
  if (stats.totalSessions === 0 && stats.tokenTotal === 0) return emptyUsageStats();
  const heatmap = [];
  const dailyTokens = [];
  for (const [date, bucket] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (bucket.count > 0) heatmap.push({ date, count: bucket.count });
    if (bucket.tokens > 0) dailyTokens.push({ date, tokens: bucket.tokens });
  }
  const modelUsage = [...byModel.entries()].map(([model, acc]) => ({
    model,
    count: acc.count,
    tokens: acc.input + acc.output + acc.cacheRead + acc.cacheWrite,
    cost: acc.cost
  })).sort((a, b) => b.tokens - a.tokens);
  const toolUsage = [...byTool.entries()].map(([tool, acc]) => ({ tool, count: acc.count, errors: acc.errors })).sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
  const activeDates = heatmap.map((day) => day.date);
  const totalDays = firstAt === void 0 || lastAt === void 0 ? 0 : Math.ceil((lastAt - firstAt) / 864e5) + 1;
  let peakHour;
  let peakHourCount = 0;
  for (const [hour, count] of byHour) {
    if (count > peakHourCount || count === peakHourCount && peakHour !== void 0 && hour < peakHour) {
      peakHour = hour;
      peakHourCount = count;
    }
  }
  const streaks = calculateStreaks(activeDates, options.now ?? /* @__PURE__ */ new Date());
  return {
    totalSessions: stats.totalSessions,
    totalMessages: stats.totalMessages,
    activeDays: activeDates.length,
    totalDays,
    totalTokens: {
      input: stats.input,
      output: stats.output,
      cacheRead: stats.cacheRead,
      cacheWrite: stats.cacheWrite,
      total: stats.tokenTotal
    },
    totalCost: stats.totalCost,
    streakDays: streaks.current,
    longestStreakDays: streaks.longest,
    peakHour,
    longestSessionMs: longestMs,
    averageSessionMs: spanCount === 0 ? 0 : totalSpanMs / spanCount,
    firstSessionAt: firstAt,
    lastSessionAt: lastAt,
    heatmap,
    dailyTokens,
    modelUsage,
    toolUsage
  };
}

function calculateStreaks(dates, now) {
  if (dates.length === 0) return { current: 0, longest: 0 };
  const unique = [...new Set(dates)].sort();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let current = 0;
  const cursor = new Date(today);
  for (; ; ) {
    if (!unique.includes(localDateKey(cursor))) break;
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const prev = /* @__PURE__ */ new Date(`${unique[i - 1]}T00:00:00`);
    const next = /* @__PURE__ */ new Date(`${unique[i]}T00:00:00`);
    if (Math.round((next.getTime() - prev.getTime()) / 864e5) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
  }
  return { current, longest };
}

const parseCache = /* @__PURE__ */ new Map();

async function readUsageStats(sessionsDir, report, options = {}) {
  let names;
  try {
    names = await readdir(sessionsDir);
  } catch (error) {
    if (error.code === "ENOENT") return emptyUsageStats();
    throw error;
  }
  const files = names.filter((name) => name.toLowerCase().endsWith(".jsonl"));
  const sessions = [];
  const alive = /* @__PURE__ */ new Set();
  let next = 0;
  const worker = async () => {
    for (; ; ) {
      const index = next++;
      if (index >= files.length) return;
      const path = join(sessionsDir, files[index]);
      let mtimeMs;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        continue;
      }
      alive.add(path);
      const cached = parseCache.get(path);
      let parsed;
      if (cached !== void 0 && cached.mtimeMs === mtimeMs) {
        parsed = cached.parsed;
      } else {
        try {
          parsed = parseSessionFile(await readFile(path, "utf8"));
        } catch (error) {
          report?.(
            `会话文件读取失败已跳过：${path} —— ${error instanceof Error ? error.message : String(error)}`
          );
          continue;
        }
        parseCache.set(path, { mtimeMs, parsed });
      }
      if (parsed === null) {
        report?.(`会话文件格式不识别已跳过：${path}`);
        continue;
      }
      sessions.push(parsed);
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? READ_CONCURRENCY, files.length || 1));
  await Promise.all(Array.from({ length: workers }, worker));
  for (const path of [...parseCache.keys()]) if (!alive.has(path)) parseCache.delete(path);
  return aggregateUsageStats(sessions, options.now === void 0 ? {} : { now: options.now });
}

const RUN_TIMEOUT_MS = 30 * 6e4;

function createAutomationRunExecutor(deps) {
  return async (task) => {
    let host;
    let sessionId = "";
    try {
      const catalog = await deps.getCatalog();
      const modelKey = deps.getModelKey();
      if (modelKey === void 0) {
        throw new Error("还没有选择模型，请先在设置里配置 API Key 并选择模型");
      }
      if (!catalog.isUsable(modelKey)) {
        throw new Error("选中的模型当前不可用，请到设置里检查 API Key 或重新选择模型");
      }
      const cwd = task.cwd;
      const cwdError = validateWorkspacePath(cwd);
      if (cwdError !== void 0) throw new Error(`任务的工作目录不可用：${cwdError}`);
      mkdirSync(cwd, { recursive: true });
      let runError;
      let cancelled = false;
      const emit = (event) => {
        if (event.type === "run_error" && runError === void 0) runError = event.message;
        if (event.type === "run_finished" && event.outcome === "cancelled") cancelled = true;
      };
      host = await SessionHost.create({
        catalog,
        modelKey,
        cwd,
        isTempTask: deps.isTempCwd(cwd),
        sceneId: "work",
        interactionId: "craft",
        emit,
        resources: deps.resources,
        // 托管运行时清单进 hidden context 的 python_env（run 会话的提示词
        // 是 work 骨架，其中有 python-env 片段；那条事实随机器与开关变，
        // 只能走注入）。
        getRuntimeInventory: deps.getRuntimeInventory,
        // 初始档 = 全局默认；未配置时为 undefined，SessionHost 只把非
        // undefined 传给 pi（pi 走自己的 medium 默认链）。
        thinkingLevel: deps.getThinkingLevel(),
        extensions: buildRunExtensions(deps, cwd, () => host)
      });
      host.markAutomationRun(task.id);
      sessionId = host.state.sessionId;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void host?.abort();
      }, RUN_TIMEOUT_MS);
      timeout.unref?.();
      try {
        await host.prompt(task.prompt);
      } finally {
        clearTimeout(timeout);
      }
      if (timedOut) return { sessionId, success: false, error: "timeout" };
      if (runError !== void 0) return { sessionId, success: false, error: runError };
      if (cancelled) return { sessionId, success: false, error: "运行被中断" };
      return { sessionId, success: true };
    } catch (error) {
      return {
        sessionId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      host?.dispose();
    }
  };
}

function buildRunExtensions(deps, cwd, getHost2) {
  return [
    createPermissionGate({
      paths: {
        workspaceDir: cwd,
        configDir: getConfigDir(),
        protectedDirs: deps.protectedDirs,
        // 写 ZeroWork 自身目录永远高风险 —— unattended 下即「永远自动拒绝」。
        appDir: getAppDir(),
        // 内置资源只读放行（技能渐进加载全靠 read 这里）。
        resourcesDir: getResourcesDir()
      },
      cwd,
      getSettings: deps.getPermissions,
      unattended: true,
      // 不可达：unattended 在 ask 分支前就拦截了。真被调到说明
      // permission-gate 的语义变了 —— 让它响，别静默放行。
      requestApproval: () => {
        throw new Error("无人值守会话不应发起审批");
      }
    }),
    createProjectTrust({ isOwnWorkspace: deps.isOwnWorkspace }),
    createPresentFiles({
      getWorkspaceDir: () => cwd,
      // 没有人在看：交付只落盘（恢复该会话时产物卡可重建），不发事件。
      onPresent: ({ files, focusFile }) => {
        getHost2()?.persistArtifacts(files, focusFile);
      }
    }),
    createPromptSwitch({
      // 两轴固定 work + craft（spec）—— run 会话没有切换器，也不起专家。
      getCurrent: () => ({ sceneId: "work", interactionId: "craft" }),
      compose: (sceneId, interactionId, _expertId, piContext) => deps.compose(cwd, sceneId, interactionId, piContext),
      // 记忆内容/个性化按 run 的 cwd 现读，内容未变则不追加（提示词里已不含它们）。
      composeRuntimeContext: () => deps.composeRuntimeContext(cwd),
      // hidden context 快照取本 run 冻结的那份全文（时序见
      // session-host.peekHiddenContext 的注释：freeze 在 session.prompt() 之前）。
      composeHiddenContext: () => getHost2()?.peekHiddenContext(),
      // 时间快照（`zerowork-run-time`）：同一次 freeze 的另一半，
      // 与上面那条分开去重（spec: add-supersede-note-and-time-split）。
      composeRunTime: () => getHost2()?.peekRunTime(),
      // 非团队会话（定时任务 run 没有团队注册表）：团队产出通道不接。
      composeTeamOutput: () => void 0
    }),
    createWebTools({ getSearchConfig: deps.getWebSearchConfig }),
    /*
     * 工具结果 spill：与用户会话同一个钩子（无人值守不改变「结果超限就落盘 +
     * 给路径」这条口径；run 会话的 web_fetch / read_document 一样会吐长正文）。
     * 只有 read 例外，见 spill-hook 文件头。
     */
    spillExtensionFactory({ dir: getSpillsDir(cwd), report: deps.reportSpill }),
    /*
     * 结构化提问的无人值守变体：craft 白名单含 questionnaire，run 会话
     * 必须注册同名工具（否则模型对着白名单调一个不存在的能力）；
     * 但 run 没有人在场，工具层直接返回不可用文案，不阻塞调度器。
     * requestAnswers 不可达（unattended 分支先短路）—— 真被调到说明
     * questionnaire-tool 的语义变了，让它响，别静默放行。
     */
    questionnaireExtensionFactory({
      unattended: true,
      requestAnswers: () => {
        throw new Error("无人值守会话不应发起提问");
      }
    }),
    /*
     * shell 的无人值守变体：craft 白名单含 powershell，run 会话必须注册
     * 同名工具（否则模型对着白名单调一个不存在的能力）；但定时任务后台
     * 跑 shell 等于无人审批的执行权，无论权限档一律在工具层直接拒。
     *
     * **也不注入 backgroundStarter，也不注册 job_* 三件套**（P0：后台常驻命令）：
     * 无人值守时不只没人审批，更没人**收尾** —— 定时任务会话跑完即销毁，
     * 它起的常驻服务没有任何入口能停（下一个 run 会话是另一条 sessionId，
     * job_list 里也看不到）。所以后台能力在无人值守下整条关掉：
     * 工具层对 run_in_background: true 返回「无人值守」/「本会话不支持」，
     * craft 白名单里的 job_* 名字则根本查不到（与 powershell 不在同一会话里可用的道理一致）。
     */
    powershellExtensionFactory({ unattended: true }),
    createDocReadTool(),
    /*
     * 技能加载：run 会话的提示词走双轴 compose，技能清单段照常注入
     * （craft 白名单含 use_skill）—— 不注册等于在提示词里承诺一个不存在的工具。
     * 无需 unattended 变体：只读、无副作用、不需要人批，与 docx_convert 同档；
     * 技能取的是与清单段同一个出口（deps.resolveSkills）。
     */
    createUseSkillTool({ resolveSkills: deps.resolveSkills }),
    /*
     * 技能安装 / 删除：craft 白名单含 skill_install / skill_uninstall，
     * run 会话注册同名真实工具（否则模型对着白名单调一个不存在的能力）。
     * **不需要 unattended 变体**：两条都是 APP_DATA_MUTATING = 询问档，
     * 而本会话的权限门是 unattended（审批类操作自动拒绝并把原因回给模型）——
     * 无人值守下装/删技能本来就该被拒，拒绝理由由权限门统一给出，
     * 与 powershell 那种「工具层直接拒」的分工一致（它拒的是执行权，
     * 这里拒的是改应用数据）。注册而不另写拒法：少一条只有定时任务走得到的旁路。
     */
    createSkillInstallTool({
      installSkill: (sourcePath) => importSkill(sourcePath, { agentCreated: true }),
      packSkill: packSkillDir,
      getWorkspaceDir: () => cwd
    }),
    createSkillUninstallTool({ removeSkill: removeAgentSkill }),
    /*
     * docx 生成：craft 白名单含 docx_convert，run 会话注册同名真实工具
     * （否则模型对着白名单调一个不存在的能力）。无需 unattended 变体 ——
     * 它不像 shell 需要人批：写侧判定锚定产物路径，工作区内 outputPath
     * 在权限门直接放行，无人值守下语义自洽（定时产出周报 docx 是正当场景）。
     */
    createDocxConvertTool({
      engineDir: join(getResourcesDir(), "docx-engine"),
      homeDir: homedir(),
      /*
       * 运行时失败进审计中心（与主会话同一个写入函数）。
       * 无人值守会话**尤其**要记：这条路径没人看着，环境装不上时用户只能
       * 从「任务为什么没产出」去猜，而审计中心是唯一的显式痕迹。
       */
      onAudit: writeAuditRecord
    }),
    /*
     * docx 版式提取：craft 白名单含 docx_extract，run 会话注册同名真实工具。
     * 与 docx_convert 同档：受控 spawn venv python（命令与参数写死在
     * documents/docx-extract.ts）、不经 powershell；写侧判定锚定 outputPath，
     * 产物在工作区内直接放行，无需 unattended 变体。
     */
    createDocxExtractTool({
      engineDir: join(getResourcesDir(), "docx-engine"),
      homeDir: homedir(),
      // 运行时失败进审计中心（与主会话同一个写入函数）。
      onAudit: writeAuditRecord
    }),
    /*
    	 * 内联可视化：craft 白名单含 read_me / show_widget，run 会话注册同名
    	 * 真实工具（否则模型对着白名单调一个不存在的能力）。无需 unattended
    	 * 变体 —— 它不像问卷需要人答：无副作用、无用户交互，run 产出的
    	 * widget 随会话历史可见（spec: add-inline-widgets）。
    	 */
    visualizerExtensionFactory(),
    /*
     * 待办清单：craft 白名单含 todo_write，run 会话注册同名真实工具
     * （否则模型对着白名单调一个不存在的能力）。无需 unattended 变体 ——
     * 它不像问卷需要人答：无副作用、无用户交互，清单只是消息流里的
     * 卡片数据，run 产出的清单卡随会话历史可见（同 visualizer 的取舍）。
     */
    todoExtensionFactory()
  ];
}

const DEFAULT_TICK_MS = 3e4;

function dueTasks(tasks, now) {
  return tasks.filter(
    (task) => task.status === "active" && task.nextRunAt !== void 0 && task.nextRunAt <= now
  ).sort((a, b) => a.nextRunAt - b.nextRunAt);
}

function recoverTasks(tasks, now) {
  const recovered = [];
  for (const task of tasks) {
    if (task.status !== "active") continue;
    if (task.schedule.type === "once") {
      if (task.lastRunAt !== void 0) continue;
      if (task.nextRunAt !== void 0 && task.nextRunAt > now) continue;
      recovered.push({ ...task, status: "missed", nextRunAt: void 0, updatedAt: now });
      continue;
    }
    const nextRunAt = nextRunAfter(task.schedule, now);
    if (nextRunAt !== task.nextRunAt) {
      recovered.push({ ...task, nextRunAt, updatedAt: now });
    }
  }
  return recovered;
}

class AutomationScheduler {
  constructor(options) {
    this.options = options;
  }
  options;
  queue = [];
  runningTaskId;
  timer;
  idleWaiters = /* @__PURE__ */ new Set();
  now() {
    return this.options.now?.() ?? Date.now();
  }
  /**
   * 启动恢复 + 开始 tick。恢复结果有变更时推一次 changed（renderer 重拉列表）。
   * store.load() 应由调用方（daemon 启动流程）先显式调过 —— 库损坏暴露在启动时刻。
   */
  start() {
    const recovered = recoverTasks(this.options.store.list(), this.now());
    for (const task of recovered) this.options.store.upsert(task);
    if (recovered.length > 0) this.options.push({ kind: "changed" });
    this.timer = setInterval(() => this.tick(), this.options.tickMs ?? DEFAULT_TICK_MS);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer !== void 0) {
      clearInterval(this.timer);
      this.timer = void 0;
    }
  }
  /** 扫一遍到期任务入队（幂等：已排队/进行中的不重复入）。tick 之外也可手动调。 */
  tick() {
    const now = this.now();
    for (const task of dueTasks(this.options.store.list(), now)) {
      this.enqueue({ taskId: task.id, taskName: task.name, manual: false });
    }
  }
  /**
   * 手动运行一次，进同一串行队列。
   * 校验存在与状态：missed 的一次性任务没有「再跑一次」的语义（要重跑先编辑调度）；
   * paused 可以手动跑 —— 暂停只停自动触发，不剥夺用户显式执行的权利。
   */
  runNow(taskId) {
    const task = this.options.store.get(taskId);
    if (task === void 0) throw new Error("定时任务不存在");
    if (task.status === "missed") {
      throw new Error("这是一次性任务且已错过预定时刻，请先编辑调度或重新启用");
    }
    if (this.isBusy(taskId)) throw new Error("该任务已在运行队列中");
    this.enqueue({ taskId: task.id, taskName: task.name, manual: true });
  }
  /** 该任务是否正在运行或排队中（删除守卫用：运行中的任务拒删）。 */
  isBusy(taskId) {
    return this.runningTaskId === taskId || this.queue.some((e) => e.taskId === taskId);
  }
  /** 等队列排空（测试用；将来优雅退出也用得上）。 */
  whenIdle() {
    return new Promise((resolve2) => {
      const check = () => {
        if (this.runningTaskId === void 0 && this.queue.length === 0) {
          resolve2();
        } else {
          this.idleWaiters.add(check);
        }
      };
      check();
    });
  }
  signalIdle() {
    if (this.runningTaskId !== void 0 || this.queue.length > 0) return;
    for (const waiter of this.idleWaiters) waiter();
    this.idleWaiters.clear();
  }
  enqueue(entry) {
    if (this.isBusy(entry.taskId)) return;
    this.queue.push(entry);
    this.pump();
  }
  pump() {
    if (this.runningTaskId !== void 0) return;
    const entry = this.queue.shift();
    if (entry === void 0) {
      this.signalIdle();
      return;
    }
    this.runningTaskId = entry.taskId;
    void this.execute(entry).catch((error) => {
      console.error(`定时任务「${entry.taskName}」的运行记账失败：`, error);
    }).finally(() => {
      this.runningTaskId = void 0;
      this.pump();
    });
  }
  async execute(entry) {
    const task = this.options.store.get(entry.taskId);
    if (task === void 0) return;
    const startedAt = this.now();
    let outcome;
    try {
      outcome = await this.options.execute(task);
    } catch (error) {
      outcome = {
        sessionId: "",
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    const finishedAt = this.now();
    const withRun = this.options.store.appendRun(task.id, {
      sessionId: outcome.sessionId,
      startedAt,
      finishedAt,
      success: outcome.success,
      ...outcome.error === void 0 ? {} : { error: outcome.error }
    });
    if (!entry.manual) {
      this.options.store.upsert({
        ...withRun,
        lastRunAt: finishedAt,
        nextRunAt: nextRunAfter(withRun.schedule, finishedAt),
        updatedAt: finishedAt
      });
    }
    this.options.push({
      kind: "runFinished",
      taskId: withRun.id,
      taskName: withRun.name,
      sessionId: outcome.sessionId,
      success: outcome.success,
      // 内置任务带上标记：renderer 据此抑制 toast 与未读（静默后台家务，
      // spec: add-memory-system）。非内置不带键 —— 旧 renderer 按 undefined
      // 处理即原行为，事件契约向后兼容。
      ...task.builtin === true ? { builtin: true } : {}
    });
    this.options.push({ kind: "changed" });
  }
}

const CHILD_SESSION_CUSTOM_TYPES = /* @__PURE__ */ new Set(["subagent_run", "team_member"]);

const AUTOMATION_RUN_CUSTOM_TYPE = "automation_run";

const SESSION_HEAD_BYTES = 64 * 1024;

const sessionHeadMemo = /* @__PURE__ */ new Map();

const MEMO_LIMIT = 4096;

const NO_MARKERS = { childSession: false, automationTaskId: void 0 };

function readSessionHeadMarkers(filePath) {
  let mtimeMs = 0;
  let size = 0;
  try {
    const stats = statSync(filePath);
    mtimeMs = stats.mtimeMs;
    size = stats.size;
  } catch {
    return NO_MARKERS;
  }
  const memoKey = `${filePath}\0${mtimeMs}\0${size}`;
  const memoed = sessionHeadMemo.get(memoKey);
  if (memoed !== void 0) return memoed;
  const markers = {
    childSession: false,
    automationTaskId: void 0
  };
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(SESSION_HEAD_BYTES, size));
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.toString("utf8", 0, bytes).split("\n")) {
      if (line.trim() === "") continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry;
      if (record.type === "custom") {
        if (typeof record.customType === "string") {
          if (CHILD_SESSION_CUSTOM_TYPES.has(record.customType)) {
            markers.childSession = true;
          } else if (record.customType === AUTOMATION_RUN_CUSTOM_TYPE) {
            const data = record.data;
            if (typeof data?.taskId === "string") markers.automationTaskId = data.taskId;
          }
        }
        continue;
      }
      if (record.type === "message") break;
    }
  } finally {
    closeSync(fd);
  }
  if (sessionHeadMemo.size > MEMO_LIMIT) sessionHeadMemo.clear();
  sessionHeadMemo.set(memoKey, markers);
  return markers;
}

function isInternalSessionFile(filePath, builtinTaskIds) {
  const markers = readSessionHeadMarkers(filePath);
  if (markers.childSession) return true;
  return markers.automationTaskId !== void 0 && builtinTaskIds.has(markers.automationTaskId);
}

function requireParentPort() {
  const port = process.parentPort;
  if (port === void 0) {
    throw new Error(
      "daemon 必须在 Electron utilityProcess 中启动（process.parentPort 不存在）"
    );
  }
  return port;
}

const parentPort = requireParentPort();

function post(frame) {
  parentPort.postMessage(frame);
}

const RESOURCES = loadResources(getResourcesDir());

const SCENES = toDescriptors(RESOURCES).scenes;

const INTERACTIONS = toDescriptors(RESOURCES).modes;

const WELCOME = RESOURCES.welcome;

let catalogPromise;

function getCatalog() {
  if (catalogPromise === void 0) {
    const attempt = ModelCatalog.create();
    catalogPromise = attempt;
    attempt.catch(() => {
      if (catalogPromise === attempt) catalogPromise = void 0;
    });
  }
  return catalogPromise;
}

let activeModelKey = readPreferences().activeModelKey;

let activePermissions = readPreferences().permissions ?? DEFAULT_PERMISSIONS;

let activePermissionRules = loadPermissionRules((message) => {
  console.error(message);
});

function appendRule(rule) {
  const next = appendPermissionRule(rule, activePermissionRules);
  if (next === activePermissionRules) return;
  activePermissionRules = next;
  savePermissionRules(next);
}

const PROTECTED_DIRS = defaultProtectedDirs(homedir());

const BUILTIN_SKILL_DIRS = getBuiltinSkillDirs();

function readSkillVersion(doc, filePath) {
  const value = doc.frontmatter["version"];
  if (value === void 0) return void 0;
  if (typeof value === "string" && value !== "") return value;
  console.error(`技能「${filePath}」的 frontmatter 字段 version 应为非空字符串（写裸数字会丢精度，如 1.0 → 1），已忽略：`, value);
  return void 0;
}

function readSkillMeta(filePath) {
  try {
    const doc = parseFrontmatter(readFileSync(filePath, "utf8"), filePath);
    return {
      userInvocable: optionalBoolean(doc, "user-invocable", true),
      version: readSkillVersion(doc, filePath)
    };
  } catch (error) {
    console.error(`技能「${filePath}」的 frontmatter 解析失败，暂按可在 / 菜单调用处理：`, error);
    return { userInvocable: true, version: void 0 };
  }
}

async function listSkills(expertSkillsDir) {
  const { loadSkills: loadSkills2 } = await import("@earendil-works/pi-coding-agent");
  try {
    const { skills } = loadSkills2({
      /*
       * cwd 只决定「项目级技能」的发现目录（pi 取 `<cwd>/.pi/skills`，见
       * pi core/skills.ts）：内置技能走 skillPaths 的绝对路径、用户级技能走
       * agentDir=getConfigDir()，都不受 cwd 影响。用生效根而非内置默认根：
       * 用户改了「默认存储路径」后，新根下放的项目级技能要能被发现，
       * 与设置项口径一致（否则改完路径技能就找不到了）。
       */
      cwd: getEffectiveWorkspaceRoot(),
      agentDir: getConfigDir(),
      skillPaths: sessionSkillPaths(BUILTIN_SKILL_DIRS, expertSkillsDir),
      includeDefaults: true
    });
    return skills.map((s) => {
      const origin = skillScopeOf(s.filePath, {
        builtinDirs: BUILTIN_SKILL_DIRS,
        workspaceDir: getEffectiveWorkspaceRoot()
      });
      const meta = readSkillMeta(s.filePath);
      const installed = origin === "user" ? readInstalledMeta(dirname(s.filePath)) : void 0;
      const version = meta.version ?? installed?.version;
      return {
        name: s.name,
        description: s.description,
        filePath: s.filePath,
        origin,
        disableModelInvocation: s.disableModelInvocation,
        userInvocable: meta.userInvocable,
        // 元数据缺失即不带字段（不填默认值）——UI 据此留白，不显示伪造值。
        ...version === void 0 ? {} : { version },
        ...installed?.installedAt === void 0 ? {} : { installedAt: installed.installedAt },
        ...installed?.sourcePath === void 0 ? {} : { sourcePath: installed.sourcePath }
      };
    });
  } catch (error) {
    console.error("技能加载失败（设置页列表为空）：", error);
    return [];
  }
}

function loadExpertsNow() {
  return loadExperts(
    join(getResourcesDir(), "experts"),
    join(getConfigDir(), "experts"),
    BUILTIN_SKILL_DIRS,
    loadAgents(join(getResourcesDir(), "agents"), join(getConfigDir(), "agents"))
  );
}

async function sessionSkills(expertId) {
  if (expertId === void 0) return listSkills();
  return listSkills(resolveSessionExpert(loadExpertsNow(), expertId)?.skillsDir);
}

async function expandSkillInvocation(text, expertId) {
  const { names, text: tail } = takeSkillCommands(text);
  if (names.length === 0) return text;
  const skills = await sessionSkills(expertId);
  const blocks = [];
  const unresolved = [];
  for (const name of names) {
    const skill = skills.find((s) => s.name === name);
    if (skill === void 0) {
      unresolved.push(name);
      continue;
    }
    const { stripFrontmatter } = await import("@earendil-works/pi-coding-agent");
    const skillBody = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
    blocks.push(
      skillBlockText({
        name: skill.name,
        filePath: skill.filePath,
        baseDir: dirname(skill.filePath),
        body: skillBody
      })
    );
  }
  if (blocks.length === 0) return text;
  const rest = [...unresolved.map((name) => `${SKILL_INVOCATION_PREFIX}${name}`), tail].filter((part) => part !== "").join(" ");
  if (rest !== "") blocks.push(rest);
  return blocks.join("\n\n");
}

async function skillSets(expertId) {
  const overrides = readPreferences().skillOverrides;
  const all = (await sessionSkills(expertId)).map((skill) => ({
    ...skill,
    enabled: isSkillEnabled(skill.name, overrides)
  }));
  return { all, enabled: filterEnabledSkills(all, overrides) };
}

async function enabledSkills(expertId) {
  return (await skillSets(expertId)).enabled;
}

async function toUseSkills(expertId) {
  return (await skillSets(expertId)).all.map((s) => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    disableModelInvocation: s.disableModelInvocation,
    enabled: s.enabled
  }));
}

function toSkillDescriptors(skills) {
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    // 这一项不能省：pi 的 formatSkillsForPrompt 靠它把 disable-model-invocation
    // 的技能从清单段过滤掉 —— 曾经在这里降维成三字段丢掉它 = 过滤整条失效，
    // 声明「模型不可调用」的内部技能照样进提示词。
    disableModelInvocation: s.disableModelInvocation
  }));
}

async function buildSkillsSnapshot() {
  const { all, enabled } = await skillSets(void 0);
  const cost = await computeSkillsCost(toSkillDescriptors(enabled));
  return {
    skills: all,
    userSkillsDir: userSkillsDir(),
    enabledCount: cost.enabledCount,
    skillsTokens: cost.skillsTokens,
    // 未超阈值就不带这个字段（渲染层据此决定有没有提示条），而不是带一个空串。
    ...cost.warning === void 0 ? {} : { warning: cost.warning }
  };
}

function getWebSearchConfig() {
  const webSearch = readPreferences().webSearch;
  if (webSearch === void 0 || !isWebSearchProviderId(webSearch.providerId)) {
    return void 0;
  }
  return { providerId: webSearch.providerId, apiKey: webSearch.apiKey };
}

function readPersonalizationSection() {
  const prefs = readPreferences();
  return {
    ...prefs.customInstructions !== void 0 ? { customInstructions: prefs.customInstructions } : {},
    ...prefs.userNickname !== void 0 ? { userNickname: prefs.userNickname } : {},
    ...prefs.assistantName !== void 0 ? { assistantName: prefs.assistantName } : {},
    ...prefs.personaDescription !== void 0 ? { personaDescription: prefs.personaDescription } : {}
  };
}

function buildRuntimeContext(cwd) {
  return formatRuntimeContext({
    memoryContent: buildSessionMemorySection(cwd),
    personalization: readPersonalizationSection()
  });
}

const composeSystemPrompt = createSystemPromptComposerFromDefaults({
  resourcesDir: getResourcesDir(),
  loadExperts: loadExpertsNow,
  // 每轮现读技能清单：导入新技能后下一轮对话即生效，无需重启。
  enabledSkills: async (expertId) => toSkillDescriptors(await enabledSkills(expertId)),
  // 风格配置漂移记进事件日志：降级可以是体验取舍，但不能无痕。
  onStyleDrift: ({ requested, fallback }) => {
    eventLog.append({ kind: "style_drift", requested, fallback });
  }
});

let defaultWorkspaceDir = "";

let pendingWorktreeBranch;

function tempTasksDir() {
  return getTempTasksDir(getEffectiveWorkspaceRoot());
}

function pythonRuntimeOptions() {
  return defaultPythonRuntimeOptions();
}

function runtimeInventoryForSession() {
  return collectRuntimeInventory();
}

function runtimeShellEnv() {
  return planRuntimeShellInjection().env;
}

function isTempCwd(cwd) {
  return isTaskCwd(cwd, getConfigDir());
}

function defaultCwdAfterResume(cwd) {
  return isTaskPrivateCwd(cwd, getConfigDir()) ? "" : cwd;
}

function freshConversation(cwd, sceneId, interactionId, expertId) {
  const axes = normalizeLegacyInteraction(interactionId, expertId);
  return {
    state: {
      sessionId: "",
      // 未选工作空间时 cwd 为空串 = 待分配：首次执行（建宿主）时才分配独立时间戳
      // 目录（见 createHost），此刻不落盘。空串同样被 isTempCwd 判为任务区。
      cwd,
      isTempTask: isTempCwd(cwd),
      sceneId,
      interactionId: axes.interactionId,
      // 专家绑定与交互模式正交：无专家时不占字段（可选契约）。
      ...axes.expertId === void 0 ? {} : { expertId: axes.expertId },
      modelId: activeModelKey,
      isStreaming: false
    },
    entries: [],
    availableScenes: SCENES,
    availableModes: INTERACTIONS,
    welcome: WELCOME,
    cancelledTurns: [],
    artifacts: []
  };
}

const bucketsById = /* @__PURE__ */ new Map();

let currentBucket = createBucket({
  cwd: defaultWorkspaceDir,
  conversation: freshConversation(defaultWorkspaceDir, "work", "craft"),
  spawnBudget: readPreferences().spawnBudget
});

function findBucketByFile(path) {
  const resolved = resolve(path);
  for (const bucket of bucketsById.values()) {
    if (bucket.sessionFilePath !== void 0 && resolve(bucket.sessionFilePath) === resolved) {
      return bucket;
    }
  }
  return void 0;
}

function setCurrentBucket(bucket) {
  currentBucket = bucket;
  bucket.lastUsedAt = Date.now();
  evictIdleHosts();
}

function evictIdleHosts() {
  for (const bucket of pickEvictions(bucketsById.values(), currentBucket)) {
    void disbandTeamOf(bucket.sessionId);
    bucketsById.delete(bucket.sessionId);
    void backgroundJobs.killAllForSession(bucket.sessionId);
    const hostPromise = bucket.hostPromise;
    if (hostPromise === void 0) continue;
    eventLog.append({ kind: "session_evicted", sessionId: bucket.sessionId });
    void hostPromise.then((host) => host.dispose());
  }
}

const eventLog = new EventLog(join(getConfigDir(), "logs"));

const observability = new ObservabilityStore();

const runLedgerDir = join(eventLog.dir, "runs");

const RUN_LEDGER_IPC_LIMIT = 500;

const backgroundJobs = createBackgroundJobRegistry({ onAudit: writeAuditRecord });

function listLedgerSessionIds() {
  return listLedgerFiles(runLedgerDir).map((path) => {
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
    }
    return { id: basename(path, ".jsonl"), mtime };
  }).sort((a, b) => b.mtime - a.mtime).map((s) => s.id);
}

const previewServers = new PreviewServers();

const automationStore = new AutomationStore();

const sessionArchive = new SessionArchive();

const automationScheduler = new AutomationScheduler({
  store: automationStore,
  execute: createAutomationRunExecutor({
    getCatalog,
    getModelKey: () => activeModelKey,
    resources: RESOURCES,
    // 定时任务 run 会话保持 work+craft 不起专家（spec: rework-expert-orthogonal-and-skills
    // —— 专家绑定是会话级 UI 状态，无人值守会话没有人格入口），expertId 恒 undefined。
    compose: async (_cwd, sceneId, interactionId, piContext) => (await composeSystemPrompt({ sceneId, interactionId, expertId: void 0, piContext })).prompt,
    // run 会话同样是多轮会话，逐轮可变事实走注入（提示词里不再有它们）——
    // 注入块按 run 的 cwd 现读记忆与个性化，与用户会话同一个组装函数。
    composeRuntimeContext: buildRuntimeContext,
    getPermissions: () => activePermissions,
    // 全局默认推理强度现读偏好不缓存：run 会话建宿主才走这条读路径，
    // 不在热路径上（与 activePermissions 的模块级缓存不同 —— 那个每次
    // 工具调用都要读）。用户在设置页改完，下一次 run 即刻生效。
    getThinkingLevel: () => readPreferences().thinkingLevel,
    // 托管运行时清单 → run 会话 hidden context 的 python_env 段。run 会话的
    // 提示词同样是 work 骨架（含 python-env 片段），模型需要这条才知道该用
    // 哪个解释器（值与用户会话同一处取值：collectRuntimeInventory）。
    getRuntimeInventory: runtimeInventoryForSession,
    protectedDirs: PROTECTED_DIRS,
    isTempCwd,
    isOwnWorkspace: (dir) => isPathInside(getEffectiveWorkspaceRoot(), dir) || isPathInside(getConfigDir(), dir),
    getWebSearchConfig,
    // run 会话恒不绑专家，技能就是全局池 —— 但仍走技能单一出口 skillSets
    //（与它自己的提示词技能清单段同源，见 skillSets / enabledSkills 注释）。
    resolveSkills: () => toUseSkills(void 0),
    // 工具结果落盘失败的上报：run 会话与用户会话同一个 spill 钩子，
    // 失败口径也必须一致（否则「无人值守下结果丢了」在 event-log 里没有痕迹）。
    reportSpill: (message) => eventLog.append({ kind: "tool_result_spill_error", message })
  }),
  push: (event) => {
    post({ kind: "push", channel: PUSH.automationEvent, payload: event });
  }
});

function pushAutomationChanged() {
  post({ kind: "push", channel: PUSH.automationEvent, payload: { kind: "changed" } });
}

function saveAutomation(input) {
  const name = input.name.trim();
  if (name === "") throw new Error("任务名称不能为空");
  const prompt = input.prompt.trim();
  if (prompt === "") throw new Error("任务内容不能为空");
  const scheduleError = validateSchedule(input.schedule);
  if (scheduleError !== void 0) throw new Error(scheduleError);
  const cwd = input.cwd.trim();
  if (cwd === "") throw new Error("工作目录不能为空");
  const cwdError = validateWorkspacePath(cwd);
  if (cwdError !== void 0) throw new Error(cwdError);
  const now = Date.now();
  const existing = input.id === void 0 ? void 0 : automationStore.get(input.id);
  if (input.id !== void 0 && existing === void 0) {
    throw new Error("定时任务不存在，可能已被删除");
  }
  const nextRunAt = nextRunAfter(input.schedule, now);
  const status = existing?.status === "paused" ? "paused" : nextRunAt === void 0 ? "missed" : "active";
  const task = {
    id: existing?.id ?? randomUUID(),
    name,
    prompt,
    schedule: input.schedule,
    cwd,
    status,
    runs: existing?.runs ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextRunAt,
    lastRunAt: existing?.lastRunAt
  };
  automationStore.upsert(task);
  pushAutomationChanged();
  return task;
}

function toggleAutomation(id) {
  const task = automationStore.get(id);
  if (task === void 0) throw new Error("定时任务不存在");
  const now = Date.now();
  let next;
  if (task.status === "active") {
    next = { ...task, status: "paused", updatedAt: now };
  } else {
    const nextRunAt = nextRunAfter(task.schedule, now);
    next = {
      ...task,
      status: nextRunAt === void 0 ? "missed" : "active",
      nextRunAt,
      updatedAt: now
    };
  }
  automationStore.upsert(next);
  pushAutomationChanged();
  return next;
}

const runStartWaiters = /* @__PURE__ */ new WeakMap();

function emitSessionEvent(bucket, event) {
  if (event.type === "session_state" && bucket.skippedLines !== void 0 && event.state.skippedLines === void 0) {
    event = {
      type: "session_state",
      state: { ...event.state, skippedLines: bucket.skippedLines }
    };
  }
  if (event.type === "session_state" && bucket.worktree !== void 0) {
    event = {
      type: "session_state",
      state: { ...event.state, worktree: bucket.worktree }
    };
  }
  bucket.conversation = conversationReducer(bucket.conversation, { event });
  bucket.running = bucket.conversation.state.isStreaming;
  observability.record(bucket.sessionId, event);
  eventLog.append({
    kind: "session_event",
    sessionId: bucket.sessionId,
    event: sanitizeForLog(event)
  });
  const envelope = { sessionId: bucket.sessionId, event };
  post({ kind: "push", channel: PUSH.sessionEvent, payload: envelope });
  if (event.type === "run_started" || event.type === "run_finished" || event.type === "run_error") {
    pushTaskListChanged();
    if (event.type !== "run_started") evictIdleHosts();
  }
  if (event.type === "run_error" || event.type === "run_finished" && event.outcome === "cancelled") {
    const reason = event.type === "run_error" ? "error" : "terminated";
    if (teamRegistry.settleRunningMembers(bucket.sessionId, reason).length > 0) {
      emitTeamProgress(bucket.sessionId);
    }
  }
  if (event.type === "run_started") {
    const waiters = runStartWaiters.get(bucket);
    if (waiters !== void 0) {
      for (const waiter of waiters) waiter();
    }
  }
  if (event.type === "session_state" && event.state.contextUsage !== void 0) {
    emitContextUsageDetail(bucket, event.state.contextUsage);
  }
  if (event.type === "session_state") emitSessionStats(bucket, event.state.sessionId);
}

function emitContextUsageDetail(bucket, contextUsage) {
  const usage = deriveContextUsageDetail({
    contextUsage,
    systemPromptTokens: bucket.systemPromptTokens,
    skillsTokens: bucket.skillsTokens,
    // 入模成分由宿主上报 / adoptHost 现取（口径见 core/session-host.ts 的
    // composeContextMessages）。缺失时按 0 处理：差额全部落进「其他」，
    // 好过编一份看起来完整的分类。
    composition: bucket.contextComposition
  });
  if (usage === void 0) return;
  emitSessionEvent(bucket, { type: "context_usage", usage });
}

function emitSessionStats(bucket, sessionId) {
  const stats = observability.sessionCard(sessionId);
  if (stats === void 0) return;
  emitSessionEvent(bucket, { type: "session_stats", stats });
}

function pushTaskListChanged() {
  void listSessions().then(
    (sessions) => {
      post({ kind: "push", channel: PUSH.taskListChanged, payload: sessions });
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`任务列表推送失败：${message}`);
      eventLog.append({ kind: "ipc_error", channel: PUSH.taskListChanged, message });
    }
  );
}

function withHardTimeout(promise, ms, message = "请求超时") {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), ms).unref?.();
    })
  ]);
}

function buildPermissionInfo(settings) {
  const base = "权限由 ZeroWork 在工具调用前判定：它能拦住助手主动的读写与命令，但不能约束已运行程序的行为。凭据目录（.ssh/.gnupg/.aws 等）在任何档位下都禁止读写。";
  const sandbox = latestSandboxDiagnostics?.diagnostics;
  let sandboxNote = "";
  if (sandbox !== void 0) {
    sandboxNote = sandbox.available ? (
      // 说清「加固了什么」也说清「没加固什么」——只讲前半句会让用户
      // 以为这是完整隔离，那正是 pi security.md 警告的错误安全感。
      //
      // 【2026-09-20 更正一处过度承诺】这段此前写的是"工作目录之外的写入
      // 会被系统拒绝"，实测只对**新建 / 覆盖**成立：删除走父目录的
      // FILE_DELETE_CHILD，不受 WRITE_RESTRICTED 的 restricting 交集约束
      // （而且在 Electron utilityProcess 里与普通 Node 里结果相反，
      // 见 docs/readonly-删除缺口-三面对照.md §2）。删除现在由**命令意图闸**
      // 把关（只读档直接拒、默认档删工作目录之外时先问），所以这里如实分开说。
      "　命令执行（PowerShell）的写范围受操作系统约束：工作目录之外的**新建 / 覆盖**会被系统拒绝。**删除不受这一层约束** —— 删除另由命令意图闸把关：只读档直接拒绝，默认档要删工作目录之外时会先问你。读取与联网**不受**任何约束。"
    ) : `　命令执行未受操作系统级写入约束（${describeSandboxReason(sandbox.reason)}），写入范围仅由上述权限判定把关。`;
  }
  return {
    settings,
    /*
     * **恒为 partial，不因沙箱生效而改成 full。**
     * WRITE_RESTRICTED 机制上只约束写：读与网络完全不受约束（已实测），
     * 且存在 Everyone 环境写 ACE 与 NTFS 硬链接两个已知缺口
     * （见 docs/architecture.md §4.4b 的已知边界）。
     */
    enforcement: "partial",
    // 沙箱状态并进这段文案（设置页整段渲染）；机器可读的诊断在事件日志的
    // sandbox_status 里，不另开没有读取方的结构化字段。
    enforcementNote: `${base}${sandboxNote}`,
    // 授权成本单列一段：它只进设置页，**不进 chip 的 hover 提示**
    //（permission-menu 也读 enforcementNote，那里塞一串数字是噪音）。
    ...latestSandboxDiagnostics?.diagnostics.prepare === void 0 ? {} : {
      sandboxPrepareNote: sandboxPrepareNoteOf(
        latestSandboxDiagnostics.workspace,
        latestSandboxDiagnostics.diagnostics.prepare
      )
    }
  };
}

function sandboxPrepareNoteOf(workspace, prepare) {
  const seconds = Math.max(0, prepare.elapsedMs) / 1e3;
  const cost = seconds >= 10 ? `${Math.round(seconds)} 秒` : `${seconds.toFixed(1)} 秒`;
  const scale = prepare.entries === void 0 ? "" : `（目录内约 ${prepare.entries.toLocaleString("zh-CN")} 个条目${prepare.capped === true ? "，已达扫描上限，实际更多" : ""}）`;
  const state = prepare.fastPath ? "幂等命中，未重新传播" : "首次为该目录传播写入权限";
  return `　最近一次沙箱授权：${workspace} —— ${state}，耗时 ${cost}${scale}。同一目录此后每次都是毫秒级（权限标记常驻）。`;
}

const sandboxDiagnosticsByWorkspace = /* @__PURE__ */ new Map();

let latestSandboxDiagnostics;

function describeSandboxReason(reason) {
  switch (reason) {
    case "not-windows":
      return "当前系统不是 Windows";
    case "ffi-load-failed":
      return "系统调用组件加载失败";
    case "token-creation-failed":
      return "受限令牌创建失败";
    case "acl-grant-failed":
      return "工作目录授权失败";
    case "unsupported-filesystem":
      return "工作目录所在磁盘不支持权限控制";
    case "process-start-failed":
      return "命令执行环境的启动自检未通过";
    case "prepare-worker-failed":
      return "授权组件未能启动";
    case "disabled-by-setting":
      return "已被设置关闭";
    default:
      return "原因未知";
  }
}

function recordSandboxDiagnostics(diagnostics, cwd) {
  const key = cwd.toLowerCase();
  const previous = sandboxDiagnosticsByWorkspace.get(key);
  sandboxDiagnosticsByWorkspace.set(key, diagnostics);
  latestSandboxDiagnostics = { diagnostics, workspace: cwd };
  if (previous !== void 0 && previous.available === diagnostics.available && previous.reason === diagnostics.reason && // 授权成本也是「有新东西可看」的一种：首次授权（几十秒）与幂等命中（毫秒）
  // 的 available/reason 完全一样，只看那两个字段的话这次测量就永远不进日志。
  previous.prepare === void 0) {
    return;
  }
  eventLog.append({
    kind: "sandbox_status",
    available: diagnostics.available,
    ...diagnostics.reason === void 0 ? {} : { reason: diagnostics.reason },
    ...diagnostics.detail === void 0 ? {} : { detail: diagnostics.detail },
    ...diagnostics.prepare === void 0 ? {} : {
      prepare: {
        elapsedMs: diagnostics.prepare.elapsedMs,
        fastPath: diagnostics.prepare.fastPath,
        ...diagnostics.prepare.entries === void 0 ? {} : { entries: diagnostics.prepare.entries },
        ...diagnostics.prepare.capped === void 0 ? {} : { capped: diagnostics.prepare.capped }
      }
    },
    cwd
  });
}

function sanitizeForLog(event) {
  if (!isStreamingEvent(event)) return event;
  if (event.type === "tool_stream_progress") {
    return event.rawArgs === void 0 ? event : { ...event, rawArgs: `(${event.rawArgs.length} chars)` };
  }
  return { ...event, delta: `(${event.delta.length} chars)` };
}

const pendingApprovals = /* @__PURE__ */ new Map();

function adoptedSessionId(bucket) {
  if (bucket.sessionId === "") {
    throw new Error("问卷/审批请求的桶 sessionId 为空：宿主尚未 adopt，adopt 顺序已变");
  }
  return bucket.sessionId;
}

function requestApproval(request, sessionId) {
  const id = randomUUID();
  eventLog.append({
    kind: "permission_request",
    id,
    toolName: request.toolName,
    risk: request.risk,
    summary: request.summary
  });
  const memberTeam = sessionId === "" ? void 0 : teamRegistry.getTeamByMemberSession(sessionId);
  const member = memberTeam === void 0 ? void 0 : [...memberTeam.members.values()].find((candidate) => candidate.sessionId === sessionId);
  const attribution = memberTeam === void 0 || member === void 0 ? {} : { fromMember: member.name, fromTeam: memberTeam.name };
  return new Promise((resolve2, reject) => {
    pendingApprovals.set(id, { toolName: request.toolName, resolve: resolve2 });
    try {
      post({
        kind: "push",
        channel: PUSH.permissionRequest,
        payload: { id, sessionId, ...attribution, ...request }
      });
    } catch (error) {
      pendingApprovals.delete(id);
      eventLog.append({
        kind: "permission_response",
        id,
        toolName: request.toolName,
        outcome: "unavailable",
        error: error instanceof Error ? error.message : String(error)
      });
      reject(error);
    }
  });
}

const pendingQuestionnaires = /* @__PURE__ */ new Map();

function requestQuestionnaireAnswers(request) {
  eventLog.append({
    kind: "questionnaire_request",
    id: request.id,
    questionCount: request.questions.length
  });
  return new Promise((resolve2, reject) => {
    pendingQuestionnaires.set(request.id, { resolve: resolve2, reject });
    post({
      kind: "push",
      channel: PUSH.questionnaireRequest,
      payload: request
    });
  });
}

const mcpHandleByBucket = /* @__PURE__ */ new WeakMap();

function mcpEditCwd() {
  return isTempCwd(currentBucket.cwd) ? void 0 : currentBucket.cwd;
}

function liveMcpHandles() {
  const handles = [];
  const collect = (bucket) => {
    const handle = mcpHandleByBucket.get(bucket);
    if (handle !== void 0 && !handles.includes(handle)) handles.push(handle);
  };
  collect(currentBucket);
  for (const bucket of bucketsById.values()) collect(bucket);
  return handles;
}

const subagentRunner = createSubagentRunner({
  getCatalog,
  getModelKey: () => activeModelKey,
  resources: RESOURCES,
  /*
   * 输出语言规则（ARCHITECTURE §4.15）：与 composeSystemPrompt 同一来源现读。
   * 子代理必须与主会话同一份 —— 它的报告会回到主会话上下文里。
   */
  languageBody: loadLanguagePrompt(getResourcesDir()),
  getPermissions: () => activePermissions,
  // 全局默认推理强度（现读偏好，理由同 automation 装配处）：子代理会话
  // 每次新建、逐会话还原不适用，全局默认即口径。
  getThinkingLevel: () => readPreferences().thinkingLevel,
  // 超时可配置（spec: add-team-foundations 防线参数化）：现读偏好，
  // 未配置由 runner 侧回编译期缺省（10 分钟）。
  getTimeoutMs: () => readPreferences().subagentTimeoutMs,
  protectedDirs: PROTECTED_DIRS,
  isTempCwd,
  isOwnWorkspace: (dir) => isPathInside(getEffectiveWorkspaceRoot(), dir) || isPathInside(getConfigDir(), dir),
  getWebSearchConfig,
  /*
   * 子代理审批的归属：subagentRunner 是进程级单例、无桶上下文，拿不到
   * 发起它的会话 id —— 传空串，渲染层把空串当「全局」（badge 不落任何行、
   * 弹窗全局），不推会误导归属的假 id。已知近似：子代理审批占少数，
   * 待 subagent-runner 带桶上下文后再精确化。
   */
  requestApproval: (request) => requestApproval(request, "")
});

const memberRunnerDeps = {
  getCatalog,
  getModelKey: () => activeModelKey,
  resources: RESOURCES,
  getPermissions: () => activePermissions,
  getThinkingLevel: () => readPreferences().thinkingLevel,
  protectedDirs: PROTECTED_DIRS,
  isTempCwd,
  isOwnWorkspace: (dir) => isPathInside(getEffectiveWorkspaceRoot(), dir) || isPathInside(getConfigDir(), dir),
  getWebSearchConfig,
  // 成员审批带自己的会话 id（批次 ⑦）：requestApproval 据此反查团队归属。
  requestApproval: (request, memberSessionId) => requestApproval(request, memberSessionId)
};

async function wakeMember(leaderSessionId, memberName, memberSessionId, text) {
  const handle = memberHandlesBySession.get(memberSessionId);
  if (handle === void 0) throw new Error(`成员会话丢失：${memberSessionId}`);
  teamRegistry.markStatus(leaderSessionId, memberName, "running", "已收到新指示");
  emitTeamProgress(leaderSessionId);
  try {
    await handle.prompt(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    teamRegistry.markStatus(leaderSessionId, memberName, "failed", `投递失败：${message}`);
    emitTeamProgress(leaderSessionId);
    throw error;
  }
}

const teamMailbox = new SessionMailbox();

function deliverSessionMessage(fromSessionId, toSessionId, text, fromLabel) {
  const target = bucketsById.get(toSessionId);
  if (target === void 0) {
    throw new Error(`目标会话不存在：${toSessionId}`);
  }
  if (target.hostPromise === void 0) {
    throw new Error("目标会话还没有建立对话，无法接收消息");
  }
  teamMailbox.deliver(toSessionId, fromSessionId, text, fromLabel);
  const composeFromMailbox = async () => {
    const messages = teamMailbox.drain(toSessionId);
    return messages.map((message) => `[来自会话「${message.fromLabel ?? message.fromSessionId}」的消息]
${message.text}`).join("\n\n---\n\n");
  };
  if (target.running) {
    return (async () => {
      const host = await target.hostPromise;
      if (host === void 0) return { queued: false };
      teamMailbox.drain(toSessionId);
      const composed = `[来自会话「${fromLabel ?? fromSessionId}」的消息]
${text}`;
      return host.prompt(composed, "followUp");
    })();
  }
  return enqueue(target, async () => {
    const composed = await composeFromMailbox();
    if (composed === "") return { queued: false };
    const host = await target.hostPromise;
    if (host === void 0) return { queued: false };
    return host.prompt(composed, "followUp");
  });
}

const teamMessaging = { mailbox: teamMailbox, deliver: deliverSessionMessage };

const teamRegistry = new TeamRegistry();

const memberHandlesBySession = /* @__PURE__ */ new Map();

const teamTaskBoard = new TeamTaskBoard();

const deliveredTeamFingerprints = /* @__PURE__ */ new Map();

function deliveredLedgerOf(leaderSessionId) {
  let ledger = deliveredTeamFingerprints.get(leaderSessionId);
  if (ledger === void 0) {
    ledger = collectFingerprintsFromSession(
      readMemberTranscript(leaderSessionId).map((message) => message.text).join("\n")
    );
    deliveredTeamFingerprints.set(leaderSessionId, ledger);
  }
  return ledger;
}

function takePendingTeamOutput(leaderSessionId) {
  if (leaderSessionId === "") return void 0;
  if (!isAgentTeamsEnabled()) return void 0;
  const team = teamRegistry.getTeam(leaderSessionId);
  if (team === void 0) return void 0;
  const members = collectTeamOutputMembers(team, (sid) => readMemberTranscriptView(sid).output) ?? [];
  const delivered = deliveredLedgerOf(leaderSessionId);
  const composed = composePendingTeamOutput({ teamName: team.name, members, delivered });
  if (composed === void 0) return void 0;
  for (const fingerprint of composed.fingerprints) delivered.add(fingerprint);
  return composed.text;
}

function emitTeamProgress(leaderSessionId) {
  const team = teamRegistry.getTeam(leaderSessionId);
  if (team === void 0) return;
  const statusMap = {
    spawning: "queued",
    running: "running",
    // closing 仍是活动态（成员在整理收尾报告），UI 上不该显示成「已完成」。
    closing: "running",
    idle: "done",
    failed: "failed",
    closed: "done",
    // 中断是**独立态**（spec: add-team-interrupt-diagnostics 批次 ①）：
    // 折成 failed 会让用户以为成员自己出错，折成 done 会让他以为活干完了。
    // 它要传达的是第三件事：宿主没了，那一轮很可能跑完但产出没回来。
    interrupted: "interrupted"
  };
  const members = [...team.members.values()].map(
    (member) => ({
      kind: "team",
      agent: member.name,
      task: member.task,
      status: statusMap[member.status] ?? "running",
      activity: member.lastActivity,
      turns: member.turns,
      ...member.sessionId === void 0 ? {} : { sessionId: member.sessionId },
      ...member.toolCalls > 0 ? { toolCalls: member.toolCalls } : {},
      ...member.tokens > 0 ? { tokens: member.tokens } : {},
      ...member.cost > 0 ? { cost: member.cost } : {},
      // 等待起点（批次 ②）：只在真的在等（running）时下发，其余态缺席 ——
      // 消费端按「缺席 = 不在等」解释，不需要自己判 status。
      ...member.waitingSince > 0 ? { waitingSince: member.waitingSince } : {},
      /*
       * 产出可读（spec: add-team-pull-model 批次③）：**从成员会话文件派生**，
       * 不是注册表标记 —— 拉模式的全部意义是「文件是唯一真源」。
       * 与 getTeamState 同源同判据（都走 readMemberTranscriptView），
       * 两处不许各算一份。
       */
      ...member.sessionId !== void 0 && readMemberTranscriptView(member.sessionId).output !== void 0 ? { outputAvailable: true } : {}
    })
  );
  const bucket = bucketsById.get(leaderSessionId);
  if (bucket === void 0) return;
  emitSessionEvent(bucket, { type: "team_member_progress", members });
  persistTeam(leaderSessionId);
}

const persistedFingerprint = /* @__PURE__ */ new Map();

function persistTeam(leaderSessionId) {
  const team = teamRegistry.getTeam(leaderSessionId);
  if (team === void 0) return;
  const members = [...team.members.values()].map((member) => ({
    name: member.name,
    agentName: member.agentName,
    task: member.task,
    ...member.sessionId === void 0 ? {} : { sessionId: member.sessionId },
    status: member.status,
    turns: member.turns,
    toolCalls: member.toolCalls,
    tokens: member.tokens,
    cost: member.cost,
    planStatus: member.planStatus,
    planFeedback: member.planFeedback
    /*
     * 落盘不含任何「产出是否送达」字段（spec: add-team-pull-model 批次④ 已删掉
     * `pendingDelivery`）：拉模式下产出永远在成员会话 JSONL 里，重启后
     * `restoreTeam` 直接读文件派生出「有没有产出」，不需要落盘副本
     * （那反而是可能与文件不一致的第二真源）。
     */
  }));
  const tasks = teamTaskBoard.listTasks(leaderSessionId);
  const fingerprint = `${team.name}\0${JSON.stringify(members)}\0${JSON.stringify(tasks)}`;
  if (persistedFingerprint.get(leaderSessionId) === fingerprint) return;
  try {
    const snapshot2 = {
      version: TEAM_STORE_VERSION,
      name: team.name,
      leaderSessionId,
      updatedAt: Date.now(),
      members,
      tasks
    };
    writeTeam(getConfigDir(), snapshot2);
    persistedFingerprint.set(leaderSessionId, fingerprint);
  } catch (error) {
    eventLog.append({
      kind: "team_persist_failed",
      sessionId: leaderSessionId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function restoreTeamsFromDisk() {
  let restored = 0;
  try {
    for (const stored of readTeams(getConfigDir())) {
      teamRegistry.restoreTeam(
        stored.leaderSessionId,
        stored.name,
        stored.members,
        (sessionId) => readMemberTranscriptView(sessionId).status
      );
      teamTaskBoard.restore(stored.leaderSessionId, stored.tasks);
      restored += 1;
    }
  } catch (error) {
    eventLog.append({
      kind: "team_restore_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (restored > 0) {
    eventLog.append({ kind: "team_restored", message: `从磁盘恢复 ${restored} 个团队` });
  }
}

function emitMemberEvent(memberSessionId, event) {
  const envelope = { sessionId: memberSessionId, event };
  post({ kind: "push", channel: PUSH.sessionEvent, payload: envelope });
}

function isAgentTeamsEnabled() {
  return readPreferences().agentTeamsEnabled ?? false;
}

async function disbandTeamOf(leaderSessionId) {
  const team = teamRegistry.getTeam(leaderSessionId);
  if (team === void 0) return;
  for (const member of team.members.values()) {
    if (member.sessionId === void 0) continue;
    const handle = memberHandlesBySession.get(member.sessionId);
    if (handle !== void 0) {
      await handle.abort().catch(() => {
      });
      handle.dispose();
      memberHandlesBySession.delete(member.sessionId);
    }
  }
  const teamName = team.name;
  teamRegistry.disband(leaderSessionId);
  teamTaskBoard.clear(leaderSessionId);
  persistedFingerprint.delete(leaderSessionId);
  try {
    removeTeam(getConfigDir(), teamName);
  } catch (error) {
    eventLog.append({
      kind: "team_persist_failed",
      sessionId: leaderSessionId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const bucket = bucketsById.get(leaderSessionId);
  if (bucket !== void 0) bucket.hasTeam = false;
}

function getHost(bucket) {
  if (bucket.hostPromise === void 0) {
    const attempt = createHost(bucket).then((host) => {
      adoptHost(bucket, host);
      return host;
    });
    bucket.hostPromise = attempt;
    attempt.catch(() => {
      if (bucket.hostPromise === attempt) bucket.hostPromise = void 0;
    });
  }
  return bucket.hostPromise;
}

function adoptHost(bucket, host) {
  bucket.hostPromise = Promise.resolve(host);
  bucket.sessionId = host.state.sessionId;
  bucket.sessionFilePath = host.sessionFilePath;
  bucket.contextComposition = host.getContextComposition();
  bucketsById.set(bucket.sessionId, bucket);
  bucket.lastUsedAt = Date.now();
  emitSessionEvent(bucket, { type: "session_state", state: host.state });
  evictIdleHosts();
}

async function createHost(bucket, sessionManager) {
  const catalog = await getCatalog();
  if (activeModelKey === void 0) {
    throw new Error(
      "还没有选择模型。请点左下角设置，为任一服务商填写 API Key 并选择模型。"
    );
  }
  if (!catalog.isUsable(activeModelKey)) {
    throw new Error(
      "选中的模型当前不可用，请到设置里检查 API Key 或重新选择模型。"
    );
  }
  if (bucket.cwd === "") {
    bucket.cwd = allocatePendingCwd(bucket.cwd, getEffectiveWorkspaceRoot());
    void previewServers.ensure(bucket.cwd).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`预览服务启动失败：${message}`);
      eventLog.append({ kind: "ipc_error", channel: "preview:ensure", message });
    });
  }
  if (bucket.pendingWorktreeBranch !== void 0) {
    const baseBranch = bucket.pendingWorktreeBranch;
    bucket.pendingWorktreeBranch = void 0;
    const repoCwd = bucket.cwd;
    if (repoCwd !== "" && await isGitRepo(repoCwd)) {
      try {
        const worktree = await createWorktree({ repoCwd, baseBranch });
        bucket.worktree = worktree;
        bucket.cwd = worktree.worktreePath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`worktree 副本创建失败，回退到原目录继续：${message}`);
        eventLog.append({ kind: "ipc_error", channel: "worktree:create", message });
      }
    } else {
      console.error(
        `worktree 意图未生效：${repoCwd === "" ? "会话还没有工作目录" : `不是 git 仓库：${repoCwd}`}`
      );
    }
  }
  const cwd = bucket.cwd;
  mkdirSync(cwd, { recursive: true });
  void warmUpSandbox({
    workspaceDir: cwd,
    mode: activePermissions.sandbox,
    onDiagnostics: (diagnostics) => recordSandboxDiagnostics(diagnostics, cwd)
  });
  const globalAgents = loadAgents(join(getResourcesDir(), "agents"), join(getConfigDir(), "agents"));
  let agentsCache;
  const resolveAgents = () => {
    const expertId = bucket.conversation.state.expertId;
    if (agentsCache !== void 0 && agentsCache.expertId === expertId) return agentsCache.agents;
    const expert = expertId === void 0 ? void 0 : loadExpertsNow().find((e) => e.name === expertId);
    const agents = mergeAgentPools(globalAgents, expert?.agents ?? []);
    agentsCache = { expertId, agents };
    return agents;
  };
  const mcpClient = createMcpClient({ cwd });
  const initialThinkingLevel = sessionManager === void 0 ? bucket.conversation.state.thinkingLevel ?? readPreferences().thinkingLevel : void 0;
  const sandboxRunnerOptions = {
    getSettings: () => activePermissions,
    // 快照与权限门同口径：cwd 在宿主存活期间不会变（见 sandbox-runner 注释）。
    workspaceDir: cwd,
    // 降级路径就是今天在跑的那条 spawn，不另写一遍。
    fallback: runCommand,
    /*
     * 运行时注入补丁（SubTask 2.1.3）：启用且就绪的托管运行时进
     * 模型 shell 子进程的 PATH（沙箱与降级两条路径共用这一份）。
     * 每次执行现算 ⇒ 设置页改开关后无需重启即生效。
     */
    runtimeEnv: runtimeShellEnv,
    /*
     * 技能依赖写目录（P1：技能自己的 `node_modules` 在沙箱
     * 写白名单里）：技能目录对沙箱只放开了**读**，模型在技能目录里跑
     * `npm install` 会被写约束拒（UnauthorizedAccessException），技能脚本随即
     * ERR_MODULE_NOT_FOUND。清单在核心侧现算 —— 沙箱层不认识技能是什么
     * （与 runtimeEnv 同一取向）。getter：技能是新装的，装完下一条命令就该生效。
     *
     * 只放开每个技能的 `node_modules`：`SKILL.md` 正文与 `scripts/` 仍不可写
     *（正文即提示词）。**只挂在主会话**：子代理与无人值守各自装配（或不装配）
     * 执行器，见那些调用点的注释。
     */
    extraWritableDirs: () => listSkillDependencyWriteDirs(),
    onDiagnostics: (diagnostics) => recordSandboxDiagnostics(diagnostics, cwd),
    // 沙箱拒绝执行与提权决定同样进审计（「沙箱」一类，写入点在 sandbox-runner）。
    onAudit: writeAuditRecord,
    /*
     * 一次性提权审批（spec: add-windows-acl-sandbox 二阶段）。
     *
     * 走**与权限门同一条** requestApproval 通道：用户面对的是同一种弹窗，
     * 审计日志里也是同一类记录。sessionId 与 pendingApprovals 的处理
     * 与权限门那边同一口径（见下方 createPermissionGate 的注释）——
     * 有待答审批的桶必须豁免 LRU 回收，否则用户正在看的框会随宿主消失。
     *
     * `risk: "high"` 不只是显示强调：审批弹窗对高风险**不提供**
     * 「本次会话记住」选项（permission-dialog.tsx），而权限门回程也
     * 对高风险忽略 remember —— 正好落实「提权只对本次调用有效」。
     * 跳过沙箱是我们能给出的最宽授权，不该有任何形式的免检。
     *
     * 后台启动走同一份：后台命令同样会写文件，凭什么比前台更宽。
     */
    requestEscalation: async ({ toMode, justification, command }) => {
      const sessionId = adoptedSessionId(bucket);
      bucket.pendingApprovals += 1;
      try {
        const response = await requestApproval(
          {
            toolName: "powershell",
            summary: toMode === "danger-full-access" ? "跳过沙箱写入约束执行这条命令（本次有效）" : `把这条命令的权限放宽到「${toMode}」（本次有效）`,
            // 理由与命令原文都要给：用户得知道模型想干什么、以及为什么。
            details: `模型给出的理由：${justification}

命令：${command}`,
            risk: "high"
          },
          sessionId
        );
        return isGranted(normalizeApprovalOutcome(response));
      } finally {
        bucket.pendingApprovals -= 1;
        evictIdleHosts();
      }
    }
  };
  const startSandboxedInBackground = createSandboxedBackgroundStarter({
    ...sandboxRunnerOptions,
    /*
     * danger-full-access 档的后台直连路径（P0：后台常驻命令）。
     *
     * 该档的语义就是「没有操作系统级写入约束」，所以它不经沙箱 —— 与前台在这一档
     * 直接走降级 spawn 是同一条理由（见 sandbox-runner 的分支顺序）。缺了这一格，
     * 本档的后台启动会被**明确拒绝**（不是静默退回前台），于是「允许完全访问」的
     * 用户反而起不了常驻服务 —— 与档位想表达的东西正好相反。
     *
     * 运行时注入补丁照样带上：后台命令与前台命令必须看到同一份环境，否则启用中的
     * 托管运行时（node / git）在后台解析不到，症状是「前台能跑、后台莫名跑不起来」。
     *
     * **这条路径只在 danger-full-access 生效**：另两档的后台启动一律走受限令牌
     * （startSandboxed），本回调根本不会被调用。
     */
    fallbackBackground: (command) => startDirectBackground(command, runtimeShellEnv())
  });
  const backgroundStarter = async (command, callOptions) => {
    const started = await startSandboxedInBackground(command, callOptions);
    if (started.kind !== "started") return started;
    const registration = backgroundJobs.register({
      // sessionKey = 本会话的 id：工具层拿不到它，归属只在这里绑定（跨会话隔离的根）。
      sessionKey: adoptedSessionId(bucket),
      command,
      pid: started.pid,
      handle: started.handle
    });
    if (!registration.ok) {
      started.handle.kill();
      return { kind: "blocked", blocked: true, category: "background-limit", reason: registration.reason };
    }
    return { ...started, jobId: registration.id };
  };
  const host = await SessionHost.create({
    catalog,
    modelKey: activeModelKey,
    cwd,
    isTempTask: isTempCwd(cwd),
    sceneId: bucket.conversation.state.sceneId,
    interactionId: bucket.conversation.state.interactionId,
    // MCP 工具的初次激活（扩展加载期 action 方法不可用，工厂自己激活不了）。
    extraActiveTools: () => mcpClient.registeredToolNames(),
    // 专家绑定与两轴正交，随会话状态一起进宿主（resume/newTask 沿用口径同两轴）。
    ...bucket.conversation.state.expertId === void 0 ? {} : { expertId: bucket.conversation.state.expertId },
    emit: (event) => emitSessionEvent(bucket, event),
    resources: RESOURCES,
    // 运行台账按真值 sessionId 建（工厂语义见 SessionHostOptions.createLedger）。
    // 写入失败只进 event-log 不炸 run —— 台账是观测不是业务（run-ledger.ts 文件头）。
    createLedger: (sessionId) => new RunLedger(
      runLedgerDir,
      sessionId,
      (message) => {
        eventLog.append({ kind: "run_ledger_error", sessionId, message });
      },
      Date.now,
      // 增量投影：条目落盘即 fold 进诊断页聚合（会话级统计 / 缓存浪费），
      // 不必等下次启动回放（observability.foldLedgerEntry 注释）。
      (entry) => {
        observability.foldLedgerEntry(sessionId, entry);
        if (entry.kind === "llm_call" || entry.kind === "run_end") {
          emitSessionStats(bucket, sessionId);
        }
      }
    ),
    // request_snapshot 的 system 分段 provenance：prompt-switch 的 compose 现记现取。
    getSystemPromptSegments: () => bucket.systemPromptSegments,
    // 入模成分的反向通道：宿主每次组装请求快照时上报，存进桶供上下文用量明细
    // 同步取用（明细由事件处理器组装，拿不到宿主句柄，见 shared/context-usage.ts）。
    reportContextComposition: (composition) => {
      bucket.contextComposition = composition;
    },
    // hidden context（F5）expert 行的显示名：现载专家库查 displayName，
    // 查不到回落 undefined（宿主侧再回落 expertId）。专家库本身可能因打包
    // 问题抛错 —— 这里必须自吞（钉子拿不到名字不该炸 run）。
    getExpertLabel: () => {
      const expertId = bucket.conversation.state.expertId;
      if (expertId === void 0) return void 0;
      try {
        return loadExpertsNow().find((e) => e.name === expertId)?.displayName;
      } catch {
        return void 0;
      }
    },
    // 专家追加工具白名单（spec: add-team-foundations）：与 getExpertLabel
    // 同款注入——现载专家库查 extraTools，坏库自吞退回「不追加」（工具面
    // 退回模式白名单，比炸掉整个会话装配温和且可预期）。
    getExpertExtraTools: () => {
      const expertId = bucket.conversation.state.expertId;
      if (expertId === void 0) return void 0;
      try {
        return loadExpertsNow().find((e) => e.name === expertId)?.extraTools;
      } catch {
        return void 0;
      }
    },
    /*
     * 托管运行时清单 + 状态 → hidden context 的 python_env 段（spec:
     * add-managed-runtimes 阶段 5）。做法是把托管运行时交给模型，
     * 但位置从系统提示词挪到了注入块
     * （spec: stabilize-prompt-prefix）：
     *
     * 为什么必须让模型知道：它拿系统 Python 写脚本时，缺库的第一反应就是
     * `pip install` —— 而那在沙箱里**必定失败**（2026-09-17 现场，见
     * docs/architecture.md 已知边界第 8 条）。给出真实路径，Python 任务才会
     * 落在我们受控且已备依赖的环境上。运行时清单还负责把「被用户禁用」
     * 与「未就绪」分开告知（不许静默降级成「找不到」）。
     *
     * 为什么不能在系统提示词里：它随机器变（homedir / 安装位置 /
     * HTML_TO_DOCX_VENV），而系统提示词位于整段对话历史之前 —— venv 一重建、
     * 一换机器、私有化部署换个安装位置，该处之后的整段提示词与整段历史一起
     * 在 provider 前缀缓存里失配。清单是纯读磁盘的函数，每建宿主给的是**取值
     * 函数**（每次 run 现读），与会话内字节稳定不冲突（注入块在历史之后）。
     */
    getRuntimeInventory: runtimeInventoryForSession,
    ...sessionManager === void 0 ? {} : { sessionManager },
    ...initialThinkingLevel !== void 0 ? { thinkingLevel: initialThinkingLevel } : {},
    // 扩展由 daemon 组装：core/ 不许 import extensions/
    // （依赖方向是 extensions → core）。
    extensions: [
      /*
       * 权限门：**所有会话全量装，含临时任务**。
       *
       * playground 时代曾有不装权限门的分支 —— 那时的安全前提是「不注册
       * 文件工具即无可拦」。权限加固（权限门 + 项目信任）落地后这个前提
       * 已消失：临时任务就是普通 cwd 会话，文件工具全量注册，写操作必须
       * 与正式空间过同一道判定链，不存在「安全靠缺席」的第二种会话形态。
       */
      createPermissionGate({
        paths: {
          workspaceDir: cwd,
          configDir: getConfigDir(),
          protectedDirs: PROTECTED_DIRS,
          // 写 ZeroWork 自身目录永远高风险询问（policy 判定链里先于工作区放行）。
          // dev 是项目根、打包后是应用目录 —— 由主进程经 ZEROWORK_APP_DIR 精准传入，
          // 不读 daemon 的 cwd（见 config-paths.ts getAppDir 的踩坑注释）。
          appDir: getAppDir(),
          // 内置资源只读放行（技能渐进加载全靠 read 这里）。
          resourcesDir: getResourcesDir()
        },
        cwd,
        // getter 而非快照：用户改了预设，下一次工具调用即生效。
        // 权限档是全局设置（spec A）：一改对所有会话的后续工具调用生效。
        getSettings: () => activePermissions,
        // 前缀规则同 getSettings 的 getter 范式：批准写回（appendRule）后，
        // 已建好的宿主下一次工具调用即按新规则免问/直拒。
        getRules: () => activePermissionRules,
        // 审批按桶计数：有待答审批的桶豁免 LRU 回收 ——
        // 用户在答的框不能随宿主一起消失。
        // sessionId 在此注入（唯一注入点）：审批归属发起它的会话桶，
        // 渲染层按它路由与归属「待确认」badge。
        requestApproval: (request) => {
          const sessionId = adoptedSessionId(bucket);
          bucket.pendingApprovals += 1;
          return requestApproval(request, sessionId).finally(() => {
            bucket.pendingApprovals -= 1;
            evictIdleHosts();
          });
        }
      }),
      /*
       * 工具结果 spill（spec: adopt-dsh-disciplines Task 2.1）：**所有会话都装**，
       * 紧跟在权限门之后读起来最顺 —— 权限门管「这条调用能不能跑」，
       * 本钩子管「跑完的结果回给模型多少」（超限落盘 + 给路径，不再丢信息）。
       *
       * 落盘目录按会话 cwd 走：模型要用 read/grep 把结果读回去，
       * 放配置目录会被文件工具的禁读规则挡住（见 config-paths.getSpillsDir）。
       * 失败进 event-log，不炸 run —— 与 run-ledger 的观测纪律同出口。
       */
      spillExtensionFactory({
        dir: getSpillsDir(cwd),
        report: (message) => eventLog.append({ kind: "tool_result_spill_error", message })
      }),
      /*
       * 团队产出送达（spec: unify-team-output-delivery）：把「待送达的成员产出」块
       * 挂到**任意**工具结果末尾（原来是 team_* 工具内的包装层，本 change 收敛到这一处）。
       * **只挂用户 / 领导会话**：成员、子代理、定时任务会话名下定然没有团队注册表，
       * 它们各自的装配数组里也没有本项（该 option 不是必填，这里不注册即可）。
       *
       * **注册顺序必须排在 spill-hook 之后**（硬约束，别调）：pi 的 tool_result
       * handler 是**逐扩展链式**的（runner.ts emitToolResult 把每个 handler 的返回值
       * 写回同一个 currentEvent 再交给下一个），而 spill 用 `singleTextBlock` 判
       * 「唯一的文本块」。我们的块若先追加，结果就成了两块 ⇒ spill 直接跳过 ⇒
       * **带产出块的长输出不再落盘截断、绕过 spill 上界**（输出长度无上限）。
       * 顺序由团队产出挂钩的测试断言钉住（该测试文件未在本仓库还原）。
       *
       * composePending 走 `takePendingTeamOutput`（与 run 起点快照通道共用同一条
       * 判据，见模块作用域的那个函数）。
       */
      createTeamOutputHook({
        composePending: () => takePendingTeamOutput(bucket.sessionId)
      }),
      /*
       * 项目信任：**所有会话都装**（与权限门同理）。
       *
       * 理由：项目级资源的加载发生在工具层之前 —— `.pi/extensions` 是
       * TypeScript 模块，以本进程权限执行任意代码，权限门根本拦不到它
       * （那不是工具调用）。所以临时任务也要把这道闸挂上。
       *
       * 自家目录（生效根及其下的一切，含临时目录，与配置目录）直接信任：
       * 内容都由本机产出，没有"别人塞进来的扩展"这个来源；
       * 每次新建任务都弹框会让用户条件反射点同意，那这道防线就废了。
       * 生效根现读：用户改默认存储路径后，新根下的空间不该再弹信任框。
       */
      createProjectTrust({
        isOwnWorkspace: (dir) => isPathInside(getEffectiveWorkspaceRoot(), dir) || isPathInside(getConfigDir(), dir)
      }),
      // 产物交付：present_files 是产物的唯一入口。
      // 只读工具，所有会话都注册（区外路径不 stat，见 extensions/present-files.ts）。
      createPresentFiles({
        getWorkspaceDir: () => bucket.cwd,
        onPresent: ({ files, focusFile }) => {
          emitSessionEvent(bucket, { type: "artifacts_presented", files, focusFile });
          const hostPromise = bucket.hostPromise;
          if (hostPromise !== void 0) {
            void hostPromise.then((host2) => {
              host2.persistArtifacts(files, focusFile);
            }).catch(() => {
            });
          }
        }
      }),
      // 提示词切换：每轮按当前 场景×模式 组装 systemPrompt（见 extensions/prompt-switch.ts）。
      // 两轴与 expert 绑定的权威状态读**所属桶**的折叠镜像；技能段取自宿主的 loader 发现结果。
      createPromptSwitch({
        getCurrent: () => ({
          sceneId: bucket.conversation.state.sceneId,
          interactionId: bucket.conversation.state.interactionId,
          expertId: bucket.conversation.state.expertId
        }),
        compose: async (sceneId, interactionId, expertId, piContext) => {
          const composed = await composeSystemPrompt({ sceneId, interactionId, expertId, piContext });
          bucket.systemPromptTokens = composed.systemTokens;
          bucket.skillsTokens = composed.skillsTokens;
          bucket.systemPromptSegments = composed.segments;
          return composed.prompt;
        },
        // 逐 run 可变事实（记忆内容/个性化）的快照通道：每 run 现读本会话 cwd，
        // 内容与上一条同类型快照相同时不追加（去重判据在扩展侧）。
        // 提示词里已不含它们（见 composeSystemPrompt 注释）；时间不走这里，
        // 由本会话 SessionHost 的 hidden context `current_time` 送达。
        composeRuntimeContext: () => buildRuntimeContext(cwd),
        /*
         * hidden context 快照通道：取本 run 在宿主里冻结的那份**环境块**全文。
         * 时序成立 —— before_agent_start 只在 pi 的 session.prompt() 里触发，
         * 而 host.prompt() 在调它之前已同步 freeze（见
         * session-host.peekHiddenContext 的注释）。这里用 `host` 是
         * 「扩展工厂先于宿主建成、闭包在事件触发时才求值」的既有范式
         * （subagent-runner / member-runner 同形），事件触发时 host 必已赋值。
         */
        composeHiddenContext: () => host.peekHiddenContext(),
        /*
         * 时间快照通道：同一次 freeze 的另一半（`zerowork-run-time`）。
         * 与环境块分开取：两条通道各自去重，时间跨分钟时只追加时间那一条
         * （spec: add-supersede-note-and-time-split）。
         */
        composeRunTime: () => host.peekRunTime(),
        /*
         * 团队产出快照通道（`zerowork-team-output`，spec: inject-team-output-snapshot）：
         * **只挂用户会话（领导）** —— 只有领导名下有团队注册表，子代理 / 定时任务
         * 没有团队，装配处显式传 no-op（该 option 必填就是为让漏接编译报错）。
         *
         * 判据与门控全在模块作用域的 `takePendingTeamOutput`（与工具结果挂载点
         * `createTeamOutputHook` 的 composePending **共用同一条判据**）——「哪些产出
         * 领导还没见过」只该有一个答案，各写一份必然漂移。
         *
         * 判据读的是**只增账本**（首次由领导会话文件种子化）而非每次扫会话正文；
         * 本通道与工具结果挂载点是同一本账本的**唯一**登记点。
        */
        composeTeamOutput: () => takePendingTeamOutput(bucket.sessionId)
      }),
      // 联网工具：所有会话都装。
      // 配置读偏好文件；权限门里 web_search/web_fetch 已登记放行，不再弹窗。
      createWebTools({ getSearchConfig: getWebSearchConfig }),
      // 结构化提问：所有用户会话都装（三模式白名单都含 questionnaire）。
      // 阻塞等答走上面的 pendingQuestionnaires，与审批同一套挂起/应答语义，
      // 豁免计数也共用（pendingApprovals：用户在答的框不随宿主被 LRU 回收）；
      // 权限门登记放行（不触文件系统，见 permission-policy 的 READ_ONLY）。
      questionnaireExtensionFactory({
        // sessionId 在此注入（唯一注入点）：问卷归属发起它的会话桶，
        // 渲染层按它路由（只在查看该会话时上屏）与归属「待确认」badge。
        requestAnswers: (request) => {
          const sessionId = adoptedSessionId(bucket);
          bucket.pendingApprovals += 1;
          return requestQuestionnaireAnswers({ ...request, sessionId }).finally(() => {
            bucket.pendingApprovals -= 1;
            evictIdleHosts();
          });
        }
      }),
      /*
       * 历史会话检索（四模式白名单都含 conversation_search）：只读工具，
       * 权限门登记放行（读的是 ZeroWork 自己的会话库，与 automation_list 同档）。
       * 只挂用户会话 —— 定时任务 run 会话（automation-runner）不注册：
       * 无人值守下没有「用户回忆上次讨论」的场景（v1 从简）。
       * excludeSessionId 读桶的当前 id：闭包在工具**调用时**才求值，
       * pristine 桶 adopt 后拿到的就是真值。
       */
      conversationSearchExtensionFactory({
        searchSessions: (query, limit) => searchSessionFiles(query, limit, {
          sessionsDir: getSessionsDir(),
          ...bucket.sessionId === "" ? {} : { excludeSessionId: bucket.sessionId }
        })
      }),
      /*
       * shell 能力：craft 白名单含 powershell。三道**独立**防线，缺一不可：
       *   权限门   —— 要不要问人（balanced 高风险询问、read-only 拒，
       *                见 permission-policy 的 SHELL 分支）；
       *   检查器   —— 这条命令能不能跑（command-guard 的五类拦截）；
       *   沙箱     —— 跑起来能碰到什么（受限令牌把写约束在工作区内）。
       *
       * 沙箱**不替代**检查器：WRITE_RESTRICTED 机制上只约束写，读与网络
       * 完全不受约束（已实测），`type ~\.ssh\id_rsa` 这条路仍然只有
       * 检查器的 credential-access 拦得住（spec: add-windows-acl-sandbox）。
       */
      powershellExtensionFactory({
        /*
         * 检查器拦下的命令进审计中心（spec: add-managed-runtimes 阶段 4 的
         * 「命令安全」一类）。审计写入点在本层注入：工具层不认识审计目录，
         * 且它自己的单测不该在真实配置目录里落文件。
         */
        onAudit: writeAuditRecord,
        // 前台执行器与后台启动器共用同一份选项（sandboxRunnerOptions，见 createHost
        // 上方）：档位、工作区、运行时补丁、审批通道、审计写入点都只有一处定义。
        runner: createSandboxedRunner(sandboxRunnerOptions),
        /*
         * 后台常驻命令（P0）：让技能里的常驻服务（如 easyeda-api 的 bridge server）
         * 跨命令、跨轮存活 —— 沙箱命令原先跑完即被杀树，这类服务活不过一条命令。
         *
         * backgroundStarter 的沙箱半边与前台**同源**（createSandboxedBackgroundStarter
         * 复用同一套档位判定与拒绝文案），本层只补归属（sessionKey）与登记（见 createHost
         * 上方 backgroundStarter 的注释）。
         *
         * **只挂在用户主会话**：子代理 / 定时任务 / 成员会话一律不注入（那边
         * powershellExtensionFactory 调用点都没给这一格），工具会返回明确的
         * 「本会话不支持后台执行」文案 —— 理由见那些装配点的注释。
         */
        backgroundStarter
      }),
      /*
       * 后台任务三件套（craft 白名单含）：起由上面的 run_in_background 负责，
       * 这里补「起来之后」的读 / 停 / 列。
       *
       * 三个回调各自把 sessionKey 绑死在本会话上（adoptedSessionId(bucket)）——
       * 工具层因此看不见会话概念，也就不可能跨会话读/停别人的任务。
       * 只挂用户主会话：与 backgroundStarter 同一分界（没有后台通道的会话
       * 注册这三个工具毫无意义，只会让模型看见一组永远查不到东西的名字）。
       */
      createJobTools({
        output: (jobId) => backgroundJobs.output(jobId, adoptedSessionId(bucket)),
        kill: (jobId) => backgroundJobs.kill(jobId, adoptedSessionId(bucket)),
        list: () => backgroundJobs.list(adoptedSessionId(bucket))
      }),
      // 文档读取：所有会话都装。read_document 已登记权限门只读工具
      // （与 read 同语义），区外读取走通用的低风险询问，这里无需额外接线。
      createDocReadTool(),
      /*
       * 技能加载（三模式白名单都含 use_skill）：模型**自动**命中技能时用它取
       * SKILL.md 全文 —— pi 只有手动 /skill: 的展开，自动路径本来没有工具
       * （旧约定是让模型 read 技能文件，界面上只显示成一堆「读取文件」）。
       * 技能来源经回调注入、且与技能清单段**同源**（skillSets）；闭包在
       * 工具调用时才求值：会话中途换绑专家后，工具看到的技能集立刻跟上同出口
       * 产出的清单段，不会出现「清单里有、工具查不到」。
       * 传的是全量 + enabled 标记：被停用的技能要能被工具分辨出来并报出
       * 「已在技能页停用」（与「没这个技能」区分开），见 toUseSkills。
       */
      createUseSkillTool({
        resolveSkills: () => toUseSkills(bucket.conversation.state.expertId)
      }),
      /*
       * 技能安装（craft 白名单含 skill_install）：把模型产在工作区里的技能装进
       * 用户技能目录，接上「模型创建技能」这条链路的最后一环 —— 常规做法是
       * 直接写盘 + 扫目录即出现，但我们不能开那个写口子
       * （权限门：技能正文即提示词），所以走 importSkill 这条受校验通道。
       * agentCreated: true 是这条通道的**来源标记**（落盘为
       * SKILL.md 的 `agent_created: true`）：只有模型装的技能之后才允许被
       * 覆盖或删除，技能页导入的技能不受影响。
       * 装完把技能目录打成 `<workspace>/<name>.zip`（收尾由 package_skill.py
       * 负责），交付仍由 present_files 负责。
       * 权限档登记为「改变应用自身数据」= 询问（可记住），见 permission-policy。
       */
      createSkillInstallTool({
        installSkill: (sourcePath) => importSkill(sourcePath, { agentCreated: true }),
        packSkill: packSkillDir,
        getWorkspaceDir: () => bucket.cwd
      }),
      /*
       * 技能删除（craft 白名单含 skill_uninstall）：与上面同一条链路的回程 ——
       * 只放行模型自建的技能，
       * 判定在 core 的 removeAgentSkill。权限档同为询问（弹窗即「先跟用户确认」）。
       */
      createSkillUninstallTool({
        removeSkill: removeAgentSkill
      }),
      /*
       * docx 生成：craft 白名单含 docx_convert，所有用户会话都装。
       * 转换是 daemon 进程内受控 spawn venv python（命令与参数写死在
       * documents/docx-convert.ts），不经 agent 的 powershell 自由 shell ——
       * 这是「转换调用受控」的落点（spec Requirement）。权限按「写工作区
       * 产物文件」档：写侧判定锚定 outputPath（permission-policy 的 MUTATING）。
       */
      createDocxConvertTool({
        engineDir: join(getResourcesDir(), "docx-engine"),
        homeDir: homedir(),
        // 运行时装不上要进审计中心（「运行时」一类，写入点在工具层）。
        onAudit: writeAuditRecord
      }),
      /*
       * docx 版式提取：craft 白名单含 docx_extract，所有用户会话都装。
       * 与 docx_convert 同档：daemon 进程内受控 spawn venv python
       * （命令与参数写死在 documents/docx-extract.ts），不经 powershell；
       * 权限按「写工作区产物文件」档，写侧判定锚定 outputPath。
       */
      createDocxExtractTool({
        engineDir: join(getResourcesDir(), "docx-engine"),
        homeDir: homedir(),
        // 运行时装不上要进审计中心（「运行时」一类，写入点在工具层）。
        onAudit: writeAuditRecord
      }),
      // 内联可视化（read_me + show_widget）：无副作用、无用户交互，
      // 所有用户会话注册（run 会话的 widget 随历史可见）。
      visualizerExtensionFactory(),
      // MCP 连接器（handle 按桶登记，见上方 mcpClient 的注释）。
      mcpClient.extension,
      // 对话内 automation 工具（craft 白名单）：模型在对话里建/查/删定时任务。
      // cwd 缺省取**所属会话**的 cwd —— 会话与 cwd 终身绑定，读桶即真相。
      automationExtensionFactory(automationStore, () => bucket.cwd),
      /*
       * 待办清单（craft/expert 白名单含 todo_write）：无副作用、无用户交互，
       * 所有用户会话注册。工具本体只是载体 —— 清单状态由 renderer 从消息流
       * 聚合，历史恢复靠消息回放（见 extensions/todo-tool.ts 文件头）。
       */
      todoExtensionFactory(),
      /*
       * 子代理委派（craft 白名单）：只挂在用户会话——定时任务 run 会话
       * （automation-runner）不注册 task（无人值守下的递归委派明确不做）。
      	 * cwd 在此注入：子代理与主会话同一工作空间，产物落在用户看得见的地方。
      	 * spawn 预算按桶计（session-registry 的 SPAWN_BUDGET_PER_SESSION）：
      	 * 换桶即新预算，同一只桶内不复位（会话切 cwd 不换桶）。
      	 */
      taskExtensionFactory({
        runSubagent: (request) => subagentRunner.run({ ...request, cwd }),
        listAgents: () => resolveAgents(),
        checkBudget: () => {
          if (bucket.spawnBudgetRemaining <= 0) return false;
          bucket.spawnBudgetRemaining -= 1;
          return true;
        }
      }),
      /*
       * 团队工具四件套（spec: add-team-foundations 批 5）：agentTeamsEnabled
       * 开启时才注册（缺省关闭，白名单名静默忽略）。只挂用户会话 ——
       * automation run 会话有自己的装配（不含 team 工厂），无人值守下建团
       * 与「无人值守下递归委派」是同一条不做决策。成员 spawn 逐个消耗
       * 同一份桶预算；完成/失败经批 3 的 deliverSessionMessage 回投本会话；
       * 领导桶逐出/删除时由 disbandTeamOf 解散（防幽灵成员）。
       */
      teamExtensionFactory({
        isEnabled: isAgentTeamsEnabled,
        listAgents: () => resolveAgents(),
        startTeam: async (plan, hooks) => {
          const leaderId = adoptedSessionId(bucket);
          teamRegistry.createTeam(leaderId, plan.name, plan.members);
          bucket.hasTeam = true;
          emitTeamProgress(leaderId);
          const acks = [];
          const memberAgents = resolveAgents();
          try {
            for (const member of plan.members) {
              if (bucket.spawnBudgetRemaining <= 0) {
                throw new Error("spawn 预算已耗尽，无法启动全部成员");
              }
              bucket.spawnBudgetRemaining -= 1;
              const agent = memberAgents.find((a) => a.name === member.agentName);
              if (agent === void 0) {
                throw new Error(`没有名为「${member.agentName}」的子代理定义`);
              }
              const handle = await spawnMember(
                memberRunnerDeps,
                { cwd, agent, memberName: member.name, task: member.task, ...member.model === void 0 ? {} : { modelKey: member.model } },
                {
                  onProgress: (name, text, turnsDelta) => {
                    teamRegistry.recordProgress(leaderId, name, turnsDelta, text);
                    emitTeamProgress(leaderId);
                    hooks.onProgress(name, text);
                  },
                  /*
                   * 收尾（spec: add-team-pull-model 批次 ④，拉模式）。
                   *
                   * **这里不再回投产出**。推模式的那套（markPendingDelivery →
                   * await 回投 → markDeliveryPending → queue_changed 销账）
                   * 已整体删除，理由就是 2026-09-19 三次复现的共同结论：
                   * 「把产出推给领导」这条路上，任何一个异步环节断了，
                   * 产出就静默消失，而且我们无法用任何留痕机制可靠地发现
                   * —— pi 的 `followUp()` 是入队即 resolve，`await` 它不承诺
                   * 送达，于是「投递成功」这个事实在这条链上根本不存在。
                   *
                   * 拉模式把这件事从根上绕开了：产出写进
                   * 成员会话 JSONL 的那一刻**交付就已经完成**，没有「送达」
                   * 这个环节，也就没有「送达失败」。领导用 `team_status`
                   * 看 `outputAvailable`、用 `team_read` 取正文。
                   *
                   * 因此这里只剩下「如实记账 + 刷界面」：
                   *   ① recordCompletion  —— 权威轮数回填
                   *   ② markStatus        —— idle（或收尾时 closed）
                   *   ③ emitTeamProgress  —— 界面立刻看到「跑完了」
                   * 不再有 await，不再有失败分支 —— 这条路已经无异步可失败。
                   */
                  onComplete: (name, _output, turns) => {
                    const wasClosing = teamRegistry.getTeam(leaderId)?.members.get(name)?.status === "closing";
                    teamRegistry.recordCompletion(leaderId, name, turns, wasClosing ? `已收尾（${turns} 轮）` : `已完成 ${turns} 轮`);
                    teamRegistry.markStatus(leaderId, name, wasClosing ? "closed" : "idle");
                    emitTeamProgress(leaderId);
                    if (wasClosing) {
                      const closingSession = teamRegistry.getTeam(leaderId)?.members.get(name)?.sessionId;
                      if (closingSession !== void 0) {
                        memberHandlesBySession.get(closingSession)?.dispose();
                        memberHandlesBySession.delete(closingSession);
                      }
                    }
                  },
                  onFailed: (name, message) => {
                    teamRegistry.markStatus(leaderId, name, "failed", message);
                    emitTeamProgress(leaderId);
                  },
                  // 事件转发（焦点导航）+ 计数回填（批 8）：转发以成员 sessionId
                  // 为信封键，renderer 按后台会话折叠；计数增量回注册表后推投影。
                  onEvent: (memberSessionId, event) => {
                    emitMemberEvent(memberSessionId, event);
                    let toolCalls = 0;
                    let tokens = 0;
                    let cost = 0;
                    if (event.type === "tool_started") toolCalls = 1;
                    if (event.type === "assistant_done" && event.message.usage !== void 0) {
                      tokens = event.message.usage.totalTokens;
                      cost = event.message.usage.cost;
                    }
                    const leader = teamRegistry.recordCountersBySession(memberSessionId, {
                      toolCalls,
                      tokens,
                      cost
                    });
                    if (leader !== void 0 && (toolCalls > 0 || tokens > 0)) emitTeamProgress(leader);
                  }
                }
              );
              memberHandlesBySession.set(handle.sessionId, handle);
              teamRegistry.recordMemberModel(leaderId, member.name, handle.modelKey);
              teamRegistry.markSpawned(leaderId, member.name, handle.sessionId);
              emitTeamProgress(leaderId);
              acks.push({ name: member.name, sessionId: handle.sessionId });
            }
          } catch (error) {
            void disbandTeamOf(leaderId);
            throw error;
          }
          return acks;
        },
        sendToMembers: async (to, text) => {
          const leaderId = adoptedSessionId(bucket);
          const team = teamRegistry.getTeam(leaderId);
          if (team === void 0) throw new Error("本会话没有团队，先 team_create 建团");
          const names = to.toLowerCase() === "@all" ? [...team.members.keys()] : [to.replace(/^@/, "")];
          const sessionIds = teamRegistry.resolveMemberSessions(leaderId, names);
          const composed = `[来自领导的消息]
${text}`;
          for (const [index, sessionId] of sessionIds.entries()) {
            const name = names[index];
            if (name === void 0) continue;
            await wakeMember(leaderId, name, sessionId, composed);
          }
          return names;
        },
        getTeamState: () => {
          const team = teamRegistry.getTeam(adoptedSessionId(bucket));
          if (team === void 0) return void 0;
          const now = Date.now();
          return {
            name: team.name,
            members: [...team.members.values()].map((member) => {
              const output = member.sessionId === void 0 ? void 0 : readMemberTranscriptView(member.sessionId).output;
              return {
                name: member.name,
                agentName: member.agentName,
                status: member.status,
                turns: member.turns,
                lastActivity: member.lastActivity,
                planStatus: member.planStatus,
                ...member.model === "" ? {} : { model: member.model },
                ...output === void 0 ? {} : { outputAvailable: true },
                // 等待时长（批次 ②）：只给「真的在等」的成员附上（waitingSince
                // 由注册表在 running 时起算、其余态清零，见 markStatus）。
                ...member.waitingSince > 0 ? { waitedMinutes: Math.floor((now - member.waitingSince) / 6e4) } : {}
              };
            })
          };
        },
        /*
         * 读成员产出（spec: add-team-pull-model 批次③）—— 拉模式的核心落点。
         *
         * 拉模式的做法：领导直接读子会话 JSONL 拿产出，
         * 而不是等成员把产出推过来。本方法同样**只读文件**：
         * 产出写进成员会话的那一刻就算交付，没有「投递」这个可能失败的环节。
         */
        readMemberOutput: async (to) => {
          const leaderId = adoptedSessionId(bucket);
          const team = teamRegistry.getTeam(leaderId);
          if (team === void 0) return void 0;
          const name = to.replace(/^@/, "");
          const member = teamRegistry.requireMember(leaderId, name);
          if (member.sessionId === void 0) {
            return { member: member.name, output: void 0, status: member.status };
          }
          const view = readMemberTranscriptView(member.sessionId);
          const status = view.status === "completed" ? "idle" : view.status === "killed" ? "interrupted" : view.status === "failed" ? "failed" : member.status;
          return { member: member.name, output: view.output, status };
        },
        /*
         * 计划裁决（spec: add-team-collaboration-parity 批次 ④）。
         *
         * 成员是 fire-and-forget 长会话 —— 交完一轮就 idle，
         * 不存在「阻塞等批」这个状态。于是「提交计划」= 它这一轮的产出（自动回投给领导），
         * 「批准/驳回」= 领导裁决后用 team_send 唤醒它继续。本方法把「记状态」与
         * 「叫醒它」合成一步：只改状态不发消息，成员会一直闲着等人推。
         */
        reviewPlan: async (member, decision, feedback) => {
          const leaderId = adoptedSessionId(bucket);
          const updated = teamRegistry.reviewPlan(leaderId, member, decision, feedback);
          emitTeamProgress(leaderId);
          if (decision === "awaiting") {
            return `已记录：成员「${member}」的计划待审（它当前 ${updated.status}）。决定后再用 approve / reject 调一次。`;
          }
          const memberSessions = teamRegistry.resolveMemberSessions(leaderId, [member]);
          const memberSessionId = memberSessions[0];
          if (memberSessionId === void 0) throw new Error(`成员「${member}」还没有会话，无法通知`);
          const text = decision === "approve" ? `[计划已批准]
${feedback === void 0 || feedback === "" ? "按你交的计划开工。" : feedback}

现在开始执行；完成后把结果整理成最终报告输出。` : `[计划需修改]
${feedback ?? ""}

请按上述意见调整计划后重新提交：这一轮**只交修订后的计划**，不要直接开工。`;
          await wakeMember(leaderId, member, memberSessionId, text);
          return decision === "approve" ? `已批准成员「${member}」的计划，并已通知它开工。` : `已驳回成员「${member}」的计划：反馈已发过去（状态 rejected，等它重交）。`;
        },
        /*
         * 委派模式（spec: add-team-collaboration-parity 批次 ③）。
         *
         * 状态在宿主体内（会话内策略，不写偏好、不进会话文件），daemon 只做转发。
         * 工具是在宿主构造期间注册的，这里**必须延迟取宿主**（bucket.hostPromise），
         * 不能在注册期固化一个还不存在的对象。
         */
        setDelegateMode: async (enabled) => {
          const host2 = await bucket.hostPromise;
          if (host2 === void 0) throw new Error("会话还没有建立对话，无法切换委派模式");
          host2.setDelegateMode(enabled);
          return enabled ? "已开启委派模式：从下一轮起你只能协调（团队 / 任务 / 提问 / 交付），不能再读写文件、执行命令或检索 —— 实际工作交给成员完成。" : "已关闭委派模式：工具面已恢复，你可以自己下场干活了。";
        },
        /*
         * 单成员优雅关闭（spec: add-team-collaboration-parity 批次 ②）。
         *
         * 默认路径是「投收尾请求」而不是 abort：abort 会把成员这一轮的工作全丢掉，
         * 而收尾请求让它把已完成的部分整理成报告交回来 —— 这正是「优雅」的全部意义。
         * force 只作兜底（成员卡住不收尾时）。交回报告后由 onComplete 翻 closed 并
         * dispose 宿主（见上方回调）。
         */
        shutdownMember: async (to, reason, force) => {
          const leaderId = adoptedSessionId(bucket);
          if (to.toLowerCase() === "@all") {
            throw new Error("team_shutdown 一次只关一个成员；整队中止请用 team_delete");
          }
          const member = teamRegistry.requireMember(leaderId, to);
          if (member.status === "closed") throw new Error(`成员「${to}」已经关闭了`);
          const memberSessionId = member.sessionId;
          if (memberSessionId === void 0) throw new Error(`成员「${to}」还在启动中，稍后再关`);
          const handle = memberHandlesBySession.get(memberSessionId);
          if (handle === void 0) {
            throw new Error(`成员「${to}」的会话句柄已失效（团队可能已被解散）`);
          }
          if (force) {
            await handle.abort().catch(() => {
            });
            handle.dispose();
            memberHandlesBySession.delete(memberSessionId);
            teamRegistry.markStatus(leaderId, to, "closed", "已强制关闭");
            emitTeamProgress(leaderId);
            return `成员「${to}」已强制关闭：当前轮已中止，未交回的产出丢弃。`;
          }
          teamRegistry.markStatus(leaderId, to, "closing", "已请求收尾");
          emitTeamProgress(leaderId);
          await handle.prompt(
            [
              "[主理人要求收尾]",
              reason ?? "本阶段工作到此为止。",
              "",
              "请立刻把已完成的部分整理成最终报告输出（不要再开始新的检索、不要大改），",
              "写清三件事：已完成什么、关键结论、还剩什么没做完。",
              "这份报告就是你本轮的最终产出，主理人会自己取回；交完这一轮本会话即结束。"
            ].join("\n")
          );
          return `已向成员「${to}」发出收尾请求：它交回最终报告后会自动关闭（期间状态为 closing）。`;
        },
        closeTeam: () => disbandTeamOf(adoptedSessionId(bucket))
      }),
      /*
       * 团队共享任务板（spec: add-team-collaboration-parity 批次 ①）：与团队四件套
       * 同一开关（没有团队就没有共享任务）。任务板按领导 sessionId 取用，
       * 会话 id 在建会话后才有真值 —— 三个 deps 都是**调用时**才解析
       * （`adoptedSessionId(bucket)`），不在注册期固化。
       */
      teamTaskExtensionFactory({
        isEnabled: isAgentTeamsEnabled,
        // 写操作后落盘（批次 ⑤）：任务板不经过 emitTeamProgress，得自己记账。
        createTasks: (inputs) => {
          const created = teamTaskBoard.createTasks(adoptedSessionId(bucket), inputs);
          persistTeam(adoptedSessionId(bucket));
          return created;
        },
        updateTask: (taskId, patch) => {
          const updated = teamTaskBoard.updateTask(adoptedSessionId(bucket), taskId, patch);
          persistTeam(adoptedSessionId(bucket));
          return updated;
        },
        listTasks: () => teamTaskBoard.listTasks(adoptedSessionId(bucket))
      })
    ]
  });
  mcpHandleByBucket.set(bucket, mcpClient);
  return host;
}

async function applyWorkspace(dir) {
  if (dir !== "") {
    const error = validateWorkspacePath(dir);
    if (error !== void 0) throw new Error(error);
    mkdirSync(dir, { recursive: true });
    await previewServers.ensure(dir);
    void warmUpSandbox({
      workspaceDir: dir,
      mode: activePermissions.sandbox,
      onDiagnostics: (diagnostics) => recordSandboxDiagnostics(diagnostics, dir)
    });
  }
  defaultWorkspaceDir = dir;
  if (currentBucket.hostPromise === void 0 && currentBucket.cwd !== dir) {
    currentBucket.cwd = dir;
    updateStateLocally(currentBucket, { cwd: dir, isTempTask: isTempCwd(dir) });
  }
  return dir;
}

function isEnoent(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

async function listSessions() {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  let infos;
  try {
    infos = await SessionManager.listAll(getSessionsDir());
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const byFile = /* @__PURE__ */ new Map();
  for (const bucket of bucketsById.values()) {
    if (bucket.sessionFilePath !== void 0) {
      byFile.set(resolve(bucket.sessionFilePath), bucket);
    }
  }
  const builtinTaskIds = new Set(
    automationStore.list().filter((task) => task.builtin === true).map((task) => task.id)
  );
  const visible = [];
  for (const info of infos) {
    if (isInternalSessionFile(info.path, builtinTaskIds)) continue;
    visible.push(info);
  }
  const onDiskPaths = new Set(visible.map((info) => resolve(info.path)));
  const pending = [];
  for (const bucket of bucketsById.values()) {
    const file = bucket.sessionFilePath;
    if (file === void 0 || onDiskPaths.has(resolve(file))) continue;
    if (isInternalSessionFile(file, builtinTaskIds)) continue;
    const firstUser = bucket.conversation.entries.find((entry) => entry.role === "user");
    const firstText = firstUser?.text ?? "";
    const titleText = firstText !== "" ? firstText : firstUser?.skillNames?.[0] ?? "";
    pending.push({
      id: bucket.sessionId,
      path: file,
      title: deriveSessionTitle(void 0, titleText),
      cwd: bucket.cwd,
      isTempTask: isTempCwd(bucket.cwd),
      // 没落盘就没有文件时间戳；用桶的最近使用时刻，排序上落在最新（它就是最新的）。
      createdAt: bucket.lastUsedAt,
      modifiedAt: bucket.lastUsedAt,
      messageCount: bucket.conversation.entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
      current: bucket === currentBucket,
      running: bucket.running,
      archived: false
    });
  }
  return [...visible.map((info) => {
    const bucket = byFile.get(resolve(info.path));
    return {
      id: info.id,
      path: info.path,
      title: deriveSessionTitle(info.name, info.firstMessage),
      name: info.name,
      cwd: info.cwd,
      // 任务区判定收在 isTempCwd 一处（自动目录 / 历史共享临时目录 / 旧 playground 占位；
      // 生效根本身归空间区，2026-09-15）。
      isTempTask: isTempCwd(info.cwd),
      // 分支来源：pi 的 listAll 已经从 header.parentSession 读出（SessionInfo.parentSessionPath），
      // 不必为此再读一遍文件首行 —— 列表是热路径（每次 run 边界都推）。
      parentSession: info.parentSessionPath,
      createdAt: info.created.getTime(),
      modifiedAt: info.modified.getTime(),
      messageCount: info.messageCount,
      current: bucket !== void 0 && bucket === currentBucket,
      running: bucket?.running ?? false,
      archived: sessionArchive.isArchived(resolve(info.path))
    };
  }), ...pending].sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function moveToTrash(filePath) {
  const trashDir = join(getConfigDir(), "trash");
  mkdirSync(trashDir, { recursive: true });
  const stamp = Date.now();
  let candidate = join(trashDir, `${stamp}-${basename(filePath)}`);
  for (let i = 1; existsSync(candidate); i++) {
    candidate = join(trashDir, `${stamp}-${i}-${basename(filePath)}`);
  }
  renameSync(filePath, candidate);
}

async function listWorkspaceGroups() {
  const names = readDisplayNames();
  const cwds = /* @__PURE__ */ new Set();
  for (const session of await listSessions()) {
    if (!session.isTempTask) cwds.add(session.cwd);
  }
  return [...cwds].map((cwd) => ({ cwd, displayName: names[cwd] }));
}

const resumeChainByFile = /* @__PURE__ */ new Map();

let resumeEpoch = 0;

async function resumeSession(path) {
  const resolved = resolve(path);
  const epoch = ++resumeEpoch;
  const previous = resumeChainByFile.get(resolved) ?? Promise.resolve();
  const attempt = previous.then(
    () => resumeSessionOnce(path, epoch),
    () => resumeSessionOnce(path, epoch)
  );
  const tracked = attempt.finally(() => {
    if (resumeChainByFile.get(resolved) === tracked) resumeChainByFile.delete(resolved);
  });
  resumeChainByFile.set(resolved, tracked);
  return attempt;
}

async function resumeSessionOnce(path, epoch) {
  const sessionsDir = getSessionsDir();
  const pathError = validateSessionFilePath(path, sessionsDir);
  if (pathError !== void 0) throw new Error(pathError);
  const existing = findBucketByFile(path);
  if (existing !== void 0) {
    if (epoch !== resumeEpoch) return;
    defaultWorkspaceDir = defaultCwdAfterResume(existing.cwd);
    setCurrentBucket(existing);
    await previewServers.ensure(existing.cwd);
    pushTaskListChanged();
    return;
  }
  const skippedLines = countSkippedLines(readFileSync(path, "utf8"));
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.open(path, sessionsDir);
  const header = manager.getHeader();
  if (header === null) throw new Error("会话文件缺少头部，无法恢复");
  let nextCwd;
  if (header.cwd === join(getConfigDir(), "playground")) {
    nextCwd = tempTasksDir();
    mkdirSync(nextCwd, { recursive: true });
  } else {
    const wsError = validateWorkspacePath(header.cwd);
    if (wsError !== void 0) throw new Error(`会话的工作目录不可用：${wsError}`);
    mkdirSync(header.cwd, { recursive: true });
    nextCwd = header.cwd;
  }
  const { bucket, contextUsage } = await mountSessionFile({
    manager,
    cwd: nextCwd,
    sceneId: currentBucket.conversation.state.sceneId,
    interactionId: currentBucket.conversation.state.interactionId,
    expertId: currentBucket.conversation.state.expertId,
    lastNonPlanInteraction: currentBucket.lastNonPlanInteraction,
    skippedLines
  });
  if (epoch !== resumeEpoch) return;
  defaultWorkspaceDir = defaultCwdAfterResume(nextCwd);
  setCurrentBucket(bucket);
  await previewServers.ensure(nextCwd);
  if (contextUsage !== void 0) {
    emitContextUsageDetail(bucket, contextUsage);
  }
  pushTaskListChanged();
}

async function remountHostInBucket(bucket, manager) {
  const attempt = createHost(bucket, manager);
  bucket.hostPromise = attempt;
  attempt.catch(() => {
    if (bucket.hostPromise === attempt) bucket.hostPromise = void 0;
  });
  const host = await attempt;
  adoptHost(bucket, host);
  return host;
}

async function buildConversationForBucket(bucket, manager, host) {
  const entries = buildConversationEntries(manager.buildContextEntries(), restoredToolLabel);
  const contextUsage = host.state.contextUsage;
  try {
    const state = bucket.conversation.state;
    const composed = await composeSystemPrompt({
      sceneId: state.sceneId,
      interactionId: state.interactionId,
      expertId: state.expertId,
      piContext: void 0
    });
    bucket.systemPromptTokens = composed.systemTokens;
    bucket.skillsTokens = composed.skillsTokens;
    bucket.systemPromptSegments = composed.segments;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eventLog.append({ kind: "ipc_error", channel: "session:compose-estimate", message });
  }
  const usageDetail = deriveContextUsageDetail({
    contextUsage,
    systemPromptTokens: bucket.systemPromptTokens,
    skillsTokens: bucket.skillsTokens,
    // 恢复时还没有任何请求，入模成分由宿主按已加载的消息现算（口径与运行期
    // 的上报通道共用 composeContextMessages）。
    composition: host.getContextComposition()
  });
  return { entries, usageDetail, contextUsage };
}

function applyRebuiltConversation(bucket, host, rebuilt) {
  bucket.conversation = {
    ...bucket.conversation,
    state: host.state,
    entries: rebuilt.entries,
    usageDetail: rebuilt.usageDetail,
    turn: void 0,
    cancelledTurns: [],
    artifacts: artifactsFromEntries(rebuilt.entries)
  };
}

async function mountSessionFile(options) {
  const bucket = createBucket({
    cwd: options.cwd,
    conversation: freshConversation(
      options.cwd,
      options.sceneId,
      options.interactionId,
      options.expertId
    ),
    spawnBudget: readPreferences().spawnBudget
  });
  bucket.lastNonPlanInteraction = options.lastNonPlanInteraction;
  bucket.worktree = worktreeInfoFromCwd(options.cwd);
  if (options.skippedLines > 0) bucket.skippedLines = options.skippedLines;
  const host = await remountHostInBucket(bucket, options.manager);
  const rebuilt = await buildConversationForBucket(bucket, options.manager, host);
  applyRebuiltConversation(bucket, host, rebuilt);
  return { bucket, contextUsage: rebuilt.contextUsage };
}

async function newTask(targetCwd = "") {
  if (targetCwd === "") defaultWorkspaceDir = "";
  else await applyWorkspace(targetCwd);
  if (currentBucket.hostPromise === void 0) {
    currentBucket.pendingWorktreeBranch = pendingWorktreeBranch;
    if (currentBucket.cwd !== targetCwd) {
      currentBucket.cwd = targetCwd;
      updateStateLocally(currentBucket, {
        cwd: targetCwd,
        isTempTask: isTempCwd(targetCwd)
      });
    }
    return;
  }
  const bucket = createBucket({
    cwd: targetCwd,
    conversation: freshConversation(
      targetCwd,
      currentBucket.conversation.state.sceneId,
      currentBucket.conversation.state.interactionId,
      // 专家绑定与两轴正交，同口径沿用（开新活不是改偏好）。
      currentBucket.conversation.state.expertId
    ),
    spawnBudget: readPreferences().spawnBudget
  });
  bucket.lastNonPlanInteraction = currentBucket.lastNonPlanInteraction;
  bucket.pendingWorktreeBranch = pendingWorktreeBranch;
  setCurrentBucket(bucket);
  emitSessionEvent(bucket, { type: "history_reset" });
  updateStateLocally(bucket, {});
}

async function extractBranchFile(motherPath, entryId) {
  const branched = await createBranchedSessionFile(motherPath, entryId);
  if (branched !== void 0 && existsSync(branched)) return branched;
  const fallback = await createSessionFileFromPrefix(motherPath, entryId);
  if (fallback === void 0) throw new Error("分叉点的条目不在会话文件里，无法抽枝");
  return fallback;
}

async function branchTitleFor(motherPath) {
  const sessions = await listSessions();
  const resolved = resolve(motherPath);
  const motherTitle = sessions.find((session) => resolve(session.path) === resolved)?.title ?? "";
  return buildBranchTitle(motherTitle, sessions.map((session) => session.title));
}

function ensureParentSession(branchPath, motherPath) {
  const header = readSessionHeader(branchPath);
  if (header === void 0) throw new Error("分支会话缺少头部，无法写入来源会话");
  if (header.parentSession === void 0) setSessionParentSession(branchPath, motherPath);
}

async function materializeBranch(motherPath, motherCwd, entryId) {
  const path = entryId === null ? await createEmptySessionFile(motherCwd, motherPath) : await extractBranchFile(motherPath, entryId);
  const title = await branchTitleFor(motherPath);
  await setSessionName(path, title);
  ensureParentSession(path, motherPath);
  return { path, title };
}

async function resolveBranchAnchor(bucket, userIndex) {
  const hostPromise = bucket.hostPromise;
  if (hostPromise === void 0) return { kind: "no-file" };
  const host = await hostPromise;
  const anchor = resolveAnchorForIndex(host.listForkableUserMessages(), userIndex);
  if (anchor === void 0) return { kind: "no-such-entry" };
  const entries = host.listEntryRefs();
  const ref = entries.find((entry) => entry.id === anchor.entryId);
  if (ref === void 0) return { kind: "no-such-entry" };
  return { kind: "ok", host, anchorEntryId: anchor.entryId, parentId: ref.parentId, entries };
}

async function restartSession(path, userIndex, options) {
  const target = resolve(path);
  const bucket = findBucketByFile(target);
  if (bucket === void 0 || !existsSync(target)) return branchFail("no-file");
  if (bucket.running) return branchFail("busy");
  return enqueue(bucket, async () => {
    if (bucket.running) return branchFail("busy");
    const anchor = await resolveBranchAnchor(bucket, userIndex);
    if (anchor.kind !== "ok") return branchFail(anchor.kind);
    const leafId = anchor.host.currentLeafId();
    let branch;
    try {
      if (options?.saveBranch !== false && leafId !== null && decideExtract(anchor.entries, anchor.anchorEntryId)) {
        branch = await materializeBranch(target, bucket.cwd, leafId);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      eventLog.append({ kind: "ipc_error", channel: INVOKE.sessionRestart, message: detail });
      return branchFail("write-failed");
    }
    anchor.host.dispose();
    try {
      let truncated = true;
      if (anchor.parentId === null) truncateSessionToStart(target);
      else truncated = truncateSessionTo(target, anchor.parentId);
      if (!truncated) {
        bucketsById.delete(bucket.sessionId);
        bucket.hostPromise = void 0;
        return branchFail("no-such-entry");
      }
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const manager = SessionManager.open(target, getSessionsDir());
      const host = await remountHostInBucket(bucket, manager);
      const rebuilt = await buildConversationForBucket(bucket, manager, host);
      emitSessionEvent(bucket, { type: "history_reset" });
      applyRebuiltConversation(bucket, host, rebuilt);
      if (rebuilt.contextUsage !== void 0) emitContextUsageDetail(bucket, rebuilt.contextUsage);
      pushTaskListChanged();
      return branchOk(branch);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      eventLog.append({ kind: "ipc_error", channel: INVOKE.sessionRestart, message: detail });
      bucketsById.delete(bucket.sessionId);
      bucket.hostPromise = void 0;
      return branchFail("write-failed", `已回退到这一轮之前，但重新打开会话失败：${detail}`);
    }
  });
}

async function forkSession(path, userIndex, options) {
  const target = resolve(path);
  const mother = findBucketByFile(target);
  if (mother === void 0 || !existsSync(target)) return branchFail("no-file");
  if (mother.running) return branchFail("busy");
  return enqueue(mother, async () => {
    if (mother.running) return branchFail("busy");
    const anchor = await resolveBranchAnchor(mother, userIndex);
    if (anchor.kind !== "ok") return branchFail(anchor.kind);
    try {
      const leaf = options?.includeTurn === true ? endOfTurn(anchor.entries, anchor.anchorEntryId) : anchor.parentId;
      const branch = await materializeBranch(target, mother.cwd, leaf);
      const axes = mother.conversation.state;
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      const branchManager = SessionManager.open(branch.path, getSessionsDir());
      const { bucket } = await mountSessionFile({
        manager: branchManager,
        cwd: mother.cwd,
        sceneId: axes.sceneId,
        interactionId: axes.interactionId,
        expertId: axes.expertId,
        lastNonPlanInteraction: mother.lastNonPlanInteraction,
        skippedLines: 0
      });
      defaultWorkspaceDir = defaultCwdAfterResume(bucket.cwd);
      setCurrentBucket(bucket);
      await previewServers.ensure(bucket.cwd);
      pushTaskListChanged();
      return branchOk(branch);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      eventLog.append({ kind: "ipc_error", channel: INVOKE.sessionBranch, message: detail });
      return branchFail("write-failed", `创建分支会话失败，母会话未改动：${detail}`);
    }
  });
}

const runtimeInstalls = /* @__PURE__ */ new Map();

const handlers = {
  // 返回折叠后的真实历史。ConversationView 与 SessionSnapshot 结构一致。
  // sessionId 缺省 = 当前会话；指定 id 时按注册表查桶 —— 未注册
  //（被 LRU 回收 / 从没打开）响亮报错，renderer 用自己的事件缓存兜底。
  [INVOKE.snapshot]: async ([sessionId]) => {
    if (sessionId === void 0) return currentBucket.conversation;
    const bucket = bucketsById.get(sessionId);
    if (bucket === void 0) {
      throw new Error(`会话未在 daemon 打开（可能已被空闲回收）：${sessionId}`);
    }
    return bucket.conversation;
  },
  /* ── 设置：已可用 ─────────────────────────────────────────────── */
  [INVOKE.settingsSnapshot]: async () => (await getCatalog()).snapshot(activeModelKey),
  /* ── 技能 ─────────────────────────────────────────────────────── */
  // 技能页口径 = 全局技能池（不传专家技能目录）—— 专家私有技能只在会话组装
  //（composeSystemPrompt 按绑定专家追加）时进入提示词，不进技能页清单。
  // 组装逻辑收在 buildSkillsSnapshot 一处（与 setSkillEnabled 共用，见其注释）。
  [INVOKE.skillsSnapshot]: async () => buildSkillsSnapshot(),
  /**
   * 开关一个技能（技能页卡片上的启停）。返回**新的完整快照**：切换后列表、
   * 已启用数与 token 数字一次到位，渲染层不必再拉一次（spec: 数字随开关即时更新）。
   *
   * 写入走「读改写」（`writePreferences` 是整存覆盖，直接写会清掉模型选择等其它键，
   * 同 setMemoryEnabled 的写法）。
   */
  [INVOKE.setSkillEnabled]: async ([name, enabled]) => {
    if (typeof name !== "string" || !SKILL_NAME_PATTERN.test(name)) {
      throw new Error(`技能名不合法：${String(name)}`);
    }
    const preferences = readPreferences();
    const overrides = { ...preferences.skillOverrides };
    if (enabled === true) delete overrides[name];
    else overrides[name] = "off";
    const { skillOverrides: _dropped, ...rest } = preferences;
    writePreferences(
      Object.keys(overrides).length === 0 ? rest : { ...rest, skillOverrides: overrides }
    );
    return buildSkillsSnapshot();
  },
  [INVOKE.importSkill]: async ([sourcePath]) => importSkill(sourcePath),
  /* ── MCP 连接器 ─────────────────────────────────────────────── */
  [INVOKE.mcpConfigGet]: async () => {
    const configJson = readMcpConfigSource(mcpEditCwd());
    const handle = mcpHandleByBucket.get(currentBucket);
    if (handle !== void 0) {
      return { servers: handle.getServerStates(), configJson };
    }
    try {
      const config = readSessionMcpConfig(currentBucket.cwd);
      return {
        servers: Object.entries(config.servers).map(([name, serverConfig]) => ({
          name,
          status: serverConfig.disabled === true ? "disabled" : "connecting",
          toolCount: 0
        })),
        configJson
      };
    } catch (error) {
      if (error instanceof McpConfigError) return { servers: [], configJson };
      throw error;
    }
  },
  [INVOKE.mcpConfigSet]: async ([configJson]) => {
    writeMcpConfig(configJson, mcpEditCwd());
    await Promise.all(liveMcpHandles().map((handle) => handle.reload()));
  },
  [INVOKE.mcpServerToggle]: async ([serverName, enabled]) => {
    toggleMcpServer(serverName, enabled, mcpEditCwd());
    await Promise.all(liveMcpHandles().map((handle) => handle.reload()));
  },
  [INVOKE.setApiKey]: async ([providerId, apiKey]) => {
    await (await getCatalog()).setApiKey(providerId, apiKey);
  },
  [INVOKE.removeApiKey]: async ([providerId]) => {
    await (await getCatalog()).removeApiKey(providerId);
  },
  [INVOKE.saveCustomProvider]: async ([input, apiKey]) => {
    await (await getCatalog()).saveCustomProvider(
      input,
      apiKey
    );
  },
  [INVOKE.deleteCustomProvider]: async ([providerId]) => {
    await (await getCatalog()).deleteCustomProvider(providerId);
  },
  [INVOKE.readCustomProvider]: async ([providerId]) => (await getCatalog()).readCustomProvider(providerId),
  [INVOKE.addProviderModel]: async ([providerId, model]) => {
    await (await getCatalog()).addProviderModel(providerId, model);
  },
  [INVOKE.refreshCatalog]: async () => {
    await (await getCatalog()).refreshCatalog();
  },
  /* ── 诊断 ─────────────────────────────────────────────────────── */
  [INVOKE.statsSnapshot]: async () => observability.snapshot({
    entries: currentBucket.conversation.entries,
    systemPromptTokens: currentBucket.systemPromptTokens,
    contextUsage: currentBucket.conversation.state.contextUsage,
    logDir: eventLog.dir
  }),
  /*
   * 跨会话使用统计（统计页）。读会话文件全历史 —— 与 conversation_search 同例：
   * daemon 读自己的数据，不经权限门。坏文件跳过并记 event-log，不让统计页整页报错。
   * 每次 assistant_done 之类的事件都会触发一次重拉，重读靠 usage-stats 内部的
   * mtime 缓存挡住（只重解析改动过的会话文件）。
   */
  [INVOKE.usageStats]: async () => readUsageStats(getSessionsDir(), (message) => {
    eventLog.append({ kind: "usage_stats_error", message });
  }),
  /*
   * 台账条目级读取（诊断页会话时间线）。sessionId 缺省 = 当前活动会话；
   * pristine 桶（sessionId 还是 ""，宿主未建）或活动会话没记过台账时
   * 退最新台账文件 —— 诊断页打开总该有点什么可看。
   * renderer 给的 sessionId 经 ledgerFileName 安全化（路径穿越在写侧
   * 已断，读侧同一条防线不依赖对端自律）。
   */
  [INVOKE.runLedger]: async ([sessionId]) => {
    const sessions = listLedgerSessionIds();
    const requested = typeof sessionId === "string" && sessionId !== "" ? sessionId : void 0;
    const target = requested ?? (currentBucket.sessionId || sessions[0]);
    if (target === void 0 || target === "") {
      return { sessions, sessionId: void 0, entries: [] };
    }
    const all = readLedgerEntries(
      join(runLedgerDir, ledgerFileName(target)),
      (message) => {
        eventLog.append({ kind: "run_ledger_error", sessionId: target, message });
      }
    );
    return {
      sessions,
      sessionId: target,
      entries: all.length > RUN_LEDGER_IPC_LIMIT ? all.slice(-RUN_LEDGER_IPC_LIMIT) : all
    };
  },
  // docx venv 四态：只探测不安装（诊断页不该有环境副作用，
  // 见 shared/ipc.ts 该通道注释）。探测的落点由托管根解析决定（Python 已迁入托管运行时）。
  [INVOKE.docxEnvStatus]: async () => inspectPythonRuntime(pythonRuntimeOptions(), defaultSpawn),
  /* ── 托管运行时（设置页「内置运行时」一级分区，spec: add-managed-runtimes 阶段 3）── */
  /*
   * 清单与开关都走 core/runtime-inventory.ts 这一个模块：状态口径与模型侧
   * `python_env` 段同一份（不 spawn，只读磁盘事实 + 落盘失败日志），开关写的是
   * preferences.runtimes 这一处 —— 于是「设置页看到被禁用」与「模型看到被禁用」
   * 不可能分叉。写开关后立刻重新采集：返回的清单即生效后的状态（开关无需重启）。
   */
  [INVOKE.runtimesSnapshot]: async () => collectRuntimeInventory(),
  [INVOKE.setRuntimeMaster]: async ([enabled]) => {
    writeRuntimeMaster(enabled);
    if (enabled === false) {
      writeAuditRecord({
        category: "runtime",
        outcome: "disabled",
        detail: "用户关闭了「内置运行时」总开关：全部托管运行时都不再注入"
      });
    }
    return collectRuntimeInventory();
  },
  [INVOKE.setRuntimeEnabled]: async ([id, enabled]) => {
    writeRuntimeEnabled(id, enabled);
    if (enabled === false) {
      writeAuditRecord({
        category: "runtime",
        outcome: "disabled",
        detail: clipAuditDetail(`用户禁用了运行时「${String(id)}」：路径与托管目录不再注入`)
      });
    }
    return collectRuntimeInventory();
  },
  // 诊断按需 spawn（深度四态：版本不符 / 缺依赖只有真跑一次才知道），
  // 与清单的浅判据分工见 core/runtime-inventory.ts 文件头。
  [INVOKE.runtimeDiagnostics]: async ([id]) => collectRuntimeDiagnosticsText(id, defaultSpawn),
  /*
   * 按需安装（阶段 7：三运行时纯按需，没有任何静默自动下载）。安装要联网下载
   * 几十到几百 MB，所以进度走 PUSH（用户切走设置页再切回来仍看得到），
   * 取消走 runtimeInstalls 里那个 AbortSignal。失败**响亮 reject**：界面据此给
   * 可执行原因，并同时落一条审计（与重置失败同口径）。
   */
  [INVOKE.runtimeInstall]: async ([id]) => {
    const runtimeId = id;
    if (runtimeInstalls.has(runtimeId)) throw new Error(`「${runtimeId}」的安装已在进行中`);
    const controller = new AbortController();
    runtimeInstalls.set(runtimeId, controller);
    const pushProgress = (progress) => {
      post({ kind: "push", channel: PUSH.runtimeInstallProgress, payload: progress });
    };
    pushProgress({ id: runtimeId, kind: "running", message: "正在下载并安装…需联网。" });
    try {
      const inventory = await installManagedRuntime(runtimeId, defaultSpawn, controller.signal, {}, pushProgress);
      pushProgress({ id: runtimeId, kind: "done", message: "安装完成。" });
      return inventory;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) {
        pushProgress({ id: runtimeId, kind: "cancelled", message });
        throw error;
      }
      pushProgress({ id: runtimeId, kind: "failed", message });
      writeAuditRecord({
        category: "runtime",
        outcome: "failed",
        detail: clipAuditDetail(`安装运行时「${runtimeId}」失败：${message}`)
      });
      throw error;
    } finally {
      runtimeInstalls.delete(runtimeId);
    }
  },
  /** 取消进行中的安装（在**下一次推进前**生效，见 core/runtime-inventory.ts 的取消语义）。 */
  [INVOKE.runtimeCancelInstall]: async ([id]) => {
    runtimeInstalls.get(id)?.abort();
  },
  // 重置走内核的幂等链路（清残留 → 安装 → 校验 → 进位 → 发布）。失败 reject，
  // 原因带相位与底层错误 —— 用户主动点的修复不许静默失败。
  [INVOKE.runtimeReset]: async ([id]) => {
    try {
      return await resetManagedRuntime(id, defaultSpawn);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeAuditRecord({
        category: "runtime",
        outcome: "failed",
        detail: clipAuditDetail(`重置运行时「${String(id)}」失败：${message}`)
      });
      throw error;
    }
  },
  /* ── 审计中心（spec: add-managed-runtimes 阶段 4） ─────────────── */
  // 面板拉取。/ 清空后的回读 / 导出全文三者共用下面的 auditSnapshot ——
  // 「导出与面板同源」靠这条共用，而不是靠约定。
  [INVOKE.auditList]: async ([category]) => auditSnapshot(category),
  [INVOKE.auditClear]: async () => {
    clearAuditRecords();
    return auditSnapshot(void 0);
  },
  [INVOKE.auditExport]: async () => exportAuditRecords(),
  /* ── 定时任务 ─────────────────────────────────────────────────── */
  [INVOKE.automationList]: async () => automationStore.list(),
  [INVOKE.automationSave]: async ([input]) => saveAutomation(input),
  [INVOKE.automationDelete]: async ([id]) => {
    const taskId = id;
    if (automationScheduler.isBusy(taskId)) {
      throw new Error("任务正在运行，请等运行结束后再删除");
    }
    automationStore.remove(taskId);
    pushAutomationChanged();
  },
  [INVOKE.automationToggle]: async ([id]) => toggleAutomation(id),
  [INVOKE.automationRunNow]: async ([id]) => automationScheduler.runNow(id),
  /* ── 会话 ─────────────────────────────────────────────────────── */
  [INVOKE.prompt]: async ([request]) => {
    const { text, whileStreaming, images } = request;
    const command = parseBuiltinCommand(text.trim());
    if (command !== void 0) {
      if (command.name === "new") {
        await newTask();
        return;
      }
      if (command.name === "plan") {
        const current = currentBucket.conversation.state.interactionId;
        await applyInteraction(
          currentBucket,
          current === "plan" ? currentBucket.lastNonPlanInteraction : "plan"
        );
        return;
      }
      const hostPromise = currentBucket.hostPromise;
      if (hostPromise === void 0)
        throw new Error("还没有会话，没有可压缩的上下文");
      await enqueue(currentBucket, async () => {
        if (currentBucket.running)
          throw new Error("任务进行中，请先停止当前任务再压缩上下文");
        await (await hostPromise).compact(command.args === "" ? void 0 : command.args);
      });
      return;
    }
    const bucket = currentBucket;
    bucket.lastUsedAt = Date.now();
    const promptText = await expandSkillInvocation(text, bucket.conversation.state.expertId);
    if (bucket.running) {
      const host = await getHost(bucket);
      await host.prompt(promptText, whileStreaming ?? "followUp", images);
      return;
    }
    let settleAccepted;
    let failAccepted;
    const accepted = new Promise((resolve2, reject) => {
      settleAccepted = resolve2;
      failAccepted = reject;
    });
    let acceptedSettled = false;
    void accepted.then(
      () => {
        acceptedSettled = true;
      },
      () => {
        acceptedSettled = true;
      }
    );
    const onRunStarted = () => settleAccepted();
    let waiters = runStartWaiters.get(bucket);
    if (waiters === void 0) {
      waiters = /* @__PURE__ */ new Set();
      runStartWaiters.set(bucket, waiters);
    }
    waiters.add(onRunStarted);
    try {
      void enqueue(bucket, async () => {
        let host;
        try {
          host = await getHost(bucket);
        } catch (error) {
          if (!acceptedSettled) failAccepted(error);
          throw error;
        }
        try {
          await host.prompt(promptText, whileStreaming, images);
          if (!acceptedSettled) settleAccepted();
        } catch (error) {
          if (!acceptedSettled) failAccepted(error);
          throw error;
        } finally {
          waiters?.delete(onRunStarted);
        }
      }).catch(() => {
      });
    } catch {
    }
    await accepted;
  },
  /**
   * 中断。**不走 getHost** —— 没有会话时中断本就是空操作，
   * 为了中断而去创建一个会话是荒谬的（还会因为没配模型而报错）。
   *
   * 不进互斥链：abort 是信号不是写操作，排在 prompt（整段 run）后面
   * 会让停止键失效 —— run 不停、abort 永远轮不到执行。
   * pi 的 abort 本就设计为 run 进行中从外部调用。
   */
  [INVOKE.abort]: async () => {
    const hostPromise = currentBucket.hostPromise;
    if (hostPromise === void 0) return;
    await (await hostPromise).abort();
  },
  // 最近一次注入的 hidden context 全文（任务诊断面板 ② 的「实际内容」块）。
  // 宿主未建（还没发过消息）直接 undefined，不为此建宿主 —— 建宿主会产生
  // 目录与模型校验副作用，展示口不该有这些代价。
  //
  // 两份快照各自是一条落盘消息（环境块 / 时间块，spec:
  // add-supersede-note-and-time-split）；展示口按注入顺序拼成一屏（IPC 契约不变，
  // 面板不需要为此分两块），取不到哪一份就少哪一份、都不取到才 undefined。
  [INVOKE.hiddenContext]: async () => {
    const hostPromise = currentBucket.hostPromise;
    if (hostPromise === void 0) return void 0;
    const host = await hostPromise;
    const blocks = [host.peekHiddenContext(), host.peekRunTime()].filter(
      (block) => block !== void 0 && block !== ""
    );
    return blocks.length === 0 ? void 0 : blocks.join("\n");
  },
  /**
   * 重排 steer / followUp 等待队列（排队 chips 的删除/编辑底层动作）。
   * 不进互斥链 —— 与 prompt 的 run 中旁路、abort 同一理由：它操作的是
   * 「正在跑的那一轮」的队列，排在整段 run 后面就永远轮不到。
   * run 已结束时 clearQueue 即完成、重入队挂到下一轮（消息不丢，chips 仍在）。
   */
  [INVOKE.queueRewrite]: async ([queued]) => {
    const hostPromise = currentBucket.hostPromise;
    if (hostPromise === void 0) return;
    const { steering, followUp } = queued;
    await (await hostPromise).rewriteQueue(steering, followUp);
  },
  /**
   * 新建任务：旧会话后台保活（宿主留注册表，run 照跑），开一个全新
   * pristine 桶为当前会话（见 newTask）。
   */
  [INVOKE.newTask]: async ([cwd]) => newTask(cwd),
  /* ── 历史会话 ─────────────────────────────────────────────────── */
  [INVOKE.sessionList]: async () => listSessions(),
  // 归档 / 取消归档（L28）：只动 archive.json 索引，会话文件与宿主不动 ——
  // 归档 ≠ 下线，正在聊的会话归档后照常可用。列表变化推
  // taskListChanged 让侧栏即时收起。
  [INVOKE.sessionArchive]: async ([path, archived]) => {
    sessionArchive.setArchived(resolve(path), archived, Date.now());
    pushTaskListChanged();
  },
  [INVOKE.sessionResume]: async ([path]) => resumeSession(path),
  [INVOKE.sessionRename]: async ([path, name]) => {
    const target = path;
    const trimmed = name.trim();
    if (trimmed === "") throw new Error("名称不能为空");
    const bucket = findBucketByFile(target);
    if (bucket !== void 0) {
      const hostPromise = bucket.hostPromise;
      if (hostPromise !== void 0) {
        (await hostPromise).renameSession(trimmed);
        pushTaskListChanged();
        return;
      }
    }
    const pathError = validateSessionFilePath(target, getSessionsDir());
    if (pathError !== void 0) throw new Error(pathError);
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    SessionManager.open(target, getSessionsDir()).appendSessionInfo(trimmed);
    pushTaskListChanged();
  },
  // 会话分支（spec: add-session-branching）：两条流程都排进该会话的互斥链，
  // 与 prompt / rename / delete 串行（见 restartSession /
  // forkSession 的顺序注释）。拒绝走返回值而不是 reject（reason 是界面文案的
  // 分支依据，契约见 shared/ipc.ts 的 SessionBranchResult）。
  [INVOKE.sessionRestart]: async ([path, userIndex, options]) => restartSession(path, userIndex, options),
  [INVOKE.sessionBranch]: async ([path, userIndex, options]) => forkSession(path, userIndex, options),
  [INVOKE.sessionDelete]: async ([path]) => {
    const target = path;
    const bucket = findBucketByFile(target);
    if (bucket !== void 0) {
      if (bucket === currentBucket)
        throw new Error("这是当前任务，请先切换到其他任务再删除");
      if (bucket.running)
        throw new Error("该任务正在运行，请先在对话中停止它再删除");
      if (bucket.pendingApprovals > 0)
        throw new Error("该任务有等待回答的审批或提问，请先切换到它处理完再删除");
      if (bucket.pendingOps > 0)
        throw new Error("该任务还有正在执行的操作，请稍后再删除");
      bucketsById.delete(bucket.sessionId);
      teamMailbox.clear(bucket.sessionId);
      void disbandTeamOf(bucket.sessionId);
      await backgroundJobs.killAllForSession(bucket.sessionId);
      const hostPromise = bucket.hostPromise;
      if (hostPromise !== void 0) (await hostPromise).dispose();
    }
    const pathError = validateSessionFilePath(target, getSessionsDir());
    if (pathError !== void 0) throw new Error(pathError);
    moveToTrash(target);
    pushTaskListChanged();
  },
  [INVOKE.sessionExport]: async ([path]) => {
    const target = path;
    const pathError = validateSessionFilePath(target, getSessionsDir());
    if (pathError !== void 0) throw new Error(pathError);
    let bucket = findBucketByFile(target);
    if (bucket === void 0) {
      await resumeSession(target);
      bucket = findBucketByFile(target);
    }
    if (bucket === void 0 || bucket.hostPromise === void 0) {
      throw new Error("还没有会话，没有可导出的内容");
    }
    const host = await bucket.hostPromise;
    const exportsDir = join(getEffectiveWorkspaceRoot(), "exports");
    mkdirSync(exportsDir, { recursive: true });
    const resolvedTarget = resolve(target);
    const summary = (await listSessions()).find((s) => resolve(s.path) === resolvedTarget);
    const title = summary?.title ?? bucket.sessionId;
    const outputPath = buildExportPath(exportsDir, title, /* @__PURE__ */ new Date());
    await host.exportHtml(outputPath);
    return { outputPath };
  },
  /*
   * worktree（对齐清单 C22 / L27）。两者都不碰既有会话：
   * 列分支是只读查询；设基准分支只改「下一个新任务在哪个分支上建副本」，
   * 副本一经创建就与会话终身绑定，换分支意味着换工作副本（那要重建会话，
   * 属另一件事）。当前会话还没建宿主时顺带写进桶，好让 createHost 读到。
   */
  [INVOKE.worktreeBranches]: async ([cwd]) => getBranchList(cwd),
  [INVOKE.setWorktreeBranch]: async ([branch]) => {
    if (branch === void 0 || branch === null) {
      pendingWorktreeBranch = void 0;
    } else if (typeof branch === "string") {
      const trimmed = branch.trim();
      pendingWorktreeBranch = trimmed === "" ? void 0 : requireBranchName(trimmed);
    } else {
      throw new Error("基准分支必须是字符串或 undefined");
    }
    if (currentBucket.hostPromise === void 0) {
      currentBucket.pendingWorktreeBranch = pendingWorktreeBranch;
    }
  },
  [INVOKE.setScene]: async ([sceneId]) => {
    const id = requireReady(SCENES, sceneId, "场景");
    if (currentBucket.hostPromise === void 0) {
      updateStateLocally(currentBucket, { sceneId: id });
      return;
    }
    (await currentBucket.hostPromise).setScene(id);
  },
  [INVOKE.setInteraction]: async ([interactionId]) => applyInteraction(currentBucket, interactionId),
  /**
   * 选择 / 清除专家。专家是与交互模式**正交**的会话绑定：本通道只读写
   * expertId，绝不改 interactionId（目标 = 当前桶，A 会话的专家不影响 B 会话）。
   */
  [INVOKE.setExpert]: async ([expertId]) => {
    const id = expertId;
    if (id !== void 0) requireExpertPersona(loadExpertsNow(), id);
    const bucket = currentBucket;
    const hostPromise = bucket.hostPromise;
    if (hostPromise === void 0) {
      updateStateLocally(bucket, { expertId: id });
      return;
    }
    (await hostPromise).setExpert(id);
  },
  /**
   * 专家列表：renderer「专家 ▸」子菜单、对话头部与起手 chips 的展示数据源。
   * 每次现载不缓存（与 setExpert 的校验同一条读路径，用户级覆盖即时生效）；
   * 只映射展示字段，人格正文不下发 —— compose 时 daemon 自取。
   */
  [INVOKE.listExperts]: async () => loadExpertsNow().map((e) => ({
    name: e.name,
    displayName: e.displayName,
    profession: e.profession,
    description: e.description,
    displayDescription: e.displayDescription,
    quickPrompts: e.quickPrompts,
    tags: e.tags,
    source: e.source,
    expertType: e.expertType
  })),
  /**
   * 团队任务板投影（spec: add-team-ux-parity 批次 ③）：Ctrl+T 面板的数据源。
   *
   * **只读** —— 任务板由模型经 `team_task_*` 工具改，UI 不给写通道
   * （人改一格、模型仍按旧认知调度，比不给改更糟；见 spec 否决方案）。
   * 无团队 / 会话还没建 → 空数组（面板显示空态，不是错误）。
   */
  [INVOKE.getTeamTasks]: async () => {
    const sessionId = currentBucket.sessionId;
    if (sessionId === "") return [];
    return teamTaskBoard.listTasks(sessionId).map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.detail,
      ...task.owner === void 0 ? {} : { owner: task.owner },
      status: task.status,
      blockedBy: [...task.blockedBy],
      result: task.result
    }));
  },
  /**
   * 切换模型。不依赖会话 —— 设置界面在会话建立前就要能用。
   *
   * 全局设置（spec A）：写入 activeModelKey 后，**之后新建的宿主**都用它；
   * 当前会话同步切过去（避免「设置里显示 A、实际还在用 B」）；
   * 后台保活的宿主保留各自模型 —— 进行中的 run 不换引擎。
   */
  [INVOKE.setModel]: async ([modelKey]) => {
    const key = modelKey;
    const catalog = await getCatalog();
    if (!catalog.isUsable(key)) {
      throw new Error("该模型不可用：请先为其服务商配置 API Key");
    }
    activeModelKey = key;
    writePreferences({ ...readPreferences(), activeModelKey: key });
    if (currentBucket.hostPromise !== void 0)
      await (await currentBucket.hostPromise).setModel(key);
    else updateStateLocally(currentBucket, { modelId: key });
  },
  /**
   * 切换当前会话的推理强度档位。目标 = 当前桶：多任务并发下档位按桶独立，
   * A 会话的切换不影响 B 会话（spec：会话内推理强度切换）。
   * 逐会话持久化与 resume 还原全由 pi 负责（thinking_level_change 条目），
   * 这里不做第二份持久化。
   */
  [INVOKE.setThinkingLevel]: async ([level]) => {
    if (!isThinkingLevel(level)) {
      throw new Error(`未知的推理强度档位：${String(level)}`);
    }
    const bucket = currentBucket;
    const hostPromise = bucket.hostPromise;
    if (hostPromise === void 0) {
      updateStateLocally(bucket, { thinkingLevel: level });
      return;
    }
    (await hostPromise).setThinkingLevel(level);
  },
  /* ── 联网搜索配置 ───────────────────────────────────────────────── */
  [INVOKE.getWebSearchConfig]: async () => {
    const webSearch = readPreferences().webSearch;
    if (webSearch === void 0) return { providerId: void 0, hasKey: false };
    const providerId = isWebSearchProviderId(webSearch.providerId) ? webSearch.providerId : void 0;
    return { providerId, hasKey: webSearch.apiKey !== "" };
  },
  [INVOKE.setWebSearchConfig]: async ([input]) => {
    const config = input;
    if (!isWebSearchProviderId(config.providerId)) {
      throw new Error(`未知的搜索服务商：${config.providerId}`);
    }
    if (config.apiKey.trim() === "") {
      throw new Error("API Key 不能为空");
    }
    writePreferences({
      ...readPreferences(),
      webSearch: { providerId: config.providerId, apiKey: config.apiKey.trim() }
    });
  },
  [INVOKE.clearWebSearchConfig]: async () => {
    const { webSearch: _dropped, ...rest } = readPreferences();
    writePreferences(rest);
  },
  [INVOKE.testWebSearch]: async () => {
    const webSearch = readPreferences().webSearch;
    if (webSearch === void 0 || !isWebSearchProviderId(webSearch.providerId) || webSearch.apiKey.trim() === "") {
      return { ok: false, message: "尚未配置搜索服务商与 API Key，请先保存配置" };
    }
    try {
      const results = await withHardTimeout(
        searchWeb(
          { providerId: webSearch.providerId, apiKey: webSearch.apiKey },
          "ZeroWork 联网测试",
          { limit: 2 }
        ),
        15e3
      );
      return {
        ok: true,
        message: `连接成功，返回 ${results.length} 条结果`,
        count: results.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint = message.includes("超时") ? "（Tavily 等海外服务在国内网络下常无法连接，建议换「博查」）" : "";
      return { ok: false, message: `${message}${hint}` };
    }
  },
  /*
   * 模型连通性测试（设置-模型页卡片上的「测试」按钮）。
   *
   * 不 throw、用返回值表达失败：测试的意义就是把失败原因带回来展示，
   * throw 会被 IPC 层裹成通用错误文案，丢掉 probeModel 精心归类的单行原因。
   * 凭据获取的三条路径：auth.json（我们自己写的）→ 环境变量（label 是变量名）→
   * 订阅/命令注入拿不到明文，明确报不支持；fallback（无凭据，本地服务）直接
   * 发无鉴权探测，结果由服务端如实回答。
   */
  [INVOKE.testModel]: async ([modelKey]) => {
    const key = modelKey;
    const parsed = parseModelKey(key);
    const catalog = await getCatalog();
    const model = parsed === void 0 ? void 0 : catalog.resolveModel(key);
    if (parsed === void 0 || model === void 0) {
      return { ok: false, error: "目录里找不到该模型，请刷新模型目录后重试" };
    }
    const status = catalog.modelRuntime.getProviderAuthStatus(parsed.providerId);
    let apiKey = readApiKey(getAuthPath(), parsed.providerId);
    if (apiKey === void 0 && status.source === "environment" && status.label !== void 0) {
      const fromEnv = process.env[status.label];
      if (fromEnv !== void 0 && fromEnv !== "") apiKey = fromEnv;
    }
    if (apiKey === void 0 && status.configured && status.source !== "fallback") {
      return { ok: false, error: "该服务商凭据来自订阅登录或命令注入，拿不到明文，暂不支持测试" };
    }
    try {
      return await withHardTimeout(
        probeModel({
          api: model.api,
          baseUrl: model.baseUrl,
          modelId: model.id,
          apiKey,
          extraHeaders: model.headers,
          // 认证头形态与真实会话同源（models.json 的 authHeader 标记）。
          authHeader: catalog.readCustomProvider(parsed.providerId)?.authHeader === true
        }),
        15e3
      );
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  /*
   * 表单内测试（自定义服务商表单的「测试」按钮）。
   *
   * 与上面 testModel 的关键差别：**不查已保存的目录**。表单里刚填的
   * baseUrl / 模型 id 在保存前不在目录里，走 testModel 只会得到
   * 「目录里找不到该模型」——而这条通道存在的意义正是「填完就试」。
   * 因此探测目标完全由入参构造，只借用 probeModel 这一份协议实现（不另写一份）。
   *
   * 凭据优先取表单里刚敲的那个：用户点测试往往正是因为「怀疑刚才那把 key
   * 不对」，此时读已存的反而测的不是他想测的东西。表单留空才回落到已存凭据，
   * 好让「编辑既有服务商、只改 baseUrl」不必重打密钥。
   */
  [INVOKE.testDraftModel]: async ([draft, modelId, apiKey]) => {
    const form = draft;
    const target = modelId.trim();
    if (form.baseUrl.trim() === "") return { ok: false, error: "请先填写接口地址" };
    if (target === "") return { ok: false, error: "请先填写模型 ID" };
    const typed = apiKey?.trim();
    const key = typed === void 0 || typed === "" ? readApiKey(getAuthPath(), form.providerId) : typed;
    try {
      return await withHardTimeout(
        probeModel({
          api: form.api,
          baseUrl: form.baseUrl,
          modelId: target,
          apiKey: key,
          authHeader: form.authHeader === true
        }),
        15e3
      );
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  /* ── 权限设置 ───────────────────────────────────────────────────── */
  [INVOKE.getPermissions]: async () => buildPermissionInfo(activePermissions),
  [INVOKE.setPermissions]: async ([input]) => {
    const candidate = input;
    if (!isSandboxMode(candidate.sandbox)) {
      throw new Error(`未知的权限范围：${String(candidate.sandbox)}`);
    }
    if (!isApprovalPolicy(candidate.approval)) {
      throw new Error(`未知的审批策略：${String(candidate.approval)}`);
    }
    const settings = {
      sandbox: candidate.sandbox,
      approval: candidate.approval,
      presetId: presetIdFor(candidate.sandbox, candidate.approval)
    };
    activePermissions = settings;
    writePreferences({ ...readPreferences(), permissions: settings });
    return buildPermissionInfo(settings);
  },
  /* ── 全局默认推理强度 ─────────────────────────────────────────── */
  // 未配置回 medium：pi 的内置默认就是 medium（createAgentSession 未传
  // thinkingLevel 时的取值链），兜底与 pi 不漂移。
  [INVOKE.getThinkingLevelDefault]: async () => ({
    level: readPreferences().thinkingLevel ?? "medium"
  }),
  [INVOKE.setThinkingLevelDefault]: async ([level]) => {
    if (!isThinkingLevel(level)) {
      throw new Error(`未知的推理强度档位：${String(level)}`);
    }
    writePreferences({ ...readPreferences(), thinkingLevel: level });
  },
  /* ── 回复风格 ─────────────────────────────────────────────────── */
  // 未配置回 DEFAULT_STYLE_ID（professional）：默认值的唯一出处在
  // core/resources.ts，偏好文件保持「没写就是没写」（同 thinkingLevel 口径）。
  [INVOKE.getStyle]: async () => ({
    styles: RESOURCES.styles.map((s) => ({ id: s.id, label: s.label })),
    styleId: readPreferences().styleId ?? DEFAULT_STYLE_ID
  }),
  [INVOKE.setStyle]: async ([styleId]) => {
    if (typeof styleId !== "string" || styleId !== "" && !RESOURCES.styles.some((s) => s.id === styleId)) {
      throw new Error(`未知的回复风格：${String(styleId)}`);
    }
    writePreferences({ ...readPreferences(), styleId });
  },
  /* ── 记忆开关（spec: add-memory-system） ──────────────────────── */
  // 未配置回 true（缺省开启）：偏好文件保持「没写就是没写」，
  // 缺省语义收在这一个出口（读偏好处不填默认值，见 preferences.ts）。
  [INVOKE.getMemoryEnabled]: async () => ({
    enabled: readPreferences().memoryEnabled ?? true
  }),
  [INVOKE.setMemoryEnabled]: async ([enabled]) => {
    const value = enabled === true;
    writePreferences({ ...readPreferences(), memoryEnabled: value });
    if (ensureBuiltinMemoryTask(automationStore, value)) {
      pushAutomationChanged();
    }
  },
  /* ── 团队协作开关（spec: add-team-foundations 批 5） ──────────── */
  // 未配置回 false（缺省关闭）：实验特性缺省不可见；
  // 缺省语义收在这一个出口（读偏好处不填默认值，同 memoryEnabled）。
  [INVOKE.getAgentTeamsEnabled]: async () => ({
    enabled: readPreferences().agentTeamsEnabled ?? false
  }),
  // 读改写（同上）。只影响之后新建的会话：团队工具注册发生在 SessionHost
  // 建立时（teamExtensionFactory 的 isEnabled 现读偏好），既有会话不补注册。
  [INVOKE.setAgentTeamsEnabled]: async ([enabled]) => {
    const value = enabled === true;
    writePreferences({ ...readPreferences(), agentTeamsEnabled: value });
  },
  /* ── 团队成员会话操作（spec: add-team-foundations 批 8） ───────── */
  // 聚焦成员视图的发送与 @直接路由共用：按成员 sessionId 找句柄直投
  // （followUp 语义在 handle.prompt 内部）。找不到句柄 = 成员已解散，
  // 响亮报错让上层的错误卡如实呈现，不静默丢消息。
  [INVOKE.memberPrompt]: async ([memberSessionId, text]) => {
    const handle = memberHandlesBySession.get(memberSessionId);
    if (handle === void 0) {
      throw new Error("该成员已不在团队中（可能已解散），无法接收消息");
    }
    const textValue = text;
    if (textValue.trim() === "") throw new Error("消息不能为空");
    await handle.prompt(textValue);
  },
  [INVOKE.memberAbort]: async ([memberSessionId]) => {
    const handle = memberHandlesBySession.get(memberSessionId);
    if (handle === void 0) return;
    await handle.abort();
  },
  /* ── 用户画像（spec: add-memory-system） ────────────────────── */
  // 文件不存在回空串：设置页 textarea 从空白开始。「还没生成过画像」是新用户
  // 的常态，不是错误（同 memory.ts 的降级口径：用户数据缺席不该响亮失败）。
  [INVOKE.getProfile]: async () => ({
    content: existsSync(profilePath()) ? readFileSync(profilePath(), "utf8") : ""
  }),
  // 覆盖写全文。画像在 compose 时现读现拼（buildSessionMemorySection），
  // 所以写完下一轮对话即生效，无需通知任何运行中的会话。
  [INVOKE.setProfile]: async ([content]) => {
    writeFileSync(profilePath(), content, "utf8");
  },
  // 清空内容但保留文件本身：蒸馏任务每晚照常往里写，删文件反而多一条
  // 「不存在 → 重建」的分支要维护。
  [INVOKE.resetProfile]: async () => {
    writeFileSync(profilePath(), "", "utf8");
  },
  /* ── 个性化（spec: rework-settings-layout） ──────────────────── */
  // 合并缺省后下发：字符串四键空串 = 未设置（renderer 显示用），两个 boolean
  // 缺省 true —— 缺省语义收在这一个出口（读偏好处不填默认值，同 memoryEnabled）。
  [INVOKE.getPersonalization]: async () => {
    const prefs = readPreferences();
    return {
      customInstructions: prefs.customInstructions ?? "",
      userNickname: prefs.userNickname ?? "",
      assistantName: prefs.assistantName ?? "",
      personaDescription: prefs.personaDescription ?? "",
      welcomeGreeting: prefs.welcomeGreeting ?? true,
      showChangeDetails: prefs.showChangeDetails ?? true
    };
  },
  // 部分更新合并：只动传入的键（读改写不丢其他键）；字符串 trim 后为空 =
  // 删该键（空 = 未设置，与读取层的空串归一化口径一致）；非字符串响亮抛错。
  [INVOKE.setPersonalization]: async ([patch]) => {
    const input = patch;
    const next = { ...readPreferences() };
    const stringKeys = ["customInstructions", "userNickname", "assistantName", "personaDescription"];
    for (const key of stringKeys) {
      const value = input[key];
      if (value === void 0) continue;
      if (typeof value !== "string") throw new Error(`个性化字段 ${key} 应为字符串`);
      const trimmed = value.trim();
      if (trimmed === "") delete next[key];
      else next[key] = value;
    }
    if (input.welcomeGreeting !== void 0) next["welcomeGreeting"] = input.welcomeGreeting === true;
    if (input.showChangeDetails !== void 0) next["showChangeDetails"] = input.showChangeDetails === true;
    writePreferences(next);
  },
  /* ── 长期记忆记录（MEMORY.md，spec: rework-settings-layout） ──── */
  // 不存在回空串：「还没任何长期记忆」是常态不是错误（同 getProfile 口径）。
  // 写入前确保目录在（新机器上 ~/.zerowork 可能还没建过）。
  [INVOKE.getMemory]: async () => ({
    content: existsSync(userMemoryPath()) ? readFileSync(userMemoryPath(), "utf8") : ""
  }),
  [INVOKE.setMemory]: async ([content]) => {
    mkdirSync(getConfigDir(), { recursive: true });
    writeFileSync(userMemoryPath(), content, "utf8");
  },
  /* ── 提示词预览（设置页，spec: systematize-prompt-architecture Task 5） ── */
  // 纯逻辑在 ./prompt-preview.ts（可测）；这里只负责现取环境：
  // 技能清单 / 专家库 / 风格偏好现读（与 composeSystemPrompt 同一口径）。
  // 预览只组装系统提示词，不产出逐轮可变事实（时间/记忆内容/个性化 —— 它们走
  // prompt-switch 的注入，不在提示词里）与工作目录（hidden context 的
  // workspace_context）、托管解释器路径（hidden context 的 python_env）。
  [INVOKE.promptPreview]: async ([request]) => {
    const preview = request;
    const experts = loadExpertsNow();
    const expert = resolveSessionExpert(experts, preview.expertId);
    return buildPromptPreview(RESOURCES, preview, {
      /*
       * 技能清单要过**同一份**启用过滤（enabledSkills 用的也是这个纯函数）：
       * 预览里出现一个「此刻发消息根本看不到」的技能，就是与真实组装的静默漂移。
       * 这里直接调 filterEnabledSkills 而不是 enabledSkills(preview.expertId)，
       * 是因为上面已经把专家解析过一次了 —— 再调一次会把专家库整库重载一遍
       * （列表同源：同一份 listSkills 结果 + 同一份 overrides + 同一个过滤函数）。
       */
      skills: toSkillDescriptors(
        filterEnabledSkills(
          await listSkills(expert?.skillsDir),
          readPreferences().skillOverrides
        )
      ),
      // 预览按请求里的 expertId 解析人格（同一条 requireExpertPersona 路径）。
      experts,
      preferredStyleId: readPreferences().styleId,
      // 与 composeSystemPrompt 同一来源现读（含降级口径），预览不静默漂移。
      memorySystemBody: loadMemorySystemPrompt(getResourcesDir()),
      // 同上：预览里少了输出语言段，用户就看不到它排没排到「回复风格」之后。
      languageBody: loadLanguagePrompt(getResourcesDir())
    });
  },
  /* ── 默认存储路径（工作空间根） ────────────────────────────────── */
  [INVOKE.getDefaultWorkspacePath]: async () => {
    const custom = readPreferences().defaultWorkspacePath;
    return {
      effective: getEffectiveWorkspaceRoot(),
      custom,
      isDefault: custom === void 0
    };
  },
  [INVOKE.setDefaultWorkspacePath]: async ([path]) => {
    const trimmed = path.trim();
    const preferences = readPreferences();
    if (trimmed === "") {
      const { defaultWorkspacePath: _dropped, ...rest } = preferences;
      writePreferences(rest);
    } else {
      writePreferences({ ...preferences, defaultWorkspacePath: trimmed });
    }
    return { effective: getEffectiveWorkspaceRoot() };
  },
  /* ── 输入框补全数据源（@ 文件 + / 命令） ────────────────────────── */
  [INVOKE.completions]: async () => ({
    files: indexFiles(currentBucket.cwd),
    commands: [
      // 技能：/skill:name 的**展开在 daemon 的 prompt 入口做**（expandSkillInvocation，
      // 2026-09-20 技能多选起；改前交给 pi 的 _expandSkillCommand，那只有开头一个能生效），
      // renderer 只需把名字补全出来，原样传给 session.prompt 即可。
      // `user-invocable: false` 的（纯内部技能）不进菜单 —— 面板是给用户手动选的地方；
      // 手动敲 /skill:<name> 仍然照旧可用（可见性只收菜单，不拦展开）。
      // 技能集必须走 enabledSkills（与清单段、use_skill 同一个出口）：
      // 各写一份过滤就会出现「菜单里有但 use_skill 加载不了」。
      // 不传专家 id = 与今日行为一致的全局池口径（专家私有技能只在绑定该专家的
      // 会话里可见，那条差异与本轮的启停过滤无关）。
      ...(await enabledSkills(void 0)).filter((s) => s.userInvocable).map((s) => ({
        // 前缀用共享常量（渲染层要按它切出裸技能名去渲染 chip）。
        name: `${SKILL_COMMAND_PREFIX}${s.name}`,
        description: s.description,
        source: "skill"
      })),
      // 提示词模板：/模板名 由 pi 的 expandPromptTemplate 展开。
      // 发现目录必须与会话实际生效的一致 —— cwd 取当前会话桶的 cwd
      //（会话与 cwd 终身绑定，桶即真相）。空串 = 待分配（还没工作目录）由
      // listSessionPromptTemplates 收口为空列表，不落到 daemon 进程 cwd 去扫。
      ...listSessionPromptTemplates(currentBucket.cwd, getConfigDir()).map((t) => ({
        name: t.name,
        description: t.description,
        source: "template"
      })),
      // 自有命令：daemon 在 INVOKE.prompt 里拦截执行（不经 pi），
      // 解析规则见 shared/builtin-commands.ts —— 两边必须一致。
      { name: "new", description: "新建任务", source: "builtin" },
      { name: "compact", description: "压缩上下文：总结历史，释放窗口", source: "builtin" },
      { name: "plan", description: "计划模式：只读调研，先出计划再执行", source: "builtin" }
    ]
  }),
  /* ── 工作空间 ───────────────────────────────────────────────────── */
  // current = 新建任务的默认 cwd 来源（applyWorkspace 设定）——
  // 多任务并发后「当前空间」不再等于「当前会话的 cwd」（会话 cwd 终身绑定）。
  [INVOKE.workspaceSnapshot]: async () => ({
    current: defaultWorkspaceDir,
    // 生效根现读（不缓存）：改默认存储路径后，空间列表即刻反映新根。
    defaultRoot: getEffectiveWorkspaceRoot(),
    // 过滤掉每任务的自动分配目录与历史共享临时目录：它们躺在根下，但不是
    // 可切换的工作空间（切进去等于和别的任务共用 cwd），混进下拉就是噪音
    // —— 由 isSelectableWorkspaceDir 这个谓词判定。
    // 只在这里过滤（不改 listWorkspaces）：那是「列出根下子目录」的通用原语，
    // 保留全部目录，过滤是选择器自己的口径（谓词见 workspace-model.ts）。
    workspaces: listWorkspaces(getEffectiveWorkspaceRoot()).filter(isSelectableWorkspaceDir),
    previewBaseUrl: previewServers.baseUrlFor(defaultWorkspaceDir),
    // worktree 意图与 current 同源（都是「下一个新任务怎么起」）：
    // 芯片据此显示自己是否已启用，见 WorkspaceSnapshot.worktreeBranch 的注释。
    worktreeBranch: pendingWorktreeBranch
  }),
  // 按 cwd 查多根实例表（每 cwd 一个端口，懒建）；未启动返回 undefined ——
  // 面板显示引导文案即可，不视为错误（契约见 shared/ipc.ts）。
  [INVOKE.previewBaseUrl]: async ([cwd]) => previewServers.baseUrlFor(cwd),
  [INVOKE.createWorkspace]: async ([name]) => applyWorkspace(createWorkspace(getEffectiveWorkspaceRoot(), name)),
  [INVOKE.setWorkspace]: async ([path]) => applyWorkspace(path),
  [INVOKE.workspaceGroups]: async () => listWorkspaceGroups(),
  [INVOKE.workspaceRename]: async ([cwd, name]) => {
    const target = cwd;
    const trimmed = name.trim();
    const groups = await listWorkspaceGroups();
    const resolvedTarget = resolve(target);
    const siblings = groups.filter((g) => resolve(g.cwd) !== resolvedTarget).map((g) => g.displayName ?? basename(g.cwd));
    const error = validateDisplayName(trimmed, siblings);
    if (error !== void 0) throw new Error(error);
    setDisplayName(target, trimmed);
  },
  [INVOKE.workspaceRemove]: async ([cwd]) => {
    const target = cwd;
    const resolvedTarget = resolve(target);
    for (const bucket of bucketsById.values()) {
      if (bucket.hostPromise !== void 0 && resolve(bucket.cwd) === resolvedTarget) {
        throw new Error("该空间有正在打开的任务，请先切换到它并停止运行后再移除");
      }
    }
    const sessions = await listSessions();
    for (const session of sessions) {
      if (session.isTempTask || resolve(session.cwd) !== resolvedTarget) continue;
      moveToTrash(session.path);
    }
    removeDisplayName(target);
    pushTaskListChanged();
  },
  /**
   * 只校验不执行：renderer 是半可信环境，「已知空间」的知识又只在 daemon
   * （组由会话文件派生），所以校验放这里；真正的 shell.openPath 在 main 侧
   * —— main 的本地 handler 先把本通道转发到这里，通过后才 openPath。
   * 若不校验，任意网页/XSS 都能让 main 打开任意路径（~\.ssh、系统目录）。
   *
   * 白名单 = 已知工作空间 ∪ 任一已知会话的 cwd（后者是为任务区放开，见
   * isRevealableCwd）：任务区会话不成组（listWorkspaceGroups 只收非临时会话），
   * 不把它们的 cwd 纳入，任务行「打开文件夹」就找不到自己的时间戳目录。
   * 未知路径（家目录、系统目录）不在任一列表中，仍一律拒。
   */
  [INVOKE.workspaceReveal]: async ([cwd]) => {
    const known = [
      ...(await listWorkspaceGroups()).map((g) => g.cwd),
      ...(await listSessions()).map((s) => s.cwd)
    ];
    if (!isRevealableCwd(cwd, known)) {
      throw new Error("不是已知的工作空间");
    }
  },
  /* ── 产物 ─────────────────────────────────────────────────────── */
  // 预览面板的文本读取。HTML 预览不走这里（走静态服务），这里管文本类。
  [INVOKE.readArtifact]: async ([path]) => readSessionArtifact(currentBucket.cwd, path),
  [INVOKE.statPath]: async ([path]) => statSessionArtifact(currentBucket.cwd, path),
  /* ── 权限审批回程 ─────────────────────────────────────────────── */
  [INVOKE.permissionResponse]: async ([response]) => {
    const answer = response;
    const pending = pendingApprovals.get(answer.id);
    if (pending === void 0) return;
    pendingApprovals.delete(answer.id);
    const rule = rememberRuleFromApproval(pending.toolName, answer, [getConfigDir(), ...PROTECTED_DIRS]);
    if (rule !== void 0) appendRule(rule);
    const outcome = normalizeApprovalOutcome(answer);
    eventLog.append({
      kind: "permission_response",
      id: answer.id,
      toolName: pending.toolName,
      outcome,
      remember: answer.remember === true,
      // 写回成功的规则前缀一并入档：审计要能还原「这次批准留下了什么持久影响」。
      ...rule === void 0 ? {} : { rulePrefix: rule.prefix }
    });
    pending.resolve(answer);
  },
  /* ── 结构化提问回程 ─────────────────────────────────────────────── */
  [INVOKE.questionnaireResponse]: async ([response]) => {
    const answer = response;
    const slot = pendingQuestionnaires.get(answer.id);
    if (slot === void 0) {
      eventLog.append({
        kind: "ipc_error",
        channel: "questionnaire:response",
        message: `问卷应答找不到在途请求（重复应答或契约错配）：${answer.id}`
      });
      return;
    }
    pendingQuestionnaires.delete(answer.id);
    eventLog.append({
      kind: "questionnaire_response",
      id: answer.id,
      skipped: answer.skipped
    });
    slot.resolve(answer);
  },
  /* ── pi 的 ctx.ui 桥：随需要落地 ──────────────────────────────── */
  // 权限弹窗走上面的自有通道（要展示工具入参、风险等级、「记住」选项，
  // ctx.ui.confirm 的纯文本承载不了）。这条通道留给将来扩展里真正用到
  // ctx.ui.select / input 的场景。
  [INVOKE.uiResponse]: async () => {
    throw new Error("暂无扩展使用 ctx.ui 交互通道");
  }
};

function auditSnapshot(category) {
  if (category !== void 0 && !isAuditCategory(category)) {
    throw new Error(`未知的审计类别：${String(category)}`);
  }
  const { records, total } = readAuditRecords({
    ...category === void 0 ? {} : { category },
    limit: AUDIT_PANEL_LIMIT
  });
  return { records, total, limit: AUDIT_PANEL_LIMIT };
}

function requireReady(options, id, kind) {
  const found = options.find((o) => o.id === id);
  if (found === void 0) throw new Error(`未知${kind}：${id}`);
  if (!found.ready) throw new Error(`「${found.label}」${kind}还未实现`);
  return id;
}

function updateStateLocally(bucket, changes) {
  emitSessionEvent(bucket, {
    type: "session_state",
    state: { ...bucket.conversation.state, ...changes }
  });
}

async function applyInteraction(bucket, id) {
  const readyId = requireReady(INTERACTIONS, id, "交互模式");
  if (readyId !== "plan") bucket.lastNonPlanInteraction = readyId;
  if (bucket.hostPromise === void 0) {
    updateStateLocally(bucket, { interactionId: readyId });
    return;
  }
  (await bucket.hostPromise).setInteraction(readyId);
}

async function dispatch(request) {
  console.log(`← ${request.channel}`);
  eventLog.append({ kind: "ipc", channel: request.channel });
  const handler = handlers[request.channel];
  if (handler === void 0) {
    post({
      kind: "response",
      id: request.id,
      ok: false,
      error: `未知通道：${request.channel}`
    });
    return;
  }
  try {
    const value = await handler(request.args);
    post({ kind: "response", id: request.id, ok: true, value });
  } catch (error) {
    const stack = error instanceof Error ? error.stack : void 0;
    if (stack !== void 0) console.error(stack);
    eventLog.append({
      kind: "ipc_error",
      channel: request.channel,
      message: error instanceof Error ? error.message : String(error),
      stack
    });
    post({
      kind: "response",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function prepareAgentTools() {
  try {
    const agentTools = await ensureAgentTools();
    if (agentTools.installed.length > 0 || agentTools.missing.length > 0) {
      eventLog.append({
        kind: "agent_tools",
        target: agentTools.targetDir,
        installed: [...agentTools.installed],
        present: [...agentTools.present],
        missing: [...agentTools.missing]
      });
    }
    if (agentTools.missing.length > 0) {
      console.error(
        `pi 的外部二进制缺失（find/grep 将不可用）：${agentTools.missing.join(", ")} —— 检查 resources/bin/`
      );
    }
    if (agentTools.installed.length > 0) {
      console.log(
        `已就位 pi 外部二进制：${agentTools.installed.join(", ")} → ${agentTools.targetDir}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pi 外部二进制就位检查失败（find/grep 可能不可用）：${message}`);
    eventLog.append({ kind: "agent_tools", error: message });
  }
}

function start() {
  console.log(
    `daemon 启动：node ${process.version} on ${process.platform}-${process.arch}`
  );
  console.log(`配置目录：${getConfigDir()}`);
  eventLog.append({
    kind: "process",
    event: "daemon_start",
    node: process.version,
    platform: `${process.platform}-${process.arch}`
  });
  if (defaultWorkspaceDir !== "") {
    void previewServers.ensure(defaultWorkspaceDir).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`预览服务启动失败：${message}`);
      eventLog.append({ kind: "ipc_error", channel: "preview:ensure", message });
    });
  }
  automationStore.load();
  if (ensureBuiltinMemoryTask(automationStore, readPreferences().memoryEnabled ?? true)) {
    pushAutomationChanged();
  }
  automationScheduler.start();
  try {
    ensureBuiltinProviders(getModelsPath());
  } catch (error) {
    eventLog.append({
      kind: "builtin_provider_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  post({ kind: "ready" });
  void prepareAgentTools();
  restoreTeamsFromDisk();
}

export {
	AUTOMATION_RUN_CUSTOM_TYPE,
	AutomationScheduler,
	BRANCH_SUFFIX,
	BUILTIN_SKILL_DIRS,
	CHILD_SESSION_CUSTOM_TYPES,
	DEFAULT_TICK_MS,
	EMPTY_TITLE_PLACEHOLDER,
	FAIL_MESSAGES,
	INTERACTIONS,
	MEMO_LIMIT,
	NO_MARKERS,
	PROTECTED_DIRS,
	READ_CONCURRENCY,
	RESOURCES,
	RUN_LEDGER_IPC_LIMIT,
	RUN_TIMEOUT_MS,
	SCENES,
	SESSION_HEAD_BYTES,
	SUBAGENT_CUSTOM_TYPE,
	UNKNOWN_MODEL,
	WELCOME,
	activeModelKey,
	activePermissionRules,
	activePermissions,
	adoptHost,
	adoptedSessionId,
	aggregateUsageStats,
	appendRule,
	applyInteraction,
	applyRebuiltConversation,
	applyWorkspace,
	asNumber,
	assertInsideSessionsDir,
	auditSnapshot,
	automationScheduler,
	automationStore,
	backgroundJobs,
	branchFail,
	branchOk,
	branchTitleFor,
	bucketsById,
	buildBranchTitle,
	buildConversationForBucket,
	buildPermissionInfo,
	buildRunExtensions,
	buildRuntimeContext,
	buildSkillsSnapshot,
	calculateStreaks,
	catalogPromise,
	collectToolCalls,
	composeSystemPrompt,
	createAutomationRunExecutor,
	createBranchedSessionFile,
	createEmptySessionFile,
	createHost,
	createSessionFileFromPrefix,
	currentBucket,
	decideExtract,
	defaultCwdAfterResume,
	defaultWorkspaceDir,
	deliverSessionMessage,
	deliveredLedgerOf,
	deliveredTeamFingerprints,
	describeSandboxReason,
	disbandTeamOf,
	dispatch,
	dueTasks,
	emitContextUsageDetail,
	emitMemberEvent,
	emitSessionEvent,
	emitSessionStats,
	emitTeamProgress,
	emptyUsageStats,
	enabledSkills,
	endOfTurn,
	ensureParentSession,
	entryTimeMs,
	eventLog,
	evictIdleHosts,
	expandSkillInvocation,
	extractBranchFile,
	findBucketByFile,
	forkSession,
	freshConversation,
	getCatalog,
	getHost,
	getWebSearchConfig,
	handlers,
	isAgentTeamsEnabled,
	isEnoent,
	isIdentifiedModel,
	isInternalSessionFile,
	isLegacySession,
	isTempCwd,
	latestSandboxDiagnostics,
	listLedgerSessionIds,
	listSessions,
	listSkills,
	listWorkspaceGroups,
	liveMcpHandles,
	loadExpertsNow,
	localDateKey,
	materializeBranch,
	mcpEditCwd,
	mcpHandleByBucket,
	memberHandlesBySession,
	memberRunnerDeps,
	mountSessionFile,
	moveToTrash,
	newSessionHeader,
	newTask,
	observability,
	parentPort,
	parseCache,
	parseSessionFile,
	parseSessionFile$1,
	parseUsage,
	pendingApprovals,
	pendingQuestionnaires,
	pendingWorktreeBranch,
	persistTeam,
	persistedFingerprint,
	post,
	prepareAgentTools,
	previewServers,
	pushAutomationChanged,
	pushTaskListChanged,
	pythonRuntimeOptions,
	readPersonalizationSection,
	readSessionHeadMarkers,
	readSessionHeader,
	readSkillMeta,
	readSkillVersion,
	readUsageStats,
	recordSandboxDiagnostics,
	recoverTasks,
	remountHostInBucket,
	requestApproval,
	requestQuestionnaireAnswers,
	requireParentPort,
	requireReady,
	resolveAnchorForIndex,
	resolveBranchAnchor,
	restartSession,
	restoreTeamsFromDisk,
	resumeChainByFile,
	resumeEpoch,
	resumeSession,
	resumeSessionOnce,
	runLedgerDir,
	runStartWaiters,
	runtimeInstalls,
	runtimeInventoryForSession,
	runtimeShellEnv,
	sandboxDiagnosticsByWorkspace,
	sandboxPrepareNoteOf,
	sanitizeForLog,
	saveAutomation,
	searchSessionFiles,
	sessionArchive,
	sessionHeadMemo,
	sessionPrefixLines,
	sessionSkills,
	setCurrentBucket,
	setSessionName,
	setSessionParentSession,
	skillSets,
	start,
	subagentRunner,
	takePendingTeamOutput,
	teamMailbox,
	teamMessaging,
	teamRegistry,
	teamTaskBoard,
	tempTasksDir,
	toSkillDescriptors,
	toUseSkills,
	toggleAutomation,
	truncateSessionTo,
	truncateSessionToStart,
	updateStateLocally,
	wakeMember,
	withHardTimeout,
	writeSessionFileLines,
};