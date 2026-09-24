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
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { parseFrontmatter as parseFrontmatter$1 } from "@earendil-works/pi-coding-agent";
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

const FENCE = "---";

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fileLineSuffix(error) {
  if (typeof error !== "object" || error === null || !("linePos" in error)) return "";
  const linePos = error.linePos;
  if (!Array.isArray(linePos)) return "";
  const first = linePos[0];
  if (typeof first !== "object" || first === null) return "";
  const line = first.line;
  return typeof line === "number" && Number.isInteger(line) && line >= 1 ? `:${line + 1}` : "";
}

function shapeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组";
  return typeof value;
}

function parseFrontmatter(source, label) {
  const text = source.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  if (!text.startsWith(`${FENCE}
`)) {
    return { frontmatter: {}, body: text.trim() };
  }
  if (text.indexOf(`
${FENCE}`, FENCE.length) === -1) {
    throw new Error(`${label}: frontmatter 缺少结束的 --- 分隔线`);
  }
  let frontmatter;
  let body;
  try {
    const parsed = parseFrontmatter$1(text);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch (error) {
    throw new Error(`${label}${fileLineSuffix(error)}: frontmatter 不是合法 YAML：${reasonOf(error)}`);
  }
  const runtimeValue = frontmatter;
  if (typeof runtimeValue !== "object" || runtimeValue === null || Array.isArray(runtimeValue)) {
    throw new Error(
      `${label}: frontmatter 必须是 key: value 形式，实际解析出 ${shapeName(runtimeValue)}`
    );
  }
  for (const key of Object.keys(runtimeValue)) {
    if (key === "") throw new Error(`${label}: frontmatter 有空的键名，应为 key: value 形式`);
  }
  return { frontmatter, body };
}

function isStringArray(value) {
  return value.every((item) => typeof item === "string");
}

function requireString(doc, key, label) {
  const value = doc.frontmatter[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label}: frontmatter 缺少字符串字段「${key}」`);
  }
  return value;
}

function optionalString(doc, key, label) {
  const value = doc.frontmatter[key];
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label}: frontmatter 字段「${key}」应为非空字符串`);
  }
  return value;
}

function optionalBoolean(doc, key, fallback) {
  const value = doc.frontmatter[key];
  return typeof value === "boolean" ? value : fallback;
}

function requireStringArray(doc, key, label) {
  const value = doc.frontmatter[key];
  if (!Array.isArray(value) || !isStringArray(value)) {
    throw new Error(
      `${label}: frontmatter 缺少数组字段「${key}」，应为 ${key}: [a, b]（元素必须都是字符串）`
    );
  }
  return [...value];
}

function optionalStringArray(doc, key, label) {
  const value = doc.frontmatter[key];
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || !isStringArray(value)) {
    throw new Error(
      `${label}: frontmatter 字段「${key}」应为字符串数组，写法 ${key}: [a, b]（元素必须都是字符串）`
    );
  }
  return value.length === 0 ? void 0 : value;
}

function loadAgentFile(file, fileName) {
  const doc = parseFrontmatter(readFileSync(file, "utf8"), file);
  const name = requireString(doc, "name", file);
  if (name !== fileName.replace(/\.md$/, "")) {
    throw new Error(`${file}: frontmatter name「${name}」与文件名不一致`);
  }
  const tools = requireStringArray(doc, "tools", file);
  if (tools.length === 0) {
    throw new Error(`${file}: tools 不能为空数组——没有任何工具的子代理无法工作`);
  }
  return {
    name,
    description: requireString(doc, "description", file),
    tools,
    model: optionalString(doc, "model", file),
    body: doc.body
  };
}

function loadAgentsDir(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".md") && !name.startsWith(".")).sort().map((name) => loadAgentFile(join(dir, name), name));
}

function mergeAgentPools(globalAgents, expertAgents) {
  if (expertAgents.length === 0) return globalAgents;
  const byName = /* @__PURE__ */ new Map();
  for (const def of globalAgents) byName.set(def.name, def);
  for (const def of expertAgents) {
    if (!byName.has(def.name)) byName.set(def.name, def);
  }
  return [...byName.values()];
}

