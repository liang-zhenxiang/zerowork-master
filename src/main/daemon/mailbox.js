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
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
import { getSessionsDir } from "./config-paths.js";
import { validateSessionFilePath } from "./session-view.js";

const defaultClock$1 = { now: () => Date.now(), generateId: () => randomUUID() };

class SessionMailbox {
  queues = /* @__PURE__ */ new Map();
  clock;
  constructor(clock = defaultClock$1) {
    this.clock = clock;
  }
  /**
   * 定向投递一条消息。返回该收件箱投递后的待消费条数（投递方不必用，
   * 断言与日志顺手）。空来源或空正文是调用方 bug，响亮抛错 —— 静默吞掉
   * 会让「消息为什么没到」变成无从排查的悬案。
   */
  deliver(toSessionId, fromSessionId, text, fromLabel) {
    if (toSessionId === "") throw new Error("信箱投递缺少目标会话 id");
    if (fromSessionId === "") throw new Error("信箱投递缺少来源会话 id");
    if (text === "") throw new Error("信箱投递的正文不能为空");
    const queue = this.queues.get(toSessionId) ?? [];
    queue.push({
      id: this.clock.generateId(),
      fromSessionId,
      ...fromLabel === void 0 || fromLabel === "" ? {} : { fromLabel },
      text,
      createdAt: this.clock.now()
    });
    this.queues.set(toSessionId, queue);
    return queue.length;
  }
  /**
   * 多路投递同一条消息（@all 广播的原语形态）。返回成功入箱的总条数；
   * 目标列表里的空串条目是调用方 bug，照 deliver 同款响亮抛错。
   */
  broadcast(fromSessionId, text, toSessionIds, fromLabel) {
    let count = 0;
    for (const to of toSessionIds) {
      this.deliver(to, fromSessionId, text, fromLabel);
      count += 1;
    }
    return count;
  }
  /** 取走某收件箱的全部消息（读后清空）。没有箱或箱空 → 空数组。 */
  drain(toSessionId) {
    const queue = this.queues.get(toSessionId);
    if (queue === void 0) return [];
    this.queues.delete(toSessionId);
    return queue;
  }
  /** 待消费条数（接线方打日志 / 断言用，消费方不走这里）。 */
  pendingCount(toSessionId) {
    return this.queues.get(toSessionId)?.length ?? 0;
  }
  /** 销毁某收件箱（会话删除时接线方调用；未投出的消息随会话一起消失）。 */
  clear(toSessionId) {
    this.queues.delete(toSessionId);
  }
}

const ROLE_MARKER = /^\s*(?:Human|Assistant):/;

function sanitizeSubagentOutput(text) {
  return text.split("\n").map((line) => {
    let out = line;
    if (out.includes("system-reminder")) {
      out = out.replaceAll("<", "‹").replaceAll(">", "›");
    }
    if (ROLE_MARKER.test(out)) {
      out = `\`${out}`;
    }
    return out;
  }).join("\n");
}

function memberSessionPath(sessionId) {
  if (sessionId === "") return void 0;
  const dir = getSessionsDir();
  const direct = join(dir, `${sessionId}.jsonl`);
  if (existsSync(direct)) return direct;
  const now = Date.now();
  let index = sessionFileIndex;
  if (index === void 0 || index.dir !== dir || now - index.builtAt > SESSION_FILE_INDEX_TTL_MS) {
    index = { dir, builtAt: now, byId: buildSessionFileIndex(dir) };
    sessionFileIndex = index;
  }
  return index.byId.get(sessionId);
}

let sessionFileIndex;

const SESSION_FILE_INDEX_TTL_MS = 1e3;

function buildSessionFileIndex(dir) {
  const byId = /* @__PURE__ */ new Map();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return byId;
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".jsonl")) continue;
    const base = name.slice(0, -".jsonl".length);
    const separator = base.indexOf("_");
    const id = separator === -1 ? base : base.slice(separator + 1);
    if (id !== "") byId.set(id, join(dir, name));
  }
  return byId;
}

const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

function readLinesSafely(path) {
  if (path === void 0) return void 0;
  try {
    if (validateSessionFilePath(path, getSessionsDir()) !== void 0) return void 0;
    const size = statSync(path).size;
    if (size <= TRANSCRIPT_TAIL_BYTES) return readFileSync(path, "utf8").split("\n");
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(TRANSCRIPT_TAIL_BYTES);
      const bytes = readSync(fd, buffer, 0, TRANSCRIPT_TAIL_BYTES, size - TRANSCRIPT_TAIL_BYTES);
      const text = buffer.toString("utf8", 0, bytes);
      const firstBreak = text.indexOf("\n");
      return (firstBreak === -1 ? text : text.slice(firstBreak + 1)).split("\n");
    } finally {
      closeSync(fd);
    }
  } catch {
    return void 0;
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block;
    if (record["type"] !== "text") continue;
    const text = record["text"];
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("");
}

function readMemberTranscript(sessionId) {
  const lines = readLinesSafely(memberSessionPath(sessionId));
  if (lines === void 0) return [];
  const out = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed;
    if (record["type"] !== "message") continue;
    const message = record["message"];
    if (typeof message !== "object" || message === null) continue;
    const msg = message;
    const role = typeof msg["role"] === "string" ? msg["role"] : "";
    const text = extractTextFromContent(msg["content"]);
    const stopReason = typeof msg["stopReason"] === "string" ? msg["stopReason"] : void 0;
    out.push({ role, text, stopReason, hasText: text.trim() !== "" });
  }
  return out;
}

function isCancellationRecord(record) {
  return record.stopReason === "aborted" || record.stopReason === "cancelled";
}

function isFailureRecord(record) {
  return record.stopReason === "error" || record.stopReason === "length";
}

function isInProgressRecord(record) {
  return record.stopReason === "toolUse" || record.stopReason === "tool_use";
}

function deriveMemberStatus(records) {
  let terminal;
  for (const record of records) {
    if (record.role !== "assistant") continue;
    if (isCancellationRecord(record)) terminal = "killed";
    else if (isFailureRecord(record)) terminal = "failed";
    else if (isInProgressRecord(record)) terminal = void 0;
    else if (record.text.trim() !== "") terminal = "completed";
  }
  return terminal;
}

function extractMemberOutput(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record === void 0) continue;
    if (record.role !== "assistant") continue;
    if (record.text.trim() === "") continue;
    return record.text;
  }
  return void 0;
}

function normalizeMemberOutput(value) {
  return value.replace(/^\s*\[Agent ID:[^\]]+\]\s*/i, "").replace(/\s*\[Agent ID:[^\]]+\]\s*$/i, "").trim();
}

function readMemberTranscriptView(sessionId) {
  const messages = readMemberTranscript(sessionId);
  return {
    messages,
    status: deriveMemberStatus(messages),
    output: extractMemberOutput(messages)
  };
}

export {
	ROLE_MARKER,
	SESSION_FILE_INDEX_TTL_MS,
	SessionMailbox,
	TRANSCRIPT_TAIL_BYTES,
	buildSessionFileIndex,
	defaultClock$1,
	deriveMemberStatus,
	extractMemberOutput,
	extractTextFromContent,
	isCancellationRecord,
	isFailureRecord,
	isInProgressRecord,
	memberSessionPath,
	normalizeMemberOutput,
	readLinesSafely,
	readMemberTranscript,
	readMemberTranscriptView,
	sanitizeSubagentOutput,
	sessionFileIndex,
};