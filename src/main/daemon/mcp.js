import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { applyEdits as applyEdits$1 } from "jsonc-parser";
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
import { modify } from "jsonc-parser";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { parse } from "jsonc-parser";
import { printParseErrorCode } from "jsonc-parser";
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
import { getMcpConfigPath } from "./config-paths.js";
import {
	isRecord$1,
	isStringRecord,
} from "./validation.js";

class McpConfigError extends Error {
}

const PROJECT_CONFIG_FILE = ".mcp.json";

function readMcpConfig(cwd) {
  const user = readFileIfExists(getMcpConfigPath());
  const project = hasWorkspace$1(cwd) ? readFileIfExists(join(cwd, PROJECT_CONFIG_FILE)) : {};
  return { servers: { ...user, ...project } };
}

function hasWorkspace$1(cwd) {
  return cwd !== void 0 && cwd !== "";
}

function readFileIfExists(path) {
  const text = readTextIfExists(path);
  if (text === void 0) return {};
  return parseMcpJsonc(text, path);
}

function readTextIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new McpConfigError(`无法读取 ${path}：${error.message}`);
  }
}

function parseMcpJsonc(text, source) {
  const errors = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  if (errors.length > 0) {
    const first = errors[0];
    if (first !== void 0) {
      throw new McpConfigError(
        `${source} 不是合法的 JSONC：${printParseErrorCode(first.error)}（偏移 ${first.offset}）`
      );
    }
  }
  if (!isRecord$1(parsed)) {
    throw new McpConfigError(`${source} 必须是 {"mcpServers": {...}} 结构`);
  }
  const mcpServers = parsed["mcpServers"];
  if (mcpServers === void 0) return {};
  if (!isRecord$1(mcpServers)) {
    throw new McpConfigError(`${source} 的 mcpServers 必须是对象（server 名 → 配置）`);
  }
  const expanded = expandEnvVars(mcpServers, source);
  const out = {};
  for (const [name, raw] of Object.entries(expanded)) {
    out[name] = parseServer(name, raw, source);
  }
  return out;
}

function parseServer(name, raw, source) {
  if (!isRecord$1(raw)) {
    throw new McpConfigError(`${source}：server「${name}」的配置必须是对象`);
  }
  const hasCommand = "command" in raw;
  const hasUrl = "url" in raw;
  if (hasCommand && hasUrl) {
    throw new McpConfigError(
      `${source}：server「${name}」同时配置了 command 和 url，二者只能留一个（stdio 或 HTTP）`
    );
  }
  const disabled = parseDisabled(name, raw["disabled"], source);
  if (hasCommand) {
    const command = raw["command"];
    if (typeof command !== "string" || command.trim() === "") {
      throw new McpConfigError(`${source}：server「${name}」的 command 必须是非空字符串`);
    }
    const args = raw["args"];
    if (args !== void 0 && (!Array.isArray(args) || args.some((a) => typeof a !== "string"))) {
      throw new McpConfigError(`${source}：server「${name}」的 args 必须是字符串数组`);
    }
    const env = raw["env"];
    if (env !== void 0 && !isStringRecord(env)) {
      throw new McpConfigError(`${source}：server「${name}」的 env 必须是 字符串→字符串 的对象`);
    }
    return {
      transport: "stdio",
      command,
      args: args ?? [],
      env: env ?? {},
      ...disabled === void 0 ? {} : { disabled }
    };
  }
  if (hasUrl) {
    const url = raw["url"];
    if (typeof url !== "string" || url.trim() === "") {
      throw new McpConfigError(`${source}：server「${name}」的 url 必须是非空字符串`);
    }
    return { transport: "http", url, ...disabled === void 0 ? {} : { disabled } };
  }
  throw new McpConfigError(
    `${source}：server「${name}」必须配置 command（stdio 子进程）或 url（HTTP）`
  );
}

function parseDisabled(name, raw, source) {
  if (raw === void 0) return void 0;
  if (typeof raw !== "boolean") {
    throw new McpConfigError(`${source}：server「${name}」的 disabled 必须是布尔值`);
  }
  return raw;
}

function expandEnvVars(value, source) {
  const expand = (v) => {
    if (typeof v === "string") {
      return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
        const envValue = process.env[name];
        if (envValue === void 0) {
          throw new McpConfigError(`${source} 引用的环境变量 ${name} 未设置`);
        }
        return envValue;
      });
    }
    if (Array.isArray(v)) return v.map(expand);
    if (isRecord$1(v)) {
      const out2 = {};
      for (const [k, item] of Object.entries(v)) out2[k] = expand(item);
      return out2;
    }
    return v;
  };
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = expand(v);
  return out;
}

function readMcpConfigSource(cwd) {
  if (cwd !== void 0) {
    const project = readTextIfExists(join(cwd, PROJECT_CONFIG_FILE));
    if (project !== void 0) return project;
  }
  return readTextIfExists(getMcpConfigPath()) ?? "";
}

function writeMcpConfig(configJson, cwd) {
  const target = cwd !== void 0 ? join(cwd, PROJECT_CONFIG_FILE) : getMcpConfigPath();
  parseMcpJsonc(configJson, target);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, configJson, "utf8");
}

function toggleMcpServer(serverName, enabled, cwd) {
  const candidates = [];
  if (cwd !== void 0) candidates.push(join(cwd, PROJECT_CONFIG_FILE));
  candidates.push(getMcpConfigPath());
  for (const path of candidates) {
    const text = readTextIfExists(path);
    if (text === void 0) continue;
    const servers = parseMcpJsonc(text, path);
    if (!(serverName in servers)) continue;
    const edits = modify(text, ["mcpServers", serverName, "disabled"], !enabled, {});
    writeFileSync(path, applyEdits$1(text, edits), "utf8");
    return;
  }
  throw new McpConfigError(`找不到名为「${serverName}」的 MCP server 配置`);
}

export {
	McpConfigError,
	PROJECT_CONFIG_FILE,
	expandEnvVars,
	hasWorkspace$1,
	parseDisabled,
	parseMcpJsonc,
	parseServer,
	readFileIfExists,
	readMcpConfig,
	readMcpConfigSource,
	readTextIfExists,
	toggleMcpServer,
	writeMcpConfig,
};