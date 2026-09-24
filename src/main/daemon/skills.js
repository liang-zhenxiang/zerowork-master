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
import JSZip from "jszip";
import { getConfigDir } from "./config-paths.js";
import {
	optionalBoolean,
	optionalString,
	parseFrontmatter,
	requireString,
} from "./experts.js";
import { estimateTokens } from "./observability.js";
import {
	SKILL_NAME_PATTERN,
	isSkillEnabled,
	readPreferences,
	writePreferences,
} from "./preferences.js";
import { formatSkillsSection } from "./prompt-compose.js";

const NAME_MAX = 64;

const INSTALLED_META_FILE = "_installed.json";

function userSkillsDir() {
  return join(getConfigDir(), "skills");
}

function listSkillDependencyWriteDirs() {
  const root = userSkillsDir();
  if (!existsSync(root)) return [];
  const LOCK_FILES = ["package-lock.json", "npm-shrinkwrap.json"];
  const dirs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(root, entry.name);
    if (!existsSync(join(skillDir, "package.json"))) continue;
    const nodeModules = join(skillDir, "node_modules");
    try {
      mkdirSync(nodeModules, { recursive: true });
      dirs.push(nodeModules);
    } catch (error) {
      console.error(
        `技能「${entry.name}」的依赖目录建不出来，本次沙箱不会放行它（${nodeModules}）：`,
        error
      );
    }
    for (const lockFile of LOCK_FILES) {
      const lockPath = join(skillDir, lockFile);
      if (existsSync(lockPath)) dirs.push(lockPath);
    }
  }
  return dirs.sort();
}

function parseSource(sourcePath) {
  const source = resolve(sourcePath);
  if (!existsSync(source)) throw new Error("路径不存在");
  const stat2 = statSync(source);
  if (stat2.isFile()) {
    if (!source.endsWith(".md")) throw new Error("请选择含 SKILL.md 的文件夹，或单个 .md 技能文件");
    const doc2 = parseFrontmatter(readFileSync(source, "utf8"), source);
    return {
      name: requireString(doc2, "name", source),
      description: requireString(doc2, "description", source),
      userInvocable: optionalBoolean(doc2, "user-invocable", true),
      disableModelInvocation: optionalBoolean(doc2, "disable-model-invocation", false),
      version: optionalString(doc2, "version", source),
      skillMdPath: source,
      sourceDir: null
    };
  }
  const skillMd = join(source, "SKILL.md");
  if (!existsSync(skillMd)) throw new Error("所选文件夹里没有 SKILL.md —— 技能必须包含 SKILL.md");
  const doc = parseFrontmatter(readFileSync(skillMd, "utf8"), skillMd);
  return {
    name: requireString(doc, "name", skillMd),
    description: requireString(doc, "description", skillMd),
    userInvocable: optionalBoolean(doc, "user-invocable", true),
    disableModelInvocation: optionalBoolean(doc, "disable-model-invocation", false),
    version: optionalString(doc, "version", skillMd),
    skillMdPath: skillMd,
    sourceDir: source
  };
}

function readInstalledMeta(skillDir) {
  const file = join(skillDir, INSTALLED_META_FILE);
  if (!existsSync(file)) return void 0;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`技能元数据「${file}」读取失败，暂按手工放置处理：`, error);
    return void 0;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    console.error(`技能元数据「${file}」不是合法 JSON，暂按手工放置处理：`, error);
    return void 0;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.error(`技能元数据「${file}」应为 JSON 对象，暂按手工放置处理：`, raw);
    return void 0;
  }
  const record = raw;
  const version = record["version"];
  const sourcePath = record["sourcePath"];
  const installedAt = record["installedAt"];
  return {
    version: typeof version === "string" && version !== "" ? version : void 0,
    sourcePath: typeof sourcePath === "string" && sourcePath !== "" ? sourcePath : void 0,
    installedAt: typeof installedAt === "number" && Number.isFinite(installedAt) ? installedAt : void 0,
    // 只认 true：写歪的值（"true" / 1）当没标记 —— 授权判定上，读不懂就是不给权限。
    agentCreated: record["agentCreated"] === true
  };
}

