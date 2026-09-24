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
import { getConfigDir } from "./config-paths.js";

const AUDIT_PANEL_LIMIT = 200;

const AUDIT_CATEGORY_LABELS = {
  command: "命令安全",
  sandbox: "沙箱",
  runtime: "运行时",
  audit: "审计管理"
};

const AUDIT_OUTCOME_LABELS = {
  blocked: "已拦截",
  allowed: "已放行",
  failed: "失败",
  disabled: "已禁用",
  cleared: "已清空"
};

const AUDIT_CATEGORIES = ["command", "sandbox", "runtime", "audit"];

function isAuditCategory(value) {
  return typeof value === "string" && AUDIT_CATEGORIES.includes(value);
}

const AUDIT_DETAIL_MAX = 240;

function clipAuditDetail(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= AUDIT_DETAIL_MAX ? oneLine : `${oneLine.slice(0, AUDIT_DETAIL_MAX)}…`;
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatAuditTime(ts) {
  const at = new Date(ts);
  return `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
}

function auditLine(record) {
  return `[${AUDIT_CATEGORY_LABELS[record.category]}] ${AUDIT_OUTCOME_LABELS[record.outcome]} · ${record.detail}`;
}

function renderAuditRecords(records, exportedAt) {
  const lines = [
    "ZeroWork 审计日志",
    `导出时间：${new Date(exportedAt).toLocaleString()}`,
    `记录数：${records.length}（按时间正序；面板只显示最近 ${AUDIT_PANEL_LIMIT} 条）`,
    ""
  ];
  if (records.length === 0) {
    lines.push("（无记录）");
    return lines.join("\n");
  }
  for (const record of records) lines.push(`${formatAuditTime(record.ts)}  ${auditLine(record)}`);
  return lines.join("\n");
}

const AUDIT_FILE_RE = /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/;

function auditLogDir() {
  return join(getConfigDir(), "logs", "audit");
}

function writeAuditRecord(input, dir = auditLogDir()) {
  const record = { ts: Date.now(), ...input };
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(recordFile(dir, record.ts), `${JSON.stringify(record)}
`, "utf8");
  } catch (error) {
    console.error(
      `[audit-log] 审计写盘失败（${input.category}/${input.outcome}）：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function recordFile(dir, ts) {
  return join(dir, `audit-${new Date(ts).toISOString().slice(0, 10)}.jsonl`);
}

function auditFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => AUDIT_FILE_RE.test(name)).sort().map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function parseRecord(line) {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return void 0;
    const record = parsed;
    const { ts, category, outcome, detail } = record;
    if (typeof ts !== "number" || typeof detail !== "string") return void 0;
    if (typeof category !== "string" || !(category in AUDIT_CATEGORY_LABELS)) return void 0;
    if (typeof outcome !== "string" || !(outcome in AUDIT_OUTCOME_LABELS)) return void 0;
    return { ts, category, outcome, detail };
  } catch {
    return void 0;
  }
}

function readAuditRecords(query = {}) {
  const dir = query.dir ?? auditLogDir();
  const all = [];
  for (const file of auditFiles(dir)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const record = parseRecord(line);
      if (record === void 0) continue;
      all.push(record);
    }
  }
  const filtered = query.category === void 0 ? all : all.filter((record) => record.category === query.category);
  return {
    records: query.limit === void 0 ? filtered : filtered.slice(-query.limit),
    total: filtered.length
  };
}

function clearAuditRecords(dir = auditLogDir()) {
  const removed = readAuditRecords({ dir }).total;
  for (const file of auditFiles(dir)) {
    try {
      rmSync(file, { force: true });
    } catch (error) {
      console.error(
        `[audit-log] 审计记录删除失败：${file} —— ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  writeAuditRecord(
    {
      category: "audit",
      outcome: "cleared",
      detail: `已清空 ${removed} 条审计记录（本条是清空动作本身留下的痕迹）`
    },
    dir
  );
  return removed;
}

function exportAuditRecords(dir = auditLogDir(), now = Date.now()) {
  const { records } = readAuditRecords({ dir });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `audit-export-${stamp}.txt`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${renderAuditRecords(records, now)}
`, "utf8");
  return { path, count: records.length };
}

export {
	AUDIT_CATEGORIES,
	AUDIT_CATEGORY_LABELS,
	AUDIT_DETAIL_MAX,
	AUDIT_FILE_RE,
	AUDIT_OUTCOME_LABELS,
	AUDIT_PANEL_LIMIT,
	auditFiles,
	auditLine,
	auditLogDir,
	clearAuditRecords,
	clipAuditDetail,
	exportAuditRecords,
	formatAuditTime,
	isAuditCategory,
	pad2,
	parseRecord,
	readAuditRecords,
	recordFile,
	renderAuditRecords,
	writeAuditRecord,
};