function loadAgents(resourcesAgentsDir, userAgentsDir) {
  if (!existsSync(resourcesAgentsDir)) {
    throw new Error(`内置子代理目录缺失：${resourcesAgentsDir}。这是打包错误——没有内置子代理，task 工具无可用 agent`);
  }
  const builtin = loadAgentsDir(resourcesAgentsDir);
  if (builtin.length === 0) {
    throw new Error(`内置子代理目录为空：${resourcesAgentsDir}。这是打包错误`);
  }
  const user = existsSync(userAgentsDir) ? loadAgentsDir(userAgentsDir) : [];
  const byName = /* @__PURE__ */ new Map();
  for (const def of builtin) byName.set(def.name, def);
  for (const def of user) byName.set(def.name, def);
  return [...byName.values()];
}

const EXPERT_FILE = "expert.md";

const SKILLS_DIR = "skills";

const SKILL_FILE = "SKILL.md";

const AGENTS_DIR = "agents";

const EXPERT_TYPES = ["expert", "team"];

function strayMarkdown(dir, allowed) {
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "README.md" && !allowed.includes(entry.name)
  ).map((entry) => entry.name).sort();
}

function loadExpertSkills(expertDir) {
  const skillsDir = join(expertDir, SKILLS_DIR);
  if (!existsSync(skillsDir)) return [];
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
  if (skillDirs.length === 0) {
    throw new Error(
      `${skillsDir}: 专家的 skills/ 目录为空。技能必须放在 <技能名>/SKILL.md 下；没有私有技能就删掉该目录`
    );
  }
  for (const dirName of skillDirs) {
    if (!existsSync(join(skillsDir, dirName, SKILL_FILE))) {
      throw new Error(`${join(skillsDir, dirName)}: 技能目录缺少 ${SKILL_FILE}`);
    }
  }
  const { skills } = loadSkills({
    cwd: skillsDir,
    agentDir: skillsDir,
    skillPaths: [skillsDir],
    includeDefaults: false
  });
  const byDir = new Map(skills.map((skill) => [basename(dirname(skill.filePath)), skill]));
  return skillDirs.map((dirName) => {
    const skill = byDir.get(dirName);
    if (skill === void 0) {
      throw new Error(
        `${join(skillsDir, dirName, SKILL_FILE)}: pi 没有加载这个技能（frontmatter 不合法，或缺 description）—— 这样模型看不到它`
      );
    }
    return { name: skill.name, file: skill.filePath };
  });
}

function loadExpertAgents(expertDir) {
  const agentsDir = join(expertDir, AGENTS_DIR);
  if (!existsSync(agentsDir)) return [];
  const agents = loadAgentsDir(agentsDir);
  if (agents.length === 0) {
    throw new Error(
      `${agentsDir}: 专家的 ${AGENTS_DIR}/ 目录为空。成员人格必须放在 <成员id>.md；没有私有成员就删掉该目录`
    );
  }
  return agents;
}

function loadExpertDir(dir, dirName, source) {
  const innerStray = strayMarkdown(dir, [EXPERT_FILE]);
  const stray = innerStray[0];
  if (stray !== void 0) {
    throw new Error(
      `${join(dir, stray)}: 专家已改为目录布局，请把 ${join(dir, stray)} 移到 ${join(dir, EXPERT_FILE)}`
    );
  }
  const expertFile = join(dir, EXPERT_FILE);
  if (!existsSync(expertFile)) {
    throw new Error(`${dir}: 专家目录缺少 ${EXPERT_FILE}`);
  }
  const doc = parseFrontmatter(readFileSync(expertFile, "utf8"), expertFile);
  const name = requireString(doc, "name", expertFile);
  if (name !== dirName) {
    throw new Error(`${expertFile}: frontmatter name「${name}」与目录名「${dirName}」不一致`);
  }
  const description = requireString(doc, "description", expertFile);
  const displayName = requireString(doc, "displayName", expertFile);
  const profession = requireString(doc, "profession", expertFile);
  const displayDescription = requireString(doc, "displayDescription", expertFile);
  const quickPrompts = requireStringArray(doc, "quickPrompts", expertFile);
  if (quickPrompts.length !== 3) {
    throw new Error(`${expertFile}: frontmatter「quickPrompts」必须恰好 3 个起手问题，当前 ${quickPrompts.length} 个`);
  }
  const tags = requireStringArray(doc, "tags", expertFile);
  if (tags.length !== 3) {
    throw new Error(`${expertFile}: frontmatter「tags」必须恰好 3 个关键词，当前 ${tags.length} 个`);
  }
  const extraTools = optionalStringArray(doc, "extraTools", expertFile);
  const rawExpertType = optionalString(doc, "expertType", expertFile);
  if (rawExpertType !== void 0 && !EXPERT_TYPES.includes(rawExpertType)) {
    throw new Error(
      `${expertFile}: frontmatter「expertType」只能是 ${EXPERT_TYPES.join(" 或 ")}，当前「${rawExpertType}」`
    );
  }
  const skills = loadExpertSkills(dir);
  const agents = loadExpertAgents(dir);
  return {
    def: {
      name,
      description,
      displayName,
      profession,
      displayDescription,
      quickPrompts,
      tags,
      ...extraTools !== void 0 ? { extraTools } : {},
      expertType: rawExpertType === "team" ? "team" : "expert",
      agents,
      ...skills.length > 0 ? { skillsDir: join(dir, SKILLS_DIR) } : {},
      body: doc.body
    },
    source,
    skills
  };
}