function stagingRoot() {
  return join(getConfigDir(), ".skill-staging");
}

function copyTree(sourceDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) copyTree(source, dest);
    else copyFileSync(source, dest);
  }
}

function importSkill(sourcePath, options = {}) {
  const source = resolve(sourcePath);
  const parsed = parseSource(source);
  if (parsed.name.length > NAME_MAX) throw new Error(`技能名过长（上限 ${NAME_MAX} 字符）：${parsed.name}`);
  if (!SKILL_NAME_PATTERN.test(parsed.name)) {
    throw new Error(`技能名「${parsed.name}」不合法：只能用小写字母、数字和连字符（如 meeting-notes）`);
  }
  if (parsed.description.trim() === "") throw new Error("SKILL.md 缺少 description —— 没有它模型无法判断何时使用该技能");
  const destDir = join(userSkillsDir(), parsed.name);
  const existing = existsSync(destDir);
  if (existing && readInstalledMeta(destDir)?.agentCreated !== true) {
    throw new Error(`技能「${parsed.name}」已存在。如需替换，请先到技能目录手动删除旧的（${destDir}）`);
  }
  const stagingDir2 = join(stagingRoot(), `${parsed.name}-${process.pid}-${Date.now()}`);
  const installedAt = Date.now();
  try {
    mkdirSync(userSkillsDir(), { recursive: true });
    mkdirSync(stagingDir2, { recursive: true });
    if (parsed.sourceDir !== null) copyTree(parsed.sourceDir, stagingDir2);
    else copyFileSync(parsed.skillMdPath, join(stagingDir2, "SKILL.md"));
    const metaFile = {
      name: parsed.name,
      ...parsed.version === void 0 ? {} : { version: parsed.version },
      source: "local-import",
      sourcePath: source,
      installedAt,
      ...options.agentCreated === true ? { agentCreated: true } : {}
    };
    writeFileSync(join(stagingDir2, INSTALLED_META_FILE), `${JSON.stringify(metaFile, null, 2)}
`, "utf8");
  } catch (error) {
    rmSync(stagingDir2, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`技能「${parsed.name}」安装失败，技能目录未被改动：${reason}`);
  }
  const backupDir = join(stagingRoot(), `${parsed.name}.old-${process.pid}-${Date.now()}`);
  let backedUp = false;
  try {
    if (existing) {
      renameSync(destDir, backupDir);
      backedUp = true;
    }
    renameSync(stagingDir2, destDir);
  } catch (error) {
    if (backedUp) renameSync(backupDir, destDir);
    rmSync(stagingDir2, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`技能「${parsed.name}」安装失败，已恢复原状：${reason}`);
  }
  if (backedUp) rmSync(backupDir, { recursive: true, force: true });
  return {
    name: parsed.name,
    description: parsed.description,
    filePath: join(destDir, "SKILL.md"),
    origin: "user",
    // 如实读来源声明（不再硬写 false）：返回值与下一轮 listSkills 现读的结果必须一致。
    disableModelInvocation: parsed.disableModelInvocation,
    userInvocable: parsed.userInvocable,
    // 启用状态是用户级覆盖：新导入的技能名字上若留着旧的「停用」记录（用户先停用、
    // 再手工删目录、然后重新导入同名技能），如实回报 —— 硬写 true 会骗调用方。
    enabled: isSkillEnabled(parsed.name, readPreferences().skillOverrides),
    ...parsed.version === void 0 ? {} : { version: parsed.version },
    installedAt,
    sourcePath: source
  };
}

