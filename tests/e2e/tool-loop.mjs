/**
 * Agent 工具调用循环测试：模型请求工具 → agent 执行 → 结果回传 → 最终回复。
 *
 * 这一层验证的是「agent 能不能干活」，而不只是「模型能不能回话」。
 * 与 model-roundtrip.mjs 的区别：
 *   model-roundtrip —— 模型直接回文本（一问一答）
 *   tool-loop       —— 模型要求执行工具，agent 执行后再让它总结（多轮循环）
 *
 * 用 mock 服务分两轮响应：
 *   第 1 轮：返回 tool_calls，要求执行 `ls`
 *   第 2 轮：收到工具执行结果后，返回最终文本
 * 断言 mock 服务**收到了第 2 轮请求且请求体里带工具执行结果** ——
 * 这就证明 agent 循环真的转起来了，而不是模型自说自话。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-toolloop";
const WORKSPACE_DIR = "/tmp/zerowork-toolloop-ws";

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

const FINAL_TEXT = "TOOL_LOOP_DONE_已完成";

/**
 * 两轮 mock 服务：
 *   第 1 次请求 → 返回 tool_calls（要求 ls）
 *   第 2 次及以后 → 返回最终文本
 */
function startTwoTurnServer() {
	const requests = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				parsed = undefined;
			}
			requests.push({ url: req.url, body: parsed });

			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			const base = { id: `chatcmpl-tl-${Date.now()}`, object: "chat.completion.chunk", created: 0, model: "mock-model" };
			const send = (delta, finish = null) => {
				res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
			};

			send({ role: "assistant", content: "" });

			// 判断这是第几轮：请求体里出现 role:"tool" 说明工具已执行完
			const msgs = parsed?.messages ?? [];
			const hasToolResult = msgs.some((m) => m.role === "tool");

			if (!hasToolResult && requests.length === 1) {
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_tl_1",
							type: "function",
							function: { name: "ls", arguments: '{"path":"."}' },
						},
					],
				});
				send({}, "tool_calls");
			} else {
				for (const chunk of FINAL_TEXT.match(/.{1,8}/gu) ?? []) send({ content: chunk });
				send({}, "stop");
			}

			res.write("data: [DONE]\n\n");
			res.end();
		});
	});

	return new Promise((resolve_) => {
		server.listen(0, "127.0.0.1", () => {
			resolve_({
				baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
				requests,
				close: () => new Promise((r) => server.close(r)),
			});
		});
	});
}

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 200)]);
	}
};

const mock = await startTwoTurnServer();
console.log(`两轮 mock 服务已启动: ${mock.baseUrl}`);

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

await check("注册 provider 并选中模型", async () => {
	const r = await win.evaluate(
		async ({ baseUrl }) => {
			const k = globalThis.kami;
			try {
				await k.saveCustomProvider(
					{
						id: "e2e-loop",
						name: "E2E Loop",
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
					"sk-e2e-dummy",
				);
				await k.setModel("e2e-loop/mock-model");
				return { ok: true };
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
			}
		},
		{ baseUrl: mock.baseUrl },
	);
	assert.ok(r.ok, `配置失败: ${r.err}`);
});

await check("发送消息触发工具调用循环", async () => {
	try {
		await win.evaluate(async () => {
			await Promise.race([
				globalThis.kami.prompt({ text: "请列出当前目录" }),
				new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT_90S")), 90_000)),
			]);
		});
	} catch (e) {
		// 前端调用本身可能异步返回；关键是服务端行为，下一步断言
		const msg = String(e?.message ?? e);
		assert.ok(!msg.includes("TIMEOUT_90S"), `发送后挂起 90 秒未返回：${msg}`);
	}
});

await check("mock 服务收到至少两轮请求（证明循环转起来了）", async () => {
	// 工具执行 + 二次请求需要时间
	for (let i = 0; i < 20 && mock.requests.length < 2; i++) {
		await new Promise((r) => setTimeout(r, 1500));
	}
	assert.ok(
		mock.requests.length >= 2,
		`只收到 ${mock.requests.length} 轮请求。agent 循环未转起来 —— ` +
			`若只收到 1 轮，说明工具调用没有被执行并回传`,
	);
});

await check("第二轮请求带回了工具执行结果", async () => {
	const second = mock.requests[1];
	assert.ok(second, "没有第二轮请求");
	const msgs = second.body?.messages ?? [];
	const toolMsgs = msgs.filter((m) => m.role === "tool");
	assert.ok(
		toolMsgs.length > 0,
		`第二轮请求里没有 role:"tool" 的消息，说明工具结果未回传。` +
			`消息角色：${msgs.map((m) => m.role).join(", ")}`,
	);
});

await check("最终回复落到会话状态", async () => {
	const r = await win.evaluate(async () => {
		for (let i = 0; i < 12; i++) {
			const s = await globalThis.kami.snapshot();
			if (JSON.stringify(s).includes("TOOL_LOOP_DONE")) return { found: true };
			await new Promise((res) => setTimeout(res, 1500));
		}
		return { found: false, sample: JSON.stringify(await globalThis.kami.snapshot()).slice(0, 400) };
	});
	assert.ok(r.found, `会话状态里找不到最终回复。样例: ${r.sample}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ Agent 工具调用循环测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
	if (status === "FAIL") failed++;
}
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`mock 服务共收到 ${mock.requests.length} 轮请求`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);
