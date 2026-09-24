import { basename } from "node:path";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { extname } from "node:path";
import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import { join } from "node:path";
import { normalize as normalize$1 } from "node:path";
import { Readability } from "@mozilla/readability";
import { relative } from "node:path";
import { resolve } from "node:path";
import { sep } from "node:path";
import { AUDIT_OUTCOME_LABELS } from "./audit.js";
import { toolOutcomeFrom } from "./ledger.js";
import {
	formatTimestamp,
	sanitizeExportTitle,
} from "./skills.js";

function buildExportPath(exportsDir, title, now) {
  return join(exportsDir, `${sanitizeExportTitle(title)}-${formatTimestamp(now)}.html`);
}

const CHILD_AGENTS_DETAILS_KEY = "subagents";

function childAgentsOf(details) {
  if (typeof details !== "object" || details === null) return void 0;
  const subagents = details[CHILD_AGENTS_DETAILS_KEY];
  return Array.isArray(subagents) ? subagents : void 0;
}

const TIMELINE_MAX = 12;

const OMITTED_MARKER = /^（前 (\d+) 条已省略）$/;

function appendTimeline(entry, text) {
  const previous = entry.timeline ?? [];
  const omittedBefore = OMITTED_MARKER.exec(previous[0] ?? "")?.[1];
  const real = omittedBefore === void 0 ? previous : previous.slice(1);
  const total = Number(omittedBefore ?? 0) + real.length + 1;
  if (total <= TIMELINE_MAX) {
    return { ...entry, timeline: [...real, text], activity: text };
  }
  const dropped = total - TIMELINE_MAX;
  const keep = [...real, text].slice(-TIMELINE_MAX);
  return { ...entry, timeline: [`（前 ${dropped} 条已省略）`, ...keep], activity: text };
}

class ChildAgentsProjection {
  entries;
  /**
   * @param plan 骨架（初始化即全 queued：工具卡从执行开始就能摆出全部分组，
   *        而不是等第一个子代理起跑才有内容）
   * @param kind 子代理种类；缺省 undefined（= subagent，task 工具不写，
   *        旧格式会话兼容），团队工具传 "team"
   */
  constructor(plan, kind) {
    this.entries = plan.map((entry) => ({
      agent: entry.agent,
      task: entry.task,
      ...kind === void 0 ? {} : { kind },
      status: "queued",
      activity: "",
      turns: 0,
      ...entry.model === void 0 ? {} : { model: entry.model }
    }));
  }
  /** 全量快照（深拷贝本体引用，消费端可安全持有）。 */
  snapshot() {
    return this.entries.map((entry) => ({ ...entry }));
  }
  /**
   * 局部迁移（状态翻转 / 终态回填）。越界下标是 no-op 而不是抛错：
   * 并行模式下计划与执行的错位不该炸掉整个委派。
   */
  patch(index, partial) {
    const current = this.entries[index];
    if (current === void 0) return;
    this.entries[index] = { ...current, ...partial };
  }
  /**
   * 追加一条动作行：activity 与 timeline 同步推进，卡片的「最新动作」与
   * 可展开过程永远一致。空文本 no-op（无进展时执行器发的是空串）。
   */
  pushActivity(index, text) {
    const current = this.entries[index];
    if (current === void 0 || text === "") return;
    this.entries[index] = appendTimeline(current, text);
  }
}

const RUNTIME_STATUS_LABELS = {
  ready: "就绪",
  missing: "未安装",
  failed: "安装失败",
  disabled: "已被用户禁用"
};

function runtimeStatusHint(status) {
  switch (status.kind) {
    case "ready":
      return "";
    case "disabled":
      return "该运行时已被用户禁用：不要调用它、也不要尝试安装它（系统里若有同名的解释器 / 工具，照常可用）。确实需要我们这一份时，如实告诉用户「这个运行时已被你在设置里关掉」，并请他到「设置 → 内置运行时」重新打开。";
    case "missing":
      return "该运行时尚未安装（不会自动下载）—— 这**只说明我们这份副本没有，不代表这件事做不到**：系统里已有同名的解释器 / 工具时照常可用，先动手试。确实需要我们这一份（版本可控）时，告诉用户在「设置 → 内置运行时」点「安装」（需联网）；不要自己安装。";
    case "failed":
      return "该运行时上次安装没有装完（含用户主动取消，那不是故障）—— 同样**不代表这件事做不到**，系统里已有同名工具时照常可用。要装我们这一份，请用户在「设置 → 内置运行时」看「诊断」或点「重试安装」；不要自己安装。";
  }
}

