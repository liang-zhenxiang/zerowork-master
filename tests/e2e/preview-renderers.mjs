/**
 * 文件预览渲染器端到端测试：工作区里的 `.xlsx` / `.pptx` / `.js` / `.json`
 * → 在「工作空间文件」里点开 → **真的渲染出内容、且各自的样式表已生效**。
 *
 * 补的是一处零覆盖：产物面板里「工作空间文件」这一视图、以及**全部懒加载预览渲染器**
 * （`office-xlsx` / `office-pptx` / `code-preview` / `json-mode`）此前**没有任何测试碰过**。
 * 这几个都是懒加载的重包（office-xlsx 10 万行、office-pptx 7 万行、code-preview 5.6MB），
 * 「打开就白屏 / 打开就报错」正是这类懒加载最典型的故障形态 —— 而且不会有人告诉你：
 * 冒烟测试与 IPC 断言全都照过，只有真去点开那个文件才看得见。
 *
 * 用**真实文件**（不是桩）：xlsx 用仓库里的 `xlsx`（SheetJS）现造，
 * pptx 用 `jszip` 按 OOXML 拼最小部件。渲染链路只有在真文件上才走得通。
 *
 * 断言分三层，缺一层就抓不到对应的故障：
 *   ① 容器与渲染产物（`.preview-office`、canvas、工作表标签/幻灯片文本）；
 *   ② **解析证据**：工作表标签名「探针表」、幻灯片里的标记文本 —— 这些来自文件本身，
 *      只有真解析了工作簿/演示文稿才会出现（表格是 canvas 画的，单元格文本不在 DOM 里，
 *      所以不能拿单元格内容当判据）；
 *   ③ **样式表生效**：断言工作表标签的 padding-left 等于 office-xlsx.css 里的值。
 *      这一条是回归守卫 —— 该 chunk 自己的样式表曾经压根不进产物（见下），
 *      容器和 canvas 都照样在，只有这条会红。
 *
 * 顺带记录一处**真实缺陷**（本测试逼出来的，已在 EXTERNAL_REQUESTS.md 登记）：
 * 懒加载块的样式表在构建产物里不存在时，预加载助手会 reject 懒加载 promise，
 * 未拦截的 `vite:preloadError` 直接把整个渲染层打进错误边界 ——
 * 表现为「点开 xlsx / 代码预览就界面渲染出错」，而不是「样式缺失」。
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-office";
const WORKSPACE_DIR = "/tmp/zerowork-office-ws";

const XLSX_NAME = "预算探针.xlsx";
const XLSX_MARK = "ZEROWORK_XLSX_7788";
// 工作表名会渲染在底部标签上（表格是 canvas 画的，单元格文本不在 DOM 里）——
// 「只有真解析了工作簿才会出现」的那个锚点就是它。
const XLSX_SHEET = "探针表";
const PPTX_NAME = "演示探针.pptx";
const PPTX_MARK = "ZEROWORK_PPTX_5566";
// 代码 / 配置预览走的是**同一类懒加载块**（monaco 的 code-preview，以及它按需加载的
// json-mode），两者各自带着自己的样式表 —— 也正是同一个缺陷的受害者，所以一并覆盖。
const JS_NAME = "预览探针.js";
const JS_MARK = "ZEROWORK_JS_3344";
const JSON_NAME = "预览探针.json";
const JSON_MARK = "ZEROWORK_JSON_2211";

const require_ = createRequire(import.meta.url);

// ── 夹具：真实 xlsx（SheetJS 现造）────────────────────────
function writeXlsx(target) {
	const XLSX = require_("xlsx");
	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.aoa_to_sheet([
		["项目", "金额"],
		["标记行", XLSX_MARK],
		["合计", 42],
	]);
	XLSX.utils.book_append_sheet(wb, ws, XLSX_SHEET);
	XLSX.writeFile(wb, target);
}

// ── 夹具：最小合法 pptx（OOXML 部件用 jszip 拼）──────────
// 不引第三方生成器（仓库里没有 pptxgenjs）：一张幻灯片 + 必需的母版/版式/主题，
// 是 OOXML 规定的最小可解析集合。
async function writePptx(target) {
	const JSZip = require_("jszip");
	const zip = new JSZip();

	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`,
	);

	zip.file(
		"_rels/.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
	);

	zip.file(
		"ppt/presentation.xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr><a:lvl1pPr algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle>
</p:presentation>`,
	);

	zip.file(
		"ppt/_rels/presentation.xml.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`,
	);

	zip.file(
		"ppt/slides/slide1.xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="838200"/><a:ext cx="7315200" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>${PPTX_MARK}</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`,
	);

	zip.file(
		"ppt/slides/_rels/slide1.xml.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
	);

	zip.file(
		"ppt/slideLayouts/slideLayout1.xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
<p:cSld name="空白"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
	);

	zip.file(
		"ppt/slideLayouts/_rels/slideLayout1.xml.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
	);

	zip.file(
		"ppt/slideMasters/slideMaster1.xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`,
	);

	zip.file(
		"ppt/slideMasters/_rels/slideMaster1.xml.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
	);

	// 主题部件内容不重要，但必须存在（部件的 rels 指向它）。
	zip.file(
		"ppt/theme/theme1.xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="探针主题">
<a:themeElements>
<a:clrScheme name="探针"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="探针"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="探针"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`,
	);

	const buf = await zip.generateAsync({ type: "nodebuffer" });
	const { writeFileSync } = require_("node:fs");
	writeFileSync(target, buf);
}

// ── mock 模型（只要让会话建起来，内容不重要）────────────
function startMockModel() {
	const server = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-office",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { role: "assistant", content: "OFFICE_PREVIEW_READY" } }],
				})}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-office",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				})}\n\n`,
			);
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
	return new Promise((ok) => {
		server.listen(0, "127.0.0.1", () =>
			ok({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => server.close(r)) }),
		);
	});
}

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });
writeXlsx(join(WORKSPACE_DIR, XLSX_NAME));
await writePptx(join(WORKSPACE_DIR, PPTX_NAME));
writeFileSync(join(WORKSPACE_DIR, JS_NAME), `// ${JS_MARK}\nexport const previewProbe = () => 42;\n`, "utf8");
writeFileSync(join(WORKSPACE_DIR, JSON_NAME), `{\n  "mark": "${JSON_MARK}",\n  "n": 1\n}\n`, "utf8");
console.log(`✓ 夹具已生成：${XLSX_NAME} / ${PPTX_NAME} / ${JS_NAME} / ${JSON_NAME}`);

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 260)]);
	}
};

const mock = await startMockModel();

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

/** 点开「工作空间文件」视图，等文件树出现。 */
async function openWorkspaceTree() {
	await win.evaluate(() => {
		const btn = document.querySelector('[aria-label="展开产物面板"]');
		btn?.click();
	});
	await win.waitForTimeout(1500);
	// ViewSwitcher：按钮文本是当前视图名（默认「概览」）；点开菜单选「工作空间文件」
	const ok = await win.evaluate(() => {
		const btn = [...document.querySelectorAll(".view-switcher button")][0];
		if (btn === undefined) return false;
		btn.click();
		return true;
	});
	assert.ok(ok, "找不到视图切换按钮（.view-switcher）—— 产物面板没打开？");
	await win.waitForTimeout(500);
	const picked = await win.evaluate(() => {
		const item = [...document.querySelectorAll(".view-switcher-menu .preview-item")].find((n) =>
			(n.textContent || "").includes("工作空间文件"),
		);
		if (item === undefined) return false;
		item.click();
		return true;
	});
	assert.ok(picked, "视图菜单里没有「工作空间文件」项");
}

