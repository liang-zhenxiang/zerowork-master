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
	LOCAL_READ_TOOLS,
	firstTokenPrefix,
	splitCommand,
} from "./permissions.js";

function canonicalizePath(path) {
  const absolute = resolve(path);
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
  let real;
  try {
    real = realpathSync.native(existing);
  } catch {
    return absolute;
  }
  if (real.toLowerCase() === existing.toLowerCase()) return absolute;
  const tail = relative(existing, absolute);
  return tail === "" ? real : join(real, tail);
}

function isPathContained(base, target) {
  const rel = relative(canonicalizePath(base), canonicalizePath(target));
  return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function matchesPrefix(segment, prefix) {
  const normalized = segment.trim().replace(/\s+/g, " ");
  return normalized === prefix || normalized.startsWith(`${prefix} `);
}

function evaluateCommand(command, tool, rules) {
  const segments = splitCommand(command);
  if (segments.length === 0) return { kind: "unmatched" };
  let allAllowed = true;
  for (const segment of segments) {
    let segmentAllowed = false;
    for (const rule of rules) {
      if (rule.tool !== tool) continue;
      if (!matchesPrefix(segment, rule.prefix)) continue;
      if (rule.action === "deny") {
        return {
          kind: "deny",
          reason: `命令段「${segment}」命中拒绝规则「${rule.tool}: ${rule.prefix}」`
        };
      }
      segmentAllowed = true;
    }
    if (!segmentAllowed) allAllowed = false;
  }
  return allAllowed ? { kind: "allow" } : { kind: "unmatched" };
}

const isInsidePath = isPathContained;

function evaluatePathRules(target, rules) {
  const resolvedTarget = resolve(target);
  let allowed = false;
  for (const rule of rules) {
    if (rule.tool !== "read") continue;
    if (!isAbsolute(rule.prefix)) continue;
    if (!isInsidePath(rule.prefix, resolvedTarget)) continue;
    if (rule.action === "deny") {
      return {
        kind: "deny",
        reason: `路径「${resolvedTarget}」命中拒绝规则「${rule.tool}: ${rule.prefix}」`
      };
    }
    allowed = true;
  }
  return allowed ? { kind: "allow" } : { kind: "unmatched" };
}

function rememberRuleFromApproval(toolName, response, guardDirs) {
  if (response.decision !== "allow") return void 0;
  const prefix = response.rememberPrefix;
  if (typeof prefix !== "string" || prefix === "") return void 0;
  if (toolName === "powershell") {
    if (firstTokenPrefix(prefix) !== prefix) return void 0;
    return { tool: "powershell", prefix, action: "allow" };
  }
  if (LOCAL_READ_TOOLS.has(toolName)) {
    if (!isAbsolute(prefix)) return void 0;
    if (guardDirs === void 0) return void 0;
    for (const dir of guardDirs) {
      if (isInsidePath(dir, prefix)) return void 0;
    }
    return { tool: "read", prefix: resolve(prefix), action: "allow" };
  }
  return void 0;
}

const CONFIG_AS_CODE_DIRS = /* @__PURE__ */ new Set([
  // pi 的项目级资源：扩展是 TS 模块、**加载即以本进程权限执行**；
  // settings 改加载行为；SYSTEM.md 是提示注入的持久落点。
  // 例外：`.pi/skills/**`（能力=数据，纯文本、加载时不执行）—— 见本段文件头判据。
  ".pi",
  // config（core.fsmonitor / alias 让 git status、git diff 执行任意命令，
  // git 2.55 实测）、hooks（**用户自己**提交时执行，逃出我们进程）。
  // 模型本来也不该用 write 工具直接改 .git —— 那是 git 命令的活儿。
  ".git",
  // workflows 逃到 CI runner 上执行。
  ".github",
  // tasks.json / launch.json 由编辑器执行。
  ".vscode"
]);

const CONFIG_AS_CODE_FILES = /* @__PURE__ */ new Set([
  // scripts → npm run / npm test 执行任意命令。
  "package.json",
  // 可改 registry 与安装行为（供应链入口）。
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  // direnv：进入目录**自动**执行，连命令都不需要。
  ".envrc",
  // make 执行其中的配方。
  "makefile",
  "gnumakefile"
]);

const CONFIG_AS_CODE_DIR_PAIRS = [
  // npm run 把这里加进 PATH 并调起其中的可执行文件。
  ["node_modules", ".bin"]
];

function isConfigAsCodePath(target) {
  return segmentsTouchConfigAsCode(target.toLowerCase().split(/[\\/]+/), false);
}

function commandTouchesConfigAsCode(command) {
  const segments = command.toLowerCase().split(/[\\/\s"'`=;,|&()<>{}\[\]]+/);
  return segmentsTouchConfigAsCode(segments, true);
}

function isSkillRootHead(segment, next) {
  return next === "skills" && (segment === ".pi" || segment === ".agents");
}

function segmentsTouchConfigAsCode(segments, filesAnywhere) {
  if (!filesAnywhere) {
    const fileName = segments[segments.length - 1];
    if (fileName !== void 0 && CONFIG_AS_CODE_FILES.has(fileName)) return true;
  }
  const escapesSkillRoot = segments.some((segment) => segment === "..");
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === void 0 || segment === "") continue;
    if (filesAnywhere && CONFIG_AS_CODE_FILES.has(segment)) return true;
    const skillRootHead = isSkillRootHead(segment, segments[i + 1]);
    if (skillRootHead && escapesSkillRoot) return true;
    if (!skillRootHead && CONFIG_AS_CODE_DIRS.has(segment) && i < segments.length - 1) {
      return true;
    }
    for (const [first, second] of CONFIG_AS_CODE_DIR_PAIRS) {
      if (segment === first && segments[i + 1] === second && i + 2 < segments.length) return true;
    }
  }
  return false;
}

function commandPositionPattern(verb) {
  const escaped = verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[\\s;&|(){}=])(?:[^\\s;&|(){}=]+[\\\\/])?${escaped}(?:\\.exe)?(?:[\\s;&|(){}]|$)`,
    "i"
  );
}

function anyPattern(pattern) {
  return new RegExp(pattern, "i");
}

const DELETE_VERBS = [
  // PowerShell cmdlet 与别名（`ri`/`rm`/`del`/`erase`/`rd`/`rmdir`/`rni`/`ren`/`mi`/`move`）
  "remove-item",
  "ri",
  "rm",
  "del",
  "erase",
  "rd",
  "rmdir",
  "clear-content",
  "clc",
  "clear-item",
  "cli",
  "remove-itemproperty",
  "rp",
  "remove-childitem",
  "move-item",
  "mi",
  "move",
  "mv",
  "rename-item",
  "rni",
  "ren",
  "rename",
  // cmd 系
  "erase",
  "deltree",
  // unix 系（bash 不在工具面里，但技能脚本可能间接用到，且判错方向安全）
  "unlink"
];

const DELETE_PATTERNS = [
  // .NET / Win32
  anyPattern("::delete\\s*\\("),
  anyPattern("\\.delete\\s*\\(\\s*\\)"),
  anyPattern("\\bdeletefile\\w*\\b"),
  anyPattern("\\bdeletedirectory\\w*\\b"),
  anyPattern("\\bremovedirectory\\w*\\b"),
  anyPattern("\\bfile\\.delete\\b"),
  anyPattern("\\bdirectory\\.delete\\b"),
  // Node / Python / shell 里的删除 API
  anyPattern("\\bunlink\\w*\\s*\\("),
  anyPattern("\\brmtree\\s*\\("),
  anyPattern("\\brmdir\\w*\\s*\\("),
  anyPattern("\\b(os|shutil|pathlib|fs|fsp|fs\\.promises)\\.(remove|unlink|rmdir|rm|rename|replace|move)\\b"),
  anyPattern("\\bfs\\.(unlink|rmdir|rm)(sync)?\\b"),
  anyPattern("\\bunlink(sync)?\\b"),
  anyPattern("\\brmsync\\b"),
  anyPattern("\\brmdirsync\\b"),
  // 回收站 API（也是"删除"）
  anyPattern("\\brecycleoption\\b"),
  anyPattern("\\bsendtorecyclebin\\b")
];

const GIT_DESTRUCTIVE = [
  commandPositionPattern("git")
].flatMap(() => [
  anyPattern("\\bgit\\s+clean\\b"),
  anyPattern("\\bgit\\s+rm\\b"),
  anyPattern("\\bgit\\s+restore\\b"),
  anyPattern("\\bgit\\s+checkout\\b"),
  anyPattern("\\bgit\\s+switch\\b"),
  anyPattern("\\bgit\\s+reset\\s+--hard\\b"),
  anyPattern("\\bgit\\s+stash\\s+(drop|clear)\\b"),
  anyPattern("\\bgit\\s+branch\\s+-[dD]\\b"),
  anyPattern("\\bgit\\s+tag\\s+-d\\b"),
  anyPattern("\\bgit\\s+worktree\\s+remove\\b"),
  anyPattern("\\bgit\\s+push\\b[^;|&]*--delete\\b")
]);

const WRITE_VERBS = [
  "set-content",
  "sc",
  "add-content",
  "ac",
  "out-file",
  "new-item",
  "ni",
  "mkdir",
  "md",
  "copy-item",
  "cpi",
  "copy",
  "cp",
  "xcopy",
  "robocopy",
  "tee-object",
  "tee",
  "touch",
  "export-csv",
  "export-clixml",
  "set-item",
  "si",
  "set-itemproperty",
  "sp",
  "new-itemproperty",
  "set-acl",
  "icacls",
  "attrib",
  "takeown",
  "chmod",
  "chown"
];

const WRITE_PATTERNS = [
  // 重定向（按 shell 重定向的常规写法：`>`/`>>`，但排除 `->`、`=>` 这类）
  anyPattern("(^|[^->=])>{1,2}([^>&]|$)"),
  // .NET / 文件 API
  anyPattern("\\bwritealltext\\w*\\b"),
  anyPattern("\\bwriteallbytes\\w*\\b"),
  anyPattern("\\bwritealllines\\w*\\b"),
  anyPattern("\\bappendalltext\\w*\\b"),
  anyPattern("\\bappendalllines\\w*\\b"),
  anyPattern("\\bcreatedirectory\\w*\\b"),
  anyPattern("\\bwritefile\\w*\\b"),
  anyPattern("\\bwritefilesync\\b"),
  anyPattern("\\bappendfilesync\\b"),
  anyPattern("\\b(open|creat|savefig|to_csv|to_excel|to_json|dump)\\s*\\("),
  anyPattern("\\b(os|shutil|fs|fsp)\\.(mkdir|makedirs|copy|copyfile|copy2|copytree)\\b"),
  anyPattern("\\bpath\\.mkdir\\b"),
  // PowerShell 里"把内容写出去"的参数写法（`iwr ... -OutFile x`、`... | Out-File x`）
  anyPattern("-outfile\\b")
];

const READ_VERBS = [
  // PowerShell 读取/查看类（`get-` 前缀由下面的规则统一覆盖）
  "test-path",
  "test-connection",
  "select-string",
  "select-object",
  "select-xml",
  "measure-object",
  "compare-object",
  "where-object",
  "sort-object",
  "group-object",
  "out-string",
  "out-host",
  "convertto-json",
  "convertfrom-json",
  "convertto-csv",
  "convertfrom-csv",
  "convertto-xml",
  "import-csv",
  "import-clixml",
  "write-output",
  "write-host",
  // unix 系读取（同一份名单服务于 bash 场景与技能脚本）
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "find",
  "findstr",
  "wc",
  "stat",
  "file",
  "pwd",
  "echo",
  "which"
];

const OPAQUE_PATTERNS = [
  // 编码/内联代码
  anyPattern("-encodedcommand\\b"),
  anyPattern("(^|[\\s;&|(){}=])-enc\\b"),
  anyPattern("\\b(pwsh|powershell)(\\.exe)?\\b[^;|&]*\\s-(e|command|c)\\b"),
  anyPattern("\\b(python3?|py)\\s+-c\\b"),
  anyPattern("\\b(node|deno|bun)\\s+(-e|--eval)\\b"),
  anyPattern("\\b(perl|ruby|php)\\s+-e\\b"),
  anyPattern("\\b(cmd|cmd\\.exe)\\s+/c\\b"),
  anyPattern("\\b(bash|sh|zsh|wsl)(\\.exe)?\\s+(-c|-Command)\\b"),
  anyPattern("\\b(iex|invoke-expression|invoke-command|icm)\\b"),
  anyPattern("\\bstart-process\\b"),
  anyPattern("\\badd-type\\b"),
  anyPattern("\\[scriptblock\\]"),
  anyPattern("\\bnew-object\\b"),
  anyPattern("-comobject\\b"),
  anyPattern("\\b(mshta|rundll32|regsvr32|certutil|bitsadmin)\\b")
];

const SCRIPT_EXTENSION = /\.(ps1|psm1|bat|cmd|vbs|vbe|js|mjs|cjs|py|sh|pl|rb|wsf|hta|scr)$/iu;

const INTERPRETER = /^(python|py|node|deno|bun|perl|ruby|php|bash|sh|zsh|pwsh|powershell|cmd)[\w.]*(\.exe)?$/iu;

function isScriptExecution(command) {
  for (const segment of command.split(/[;&|]+/u)) {
    const tokens = segment.split(/[\s"'`(){}]+/u).filter((token) => token !== "");
    for (const [index, token] of tokens.entries()) {
      if (index === 0 && SCRIPT_EXTENSION.test(token)) return true;
      if (INTERPRETER.test(token) && tokens.slice(index + 1).some((rest) => SCRIPT_EXTENSION.test(rest))) {
        return true;
      }
    }
  }
  return false;
}

