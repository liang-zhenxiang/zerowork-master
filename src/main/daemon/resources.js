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
import { loadMemorySystemPrompt } from "./memory.js";
import {
	optionalBoolean,
	parseFrontmatter,
	requireString,
	requireStringArray,
} from "./experts.js";
import { contentFingerprint } from "./model-catalog.js";
import { estimateTokens } from "./observability.js";
import { readPreferences } from "./preferences.js";
import {
	DEFAULT_STYLE_ID,
	STYLE_LABELS,
	composePromptWithMeta,
	requireExpertPersona,
	resolveSessionExpert,
	skillsSectionForMode,
	toExpertPersona,
} from "./prompt-compose.js";

function toDescriptors(resources) {
  const toDescriptor = (r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    ready: r.ready
  });
  return {
    scenes: resources.scenes.map(toDescriptor),
    modes: resources.modes.map(toDescriptor)
  };
}

function loadResources(resourcesDir) {
  const scenesDir = join(resourcesDir, "scenes");
  const modesDir = join(resourcesDir, "modes");
  const stylesDir = join(resourcesDir, "styles");
  if (!existsSync(scenesDir) || !existsSync(modesDir) || !existsSync(stylesDir)) {
    throw new Error(
      `资源目录不完整：需要 ${scenesDir}、${modesDir} 与 ${stylesDir}。若设置了 ZEROWORK_RESOURCES_DIR，请检查其指向。`
    );
  }
  const scenes = readdirSync(scenesDir).filter((name) => !name.startsWith(".")).sort().flatMap((name) => {
    const dir = join(scenesDir, name);
    if (!statSync(dir).isDirectory()) return [];
    const file = join(dir, "prompt.md");
    if (!existsSync(file)) throw new Error(`场景「${name}」缺少 prompt.md（${dir}）`);
    const doc = parseFrontmatter(readFileSync(file, "utf8"), file);
    const id = requireString(doc, "id", file);
    if (id !== name) throw new Error(`${file}: frontmatter id「${id}」与目录名「${name}」不一致`);
    return [
      {
        id,
        label: requireString(doc, "label", file),
        description: requireString(doc, "description", file),
        ready: optionalBoolean(doc, "ready", false),
        body: doc.body
      }
    ];
  });
  if (scenes.length === 0) throw new Error(`scenes/ 下没有任何场景（${scenesDir}）`);
  const modes = readdirSync(modesDir).filter((name) => name.endsWith(".md") && !name.startsWith(".")).sort().map((name) => {
    const file = join(modesDir, name);
    const doc = parseFrontmatter(readFileSync(file, "utf8"), file);
    const id = requireString(doc, "id", file);
    if (id !== name.replace(/\.md$/, "")) throw new Error(`${file}: frontmatter id「${id}」与文件名不一致`);
    return {
      id,
      label: requireString(doc, "label", file),
      description: requireString(doc, "description", file),
      ready: optionalBoolean(doc, "ready", false),
      tools: requireStringArray(doc, "tools", file),
      body: doc.body
    };
  });
  if (modes.length === 0) throw new Error(`modes/ 下没有任何交互模式（${modesDir}）`);
  const styles = readdirSync(stylesDir).filter((name) => name.startsWith("style-") && name.endsWith(".md")).sort().map((name) => {
    const file = join(stylesDir, name);
    const id = name.replace(/^style-/, "").replace(/\.md$/, "");
    const label = STYLE_LABELS[id];
    if (label === void 0) {
      throw new Error(`${file}: 未知风格「${id}」（STYLE_LABELS 中没有对应中文名）`);
    }
    const body = readFileSync(file, "utf8");
    if (body.trim() === "") throw new Error(`${file}: 风格文件为空`);
    return { id, label, body };
  });
  if (styles.length === 0) throw new Error(`styles/ 下没有任何回复风格（${stylesDir}）`);
  if (loadLanguagePrompt(resourcesDir) === void 0) {
    throw new Error(
      `prompts/language.md 缺失或为空（${join(resourcesDir, "prompts", "language.md")}）—— 输出语言规则不能没有`
    );
  }
  return { scenes, modes, styles, fragments: loadFragments(resourcesDir), welcome: loadWelcome(resourcesDir, scenes) };
}

const FRAGMENT_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function loadFragments(resourcesDir) {
  const fragmentsDir = join(resourcesDir, "prompts", "fragments");
  if (!existsSync(fragmentsDir)) return /* @__PURE__ */ new Map();
  const fragments = /* @__PURE__ */ new Map();
  for (const name of readdirSync(fragmentsDir).sort()) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    const id = name.replace(/\.md$/, "");
    const file = join(fragmentsDir, name);
    if (!FRAGMENT_NAME.test(id)) {
      throw new Error(
        `${file}: 片段名「${id}」无法被 {{> }} 指令引用（须匹配 ${FRAGMENT_NAME.source}）——改名或删除`
      );
    }
    const body = readFileSync(file, "utf8");
    if (body.trim() === "") throw new Error(`${file}: 片段文件为空（引用它就是埋一个空洞）`);
    fragments.set(id, body);
  }
  return fragments;
}