function renderRuntimeEnvSection(inventory) {
  if (inventory.items.length === 0) return "";
  const lines = [
    "托管运行时（随应用提供的**钉版副本**，按需安装、不会自动下载）：**系统里已有同名的解释器 / 工具时照常可用**，不需要非用我们这一份；别因为下面某一项不是「就绪」就判定这件事做不到 —— 先动手试，被拒时按拒绝说明走。"
  ];
  for (const item of inventory.items) {
    const label = RUNTIME_STATUS_LABELS[item.status.kind];
    lines.push(`- ${item.id} ${item.version} · ${label} · ${item.purpose}`);
    if (item.status.kind !== "disabled") {
      if (item.activeDir !== void 0) lines.push(`  目录：${item.activeDir}`);
      if (item.executable !== void 0) {
        lines.push(`  ${item.executableLabel ?? "可执行文件"}：${item.executable}`);
      }
    }
    const hint = runtimeStatusHint(item.status);
    if (hint !== "") lines.push(`  ${hint}`);
  }
  return lines.join("\n");
}

const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|\\\\|\/)/;

const HTTP_URL = /^https?:\/\//i;

const HTML_FILE = /\.html?$/i;

function classifyPresentedFiles(input, sizeOf) {
  const invalid = [];
  const missing = [];
  const files = [];
  let focusFile;
  for (const raw of input) {
    if (HTTP_URL.test(raw)) {
      files.push({ path: raw, size: 0, html: false, kind: "url" });
      continue;
    }
    if (!ABSOLUTE_PATH.test(raw)) {
      invalid.push(raw);
      continue;
    }
    const probe = sizeOf(raw);
    if (probe === "missing") missing.push(raw);
    files.push({
      path: raw,
      size: probe === "outside" || probe === "missing" ? 0 : probe,
      html: HTML_FILE.test(raw),
      kind: "local"
    });
    if (focusFile === void 0) focusFile = raw;
  }
  return { files, focusFile, invalid, missing };
}

function countLines(text) {
  if (text === "") return 0;
  return text.split("\n").length;
}

const DIFF_CELL_BUDGET = 4e6;

function lcsLength(oldLines, newLines) {
  const [a, b] = oldLines.length >= newLines.length ? [oldLines, newLines] : [newLines, oldLines];
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = new Array(b.length + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      const diag = prev[j - 1] ?? 0;
      curr[j] = ai === b[j - 1] ? diag + 1 : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

const DIFF_CONTEXT = 3;

function computeLineDiff(oldText, newText) {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  if (oldLines.length * newLines.length > DIFF_CELL_BUDGET) {
    return { added: newLines.length, removed: oldLines.length };
  }
  const common = lcsLength(oldLines, newLines);
  return {
    added: newLines.length - common,
    removed: oldLines.length - common,
    diff: buildHunks(oldLines, newLines)
  };
}

function buildHunks(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i2 = m - 1; i2 >= 0; i2 -= 1) {
    for (let j2 = n - 1; j2 >= 0; j2 -= 1) {
      const skipOld = dp[i2 + 1]?.[j2] ?? 0;
      const skipNew = dp[i2]?.[j2 + 1] ?? 0;
      const both = dp[i2 + 1]?.[j2 + 1] ?? 0;
      const row = dp[i2];
      if (row !== void 0) {
        row[j2] = oldLines[i2] === newLines[j2] ? both + 1 : Math.max(skipOld, skipNew);
      }
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push([oldLines[i] ?? "", " "]);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push([oldLines[i] ?? "", "-"]);
      i += 1;
    } else {
      ops.push([newLines[j] ?? "", "+"]);
      j += 1;
    }
  }
  while (i < m) {
    ops.push([oldLines[i] ?? "", "-"]);
    i += 1;
  }
  while (j < n) {
    ops.push([newLines[j] ?? "", "+"]);
    j += 1;
  }
  const changeIdx = [];
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k]?.[1] !== " ") changeIdx.push(k);
  }
  if (changeIdx.length === 0) return "";
  const blocks = [];
  let bs = changeIdx[0] ?? 0;
  let prev = bs;
  for (const idx of changeIdx) {
    if (idx - prev > DIFF_CONTEXT * 2) {
      blocks.push([bs, prev]);
      bs = idx;
    }
    prev = idx;
  }
  blocks.push([bs, prev]);
  const hunks = [];
  for (const [cs, ce] of blocks) {
    const start2 = Math.max(0, cs - DIFF_CONTEXT);
    const end = Math.min(ops.length - 1, ce + DIFF_CONTEXT);
    const slice = ops.slice(start2, end + 1);
    const oldCount = slice.filter(([, p]) => p !== "+").length;
    const newCount = slice.filter(([, p]) => p !== "-").length;
    const oldStart = ops.slice(0, start2).filter(([, p]) => p !== "+").length + 1;
    const newStart = ops.slice(0, start2).filter(([, p]) => p !== "-").length + 1;
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const [line, prefix] of slice) hunks.push(`${prefix}${line}`);
  }
  return hunks.join("\n");
}

