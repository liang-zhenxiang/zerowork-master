/**
 * 文档解析工具链端到端测试：真实模型 → read_document 工具 → 提取正文。
 *
 * 补的是此前唯一没验证的功能链路。`read_document` 不是 IPC 通道，
 * 而是**暴露给模型的工具** —— 没有模型就没人调用它，所以一直测不了。
 * 现在用真实模型触发工具调用即可覆盖。
 *
 * 覆盖：
 *   PDF 提取（pdfjs 路径）
 *   DOCX 提取（officeparser / docx-engine 路径）
 *   提取结果真的回传给模型（第二轮请求里带得出标记）
 *
 * 标记法：文档正文里埋唯一标记，模型按提示原样回报。
 * 只有"提取成功 + 回传成功"两个条件同时满足，标记才会出现在回复里。
 *
 * ⚠️ 凭据运行时从 ~/.claude/settings.json 读取，不进仓库、不打印。
 *    端点不可用时整轮跳过。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-docparse";
const WORKSPACE_DIR = "/tmp/zerowork-docparse-ws";

// ⚠️ 标记要挑**弱模型也抄得准**的形状。
// 原先用的是 `ZWPDF42` / `ZWDOCX42` —— 一串辅音字母 + 数字。实测弱模型会把
// `ZWDOCX42` 抄成 `ZWDOC42`（掉一个字母），用例就报「模型未回报标记」，
// 看起来像提取链路坏了，其实链路是通的、只是转录出错。
// 改成「可发音的词 + 数字」后转录稳定，而断言强度不变（仍是逐字精确匹配）。
const PDF_MARK = "PLUTO7421";
const DOCX_MARK = "LOTUS8532";

// ── 读取本机模型端点（凭据不落盘、不打印）────────────────────
const SETTINGS = resolve(homedir(), ".claude", "settings.json");
function readEndpoint() {
	if (!existsSync(SETTINGS)) return undefined;
	try {
		const env = JSON.parse(readFileSync(SETTINGS, "utf8"))?.env ?? {};
		const baseUrl = env.ANTHROPIC_BASE_URL;
		const token = env.ANTHROPIC_AUTH_TOKEN;
		const model = String(env.ANTHROPIC_MODEL ?? "").replace(/\[[^\]]*\]$/, "");
		return baseUrl && token && model ? { baseUrl, token, model } : undefined;
	} catch {
		return undefined;
	}
}
const endpoint = readEndpoint();
if (endpoint === undefined) {
	console.log("⚠ 未找到可用的模型端点配置，跳过文档解析测试。");
	process.exit(0);
}
const probe = await fetch(`${endpoint.baseUrl}/v1/messages`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-api-key": endpoint.token, "anthropic-version": "2023-06-01" },
	body: JSON.stringify({ model: endpoint.model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
}).catch(() => undefined);
if (!probe || !probe.ok) {
	console.log(`⚠ 模型端点不可用（HTTP ${probe?.status ?? "无响应"}），跳过。`);
	process.exit(0);
}

// ── 准备测试文档（自带生成，不依赖外部预置）─────────────────
rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

/** 生成最小可用 PDF。PDF 是文本格式，可直接手写对象结构。 */
function writeMinimalPdf(path, marker) {
	const text = `BT /F1 18 Tf 72 700 Td (ZeroWork PDF Test Marker ${marker}) Tj ET`;
	const stream = `${text}\n`;
	const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;
	writeFileSync(path, pdf, "utf8");
}