function loadLanguagePrompt(resourcesDir) {
  const file = join(resourcesDir, "prompts", "language.md");
  if (!existsSync(file)) return void 0;
  const body = readFileSync(file, "utf8").trim();
  return body === "" ? void 0 : body;
}

function loadWelcome(resourcesDir, scenes) {
  const dir = join(resourcesDir, "welcome");
  if (!existsSync(dir)) return { chips: [], cases: [] };
  const chipsFile = join(dir, "chips.json");
  const casesFile = join(dir, "cases.json");
  const rawChips = readJsonArray(chipsFile);
  const rawCases = readJsonArray(casesFile);
  const sceneIds = new Set(scenes.map((s) => s.id));
  const chips = rawChips.map((raw, index) => {
    const at = `${chipsFile}[${index}]`;
    const kind = requireStringField(raw, "chipKind", at);
    if (kind !== "playbook" && kind !== "scene") {
      throw new Error(`${at}: chipKind 只能是 playbook 或 scene（实际「${kind}」）`);
    }
    const scene = requireStringField(raw, "scene", at);
    if (!sceneIds.has(scene)) {
      throw new Error(`${at}: scene「${scene}」不在 scenes/ 中（写错的场景让这个胶囊永远不出现）`);
    }
    const prompts = kind === "scene" ? requireStringListField(raw, "prompts", at) : void 0;
    return {
      id: requireStringField(raw, "id", at),
      scene,
      label: requireStringField(raw, "label", at),
      description: requireStringField(raw, "description", at),
      icon: requireStringField(raw, "icon", at),
      chipKind: kind,
      ...prompts === void 0 ? {} : { prompts }
    };
  });
  requireUniqueIds(chips.map((c) => c.id), chipsFile);
  const chipIds = new Set(chips.map((c) => c.id));
  const cases = rawCases.map((raw, index) => {
    const at = `${casesFile}[${index}]`;
    const chipId = requireStringField(raw, "chipId", at);
    if (!chipIds.has(chipId)) {
      throw new Error(`${at}: chipId「${chipId}」没有对应胶囊（这条案例永远不会显示）`);
    }
    return {
      id: requireStringField(raw, "id", at),
      chipId,
      title: requireStringField(raw, "title", at),
      subtitle: requireStringField(raw, "subtitle", at),
      prompt: requireStringField(raw, "prompt", at),
      // 绑定的专家是 resources/experts/ 的目录名；存在性由测试跨资源校验
      // （加载器这里只有 welcome 一个目录的视野，看不到 experts/）。
      expert: requireStringField(raw, "expert", at),
      cover: requireStringField(raw, "cover", at)
    };
  });
  requireUniqueIds(cases.map((c) => c.id), casesFile);
  for (const chip of chips) {
    if (chip.chipKind === "playbook" && !cases.some((c) => c.chipId === chip.id)) {
      throw new Error(`${chipsFile}: 胶囊「${chip.id}」是 playbook 类型但没有任何案例`);
    }
  }
  return { chips, cases };
}

function readJsonArray(file) {
  if (!existsSync(file)) throw new Error(`缺少 ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: JSON 解析失败（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${file}: 顶层必须是数组`);
  return parsed;
}

function requireStringField(source, key, at) {
  const value = source?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${at}: ${key} 缺失或不是非空字符串`);
  }
  return value;
}

function requireStringListField(source, key, at) {
  const value = source?.[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${at}: ${key} 必须是非空数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`${at}: ${key}[${index}] 不是非空字符串`);
    }
    return item;
  });
}

function requireUniqueIds(ids, file) {
  const seen = /* @__PURE__ */ new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${file}: id「${id}」重复`);
    seen.add(id);
  }
}

function resolveStyle(styles, styleId) {
  if (styleId === "") return { style: void 0 };
  const fallback = styles.find((s) => s.id === DEFAULT_STYLE_ID);
  if (styleId === void 0) {
    if (fallback === void 0) {
      throw new Error(`默认回复风格「${DEFAULT_STYLE_ID}」不在 styles/ 中（安装损坏或被手删）`);
    }
    return { style: fallback };
  }
  const found = styles.find((s) => s.id === styleId);
  if (found !== void 0) return { style: found };
  if (fallback === void 0) {
    throw new Error(`默认回复风格「${DEFAULT_STYLE_ID}」不在 styles/ 中（安装损坏或被手删）`);
  }
  return { style: fallback, driftedFrom: styleId };
}

async function assembleSystemPrompt(input) {
  const skillsSection = await skillsSectionForMode(input.mode.tools, input.skills);
  const composed = composePromptWithMeta({
    sceneBody: input.scene.body,
    modeBody: input.mode.body,
    skillsSection,
    modeId: input.mode.id,
    // 片段库查表：找不到返回 undefined → composer 抛错（不静默留洞上线）。
    resolveFragment: (name) => input.resources.fragments.get(name),
    ...input.style === void 0 ? {} : { style: input.style },
    ...input.memorySystemBody === void 0 ? {} : { memorySystemBody: input.memorySystemBody },
    ...input.languageBody === void 0 ? {} : { languageBody: input.languageBody },
    ...input.expert === void 0 ? {} : { expert: input.expert },
    piContext: input.piContext
  });
  return { text: composed.text, segments: composed.segments, skillsSection };
}

