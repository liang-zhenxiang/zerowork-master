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

const SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access"
];

const APPROVAL_POLICIES = ["ask", "never"];

const PERMISSION_PRESETS = [
  {
    id: "readonly",
    label: "只读",
    description: "只看不改：可以读取与搜索；命令只在只读档下执行，删除、写入、移动类命令与内联代码 / 脚本文件一律被拒（确需动手可就单条命令申请一次授权）。",
    sandbox: "read-only",
    approval: "ask"
  },
  {
    id: "default",
    label: "默认权限",
    description: "工作空间内自由读写；要动工作空间之外的文件时询问你。",
    sandbox: "workspace-write",
    approval: "ask"
  },
  {
    id: "full",
    label: "允许完全访问",
    description: "不限制文件范围，且不再逐次询问。凭据目录仍然受保护。",
    sandbox: "danger-full-access",
    approval: "never"
  }
];

const CUSTOM_PRESET = "custom";

const DEFAULT_PERMISSIONS = {
  sandbox: "workspace-write",
  approval: "ask",
  presetId: "default"
};

function presetIdFor(sandbox, approval) {
  const hit = PERMISSION_PRESETS.find((p) => p.sandbox === sandbox && p.approval === approval);
  return hit?.id ?? CUSTOM_PRESET;
}

function isSandboxMode(value) {
  return SANDBOX_MODES.includes(value);
}

function isApprovalPolicy(value) {
  return APPROVAL_POLICIES.includes(value);
}

const WIDER_MODES = {
  "read-only": ["workspace-write", "danger-full-access"],
  "workspace-write": ["danger-full-access"],
  "danger-full-access": []
};

function canEscalate(from, to) {
  return WIDER_MODES[from].includes(to);
}

const ESCALATION_TARGETS = ["workspace-write", "danger-full-access"];

function validateEscalationArgs(sandboxPermissions, justification) {
  if (sandboxPermissions !== void 0 && justification === void 0) {
    return "申请提权（sandbox_permissions）必须同时给出 justification —— 审批弹窗要把理由原样展示给用户。";
  }
  if (justification !== void 0 && sandboxPermissions === void 0) {
    return "justification 只能与 sandbox_permissions 一起使用。";
  }
  if (justification !== void 0 && justification.trim() === "") {
    return "justification 不能为空，请用一句话说明为什么这条命令需要更宽的权限。";
  }
  return void 0;
}

function resolveAsk(policy) {
  return policy === "ask" ? "ask" : "deny";
}

function willAskUser(settings, unattended = false) {
  if (unattended) return false;
  return resolveAsk(settings.approval) === "ask";
}

function isGranted(outcome) {
  return outcome === "allowed-once";
}

function normalizeApprovalOutcome(response) {
  if (typeof response !== "object" || response === null) return "unavailable";
  const decision = response.decision;
  if (decision === "allow") return "allowed-once";
  if (decision === "deny") return "rejected";
  return "unavailable";
}

const LOCAL_READ_TOOLS = /* @__PURE__ */ new Set([
  "read",
  "read_document",
  "find",
  "grep",
  "ls"
]);

function parseRulesFile(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const rules = parsed.rules;
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (const row of rules) {
    if (typeof row !== "object" || row === null) continue;
    const record = row;
    const tool = record["tool"];
    const prefix = record["prefix"];
    const action = record["action"];
    if (typeof tool !== "string" || tool === "") continue;
    if (typeof prefix !== "string" || prefix.trim() === "") continue;
    if (action !== "allow" && action !== "deny") continue;
    out.push({ tool, prefix, action });
  }
  return out;
}

function splitCommand(command) {
  const segments = [];
  let current = "";
  let quote;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed !== "") segments.push(trimmed);
    current = "";
  };
  let i = 0;
  while (i < command.length) {
    const ch = command.charAt(i);
    if (quote !== void 0) {
      if (ch === quote) quote = void 0;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ";") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "&" && command.charAt(i + 1) === "&" || ch === "|" && command.charAt(i + 1) === "|") {
      flush();
      i += 2;
      continue;
    }
    current += ch;
    i += 1;
  }
  flush();
  return segments;
}

const INTERPRETER_TOKENS = /* @__PURE__ */ new Set([
  "powershell",
  "pwsh",
  "cmd",
  "iex",
  "irm",
  "python",
  "python3",
  "node",
  "npm",
  "npx",
  "bash",
  "sh",
  "wsl"
]);

const INLINE_SCRIPT_FLAGS = /* @__PURE__ */ new Set(["-c", "-e", "-command", "-encodedcommand"]);

function firstTokenPrefix(command) {
  const segments = splitCommand(command);
  if (segments.length !== 1) return void 0;
  const segment = segments[0];
  if (segment === void 0) return void 0;
  const spaceAt = segment.search(/\s/);
  const first = spaceAt === -1 ? segment : segment.slice(0, spaceAt);
  if (first === "") return void 0;
  const bare = first.toLowerCase().replace(/\.exe$/, "");
  if (INTERPRETER_TOKENS.has(bare)) return void 0;
  const rest = spaceAt === -1 ? "" : segment.slice(spaceAt).trimStart();
  const second = rest.split(/\s/, 1)[0]?.toLowerCase() ?? "";
  if (INLINE_SCRIPT_FLAGS.has(second)) return void 0;
  return first;
}

function permissionRulesPath() {
  return join(getConfigDir(), "permissions.rules.json");
}

function loadPermissionRules(warn = () => void 0) {
  const path = permissionRulesPath();
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    warn(`权限规则文件读取失败，本次按空规则集降级：${path}`);
    return [];
  }
  try {
    JSON.parse(text);
  } catch {
    warn(`权限规则文件不是合法 JSON，本次按空规则集降级：${path}`);
    return [];
  }
  return parseRulesFile(text);
}

function appendPermissionRule(rule, rules) {
  const exists = rules.some(
    (r) => r.tool === rule.tool && r.prefix === rule.prefix && r.action === rule.action
  );
  return exists ? rules : [...rules, rule];
}

function savePermissionRules(rules) {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(permissionRulesPath(), `${JSON.stringify({ version: 1, rules }, null, 2)}
`, "utf8");
}

export {
	APPROVAL_POLICIES,
	CUSTOM_PRESET,
	DEFAULT_PERMISSIONS,
	ESCALATION_TARGETS,
	INLINE_SCRIPT_FLAGS,
	INTERPRETER_TOKENS,
	LOCAL_READ_TOOLS,
	PERMISSION_PRESETS,
	SANDBOX_MODES,
	WIDER_MODES,
	appendPermissionRule,
	canEscalate,
	firstTokenPrefix,
	isApprovalPolicy,
	isGranted,
	isSandboxMode,
	loadPermissionRules,
	normalizeApprovalOutcome,
	parseRulesFile,
	permissionRulesPath,
	presetIdFor,
	resolveAsk,
	savePermissionRules,
	splitCommand,
	validateEscalationArgs,
	willAskUser,
};