function unescapeJsonString(fragment) {
  return fragment.replace(/\\(.)/g, (_m, ch) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "	";
    if (ch === "r") return "\r";
    return ch;
  });
}

function writeStreamProgress(rawArgs) {
  const pathMatch = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rawArgs);
  const path = pathMatch?.[1] === void 0 ? void 0 : unescapeJsonString(pathMatch[1]);
  const contentMatch = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(rawArgs);
  const fragment = contentMatch?.[1] ?? "";
  const newlines = (fragment.match(/\\n/g) ?? []).length;
  const added = fragment === "" ? 0 : newlines + 1;
  return { path, added };
}

function changeFromWrite(args, oldContent) {
  if (typeof args !== "object" || args === null) return void 0;
  const { path, content } = args;
  if (typeof path !== "string" || typeof content !== "string") return void 0;
  if (oldContent === void 0) {
    return { path, added: countLines(content), removed: 0, changeType: "created" };
  }
  const { added, removed, diff } = computeLineDiff(oldContent, content);
  return { path, added, removed, changeType: "modified", ...diff === "" ? {} : { diff } };
}

function applyEdits(oldContent, edits) {
  let content = oldContent;
  for (const { oldText, newText } of edits) {
    const at = content.indexOf(oldText);
    if (at === -1) return void 0;
    content = content.slice(0, at) + newText + content.slice(at + oldText.length);
  }
  return content;
}

function changeFromEdit(args, oldContent) {
  if (typeof args !== "object" || args === null) return void 0;
  const { path, edits } = args;
  if (typeof path !== "string" || !Array.isArray(edits)) return void 0;
  const pairs = [];
  for (const edit of edits) {
    if (typeof edit !== "object" || edit === null) return void 0;
    const { oldText, newText } = edit;
    if (typeof oldText !== "string" || typeof newText !== "string") return void 0;
    pairs.push({ oldText, newText });
  }
  const applied = oldContent === void 0 ? void 0 : applyEdits(oldContent, pairs);
  if (applied !== void 0) {
    const { added: added2, removed: removed2, diff } = computeLineDiff(oldContent, applied);
    return { path, added: added2, removed: removed2, changeType: "modified", ...diff === "" ? {} : { diff } };
  }
  let added = 0;
  let removed = 0;
  for (const { oldText, newText } of pairs) {
    removed += countLines(oldText);
    added += countLines(newText);
  }
  return { path, added, removed, changeType: "modified" };
}

function mergePresentedArtifacts(current, files, at) {
  const fresh = new Set(files.map((f) => f.path));
  const kept = current.filter((a) => !fresh.has(a.path));
  return [...kept, ...files.map((f) => ({ path: f.path, size: f.size, at }))];
}

const TODO_STATUSES = ["pending", "in_progress", "completed"];

function isTodoStatus(value) {
  return typeof value === "string" && TODO_STATUSES.includes(value);
}