/** 点开某个文件行，返回它的标题（便于诊断）。 */
async function clickFileRow(name) {
	for (let i = 0; i < 30; i++) {
		const clicked = await win.evaluate((label) => {
			const rows = [...document.querySelectorAll(".file-tree-row.file-tree-file")];
			if (rows.length === 0) return "no-rows";
			const row = rows.find((r) => (r.textContent || "").includes(label) || (r.getAttribute("title") || "").includes(label));
			if (row === undefined) return `not-found:${rows.map((r) => r.textContent.trim()).join("|")}`;
			row.click();
			return "ok";
		}, name);
		if (clicked === "ok") return;
		if (String(clicked).startsWith("not-found:")) {
			// 文件树可能还在扫描，继续等
			if (i >= 28) throw new Error(`文件树里找不到「${name}」。现有条目：${clicked.slice(11)}`);
		}
		await win.waitForTimeout(1000);
	}
	throw new Error(`等了 30 秒文件树也没出现（.file-tree-row.file-tree-file 为空）`);
}

/** 关掉当前预览标签、回到文件列表（面板在预览态下不显示文件树）。 */
async function closePreviewTab() {
	const closed = await win.evaluate(() => {
		const btn = document.querySelector(".preview-tab-close");
		if (btn === null) return false;
		btn.click();
		return true;
	});
	assert.ok(closed, "找不到预览标签的关闭按钮，无法回到文件列表");
	await win.waitForTimeout(2000);
}

