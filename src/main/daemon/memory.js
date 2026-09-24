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

function userMemoryPath() {
  return join(getConfigDir(), "MEMORY.md");
}

function profilePath() {
  return join(getConfigDir(), "PROFILE.md");
}

function ensureUserMemoryFiles() {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  for (const path of [userMemoryPath(), profilePath()]) {
    try {
      writeFileSync(path, "", { encoding: "utf8", flag: "wx" });
    } catch {
    }
  }
}

function workspaceMemoryDir(cwd) {
  return join(cwd, ".zerowork", "memory");
}

function loadMemorySystemPrompt(resourcesDir) {
  return readTextOrUndefined(join(resourcesDir, "prompts", "memory-system.md"));
}

const LOG_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;

const RECENT_LOG_LIMIT = 3;

function buildMemorySection(cwd) {
  const sections = [];
  const userMemory = readTextOrUndefined(userMemoryPath());
  if (userMemory !== void 0) {
    sections.push(`## 长期记忆（用户级）

${userMemory}`);
  }
  const profile = readTextOrUndefined(profilePath());
  if (profile !== void 0) {
    sections.push(`## 用户画像

${profile}`);
  }
  const wsDir = workspaceMemoryDir(cwd);
  const projectMemory = readTextOrUndefined(join(wsDir, "MEMORY.md"));
  if (projectMemory !== void 0) {
    sections.push(`## 本项目记忆

${projectMemory}`);
  }
  const recentLogs = listRecentLogs(wsDir);
  if (recentLogs.length > 0) {
    sections.push(
      `### 近期日志（按需读取）

以下是本项目最近的工作日志（位于 ${wsDir}），需要细节时用 read 查看：
${recentLogs.map((name) => `- ${name}`).join("\n")}`
    );
  }
  return sections.length === 0 ? void 0 : sections.join("\n\n");
}

function readTextOrUndefined(path) {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text === "" ? void 0 : text;
  } catch {
    return void 0;
  }
}

function memoryReminder(cwd) {
  const wsDir = workspaceMemoryDir(cwd);
  const hasProfile = readTextOrUndefined(profilePath()) !== void 0;
  const hasUserMemory = readTextOrUndefined(userMemoryPath()) !== void 0;
  const hasProjectMemory = readTextOrUndefined(join(wsDir, "MEMORY.md")) !== void 0;
  const recentLogs = listRecentLogs(wsDir);
  if (!hasProfile && !hasUserMemory && !hasProjectMemory && recentLogs.length === 0) {
    return void 0;
  }
  const lines = [];
  if (hasProfile) lines.push(`用户画像：${profilePath()}`);
  if (hasUserMemory) lines.push(`用户级长期记忆：${userMemoryPath()}`);
  if (hasProjectMemory || recentLogs.length > 0) {
    lines.push(
      `项目记忆目录：${wsDir}${recentLogs.length > 0 ? `（最近日志：${recentLogs.join("、")}）` : ""}`
    );
  }
  lines.push("细节用 read 按需查看；完成值得记录的工作后，把要点追加进对应记忆文件。");
  return lines.join("\n");
}

function listRecentLogs(wsDir) {
  try {
    return readdirSync(wsDir).filter((name) => LOG_FILE.test(name)).sort().reverse().slice(0, RECENT_LOG_LIMIT);
  } catch {
    return [];
  }
}

export {
	LOG_FILE,
	RECENT_LOG_LIMIT,
	buildMemorySection,
	ensureUserMemoryFiles,
	listRecentLogs,
	loadMemorySystemPrompt,
	memoryReminder,
	profilePath,
	readTextOrUndefined,
	userMemoryPath,
	workspaceMemoryDir,
};