function parseTodoArgs(args) {
  if (typeof args !== "object" || args === null) return void 0;
  const { todos } = args;
  if (!Array.isArray(todos)) return void 0;
  const clean = [];
  for (const item of todos) {
    if (typeof item !== "object" || item === null) continue;
    const record = item;
    if (typeof record.content !== "string" || record.content === "") continue;
    if (!isTodoStatus(record.status)) continue;
    clean.push({
      content: record.content,
      ...typeof record.activeForm === "string" && record.activeForm !== "" ? { activeForm: record.activeForm } : {},
      status: record.status
    });
  }
  return clean;
}

const DEFAULT_MAX_RAW_BYTES = 5 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS$1 = 15e3;

function isPrivateIpLiteral(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (normalized === "") return false;
  if (!isIP(normalized)) return false;
  const parts = normalized.split(".");
  if (parts.length === 4) {
    const [a, b, c, d] = parts.map((p) => Number(p));
    if (a === void 0 || b === void 0 || c === void 0 || d === void 0) return false;
    if (a === 127 || a === 10) return true;
    if (a === 172 && b !== void 0 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  const lower = normalized.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:127") || lower.startsWith("::ffff:") && isPrivateIpBody(lower.slice(7))) {
    return true;
  }
  return false;
}

function isPrivateIpBody(body) {
  const parts = body.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((p) => Number(p));
  if (a === void 0 || b === void 0) return false;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function verifyTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { reason: `无法解析的网址：${rawUrl}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { reason: `只支持 http/https 链接（收到 ${parsed.protocol}）` };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || isPrivateIpLiteral(host)) {
    return { reason: `出于安全考虑不抓取内网地址：${host}` };
  }
  return { url: parsed };
}

async function fetchPage(rawUrl, options = {}) {
  const maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS$1;
  const fetchImpl = options.fetchImpl ?? fetch;
  const target = verifyTarget(rawUrl);
  if (target.reason !== void 0) throw new Error(target.reason);
  const response = await fetchImpl(target.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      // 常规浏览器 UA：部分站点拒绝无 UA 请求。
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ZeroWork/0.1",
      accept: "text/html,application/xhtml+xml"
    }
  });
  const finalUrl = verifyTarget(response.url);
  if (finalUrl.reason !== void 0) throw new Error(finalUrl.reason);
  if (!response.ok) {
    throw new Error(`目标返回 HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error(`目标不是 HTML 页面（Content-Type: ${contentType}），无法提取正文`);
  }
  const rawText = await readLimited(response.body, maxRawBytes);
  const [{ parseHTML }, { default: TurndownService }] = await Promise.all([
    import("linkedom"),
    import("turndown")
  ]);
  const { document } = parseHTML(rawText);
  const finalName = finalUrl.url.hostname;
  if (document.documentElement === null) {
    throw new Error(
      `未能从 ${finalName === "" ? "该页面" : finalName} 提取到内容（响应体是空的，或没有可解析的 HTML）`
    );
  }
  const reader = new Readability(document);
  const article = reader.parse();
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*"
  });
  turndown.remove(["hr", "script", "style", "noscript", "iframe", "nav", "footer"]);
  turndown.addRule("multiLink", {
    filter: "a",
    replacement: (_content, node) => {
      const href = (node.getAttribute("href") ?? "").trim();
      const text = node.textContent?.trim() ?? "";
      if (href === "" || href.startsWith("#") || href.startsWith("javascript:")) return text;
      return text === href ? href : `[${text}](${href})`;
    }
  });
  const rawMarkdown = article !== null && typeof article.content === "string" && article.content !== "" ? turndown.turndown(article.content) : turndown.turndown(String((document.body ?? document.documentElement).outerHTML));
  const markdown = normalizeWhitespace(rawMarkdown);
  if (markdown.trim().length < 20) {
    throw new Error(`未能从 ${finalName === "" ? "该页面" : finalName} 提取到正文（可能需要登录，或不是 HTML 页面）`);
  }
  const articleTitle = article?.title;
  const title = articleTitle === void 0 || articleTitle === null || articleTitle.trim() === "" ? finalName : articleTitle.trim();
  return {
    title,
    url: response.url,
    markdown
  };
}

