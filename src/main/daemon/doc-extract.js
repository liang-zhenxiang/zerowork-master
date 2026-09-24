import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { INVOKE } from "../../shared/ipc.js";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { LEGACY_DOC_EXTENSIONS } from "../../shared/ipc.js";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { OFFICE_EXTENSIONS } from "../../shared/ipc.js";
import { openSync } from "node:fs";
import { PDF_EXTENSION } from "../../shared/ipc.js";
import { PUSH } from "../../shared/ipc.js";
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
import { Type } from "typebox";
import { writeFileSync } from "node:fs";
import { clipAuditDetail } from "./audit.js";
import {
	defaultPythonRuntimeOptions,
	defaultSpawn,
	ensurePythonRuntime,
} from "./runtimes.js";

function runtimeInstallAbort(label) {
  const error = new Error(`已取消「${label}」的安装`);
  error.name = "AbortError";
  return error;
}

class DocExtractError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "DocExtractError";
    this.code = code;
  }
}

const SUPPORTED_LIST = "pdf / docx / xlsx / pptx / odt / odp / ods";

function detectDocKind(path) {
  const ext = extname(path).toLowerCase();
  if (ext === PDF_EXTENSION) return { kind: "pdf" };
  if (OFFICE_EXTENSIONS.has(ext)) return { kind: "office" };
  if (LEGACY_DOC_EXTENSIONS.has(ext)) return { kind: "legacy", ext };
  return { kind: "unsupported", ext };
}

const MAX_CHARS = 24e3;

const SCANNED_TEXT_THRESHOLD = 20;

async function extractDocument(path, offset, limit) {
  const docKind = detectDocKind(path);
  if (docKind.kind === "legacy") {
    throw new DocExtractError("legacy", `请另存为 .docx/.xlsx/.pptx 后重试（老格式 ${docKind.ext} 暂不支持）`);
  }
  if (docKind.kind === "unsupported") {
    const shown = docKind.ext === "" ? "（无扩展名）" : docKind.ext;
    throw new DocExtractError("unsupported", `不支持的文件格式 ${shown}。支持：${SUPPORTED_LIST}`);
  }
  if (!existsSync(path)) {
    throw new DocExtractError("not-found", `文件不存在：${path}`);
  }
  return docKind.kind === "pdf" ? extractPdf(path, offset, limit) : extractOffice(path, offset, limit);
}

let pdfAssetUrls;

let pdfWorkerReady;

async function ensurePdfWorker() {
  if (pdfWorkerReady === void 0) {
    pdfWorkerReady = (async () => {
      const globals = globalThis;
      if (globals.pdfjsWorker !== void 0) return;
      globals.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    })();
  }
  await pdfWorkerReady;
}

function getPdfAssetUrls() {
  if (pdfAssetUrls === void 0) {
    const require3 = createRequire(import.meta.url);
    const pdfjsRoot = dirname(require3.resolve("pdfjs-dist/package.json"));
    pdfAssetUrls = {
      cMapUrl: `${join(pdfjsRoot, "cmaps")}/`,
      standardFontDataUrl: `${join(pdfjsRoot, "standard_fonts")}/`
    };
  }
  return pdfAssetUrls;
}

async function readPdfPages(path) {
  const [{ getDocument }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    // worker 必须在 getDocument 之前挂好：装配只发生一次（见 ensurePdfWorker）。
    ensurePdfWorker()
  ]);
  const { cMapUrl, standardFontDataUrl } = getPdfAssetUrls();
  const loadingTask = getDocument({
    data: new Uint8Array(readFileSync(path)),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl
  });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    throw mapPdfOpenError(err);
  }
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
      }
      pages.push(text);
    }
    return pages;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DocExtractError("corrupt", `PDF 解析失败（文件可能已损坏）：${detail}`);
  } finally {
    await loadingTask.destroy();
  }
}

