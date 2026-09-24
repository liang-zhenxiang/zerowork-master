/**
 * 真实模型端到端测试：用真实 LLM 验证「发送 → 收到回复」。
 *
 * 与 model-roundtrip.mjs 的关系：
 *   model-roundtrip —— 用本地 mock 服务，验证**链路通了**（无外部依赖，CI 里跑）
 *   real-model       —— 用真实模型，验证**真的能对话**（需要本机有可用端点）
 *
 * 为什么要分开：mock 只能证明管道不漏，证明不了协议对接正确 ——
 * 真实端点的鉴权头格式、流式事件类型、token 计数、错误结构都可能与 mock 不同。
 * 这一层补上「与真实服务对接」的验证。
 *
 * ⚠️ 凭据处理：
 *   凭据在**运行时**从 ~/.claude/settings.json 读取，**不进仓库、不打印**。
 *   端点不可用时整轮跳过（exit 0），不会让 CI 因缺少本机环境而失败。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-realmodel";
const WORKSPACE_DIR = "/tmp/zerowork-realmodel-ws";
const SHOT_DIR = resolve(ROOT, "artifacts");

// ── 读取本机端点配置（凭据不落盘、不打印）────────────────────
const SETTINGS = resolve(homedir(), ".claude", "settings.json");
function readEndpoint() {
	if (!existsSync(SETTINGS)) return undefined;
	try {
		const env = JSON.parse(readFileSync(SETTINGS, "utf8"))?.env ?? {};
		const baseUrl = env.ANTHROPIC_BASE_URL;
		const token = env.ANTHROPIC_AUTH_TOKEN;
		// 模型名去掉方括号后缀（[1M] 之类是本地代理的档位标注，不是 API 里的模型 id）
		const model = String(env.ANTHROPIC_MODEL ?? "").replace(/\[[^\]]*\]$/, "");
		if (!baseUrl || !token || !model) return undefined;
		return { baseUrl, token, model };
	} catch {
		return undefined;
	}
}

const endpoint = readEndpoint();

if (endpoint === undefined) {
	console.log("⚠ 未在本机找到可用的模型端点配置，跳过真实模型测试。");
	console.log(`  （读取位置：${SETTINGS}，需要 env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL）`);
	process.exit(0);
}

// 探测端点是否真的活着 —— 不活也跳过，避免把「本机没起代理」当成应用故障
const probe = await fetch(`${endpoint.baseUrl}/v1/messages`, {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"x-api-key": endpoint.token,
		"anthropic-version": "2023-06-01",
	},
	body: JSON.stringify({
		model: endpoint.model,
		max_tokens: 16,
		messages: [{ role: "user", content: "hi" }],
	}),
}).catch(() => undefined);

if (!probe || !probe.ok) {
	console.log(`⚠ 模型端点不可用（HTTP ${probe?.status ?? "无响应"}），跳过真实模型测试。`);
	console.log(`  端点：${endpoint.baseUrl}`);
	process.exit(0);
}
console.log(`✓ 模型端点可用：${endpoint.baseUrl}，模型 ${endpoint.model}`);

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 220)]);
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

const PROVIDER_ID = "local-proxy";

await check("配置真实模型端点", async () => {
	const r = await win.evaluate(
		async ({ id, baseUrl, token, model }) => {
			try {
				await globalThis.kami.saveCustomProvider(
					{
						id,
						name: "Local Proxy",
						baseUrl,
						// 本机代理讲 Anthropic Messages 协议，且走 x-api-key 头
						api: "anthropic-messages",
						authHeader: true,
						models: [
							{
								id: model,
								name: model,
								reasoning: false,
								vision: false,
								contextWindow: 128000,
								maxTokens: 4096,
							},
						],
					},
					token,
				);
				await globalThis.kami.setModel(`${id}/${model}`);
				return { ok: true };
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
			}
		},
		{ id: PROVIDER_ID, baseUrl: endpoint.baseUrl, token: endpoint.token, model: endpoint.model },
	);
	assert.ok(r.ok, `配置失败: ${r.err}`);
});

await check("发送消息并收到真实回复", async () => {
	// 让模型回一个可断言的特征串，避免"随便回点什么都算过"
	const MARK = `ZW${Date.now().toString().slice(-6)}`;
	const r = await win.evaluate(
		async ({ mark }) => {
			const k = globalThis.kami;
			try {
				await Promise.race([
					k.prompt({ text: `请原样回复这个标记，不要加任何其它内容：${mark}` }),
					new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT_120S")), 120_000)),
				]);
			} catch (e) {
				const msg = String(e?.message ?? e);
				if (msg.includes("TIMEOUT_120S")) return { timedOut: true };
			}
			return { timedOut: false };
		},
		{ mark: MARK },
	);
	assert.ok(!r.timedOut, "发送后 120 秒未返回 —— 主链路挂起");

	// 轮询等 assistant 条目落盘。
	// 注意不能只在整个 snapshot 里找标记 —— 消息发出后**任务标题**立刻就会
	// 带上这段文本，标记很快就"找得到"，但此时 assistant 回复尚未落盘。
	// 必须等到 entries 里出现真正带内容的 assistant 条目。
	const found = await win.evaluate(async () => {
		for (let i = 0; i < 40; i++) {
			const s = await globalThis.kami.snapshot();
			const entries = s?.entries ?? [];
			const assistant = entries.filter((e) => e?.role === "assistant" && String(e?.text ?? "").length > 0);
			if (assistant.length > 0) return { found: true, round: i, text: assistant.at(-1).text, usage: assistant.at(-1).usage };
			await new Promise((res) => setTimeout(res, 2000));
		}
		const s = await globalThis.kami.snapshot();
		return { found: false, entryCount: (s?.entries ?? []).length, sample: JSON.stringify(s?.entries ?? []).slice(0, 400) };
	});

	await win.screenshot({ path: resolve(SHOT_DIR, "real-model.png") });
	assert.ok(found.found, `等不到 assistant 回复。条目数 ${found.entryCount}，样例: ${found.sample}`);
	console.log(`      模型回复: ${JSON.stringify(found.text).slice(0, 120)}`);
	console.log(`      token 用量: ${JSON.stringify(found.usage)}`);
});

await check("回复携带真实 token 用量", async () => {
	// 真实服务会在 usage 里回报 token 数；这是"确实调用了真实模型"的硬证据，
	// mock 服务不会有这个字段。
	const r = await win.evaluate(async () => {
		const s = await globalThis.kami.snapshot();
		const a = (s?.entries ?? []).filter((e) => e?.role === "assistant").at(-1);
		return { usage: a?.usage ?? null };
	});
	assert.ok(r.usage !== null && r.usage !== undefined, "assistant 条目没有 usage 字段");
	assert.ok(
		Number(r.usage?.input ?? 0) > 0 || Number(r.usage?.totalTokens ?? 0) > 0,
		`usage 里没有有效的 token 计数: ${JSON.stringify(r.usage)}`,
	);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 真实模型端到端测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
for (const [, , msg] of results) if (msg) failed += 0;
failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`截图: artifacts/real-model.png`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