function loadExpertsDir(dir, source) {
  const rootStray = strayMarkdown(dir, []);
  const stray = rootStray[0];
  if (stray !== void 0) {
    throw new Error(
      `${join(dir, stray)}: 专家已改为目录布局，请把 ${join(dir, stray)} 移到 ${join(dir, stray.replace(/\.md$/, ""), EXPERT_FILE)}`
    );
  }
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort().map((name) => loadExpertDir(join(dir, name), name, source));
}

function loadGlobalSkills(globalSkillsDirs) {
  const refs = [];
  for (const dir of globalSkillsDirs) {
    if (!existsSync(dir)) continue;
    const { skills } = loadSkills({ cwd: dir, agentDir: dir, skillPaths: [dir], includeDefaults: false });
    for (const skill of skills) refs.push({ name: skill.name, file: skill.filePath });
  }
  return refs;
}

function loadExperts(resourcesExpertsDir, userExpertsDir, globalSkillsDirs, globalAgents) {
  if (!existsSync(resourcesExpertsDir)) {
    throw new Error(`内置专家目录缺失：${resourcesExpertsDir}。这是打包错误——没有内置专家，专家模式无可用人格`);
  }
  const builtin = loadExpertsDir(resourcesExpertsDir, "builtin");
  if (builtin.length === 0) {
    throw new Error(`内置专家目录为空：${resourcesExpertsDir}。这是打包错误`);
  }
  const user = existsSync(userExpertsDir) ? loadExpertsDir(userExpertsDir, "user") : [];
  const byName = /* @__PURE__ */ new Map();
  for (const loaded of builtin) byName.set(loaded.def.name, loaded);
  for (const loaded of user) byName.set(loaded.def.name, loaded);
  const claimed = /* @__PURE__ */ new Map();
  for (const ref of loadGlobalSkills(globalSkillsDirs)) claimed.set(ref.name, ref.file);
  for (const loaded of byName.values()) {
    for (const ref of loaded.skills) {
      const other = claimed.get(ref.name);
      if (other !== void 0) {
        throw new Error(`技能名「${ref.name}」与全局技能重名：${ref.file} 与 ${other}`);
      }
    }
  }
  const globalAgentNames = new Set(globalAgents.map((agent) => agent.name));
  for (const loaded of byName.values()) {
    for (const agent of loaded.def.agents) {
      if (globalAgentNames.has(agent.name)) {
        throw new Error(
          `成员人格「${agent.name}」与全局 agents 库重名：${join(loaded.def.name, AGENTS_DIR)} 与 resources/agents 或用户级 agents 目录`
        );
      }
    }
  }
  return [...byName.values()].map((loaded) => ({ ...loaded.def, source: loaded.source }));
}

export {
	AGENTS_DIR,
	EXPERT_FILE,
	EXPERT_TYPES,
	FENCE,
	SKILLS_DIR,
	SKILL_FILE,
	fileLineSuffix,
	isStringArray,
	loadAgentFile,
	loadAgents,
	loadAgentsDir,
	loadExpertAgents,
	loadExpertDir,
	loadExpertSkills,
	loadExperts,
	loadExpertsDir,
	loadGlobalSkills,
	mergeAgentPools,
	optionalBoolean,
	optionalString,
	optionalStringArray,
	parseFrontmatter,
	reasonOf,
	requireString,
	requireStringArray,
	shapeName,
	strayMarkdown,
};