function mapPdfOpenError(err) {
  if (err instanceof Error && err.name === "PasswordException") {
    return new DocExtractError("encrypted", "文件已加密，无法读取");
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new DocExtractError("corrupt", `PDF 解析失败（文件可能已损坏）：${detail}`);
}

async function extractPdf(path, offset, limit) {
  const pages = await readPdfPages(path);
  const totalPages = pages.length;
  const wholeText = pages.join("");
  if (wholeText.replace(/\s+/g, "").length < SCANNED_TEXT_THRESHOLD) {
    throw new DocExtractError("scanned", "该 PDF 没有文本层（可能是扫描件），暂无法读取");
  }
  const start2 = offset ?? 1;
  if (start2 < 1 || start2 > totalPages) {
    return {
      text: `offset=${start2} 超出范围：该 PDF 共 ${totalPages} 页（offset 取值范围 1-${totalPages}）`,
      truncated: false,
      nextOffset: void 0,
      totalPages
    };
  }
  if (limit !== void 0 && limit < 1) {
    return {
      text: `limit=${limit} 无效：limit 必须 ≥ 1`,
      truncated: false,
      nextOffset: void 0,
      totalPages
    };
  }
  const requestedEnd = limit === void 0 ? totalPages : Math.min(start2 + limit - 1, totalPages);
  let body = "";
  let lastShown = start2 - 1;
  for (let i = start2; i <= requestedEnd; i++) {
    const block = `--- 第 ${i} 页 ---
${pages[i - 1] ?? ""}
`;
    if (body.length + block.length > MAX_CHARS && lastShown >= start2) break;
    body += block;
    lastShown = i;
  }
  const truncated = lastShown < totalPages;
  const text = truncated ? `${body.trimEnd()}
[共 ${totalPages} 页，已显示第 ${start2}-${lastShown} 页。继续读请用 offset=${lastShown + 1}]` : body.trimEnd();
  return {
    text,
    truncated,
    nextOffset: truncated ? lastShown + 1 : void 0,
    totalPages
  };
}

let officeTemp;

function getOfficeTempDir() {
  if (officeTemp === void 0) {
    officeTemp = join(tmpdir(), "zerowork-officeparser");
    mkdirSync(officeTemp, { recursive: true });
  }
  return officeTemp;
}

async function extractOffice(path, offset, limit) {
  const { parseOfficeAsync } = await import("officeparser");
  let full;
  try {
    full = await parseOfficeAsync(path, { tempFilesLocation: getOfficeTempDir() });
  } catch (err) {
    throw mapOfficeError(err);
  }
  const total = full.length;
  if (total === 0) {
    return { text: "", truncated: false, nextOffset: void 0, totalPages: void 0 };
  }
  const start2 = offset ?? 1;
  if (start2 < 1 || start2 > total) {
    return {
      text: `offset=${start2} 超出范围：全文共 ${total} 字符（offset 取值范围 1-${total}）`,
      truncated: false,
      nextOffset: void 0,
      totalPages: void 0
    };
  }
  if (limit !== void 0 && limit < 1) {
    return {
      text: `limit=${limit} 无效：limit 必须 ≥ 1`,
      truncated: false,
      nextOffset: void 0,
      totalPages: void 0
    };
  }
  const budget = Math.min(limit ?? MAX_CHARS, MAX_CHARS);
  const shownLen = Math.min(budget, total - (start2 - 1));
  const lastCharPos = start2 + shownLen - 1;
  const truncated = lastCharPos < total;
  const shown = full.slice(start2 - 1, lastCharPos);
  const text = truncated ? `${shown}
[已显示第 ${start2}-${lastCharPos} 字符。继续读请用 offset=${lastCharPos + 1}]` : shown;
  return {
    text,
    truncated,
    nextOffset: truncated ? lastCharPos + 1 : void 0,
    totalPages: void 0
  };
}

function mapOfficeError(err) {
  const detail = err instanceof Error ? err.message : String(err);
  if (/password|encrypt/i.test(detail)) {
    return new DocExtractError("encrypted", "文件已加密，无法读取");
  }
  return new DocExtractError("corrupt", `文档解析失败（文件可能已损坏）：${detail}`);
}

function createDocReadTool(options = {}) {
  return (pi) => {
    pi.registerTool({
      name: "read_document",
      label: "阅读文档",
      description: "Read a PDF or Office document (pdf, docx, xlsx, pptx, odt, odp, ods) and extract its text. Use this tool for those document formats; use `read` for plain text, code, and images instead. PDFs are extracted page by page: offset/limit are page numbers (1-indexed) and reading starts at page 1 by default. Office documents are extracted as one text stream: offset/limit are character positions (1-indexed). Long documents are truncated and the result ends with a continuation hint — call again with the suggested offset to keep reading. Scanned PDFs without a text layer, legacy .doc/.xls/.ppt files, and encrypted documents cannot be read; the error message says what to do instead.",
      promptSnippet: "PDF / Word / Excel / PPT / ODF 文档用 read_document 提取正文；纯文本、代码、图片仍用 read。",
      promptGuidelines: [
        "长文档按返回末尾的续读提示（offset=N）继续读；不要凭已读部分编造未读内容。",
        "扫描件 PDF、老格式 .doc/.xls/.ppt、加密文件读不了，按错误文案引导用户转换后再读，不要反复重试。"
      ],
      parameters: Type.Object({
        path: Type.String({ description: "Path to the document (relative or absolute)." }),
        offset: Type.Optional(
          Type.Number({
            description: "PDF: page number to start from (1-indexed, default 1). Office: character position to start from (1-indexed, default 1)."
          })
        ),
        limit: Type.Optional(
          Type.Number({
            description: "PDF: maximum number of pages to read. Office: maximum number of characters to read. Output is capped either way."
          })
        )
      }),
      async execute(_toolCallId, params) {
        const extract = options.extract ?? extractDocument;
        try {
          const result = await extract(params.path, params.offset, params.limit);
          return {
            // 空文档（新建没写内容）是合法形态：给一句明确的说明，
            // 空串会让模型以为提取失败而反复重试。
            content: [
              {
                type: "text",
                text: result.text === "" ? "（该文档没有可提取的文本内容）" : result.text
              }
            ],
            details: {
              truncated: result.truncated,
              nextOffset: result.nextOffset,
              totalPages: result.totalPages
            }
          };
        } catch (err) {
          if (err instanceof DocExtractError) throw new Error(err.message);
          throw err;
        }
      }
    });
  };
}

function defaultRun(req) {
  return new Promise((resolvePromise) => {
    const child = spawn(req.command, [...req.args], {
      cwd: req.cwd,
      env: req.env === void 0 ? process.env : { ...process.env, ...req.env },
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let outputTruncated = false;
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(outcome);
    };
    const onData = (chunk, isStdout) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > req.maxOutputBytes) {
        outputTruncated = true;
        child.kill();
        return;
      }
      if (isStdout) stdout += chunk;
      else stderr += chunk;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, req.timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d) => onData(d, true));
    child.stderr.setEncoding("utf8").on("data", (d) => onData(d, false));
    child.on("error", (err) => {
      settle({ code: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr, timedOut, outputTruncated });
    });
  });
}

