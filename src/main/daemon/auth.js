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

const WEB_SEARCH_PROVIDERS = [
  { id: "bocha", name: "博查", description: "国内直连，中文搜索质量好（推荐）" },
  { id: "tavily", name: "Tavily", description: "海外服务，免费额度，但国内网络常连不上" },
  { id: "brave", name: "Brave", description: "海外搜索引擎，默认隐私优先" },
  { id: "bing", name: "Bing", description: "微软搜索 API，需要 Azure 订阅" }
];

function isWebSearchProviderId(value) {
  return WEB_SEARCH_PROVIDERS.some((p) => p.id === value);
}

function readAuthFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(
      `${path} 不是合法 JSON，已停止操作以免覆盖你的凭据。请修好或删除该文件后重试。原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} 的顶层应为对象，实际是 ${parsed === null ? "null" : typeof parsed}`);
  }
  return parsed;
}

function writeApiKey(path, providerId, apiKey) {
  const data = readAuthFile(path);
  const credential = { type: "api_key", key: apiKey };
  const next = { ...data, [providerId]: credential };
  save(path, next);
}

function removeApiKey(path, providerId) {
  const data = readAuthFile(path);
  if (!(providerId in data)) return;
  const next = { ...data };
  delete next[providerId];
  save(path, next);
}

function readApiKey(path, providerId) {
  const credential = readAuthFile(path)[providerId];
  if (typeof credential !== "object" || credential === null) return void 0;
  const record = credential;
  if (record.type !== "api_key" || typeof record.key !== "string" || record.key === "") {
    return void 0;
  }
  return record.key;
}

function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}
`, { encoding: "utf-8", mode: 384 });
}

function toModelKey(providerId, modelId) {
  return `${providerId}/${modelId}`;
}

function parseModelKey(key) {
  const at = key.indexOf("/");
  if (at <= 0 || at === key.length - 1) return void 0;
  return { providerId: key.slice(0, at), modelId: key.slice(at + 1) };
}

export {
	WEB_SEARCH_PROVIDERS,
	isWebSearchProviderId,
	parseModelKey,
	readApiKey,
	readAuthFile,
	removeApiKey,
	save,
	toModelKey,
	writeApiKey,
};