/** 生成最小可用 DOCX（zip + OOXML）。 */
function writeMinimalDocx(path, marker) {
	// 用 jszip（项目依赖）在 Node 侧打包，避免重复造 zip
	return import("jszip").then(({ default: JSZip }) => {
		const zip = new JSZip();
		zip.file(
			"[Content_Types].xml",
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		);
		zip.file(
			"_rels/.rels",
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		);
		zip.file(
			"word/document.xml",
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>ZeroWork DOCX Test Marker ${marker}</w:t></w:r></w:p></w:body>
</w:document>`,
		);
		return zip.generateAsync({ type: "nodebuffer" }).then((buf) => writeFileSync(path, buf));
	});
}

writeMinimalPdf(resolve(WORKSPACE_DIR, "probe.pdf"), PDF_MARK);
await writeMinimalDocx(resolve(WORKSPACE_DIR, "probe.docx"), DOCX_MARK);
console.log(`✓ 模型端点可用，测试文档已自动生成`);

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 240)]);
	}
};

const app = await electron.launch({
	args: [ROOT],
	env: {
		...process.env,
		ZEROWORK_CONFIG_DIR: CONFIG_DIR,
		ZEROWORK_RESOURCES_DIR: resolve(ROOT, "resources"),
		ZEROWORK_WORKSPACE_DIR: WORKSPACE_DIR,
	},
	timeout: 120_000,
});

const pageErrors = [];
const win = await app.firstWindow({ timeout: 120_000 });
win.on("pageerror", (e) => pageErrors.push(String(e)));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(9000);

await check("配置真实模型并切换工作区", async () => {
	const r = await win.evaluate(
		async ({ baseUrl, token, model, ws }) => {
			const k = globalThis.kami;
			try {
				await k.saveCustomProvider(
					{
						id: "local-proxy",
						name: "Local Proxy",
						baseUrl,
						api: "anthropic-messages",
						authHeader: true,
						models: [{ id: model, name: model, reasoning: false, vision: false, contextWindow: 128000, maxTokens: 4096 }],
					},
					token,
				);
				await k.setModel(`local-proxy/${model}`);
				await k.setWorkspace(ws);
				return { ok: true };
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
			}
		},
		{ ...endpoint, ws: WORKSPACE_DIR },
	);
	assert.ok(r.ok, `配置失败: ${r.err}`);
});

/** 让模型读文档并回报标记 */
async function readDocAndReport(filename, mark) {
	return win.evaluate(
		async ({ file, marker }) => {
			const k = globalThis.kami;
			try {
				await Promise.race([
					k.prompt({
						// 提示词用**自然的提问**，不写「只回复 X、不要加其它内容」——
						// 那会与系统提示词的交付纪律（产出后要做过程叙述）冲突，弱模型会卡在
						// 矛盾里反复权衡、把输出预算烧光。这个坑在 docx-runtime 里踩过。
						text: `请用 read_document 工具读取工作区里的 ${file}，然后告诉我文档正文里那串标记（形如一个单词加四位数字）具体是什么。`,
					}),
					new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT_150S")), 150_000)),
				]);
			} catch (e) {
				if (String(e?.message ?? "").includes("TIMEOUT_150S")) return { timedOut: true };
			}
			for (let i = 0; i < 45; i++) {
				const s = await k.snapshot();
				const assistant = (s?.entries ?? []).filter((x) => x?.role === "assistant" && String(x?.text ?? "").length > 0);
				const text = assistant.map((x) => x.text).join("\n");
				if (text.includes(marker)) return { found: true, text: text.slice(-300) };
				await new Promise((res) => setTimeout(res, 2000));
			}
			const s = await k.snapshot();
			const assistant = (s?.entries ?? []).filter((x) => x?.role === "assistant");
			return { found: false, text: JSON.stringify(assistant).slice(-300) };
		},
		{ file: filename, marker: mark },
	);
}

await check("PDF 提取：模型读出文档标记", async () => {
	const r = await readDocAndReport("probe.pdf", PDF_MARK);
	assert.ok(!r.timedOut, "读取 PDF 时挂起");
	assert.ok(r.found, `模型未能回报 PDF 标记 ${PDF_MARK}。回复尾部: ${r.text}`);
});

await check("DOCX 提取：模型读出文档标记", async () => {
	const r = await readDocAndReport("probe.docx", DOCX_MARK);
	assert.ok(!r.timedOut, "读取 DOCX 时挂起");
	assert.ok(r.found, `模型未能回报 DOCX 标记 ${DOCX_MARK}。回复尾部: ${r.text}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 文档解析工具链测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