class DocxConvertError extends Error {
  constructor(kind, message, markdownFallback) {
    super(message);
    this.kind = kind;
    this.markdownFallback = markdownFallback;
    this.name = "DocxConvertError";
  }
  kind;
  markdownFallback;
}

function classifyEnsureError$1(failed) {
  return new DocxConvertError(
    "env-not-ready",
    `docx 生成环境未就绪（${failed.phase}）：${failed.error}
环境修复前请先把内容以 Markdown 形式交付（保存为 .md），并告知用户 docx 环境未就绪的原因。`
  );
}

const DEFAULT_CONVERT_TIMEOUT_MS = 12e4;

const DEFAULT_MAX_OUTPUT_BYTES$1 = 1048576;

function buildConvertArgs(req) {
  const args = ["-m", "html_to_docx", "convert", req.inputPath, "-o", req.outputPath];
  const opts = req.options;
  if (opts?.pageSize !== void 0) args.push("--page-size", opts.pageSize);
  if (opts?.orientation !== void 0) args.push("--orientation", opts.orientation);
  if (opts?.marginTop !== void 0) args.push("--margin-top", String(opts.marginTop));
  if (opts?.marginBottom !== void 0) args.push("--margin-bottom", String(opts.marginBottom));
  if (opts?.marginLeft !== void 0) args.push("--margin-left", String(opts.marginLeft));
  if (opts?.marginRight !== void 0) args.push("--margin-right", String(opts.marginRight));
  return args;
}

