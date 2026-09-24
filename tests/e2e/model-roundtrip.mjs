/**
 * 主链路端到端测试：输入 → 模型请求 → 流式回复 → 会话状态。
 *
 * 这是本项目最重要的一条测试。此前所有测试都只在验证「应用自身的零件」，
 * 唯独没验证过「发一条消息，模型真的回话了」—— 因为常规做法需要 API Key。
 *
 * 做法：应用支持自定义 provider（baseUrl 可配），于是在本地起一个
 * OpenAI 兼容的 mock 服务，把整条链路串起来：
 *
 *   渲染层 window.kami.prompt()
 *     → preload IPC
 *     → daemon session-factories
 *     → pi agent harness
 *     → HTTP POST /v1/chat/completions
 *     → mock 服务 SSE 流式响应
 *     → 解析回会话状态
 *
 * 断言的是链路真的通了（mock 收到请求、回复落到会话），不是模型能力。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startMockModelServer } from "./mock-model-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-model";
const WORKSPACE_DIR = "/tmp/zerowork-model-ws";

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 200)]);
	}
};

// ── 启动 mock 模型服务 ─────────────────────────────────────
const REPLY_TEXT = "MOCK_REPLY_已收到你的消息";
const mock = await startMockModelServer({ reply: REPLY_TEXT });
console.log(`mock 模型服务已启动: ${mock.baseUrl}`);

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

const PROVIDER_ID = "e2e-mock";
const MODEL_ID = "mock-model";
const MODEL_KEY = `${PROVIDER_ID}/${MODEL_ID}`;

// ── 1. 注册自定义 provider 指向 mock 服务 ──────────────────
await check("注册自定义 provider 指向 mock 服务", async () => {
	const r = await win.evaluate(
		async ({ id, baseUrl, apiKey }) => {
			const k = globalThis.kami;
			try {
				await k.saveCustomProvider(
					{
						id,
						name: "E2E Mock",
						baseUrl,
						api: "openai-completions",
						models: [
							{
								id: "mock-model",
								name: "Mock Model",
								reasoning: false,
								vision: false,
								contextWindow: 128000,
								maxTokens: 4096,
							},
						],
					},
					apiKey,
				);
				return { ok: true };
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
			}
		},
		{ id: PROVIDER_ID, baseUrl: mock.baseUrl, apiKey: "sk-e2e-dummy" },
	);
	assert.ok(r.ok, `注册失败: ${r.err}`);
});

await check("自定义 provider 出现在设置快照中", async () => {
	const r = await win.evaluate(async (id) => {
		const s = await globalThis.kami.settingsSnapshot();
		return { found: JSON.stringify(s).includes(id) };
	}, PROVIDER_ID);
	assert.ok(r.found, "设置快照里找不到刚注册的 provider");
});

await check("设置 API Key", async () => {
	const r = await win.evaluate(async ({ id, key }) => {
		try {
			await globalThis.kami.setApiKey(id, key);
			return { ok: true };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 160) };
		}
	}, { id: PROVIDER_ID, key: "sk-e2e-dummy" });
	assert.ok(r.ok, `设置 API Key 失败: ${r.err}`);
});

// ── 2. 选中该模型 ──────────────────────────────────────────
await check("切换到 mock 模型", async () => {
	const r = await win.evaluate(async (key) => {
		const k = globalThis.kami;
		try {
			await k.setModel(key);
			const s = await k.snapshot();
			return { ok: true, active: JSON.stringify(s?.state ?? {}).slice(0, 200) };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
		}
	}, MODEL_KEY);
	assert.ok(r.ok, `切换模型失败: ${r.err}`);
});

// ── 3. 发送消息，验证整条链路 ──────────────────────────────
//
// ⚠️ 这一步走**真实 UI 路径**（在输入框里打字 + Enter），而不是直接调
// `kami.prompt()`。踩过一次才知道差别有多大：直接调 IPC 时消息确实发出去了、
// 回复也确实落进了会话状态，但界面**停在欢迎页** —— 因为「切到会话视图」是
// 界面自己的动作，绕过它就不会发生。于是「回复渲染到界面上」这条断言
// 永远只能是假失败。
//
// 走 UI 路径之后，这条用例验的就是用户真正做的那件事。
const USER_TEXT = "你好，请回复";

await check("在输入框里输入并发送消息", async () => {
	const box = win.locator('[aria-label="消息输入框"]');
	await box.waitFor({ state: "visible", timeout: 30_000 });
	await box.fill(USER_TEXT); // 受控组件：必须用 fill 触发 React 的 onChange
	await box.press("Enter");
	// 给「切视图 + 发请求」留一拍
	await win.waitForTimeout(2500);
});

await check("mock 服务确实收到了 chat/completions 请求", async () => {
	// 给网络往返留点时间
	await new Promise((r) => setTimeout(r, 3000));
	const hit = mock.requests.find((q) => q.url?.includes("/chat/completions"));
	assert.ok(hit, `mock 服务未收到请求。已收到 ${mock.requests.length} 条：${mock.requests.map((q) => q.url).join(", ")}`);
});

await check("请求体包含用户消息内容", async () => {
	const hit = mock.requests.find((q) => q.url?.includes("/chat/completions"));
	assert.ok(hit, "没有请求可校验");
	const body = JSON.stringify(hit.body ?? {});
	assert.ok(body.includes("你好"), `请求体里没有用户消息内容: ${body.slice(0, 300)}`);
});

await check("请求携带了 Authorization 头", async () => {
	const hit = mock.requests.find((q) => q.url?.includes("/chat/completions"));
	assert.ok(hit, "没有请求可校验");
	const auth = hit.headers?.authorization ?? hit.headers?.Authorization ?? "";
	assert.ok(String(auth).length > 0, "请求未携带 Authorization 头");
});

// ── 4. 模型回复落到会话状态 ────────────────────────────────
await check("模型回复出现在会话状态中", async () => {
	const r = await win.evaluate(async (marker) => {
		const k = globalThis.kami;
		// 流式回复可能有延迟，轮询几次
		for (let i = 0; i < 12; i++) {
			const s = await k.snapshot();
			if (JSON.stringify(s).includes(marker)) return { found: true, round: i };
			await new Promise((res) => setTimeout(res, 1500));
		}
		const s = await k.snapshot();
		return { found: false, sample: JSON.stringify(s).slice(0, 400) };
	}, "MOCK_REPLY");
	assert.ok(r.found, `会话状态里找不到模型回复。快照样例: ${r.sample}`);
});

// ── 5. 回复**渲染到界面上** ─────────────────────────────────
//
// ⚠️ 这一条补的是一个真实缺口：上面那条断言的是「回复落到**会话状态**」，
// 走的是 IPC（`snapshot()`）。但「模型回话了」与「用户在界面上看到了」
// 是两件事 —— 渲染层完全可能没把它画出来（消息列表坏了、流式回包没接上、
// 组件抛错被吞），而所有现有断言照过。
//
// 所以这里直接读 DOM：**用户眼睛能看到的文本**。
await check("模型回复渲染到界面上（不只是落到会话状态）", async () => {
	const r = await win.evaluate(async (marker) => {
		for (let i = 0; i < 20; i++) {
			const text = document.body.innerText || "";
			if (text.includes(marker)) return { found: true, round: i, len: text.length };
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-300) };
	}, "MOCK_REPLY");
	assert.ok(r.found, `界面文本里找不到模型回复 —— 回复进了状态但没渲染出来？界面尾部: ${r.sample}`);
	console.log(`      DOM 文本 ${r.len} 字符，第 ${r.round + 1} 轮命中`);
});

// ── 6. 截图留档 ────────────────────────────────────────────
await win.screenshot({ path: resolve(ROOT, "artifacts", "model-roundtrip.png") });

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 主链路端到端测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
	if (status === "FAIL") failed++;
}
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`mock 服务共收到 ${mock.requests.length} 条请求`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);