async function readLimited(body, maxBytes) {
  if (body === null) throw new Error("响应没有内容体");
  const reader = body.getReader();
  const chunks = [];
  let received = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === void 0) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel().catch(() => void 0);
      throw new Error(`页面超过 ${Math.round(maxBytes / 1024 / 1024)}MB，已拒绝抓取`);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function normalizeWhitespace(text) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function safeSourceUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return void 0;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
  if (parsed.username !== "" || parsed.password !== "") return void 0;
  const host = parsed.hostname.toLowerCase();
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return void 0;
  if (isPrivateIpLiteral(host)) return void 0;
  return parsed;
}

function parseSources(details) {
  if (typeof details !== "object" || details === null) return void 0;
  const { results } = details;
  if (!Array.isArray(results)) return void 0;
  const clean = [];
  for (const item of results) {
    if (typeof item !== "object" || item === null) continue;
    const record = item;
    if (typeof record.title !== "string" || record.title === "") continue;
    if (typeof record.url !== "string" || record.url === "") continue;
    const parsed = safeSourceUrl(record.url);
    if (parsed === void 0) continue;
    clean.push({
      title: record.title,
      url: record.url,
      // WebSearchResult.description → SourceRef.snippet；空串不占字段
      // （与 activeForm/images 的「空值键缺席」口径一致）。
      ...typeof record.description === "string" && record.description !== "" ? { snippet: record.description } : {},
      // publishedAt 不下发：SourceRef 没有该字段，UI 不展示。
      site: parsed.hostname.toLowerCase().replace(/^www\./, "")
    });
  }
  return clean;
}

const SKILL_COMMAND_PREFIX = "skill:";

const SKILL_INVOCATION_PREFIX = `/${SKILL_COMMAND_PREFIX}`;

const WHITESPACE = /\s/;

function takeSkillCommands(text) {
  const names = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (!text.startsWith(SKILL_INVOCATION_PREFIX, cursor)) break;
    const nameStart = cursor + SKILL_INVOCATION_PREFIX.length;
    let nameEnd = nameStart;
    while (nameEnd < text.length && !WHITESPACE.test(text[nameEnd] ?? "")) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd);
    if (name === "") break;
    names.push(name);
    cursor = nameEnd;
    while (cursor < text.length && WHITESPACE.test(text[cursor] ?? "")) cursor += 1;
  }
  if (names.length === 0) return { names: [], text };
  return { names, text: text.slice(cursor) };
}

function skillBlockText(source) {
  return `<skill name="${source.name}" location="${source.filePath}">
技能目录：${source.baseDir}
References are relative to ${source.baseDir}.

${source.body}
</skill>`;
}

const OPEN_TAG = /^<skill(?:\s[^>]*)?>/;

const ATTRIBUTE = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;

const CLOSE_TAG = "</skill>";

function readAttribute(tag, key) {
  for (const match of tag.matchAll(ATTRIBUTE)) {
    if (match[1] === key && match[2] !== "") return match[2];
  }
  return void 0;
}

function splitSkillBlocks(text) {
  if (!text.startsWith("<skill")) return { skillNames: [], text };
  const skillNames = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = OPEN_TAG.exec(text.slice(cursor));
    if (open === null) break;
    const name = readAttribute(open[0], "name");
    if (name === void 0) break;
    const close = text.indexOf(CLOSE_TAG, cursor + open[0].length);
    if (close === -1) break;
    skillNames.push(name);
    cursor = close + CLOSE_TAG.length;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  }
  if (skillNames.length === 0) return { skillNames: [], text };
  return { skillNames, text: text.slice(cursor).trim() };
}

const DETAIL_LIMIT = 4e3;

const TRUNCATED_MARK = "（已截断）";

function userView(content) {
  if (typeof content === "string") {
    const { text: text2, skillNames: skillNames2 } = splitSkillBlocks(content);
    return { text: text2, images: [], skillNames: skillNames2 };
  }
  let text = "";
  const images = [];
  for (const block of content) {
    if (block.type === "text") text += block.text;
    else images.push({ type: "image", data: block.data, mimeType: block.mimeType });
  }
  const { text: displayText, skillNames } = splitSkillBlocks(text);
  return { text: displayText, images, skillNames };
}

function textOf$1(content) {
  let text = "";
  for (const block of content) if (block.type === "text") text += block.text;
  return text;
}