function excerpt$1(text, max = 400) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function parseSuccessJson$1(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed === "object" && parsed !== null && "docx_path" in parsed && typeof parsed.docx_path === "string") {
      const record = parsed;
      return {
        docxPath: record.docx_path,
        warnings: Array.isArray(record.warnings) ? record.warnings.filter((w) => typeof w === "string") : []
      };
    }
  } catch {
  }
  throw new DocxConvertError(
    "convert-failed",
    `引擎成功退出但 stdout 不是契约 JSON：${excerpt$1(stdout)}`
  );
}

function parseFailureJson$1(stderr, code) {
  try {
    const parsed = JSON.parse(stderr.trim());
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const record = parsed;
      const fallback = typeof record.markdown_fallback === "string" && record.markdown_fallback !== "" ? record.markdown_fallback : void 0;
      return new DocxConvertError(
        "convert-failed",
        `docx 转换失败：${typeof record.error === "string" ? record.error : "引擎未给出原因"}`,
        fallback
      );
    }
  } catch {
  }
  return new DocxConvertError(
    "convert-failed",
    `引擎以退出码 ${String(code)} 失败且 stderr 不是契约 JSON：${excerpt$1(stderr)}`
  );
}

async function convertHtmlToDocx(req, run) {
  const outcome = await run({
    command: req.python,
    args: buildConvertArgs(req),
    cwd: req.engineDir,
    env: { PYTHONPATH: req.engineDir },
    timeoutMs: req.timeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS,
    maxOutputBytes: req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES$1
  });
  if (outcome.timedOut === true) {
    throw new DocxConvertError(
      "timeout",
      `docx 转换超时（>${String(req.timeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS)}ms）。首次转换含图片下载可能较慢，可重试；反复超时请检查 HTML 里的远程图片是否可达。`
    );
  }
  if (outcome.outputTruncated === true) {
    throw new DocxConvertError(
      "output-too-large",
      `引擎输出超过上限（${String(req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES$1)} 字节），不符合一行 JSON 的契约，按引擎行为异常处理。`
    );
  }
  if (outcome.code === null) {
    throw new DocxConvertError(
      "convert-failed",
      `venv Python 未能启动：${outcome.error ?? "未知原因"}（${req.python}）。环境可能在 ensure 之后被破坏，请重试（会先重新 ensure）。`
    );
  }
  if (outcome.code === 0) return parseSuccessJson$1(outcome.stdout);
  throw parseFailureJson$1(outcome.stderr, outcome.code);
}

const FALLBACK_MESSAGE_CAP = 16e3;