function removeAgentSkill(name) {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`技能名「${name}」不合法：只能用小写字母、数字和连字符（如 meeting-notes）`);
  }
  const dir = join(userSkillsDir(), name);
  if (!existsSync(dir)) throw new Error(`用户技能目录里没有技能「${name}」（${dir}）`);
  if (readInstalledMeta(dir)?.agentCreated !== true) {
    throw new Error(
      `技能「${name}」不是模型创建的，不能由模型删除 —— 内置、市场安装与用户手工放置的技能都要用户自己在技能页处理`
    );
  }
  rmSync(dir, { recursive: true, force: true });
  clearSkillOverride(name);
  return { name, dir };
}

function clearSkillOverride(name) {
  const preferences = readPreferences();
  const overrides = preferences.skillOverrides;
  if (overrides?.[name] === void 0) return;
  const next = { ...overrides };
  delete next[name];
  const { skillOverrides: _dropped, ...rest } = preferences;
  writePreferences(Object.keys(next).length === 0 ? rest : { ...rest, skillOverrides: next });
}

const EXCLUDED = /* @__PURE__ */ new Set(["_installed.json"]);

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function packSkillDir(skillDir, outFile) {
  if (!statSync(skillDir).isDirectory()) throw new Error(`打包对象不是目录：${skillDir}`);
  const root = basename(skillDir);
  const zip = new JSZip();
  let packed = 0;
  for (const file of listFiles(skillDir)) {
    const rel = relative(skillDir, file);
    if (EXCLUDED.has(rel)) continue;
    zip.file(`${root}/${rel.split(sep).join("/")}`, readFileSync(file));
    packed += 1;
  }
  if (packed === 0) throw new Error(`技能目录里没有可打包的文件：${skillDir}`);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(outFile, buffer);
  return buffer.byteLength;
}

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function isInside$1(root, target) {
  const rootNorm = normalize(root);
  if (rootNorm === "") return false;
  const targetNorm = normalize(target);
  return targetNorm === rootNorm || targetNorm.startsWith(`${rootNorm}/`);
}

function skillScopeOf(filePath, opts) {
  for (const dir of opts.builtinDirs) {
    if (isInside$1(dir, filePath)) return "builtin";
  }
  if (opts.workspaceDir !== void 0 && isInside$1(opts.workspaceDir, filePath)) return "project";
  return "user";
}

const SKILLS_TOKEN_WARNING_THRESHOLD = 4e3;

function skillsCostWarning(tokens, threshold = SKILLS_TOKEN_WARNING_THRESHOLD) {
  if (tokens <= threshold) return void 0;
  return `技能清单已常驻约 ${tokens} token，超过 ${threshold} 的警戒线（超出 ${tokens - threshold}）——每轮对话都要付这笔成本，建议在下面停用不常用的技能。`;
}

async function computeSkillsCost(enabled, threshold = SKILLS_TOKEN_WARNING_THRESHOLD) {
  const skillsTokens = estimateTokens(await formatSkillsSection(enabled));
  return {
    enabledCount: enabled.length,
    skillsTokens,
    warning: skillsCostWarning(skillsTokens, threshold)
  };
}

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f\x7f]/g;

const TITLE_MAX_LENGTH = 40;

function sanitizeExportTitle(title) {
  const cleaned = title.replace(/\s+/g, " ").trim().replace(ILLEGAL_CHARS, "-").slice(0, TITLE_MAX_LENGTH);
  return cleaned === "" ? "session" : cleaned;
}

function formatTimestamp(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export {
	EXCLUDED,
	ILLEGAL_CHARS,
	INSTALLED_META_FILE,
	NAME_MAX,
	SKILLS_TOKEN_WARNING_THRESHOLD,
	TITLE_MAX_LENGTH,
	clearSkillOverride,
	computeSkillsCost,
	copyTree,
	formatTimestamp,
	importSkill,
	isInside$1,
	listFiles,
	listSkillDependencyWriteDirs,
	normalize,
	packSkillDir,
	parseSource,
	readInstalledMeta,
	removeAgentSkill,
	sanitizeExportTitle,
	skillScopeOf,
	skillsCostWarning,
	stagingRoot,
	userSkillsDir,
};