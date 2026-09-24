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
import { buildMemorySection } from "./memory.js";
import { parseFrontmatter } from "./experts.js";
import { readMcpConfig } from "./mcp.js";

const PROJECT_CONFIG_DIR = ".pi";

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(dir, entry.name);
    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    try {
      const doc = parseFrontmatter(raw, filePath);
      out.push({
        name: basename(entry.name, ".md"),
        description: pickDescription(doc.frontmatter["description"], doc.body)
      });
    } catch {
      continue;
    }
  }
  return out;
}

function pickDescription(frontmatterValue, body) {
  if (typeof frontmatterValue === "string" && frontmatterValue !== "") {
    return frontmatterValue;
  }
  const firstLine = body.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine;
}

function listPromptTemplates(cwd, agentDir) {
  const globalTemplates = scanDir(join(agentDir, "prompts"));
  const projectTemplates = hasWorkspace(cwd) ? scanDir(join(cwd, PROJECT_CONFIG_DIR, "prompts")) : [];
  const byName = /* @__PURE__ */ new Map();
  for (const t of globalTemplates) byName.set(t.name, t);
  for (const t of projectTemplates) byName.set(t.name, t);
  return [...byName.values()];
}

function hasWorkspace(cwd) {
  return cwd !== void 0 && cwd !== "";
}

const ARTIFACT_TEXT_MAX = 512 * 1024;

function readSessionMcpConfig(cwd) {
  return readMcpConfig(cwd === "" ? void 0 : cwd);
}

function listSessionPromptTemplates(cwd, agentDir) {
  return listPromptTemplates(cwd === "" ? void 0 : cwd, agentDir);
}

function buildSessionMemorySection(cwd) {
  if (cwd === "") return void 0;
  return buildMemorySection(cwd);
}

function readSessionArtifact(cwd, path) {
  if (cwd === "") throw new Error("当前任务还没有工作目录，无法读取产物");
  const abs = resolve(cwd, path);
  if (abs !== cwd && !abs.startsWith(cwd + sep)) {
    throw new Error("路径超出当前工作区");
  }
  const stat2 = statSync(abs);
  const size = stat2.size;
  if (size > ARTIFACT_TEXT_MAX) return { size, text: void 0 };
  const buf = readFileSync(abs);
  if (buf.includes(0)) return { size, text: void 0 };
  return { size, text: buf.toString("utf8") };
}

function statSessionArtifact(cwd, path) {
  const abs = cwd === "" && !isAbsolute(path) ? void 0 : resolve(cwd, path);
  if (abs === void 0) return { kind: "missing" };
  try {
    return { kind: statSync(abs).isDirectory() ? "directory" : "file" };
  } catch {
    return { kind: "missing" };
  }
}

export {
	ARTIFACT_TEXT_MAX,
	PROJECT_CONFIG_DIR,
	buildSessionMemorySection,
	hasWorkspace,
	listPromptTemplates,
	listSessionPromptTemplates,
	pickDescription,
	readSessionArtifact,
	readSessionMcpConfig,
	scanDir,
	statSessionArtifact,
};