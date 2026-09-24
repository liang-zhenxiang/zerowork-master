import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { fstatSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { openSync } from "node:fs";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readSync } from "node:fs";
import { realpathSync } from "node:fs";
import { renameSync } from "node:fs";
import { rmSync } from "node:fs";
import { statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import {
	getAuthPath,
	getConfigDir,
	getModelsPath,
	getModelsStorePath,
} from "./config-paths.js";
import {
	deleteCustomProvider,
	listOwnedProviderIds,
	readCustomProvider,
	upsertCustomProvider,
	upsertProviderModel,
} from "./models.js";
import {
	validateCustomModel,
	validateCustomProvider,
} from "./validation.js";
import {
	parseModelKey,
	removeApiKey,
	writeApiKey,
} from "./auth.js";

class ModelCatalog {
  constructor(runtime, modelsPath) {
    this.runtime = runtime;
    this.modelsPath = modelsPath;
  }
  runtime;
  modelsPath;
  static async create() {
    mkdirSync(getConfigDir(), { recursive: true });
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({
      authPath: getAuthPath(),
      modelsPath: getModelsPath(),
      modelsStorePath: getModelsStorePath(),
      // 启动不联网刷目录：内置目录已够用，联网会拖慢 daemon 启动、
      // 内网环境还可能卡到超时。用户在设置界面点「刷新」时再联网。
      allowModelNetwork: false
    });
    return new ModelCatalog(runtime, getModelsPath());
  }
  /** 设置界面一次性拉取的全部内容。技能清单恒为空数组，由 daemon 展开覆盖（见 INVOKE.settingsSnapshot）。 */
  snapshot(activeModelKey2) {
    const owned = new Set(listOwnedProviderIds(this.modelsPath));
    const providers = this.runtime.getProviders().map((provider) => this.toProviderInfo(provider.id, provider.name, owned));
    const sorted = [...providers].sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      if (a.custom !== b.custom) return a.custom ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    const configured = new Set(sorted.filter((p) => p.configured).map((p) => p.id));
    const models = this.runtime.getModels().map((model) => this.toModelInfo(model, configured));
    return {
      providers: sorted,
      models,
      activeModelId: activeModelKey2,
      configDir: getConfigDir(),
      error: this.runtime.getError()
    };
  }
  /**
   * 存入某家服务商的 API Key。
   *
   * 先落盘（api-keys.ts，pi 的 auth.json 格式）再同步本进程 ——
   * 只调 runtime.setRuntimeApiKey 是不够的：那是 non-persistent overlay
   * （RuntimeCredentials 自述），daemon 一重启 key 就丢（用户实测踩到过）。
   */
  async setApiKey(providerId, apiKey) {
    const trimmed = apiKey.trim();
    if (trimmed === "") throw new Error("API Key 不能为空");
    writeApiKey(getAuthPath(), providerId, trimmed);
    await this.runtime.setRuntimeApiKey(providerId, trimmed);
  }
  /**
   * 删除某家服务商的 API Key。
   * 只能删 auth.json 里的；环境变量来源的删不掉（设置页会如实说明）。
   */
  async removeApiKey(providerId) {
    removeApiKey(getAuthPath(), providerId);
    await this.runtime.removeRuntimeApiKey(providerId).catch(() => {
    });
  }
  /**
   * 新增或更新自定义服务商。
   *
   * apiKey 是可选的：不填表示复用已存的凭据（编辑场景常见 ——
   * 用户只想改 baseUrl，不该被迫重新输入密钥）。
   */
  async saveCustomProvider(input, apiKey) {
    const validation = validateCustomProvider(input);
    if (!validation.ok) {
      throw new Error(`配置有误：${Object.values(validation.errors).join("；")}`);
    }
    const builtinIds = new Set(this.runtime.getProviders().map((p) => p.id));
    const owned = new Set(listOwnedProviderIds(this.modelsPath));
    if (builtinIds.has(input.id) && !owned.has(input.id)) {
      throw new Error(`「${input.id}」与内置服务商同名，请换一个 id。`);
    }
    upsertCustomProvider(this.modelsPath, input);
    await this.runtime.refresh({ allowNetwork: false });
    if (apiKey !== void 0 && apiKey.trim() !== "") {
      writeApiKey(getAuthPath(), input.id, apiKey.trim());
      await this.runtime.setRuntimeApiKey(input.id, apiKey.trim());
    }
  }
  /**
   * 往预置（内置）服务商追加一个模型 —— 「添加模型」弹层的预置路径。
   *
   * 与 saveCustomProvider 分工：那条路建的是完整自建条目（baseUrl/api 齐全），
   * 并明令禁止与内置同名；这条路只往 models.json 的同 id 条目里加一个模型，
   * pi compose 时与内置目录按模型 id 合并（继承内置 baseUrl/api），
   * 落盘口径见 custom-providers.ts 的 upsertProviderModel。
   */
  async addProviderModel(providerId, model) {
    const errors = validateCustomModel(model);
    if (errors.length > 0) {
      throw new Error(`模型配置有误：${errors.join("；")}`);
    }
    if (!this.runtime.getProviders().some((p) => p.id === providerId)) {
      throw new Error(`未知服务商：${providerId}`);
    }
    upsertProviderModel(this.modelsPath, providerId, model);
    await this.runtime.refresh({ allowNetwork: false });
  }
  /** 删除自定义服务商。凭据一并清掉，避免残留在 auth.json 里。 */
  async deleteCustomProvider(providerId) {
    deleteCustomProvider(this.modelsPath, providerId);
    await this.runtime.removeRuntimeApiKey(providerId).catch(() => {
    });
    await this.runtime.refresh({ allowNetwork: false });
  }
  /** 读回自定义服务商配置，供编辑表单回填。 */
  readCustomProvider(providerId) {
    return readCustomProvider(this.modelsPath, providerId);
  }
  /** 联网刷新模型目录。用户主动点击时才调——启动时不联网。 */
  async refreshCatalog() {
    const result = await this.runtime.refresh({ allowNetwork: true });
    if (result.errors.size > 0) {
      const detail = [...result.errors.entries()].map(([id, error]) => `${id}: ${error instanceof Error ? error.message : String(error)}`).join("；");
      throw new Error(`部分服务商刷新失败 —— ${detail}`);
    }
  }
  /** 校验某个模型标识当前是否真的可用，供切换模型前把关。 */
  isUsable(modelKey) {
    const parsed = parseModelKey(modelKey);
    if (parsed === void 0) return false;
    if (this.runtime.getModel(parsed.providerId, parsed.modelId) === void 0) return false;
    return this.runtime.getProviderAuthStatus(parsed.providerId).configured;
  }
  /** 取 pi 的原生 Model 对象，供会话宿主使用。pi 类型只在 core/ 内部流转。 */
  resolveModel(modelKey) {
    const parsed = parseModelKey(modelKey);
    if (parsed === void 0) return void 0;
    return this.runtime.getModel(parsed.providerId, parsed.modelId);
  }
  /** 暴露 runtime 供会话宿主创建 AgentSession。仅限 core/ 内部使用。 */
  get modelRuntime() {
    return this.runtime;
  }
  toProviderInfo(id, name, owned) {
    const status = this.runtime.getProviderAuthStatus(id);
    const source = this.runtime.isUsingSubscription(id) ? "subscription" : status.source;
    return {
      id,
      name,
      configured: status.configured,
      source,
      credentialLabel: status.label,
      custom: owned.has(id),
      modelCount: this.runtime.getModels(id).length
    };
  }
  toModelInfo(model, configuredProviders) {
    return {
      id: model.id,
      providerId: model.provider,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      vision: model.input.includes("image"),
      // 实测发现未配凭据的服务商其模型照样出现在目录里
      // （scripts/probe-custom-provider.ts 用例 B），所以必须显式标注可用性，
      // 否则用户会选到一个点了就报错的模型。
      available: configuredProviders.has(model.provider)
    };
  }
}

function billedInputTokens(usage) {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

function reportsCacheActivity(usage) {
  return (usage.cacheRead ?? 0) > 0 || (usage.cacheWrite ?? 0) > 0;
}

function cacheHitRate(usage, cacheReported) {
  if (!cacheReported) return void 0;
  const promptTokens = billedInputTokens(usage);
  if (promptTokens === 0) return void 0;
  return usage.cacheRead / promptTokens;
}

function stepDecode(data) {
  if (data.ttftMs === void 0 || data.usage === void 0) return void 0;
  const elapsed = Math.max(0, data.endedAt - data.startedAt);
  return {
    ms: Math.max(0, elapsed - Math.max(0, data.ttftMs)),
    tokens: data.usage.output
  };
}

function contentFingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

export {
	ModelCatalog,
	billedInputTokens,
	cacheHitRate,
	contentFingerprint,
	reportsCacheActivity,
	stepDecode,
};