function thinkingOf$1(content) {
  let thinking = "";
  for (const block of content) if (block.type === "thinking") thinking += block.thinking;
  return thinking;
}

function toTokenUsage(usage) {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: usage.cost.total,
    ...usage.reasoning === void 0 ? {} : { reasoning: usage.reasoning },
    ...usage.cacheWrite1h === void 0 ? {} : { cacheWrite1h: usage.cacheWrite1h },
    costBreakdown: {
      input: usage.cost.input,
      output: usage.cost.output,
      cacheRead: usage.cost.cacheRead,
      cacheWrite: usage.cost.cacheWrite
    }
  };
}

function summarizeArgs(args) {
  if (typeof args !== "object" || args === null) return { summary: "" };
  const record = args;
  for (const key of [
    "path",
    "file_path",
    "filePath",
    "pattern",
    "query",
    "description",
    "command",
    "dir"
  ]) {
    const value = record[key];
    if (typeof value !== "string" || value === "") continue;
    if (key === "description") {
      const command = record["command"];
      if (typeof command === "string" && command !== "") {
        return { summary: value, title: command };
      }
    }
    return { summary: value };
  }
  const files = record.files;
  if (Array.isArray(files)) return { summary: `${files.length} 个文件` };
  return { summary: "" };
}

function detailOf$1(result, toolName) {
  let text = "";
  for (const block of result.content) if (block.type === "text") text += block.text;
  if (text === "") return void 0;
  if (toolName !== "show_widget" && text.length > DETAIL_LIMIT) {
    return text.slice(0, DETAIL_LIMIT) + TRUNCATED_MARK;
  }
  return text;
}

function buildConversationEntries(entries, resolveToolLabel) {
  const results = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
  }
  const out = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    const at = Date.parse(entry.timestamp);
    if (message.role === "user") {
      const { text, images, skillNames } = userView(message.content);
      const user = {
        id: entry.id,
        role: "user",
        text,
        // 没有图片时键必须缺席（thinking 键缺席同理）：空数组会让 UI 渲染一行空缩略图。
        ...images.length === 0 ? {} : { images },
        // 技能同理：空数组会让 UI 渲染一行空胶囊行。
        ...skillNames.length === 0 ? {} : { skillNames },
        at
      };
      out.push(user);
      continue;
    }
    if (message.role === "assistant") {
      const thinking = thinkingOf$1(message.content);
      const assistant = {
        id: entry.id,
        role: "assistant",
        text: textOf$1(message.content),
        // 模型没输出思考时键必须缺席：空串会让 UI 渲染一个空思考折叠块。
        ...thinking === "" ? {} : { thinking },
        // usage 在 pi 类型上必填，但 JSONL 是落盘数据（旧版本 / 中断写入可能缺），缺则不下发。
        ...message.usage === void 0 ? {} : { usage: toTokenUsage(message.usage) },
        at
      };
      out.push(assistant);
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const result = results.get(block.id);
        const outcome = result === void 0 ? "aborted" : toolOutcomeFrom(result.isError, result.details);
        const todos = block.name === "todo_write" ? parseTodoArgs(block.arguments) : void 0;
        const sources = block.name === "web_search" && result !== void 0 ? parseSources(result.details) : void 0;
        const argSummary = summarizeArgs(block.arguments);
        const card = {
          id: block.id,
          role: "tool",
          toolName: block.name,
          label: resolveToolLabel?.(block.name, outcome) ?? block.name,
          summary: argSummary.summary,
          outcome,
          detail: result === void 0 ? void 0 : detailOf$1(result, block.name),
          // 摘要顶掉了入参原值（shell 的描述顶掉命令）时把原值带上，卡头 hover
          // 才看得到 —— 与 live 路径逐字一致（session-host 的 tool_started）。
          ...argSummary.title === void 0 ? {} : { summaryTitle: argSummary.title },
          ...todos === void 0 ? {} : { todos },
          ...sources === void 0 ? {} : { sources },
          at
        };
        out.push(card);
      }
      continue;
    }
  }
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType !== "artifacts_presented") continue;
    const data = entry.data;
    if (data?.files === void 0) continue;
    out.push({
      id: entry.id,
      role: "artifacts_presented",
      files: data.files,
      focusFile: data.focusFile,
      at: Date.parse(entry.timestamp)
    });
  }
  return out;
}