function createSystemPromptComposer(deps) {
  return async (input) => {
    const scene = deps.resources.scenes.find((s) => s.id === input.sceneId);
    const mode = deps.resources.modes.find((m) => m.id === input.interactionId);
    if (scene === void 0 || mode === void 0) {
      throw new Error(`场景或交互模式不存在：${input.sceneId} / ${input.interactionId}`);
    }
    const expert = input.expertId === void 0 ? void 0 : resolveSessionExpert(deps.loadExperts(), input.expertId);
    const { style, driftedFrom } = resolveStyle(deps.resources.styles, deps.readPreferences().styleId);
    if (driftedFrom !== void 0) {
      deps.onStyleDrift({ requested: driftedFrom, fallback: style?.id ?? DEFAULT_STYLE_ID });
    }
    const memorySystemBody = deps.loadMemorySystemBody();
    const languageBody = deps.loadLanguageBody();
    const assembled = await assembleSystemPrompt({
      resources: deps.resources,
      scene,
      mode,
      skills: await deps.enabledSkills(input.expertId),
      ...style === void 0 ? {} : { style: { id: style.id, body: style.body } },
      ...expert === void 0 ? {} : { expert: toExpertPersona(expert) },
      ...memorySystemBody === void 0 ? {} : { memorySystemBody },
      ...languageBody === void 0 ? {} : { languageBody },
      piContext: input.piContext
    });
    return {
      prompt: assembled.text,
      systemTokens: deps.estimateTokens(assembled.text),
      skillsTokens: deps.estimateTokens(assembled.skillsSection),
      // 分段内容指纹（与消息指纹同一算法，见 shared/observability.ts 的
      // contentFingerprint）：相邻两轮的分段清单 diff 出「哪一段变了」靠它，
      // 缓存断点落在消息列表之前时（CACHE6 的 before_messages）才有话可说。
      // 仍不落正文：指纹不可逆。
      segments: assembled.segments.map((s) => ({
        source: s.source,
        chars: s.text.length,
        fp: contentFingerprint(s.text),
        // 纯空白残段（片段之间的边界空行）就地标记：台账不落正文，消费方
        // （任务诊断的分段占比图）判不出这 2 个字符是空行还是正文，只能由
        // 见过正文的这里标。段本身仍留在清单里，理由见 SystemSegmentStat.blank。
        blank: s.text.trim() === ""
      }))
    };
  };
}

function createSystemPromptComposerFromDefaults(options) {
  return createSystemPromptComposer({
    resources: loadResources(options.resourcesDir),
    loadExperts: options.loadExperts,
    enabledSkills: options.enabledSkills,
    onStyleDrift: options.onStyleDrift,
    loadMemorySystemBody: () => loadMemorySystemPrompt(options.resourcesDir),
    loadLanguageBody: () => loadLanguagePrompt(options.resourcesDir),
    estimateTokens,
    readPreferences: options.readPreferences ?? readPreferences
  });
}

async function buildPromptPreview(resources, request, env) {
  const scene = resources.scenes.find((s) => s.id === request.sceneId);
  if (scene === void 0) throw new Error(`未知场景：${request.sceneId}`);
  const mode = resources.modes.find((m) => m.id === request.modeId);
  if (mode === void 0) throw new Error(`未知交互模式：${request.modeId}`);
  const expert = request.expertId === void 0 ? void 0 : requireExpertPersona(env.experts, request.expertId);
  let style;
  if (request.styleId === void 0) {
    style = resolveStyle(resources.styles, env.preferredStyleId).style;
  } else if (request.styleId !== "") {
    style = resources.styles.find((s) => s.id === request.styleId);
    if (style === void 0) throw new Error(`未知回复风格：${request.styleId}`);
  }
  const assembled = await assembleSystemPrompt({
    resources,
    scene,
    mode,
    // 技能段门控（read / bash / use_skill）在组装本体里，预览不再镜像一份：
    // 门控只有一处，预览与真实会话不可能各说各话。
    skills: env.skills,
    ...style === void 0 ? {} : { style: { id: style.id, body: style.body } },
    ...expert === void 0 ? {} : { expert },
    ...env.memorySystemBody === void 0 ? {} : { memorySystemBody: env.memorySystemBody },
    ...env.languageBody === void 0 ? {} : { languageBody: env.languageBody }
    // piContext 的差异点见文件头注释（差异 1）。
  });
  return {
    segments: assembled.segments.map((s) => ({
      source: s.source,
      text: s.text,
      chars: s.text.length
    })),
    totalChars: assembled.text.length
  };
}

export {
	FRAGMENT_NAME,
	assembleSystemPrompt,
	buildPromptPreview,
	createSystemPromptComposer,
	createSystemPromptComposerFromDefaults,
	loadFragments,
	loadLanguagePrompt,
	loadResources,
	loadWelcome,
	readJsonArray,
	requireStringField,
	requireStringListField,
	requireUniqueIds,
	resolveStyle,
	toDescriptors,
};