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

const RUNTIME_CONTEXT_CUSTOM_TYPE = "zerowork-runtime-context";

const HIDDEN_CONTEXT_CUSTOM_TYPE = "zerowork-hidden-context";

const RUN_TIME_CUSTOM_TYPE = "zerowork-run-time";

const TEAM_OUTPUT_CUSTOM_TYPE = "zerowork-team-output";

function toolOutcomeFrom(isError, details) {
  if (isError) return "error";
  if (typeof details === "object" && details !== null && details.blocked === true) {
    return "blocked";
  }
  return "ok";
}

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

function isThinkingLevel(value) {
  return typeof value === "string" && THINKING_LEVELS.includes(value);
}

function isCompactionReason(value) {
  return value === "manual" || value === "threshold" || value === "overflow";
}

function generatingLabel(toolName, changeType) {
  if (toolName === "edit") return "修改中";
  if (toolName === "write") return changeType === "created" ? "生成中" : "修改中";
  return toolName;
}

function isStreamingEvent(event) {
  return event.type === "assistant_text_delta" || event.type === "assistant_thinking_delta" || event.type === "tool_progress" || event.type === "tool_stream_progress";
}

function readLedgerEntries(filePath, report) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    report?.(
      `台账读取失败按空台账继续：${filePath} —— ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }
  return entries;
}

function listLedgerFiles(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return files.map((f) => join(dir, f));
}

function ledgerFileName(sessionId) {
  return `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`;
}

function scanLedgerFile(filePath) {
  let maxSeq = 0;
  let openRunId;
  let openCompaction;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.seq === "number" && entry.seq > maxSeq) maxSeq = entry.seq;
    if (entry.kind === "run_start") {
      const runId = entry.data.runId;
      openRunId = typeof runId === "string" ? runId : void 0;
    } else if (entry.kind === "run_end") {
      openRunId = void 0;
    } else if (entry.kind === "compaction_start") {
      const { lock, reason } = entry.data;
      if ((lock === null || typeof lock === "string") && isCompactionReason(reason)) {
        openCompaction = { lock, reason };
      }
    } else if (entry.kind === "compaction") {
      openCompaction = void 0;
    }
  }
  return { maxSeq, openRunId, openCompaction };
}

function compactSeal(open) {
  return {
    reason: open.reason,
    aborted: true,
    lock: open.lock,
    interrupted: true,
    errorMessage: "上次压缩未完成即退出（进程中断），本条为启动回放补记的合成闭合"
  };
}

function repairTruncatedTail(filePath) {
  const fd = openSync(filePath, "r");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    if (last[0] !== 10) appendFileSync(filePath, "\n", "utf8");
  } finally {
    closeSync(fd);
  }
}

function tryScan(filePath, report) {
  try {
    return scanLedgerFile(filePath);
  } catch (error) {
    report(`台账回放失败按空台账继续：${filePath} —— ${error instanceof Error ? error.message : String(error)}`);
    return { maxSeq: 0, openRunId: void 0, openCompaction: void 0 };
  }
}

class RunLedger {
  filePathValue;
  nextSeq;
  now;
  report;
  /**
   * 增量投影钩子：条目写盘成功后回调（observability 的台账 fold 靠它做到
   * 「新事件到账即投影」，不必等下次启动回放）。只在写盘成功后触发 ——
   * 没落盘的条目不该进投影（重启后它本来就不存在）。
   */
  onAppended;
  constructor(dir, sessionId, report, now = Date.now, onAppended) {
    mkdirSync(dir, { recursive: true });
    this.filePathValue = join(dir, ledgerFileName(sessionId));
    this.now = now;
    this.report = report;
    this.onAppended = onAppended;
    if (existsSync(this.filePathValue)) {
      try {
        repairTruncatedTail(this.filePathValue);
      } catch (error) {
        this.safeReport(`台账截断修复失败：${this.filePathValue} —— ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const scan = existsSync(this.filePathValue) ? tryScan(this.filePathValue, (m) => this.safeReport(m)) : { maxSeq: 0, openRunId: void 0, openCompaction: void 0 };
    this.nextSeq = scan.maxSeq + 1;
    if (scan.openCompaction !== void 0) {
      this.append("compaction", compactSeal(scan.openCompaction));
    }
    if (scan.openRunId !== void 0) {
      this.append("run_end", { runId: scan.openRunId, reason: "interrupted" });
    }
  }
  get filePath() {
    return this.filePathValue;
  }
  /**
   * 上报通道的最后一公里：report（daemon 的 event-log 落盘）自己也会 IO 失败
   * （磁盘满 / 权限），那一刻不能再把异常抛回 run —— 退到 console 留现场。
   */
  safeReport(message) {
    try {
      this.report(message);
    } catch (error) {
      console.error(
        `[run-ledger] 上报通道失败：${message}（${error instanceof Error ? error.message : String(error)}）`
      );
    }
  }
  /**
   * 追加一条记录。写盘成功才消耗 seq（见文件头纪律 1）。
   * 任何失败（序列化 / IO）都经 report 上报后正常返回 —— 台账是观测不是业务。
   */
  append(kind, data) {
    let line;
    try {
      line = JSON.stringify({ seq: this.nextSeq, at: this.now(), kind, data });
    } catch (error) {
      this.safeReport(
        `台账条目序列化失败已丢弃（${kind}）：${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    try {
      appendFileSync(this.filePathValue, `${line}
`, "utf8");
    } catch (error) {
      this.safeReport(
        `台账写盘失败已丢弃（${kind}，${this.filePathValue}）：${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    this.nextSeq += 1;
    if (this.onAppended !== void 0) {
      try {
        this.onAppended(JSON.parse(line));
      } catch (error) {
        this.safeReport(
          `台账增量投影失败（${kind}）：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  /**
   * 台账链路之外、观测钩子自身的失败上报（如请求快照分类出错）。
   * 与内部失败同一个出口：进 event-log，不回抛炸 run。
   */
  reportFailure(message) {
    this.safeReport(message);
  }
  /**
   * 启动清扫：对目录下所有台账文件做中断合成闭合（run 与压缩各一份）。
   *
   * 冷会话（崩溃后还没被 resume 的）的孤儿 run 也要补上 —— 否则投影回放
   * （observability 的台账 fold）会把它们当成「至今仍在跑」。压缩的孤儿锁同理：
   * 不补，「有 start 没有 compaction」就只是一段谁也没读懂的痕迹。
   * 目录不存在（从没记过台账）是正常态，秒退。
   */
  static sealOrphans(dir, report) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return;
    }
    for (const file of files) {
      const path = join(dir, file);
      try {
        repairTruncatedTail(path);
      } catch (error) {
        report(file, `台账截断修复失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const scan = tryScan(path, (message) => report(file, message));
      if (scan.openRunId === void 0 && scan.openCompaction === void 0) continue;
      let seq2 = scan.maxSeq + 1;
      try {
        if (scan.openCompaction !== void 0) {
          appendFileSync(
            path,
            `${JSON.stringify({ seq: seq2, at: Date.now(), kind: "compaction", data: compactSeal(scan.openCompaction) })}
`,
            "utf8"
          );
          seq2 += 1;
        }
        if (scan.openRunId !== void 0) {
          appendFileSync(
            path,
            `${JSON.stringify({
              seq: seq2,
              at: Date.now(),
              kind: "run_end",
              data: { runId: scan.openRunId, reason: "interrupted" }
            })}
`,
            "utf8"
          );
        }
      } catch (error) {
        report(file, `台账合成闭合写盘失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export {
	HIDDEN_CONTEXT_CUSTOM_TYPE,
	RUNTIME_CONTEXT_CUSTOM_TYPE,
	RUN_TIME_CUSTOM_TYPE,
	RunLedger,
	TEAM_OUTPUT_CUSTOM_TYPE,
	THINKING_LEVELS,
	compactSeal,
	generatingLabel,
	isCompactionReason,
	isStreamingEvent,
	isThinkingLevel,
	ledgerFileName,
	listLedgerFiles,
	readLedgerEntries,
	repairTruncatedTail,
	scanLedgerFile,
	toolOutcomeFrom,
	tryScan,
};