function createDocxConvertTool(options) {
  return (pi) => {
    pi.registerTool({
      name: "docx_convert",
      label: "生成 Word 文档",
      description: "把 HTML 文件转换为 Word .docx 文档。输入是已经写好的 HTML 文件（文档排版流程的产物），输出 .docx。可选页面参数：A4/Letter/A3、纵向/横向、页边距（厘米）。Python 环境按需安装、不会自动下载：尚未安装时本工具会返回原因与「到设置 → 内置运行时点安装」的引导。环境不可用或转换失败时会返回原因，转换失败可能附带 Markdown 降级内容 —— 应保存为 .md 交付并说明原因。",
      promptSnippet: "docx_convert: 把排版好的 HTML 转成 .docx（htmlPath → outputPath），成功后用 present_files 交付",
      promptGuidelines: [
        "转换成功后必须经 present_files 把 .docx 交付给用户；中间态 HTML 不交付。",
        "同一处失败不要反复重试：环境类失败按错误里的引导告知用户，转换类失败用附带的 Markdown 降级交付。"
      ],
      parameters: Type.Object({
        htmlPath: Type.String({ description: "输入 HTML 文件的绝对路径。" }),
        outputPath: Type.String({ description: "输出 .docx 的绝对路径（写工作区产物文件档位判定）。" }),
        pageSize: Type.Optional(
          Type.Union([Type.Literal("A4"), Type.Literal("Letter"), Type.Literal("A3")], {
            description: "页面大小，缺省 A4。"
          })
        ),
        orientation: Type.Optional(
          Type.Union([Type.Literal("portrait"), Type.Literal("landscape")], {
            description: "页面方向，缺省 portrait（纵向）。"
          })
        ),
        marginTop: Type.Optional(Type.Number({ description: "上边距，厘米（缺省 2.54）。" })),
        marginBottom: Type.Optional(Type.Number({ description: "下边距，厘米（缺省 2.54）。" })),
        marginLeft: Type.Optional(Type.Number({ description: "左边距，厘米（缺省 3.17）。" })),
        marginRight: Type.Optional(Type.Number({ description: "右边距，厘米（缺省 3.17）。" }))
      }),
      async execute(_toolCallId, params) {
        const runtimeOptions = defaultPythonRuntimeOptions({
          engineDir: options.engineDir,
          homeDir: options.homeDir,
          platform: options.platform ?? process.platform
        });
        const ensure = options.ensure ?? ensurePythonRuntime;
        const env = await ensure(runtimeOptions, defaultSpawn);
        if (env.status !== "ready") {
          options.onAudit?.({
            category: "runtime",
            outcome: "failed",
            detail: clipAuditDetail(`docx 生成运行时未就绪（${env.phase}）：${env.error}`)
          });
          throw classifyEnsureError$1(env);
        }
        const convert = options.convert ?? convertHtmlToDocx;
        const cliOptions = {
          ...params.pageSize !== void 0 ? { pageSize: params.pageSize } : {},
          ...params.orientation !== void 0 ? { orientation: params.orientation } : {},
          ...params.marginTop !== void 0 ? { marginTop: params.marginTop } : {},
          ...params.marginBottom !== void 0 ? { marginBottom: params.marginBottom } : {},
          ...params.marginLeft !== void 0 ? { marginLeft: params.marginLeft } : {},
          ...params.marginRight !== void 0 ? { marginRight: params.marginRight } : {}
        };
        try {
          const result = await convert(
            {
              python: env.python,
              engineDir: options.engineDir,
              inputPath: params.htmlPath,
              outputPath: params.outputPath,
              options: cliOptions
            },
            defaultRun
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  type: "docx_convert_result",
                  docx_path: result.docxPath,
                  warnings: result.warnings,
                  message: "转换成功，请用 present_files 把该 docx 交付给用户。"
                })
              }
            ],
            details: { docxPath: result.docxPath, warnings: result.warnings }
          };
        } catch (err) {
          if (err instanceof DocxConvertError) {
            let message = err.message;
            if (err.markdownFallback !== void 0) {
              const fallback = err.markdownFallback.length > FALLBACK_MESSAGE_CAP ? `${err.markdownFallback.slice(0, FALLBACK_MESSAGE_CAP)}
（降级内容过长，已截断）` : err.markdownFallback;
              message += "\n\n引擎附带的 Markdown 降级内容如下，请保存为 .md 文件交付并说明 docx 转换失败的原因：\n\n" + fallback;
            }
            throw new Error(message);
          }
          throw err;
        }
      }
    });
  };
}

class DocxExtractError extends Error {
  constructor(kind, message, warnings = []) {
    super(message);
    this.kind = kind;
    this.warnings = warnings;
    this.name = "DocxExtractError";
  }
  kind;
  warnings;
}

function classifyEnsureError(failed) {
  return new DocxExtractError(
    "env-not-ready",
    `docx 提取环境未就绪（${failed.phase}）：${failed.error}
请如实告知用户环境未就绪的原因，不要反复重试（Python 运行时按需安装，不会自动下载）。需要继续原任务时，可改用 read_document 读取该文档的文本内容。`
  );
}

const INPUT_ERROR_PREFIXES = [
  "输入路径不存在",
  "输入路径不是文件",
  "输入不是 .docx",
  "不是有效的 .docx",
  "无法读取",
  "无法解析",
  "缺少输出 HTML 路径"
];

function classifyEngineError(error) {
  return INPUT_ERROR_PREFIXES.some((prefix) => error.startsWith(prefix)) ? "input-invalid" : "extract-failed";
}

function failureMessage(kind, error) {
  const detail = error === "" ? "引擎未给出原因" : error;
  if (kind === "input-invalid") {
    return `docx 提取失败（输入不可用）：${detail}
请向用户如实说明是哪个文件、什么问题；只支持 .docx（旧版 .doc 请先另存为 .docx）。这类失败重试无用，不要反复调用。`;
  }
  return `docx 提取失败：${detail}
请如实把原因转述给用户；可改用 read_document 读取文本内容继续任务的其余部分，不要重复调用。`;
}

const DEFAULT_EXTRACT_TIMEOUT_MS = 12e4;

const DEFAULT_MAX_OUTPUT_BYTES = 1048576;