function countSkippedLines(content) {
  let skipped = 0;
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      JSON.parse(line);
    } catch {
      skipped += 1;
    }
  }
  return skipped;
}

function validateSessionFilePath(path, sessionsDir) {
  if (!isAbsolute(path)) return "会话文件必须是绝对路径";
  const normalize2 = (p) => {
    const resolved = resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const dir = normalize2(sessionsDir);
  const target = normalize2(path);
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  if (!target.startsWith(prefix)) return "会话文件必须位于会话目录内";
  if (!target.toLowerCase().endsWith(".jsonl")) return "会话文件必须是 .jsonl 文件";
  return void 0;
}

function normalizeLegacyInteraction(interactionId, expertId) {
  return {
    interactionId: interactionId === "expert" ? "craft" : interactionId,
    expertId
  };
}

const DEFAULT_TOOLS = ["read", "write", "edit", "find", "grep", "ls"];

const DELEGATE_MODE_TOOLS = [
  "team_create",
  "team_send",
  "team_status",
  "team_shutdown",
  "team_delete",
  "team_task_create",
  "team_task_update",
  "team_task_list",
  "team_delegate_mode",
  "questionnaire",
  "todo_write",
  "conversation_search",
  "read_me",
  "show_widget",
  "present_files"
];

const DELTA_FLUSH_MS = 16;

const TOOL_RUNNING_LABELS = {
  read: "读取中",
  read_document: "阅读文档",
  // read_me 用专属名词（tool.visualizerReadMe：「读取可视化指南中...」）。
  // 通用「读取中」会让这行看起来像在读用户的项目文件 —— 它读的是设计指南，
  // 是内部准备步骤，词汇上就该区分开。
  read_me: "读取可视化指南中",
  ls: "列出中",
  grep: "搜索中",
  find: "查找中",
  bash: "执行中",
  powershell: "执行中",
  web_search: "搜索中",
  web_fetch: "抓取中",
  conversation_search: "检索中",
  present_files: "交付中",
  // show_widget 的执行是毫秒级纯校验，生命周期几乎全在参数生成期 ——
  // 与 write 同词汇（tool.writeFile 的「生成中」）。
  show_widget: "生成中",
  // 等待用户作答期间卡片停在这个标题上（问卷弹层本身承载等待态）。
  questionnaire: "向用户提问",
  // 子代理委派：运行中的阶段性进展（哪个 agent 在干什么）走 tool_progress 增量。
  task: "子任务",
  // 清单卡标题全程稳定为「任务列表」（与工具注册的 label 一致，完成态同词
  // 见 TOOL_DONE_LABELS）：卡片本体就是清单渲染，进度由 todos 内容表达，
  // 标题不随 执行中/已完成 跳变。
  todo_write: "任务列表",
  // 与工具注册的 label 同词（动作词：「正在加载技能 xxx」）。
  use_skill: "加载技能",
  // 与工具注册的 label 同词（动作词；执行态是本地读 docx → 落 HTML + 图片）。
  docx_extract: "提取文档版式"
};

const TOOL_DONE_LABELS = {
  read: "已读取",
  read_document: "已阅读",
  // 同 TOOL_RUNNING_LABELS：专属名词，别和「已读取 <用户文件>」混在一起。
  read_me: "已读取可视化指南",
  ls: "已列出",
  grep: "已搜索",
  find: "已查找",
  bash: "已执行",
  powershell: "已执行",
  web_search: "已搜索",
  web_fetch: "已抓取",
  conversation_search: "已检索",
  present_files: "已交付",
  show_widget: "已生成",
  questionnaire: "已回答",
  task: "已完成",
  todo_write: "任务列表",
  use_skill: "已加载",
  docx_extract: "已提取"
};

const STREAM_CARD_TOOLS = [
  "write",
  "edit",
  "web_search",
  "web_fetch",
  "show_widget",
  "todo_write"
];

function runningLabel(toolName) {
  return TOOL_RUNNING_LABELS[toolName] ?? toolName;
}

function writeDoneLabel(changeType, outcome) {
  if (outcome === "ok") return changeType === "created" ? "已生成" : "已修改";
  return changeType === "created" ? "生成失败" : "修改失败";
}

function doneLabel(toolName, outcome) {
  if (outcome === "blocked") return AUDIT_OUTCOME_LABELS.blocked;
  if (outcome !== "ok") return "失败";
  return TOOL_DONE_LABELS[toolName] ?? toolName;
}

function restoredToolLabel(toolName, outcome) {
  if (outcome !== "ok") {
    if (toolName === "write") return "生成（未完成）";
    if (toolName === "edit") return "修改（未完成）";
    if (toolName === "show_widget") return "生成（未完成）";
    return doneLabel(toolName, outcome);
  }
  if (toolName === "write") return writeDoneLabel("created", "ok");
  if (toolName === "edit") return writeDoneLabel("modified", "ok");
  return doneLabel(toolName, "ok");
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => {
    if (typeof part !== "object" || part === null) return false;
    const p = part;
    return p.type === "text" && typeof p.text === "string";
  }).map((part) => part.text).join("");
}

