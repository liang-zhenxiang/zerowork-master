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
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
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
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { getConfigDir } from "./config-paths.js";
import { removeWorktree } from "./automation-tools.js";

const TEAM_STORE_VERSION = 1;

function safeDirName(teamName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(teamName)) {
    throw new Error(`团队名「${teamName}」不能用于落盘：只允许字母、数字、-、_、.（它也是目录名）`);
  }
  return teamName;
}

function teamsRootDir(configDir) {
  return join(configDir, "teams");
}

function teamDir(configDir, teamName) {
  return join(teamsRootDir(configDir), safeDirName(teamName));
}

function writeTeam(configDir, team) {
  const dir = teamDir(configDir, team.name);
  mkdirSync(dir, { recursive: true });
  const payload = { ...team, version: TEAM_STORE_VERSION };
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(payload, null, 2)}
`, "utf8");
}

function removeTeam(configDir, teamName) {
  rmSync(teamDir(configDir, teamName), { recursive: true, force: true });
}

function readTeams(configDir) {
  const root = teamsRootDir(configDir);
  if (!existsSync(root)) return [];
  const teams = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = join(root, entry.name, "config.json");
    if (!existsSync(file)) continue;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed.version !== TEAM_STORE_VERSION) {
      throw new Error(
        `团队文件版本不认识：${file}（版本 ${String(parsed.version)}，本程序是 ${TEAM_STORE_VERSION}）`
      );
    }
    teams.push(parsed);
  }
  return teams;
}

function autoSessionDirName(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function isAutoSessionDirName(name) {
  return /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(name);
}

function validateWorkspacePath(path) {
  if (!isAbsolute(path)) return "工作空间必须是绝对路径";
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return void 0;
  }
  if (!stats.isDirectory()) return "该路径已存在且不是目录";
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
  } catch {
    return "该路径不可访问（权限不足）";
  }
  return void 0;
}

const ILLEGAL_NAME_CHARS$1 = /[\\/:*?"<>|\u0000-\u001f]/;

function createWorkspace(root, name) {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("工作空间名称不能为空");
  if (ILLEGAL_NAME_CHARS$1.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`工作空间名称含非法字符：${trimmed}`);
  }
  if (trimmed.length > 64) throw new Error("工作空间名称过长（最多 64 字符）");
  mkdirSync(root, { recursive: true });
  const target = join(root, trimmed);
  if (existsSync(target)) throw new Error(`工作空间「${trimmed}」已存在`);
  mkdirSync(target);
  return target;
}

function listWorkspaces(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name)).sort((a, b) => a.localeCompare(b));
}

const MAX_SESSION_DIR_ATTEMPTS = 100;

function createSessionDir(root, now) {
  mkdirSync(root, { recursive: true });
  const base = /* @__PURE__ */ new Date();
  for (let attempt = 0; attempt < MAX_SESSION_DIR_ATTEMPTS; attempt += 1) {
    const candidate = join(root, autoSessionDirName(new Date(base.getTime() + attempt * 1e3)));
    if (existsSync(candidate)) continue;
    mkdirSync(candidate);
    return candidate;
  }
  throw new Error(
    `无法在 ${root} 下创建唯一的时间戳会话目录（${MAX_SESSION_DIR_ATTEMPTS} 次尝试均冲突）`
  );
}

function getPath() {
  return join(getConfigDir(), "workspaces.json");
}

function readDisplayNames() {
  let raw;
  try {
    raw = readFileSync(getPath(), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const record = parsed;
    const result = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value !== "") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeDisplayNames(names) {
  const path = getPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(names, null, 2)}
`, "utf8");
}

function setDisplayName(path, name) {
  const names = readDisplayNames();
  names[path] = name;
  writeDisplayNames(names);
}

function removeDisplayName(path) {
  const names = readDisplayNames();
  if (!(path in names)) return;
  delete names[path];
  writeDisplayNames(names);
}

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;

const RESERVED_NAMES = /* @__PURE__ */ new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

function validateDisplayName(name, siblings) {
  const trimmed = name.trim();
  if (trimmed === "") return "名称不能为空";
  if (ILLEGAL_NAME_CHARS.test(trimmed)) {
    return '名称不能包含以下字符：\\ / : * ? " < > |';
  }
  if (trimmed.length > 255) return "名称过长（最多 255 字符）";
  const lowered = trimmed.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === lowered)) {
    return `已存在同名空间「${trimmed}」`;
  }
  if (RESERVED_NAMES.has(lowered)) return `「${trimmed}」是系统保留名称，不能使用`;
  return void 0;
}

const WORKTREE_DIR_NAME = "worktrees";

const TASK_BRANCH_PREFIX = "zerowork/";

function slugifyBranch(branch) {
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "worktree" : slug;
}

function generateWorktreeUid(rand = Math.random) {
  return Math.floor(rand() * 4294967296).toString(16).padStart(8, "0").slice(0, 8);
}

function buildBranchId(baseBranch, uid) {
  return `${slugifyBranch(baseBranch)}-${uid}`;
}

function buildTaskBranch(baseBranch, uid) {
  return `${TASK_BRANCH_PREFIX}${buildBranchId(baseBranch, uid)}`;
}

function taskBranchFromBranchId(branchId) {
  return `${TASK_BRANCH_PREFIX}${branchId}`;
}

