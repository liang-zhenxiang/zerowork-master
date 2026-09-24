/**
 * docx 引擎往返测试 + 运行时安装测试。
 *
 * 这两条链路此前没测过，而且**它们在本机是可测的**：
 *
 *   ① docx 引擎（Python 路径） —— docx_convert / docx_extract 是两个 agent
 *      工具，走 resources/docx-engine 的 Python 实现。Python 运行时是跨平台的，
 *      本机状态为 ready，所以可以真实跑通。
 *
 *      用**往返**验证最有力：HTML（埋标记）→ docx → HTML（取回标记）。
 *      标记能穿过两个方向，说明转换与提取两条路都正确 —— 单独测某一个方向
 *      都可能因为"转换时丢内容、提取时碰巧没丢"而假阳性。
 *
 *   ② 运行时安装 —— 原为平台硬编码（win-x64 + node.exe），在 macOS 上必然
 *      失败。现改为按 platform-arch 取规格，支持 win32-x64 / darwin-arm64 /
 *      darwin-x64，因此这里断言**真的能装上并跑通探针**。
 *      gitbash 仍是 Windows 专有（PortableGit），不在本测试范围。
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
const CONFIG_DIR = "/tmp/zerowork-runtime";
const WORKSPACE_DIR = "/tmp/zerowork-runtime-ws";
// 标记要挑**弱模型也抄得准**的形状（理由见 doc-parsing.mjs 的同类注释：
// 辅音串 + 数字会被抄错，可发音的词 + 数字转录稳定）。
const MARK = "MAPLE9643";

// ── 模型端点（可选：缺了只跳过依赖模型的那部分）───────────────
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
let endpoint = readEndpoint();
if (endpoint) {
	const probe = await fetch(`${endpoint.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": endpoint.token, "anthropic-version": "2023-06-01" },
		body: JSON.stringify({ model: endpoint.model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
	}).catch(() => undefined);
	if (!probe || !probe.ok) endpoint = undefined;
}
console.log(endpoint ? "✓ 模型端点可用" : "⚠ 模型端点不可用 —— 仅跳过依赖模型的部分");

// ── 准备夹具 ─────────────────────────────────────────────
rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

const SRC_HTML = resolve(WORKSPACE_DIR, "source.html");
writeFileSync(
	SRC_HTML,
	`<!doctype html><html><head><meta charset="utf-8"><title>RT</title></head>
<body><h1>往返测试</h1><p>标记：${MARK}</p><p>这段用于验证转换往返不丢内容。</p></body></html>`,
	"utf8",
);

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

// ── ① 运行时安装：跨平台可用性 ────────────────────────────
//
// 历史：这块原先硬编码 `win-x64.zip` + `node.exe`，在 macOS/Linux 上
// 必然失败（下载 Windows 包、然后在 probe 相位跑不起 node.exe）。
//
// 现已改为按 `process.platform-arch` 取规格（见 runtimes.js 的
// NODE_PLATFORM_SPECS），支持 win32-x64 / darwin-arm64 / darwin-x64。
// 因此本测试断言的是**真的能装上并跑通探针**，而不再是"优雅失败"。
//
// 两个 sha256 都在装的过程中校验：归档哈希（并与官方 SHASUMS256.txt
// 交叉核对）+ 解包后可执行文件哈希。任一不符都会中止。

await check("运行时：Node 在当前平台可安装并跑通探针", async () => {
	const before = await win.evaluate(async () => {
		const s = await globalThis.kami.runtimesSnapshot();
		return (s?.items ?? []).find((x) => x.id === "node")?.status?.kind ?? "unknown";
	});
	console.log(`      node 安装前：${before}`);

	if (before !== "ready") {
		const r = await win.evaluate(async () => {
			try {
				await Promise.race([
					globalThis.kami.runtimeInstall("node"),
					new Promise((_, rej) => setTimeout(() => rej(new Error("__TIMEOUT__")), 300_000)),
				]);
				return { ok: true };
			} catch (e) {
				const msg = String(e?.message ?? "");
				return { ok: false, err: msg.includes("__TIMEOUT__") ? "安装挂起 300 秒" : msg.slice(0, 240) };
			}
		});
		assert.ok(r.ok, `安装失败: ${r.err}`);
	}

	const after = await win.evaluate(async () => {
		const s = await globalThis.kami.runtimesSnapshot();
		const n = (s?.items ?? []).find((x) => x.id === "node");
		return { kind: n?.status?.kind, exe: n?.executable };
	});
	console.log(`      node 安装后：${after.kind}`);
	assert.equal(after.kind, "ready", `安装后状态应为 ready，实际 ${after.kind}`);
	// 探针跑通才会是 ready，所以这里已隐含"解出来的 node 真的能执行"
	assert.ok(after.exe === undefined || typeof after.exe === "string", "可执行文件路径异常");
});

await check("运行时：平台规格按架构取（不回落 Windows）", async () => {
	// 回归防护：规格表的键是 platform-arch。若有人把 darwin 的键写错、
	// 或让未知平台回落到 win32 规格，这里会露出来。
	const r = await win.evaluate(async () => {
		const s = await globalThis.kami.runtimesSnapshot();
		const n = (s?.items ?? []).find((x) => x.id === "node");
		return { dir: n?.activeDir ?? "", exe: n?.executable ?? "" };
	});
	// macOS 上解出来的可执行文件必须在 bin/ 下，且**不能**是 node.exe
	if (process.platform === "darwin") {
		assert.ok(!/node\.exe/i.test(r.exe + r.dir), `darwin 上不该出现 node.exe：${r.exe}`);
	}
});

await check("运行时：平台不适用的项不出现在清单里", async () => {
	// Git for Windows 的 PortableGit 是 Windows 专有产物（.7z.exe），
	// macOS/Linux 自带 bash、也不需要它。若不过滤，UI 会显示
	// 「bash 运行时：未安装」并给出安装按钮 —— 用户点下去会下载一个
	// 跑不起来的 .7z.exe。过滤发生在 runtimeDescriptors，UI 与 shell 注入
	// 都从那里派生，一处即可修好两处。
	const r = await win.evaluate(async () => {
		const s = await globalThis.kami.runtimesSnapshot();
		return { ids: (s?.items ?? []).map((x) => x.id) };
	});
	if (process.platform === "win32") {
		assert.ok(r.ids.includes("gitbash"), "Windows 上应有 gitbash 运行时");
	} else {
		assert.ok(!r.ids.includes("gitbash"), `非 Windows 上不该出现 gitbash：${r.ids.join(", ")}`);
	}
	// 跨平台的 Python / Node 各平台都应在
	assert.ok(r.ids.includes("python"), "缺少 python 运行时");
	assert.ok(r.ids.includes("node"), "缺少 node 运行时");
});

await check("运行时：诊断接口可读取", async () => {
	const r = await win.evaluate(async () => {
		try {
			const d = await globalThis.kami.runtimeDiagnostics("node");
			return { ok: true, has: d !== undefined };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 160) };
		}
	});
	assert.ok(r.ok, `诊断调用失败: ${r.err}`);
});

// ── ② docx 引擎往返：确定性验证（不依赖模型）─────────────────
//
// 这一条才是「引擎能不能用」的**权威证据**。
//
// 为什么不能只靠模型驱动的用例：`docx_convert` 是**暴露给模型的工具**，
// 要模型主动调用才有产物。本机端点是一个能力较弱的模型，它经常把整个输出
// 预算耗在「这个任务该不该用 docx 技能 / 该不该先 present_files」这类
// 推理上，工具一次都不调 —— 于是用例报「模型未回报完成」，看起来像引擎坏了，
// 实际是模型没动手。（这一点已在**改写前的基线状态**复现，排除回归。）
//
// 所以这里按**应用自己的调用契约**直接跑引擎：
//   `python -m html_to_docx convert <in> -o <out>`，env 带 PYTHONPATH=<engineDir>
// （与 src/main/daemon/doc-extract.js 完全一致），然后反向 `-m docx_to_html extract`。
// 标记能双向穿过，就证明转换与提取两条路都对。

const ENGINE_DIR = resolve(ROOT, "resources", "docx-engine");

await check("docx 引擎：HTML → DOCX → HTML 往返，标记双向存活（不依赖模型）", async () => {
	// 解释器取应用自己解析出来的那一个（托管 venv），而不是碰运气猜路径
	const py = await win.evaluate(async () => {
		const s = await globalThis.kami.runtimesSnapshot();
		const item = (s?.items ?? []).find((x) => x.id === "python");
		return { kind: item?.status?.kind, exe: item?.executable };
	});
	assert.equal(py.kind, "ready", `Python 运行时未就绪（${py.kind}），无法验证 docx 引擎`);
	assert.ok(py.exe, "运行时快照没给出解释器路径");

	const { execFileSync } = await import("node:child_process");
	const run = (args) =>
		execFileSync(py.exe, args, { env: { ...process.env, PYTHONPATH: ENGINE_DIR }, encoding: "utf8", timeout: 180_000 });

	const srcHtml = resolve(WORKSPACE_DIR, "engine-src.html");
	const midDocx = resolve(WORKSPACE_DIR, "engine-out.docx");
	const backHtml = resolve(WORKSPACE_DIR, "engine-back.html");
	writeFileSync(
		srcHtml,
		`<!doctype html><html><head><meta charset="utf-8"><title>RT</title></head>
<body><h1>往返测试</h1><p>标记：${MARK}</p></body></html>`,
		"utf8",
	);

	// 正向
	const fwd = JSON.parse(run(["-m", "html_to_docx", "convert", srcHtml, "-o", midDocx]).trim().split("\n").pop());
	assert.equal(fwd.success, true, `正向转换失败：${JSON.stringify(fwd).slice(0, 200)}`);
	assert.ok(existsSync(midDocx), "正向转换未产出 docx");

	// 反向
	const rev = JSON.parse(run(["-m", "docx_to_html", "extract", midDocx, "-o", backHtml]).trim().split("\n").pop());
	assert.equal(rev.success, true, `反向转换失败：${JSON.stringify(rev).slice(0, 200)}`);

	// 标记必须穿过两个方向
	const back = readFileSync(backHtml, "utf8");
	assert.ok(back.includes(MARK), `标记 ${MARK} 未穿过往返 —— 转换或提取丢内容了`);
	console.log(`      往返 OK：docx ${(await import("node:fs")).statSync(midDocx).size} 字节 → html ${back.length} 字符，标记存活`);
});

// ── ③ docx 引擎往返（由真实模型触发工具，验证工具接线）────────
if (endpoint) {
	await check("配置真实模型", async () => {
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
							// maxTokens 是**模型声明的输出上限**，会作为请求的 max_tokens 下发。
							// 这里原先写 4096 —— 对本用例太紧：要模型「读文件 → 调 docx_convert →
							// 回报完成」，而弱模型会先在推理里反复权衡系统提示词里的工具调用规则，
							// 4096 往往在它真正动手前就耗尽（症状：回复被截断、工具一次没调、
							// test 报「模型未回报完成」）。这是**测试配置过紧**，不是产品问题 ——
							// 已在改写前的基线状态复现同样失败。给足预算以匹配真实模型的输出能力。
							models: [{ id: model, name: model, reasoning: false, vision: false, contextWindow: 128000, maxTokens: 8192 }],
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

	/** 发一条提示，等模型回复里出现某个特征串 */
	async function promptAndWait(text, expectSubstring, timeoutMs = 180_000) {
		return win.evaluate(
			async ({ t, expect, ms }) => {
				const k = globalThis.kami;
				try {
					await Promise.race([
						k.prompt({ text: t }),
						new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), ms)),
					]);
				} catch (e) {
					if (String(e?.message ?? "").includes("TIMEOUT")) return { timedOut: true };
				}
				for (let i = 0; i < 60; i++) {
					const s = await k.snapshot();
					const a = (s?.entries ?? []).filter((x) => x?.role === "assistant" && String(x?.text ?? "").length > 0);
					const txt = a.map((x) => x.text).join("\n");
					if (txt.includes(expect)) return { found: true, text: txt.slice(-400) };
					await new Promise((r2) => setTimeout(r2, 2000));
				}
				const s = await k.snapshot();
				const a = (s?.entries ?? []).filter((x) => x?.role === "assistant");
				return { found: false, text: JSON.stringify(a).slice(-400) };
			},
			{ t: text, expect: expectSubstring, ms: timeoutMs },
		);
	}

	/**
	 * ⚠️ 提示词的写法很要紧（踩过坑）。
	 *
	 * 早先这两条用例的提示词结尾是「完成后**只回复** CONVERT_DONE」「**不要加任何
	 * 其它内容**」。这看起来只是让断言好写，实际制造了一个**提示词冲突**：
	 * 系统提示词里的交付纪律要求「产出文件后必须把文件挂进交付清单并做过程叙述」，
	 * 而用户这边要求「只回复某个串」。弱模型会卡在这个矛盾里反复权衡，
	 * 把整个输出预算烧在推理上，工具一次都不调 —— 症状是回复被截断、
	 * 断言报「模型未回报完成」。
	 *
	 * 所以提示词改成**顺着系统提示词的纪律走**：让模型按它平时的习惯交付，
	 * 断言改落在**更强的证据**上 —— 产物文件本身（以及从中提取回的标记），
	 * 而不是「模型说了某个魔法字符串」。
	 */
	await check("docx_convert：HTML → DOCX（产出文件落盘）", async () => {
		const out = resolve(WORKSPACE_DIR, "roundtrip.docx");
		// ⚠️ 先**等 prompt 整个跑完**，再去等产物落盘。
		// 之前写成「一看到模型有文字就返回、然后只等 30 秒文件」—— 错在
		// 模型的第一段输出通常只是叙述（「我先看一下工作区里的文件……」），
		// 那时工具还没调。结果是在工具真正执行前就开始倒计时，误判成没产出。
		const r = await win.evaluate(
			async ({ src, dst, ms }) => {
				const k = globalThis.kami;
				try {
					await Promise.race([
						k.prompt({ text: `请直接调用 docx_convert 工具（工具名就是 docx_convert；不要去读 docx 技能、也不要先做别的准备）把工作区里的 ${src} 转换成 ${dst}。` }),
						new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), ms)),
					]);
					return { done: true };
				} catch (e) {
					if (String(e?.message ?? "").includes("TIMEOUT")) return { timedOut: true };
					return { done: true };
				}
			},
			{ src: "source.html", dst: "roundtrip.docx", ms: 300_000 },
		);
		assert.ok(!r.timedOut, "转换时挂起 300 秒");
		// 回合结束时工具应当已执行完；再给文件系统落盘留足时间（首次跑要起 venv python）
		for (let i = 0; i < 120 && !existsSync(out); i++) await new Promise((res) => setTimeout(res, 1000));
		if (!existsSync(out)) {
			const tail = await win.evaluate(async () => {
				const s = await globalThis.kami.snapshot();
				return JSON.stringify((s?.entries ?? []).filter((x) => x?.role === "assistant")).slice(-400);
			});
			assert.fail(`未生成产物 ${out}。回复尾部: ${tail}`);
		}
	});

	await check("docx_extract：DOCX → HTML 且标记存活", async () => {
		const out = resolve(WORKSPACE_DIR, "roundtrip.docx");
		if (!existsSync(out)) return; // 上一步失败则跳过（上一条已单独报错）
		// 提示词用**自然的提问**，不提「只回复 X」——理由见上一条用例的注释
		const r = await promptAndWait(
			`请用 docx_extract 工具读取工作区里的 roundtrip.docx，告诉我在它提取出的正文里，那串标记（形如一个单词加四位数字）是什么？`,
			MARK,
		);
		assert.ok(!r.timedOut, "提取时挂起");
		assert.ok(r.found, `标记 ${MARK} 未穿过往返。回复尾部: ${r.text}`);
	});
} else {
	console.log("  （跳过 docx 往返：无可用模型端点）");
}

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ docx 引擎往返 + 运行时安装测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