function buildExtractArgs(req) {
  const args = ["-m", "docx_to_html", "extract", req.docxPath, "-o", req.outputPath];
  if (req.assetsDir !== void 0) args.push("--assets-dir", req.assetsDir);
  return args;
}

function excerpt(text, max = 400) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function parseStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function parseSuccessJson(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed === "object" && parsed !== null && "html_path" in parsed && typeof parsed.html_path === "string") {
      const record = parsed;
      return {
        htmlPath: record.html_path,
        assetsDir: typeof record.assets_dir === "string" ? record.assets_dir : "",
        images: parseImages(record.images),
        warnings: parseStringArray(record.warnings),
        notRestorable: parseStringArray(record.not_restorable)
      };
    }
  } catch {
  }
  throw new DocxExtractError(
    "extract-failed",
    `引擎成功退出但 stdout 不是契约 JSON：${excerpt(stdout)}`
  );
}

function parseImages(value) {
  if (!Array.isArray(value)) return [];
  const images = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { src, file, source } = item;
    if (typeof src !== "string" || typeof file !== "string" || typeof source !== "string") continue;
    images.push({ src, file, source });
  }
  return images;
}

function parseFailureJson(stderr, code) {
  try {
    const parsed = JSON.parse(stderr.trim());
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const record = parsed;
      const error = typeof record.error === "string" ? record.error : "";
      const kind = classifyEngineError(error);
      return new DocxExtractError(kind, failureMessage(kind, error), parseStringArray(record.warnings));
    }
  } catch {
  }
  return new DocxExtractError(
    "extract-failed",
    `引擎以退出码 ${String(code)} 失败且 stderr 不是契约 JSON：${excerpt(stderr)}`
  );
}

async function extractDocxToHtml(req, run) {
  const outcome = await run({
    command: req.python,
    args: buildExtractArgs(req),
    cwd: req.engineDir,
    env: { PYTHONPATH: req.engineDir },
    timeoutMs: req.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS,
    maxOutputBytes: req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  });
  if (outcome.timedOut === true) {
    throw new DocxExtractError(
      "timeout",
      `docx 提取超时（>${String(req.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS)}ms）。大文档或含大量图片时可能偏慢，可重试一次；反复超时请如实告知用户。`
    );
  }
  if (outcome.outputTruncated === true) {
    throw new DocxExtractError(
      "output-too-large",
      `引擎输出超过上限（${String(req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)} 字节），不符合一行 JSON 的契约，按引擎行为异常处理。`
    );
  }
  if (outcome.code === null) {
    throw new DocxExtractError(
      "extract-failed",
      `venv Python 未能启动：${outcome.error ?? "未知原因"}（${req.python}）。环境可能在 ensure 之后被破坏，请重试（会先重新 ensure）。`
    );
  }
  if (outcome.code === 0) return parseSuccessJson(outcome.stdout);
  throw parseFailureJson(outcome.stderr, outcome.code);
}

const WARNINGS_MESSAGE_CAP = 20;

function describeWarnings(warnings) {
  if (warnings.length === 0) return "";
  const shown = warnings.slice(0, WARNINGS_MESSAGE_CAP);
  const more = warnings.length > shown.length ? `
（另有 ${warnings.length - shown.length} 条警告未列出）` : "";
  return `

引擎已发出的警告（如实转述给用户）：
- ${shown.join("\n- ")}${more}`;
}