await check("建会话并打开产物面板 → 工作空间文件", async () => {
	const r = await win.evaluate(async ({ baseUrl, ws }) => {
		const k = globalThis.kami;
		try {
			await k.saveCustomProvider(
				{
					id: "mock-office",
					name: "Mock Office",
					baseUrl,
					api: "openai-completions",
					authHeader: true,
					models: [{ id: "office-model", name: "office-model", reasoning: false, vision: false, contextWindow: 128000, maxTokens: 4096 }],
				},
				"mock-key",
			);
			await k.setModel("mock-office/office-model");
			await k.setWorkspace(ws);
			return { ok: true };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
		}
	}, { baseUrl: mock.baseUrl, ws: WORKSPACE_DIR });
	assert.ok(r.ok, `配置失败：${r.err}`);

	const box = win.locator('[aria-label="消息输入框"]');
	await box.waitFor({ state: "visible", timeout: 30_000 });
	await box.fill("看一眼工作区里的表格");
	await box.press("Enter");
	await win.waitForTimeout(4000);

	await openWorkspaceTree();
});

await check("XLSX：预览容器出现且**真的解析了工作簿**", async () => {
	await clickFileRow(XLSX_NAME);
	const r = await win.evaluate(
		async (sheetName) => {
			for (let i = 0; i < 40; i++) {
				const office = document.querySelector(".preview-office");
				if (office !== null) {
					// 表格是 **canvas** 绘制的，单元格文本不在 innerText 里 ——
					// 所以断言不能看单元格内容，要看**只有真解析了工作簿才会出现**的
					// 东西：底部的工作表标签（名字来自文件本身）。
					const tab = office.querySelector(".luckysheet-sheets-item-name");
					// 等标签上的名字变成**夹具里那个表名** —— 它在文件里，不在代码里，
					// 出现了就说明工作簿真被解析了。
					if (tab !== null && (tab.textContent || "").trim() === sheetName) {
						const cs = getComputedStyle(tab);
						return {
							found: true,
							canvas: office.querySelectorAll("canvas").length,
							tabName: (tab.textContent || "").trim(),
							// 这条样式只写在 office-xlsx.css 里（app.css 里 0 处）：
							// 拿它证明**该 chunk 自己的样式表真的加载了** ——
							// 曾经它压根不进产物，CSS 预加载失败还会把界面打进错误边界。
							tabPaddingLeft: cs.paddingLeft,
							tabWidth: Math.round(tab.getBoundingClientRect().width),
						};
					}
					if (i >= 38) {
						return {
							found: true,
							canvas: office.querySelectorAll("canvas").length,
							tabName: undefined,
							text: (office.innerText || "").slice(0, 200),
							note: `容器在但没等到工作表标签；面板头：${(office.querySelector(".preview-office-name")?.textContent ?? "?").trim()}`,
						};
					}
				}
				await new Promise((res) => setTimeout(res, 1000));
			}
			return { found: false, sample: (document.body.innerText || "").slice(-300) };
		},
		XLSX_SHEET,
	);
	assert.ok(r.found, `没有出现 .preview-office —— xlsx 预览没打开。界面尾部：${r.sample}`);
	assert.equal(r.tabName, XLSX_SHEET, `工作表标签不对（夹具里的表名就叫「${XLSX_SHEET}」）：${JSON.stringify(r.tabName)}。${r.note ?? ""}`);
	assert.ok(r.canvas > 0, `没有 canvas —— 表格网格没画出来。${r.text ?? ""}`);
	// 这条是**回归守卫**：样式表没进产物时这里会是 "0px"
	assert.equal(
		r.tabPaddingLeft,
		"3px",
		`工作表标签的 padding-left 是 ${r.tabPaddingLeft}，不是 office-xlsx.css 里的 3px —— 该 chunk 的样式表没加载`,
	);
	assert.ok(r.tabWidth > 0, "工作表标签宽度为 0 —— 有样式表但布局没生效");
	console.log(`      xlsx 预览：${r.canvas} 个 canvas，工作表标签「${r.tabName}」（宽 ${r.tabWidth}px，样式表已生效）`);
});

