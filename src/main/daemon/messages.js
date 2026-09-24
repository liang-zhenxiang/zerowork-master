import { contentFingerprint } from "./model-catalog.js";
import { estimateTokens } from "./observability.js";
import { textOf } from "./session-view.js";

function thinkingOf(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((part) => {
    if (typeof part !== "object" || part === null) return false;
    const p = part;
    return p.type === "thinking" && typeof p.thinking === "string";
  }).map((part) => part.thinking).join("");
}

function customMessageText(message) {
  if (typeof message !== "object" || message === null) return "";
  const m = message;
  if (typeof m.summary === "string") return m.summary;
  if (typeof m.output === "string") return m.output;
  return textOf(m.content);
}

function toolCallArgsText(content) {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part;
    if (p.type !== "toolCall") continue;
    text += `${typeof p.name === "string" ? p.name : ""}${JSON.stringify(p.arguments ?? null)}`;
  }
  return text;
}

function messageText(message, rawRole) {
  const content = message.content;
  if (rawRole === "assistant") {
    return textOf(content) + thinkingOf(content) + toolCallArgsText(content);
  }
  if (rawRole === "user" || rawRole === "toolResult") return textOf(content);
  return customMessageText(message);
}

function entryTokens(entry) {
  if (entry.type === "message") {
    return estimateTokens(messageText(entry.message, rawRoleOf(entry.message)));
  }
  if (entry.type === "compaction") return estimateTokens(entry.summary);
  return 0;
}

function rawRoleOf(message) {
  const role = message.role;
  return typeof role === "string" ? role : "unknown";
}

function messageClassOf(rawRole) {
  if (rawRole === "user" || rawRole === "assistant" || rawRole === "toolResult") {
    return rawRole;
  }
  return "other";
}

function messageIdBase(message, rawRole) {
  if (rawRole === "toolResult") {
    const toolCallId = message.toolCallId;
    if (typeof toolCallId === "string" && toolCallId !== "") return `toolResult:${toolCallId}`;
  }
  const timestamp = message.timestamp;
  return `${rawRole}:${typeof timestamp === "number" ? timestamp : "?"}`;
}

const IMAGE_TOKENS_EACH = 1200;

function imageTokensOf(message) {
  const content = message.content;
  if (!Array.isArray(content)) return 0;
  let images = 0;
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    if (part.type === "image") images += 1;
  }
  return images * IMAGE_TOKENS_EACH;
}

function toolDefinitionTokens(tools) {
  let tokens = 0;
  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null) continue;
    const t = tool;
    const name = typeof t.name === "string" ? t.name : "";
    const description = typeof t.description === "string" ? t.description : "";
    tokens += estimateTokens(`${name}
${description}
${JSON.stringify(t.parameters ?? null)}`);
  }
  return tokens;
}

function composeRequestComposition(messageList, messages, tools) {
  return {
    ...composeContextMessages(messageList, messages),
    toolDefinitions: toolDefinitionTokens(tools)
  };
}

function composeContextMessages(messageList, messages) {
  const composition = { conversation: 0, toolResults: 0 };
  for (const ref of messageList) {
    if (ref.role === "toolResult") composition.toolResults += ref.tokens;
    else composition.conversation += ref.tokens;
  }
  for (const message of messages) {
    const tokens = imageTokensOf(message);
    if (tokens === 0) continue;
    if (messageClassOf(rawRoleOf(message)) === "toolResult") composition.toolResults += tokens;
    else composition.conversation += tokens;
  }
  return composition;
}

function buildMessageRefs(messages) {
  const refs = [];
  const occurrences = /* @__PURE__ */ new Map();
  for (const message of messages) {
    const rawRole = rawRoleOf(message);
    const base = messageIdBase(message, rawRole);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const text = messageText(message, rawRole);
    refs.push({
      id: occurrence === 1 ? base : `${base}#${occurrence}`,
      role: messageClassOf(rawRole),
      chars: text.length,
      tokens: estimateTokens(text),
      fp: contentFingerprint(text)
    });
  }
  return refs;
}

export {
	IMAGE_TOKENS_EACH,
	buildMessageRefs,
	composeContextMessages,
	composeRequestComposition,
	customMessageText,
	entryTokens,
	imageTokensOf,
	messageClassOf,
	messageIdBase,
	messageText,
	rawRoleOf,
	thinkingOf,
	toolCallArgsText,
	toolDefinitionTokens,
};