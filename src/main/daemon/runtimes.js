import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chmodSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { get } from "node:http";
import { get as get$1 } from "node:https";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readSync } from "node:fs";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { sep } from "node:path";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import {
	getResourcesDir,
	getRuntimesDir,
} from "./config-paths.js";
import { EventLog } from "./event-log.js";
import {
	readPreferences,
	writePreferences,
} from "./preferences.js";
import { runtimeInstallAbort } from "./doc-extract.js";

const STAGING_PREFIX = ".staging-";

const CURRENT_POINTER_NAME = "current";

const MANIFEST_NAME = "manifest.json";

function runtimesRoot(configDir) {
  return configDir === void 0 ? getRuntimesDir() : join(configDir, "runtimes");
}

function runtimeHome(root, id) {
  return join(root, id);
}

function instanceDir(root, id, version) {
  return join(runtimeHome(root, id), version);
}

function stagingDir(root, id, version, nonce) {
  return join(runtimeHome(root, id), `${STAGING_PREFIX}${version}-${nonce}`);
}

function downloadCacheDir(root, id, version) {
  return join(root, ".cache", id, version);
}

function currentPointer(root, id) {
  return join(runtimeHome(root, id), CURRENT_POINTER_NAME);
}

function manifestFile(dir) {
  return join(dir, MANIFEST_NAME);
}

function readCurrent(root, id) {
  const file = currentPointer(root, id);
  if (!existsSync(file)) return void 0;
  const value = readFileSync(file, "utf8").trim();
  return value === "" ? void 0 : value;
}

function writeCurrent(root, id, version) {
  const home = runtimeHome(root, id);
  mkdirSync(home, { recursive: true });
  const tmp = `${currentPointer(root, id)}.tmp`;
  writeFileSync(tmp, `${version}
`, "utf8");
  renameSync(tmp, currentPointer(root, id));
}

function readManifest(dir) {
  const file = manifestFile(dir);
  if (!existsSync(file)) return void 0;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return void 0;
    const record = parsed;
    if (typeof record["id"] !== "string" || typeof record["version"] !== "string" || typeof record["source"] !== "string" || typeof record["installedAt"] !== "string" || record["status"] !== "installed") {
      return void 0;
    }
    return {
      id: record["id"],
      version: record["version"],
      source: record["source"],
      ...typeof record["checksum"] === "string" ? { checksum: record["checksum"] } : {},
      installedAt: record["installedAt"],
      status: "installed"
    };
  } catch {
    return void 0;
  }
}

function writeManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestFile(dir), `${JSON.stringify(manifest, null, "	")}
`, "utf8");
}

function isCompleteInstance(dir) {
  return readManifest(dir) !== void 0;
}

function promoteStaging(root, id, version, staging) {
  const target = instanceDir(root, id, version);
  renameSync(staging, target);
  return target;
}

function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function listInstances(root, id) {
  return listDirs(runtimeHome(root, id)).filter((name) => !name.startsWith(STAGING_PREFIX)).sort().map((version) => {
    const dir = instanceDir(root, id, version);
    const manifest = readManifest(dir);
    return { version, dir, ...manifest === void 0 ? {} : { manifest }, complete: manifest !== void 0 };
  });
}

function listStaging(root, id) {
  return listDirs(runtimeHome(root, id)).filter((name) => name.startsWith(STAGING_PREFIX)).sort();
}

function publishCurrent(root, id, version) {
  const dir = instanceDir(root, id, version);
  if (!isCompleteInstance(dir)) {
    throw new Error(
      `实例 ${dir} 不完整（缺 ${MANIFEST_NAME}），拒绝把 current 切过去 —— current 指向不存在的版本会让「就绪」与磁盘事实分叉。`
    );
  }
  writeCurrent(root, id, version);
}

function runtimeLogDir(target) {
  return runtimeHome(target.options.root, target.id);
}

function appendRuntimeEvent(target, event) {
  new EventLog(runtimeLogDir(target)).append({ ...event });
}

function readLastRuntimeFailure(target) {
  const dir = runtimeLogDir(target);
  if (!existsSync(dir)) return void 0;
  const files = readdirSync(dir).filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().reverse();
  for (const name of files) {
    const lines = readFileSync(join(dir, name), "utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim() ?? "";
      if (line === "") continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null) continue;
        const record = parsed;
        if (record["outcome"] !== "failed") continue;
        if (typeof record["kind"] !== "string" || !record["kind"].startsWith("runtime_")) continue;
        return {
          phase: typeof record["phase"] === "string" ? record["phase"] : "unknown",
          error: typeof record["error"] === "string" ? record["error"] : "（日志里没有记原因）"
        };
      } catch {
        continue;
      }
    }
  }
  return void 0;
}

function describeStatus(report) {
  switch (report.status.kind) {
    case "missing":
      return "未就绪：可执行环境不存在（没装，或目录被删/被杀软隔离）";
    case "wrong-version":
      return `未就绪：版本不符（当前 ${report.status.version}，需要 ${report.version}）`;
    case "deps-missing":
      return `未就绪：缺依赖 ${report.status.module}`;
    case "ready":
      return "就绪";
  }
}

function nextStepsFor(report) {
  const steps = [];
  if (report.staging.length > 0) {
    steps.push(
      `盘上有上次中断留下的半成品目录（${report.staging.join("、")}）：点「重置并重新安装」会清掉重来。`
    );
  }
  if (report.currentVersion === void 0 && report.instances.some((instance) => instance.complete)) {
    steps.push(
      "托管根里有一份完整实例但没发布（current 缺席，通常是安装正好中断在最后一步）：下次探测（转换前 / 打开设置页）会直接补上指针，不必重新下载。"
    );
  }
  if (report.currentVersion !== void 0 && !report.instances.some((instance) => instance.complete)) {
    steps.push("current 指针指向的实例已不存在或不完整（指针已被忽略）：点「重置并重新安装」。");
  }
  switch (report.status.kind) {
    case "ready":
      steps.push("环境就绪，无需操作。");
      break;
    case "deps-missing":
      steps.push("点「重置并重新安装」重建这一份环境（需联网）——缺依赖不会自动补装。");
      break;
    case "wrong-version":
    case "missing":
      steps.push(
        "点「安装」（已装过则点「重置并重新安装」）重建环境：需联网下载，体积见设置页「内置运行时」那一行的提示 —— 运行时不随包分发，也**不会**自动下载。"
      );
      break;
  }
  if (report.resolutionSource === "legacy") {
    steps.push(
      `当前复用托管根之外的既有目录（${report.activeDir}），它不会被删除也不会被自动迁入；要迁进托管根（之后可回滚/可版本化）请点「重置并重新安装」。`
    );
  }
  if (report.resolutionSource === "override") {
    steps.push(
      `当前由环境变量 HTML_TO_DOCX_VENV 指定（${report.activeDir}），托管根被跳过：要改回托管根，取消该环境变量。`
    );
  }
  if (report.lastFailure !== void 0) {
    steps.push(
      `最近一次失败发生在 ${report.lastFailure.phase} 相位；完整日志见 ${report.logPath}。无外网/私有化环境：把 UV_INDEX_URL（PyPI 镜像）与 UV_PYTHON_INSTALL_MIRROR（Python 发行版镜像）指向内网，或用 HTML_TO_DOCX_VENV 指定运维预置好的 venv。`
    );
  }
  return steps;
}

async function collectRuntimeDiagnostics(descriptor, spawn2) {
  const resolution = descriptor.resolve();
  const current = readCurrent(descriptor.options.root, descriptor.id);
  const lastFailure = readLastRuntimeFailure(descriptor);
  const base = {
    id: descriptor.id,
    label: descriptor.label,
    version: descriptor.version,
    source: descriptor.source,
    status: await descriptor.inspect(resolution.activeDir, spawn2),
    resolutionSource: resolution.source,
    resolutionDetail: resolution.detail,
    activeDir: resolution.activeDir,
    instanceDir: resolution.instanceDir,
    ...current === void 0 ? {} : { currentVersion: current },
    instances: listInstances(descriptor.options.root, descriptor.id).map((instance) => ({
      version: instance.version,
      complete: instance.complete
    })),
    staging: listStaging(descriptor.options.root, descriptor.id),
    ...lastFailure === void 0 ? {} : { lastFailure },
    logPath: runtimeLogDir(descriptor)
  };
  return { ...base, nextSteps: nextStepsFor(base) };
}

function renderRuntimeDiagnostics(report) {
  const lines = [
    `【${report.label}】诊断报告`,
    `- id / 期望版本：${report.id} / ${report.version}`,
    `- 来源：${report.source}`,
    `- 状态：${describeStatus(report)}`,
    `- 生效路径：${report.activeDir}`,
    `- 路径来源：${report.resolutionSource}（${report.resolutionDetail}）`,
    `- 托管实例目录：${report.instanceDir}`,
    `- current 指针：${report.currentVersion ?? "（未写：尚无已发布的实例）"}`
  ];
  const instances = report.instances.length === 0 ? "（无）" : report.instances.map((instance) => `${instance.version}${instance.complete ? "" : "（未完成）"}`).join("、");
  lines.push(`- 盘上实例：${instances}`);
  lines.push(`- 半成品目录：${report.staging.length === 0 ? "（无）" : report.staging.join("、")}`);
  lines.push(
    `- 最近一次失败：${report.lastFailure === void 0 ? "（日志里没有失败记录）" : `${report.lastFailure.error}（相位 ${report.lastFailure.phase}）`}`
  );
  lines.push(`- 日志：${report.logPath}`);
  lines.push("- 可执行的下一步：");
  for (const step of report.nextSteps) lines.push(`  · ${step}`);
  return lines.join("\n");
}

function bindRuntimeMachine(machine, ctx) {
  let state = machine.initial();
  return {
    label: machine.label,
    maxSteps: machine.maxSteps,
    phase: () => machine.phaseOf(state),
    nextStep: () => machine.nextStep(state, ctx),
    accept: (outcome) => {
      state = machine.reduce(state, outcome, ctx);
    },
    ready: () => machine.ready(state),
    failure: () => machine.failure(state)
  };
}

async function driveRuntimeMachine(runner, spawn2) {
  for (let step = 0; step < runner.maxSteps; step += 1) {
    const request = runner.nextStep();
    if (request === null) break;
    runner.accept(await spawn2(request));
  }
  if (runner.ready()) return { ready: true };
  const failure = runner.failure();
  if (failure !== void 0) return { ready: false, phase: failure.phase, error: failure.error };
  return {
    ready: false,
    phase: runner.phase(),
    error: `${runner.label}状态机步数超限（未能收敛，停在 ${runner.phase()}）`
  };
}

