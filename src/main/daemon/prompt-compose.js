import { basename } from "node:path";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { extname } from "node:path";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { normalize as normalize$1 } from "node:path";
import { relative } from "node:path";
import { resolve } from "node:path";
import { sep } from "node:path";

const SNAPSHOT_SUPERSEDE_NOTE = "本条快照取代此前所有同类快照；内容冲突时以本条为准。";

function wrapHiddenContextXml(xml, role = "user-context") {
  return `<system-reminder data-role="${role}">
${xml}
</system-reminder>`;
}

function composeHiddenBlock(sections, role) {
  const body = sections.filter((s) => s.role === role && s.body.trim() !== "").map((s) => `<${s.tag}>
${s.body.trim()}
</${s.tag}>`).join("\n");
  if (body === "") return void 0;
  return wrapHiddenContextXml(`${SNAPSHOT_SUPERSEDE_NOTE}

${body}`, role);
}

function formatRunTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRest = Math.abs(offsetMinutes) % 60;
  const zone = `GMT${sign}${offsetHours}${offsetRest === 0 ? "" : `:${pad(offsetRest)}`}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}（${weekdays[date.getDay()]}，${zone}）`;
}

function shouldAppendSnapshot(previous, current) {
  return previous === void 0 || previous !== current;
}

const CUSTOM_INSTRUCTIONS_MAX = 1500;

function formatPersonalizationSection(p) {
  const blocks = [];
  if (p.customInstructions !== void 0 && p.customInstructions.trim() !== "") {
    const instructions = p.customInstructions.trim().slice(0, CUSTOM_INSTRUCTIONS_MAX);
    blocks.push(`## 用户规则

以下是用户为自己设定的规则，请在合适的场景下遵循。

${instructions}`);
  }
  const identityLines = [];
  if (p.userNickname !== void 0 && p.userNickname.trim() !== "") {
    identityLines.push(`用户希望被称为「${p.userNickname.trim()}」。`);
  }
  if (p.assistantName !== void 0 && p.assistantName.trim() !== "") {
    identityLines.push(`你的名字是 ${p.assistantName.trim()}。`);
  }
  if (p.personaDescription !== void 0 && p.personaDescription.trim() !== "") {
    identityLines.push(`你的人设：${p.personaDescription.trim()}`);
  }
  if (identityLines.length > 0) blocks.push(identityLines.join("\n"));
  return blocks.join("\n\n");
}

function formatRuntimeContext(input = {}) {
  const blocks = [];
  if (input.memoryContent !== void 0 && input.memoryContent.trim() !== "") {
    blocks.push(input.memoryContent.trim());
  }
  if (input.personalization !== void 0) {
    const personalization = formatPersonalizationSection(input.personalization);
    if (personalization !== "") blocks.push(personalization);
  }
  if (blocks.length === 0) return "";
  return `${SNAPSHOT_SUPERSEDE_NOTE}

${blocks.join("\n\n")}`;
}

const SLOT = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

const ANY_SLOT = /\{\{[^{}]*\}\}/g;