function toPiImages(images) {
  if (images === void 0 || images.length === 0) return void 0;
  return images.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mimeType
  }));
}

function userContentOf(content) {
  if (typeof content === "string") return { text: content, images: void 0 };
  if (!Array.isArray(content)) return { text: "", images: void 0 };
  let text = "";
  const images = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part;
    if (p.type === "text" && typeof p.text === "string") {
      text += p.text;
    } else if (p.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string") {
      images.push({ type: "image", data: p.data, mimeType: p.mimeType });
    }
  }
  return { text, images: images.length === 0 ? void 0 : images };
}

function toolResultText(result) {
  if (typeof result !== "object" || result === null) return "";
  const content = result.content;
  return textOf(content);
}

function toolResultDetails(result) {
  if (typeof result !== "object" || result === null) return void 0;
  return result.details;
}

let hostGeneration = 0;

function nextHostGeneration() {
  hostGeneration += 1;
  return hostGeneration;
}

export {
	ABSOLUTE_PATH,
	ATTRIBUTE,
	CHILD_AGENTS_DETAILS_KEY,
	CLOSE_TAG,
	ChildAgentsProjection,
	DEFAULT_MAX_RAW_BYTES,
	DEFAULT_TIMEOUT_MS$1,
	DEFAULT_TOOLS,
	DELEGATE_MODE_TOOLS,
	DELTA_FLUSH_MS,
	DETAIL_LIMIT,
	DIFF_CELL_BUDGET,
	DIFF_CONTEXT,
	HTML_FILE,
	HTTP_URL,
	OMITTED_MARKER,
	OPEN_TAG,
	RUNTIME_STATUS_LABELS,
	SKILL_COMMAND_PREFIX,
	SKILL_INVOCATION_PREFIX,
	STREAM_CARD_TOOLS,
	TIMELINE_MAX,
	TODO_STATUSES,
	TOOL_DONE_LABELS,
	TOOL_RUNNING_LABELS,
	TRUNCATED_MARK,
	WHITESPACE,
	appendTimeline,
	applyEdits,
	buildConversationEntries,
	buildExportPath,
	buildHunks,
	changeFromEdit,
	changeFromWrite,
	childAgentsOf,
	classifyPresentedFiles,
	computeLineDiff,
	countLines,
	countSkippedLines,
	detailOf$1,
	doneLabel,
	fetchPage,
	hostGeneration,
	isPrivateIpBody,
	isPrivateIpLiteral,
	isTodoStatus,
	lcsLength,
	mergePresentedArtifacts,
	nextHostGeneration,
	normalizeLegacyInteraction,
	normalizeWhitespace,
	parseSources,
	parseTodoArgs,
	readAttribute,
	readLimited,
	renderRuntimeEnvSection,
	restoredToolLabel,
	runningLabel,
	runtimeStatusHint,
	safeSourceUrl,
	skillBlockText,
	splitSkillBlocks,
	summarizeArgs,
	takeSkillCommands,
	textOf,
	textOf$1,
	thinkingOf$1,
	toPiImages,
	toTokenUsage,
	toolResultDetails,
	toolResultText,
	unescapeJsonString,
	userContentOf,
	userView,
	validateSessionFilePath,
	verifyTarget,
	writeDoneLabel,
	writeStreamProgress,
};