const PART_SUFFIX = ".part";

function partFileFor(file) {
  return `${file}${PART_SUFFIX}`;
}

class DownloadError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "DownloadError";
  }
  kind;
}

class DownloadCancelledError extends Error {
  constructor(url) {
    super(`已取消下载：${url}`);
    this.url = url;
    this.name = "DownloadCancelledError";
  }
  url;
}

const MAX_REDIRECTS = 5;

const REDIRECT_STATUS = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);

function contentLengthOf(header) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return void 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : void 0;
}

function requestOnce(url, rangeStart, signal) {
  return new Promise((resolve2, reject) => {
    const send = new URL(url).protocol === "http:" ? get : get$1;
    const headers = { "user-agent": "ZeroWork-runtime-installer" };
    if (rangeStart > 0) headers["range"] = `bytes=${rangeStart}-`;
    const request = send(url, { headers }, (response) => resolve2(response));
    request.on("error", reject);
    if (signal === void 0) return;
    if (signal.aborted) {
      request.destroy(new DownloadCancelledError(url));
      return;
    }
    signal.addEventListener("abort", () => request.destroy(new DownloadCancelledError(url)), { once: true });
  });
}

async function openHttp(request, redirectsLeft = MAX_REDIRECTS) {
  const response = await requestOnce(request.url, request.rangeStart, request.signal);
  const status = response.statusCode ?? 0;
  const location = response.headers.location;
  if (REDIRECT_STATUS.has(status) && location !== void 0) {
    response.resume();
    if (redirectsLeft <= 0) throw new DownloadError("http", `重定向次数过多：${request.url}`);
    return openHttp({ ...request, url: new URL(location, request.url).toString() }, redirectsLeft - 1);
  }
  if (status !== 200 && status !== 206) {
    response.resume();
    throw new DownloadError("http", `${request.url} 返回 HTTP ${status}（期望 200/206）`);
  }
  const contentLength = contentLengthOf(response.headers["content-length"]);
  const body = response;
  return { status, ...contentLength === void 0 ? {} : { contentLength }, body };
}

async function feedFile(hash, file) {
  const source = createReadStream(file);
  let bytes = 0;
  for await (const chunk of source) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return bytes;
}

function writeChunk(stream, chunk) {
  return new Promise((resolve2, reject) => {
    stream.write(chunk, (error) => error === null || error === void 0 ? resolve2() : reject(error));
  });
}

function closeStream(stream) {
  return new Promise((resolve2, reject) => {
    stream.on("close", () => resolve2());
    stream.on("error", reject);
    stream.end();
  });
}

async function downloadArtifact(request) {
  const expected = request.sha256.toLowerCase();
  const opener = request.opener ?? openHttp;
  mkdirSync(dirname(request.targetFile), { recursive: true });
  if (existsSync(request.targetFile)) {
    const cached = await hashFile(request.targetFile);
    if (cached.sha256 === expected) {
      return { path: request.targetFile, bytes: cached.bytes, sha256: cached.sha256, reusedBytes: cached.bytes };
    }
    rmSync(request.targetFile, { force: true });
  }
  const part = partFileFor(request.targetFile);
  const resumableBytes = existsSync(part) ? statSync(part).size : 0;
  const runOnce = async (resume) => {
    const start2 = resume ? resumableBytes : 0;
    const response = await opener({
      url: request.url,
      rangeStart: start2,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    const append = start2 > 0 && response.status === 206;
    if (start2 > 0 && !append) rmSync(part, { force: true });
    const base = append ? start2 : 0;
    const hash = createHash("sha256");
    if (base > 0 && await feedFile(hash, part) !== base) {
      rmSync(part, { force: true });
      throw new DownloadError("io", `续传点读出的字节数与文件大小不符：${part}（已丢弃，请重试）`);
    }
    const totalBytes = response.contentLength === void 0 ? void 0 : base + response.contentLength;
    const stream = createWriteStream(part, { flags: append ? "a" : "w" });
    let written = base;
    request.onProgress?.({ receivedBytes: written, ...totalBytes === void 0 ? {} : { totalBytes } });
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        await writeChunk(stream, chunk);
        written += chunk.length;
        request.onProgress?.({
          receivedBytes: written,
          ...totalBytes === void 0 ? {} : { totalBytes }
        });
      }
      await closeStream(stream);
    } catch (error) {
      stream.destroy();
      if (request.signal?.aborted === true) throw new DownloadCancelledError(request.url);
      if (error instanceof DownloadError || error instanceof DownloadCancelledError) throw error;
      throw new DownloadError(
        "io",
        `下载中断（${error instanceof Error ? error.message : String(error)}）：${request.url}。已保留续传点，重试即可接着下。`
      );
    }
    if (written < request.minBytes) {
      rmSync(part, { force: true });
      throw new DownloadError(
        "size",
        `${request.url} 只下到 ${written} 字节（下限 ${request.minBytes}）—— 不像目标发行物（可能是错误页或半截包），已丢弃。`
      );
    }
    const actual = hash.digest("hex").toLowerCase();
    if (actual !== expected) {
      rmSync(part, { force: true });
      throw new DownloadError(
        "sha256",
        `${request.url} 的 SHA256 不符（期望 ${expected}，实际 ${actual}）—— 产物已丢弃，**未**解包、**未**进位。`
      );
    }
    renameSync(part, request.targetFile);
    return { path: request.targetFile, bytes: written, sha256: actual, reusedBytes: base };
  };
  try {
    return await runOnce(true);
  } catch (error) {
    if (error instanceof DownloadError && error.kind === "sha256" && resumableBytes > 0) {
      rmSync(part, { force: true });
      return await runOnce(false);
    }
    throw error;
  }
}

async function hashFile(file) {
  const hash = createHash("sha256");
  const bytes = await feedFile(hash, file);
  return { sha256: hash.digest("hex").toLowerCase(), bytes };
}

async function sha256File(file) {
  return (await hashFile(file)).sha256;
}