const INCLUDE = /\{\{>\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;

const MAX_FRAGMENT_DEPTH = 8;

function composePromptWithMeta(input) {
  const pieces = [];
  expandIncludes(input.sceneBody, "skeleton", input, [], pieces);
  const filled = [];
  for (const piece of pieces) fillSlots(piece, input, filled);
  if (input.expert !== void 0) {
    const personaSeg = {
      source: "expert",
      text: `

${formatExpertPersona(input.expert)}

`
    };
    const modeIdx = filled.findIndex((s) => s.source.startsWith("mode:"));
    if (modeIdx === -1) filled.push(personaSeg);
    else {
      const prev = filled[modeIdx - 1];
      if (prev !== void 0) prev.text = prev.text.replace(/\n+$/, "");
      filled.splice(modeIdx, 0, personaSeg);
    }
  }
  if (input.style !== void 0 && input.expert === void 0) {
    const styleSeg = {
      source: `style:${input.style.id}`,
      text: `

${formatStyleSection(input.style.body)}`
    };
    const modeIdx = filled.findIndex((s) => s.source.startsWith("mode:"));
    if (modeIdx === -1) filled.push(styleSeg);
    else filled.splice(modeIdx + 1, 0, styleSeg);
  }
  if (input.languageBody !== void 0 && input.languageBody.trim() !== "") {
    filled.push({ source: "language", text: `

${input.languageBody.trim()}` });
  }
  for (const seg of filled) {
    const leftover = seg.text.match(ANY_SLOT);
    if (leftover !== null) {
      throw new Error(
        `组装后的提示词仍有残留槽位（${leftover.join("、")}，来源段 ${seg.source}）——骨架、片段与模式正文里都不应出现 {{...}}`
      );
    }
  }
  const core = finalizeCore(filled);
  const all = [...core];
  if (input.memorySystemBody !== void 0 && input.memorySystemBody.trim() !== "") {
    all.push({
      source: "memory-system",
      text: `

## 记忆系统

${input.memorySystemBody.trim()}`
    });
  }
  const piBlock = formatPiContextBlock(input);
  if (piBlock !== "") {
    all.push({ source: "pi-context", text: `

${piBlock}` });
  }
  if (input.expert !== void 0) {
    all.push({
      source: "expert",
      text: `

<current-expert>${input.expert.displayName}</current-expert>
请始终以该专家的角色与工作流推进本会话。`
    });
  }
  return { text: all.map((s) => s.text).join(""), segments: all };
}

function expandIncludes(text, source, input, chain, out) {
  let last = 0;
  for (const m of text.matchAll(INCLUDE)) {
    const idx = m.index;
    const name = m[1];
    if (idx === void 0 || name === void 0) continue;
    if (idx > last) out.push({ source, text: text.slice(last, idx) });
    if (input.resolveFragment === void 0) {
      throw new Error(
        `提示词骨架包含片段引用「{{> ${name}}」，但输入未提供 resolveFragment —— composer 不读盘，片段由 loader 层注入`
      );
    }
    const content = input.resolveFragment(name);
    if (content === void 0) {
      throw new Error(
        `提示词片段「${name}」缺失（resolveFragment 返回 undefined）——不静默上线带空洞的提示词`
      );
    }
    if (chain.includes(name)) {
      throw new Error(`提示词片段成环：${[...chain, name].join(" → ")}`);
    }
    if (chain.length >= MAX_FRAGMENT_DEPTH) {
      throw new Error(
        `提示词片段嵌套超过 ${MAX_FRAGMENT_DEPTH} 层：${chain.join(" → ")}（不成环的长链几乎一定是配置事故）`
      );
    }
    expandIncludes(
      content.replace(/^\n+/, "").replace(/\n+$/, ""),
      `fragment:${name}`,
      input,
      [...chain, name],
      out
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ source, text: text.slice(last) });
}

function fillSlots(piece, input, out) {
  const slots = [
    { name: "interaction", source: `mode:${input.modeId ?? "unknown"}`, text: input.modeBody },
    { name: "skills", source: "skills", text: input.skillsSection }
  ];
  let last = 0;
  for (const m of piece.text.matchAll(SLOT)) {
    const idx = m.index;
    const name = m[1];
    if (idx === void 0 || name === void 0) continue;
    const raw = m[0];
    const slot = slots.find((s) => s.name === name);
    if (slot === void 0) {
      throw new Error(
        `提示词骨架包含未支持的槽位「${raw}」。支持的槽位：${slots.map((s) => s.name).join(" / ")}`
      );
    }
    if (idx > last) out.push({ source: piece.source, text: piece.text.slice(last, idx) });
    out.push({ source: slot.source, text: slot.text.replace(/^\n+/, "").replace(/\n+$/, "") });
    last = idx + raw.length;
  }
  if (last < piece.text.length) out.push({ source: piece.source, text: piece.text.slice(last) });
}

function finalizeCore(segments) {
  const merged = [];
  for (const seg of segments) {
    const text = seg.text.replace(/\n{3,}/g, "\n\n");
    if (text === "") continue;
    const prev = merged[merged.length - 1];
    if (prev !== void 0 && prev.source === seg.source) {
      prev.text = `${prev.text}${text}`.replace(/\n{3,}/g, "\n\n");
    } else {
      merged.push({ source: seg.source, text });
    }
  }
  const joined = merged.map((s) => s.text).join("");
  let dropLead = joined.length - joined.trimStart().length;
  let dropTrail = joined.length - joined.trimEnd().length;
  for (const seg of merged) {
    if (dropLead === 0) break;
    const cut = Math.min(dropLead, seg.text.length);
    seg.text = seg.text.slice(cut);
    dropLead -= cut;
  }
  for (let i = merged.length - 1; i >= 0 && dropTrail > 0; i--) {
    const seg = merged[i];
    if (seg === void 0) break;
    const cut = Math.min(dropTrail, seg.text.length);
    seg.text = seg.text.slice(0, seg.text.length - cut);
    dropTrail -= cut;
  }
  return merged.filter((s) => s.text !== "");
}

function formatExpertPersona(expert) {
  return `## 当前专家

你当前的专家身份：${expert.displayName}（${expert.profession}）。

身份覆盖：以下是你在本会话中的专家身份定义。它与此前任何通用身份描述冲突时，以本段为准——这是本会话中你的权威角色。

${expert.body.trim()}`;
}

function formatStyleSection(body) {
  return `## 回复风格

${body.trim()}

风格只影响表达方式（HOW），不改变事实与内容（WHAT）。`;
}

function resolveSessionExpert(experts, expertId) {
  if (expertId === void 0) return void 0;
  const found = experts.find((e) => e.name === expertId);
  if (found === void 0) {
    throw new Error(`专家「${expertId}」不在专家库中（可能已被删除或改名）`);
  }
  return found;
}

function toExpertPersona(expert) {
  return { displayName: expert.displayName, profession: expert.profession, body: expert.body };
}

function requireExpertPersona(experts, expertId) {
  const found = resolveSessionExpert(experts, expertId);
  if (found === void 0) {
    throw new Error("会话绑定专家时缺少 expertId（人格解析需要具体专家）");
  }
  return toExpertPersona(found);
}

function formatPiContextBlock(input) {
  const sections = [];
  const contextFiles = input.piContext?.contextFiles ?? [];
  if (contextFiles.length > 0) {
    const blocks = contextFiles.map(
      ({ path, content }) => `<project_instructions path="${path}">
${content}
</project_instructions>`
    ).join("\n\n");
    sections.push(
      `<project_context>

Project-specific instructions and guidelines:

${blocks}
</project_context>`
    );
  }
  const toolSnippets = input.piContext?.toolSnippets ?? {};
  const snippetEntries = Object.entries(toolSnippets).filter(
    ([name, snippet]) => name !== "" && snippet !== ""
  );
  if (snippetEntries.length > 0) {
    sections.push(
      `Available tools:
${snippetEntries.map(([name, snippet]) => `- ${name}: ${snippet}`).join("\n")}`
    );
  }
  const guidelines = (input.piContext?.promptGuidelines ?? []).filter((g) => g.trim() !== "");
  if (guidelines.length > 0) {
    sections.push(`Guidelines:
${guidelines.map((g) => `- ${g}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function appendPiContext(composed, input) {
  const block = formatPiContextBlock(input);
  return block === "" ? composed : `${composed}

${block}`;
}

function composeSubagentPrompt(input) {
  const head = `${input.agentBody.trim()}

当前工作目录：${input.cwd}`;
  const body = input.languageBody === void 0 || input.languageBody.trim() === "" ? head : `${head}

${input.languageBody.trim()}`;
  return appendPiContext(body, input);
}

async function formatSkillsSection(skills) {
  if (skills.length === 0) return "";
  const { createSyntheticSourceInfo, formatSkillsForPrompt } = await import("@earendil-works/pi-coding-agent");
  const section = formatSkillsForPrompt(
    skills.map((skill) => toPiSkill(skill, createSyntheticSourceInfo)),
    "read"
  ).trim();
  if (section === "") return "";
  return `${section}

${SKILL_INVOCATION_NOTE}`;
}

const SKILL_INVOCATION_NOTE = "要加载上面某个技能时：优先调用 use_skill（command 填该技能 <name> 里的技能名）；当前会话没有 use_skill 工具时，用 read 读取它的 <location>。技能名与路径都必须来自上面的清单，不要凭记忆拼写。技能正文里出现 ${SKILL_DIR} 或 ${CLAUDE_SKILL_DIR} 时，一律展开成该技能 <location> 所在的目录（use_skill 的返回里也写明「技能目录」）—— 每个技能各有一个值，不要套用别的技能的路径，也不要当成环境变量去查。本机是 Windows、只有 powershell 工具：技能正文里的 bash 片段要转写成等价的 PowerShell 写法（seq 用 1..N、lsof 用 Get-NetTCPConnection 或 netstat、`cmd &` 用 run_in_background）；需要常驻的服务用 powershell 的 run_in_background 起，再用 job_output 读输出、job_kill 停。技能目录里除 `node_modules` 外都不可写：技能声明的依赖可以直接在技能目录里 `npm install`（它写不了 `package-lock.json`，npm 若因此报 EPERM 就加 `--no-package-lock`）；技能脚本要落产物或缓存时，用它们自己的输出/`--dir` 参数指到会话工作目录，不要在技能目录下建其它文件。";

function toPiSkill(skill, createSyntheticSourceInfo) {
  const baseDir = dirname(skill.filePath);
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(skill.filePath, { source: "local", baseDir }),
    // pi 的 loader 口径是 `frontmatter["disable-model-invocation"] === true`，
    // 缺省即 false：这里归一到同一语义，避免 undefined 在过滤处变成「真值」。
    disableModelInvocation: skill.disableModelInvocation === true
  };
}

function sessionSkillPaths(builtinSkillsDirs, expertSkillsDir) {
  return expertSkillsDir === void 0 ? [...builtinSkillsDirs] : [...builtinSkillsDirs, expertSkillsDir];
}

function skillsSectionForMode(modeTools, skills) {
  const hasSkillLoader = modeTools.some(
    (t) => t === "read" || t === "bash" || t === "use_skill"
  );
  return hasSkillLoader ? formatSkillsSection(skills) : Promise.resolve("");
}

const DEFAULT_STYLE_ID = "professional";

const STYLE_LABELS = {
  professional: "专业严谨",
  friendly: "亲和",
  efficient: "高效",
  creative: "创意",
  sarcastic: "毒舌",
  socratic: "苏格拉底",
  straightforward: "直白"
};

export {
	ANY_SLOT,
	CUSTOM_INSTRUCTIONS_MAX,
	DEFAULT_STYLE_ID,
	INCLUDE,
	MAX_FRAGMENT_DEPTH,
	SKILL_INVOCATION_NOTE,
	SLOT,
	SNAPSHOT_SUPERSEDE_NOTE,
	STYLE_LABELS,
	appendPiContext,
	composeHiddenBlock,
	composePromptWithMeta,
	composeSubagentPrompt,
	expandIncludes,
	fillSlots,
	finalizeCore,
	formatExpertPersona,
	formatPersonalizationSection,
	formatPiContextBlock,
	formatRunTime,
	formatRuntimeContext,
	formatSkillsSection,
	formatStyleSection,
	requireExpertPersona,
	resolveSessionExpert,
	sessionSkillPaths,
	shouldAppendSnapshot,
	skillsSectionForMode,
	toExpertPersona,
	toPiSkill,
	wrapHiddenContextXml,
};