function repoDirName(repoCwd) {
  const trimmed = repoCwd.replace(/[/\\]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  const base = at === -1 ? trimmed : trimmed.slice(at + 1);
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  return safe === "" ? "workspace" : safe;
}

function requireBranchName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("分支名必须是非空字符串");
  }
  const name = value.trim();
  if (name.startsWith("-")) throw new Error(`分支名不能以 - 开头：${name}`);
  if (/[\s~^:?*[\\\u0000-\u001F]/.test(name)) {
    throw new Error(`分支名含非法字符：${name}`);
  }
  if (name.endsWith("/") || name.endsWith(".lock") || name.includes("..")) {
    throw new Error(`分支名形态非法：${name}`);
  }
  return name;
}

const MAX_BUFFER = 8 * 1024 * 1024;

function getWorktreeRoot() {
  return join(getConfigDir(), WORKTREE_DIR_NAME);
}

function gitOutcome(args, cwd) {
  return new Promise((resolve2) => {
    execFile(
      "git",
      ["-c", "core.quotepath=false", ...args],
      { cwd, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolve2({ ok: false, stdout: "", stderr: stderr === "" ? error.message : stderr });
          return;
        }
        resolve2({ ok: true, stdout, stderr });
      }
    );
  });
}

async function runGit(args, cwd) {
  const outcome = await gitOutcome(args, cwd);
  if (!outcome.ok) {
    const detail = outcome.stderr.trim() === "" ? "" : `：${outcome.stderr.trim()}`;
    throw new Error(`git ${args.join(" ")} 失败${detail}`);
  }
  return outcome.stdout;
}

async function isGitRepo(cwd) {
  if (cwd === "") return false;
  const outcome = await gitOutcome(["rev-parse", "--is-inside-work-tree"], cwd);
  return outcome.ok && outcome.stdout.trim() === "true";
}

async function resolveRepoRoot(cwd) {
  const outcome = await gitOutcome(["rev-parse", "--show-toplevel"], cwd);
  if (!outcome.ok) return void 0;
  const root = outcome.stdout.trim();
  return root === "" ? void 0 : root;
}

async function getCurrentBranch(cwd) {
  const outcome = await gitOutcome(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!outcome.ok) return void 0;
  const branch = outcome.stdout.trim();
  return branch === "" || branch === "HEAD" ? void 0 : branch;
}

async function listLocalBranches(cwd) {
  const outcome = await gitOutcome(
    ["for-each-ref", "--format=%(refname:short)", "--sort=refname", "refs/heads"],
    cwd
  );
  if (!outcome.ok) return [];
  return outcome.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

async function getBranchList(cwd) {
  if (!await isGitRepo(cwd)) {
    return { isGitRepo: false, branches: [], currentBranch: void 0 };
  }
  const [branches, currentBranch] = await Promise.all([
    listLocalBranches(cwd),
    getCurrentBranch(cwd)
  ]);
  return { isGitRepo: true, branches, currentBranch };
}

function worktreeInfoFromCwd(cwd) {
  if (!isWorktreePath(cwd)) return void 0;
  const root = normalize$1(getWorktreeRoot()).replace(/\\/g, "/").replace(/\/+$/, "");
  const target = normalize$1(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = target.slice(root.length + 1).split("/").filter((part) => part !== "");
  if (parts.length !== 2) return void 0;
  const branchId = parts[1];
  if (branchId === void 0 || branchId === "") return void 0;
  return { worktreePath: cwd, taskBranch: taskBranchFromBranchId(branchId) };
}

function isWorktreePath(cwd) {
  if (cwd === "") return false;
  const root = normalize$1(getWorktreeRoot()).replace(/\\/g, "/").replace(/\/+$/, "");
  const target = normalize$1(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  return target.startsWith(`${root}/`);
}

async function createWorktree(options) {
  const repoRoot = await resolveRepoRoot(options.repoCwd) ?? options.repoCwd;
  const uid = options.uid ?? generateWorktreeUid();
  const branchId = buildBranchId(options.baseBranch, uid);
  const taskBranch = buildTaskBranch(options.baseBranch, uid);
  const root = options.rootDir ?? getWorktreeRoot();
  const worktreePath = join(root, repoDirName(repoRoot), branchId);
  await mkdir(dirname(worktreePath), { recursive: true });
  try {
    await runGit(
      ["worktree", "add", "-b", taskBranch, worktreePath, options.baseBranch],
      repoRoot
    );
  } catch (error) {
    await removeWorktree(repoRoot, worktreePath).catch(() => void 0);
    await rm(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
      () => void 0
    );
    throw error instanceof Error ? error : new Error(String(error));
  }
  return { worktreePath, taskBranch, baseBranch: options.baseBranch, sourceCwd: repoRoot };
}

export {
	ILLEGAL_NAME_CHARS,
	ILLEGAL_NAME_CHARS$1,
	MAX_BUFFER,
	MAX_SESSION_DIR_ATTEMPTS,
	RESERVED_NAMES,
	TASK_BRANCH_PREFIX,
	TEAM_STORE_VERSION,
	WORKTREE_DIR_NAME,
	autoSessionDirName,
	buildBranchId,
	buildTaskBranch,
	createSessionDir,
	createWorkspace,
	createWorktree,
	generateWorktreeUid,
	getBranchList,
	getCurrentBranch,
	getPath,
	getWorktreeRoot,
	gitOutcome,
	isAutoSessionDirName,
	isGitRepo,
	isWorktreePath,
	listLocalBranches,
	listWorkspaces,
	readDisplayNames,
	readTeams,
	removeDisplayName,
	removeTeam,
	repoDirName,
	requireBranchName,
	resolveRepoRoot,
	runGit,
	safeDirName,
	setDisplayName,
	slugifyBranch,
	taskBranchFromBranchId,
	teamDir,
	teamsRootDir,
	validateDisplayName,
	validateWorkspacePath,
	worktreeInfoFromCwd,
	writeDisplayNames,
	writeTeam,
};