await check("PPTX：预览容器出现且渲染出幻灯片文本", async () => {
	// 先关掉 xlsx 的预览标签回到文件列表 —— 面板在预览态下不显示文件树。
	await closePreviewTab();
	await clickFileRow(PPTX_NAME);
	const r = await win.evaluate(
		async (mark) => {
			for (let i = 0; i < 40; i++) {
				const office = document.querySelector(".preview-office");
				if (office !== null && (office.innerText || "").includes(mark)) {
					return { found: true, hasMark: true, textLen: (office.innerText || "").length };
				}
				await new Promise((res) => setTimeout(res, 1000));
			}
			const office = document.querySelector(".preview-office");
			return {
				found: office !== null,
				hasMark: false,
				text: office === null ? "(无容器)" : (office.innerText || "").slice(0, 200),
				html: office === null ? "" : office.innerHTML.slice(0, 300),
			};
		},
		PPTX_MARK,
	);
	assert.ok(r.found, `没有出现 .preview-office —— pptx 预览没打开`);
	assert.ok(
		r.hasMark,
		`幻灯片里没有夹具文本 ${PPTX_MARK}（容器在、内容空 = 白屏）。文本：${JSON.stringify(r.text)}，HTML：${r.html}`,
	);
	console.log(`      pptx 预览渲染出 ${r.textLen} 字符，含夹具文本 ${PPTX_MARK}`);
});

await check("CODE (.js)：monaco 渲染出源码，且 code-preview.css 生效", async () => {
	await closePreviewTab();
	await clickFileRow(JS_NAME);
	const r = await win.evaluate(
		async (mark) => {
			for (let i = 0; i < 40; i++) {
				const ed = document.querySelector(".monaco-editor");
				if (ed !== null) {
					const lines = [...document.querySelectorAll(".view-line")].map((n) => n.textContent || "").join("\n");
					return {
						found: true,
						hasMark: lines.includes(mark),
						lines: lines.slice(0, 200),
						// 这条 position 只写在 code-preview.css 里（app.css 里 monaco-editor 出现 0 次）
						position: getComputedStyle(ed).position,
					};
				}
				await new Promise((res) => setTimeout(res, 1000));
			}
			return { found: false, sample: (document.body.innerText || "").slice(-200) };
		},
		JS_MARK,
	);
	assert.ok(r.found, `没出现 .monaco-editor —— 代码预览没渲染。界面尾部：${r.sample}`);
	assert.ok(r.hasMark, `编辑器里没有夹具代码里的 ${JS_MARK}。首行：${JSON.stringify(r.lines)}`);
	assert.equal(
		r.position,
		"relative",
		`.monaco-editor 的 position 是 ${r.position}，不是 code-preview.css 里的 relative —— 该 chunk 的样式表没加载`,
	);
	console.log(`      .js 预览：monaco 渲染出源码，样式表已生效`);
});

await check("CONFIG (.json)：json-mode 按需加载，且 json-mode.css 进了文档", async () => {
	await closePreviewTab();
	await clickFileRow(JSON_NAME);
	const r = await win.evaluate(
		async (mark) => {
			for (let i = 0; i < 40; i++) {
				const lines = [...document.querySelectorAll(".view-line")].map((n) => n.textContent || "").join("\n");
				if (lines.includes(mark)) {
					// 加载失败的样式表**不会**出现在 document.styleSheets 里，
					// 所以「在不在这个列表里」就是「加载成没成功」的判据。
					const hrefs = [...document.styleSheets].map((s) => (s.href || "").split("/").pop());
					return { found: true, hrefs, hasJsonCss: hrefs.includes("json-mode.css") };
				}
				await new Promise((res) => setTimeout(res, 1000));
			}
			return { found: false, sample: (document.body.innerText || "").slice(-200) };
		},
		JSON_MARK,
	);
	assert.ok(r.found, `编辑器里没出现 ${JSON_MARK} —— json 预览没渲染。界面尾部：${r.sample}`);
	assert.ok(
		r.hasJsonCss,
		`文档里没有 json-mode.css（按需加载的样式表没进来）。当前样式表：${JSON.stringify(r.hrefs)}`,
	);
	console.log(`      .json 预览：json-mode.css 已随按需加载进入文档`);
});

await check("构建产物里三份 chunk 样式表都在（这是上游前提）", () => {
	// 界面侧断言只能证明「样式表加载成功了」，证明不了「它被构建出来了」。
	// 这一条守住构建侧：产物里必须有这三份 —— 它们正是曾经完全缺失的那三份。
	const assetsDir = resolve(ROOT, "out", "renderer", "assets");
	for (const name of ["office-xlsx.css", "code-preview.css", "json-mode.css"]) {
		const p = join(assetsDir, name);
		assert.ok(existsSync(p), `产物里没有 ${name} —— 懒加载块的样式表没被构建出来`);
		assert.ok(statSync(p).size > 1000, `${name} 只有 ${statSync(p).size} 字节，可疑`);
	}
	// 反向：入口 CSS 也在（不能为了这三份把入口弄丢）
	assert.ok(existsSync(join(assetsDir, "app.css")), "产物里没有 app.css（入口样式表）");
	console.log(`      产物样式表：app.css + office-xlsx.css / code-preview.css / json-mode.css`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 文件预览渲染器测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);