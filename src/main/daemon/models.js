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

const OWNER_KEY = "x-zerowork";

function isOwned(entry) {
  return entry[OWNER_KEY] === true;
}

function readModelsJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { providers: {} };
    throw error;
  }
  if (raw.trim() === "") return { providers: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} 不是合法 JSON，已停止操作以免覆盖你的配置。请修好或删除该文件后重试。原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} 的顶层应为对象，实际是 ${parsed === null ? "null" : typeof parsed}`);
  }
  const providers = parsed.providers;
  if (providers === void 0) return { ...parsed, providers: {} };
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    throw new Error(`${path} 的 providers 字段应为对象`);
  }
  return { ...parsed, providers };
}

function toModelsJsonModel(model, existing) {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    /*
     * thinkingLevelMap 不在表单模型里（CustomModelInput 没有该字段），
     * 只能来自用户手编 models.json。upsert 是白名单重建，不继承就会把
     * 手编的映射抹掉 —— 用户刚声明完自定义推理模型的档位，回设置页
     * 改个 baseUrl 保存，map 就没了，档位恒被 pi 裁成 off 且无处可查。
     * 按模型 id 从旧条目原样继承（形状即 pi 的形状，不做转换）。
     */
    ...existing?.thinkingLevelMap !== void 0 ? { thinkingLevelMap: existing.thinkingLevelMap } : {},
    input: model.vision ? ["text", "image"] : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    // 自建服务商多为内网/本地部署，无从得知真实价格。
    // 明确写 0 而不是省略，避免 /cost 之类的统计显示成 NaN。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

function upsertCustomProvider(path, input) {
  const config = readModelsJson(path);
  const existing = config.providers[input.id];
  if (existing !== void 0 && !isOwned(existing)) {
    throw new Error(`models.json 里已有手工配置的服务商「${input.id}」，请换一个 id 以免覆盖它。`);
  }
  const entry = {
    [OWNER_KEY]: true,
    name: input.name,
    baseUrl: input.baseUrl,
    api: input.api,
    models: input.models.map(
      (model) => toModelsJsonModel(model, existing?.models?.find((m) => m.id === model.id))
    )
  };
  if (input.api === "anthropic-messages" && input.authHeader === true) {
    entry.authHeader = true;
  }
  if (input.api === "openai-completions" && input.compat !== void 0) {
    const compat = {};
    if (input.compat.supportsDeveloperRole !== void 0) {
      compat["supportsDeveloperRole"] = input.compat.supportsDeveloperRole;
    }
    if (input.compat.supportsReasoningEffort !== void 0) {
      compat["supportsReasoningEffort"] = input.compat.supportsReasoningEffort;
    }
    if (Object.keys(compat).length > 0) entry.compat = compat;
  }
  const next = {
    ...config,
    providers: { ...config.providers, [input.id]: entry }
  };
  writeModelsJson(path, next);
  return next;
}

function upsertProviderModel(path, providerId, model) {
  const config = readModelsJson(path);
  const existing = config.providers[providerId];
  const existingModels = existing?.models ?? [];
  const upserted = toModelsJsonModel(model, existingModels.find((m) => m.id === model.id));
  const models = existingModels.some((m) => m.id === model.id) ? existingModels.map((m) => m.id === model.id ? upserted : m) : [...existingModels, upserted];
  const entry = existing !== void 0 ? { ...existing, models } : { models };
  const next = { ...config, providers: { ...config.providers, [providerId]: entry } };
  writeModelsJson(path, next);
  return next;
}

function deleteCustomProvider(path, providerId) {
  const config = readModelsJson(path);
  const existing = config.providers[providerId];
  if (existing === void 0) return config;
  if (!isOwned(existing)) {
    throw new Error(`服务商「${providerId}」是手工配置的，请直接编辑 ${path}。`);
  }
  const providers = { ...config.providers };
  delete providers[providerId];
  const next = { ...config, providers };
  writeModelsJson(path, next);
  return next;
}

function listOwnedProviderIds(path) {
  const config = readModelsJson(path);
  return Object.entries(config.providers).filter(([, entry]) => isOwned(entry)).map(([id]) => id);
}

function readCustomProvider(path, providerId) {
  const entry = readModelsJson(path).providers[providerId];
  if (entry === void 0 || !isOwned(entry)) return void 0;
  const api = entry.api;
  const isAnthropic = api === "anthropic-messages";
  return {
    id: providerId,
    name: entry.name ?? providerId,
    baseUrl: entry.baseUrl ?? "",
    // 回填形状与表单输入一致：非 anthropic（或未标）不出现该字段，
    // 「编辑再保存」才不会把 undefined 固化成 false。
    ...isAnthropic && entry.authHeader === true ? { authHeader: true } : {},
    // 落盘的 api 是自由字符串，回填时收窄到界面支持的三种，未知一律当 OpenAI 兼容。
    api: api === "anthropic-messages" || api === "google-generative-ai" || api === "openai-completions" ? api : "openai-completions",
    models: (entry.models ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextWindow: m.contextWindow ?? 128e3,
      maxTokens: m.maxTokens ?? 8192,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes("image") ?? false
    })),
    ...entry.compat !== void 0 ? {
      compat: {
        ...entry.compat["supportsDeveloperRole"] !== void 0 ? { supportsDeveloperRole: entry.compat["supportsDeveloperRole"] } : {},
        ...entry.compat["supportsReasoningEffort"] !== void 0 ? { supportsReasoningEffort: entry.compat["supportsReasoningEffort"] } : {}
      }
    } : {}
  };
}

function writeModelsJson(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}
`, "utf8");
}

/**
 * 内置服务商预设。
 *
 * 这里**刻意留空**。原版在此硬编码了一个公司内网的 API 端点，
 * 那属于企业资产，不应随开源版本分发 —— 既是对原公司的尊重，
 * 也避免使用者拿到一个指向不可达地址的默认配置。
 *
 * 使用者通过「设置 → 模型」自行添加服务商（`saveCustomProvider`
 * 接受任意 OpenAI 兼容 / Anthropic Messages 兼容的 baseUrl）。
 *
 * 若要为下游提供一个开箱可用的示例，应选择公开可访问的官方端点，
 * 且需要产品侧决策 —— 不在这里替使用者做主。
 */
const BUILTIN_PROVIDERS = [];

function ensureBuiltinProviders(path, presets = BUILTIN_PROVIDERS) {
  const existing = readModelsJson(path).providers;
  let changed = false;
  for (const preset of presets) {
    if (existing[preset.id] !== void 0) continue;
    upsertCustomProvider(path, {
      id: preset.id,
      name: preset.displayName,
      baseUrl: preset.baseUrl,
      api: preset.api,
      ...preset.authHeader === true ? { authHeader: true } : {},
      // 模型留给用户填（规则 3）。空数组走 upsertCustomProvider 是合法的：
      // 它不做表单那套「至少填一个模型」的校验（那是表单的输入约束，不是落盘约束）。
      models: []
    });
    changed = true;
  }
  return changed;
}

export {
	BUILTIN_PROVIDERS,
	OWNER_KEY,
	deleteCustomProvider,
	ensureBuiltinProviders,
	isOwned,
	listOwnedProviderIds,
	readCustomProvider,
	readModelsJson,
	toModelsJsonModel,
	upsertCustomProvider,
	upsertProviderModel,
	writeModelsJson,
};