function matchesCommandPosition(command, verbs) {
  return verbs.some((verb) => commandPositionPattern(verb).test(command));
}

function classifyCommandOperation(command) {
  if (command.trim() === "") return "access";
  if (matchesCommandPosition(command, DELETE_VERBS)) return "delete";
  if (DELETE_PATTERNS.some((pattern) => pattern.test(command))) return "delete";
  if (GIT_DESTRUCTIVE.some((pattern) => pattern.test(command))) return "delete";
  if (matchesCommandPosition(command, WRITE_VERBS)) return "write";
  if (WRITE_PATTERNS.some((pattern) => pattern.test(command))) return "write";
  if (/(?:^|[\s;&|(){}=])get-[a-z]/i.test(command)) return "read";
  if (matchesCommandPosition(command, READ_VERBS)) return "read";
  return "access";
}

function isOpaqueCommand(command) {
  return OPAQUE_PATTERNS.some((pattern) => pattern.test(command)) || isScriptExecution(command);
}

function extractPathCandidates(command) {
  const out = [];
  for (const segment of command.split(/[;&|]+/u)) {
    const tokens = segment.split(/[\s"'`(){}]+/u).map((token) => token.replace(/^[=,]+/u, "").replace(/[,;]+$/u, "")).filter((token) => token !== "");
    for (const token of tokens.slice(1)) {
      if (/^\/[A-Za-z]$/u.test(token)) continue;
      if (/^-/u.test(token)) continue;
      if (/^[<>&|]+$/u.test(token)) continue;
      out.push(token);
    }
  }
  return out;
}

function defaultProtectedDirs(homeDir) {
  return [
    resolve(homeDir, ".ssh"),
    // SSH 私钥
    resolve(homeDir, ".gnupg"),
    // GPG 私钥
    resolve(homeDir, ".aws"),
    // 云凭据
    resolve(homeDir, ".kube"),
    // 集群凭据
    resolve(homeDir, ".docker"),
    // registry 凭据
    resolve(homeDir, ".npmrc"),
    // npm token（文件，isInside 同样成立）
    resolve(homeDir, ".git-credentials"),
    resolve(homeDir, ".pi", "agent")
    // pi 自己的 auth.json
  ];
}

const CONFIG_EXECUTABLE_SUBDIRS = ["skills", "experts", "agents", "runtimes"];

export {
	CONFIG_AS_CODE_DIRS,
	CONFIG_AS_CODE_DIR_PAIRS,
	CONFIG_AS_CODE_FILES,
	CONFIG_EXECUTABLE_SUBDIRS,
	DELETE_PATTERNS,
	DELETE_VERBS,
	GIT_DESTRUCTIVE,
	INTERPRETER,
	OPAQUE_PATTERNS,
	READ_VERBS,
	SCRIPT_EXTENSION,
	WRITE_PATTERNS,
	WRITE_VERBS,
	anyPattern,
	canonicalizePath,
	classifyCommandOperation,
	commandPositionPattern,
	commandTouchesConfigAsCode,
	defaultProtectedDirs,
	evaluateCommand,
	evaluatePathRules,
	extractPathCandidates,
	isConfigAsCodePath,
	isInsidePath,
	isOpaqueCommand,
	isPathContained,
	isScriptExecution,
	isSkillRootHead,
	matchesCommandPosition,
	matchesPrefix,
	rememberRuleFromApproval,
	segmentsTouchConfigAsCode,
};