async function fetchText(url, options = {}) {
  const opener = options.opener ?? openHttp;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const response = await opener({
    url,
    rangeStart: 0,
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  if (response.status !== 200 && response.status !== 206) {
    throw new DownloadError("http", `${url} 返回 HTTP ${response.status}（期望 200/206）`);
  }
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > maxBytes) throw new DownloadError("size", `${url} 的内容超过 ${maxBytes} 字节，不像校验文件`);
  }
  return text + decoder.decode();
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function crossCheckShasums(spec, ctx, warnings) {
  const shasums = spec.shasums;
  if (shasums === void 0) return;
  let text;
  try {
    text = await fetchText(shasums.url, {
      ...ctx.opener === void 0 ? {} : { opener: ctx.opener },
      ...ctx.signal === void 0 ? {} : { signal: ctx.signal }
    });
  } catch (error) {
    if (error instanceof DownloadCancelledError) throw error;
    warnings.push(
      `未取到官方校验文件 ${shasums.url}（${error instanceof Error ? error.message : String(error)}）—— 本次仅按代码内固定 sha256 校验发行物。`
    );
    return;
  }
  const rows = text.split("\n").map((row) => row.trim());
  for (const entry of shasums.entries) {
    const actual = rows.find((row) => row.endsWith(` ${entry.name}`))?.split(/\s+/)[0];
    if (actual !== entry.sha256) {
      throw new DownloadError(
        "sha256",
        `官方校验文件 ${shasums.url} 里的 ${entry.name} sha256 与代码内固定值不一致（官方 ${actual ?? "缺这一条"} / 固定 ${entry.sha256}）—— 要么上游换了产物、要么我们钉错了版本，两种都必须人来看一眼（已中止本次安装）。`
      );
    }
  }
}

async function extractAndCheck(spec, artifactPath, envDir, ctx, progress) {
  progress({ message: `正在解包 ${spec.label}…` });
  await spec.extract(artifactPath, envDir, {
    spawn: ctx.spawn,
    ...ctx.signal === void 0 ? {} : { signal: ctx.signal }
  });
  const missing = spec.requiredFiles.find((file) => !existsSync(join(envDir, file)));
  if (missing !== void 0) {
    throw new DownloadError(
      "incomplete",
      `${spec.label} 解包后缺 ${missing}（落点 ${envDir}）—— 必备文件里含许可文本，缺了不许进位。本次安装已中止，请重试；若反复出现，请把设置页的「诊断」报告发给我们。`
    );
  }
}

async function acquireArtifact(spec, cacheDir, envDir, ctx) {
  const progress = ctx.onProgress ?? (() => {
  });
  const warnings = [];
  mkdirSync(cacheDir, { recursive: true });
  await crossCheckShasums(spec, ctx, warnings);
  const artifactPath = join(cacheDir, spec.artifactName);
  let lastError;
  for (const [index, url] of spec.urls.entries()) {
    progress({
      message: index === 0 ? `正在下载 ${spec.label} ${spec.version}（${spec.sizeHint}）…` : `主源不可用，正在从备用地址下载 ${spec.label}（${spec.sizeHint}）…`,
      percent: 0
    });
    try {
      const result = await downloadArtifact({
        url,
        targetFile: artifactPath,
        sha256: spec.sha256,
        minBytes: spec.minBytes,
        ...ctx.opener === void 0 ? {} : { opener: ctx.opener },
        ...ctx.signal === void 0 ? {} : { signal: ctx.signal },
        onProgress: ({ receivedBytes, totalBytes }) => {
          progress({
            message: `正在下载 ${spec.label}：${formatBytes(receivedBytes)}${totalBytes === void 0 ? "" : ` / ${formatBytes(totalBytes)}`}`,
            ...totalBytes === void 0 || totalBytes === 0 ? {} : { percent: Math.min(100, Math.round(receivedBytes / totalBytes * 100)) }
          });
        }
      });
      progress({ message: `SHA256 校验通过（${formatBytes(result.bytes)}）` });
      await extractAndCheck(spec, artifactPath, envDir, ctx, progress);
      return {
        artifactPath,
        bytes: result.bytes,
        sha256: result.sha256,
        reusedBytes: result.reusedBytes,
        warnings
      };
    } catch (error) {
      if (error instanceof DownloadCancelledError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (index < spec.urls.length - 1) rmSync(partFileFor(artifactPath), { force: true });
    }
  }
  throw new DownloadError(
    "http",
    `${spec.label} ${spec.version} 下载失败（已试 ${spec.urls.length} 个来源；最后一条：${lastError?.message ?? "未知原因"}）。该运行时需联网下载 ${spec.sizeHint}；请换一个能到官方源（或内网镜像）的网络后重试，或把发行物 ${spec.artifactName} 手工放到 ${artifactPath} 后重试（sha256 必须等于 ${spec.sha256}）。`
  );
}

const MANAGED_ROOT_ENV = "ZEROWORK_RUNTIMES_DIR";

const RUNTIME_ENV_LAYOUT = {
  /**
   * python 不做环境注入：解释器路径经 hidden context 的 `python_env` 段交给模型
   * （spec 阶段 5，`resources/prompts/fragments/python-env.md`），往 PATH 里塞
   * venv 的 Scripts 目录会与那条既有链路口径重叠（同一件事两个说法）。
   */
  python: { pathDirs: () => [], vars: () => ({}) },
  /**
   * node：载荷根直接进 PATH（`node.exe` / `npm.cmd` 就在根上）。
   * 注意 Node 的补丁版本由我们钉死（描述符的 version），所以注入的是**随包那一份**，
   * 不是机器上可能存在的同名 node —— 与 spec 阶段 0 否决「复用系统已装」同因。
   */
  node: {
    pathDirs: (activeDir) => [activeDir],
    vars: (activeDir) => ({ ZEROWORK_NODE_HOME: activeDir })
  },
  /**
   * gitbash：三目录顺序与 Git for Windows 的 `git-bash.exe` 同序（实测：这样 bash 里
   * `git --version`、coreutils、`uname` 都能用）。`mingw64/bin` 必须在前 —— 排在后面
   * 会让机器上已有的 git 先被找到（实测过：不注入时读到的是别的 git 版本）。
   */
  gitbash: {
    pathDirs: (activeDir) => [
      join(activeDir, "mingw64", "bin"),
      join(activeDir, "usr", "bin"),
      join(activeDir, "cmd")
    ],
    vars: (activeDir) => ({ ZEROWORK_GITBASH_HOME: activeDir })
  }
};

function pathKeyOf(env) {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "Path";
}

function prependPath(env, dirs) {
  const base = env[pathKeyOf(env)] ?? "";
  return [...dirs, base].filter((part) => part !== "").join(delimiter);
}

function planRuntimeInjection(inputs, options) {
  const decisions = [];
  const pathEntries = [];
  const vars = {};
  for (const input of inputs) {
    if (!options.master) {
      decisions.push({ id: input.id, kind: "disabled", reason: "总开关关闭：任何运行时都不注入" });
      continue;
    }
    if (!input.enabled) {
      decisions.push({
        id: input.id,
        kind: "disabled",
        reason: "已被用户在设置里禁用（显式已禁用标记）：路径与环境变量都不注入"
      });
      continue;
    }
    if (input.resolution.source === "pending") {
      decisions.push({
        id: input.id,
        kind: "not-ready",
        reason: `尚无可用实例，本次不注入：${input.resolution.detail}`
      });
      continue;
    }
    const layout = RUNTIME_ENV_LAYOUT[input.id];
    const dirs = layout.pathDirs(input.resolution.activeDir);
    const own = layout.vars(input.resolution.activeDir);
    pathEntries.push(...dirs);
    Object.assign(vars, own);
    decisions.push({
      id: input.id,
      kind: "injected",
      reason: `已注入（落点来源 ${input.resolution.source}）：${input.resolution.detail}`,
      pathDirs: dirs,
      vars: own
    });
  }
  if (pathEntries.length === 0) return { env: {}, pathEntries, decisions };
  const pathKey = pathKeyOf(options.env);
  const env = {
    ...vars,
    [MANAGED_ROOT_ENV]: options.root,
    [pathKey]: prependPath(options.env, pathEntries)
  };
  return { env, pathEntries, decisions };
}

const PROBE_PHASE = "probe-executable";

const REQUIRED_FILES_PHASE = "payload-incomplete";

const RESOURCES_DIR_ENV = "ZEROWORK_RESOURCES_DIR";

function runtimeResourcesDir(options) {
  return options.env?.[RESOURCES_DIR_ENV] ?? getResourcesDir();
}

function firstMissingPayloadFile(dir, required) {
  return required.find((relative2) => !existsSync(join(dir, relative2)));
}

function describeProbeOutcome(outcome) {
  const detail = (outcome.stderr.trim() || outcome.stdout.trim() || outcome.error || "").split("\n")[0]?.trim() ?? "";
  const code = outcome.code === null ? "进程没起来" : `退出码 ${outcome.code}`;
  return detail === "" ? code : `${code}：${detail}`;
}

function bindPayloadProbeRunner(spec, envDir) {
  const machine = {
    label: spec.label,
    // 只有一步（探针）——重复推进即 bug，上界给 2 让「不收敛」也能响亮报出来。
    maxSteps: 2,
    initial: () => {
      const missing = firstMissingPayloadFile(envDir, spec.requiredFiles);
      if (missing === void 0) return { phase: PROBE_PHASE };
      return {
        phase: REQUIRED_FILES_PHASE,
        failure: {
          phase: REQUIRED_FILES_PHASE,
          error: `${spec.label}的安装结果不完整（缺 ${missing}）：${envDir}。必备文件里含许可文本，缺了不许进位；重试安装即可。`
        }
      };
    },
    nextStep: (state) => state.phase === PROBE_PHASE ? spec.probe(envDir) : null,
    reduce: (state, outcome) => {
      if (state.phase !== PROBE_PHASE) return state;
      const version = spec.parseVersion(outcome);
      if (version === spec.version) return { phase: "ready" };
      if (version === void 0) {
        return {
          phase: PROBE_PHASE,
          failure: { phase: PROBE_PHASE, error: `${spec.label}探针没跑通（${describeProbeOutcome(outcome)}）。` }
        };
      }
      return {
        phase: PROBE_PHASE,
        failure: {
          phase: PROBE_PHASE,
          error: `${spec.label}版本不符：期望 ${spec.version}，实际 ${version} —— 发行物与描述符钉的版本对不上（多半是上游换了产物、或我们钉错了版本）。`
        }
      };
    },
    phaseOf: (state) => state.phase,
    ready: (state) => state.phase === "ready",
    failure: (state) => state.failure
  };
  return bindRuntimeMachine(machine, { envDir });
}

async function inspectPayload(spec, envDir, spawn2) {
  const missing = firstMissingPayloadFile(envDir, spec.requiredFiles);
  if (missing !== void 0) return { kind: "deps-missing", module: missing };
  const outcome = await spawn2(spec.probe(envDir));
  if (outcome.code === null || outcome.code !== 0) return { kind: "missing" };
  const version = spec.parseVersion(outcome);
  if (version === void 0) return { kind: "missing" };
  if (version !== spec.version) return { kind: "wrong-version", version };
  return { kind: "ready" };
}

const GITBASH_RUNTIME_ID = "gitbash";

const GITBASH_RUNTIME_VERSION = "2.55.0.5";

const GITBASH_ARTIFACT = `PortableGit-${GITBASH_RUNTIME_VERSION}-64-bit.7z.exe`;

const GITBASH_RELEASE_TAG = "v2.55.0.windows.5";

const GITBASH_OFFICIAL_DIR = `https://github.com/git-for-windows/git/releases/download/${GITBASH_RELEASE_TAG}`;

const GITBASH_MIRROR_DIR = `https://registry.npmmirror.com/-/binary/git-for-windows/${GITBASH_RELEASE_TAG}`;

const GITBASH_URL_ENV = "ZEROWORK_GITBASH_URL";

const GITBASH_ARTIFACT_SHA256 = "5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290";

const GITBASH_MIN_BYTES = 50 * 1024 * 1024;

const GITBASH_SIZE_HINT = "约 56 MiB";

const GITBASH_LABEL = "Bash 与 unix 工具（托管运行时）";

const GITBASH_BASH_RELATIVE = join("usr", "bin", "bash.exe");

const GITBASH_SOURCE_OFFER_RELATIVE = join("runtimes", "gitbash", "CORRESPONDING-SOURCE.md");

const GITBASH_REQUIRED_FILES = [
  GITBASH_BASH_RELATIVE,
  "LICENSE.txt",
  "CORRESPONDING-SOURCE.md"
];

function gitbashBashPath(activeDir) {
  return join(activeDir, GITBASH_BASH_RELATIVE);
}

function gitbashSourceOfferPath(options) {
  return join(runtimeResourcesDir(options), GITBASH_SOURCE_OFFER_RELATIVE);
}

function parseGitVersion(outcome) {
  const text = `${outcome.stdout}
${outcome.stderr}`;
  const match = /git version (\d+)\.(\d+)\.(\d+)\.windows\.(\d+)/.exec(text);
  if (match === null) return void 0;
  return `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
}

function resolveGitbashRuntime(options) {
  const instance = instanceDir(options.root, GITBASH_RUNTIME_ID, GITBASH_RUNTIME_VERSION);
  const current = readCurrent(options.root, GITBASH_RUNTIME_ID);
  if (current !== void 0) {
    const dir = instanceDir(options.root, GITBASH_RUNTIME_ID, current);
    if (isCompleteInstance(dir)) {
      return {
        instanceDir: dir,
        version: current,
        activeDir: dir,
        source: "managed",
        detail: `托管根 current 指向 ${current}（已进位、manifest 齐）`,
        managed: true
      };
    }
    return {
      instanceDir: instance,
      version: GITBASH_RUNTIME_VERSION,
      activeDir: instance,
      source: "pending",
      detail: `托管根 current 指向 ${current}，但该实例没有 manifest（未进位完成或已损坏）—— 该指针已被忽略，将由本次安装落位到 ${instance}`,
      managed: true
    };
  }
  return {
    instanceDir: instance,
    version: GITBASH_RUNTIME_VERSION,
    activeDir: instance,
    source: "pending",
    detail: `尚无可用托管实例，将由本次安装落位到 ${instance}`,
    managed: true
  };
}

function gitbashArtifactUrls(options) {
  const override = options.env?.[GITBASH_URL_ENV];
  return [override, `${GITBASH_OFFICIAL_DIR}/${GITBASH_ARTIFACT}`, `${GITBASH_MIRROR_DIR}/${GITBASH_ARTIFACT}`].filter(
    (url) => typeof url === "string" && url.trim() !== ""
  );
}

async function extractPortableGit(artifactPath, envDir, context) {
  if (!existsSync(context.sourceOffer)) {
    throw new DownloadError(
      "incomplete",
      `缺少 ${context.sourceOffer}（GPLv2 §3 的对应源码获取方式必须与二进制同行）—— 安装已中止；这是随应用分发的文字资产缺失，请重装应用。`
    );
  }
  const outcome = await context.spawn({ command: artifactPath, args: ["-y", `-o${envDir}`] });
  if (outcome.code !== 0) {
    throw new DownloadError(
      "extract",
      `PortableGit 自解压失败（${describeProbeOutcome(outcome)}）—— 解包器就是刚校验过 sha256 的发行物自身；判断 ${envDir} 是否可写、磁盘是否够（解包后约 389 MB），重试安装即可。`
    );
  }
  copyFileSync(context.sourceOffer, join(envDir, "CORRESPONDING-SOURCE.md"));
}

function gitbashArtifactSpec(options) {
  return {
    id: GITBASH_RUNTIME_ID,
    label: GITBASH_LABEL,
    version: GITBASH_RUNTIME_VERSION,
    artifactName: GITBASH_ARTIFACT,
    urls: gitbashArtifactUrls(options),
    sha256: GITBASH_ARTIFACT_SHA256,
    minBytes: GITBASH_MIN_BYTES,
    sizeHint: GITBASH_SIZE_HINT,
    // 没有官方集中校验文件（GitHub release 只在 API 里给 asset digest，且那条要联网查 API）：
    // 发行物 sha256 已与 digest 逐字核对过并钉在代码里，这里不再多一跳网络。
    requiredFiles: GITBASH_REQUIRED_FILES,
    extract: (artifactPath, envDir, ctx) => extractPortableGit(artifactPath, envDir, { spawn: ctx.spawn, sourceOffer: gitbashSourceOfferPath(options) })
  };
}

function gitbashProbeSpec(options, envDir) {
  const baseEnv = options.env ?? process.env;
  const pathKey = pathKeyOf(baseEnv);
  return {
    label: GITBASH_LABEL,
    version: GITBASH_RUNTIME_VERSION,
    requiredFiles: GITBASH_REQUIRED_FILES,
    probe: (dir) => ({
      command: gitbashBashPath(dir),
      args: ["-c", "git --version"],
      // 自带注入：验的是**实例里那份** git，不是机器上碰巧存在的（见文件头实测）。
      env: { [pathKey]: prependPath(baseEnv, RUNTIME_ENV_LAYOUT.gitbash.pathDirs(dir)) }
    }),
    parseVersion: parseGitVersion
  };
}

function createGitbashRuntime(options) {
  return {
    id: GITBASH_RUNTIME_ID,
    label: GITBASH_LABEL,
    version: GITBASH_RUNTIME_VERSION,
    source: `Git for Windows PortableGit ${GITBASH_RUNTIME_VERSION}（${GITBASH_ARTIFACT}，运行期按需下载；发行物 sha256 与官方 release asset digest 一致；解包用发行物自带的 SFX 解包器，不引入 7-Zip 依赖）`,
    options,
    resolve: () => resolveGitbashRuntime(options),
    // 解包根自己就是环境目录：bash 在 `usr/bin` 下，但 PATH 需要的是三个子目录（见注入层布局）。
    envDirOf: (instance) => instance,
    acquire: (envDir, context) => acquireArtifact(
      gitbashArtifactSpec(options),
      downloadCacheDir(options.root, GITBASH_RUNTIME_ID, GITBASH_RUNTIME_VERSION),
      envDir,
      context
    ),
    createRunner: (envDir) => bindPayloadProbeRunner(gitbashProbeSpec(options), envDir),
    inspect: (envDir, spawn2) => inspectPayload(gitbashProbeSpec(options), envDir, spawn2)
  };
}

const NODE_RUNTIME_ID = "node";

const NODE_RUNTIME_VERSION = "22.23.2";

const NODE_LABEL = "Node（脚本运行时）";

const NODE_DIST_DIR = `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}`;

const NODE_MIRROR_DIR = `https://registry.npmmirror.com/-/binary/node/v${NODE_RUNTIME_VERSION}`;

const NODE_URL_ENV = "ZEROWORK_NODE_URL";

/**
 * Node 发行包的**平台规格**。
 *
 * 为什么需要这张表：各平台的产物名、归档格式、可执行文件相对路径都不同，
 * 早期实现只支持 Windows（`win-x64.zip` + `node.exe`），在 macOS/Linux 上
 * 会下载 Windows 包然后在探针相位失败。表化之后按 `process.platform-arch`
 * 取对应规格即可。
 *
 * 两个 sha256 的分工：
 *   - `artifactSha`：**归档**的哈希。下载后立即校验，并与官方
 *     `SHASUMS256.txt` 交叉核对（不一致就中止）。取值来源即该文件。
 *   - `exeSha`：解包后**可执行文件**的哈希。确认解包结果没被篡改或损坏。
 *     取自本地下载解包后的实测值。
 *
 * ⚠️ 新增平台时必须**同时**补齐这两个哈希，且 artifactSha 必须能在官方
 * SHASUMS256.txt 里找到对应条目 —— 否则交叉核对会中止安装（这是设计如此：
 * 宁可装不上，也不装来路不明的字节流）。
 *
 * 未列出的平台会明确报错，而不是回落到 Windows 规格。
 */
const NODE_PLATFORM_SPECS = {
	"win32-x64": {
		artifact: `node-v${NODE_RUNTIME_VERSION}-win-x64.zip`,
		archive: "zip",
		executable: "node.exe",
		artifactSha: "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97",
		exeSha: "0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4",
		sizeHint: "约 34 MiB"
	},
	"darwin-arm64": {
		artifact: `node-v${NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
		archive: "tar.gz",
		executable: "bin/node",
		artifactSha: "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
		exeSha: "18e387c90ab8a8400183e8bdd396376e1e875b91b4c874b894dcade7b35bf572",
		sizeHint: "约 48 MiB"
	},
	"darwin-x64": {
		artifact: `node-v${NODE_RUNTIME_VERSION}-darwin-x64.tar.gz`,
		archive: "tar.gz",
		executable: "bin/node",
		artifactSha: "58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
		exeSha: "0b4f059915f3bf3c6cbb02422f4a529bfb21cbbec2d29851c9a5d833f78a04f6",
		sizeHint: "约 48 MiB"
	}
};

/** 当前平台的规格键；Windows 一律按 x64（应用只发 x64 包）。 */
function nodePlatformKey() {
	const platform = process.platform;
	const arch = platform === "win32" ? "x64" : process.arch;
	return `${platform}-${arch}`;
}

/**
 * 取当前平台的规格。未支持的平台**明确报错**，不回落到别的平台 ——
 * 回落会导致下载错误的包、然后在探针相位以难以理解的方式失败。
 */
function nodePlatformSpec() {
	const key = nodePlatformKey();
	const spec = NODE_PLATFORM_SPECS[key];
	if (spec === void 0) {
		throw new Error(
			`Node 运行时暂不支持当前平台 ${key}（已支持：${Object.keys(NODE_PLATFORM_SPECS).join("、")}）。` +
				`可在 src/main/daemon/runtimes.js 的 NODE_PLATFORM_SPECS 中按上述格式补充：` +
				`产物名与 artifactSha 取自 https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt，` +
				`exeSha 为本地下载解包后实测。`
		);
	}
	return spec;
}

const NODE_MIN_BYTES = 20 * 1024 * 1024;

function nodeRequiredFiles() {
	return [nodePlatformSpec().executable, "LICENSE"];
}

/**
 * 最小 tar 读取器 + gzip 解压，用于处理 Unix 平台的 `.tar.gz` 发行包。
 *
 * 为什么不引第三方依赖：解压的是**已校验过 sha256** 的官方发行包
 * （见 acquireArtifact 的下载校验与 crossCheckShasums 的官方清单核对），
 * 信任边界已经建立。为这条路引入一个 tar 依赖不划算。
 *
 * 支持：普通文件、目录、GNU longname（typeflag 'L'）、ustar 前缀字段。
 * 不支持：稀疏文件、PAX 扩展头（Node 发行包不使用）。
 */
function extractTarGz(archivePath, targetDir) {
	const buf = gunzipSync(readFileSync(archivePath));
	const BLOCK = 512;
	let offset = 0;
	let pendingLongName;
	let fileCount = 0;

	const readString = (start, length) => {
		const slice = buf.subarray(offset + start, offset + start + length);
		const nul = slice.indexOf(0);
		return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
	};

	while (offset + BLOCK <= buf.length) {
		// 连续两个全零块表示归档结束
		const header = buf.subarray(offset, offset + BLOCK);
		if (header.every((byte) => byte === 0)) break;

		const sizeField = readString(124, 12).trim();
		const size = sizeField === "" ? 0 : Number.parseInt(sizeField, 8);
		if (!Number.isFinite(size) || size < 0) {
			throw new Error(`tar 头部的 size 字段无法解析（偏移 ${offset}）：${JSON.stringify(sizeField)}`);
		}
		const typeflag = String.fromCharCode(buf[offset + 156] || 0x30);
		const prefix = readString(345, 155);
		let name = readString(0, 100);
		if (prefix !== "") name = `${prefix}/${name}`;

		// mode 字段（偏移 100、长 8）是**八进制 ASCII 字符串**（形如 "0000755\0"），
		// 不是二进制整数。必须按字符串解析 —— 直接读字节会得到错的权限位，
		// 解出来的 node 没有可执行位，探针会以 EACCES 失败（踩过这个坑）。
		const modeField = readString(100, 8).trim();
		const mode = modeField === "" ? 0o644 : Number.parseInt(modeField, 8);

		offset += BLOCK;
		const dataStart = offset;
		const dataBlocks = Math.ceil(size / BLOCK) * BLOCK;
		offset += dataBlocks;

		if (typeflag === "L") {
			// GNU longname：下一个条目的真实名字存在这里的数据区
			pendingLongName = buf.subarray(dataStart, dataStart + size).toString("utf8").replace(/\0+$/, "");
			continue;
		}
		if (pendingLongName !== void 0) {
			name = pendingLongName;
			pendingLongName = void 0;
		}

		if (name === "" || name === "./") continue;

		// 去掉发行包自带的顶层目录（node-vX.Y.Z-<platform>/）
		const slash = name.indexOf("/");
		const relative = slash === -1 ? "" : name.slice(slash + 1);
		if (relative === "") continue;

		const target = join(targetDir, relative);
		// 防目录穿越：归档条目不得逃出目标目录
		if (!target.startsWith(targetDir + sep) && target !== targetDir) {
			throw new Error(`tar 条目试图写到目标目录之外：${name}`);
		}

		if (typeflag === "5") {
			mkdirSync(target, { recursive: true });
			try {
				chmodSync(target, mode & 0o777);
			} catch {
				/* 忽略 */
			}
			continue;
		}
		if (typeflag !== "0" && typeflag !== "\0" && typeflag !== "") continue;

		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, buf.subarray(dataStart, dataStart + size));
		// 保留归档里的权限位。没有可执行位，解出来的 node 跑不起来（EACCES）。
		// 目录条目也要 chmod（受影响的是遍历权限）。
		try {
			chmodSync(target, mode & 0o777);
		} catch {
			/* 某些文件系统不支持 chmod，忽略 */
		}
		fileCount++;
	}

	if (fileCount === 0) {
		throw new Error(`${archivePath} 解出来 0 个文件 —— 不像有效的 tar.gz 归档`);
	}
}

function parseNodeVersion(outcome) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(outcome.stdout.trim());
  return match?.[1];
}

function resolveNodeRuntime(options) {
  const instance = instanceDir(options.root, NODE_RUNTIME_ID, NODE_RUNTIME_VERSION);
  const current = readCurrent(options.root, NODE_RUNTIME_ID);
  if (current !== void 0) {
    const dir = instanceDir(options.root, NODE_RUNTIME_ID, current);
    if (isCompleteInstance(dir)) {
      return {
        instanceDir: dir,
        version: current,
        activeDir: dir,
        source: "managed",
        detail: `托管根 current 指向 ${current}（已进位、manifest 齐）`,
        managed: true
      };
    }
    return {
      instanceDir: instance,
      version: NODE_RUNTIME_VERSION,
      activeDir: instance,
      source: "pending",
      detail: `托管根 current 指向 ${current}，但该实例没有 manifest（未进位完成或已损坏）—— 该指针已被忽略，将由本次安装落位到 ${instance}`,
      managed: true
    };
  }
  return {
    instanceDir: instance,
    version: NODE_RUNTIME_VERSION,
    activeDir: instance,
    source: "pending",
    detail: `尚无可用托管实例，将由本次安装落位到 ${instance}`,
    managed: true
  };
}

function nodeArtifactUrls(options) {
  const override = options.env?.[NODE_URL_ENV];
  return [override, `${NODE_DIST_DIR}/${nodePlatformSpec().artifact}`, `${NODE_MIRROR_DIR}/${nodePlatformSpec().artifact}`].filter(
    (url) => typeof url === "string" && url.trim() !== ""
  );
}

/**
 * 解包 Node 发行包。按规格里的 `archive` 字段分派：
 *   zip    —— Windows 发行包，用 JSZip 就地解
 *   tar.gz —— Unix 发行包，走内置的最小 tar 读取器
 */
async function extractNodeArchive(artifactPath, envDir) {
	const spec = nodePlatformSpec();
	if (spec.archive === "tar.gz") {
		extractTarGz(artifactPath, envDir);
		const exePath = join(envDir, spec.executable);
		if (!existsSync(exePath)) {
			throw new DownloadError(
				"extract",
				`解包后没有 ${spec.executable}（目录内容：${readdirSync(envDir).slice(0, 5).join(", ")}）—— 不像官方 node 发行包，已中止安装。`
			);
		}
		const actual = await sha256File(exePath);
		if (actual !== spec.exeSha) {
			throw new DownloadError(
				"sha256",
				`解包后的 ${spec.executable} sha256 不符（期望 ${spec.exeSha}，实际 ${actual}）—— 本次解包结果已丢弃、未进位；请重试安装。`
			);
		}
		return;
	}
	await extractNodeZip(artifactPath, envDir);
}

async function extractNodeZip(artifactPath, envDir, expectedExeSha256 = nodePlatformSpec().exeSha) {
  const zip = await JSZip.loadAsync(readFileSync(artifactPath));
  const names = Object.keys(zip.files);
  const top = names[0]?.split("/")[0];
  const exe = nodePlatformSpec().executable;
  if (top === void 0 || !names.includes(`${top}/${exe}`)) {
    throw new DownloadError(
      "extract",
      `${artifactPath} 里没有 <顶层目录>/${exe}（内容物前几项：${names.slice(0, 5).join(", ")}）—— 不像官方 node 发行包，已中止安装。`
    );
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith(`${top}/`)) continue;
    const relative2 = name.slice(top.length + 1);
    if (relative2 === "") continue;
    const target = join(envDir, relative2);
    if (entry.dir) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await entry.async("nodebuffer"));
  }
  const actual = await sha256File(join(envDir, nodePlatformSpec().executable));
  if (actual !== expectedExeSha256) {
    throw new DownloadError(
      "sha256",
      `解包后的可执行文件 sha256 不符（期望 ${expectedExeSha256}，实际 ${actual}）—— 本次解包结果已丢弃、未进位；请重试安装。`
    );
  }
}

function nodeArtifactSpec(options) {
	const spec = nodePlatformSpec();
	return {
		id: NODE_RUNTIME_ID,
		label: NODE_LABEL,
		version: NODE_RUNTIME_VERSION,
		artifactName: spec.artifact,
		urls: nodeArtifactUrls(options),
		sha256: spec.artifactSha,
		minBytes: NODE_MIN_BYTES,
		sizeHint: spec.sizeHint,
		shasums: {
			// 官方清单里只有归档条目；可执行文件哈希是本工程自己钉的（见 NODE_PLATFORM_SPECS）
			url: `${NODE_DIST_DIR}/SHASUMS256.txt`,
			entries: [{ name: spec.artifact, sha256: spec.artifactSha }]
		},
		requiredFiles: nodeRequiredFiles(),
		// 解包不需要 spawn（zip 就地解、tar.gz 内置读），也不需要注入 PATH（探针用绝对路径）。
		extract: (artifactPath, envDir) => extractNodeArchive(artifactPath, envDir)
	};
}

function nodeProbeSpec(envDir) {
	const spec = nodePlatformSpec();
	return {
		label: NODE_LABEL,
		version: NODE_RUNTIME_VERSION,
		requiredFiles: nodeRequiredFiles(),
		probe: () => ({ command: join(envDir, spec.executable), args: ["--version"] }),
		parseVersion: parseNodeVersion
	};
}

function createNodeRuntime(options) {
  return {
    id: NODE_RUNTIME_ID,
    label: NODE_LABEL,
    version: NODE_RUNTIME_VERSION,
    source: `nodejs.org 官方发行版 ${nodePlatformSpec().artifact}（运行期按需下载；整包 sha256 + 官方 SHASUMS256.txt 交叉核对 + 解包后 node.exe sha256 三处校验，校验不过不进位）`,
    options,
    resolve: () => resolveNodeRuntime(options),
    // 解包根自己就是环境目录：`node.exe` 就在实例根上，没有 venv 那样的子目录。
    envDirOf: (instance) => instance,
    acquire: (envDir, context) => acquireArtifact(
      nodeArtifactSpec(options),
      downloadCacheDir(options.root, NODE_RUNTIME_ID, NODE_RUNTIME_VERSION),
      envDir,
      context
    ),
    createRunner: (envDir) => bindPayloadProbeRunner(nodeProbeSpec(envDir), envDir),
    inspect: (envDir, spawn2) => inspectPayload(nodeProbeSpec(envDir), envDir, spawn2)
  };
}

function defaultSpawn(req) {
  return new Promise((resolvePromise) => {
    const child = spawn(req.command, [...req.args], {
      cwd: req.cwd,
      env: req.env === void 0 ? process.env : { ...process.env, ...req.env },
      // daemon 是不可见后台进程，子进程弹控制台窗口会吓到用户。
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolvePromise(outcome);
    };
    child.stdout.setEncoding("utf8").on("data", (d) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      settle({ code: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr });
    });
  });
}

function createEnvContext(engineDir, homeDir, platform, venvDir) {
  return { engineDir, homeDir, platform, venvDir };
}

function venvPythonPath(venvDir, platform) {
  return platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
}

function venvPython(ctx) {
  return venvPythonPath(ctx.venvDir, ctx.platform);
}

function uvCandidates(ctx) {
  return [
    "uv",
    join(ctx.homeDir, ".local", "bin", ctx.platform === "win32" ? "uv.exe" : "uv")
  ];
}

const ENGINE_DEPS_MODULES = ["docx", "html4docx", "bs4", "lxml", "httpx", "PIL", "click"];

const DEPS_PROBE = `import importlib, json
missing = None
for m in (${ENGINE_DEPS_MODULES.map((module) => `"${module}"`).join(", ")}):
    try:
        importlib.import_module(m)
    except Exception:
        missing = m
        break
print(json.dumps({"missing": missing}))`;

function sitePackagesDirs(venvDir, platform) {
  if (platform === "win32") return [join(venvDir, "Lib", "site-packages")];
  const lib = join(venvDir, "lib");
  if (!existsSync(lib)) return [];
  return readdirSync(lib, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name)).map((entry) => join(lib, entry.name, "site-packages"));
}

function looksLikeEngineVenv(venvDir, platform) {
  return sitePackagesDirs(venvDir, platform).some(
    (dir) => existsSync(dir) && ENGINE_DEPS_MODULES.some(
      (module) => existsSync(join(dir, module)) || existsSync(join(dir, `${module}.py`))
    )
  );
}

function parsePythonVersion(output) {
  const match = /Python (\d+\.\d+\.\d+)/.exec(output);
  return match?.[1];
}

function initialEnvState() {
  return { phase: "probe-uv", uvIndex: 0 };
}

function nextStep(state, ctx) {
  switch (state.phase) {
    case "probe-uv": {
      const candidate = uvCandidates(ctx)[state.uvIndex ?? 0];
      if (candidate === void 0) return null;
      return { command: candidate, args: ["--version"] };
    }
    case "probe-python":
      return { command: uvOf(state), args: ["python", "find", "3.12"] };
    case "install-python":
      return { command: uvOf(state), args: ["python", "install", "3.12"] };
    case "probe-venv":
      return { command: venvPython(ctx), args: ["--version"] };
    case "create-venv":
      return { command: uvOf(state), args: ["venv", "--python", "3.12", "--clear", ctx.venvDir] };
    case "smoke-deps":
      return { command: venvPython(ctx), args: ["-c", DEPS_PROBE] };
    case "install-deps":
      return {
        command: uvOf(state),
        args: [
          "pip",
          "install",
          "--python",
          venvPython(ctx),
          // 强制只用 wheel：lxml 在无 libxml2/libxslt 的机器上源码编译必败（实测踩到）。
          "--only-binary=:all:",
          "-r",
          join(ctx.engineDir, "requirements.txt")
        ]
      };
    case "smoke-engine":
      return {
        command: venvPython(ctx),
        args: ["-c", "import html_to_docx"],
        env: { PYTHONPATH: ctx.engineDir }
      };
    case "ready":
    case "failed":
      return null;
  }
}

function uvOf(state) {
  if (state.uv === void 0) throw new Error(`状态机缺 uv（phase=${state.phase}）`);
  return state.uv;
}

function excerpt$2(text, max = 400) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function succeeded(outcome) {
  return outcome.code === 0;
}

function fail$1(phase, error) {
  return { phase: "failed", failedAt: phase, error };
}

function reduce(state, outcome, ctx) {
  switch (state.phase) {
    case "probe-uv": {
      const index = state.uvIndex ?? 0;
      if (succeeded(outcome)) {
        const uv = uvCandidates(ctx)[index];
        if (uv === void 0) return fail$1("probe-uv", "uv 候选下标越界（状态机 bug）");
        return { phase: "probe-python", uv };
      }
      if (index + 1 < uvCandidates(ctx).length) return { phase: "probe-uv", uvIndex: index + 1 };
      return fail$1(
        "probe-uv",
        "未找到 uv（已尝试 PATH 与 ~/.local/bin）。请先安装 uv（https://docs.astral.sh/uv/），或把 uv 可执行文件放到 ~/.local/bin/；私有化环境请预置 uv 并配置 UV_INDEX_URL / UV_PYTHON_INSTALL_MIRROR 指向内网镜像。"
      );
    }
    case "probe-python":
      return succeeded(outcome) ? { ...state, phase: "probe-venv" } : { ...state, phase: "install-python" };
    case "install-python":
      return succeeded(outcome) ? { ...state, phase: "probe-venv" } : fail$1(
        "install-python",
        `Python 3.12 安装失败：${excerpt$2(outcome.stderr)}。首次安装需要外网（astral-sh/python-build-standalone）；私有化环境请配置 UV_PYTHON_INSTALL_MIRROR。`
      );
    case "probe-venv": {
      const version = succeeded(outcome) ? parsePythonVersion(`${outcome.stdout}
${outcome.stderr}`) : void 0;
      if (version !== void 0 && version.startsWith("3.12.")) {
        return { ...state, phase: "smoke-deps" };
      }
      return { ...state, phase: "create-venv" };
    }
    case "create-venv":
      return succeeded(outcome) ? { ...state, phase: "smoke-deps" } : fail$1("create-venv", `创建 venv 失败：${excerpt$2(outcome.stderr)}`);
    case "smoke-deps": {
      if (!succeeded(outcome)) {
        if (state.depsInstallAttempted === true) {
          return fail$1("smoke-deps", `依赖冒烟脚本未能运行：${excerpt$2(outcome.stderr)}`);
        }
        return { ...state, phase: "install-deps", depsInstallAttempted: true };
      }
      const missing = parseMissingModule(outcome.stdout);
      if (missing === null) return { ...state, phase: "smoke-engine" };
      if (state.depsInstallAttempted === true) {
        return fail$1("smoke-deps", `依赖安装一轮后仍缺 ${missing}（venv 可能损坏，可删除 ${ctx.venvDir} 后重试）`);
      }
      return { ...state, phase: "install-deps", depsInstallAttempted: true };
    }
    case "install-deps":
      return succeeded(outcome) ? { ...state, phase: "smoke-deps" } : fail$1(
        "install-deps",
        `依赖安装失败（uv pip install --only-binary=:all:）：${excerpt$2(outcome.stderr)}。首次安装需要外网（PyPI）；私有化环境请配置 UV_INDEX_URL 指向内网镜像，或由运维预置离线 wheel。`
      );
    case "smoke-engine":
      return succeeded(outcome) ? { ...state, phase: "ready" } : fail$1(
        "smoke-engine",
        `引擎包 html_to_docx 无法导入（PYTHONPATH=${ctx.engineDir}），resources/docx-engine 可能缺失或损坏：${excerpt$2(outcome.stderr)}`
      );
    case "ready":
    case "failed":
      return state;
  }
}

function parseMissingModule(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed === "object" && parsed !== null && "missing" in parsed) {
      const missing = parsed.missing;
      return typeof missing === "string" ? missing : null;
    }
  } catch {
  }
  return "unknown";
}

async function inspectVenv(ctx, spawnFn) {
  const py = venvPython(ctx);
  const versionOutcome = await spawnFn({ command: py, args: ["--version"] });
  if (!succeeded(versionOutcome)) return { kind: "missing" };
  const version = parsePythonVersion(`${versionOutcome.stdout}
${versionOutcome.stderr}`);
  if (version === void 0 || !version.startsWith("3.12.")) {
    return { kind: "wrong-version", version: version ?? "unknown" };
  }
  const probe = await spawnFn({ command: py, args: ["-c", DEPS_PROBE] });
  if (!succeeded(probe)) return { kind: "deps-missing", module: "（冒烟脚本未能运行）" };
  const missing = parseMissingModule(probe.stdout);
  if (missing !== null) return { kind: "deps-missing", module: missing };
  return { kind: "ready" };
}

const PYTHON_RUNTIME_ID = "python";

const PYTHON_RUNTIME_VERSION = "3.12";

const PYTHON_VENV_DIRNAME = "venv";

const LEGACY_DOCX_VENV_DIRNAME = ".venv-html-to-docx";

const VENV_OVERRIDE_ENV = "HTML_TO_DOCX_VENV";

function defaultPythonRuntimeOptions(overrides = {}) {
  return {
    root: overrides.root ?? runtimesRoot(),
    homeDir: overrides.homeDir ?? homedir(),
    platform: overrides.platform ?? process.platform,
    engineDir: overrides.engineDir ?? join(getResourcesDir(), "docx-engine"),
    ...overrides.env === void 0 ? {} : { env: overrides.env }
  };
}

function resolvePythonVenv(options) {
  const env = options.env ?? process.env;
  const override = env[VENV_OVERRIDE_ENV];
  const instance = instanceDir(options.root, PYTHON_RUNTIME_ID, PYTHON_RUNTIME_VERSION);
  let brokenCurrent = "";
  if (override !== void 0 && override !== "") {
    return {
      instanceDir: instance,
      version: PYTHON_RUNTIME_VERSION,
      activeDir: override,
      source: "override",
      detail: `由环境变量 ${VENV_OVERRIDE_ENV} 显式指定（优先级最高，托管根被跳过）`,
      managed: false
    };
  }
  const current = readCurrent(options.root, PYTHON_RUNTIME_ID);
  if (current !== void 0) {
    const dir = instanceDir(options.root, PYTHON_RUNTIME_ID, current);
    if (isCompleteInstance(dir)) {
      return {
        instanceDir: dir,
        version: current,
        activeDir: join(dir, PYTHON_VENV_DIRNAME),
        source: "managed",
        detail: `托管根 current 指向 ${current}（已进位、manifest 齐）`,
        managed: true
      };
    }
    brokenCurrent = `托管根 current 指向 ${current}，但该实例没有 manifest（未进位完成或已损坏）—— 该指针已被忽略`;
  }
  const legacy = join(options.homeDir, LEGACY_DOCX_VENV_DIRNAME);
  let ignoredLegacy = "";
  if (existsSync(legacy)) {
    if (looksLikeEngineVenv(legacy, options.platform)) {
      return {
        instanceDir: instance,
        version: PYTHON_RUNTIME_VERSION,
        activeDir: legacy,
        source: "legacy",
        detail: `复用托管根之外的既有目录 ${legacy}（未迁入托管根；点「重置并重新安装」可迁入，旧目录不会被删除）` + brokenCurrent,
        managed: false
      };
    }
    ignoredLegacy = `；既有目录 ${legacy} 存在但里面没有任何引擎依赖（空壳或不是 docx 引擎环境）—— 未复用它（点「安装」会把运行时装进托管根，该目录不会被删除）`;
  }
  return {
    instanceDir: instance,
    version: PYTHON_RUNTIME_VERSION,
    activeDir: join(instance, PYTHON_VENV_DIRNAME),
    source: "pending",
    detail: `尚无可用托管实例，将由本次安装落位到 ${instance}${brokenCurrent}${ignoredLegacy}`,
    managed: true
  };
}

const PYTHON_MACHINE = {
  label: "docx 引擎 Python 环境",
  // 上界与旧 ensure 的 for(step < 40) 相同：防 reduce 改出循环 bug 把 daemon 挂死。
  maxSteps: 40,
  initial: initialEnvState,
  nextStep,
  reduce,
  phaseOf: (state) => state.phase,
  ready: (state) => state.phase === "ready",
  failure: (state) => state.phase === "failed" ? { phase: state.failedAt ?? "failed", error: state.error ?? "未知失败" } : void 0
};

function createPythonRuntime(options) {
  const envContext = (venvDir) => createEnvContext(options.engineDir, options.homeDir, options.platform, venvDir);
  return {
    id: PYTHON_RUNTIME_ID,
    label: "Python（docx 引擎）",
    version: PYTHON_RUNTIME_VERSION,
    source: "uv 管理的独立 CPython 3.12（astral-sh/python-build-standalone）+ 引擎依赖走 PyPI wheel（--only-binary=:all:）",
    options,
    resolve: () => resolvePythonVenv(options),
    envDirOf: (instance) => join(instance, PYTHON_VENV_DIRNAME),
    createRunner: (venvDir) => bindRuntimeMachine(PYTHON_MACHINE, envContext(venvDir)),
    inspect: (venvDir, spawn2) => inspectVenv(envContext(venvDir), spawn2)
  };
}

function pythonExecutable(venvDir, platform) {
  return venvPythonPath(venvDir, platform);
}

function toEnsureResult(outcome, options) {
  if (outcome.status === "failed") return { status: "failed", phase: outcome.phase, error: outcome.error };
  return {
    status: "ready",
    python: pythonExecutable(outcome.activeDir, options.platform),
    venvDir: outcome.activeDir
  };
}

async function ensurePythonRuntime(options, spawn2) {
  return toEnsureResult(await ensureRuntime(createPythonRuntime(options), spawn2), options);
}

function inspectPythonRuntime(options, spawn2) {
  return inspectRuntime(createPythonRuntime(options), spawn2);
}

const NOT_INSTALLED_PHASE = "not-installed";

const NOT_READY_PHASE = "not-ready";

const ACQUIRE_PHASE = "acquire-artifact";

const CANCELLED_PHASE = "cancelled";

const RUNTIME_REGISTRY = {
  python: createPythonRuntime,
  node: createNodeRuntime,
  gitbash: createGitbashRuntime
};

function manifestFor(descriptor, acquired) {
  return {
    id: descriptor.id,
    version: descriptor.version,
    source: descriptor.source,
    // 发行物 sha256 随实例走：诊断能回答「这一份到底是哪个字节流装出来的」。
    ...acquired === void 0 ? {} : { checksum: acquired.sha256 },
    installedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "installed"
  };
}

function stagingNonce() {
  return `${process.pid.toString(36)}-${Date.now().toString(36)}`;
}

function notInstalledMessage(descriptor) {
  return `${descriptor.label} 尚未安装（${descriptor.version}）。为控制安装包体积，运行时不随包分发、也**不会**自动下载 —— 请在「设置 → 内置运行时」点「安装」（需联网）。`;
}

function notReadyMessage(descriptor, resolution, detail) {
  const tail = "运行时不随包分发、也不会自动下载。";
  switch (resolution.source) {
    case "managed":
      return `${descriptor.label} 已安装但当前不可用（${detail}）。请到「设置 → 内置运行时」点「重置并重新安装」——${tail}`;
    case "legacy":
      return `${descriptor.label} 当前复用的既有目录里这份环境不可用（${detail}）：${resolution.activeDir}。它不在托管根下（可能是别的工具留下的环境），请到「设置 → 内置运行时」点「重置并重新安装」把运行时装进托管根 —— 该旧目录不会被删除。${tail}`;
    case "override":
      return `${descriptor.label} 由覆盖口（环境变量）指定的目录不可用（${detail}）：${resolution.activeDir}。请检查那个环境变量指向的环境，或在「设置 → 内置运行时」点「重置并重新安装」就地把这份环境重建——${tail}`;
    case "pending":
      return `${descriptor.label} 尚无可用实例（${detail}）。${tail}`;
  }
}

function clearLeftovers(descriptor) {
  const { root } = descriptor.options;
  for (const name of listStaging(root, descriptor.id)) {
    removeDir(join(runtimeHome(root, descriptor.id), name));
  }
  const target = instanceDir(root, descriptor.id, descriptor.version);
  if (!isCompleteInstance(target)) removeDir(target);
}

async function installAtOverride(descriptor, resolution, spawn2, context) {
  context.onProgress?.({ message: `正在安装 ${descriptor.label} ${descriptor.version}…` });
  const machine = await driveRuntimeMachine(descriptor.createRunner(resolution.activeDir), spawn2);
  if (!machine.ready) return { status: "failed", phase: machine.phase, error: machine.error };
  return { status: "ready", activeDir: resolution.activeDir };
}

async function installRuntime(descriptor, spawn2, context = {}) {
  const { root } = descriptor.options;
  const resolution = descriptor.resolve();
  if (resolution.source === "override") return installAtOverride(descriptor, resolution, spawn2, context);
  const target = instanceDir(root, descriptor.id, descriptor.version);
  if (isCompleteInstance(target)) {
    writeCurrent(root, descriptor.id, descriptor.version);
    context.onProgress?.({ message: `${descriptor.label} ${descriptor.version} 已安装，无需重新下载。` });
    return { status: "ready", activeDir: descriptor.envDirOf(target) };
  }
  clearLeftovers(descriptor);
  const staging = stagingDir(root, descriptor.id, descriptor.version, stagingNonce());
  mkdirSync(staging, { recursive: true });
  const envDir = descriptor.envDirOf(staging);
  let acquired;
  try {
    acquired = await descriptor.acquire?.(envDir, {
      spawn: spawn2,
      ...context.signal === void 0 ? {} : { signal: context.signal },
      ...context.onProgress === void 0 ? {} : { onProgress: context.onProgress },
      ...context.opener === void 0 ? {} : { opener: context.opener }
    });
  } catch (error) {
    removeDir(staging);
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof DownloadCancelledError || error instanceof Error && error.name === "AbortError";
    const phase = cancelled ? CANCELLED_PHASE : ACQUIRE_PHASE;
    appendRuntimeEvent(descriptor, {
      kind: "runtime_install",
      outcome: cancelled ? "cancelled" : "failed",
      phase,
      error: message
    });
    return { status: "failed", phase, error: message };
  }
  for (const warning of acquired?.warnings ?? []) {
    appendRuntimeEvent(descriptor, { kind: "runtime_install", outcome: "warning", phase: "shasums-metadata", error: warning });
    context.onProgress?.({ message: warning });
  }
  context.onProgress?.({ message: `正在安装 ${descriptor.label} ${descriptor.version}…` });
  const staged = await driveRuntimeMachine(descriptor.createRunner(envDir), spawn2);
  if (!staged.ready) {
    removeDir(staging);
    appendRuntimeEvent(descriptor, { kind: "runtime_install", outcome: "failed", phase: staged.phase, error: staged.error });
    return { status: "failed", phase: staged.phase, error: staged.error };
  }
  try {
    context.onProgress?.({ message: "正在进位并复验…" });
    const promoted = promoteStaging(root, descriptor.id, descriptor.version, staging);
    const verified = await descriptor.inspect(descriptor.envDirOf(promoted), spawn2);
    if (verified.kind !== "ready") {
      const detail = verified.kind === "deps-missing" ? `缺依赖 ${verified.module}` : verified.kind;
      const error = `安装后在最终路径上复验不通过（${detail}）—— 已进位但**未**发布，环境按未就绪处理。请点「重置并重新安装」重来一次；若反复出现，请把诊断报告发给我们。`;
      appendRuntimeEvent(descriptor, { kind: "runtime_install", outcome: "failed", phase: "verify-promoted", error });
      return { status: "failed", phase: "verify-promoted", error };
    }
    writeManifest(promoted, manifestFor(descriptor, acquired));
    writeCurrent(root, descriptor.id, descriptor.version);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { phase: "publish", error: `发布托管实例失败：${message}` };
    appendRuntimeEvent(descriptor, { kind: "runtime_install", outcome: "failed", ...failure });
    return { status: "failed", ...failure };
  }
  appendRuntimeEvent(descriptor, { kind: "runtime_install", outcome: "installed", version: descriptor.version });
  context.onProgress?.({ message: `${descriptor.label} 安装完成。` });
  return { status: "ready", activeDir: descriptor.envDirOf(target) };
}

async function ensureRuntime(descriptor, spawn2) {
  const resolution = descriptor.resolve();
  if (resolution.source === "pending") {
    if (isCompleteInstance(resolution.instanceDir)) {
      publishCurrent(descriptor.options.root, descriptor.id, resolution.version);
      return { status: "ready", activeDir: resolution.activeDir };
    }
    return { status: "failed", phase: NOT_INSTALLED_PHASE, error: notInstalledMessage(descriptor) };
  }
  const inspected = await descriptor.inspect(resolution.activeDir, spawn2);
  if (inspected.kind === "ready") return { status: "ready", activeDir: resolution.activeDir };
  const detail = inspected.kind === "deps-missing" ? `缺 ${inspected.module}` : inspected.kind === "wrong-version" ? `版本不符（当前 ${inspected.version}，需要 ${descriptor.version}）` : "可执行环境不存在";
  const error = notReadyMessage(descriptor, resolution, detail);
  appendRuntimeEvent(descriptor, {
    kind: "runtime_ensure",
    outcome: "failed",
    phase: NOT_READY_PHASE,
    error,
    source: resolution.source
  });
  return { status: "failed", phase: NOT_READY_PHASE, error };
}

async function resetRuntime(descriptor, spawn2, context = {}) {
  const resolution = descriptor.resolve();
  appendRuntimeEvent(descriptor, { kind: "runtime_reset", outcome: "started", source: resolution.source });
  if (resolution.source === "override") return installAtOverride(descriptor, resolution, spawn2, context);
  clearLeftovers(descriptor);
  removeDir(instanceDir(descriptor.options.root, descriptor.id, descriptor.version));
  return installRuntime(descriptor, spawn2, context);
}

async function inspectRuntime(descriptor, spawn2) {
  return descriptor.inspect(descriptor.resolve().activeDir, spawn2);
}

function readRuntimeSwitch() {
  const prefs = readPreferences().runtimes;
  return { master: prefs?.enabled ?? true, items: prefs?.items ?? {} };
}

function writeRuntimeMaster(enabled) {
  writeRuntimeSwitch({ ...readPreferences().runtimes, enabled });
}

function writeRuntimeEnabled(id, enabled) {
  const current = readPreferences().runtimes;
  writeRuntimeSwitch({ ...current, items: { ...current?.items, [id]: enabled } });
}

function writeRuntimeSwitch(next) {
  writePreferences({ ...readPreferences(), runtimes: next });
}

const RUNTIME_PRESENTATION = {
  python: {
    purpose: "文档转换（docx 引擎的解释器）",
    // uv.exe（≈17 MB）+ CPython 独立发行版（≈22 MB）+ wheel 依赖（数十 MB，未实测）。
    downloadSizeHint: "下载约 40–100 MB，解压后约 100 MB",
    executableLabel: "Python 解释器",
    executableOf: (activeDir, platform) => pythonExecutable(activeDir, platform)
  },
  node: {
    purpose: "运行 JavaScript / Node 脚本与前端构建工具",
    downloadSizeHint: "下载约 34 MB，解压后约 95 MB"
  },
  gitbash: {
    purpose: "提供 bash 与常用 unix 命令行工具",
    downloadSizeHint: "下载约 56 MB，解压后约 389 MB"
  }
};

/**
 * 各托管运行时**适用的平台**。
 *
 * 为什么需要这张表：托管运行时里有一个（bash）是 Windows 专有的 ——
 * `GITBASH_ARTIFACT` 是 `PortableGit-...-64-bit.7z.exe`，即一个 Windows
 * 自解压程序，macOS/Linux 上既没有等价发行版、**也不需要**（这两个系统自带
 * bash）。若不按平台过滤，UI 会在 macOS 上显示「bash 运行时：未安装」并给出
 * 安装按钮 —— 用户点下去会下载一个跑不起来的 .7z.exe，然后困惑地失败。
 *
 * 过滤发生在 `runtimeDescriptors` 这一处：运行时清单（UI）与 shell 注入
 * 都从它派生，所以一处过滤即可同时修正「界面误导」与「注入不该注入的东西」。
 *
 * 未列出的 id 默认全平台适用。
 */
const RUNTIME_PLATFORMS = {
	node: ["win32", "darwin", "linux"],
	python: ["win32", "darwin", "linux"],
	// bash 运行时是 Git for Windows 的 PortableGit 包，仅 Windows 适用。
	// 其它平台的 bash 由系统提供（/bin/bash），无需托管。
	gitbash: ["win32"]
};

function runtimeAppliesOnThisPlatform(id) {
	const platforms = RUNTIME_PLATFORMS[id];
	return platforms === void 0 || platforms.includes(process.platform);
}

function runtimeDescriptors(overrides) {
	const options = defaultPythonRuntimeOptions(overrides);
	return Object.entries(RUNTIME_REGISTRY)
		.filter(([id]) => runtimeAppliesOnThisPlatform(id))
		.map(([, create]) => create(options));
}

function runtimeDescriptorOf(id, overrides = {}) {
  const descriptor = runtimeDescriptors(overrides).find((candidate) => candidate.id === id);
  if (descriptor === void 0) throw new Error(`未知的托管运行时 id：${id}`);
  return descriptor;
}

function classify(descriptor, enabled) {
  if (!enabled) return { kind: "disabled" };
  const resolution = descriptor.resolve();
  if (resolution.source !== "pending") return { kind: "ready" };
  const failure = readLastRuntimeFailure(descriptor);
  if (failure !== void 0) {
    return { kind: "failed", detail: `相位 ${failure.phase}：${failure.error}` };
  }
  return { kind: "missing" };
}

function entryOf(descriptor, state) {
  const presentation = RUNTIME_PRESENTATION[descriptor.id];
  const enabled = state.items[descriptor.id] !== false;
  const base = {
    id: descriptor.id,
    label: descriptor.label,
    purpose: presentation?.purpose ?? "（用途未登记）",
    version: descriptor.version,
    enabled,
    status: classify(descriptor, state.master && enabled),
    downloadSizeHint: presentation?.downloadSizeHint ?? "体积未登记"
  };
  if (!(state.master && enabled)) return base;
  const { activeDir } = descriptor.resolve();
  return {
    ...base,
    activeDir,
    ...presentation?.executableOf === void 0 ? {} : {
      executable: presentation.executableOf(activeDir, descriptor.options.platform),
      executableLabel: presentation.executableLabel ?? "可执行文件"
    }
  };
}

function collectRuntimeInventory(overrides = {}) {
  const state = readRuntimeSwitch();
  return {
    master: state.master,
    items: runtimeDescriptors(overrides).map((descriptor) => entryOf(descriptor, state))
  };
}

function planRuntimeShellInjection(options = {}) {
  const overrides = options.overrides ?? {};
  const state = readRuntimeSwitch();
  return planRuntimeInjection(
    runtimeDescriptors(overrides).map((descriptor) => ({
      id: descriptor.id,
      // 逐项开关的生效值（与 entryOf 同一处判法：只有显式 `false` 才算被禁用）。
      enabled: state.items[descriptor.id] !== false,
      resolution: descriptor.resolve()
    })),
    {
      master: state.master,
      root: defaultPythonRuntimeOptions(overrides).root,
      env: options.env ?? process.env
    }
  );
}

async function collectRuntimeDiagnosticsText(id, spawn2, overrides = {}) {
  const descriptor = runtimeDescriptorOf(id, overrides);
  const report = await collectRuntimeDiagnostics(descriptor, spawn2);
  return {
    id,
    label: descriptor.label,
    text: renderRuntimeDiagnostics(report),
    logPath: report.logPath
  };
}

async function resetManagedRuntime(id, spawn2, overrides = {}) {
  const descriptor = runtimeDescriptorOf(id, overrides);
  const outcome = await resetRuntime(descriptor, spawn2);
  if (outcome.status === "failed") {
    throw new Error(`重置「${descriptor.label}」失败（相位 ${outcome.phase}）：${outcome.error}`);
  }
  return collectRuntimeInventory(overrides);
}

async function installManagedRuntime(id, spawn2, signal, overrides = {}, onProgress) {
  const descriptor = runtimeDescriptorOf(id, overrides);
  if (descriptor.resolve().source !== "pending") return collectRuntimeInventory(overrides);
  const guarded = signal === void 0 ? spawn2 : async (request) => {
    if (signal.aborted) throw runtimeInstallAbort(descriptor.label);
    return spawn2(request);
  };
  const outcome = await installRuntime(descriptor, guarded, {
    ...signal === void 0 ? {} : { signal },
    ...onProgress === void 0 ? {} : {
      onProgress: (update) => onProgress({
        id,
        kind: "running",
        message: update.message,
        ...update.percent === void 0 ? {} : { percent: update.percent }
      })
    }
  });
  if (outcome.status === "failed") {
    if (outcome.phase === CANCELLED_PHASE) throw runtimeInstallAbort(descriptor.label);
    throw new Error(`安装「${descriptor.label}」失败（相位 ${outcome.phase}）：${outcome.error}`);
  }
  return collectRuntimeInventory(overrides);
}

export {
	ACQUIRE_PHASE,
	CANCELLED_PHASE,
	CURRENT_POINTER_NAME,
	DEPS_PROBE,
	DownloadCancelledError,
	DownloadError,
	ENGINE_DEPS_MODULES,
	GITBASH_ARTIFACT,
	GITBASH_ARTIFACT_SHA256,
	GITBASH_BASH_RELATIVE,
	GITBASH_LABEL,
	GITBASH_MIN_BYTES,
	GITBASH_MIRROR_DIR,
	GITBASH_OFFICIAL_DIR,
	GITBASH_RELEASE_TAG,
	GITBASH_REQUIRED_FILES,
	GITBASH_RUNTIME_ID,
	GITBASH_RUNTIME_VERSION,
	GITBASH_SIZE_HINT,
	GITBASH_SOURCE_OFFER_RELATIVE,
	GITBASH_URL_ENV,
	LEGACY_DOCX_VENV_DIRNAME,
	MANAGED_ROOT_ENV,
	MANIFEST_NAME,
	MAX_REDIRECTS,
	NODE_DIST_DIR,
	NODE_LABEL,
	NODE_MIN_BYTES,
	NODE_MIRROR_DIR,
	NODE_RUNTIME_ID,
	NODE_RUNTIME_VERSION,
	NODE_URL_ENV,
	NOT_INSTALLED_PHASE,
	NOT_READY_PHASE,
	PART_SUFFIX,
	PROBE_PHASE,
	PYTHON_MACHINE,
	PYTHON_RUNTIME_ID,
	PYTHON_RUNTIME_VERSION,
	PYTHON_VENV_DIRNAME,
	REDIRECT_STATUS,
	REQUIRED_FILES_PHASE,
	RESOURCES_DIR_ENV,
	RUNTIME_ENV_LAYOUT,
	RUNTIME_PRESENTATION,
	RUNTIME_REGISTRY,
	STAGING_PREFIX,
	VENV_OVERRIDE_ENV,
	acquireArtifact,
	appendRuntimeEvent,
	bindPayloadProbeRunner,
	bindRuntimeMachine,
	classify,
	clearLeftovers,
	closeStream,
	collectRuntimeDiagnostics,
	collectRuntimeDiagnosticsText,
	collectRuntimeInventory,
	contentLengthOf,
	createEnvContext,
	createGitbashRuntime,
	createNodeRuntime,
	createPythonRuntime,
	crossCheckShasums,
	currentPointer,
	defaultPythonRuntimeOptions,
	defaultSpawn,
	describeProbeOutcome,
	describeStatus,
	downloadArtifact,
	downloadCacheDir,
	driveRuntimeMachine,
	ensurePythonRuntime,
	ensureRuntime,
	entryOf,
	excerpt$2,
	extractAndCheck,
	extractNodeZip,
	extractPortableGit,
	fail$1,
	feedFile,
	fetchText,
	firstMissingPayloadFile,
	formatBytes,
	gitbashArtifactSpec,
	gitbashArtifactUrls,
	gitbashBashPath,
	gitbashProbeSpec,
	gitbashSourceOfferPath,
	hashFile,
	initialEnvState,
	inspectPayload,
	inspectPythonRuntime,
	inspectRuntime,
	inspectVenv,
	installAtOverride,
	installManagedRuntime,
	installRuntime,
	instanceDir,
	isCompleteInstance,
	listDirs,
	listInstances,
	listStaging,
	looksLikeEngineVenv,
	manifestFile,
	manifestFor,
	nextStep,
	nextStepsFor,
	nodeArtifactSpec,
	nodeArtifactUrls,
	nodeProbeSpec,
	notInstalledMessage,
	notReadyMessage,
	openHttp,
	parseGitVersion,
	parseMissingModule,
	parseNodeVersion,
	parsePythonVersion,
	partFileFor,
	pathKeyOf,
	planRuntimeInjection,
	planRuntimeShellInjection,
	prependPath,
	promoteStaging,
	publishCurrent,
	pythonExecutable,
	readCurrent,
	readLastRuntimeFailure,
	readManifest,
	readRuntimeSwitch,
	reduce,
	removeDir,
	renderRuntimeDiagnostics,
	requestOnce,
	resetManagedRuntime,
	resetRuntime,
	resolveGitbashRuntime,
	resolveNodeRuntime,
	resolvePythonVenv,
	runtimeDescriptorOf,
	runtimeDescriptors,
	runtimeHome,
	runtimeLogDir,
	runtimeResourcesDir,
	runtimesRoot,
	sha256File,
	sitePackagesDirs,
	stagingDir,
	stagingNonce,
	succeeded,
	toEnsureResult,
	uvCandidates,
	uvOf,
	venvPython,
	venvPythonPath,
	writeChunk,
	writeCurrent,
	writeManifest,
	writeRuntimeEnabled,
	writeRuntimeMaster,
	writeRuntimeSwitch,
};