function createDocxExtractTool(options) {
  return (pi) => {
    pi.registerTool({
      name: "docx_extract",
      label: "提取文档版式",
      description: "把一份 .docx 提取成 HTML 文件 + 图片目录，用于**分析或复用原文档的版式**（标题层级、段落缩进、字体字号、表格、列表、图片）。用途是「照这份 .docx 的版式写新内容」；只是想读文档里的文字请用 read_document（read_document 给文本，本工具给 HTML 文件）。输出是**语义化近似**，不是 1:1 还原：页码、页眉页脚、分节、浮动对象、域代码、图表无法复原，结果里的 not_restorable 字段列出该文档实际命中的不可复原项。Python 环境按需安装、不会自动下载：尚未安装时会返回原因与「到设置 → 内置运行时点安装」的引导。提取失败或环境不可用时会返回原因与处理建议。",
      promptSnippet: "docx_extract: 把一份 .docx 提取成 HTML + 图片（docxPath → outputPath），用来复用原文档版式；只读文字用 read_document",
      promptGuidelines: [
        "不要承诺 1:1 还原：页码/页眉页脚/分节/浮动对象/域代码/图表不可复原，结果里的 not_restorable 必须如实转述给用户。",
        "同一处失败不要反复重试：环境类按错误里的引导告知用户，输入类如实说明文件名与原因（重试无用）。"
      ],
      parameters: Type.Object({
        docxPath: Type.String({ description: "输入 .docx 文件的绝对路径。" }),
        outputPath: Type.String({
          description: "输出 HTML 的绝对路径（写工作区产物文件档位判定；图片默认落在同目录的 <名>_assets/ 下）。"
        }),
        assetsDir: Type.Optional(
          Type.String({ description: "图片目录的绝对路径；缺省为 <HTML 所在目录>/<HTML 名去扩展名>_assets。" })
        )
      }),
      async execute(_toolCallId, params) {
        const runtimeOptions = defaultPythonRuntimeOptions({
          engineDir: options.engineDir,
          homeDir: options.homeDir,
          platform: options.platform ?? process.platform
        });
        const ensure = options.ensure ?? ensurePythonRuntime;
        const env = await ensure(runtimeOptions, defaultSpawn);
        if (env.status !== "ready") {
          options.onAudit?.({
            category: "runtime",
            outcome: "failed",
            detail: clipAuditDetail(`docx 提取运行时未就绪（${env.phase}）：${env.error}`)
          });
          throw classifyEnsureError(env);
        }
        const extract = options.extract ?? extractDocxToHtml;
        try {
          const result = await extract(
            {
              python: env.python,
              engineDir: options.engineDir,
              docxPath: params.docxPath,
              outputPath: params.outputPath,
              ...params.assetsDir !== void 0 ? { assetsDir: params.assetsDir } : {}
            },
            defaultRun
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  type: "docx_extract_result",
                  html_path: result.htmlPath,
                  assets_dir: result.assetsDir,
                  images: result.images,
                  warnings: result.warnings,
                  not_restorable: result.notRestorable,
                  message: "提取完成：HTML 与图片都在上述路径下，图片引用是相对 HTML 文件的路径。not_restorable 里的不可复原项要如实转述给用户，不要承诺 1:1 还原。"
                })
              }
            ],
            details: {
              htmlPath: result.htmlPath,
              assetsDir: result.assetsDir,
              images: result.images,
              warnings: result.warnings,
              notRestorable: result.notRestorable
            }
          };
        } catch (err) {
          if (err instanceof DocxExtractError) {
            throw new Error(err.message + describeWarnings(err.warnings));
          }
          throw err;
        }
      }
    });
  };
}

export {
	DEFAULT_CONVERT_TIMEOUT_MS,
	DEFAULT_EXTRACT_TIMEOUT_MS,
	DEFAULT_MAX_OUTPUT_BYTES,
	DEFAULT_MAX_OUTPUT_BYTES$1,
	DocExtractError,
	DocxConvertError,
	DocxExtractError,
	FALLBACK_MESSAGE_CAP,
	INPUT_ERROR_PREFIXES,
	MAX_CHARS,
	SCANNED_TEXT_THRESHOLD,
	SUPPORTED_LIST,
	WARNINGS_MESSAGE_CAP,
	buildConvertArgs,
	buildExtractArgs,
	classifyEngineError,
	classifyEnsureError,
	classifyEnsureError$1,
	convertHtmlToDocx,
	createDocReadTool,
	createDocxConvertTool,
	createDocxExtractTool,
	defaultRun,
	describeWarnings,
	detectDocKind,
	ensurePdfWorker,
	excerpt,
	excerpt$1,
	extractDocument,
	extractDocxToHtml,
	extractOffice,
	extractPdf,
	failureMessage,
	getOfficeTempDir,
	getPdfAssetUrls,
	mapOfficeError,
	mapPdfOpenError,
	officeTemp,
	parseFailureJson,
	parseFailureJson$1,
	parseImages,
	parseStringArray,
	parseSuccessJson,
	parseSuccessJson$1,
	pdfAssetUrls,
	pdfWorkerReady,
	readPdfPages,
	runtimeInstallAbort,
};