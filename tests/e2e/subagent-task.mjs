/**
 * 子代理委派端到端测试：`task` 工具 → 起隔离子会话 → 子代理跑完 → 结果回传主代理。
 *
 * 补的是一处零覆盖：`task`（「把可独立完成的子任务委派给子代理，在隔离上下文中执行」）
 * 是应用的头牌能力之一，但此前**没有任何测试调用过它** —— 连失败分支都没验过。
 * 子代理这条链路比普通工具调用长得多：要起一个**独立会话**、带上那份 agent 人设、
 * 跑它自己的循环，再把结果并回主代理的上下文。任何一环断了，表现都是
 * 「模型说委派了，但什么也没发生」。
 *
 * 做法（确定性，用 mock 模型）——mock 按请求的**内容特征**分流，
 * 而不是靠轮次计数（子代理可能自己再调工具，计数会错）：
 *
 *   - 请求里出现 `role:"tool"` 且带子代理标记 ⇒ 主代理收尾轮 → 返回最终文本；
 *   - 请求里以**任务描述**为用户消息 ⇒ 那是子代理的第一轮 → 返回子代理标记；
 *   - 其余（第一条）⇒ 主代理首轮 → 返回 `task` 工具调用。
 *
 * 断言：子代理**真的被起了**（mock 收到带任务描述的那一轮）、它的产出**回传到了
 * 主代理**（最终上下文里找得到子代理标记）、主代理收尾正常。
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-subagent";
const WORKSPACE_DIR = "/tmp/zerowork-subagent-ws";

const SUBAGENT = "scout"; // resources/agents/ 下的基础子代理之一
const TASK_TEXT = "请只回复这一串标记：SUBAGENT_RAN_7412";
const SUB_MARK = "SUBAGENT_RAN_7412";
const FINAL_TEXT = "TASK_DELEGATION_DONE";

function startMockModel() {
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

			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const send = (delta, finish) => {
				const chunk = { id: "chatcmpl-sub", object: "chat.completion.chunk", choices: [{ index: 0, delta }] };
				if (finish !== undefined) chunk.choices[0].finish_reason = finish;
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			};
			const asText = (s) => {
				for (const chunk of s.match(/.{1,8}/gu) ?? []) send({ content: chunk });
				send({}, "stop");
			};

			send({ role: "assistant", content: "" });
			const msgs = parsed?.messages ?? [];
			const flat = JSON.stringify(msgs);

			if (flat.includes(SUB_MARK) && msgs.some((m) => m.role === "tool")) {
				// 主代理收到了子代理的产出 → 收尾
				asText(FINAL_TEXT);
			} else if (flat.includes(TASK_TEXT) && !msgs.some((m) => m.role === "tool")) {
				// 子代理的第一轮（它的用户消息就是那份任务描述）→ 给出标记
				asText(SUB_MARK);
			} else if (requests.length === 1) {
				// 主代理首轮 → 委派出去
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_task_1",
							type: "function",
							function: { name: "task", arguments: JSON.stringify({ agent: SUBAGENT, task: TASK_TEXT }) },
						},
					],
				});
				send({}, "tool_calls");
			} else {
				// 兜底：不要让 mock 与服务端互相等住
				asText(FINAL_TEXT);
			}
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
	return new Promise((ok) => {
		server.listen(0, "127.0.0.1", () =>
			ok({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((r) => server.close(r)) }),
		);
	});
}

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 240)]);
	}
};

const mock = await startMockModel();
console.log(`✓ mock 模型服务已就绪：${mock.baseUrl}`);

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

await win.evaluate(() => {
	const k = globalThis.kami;
	if (typeof k.onPermissionRequest === "function") {
		k.onPermissionRequest((req) => {
			try {
				k.respondToPermission({ id: req.id, decision: "allow" });
			} catch {
				/* 忽略 */
			}
		});
	}
});

await check("注册指向 mock 的 provider 并切模型", async () => {
	const r = await win.evaluate(async ({ baseUrl, ws }) => {
		const k = globalThis.kami;
		try {
			await k.saveCustomProvider(
				{
					id: "mock-sub",
					name: "Mock Sub",
					baseUrl,
					api: "openai-completions",
					authHeader: true,
					models: [{ id: "sub-model", name: "sub-model", reasoning: false, vision: false, contextWindow: 128000, maxTokens: 8192 }],
				},
				"mock-key",
			);
			await k.setModel("mock-sub/sub-model");
			await k.setWorkspace(ws);
			return { ok: true };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
		}
	}, { baseUrl: mock.baseUrl, ws: WORKSPACE_DIR });
	assert.ok(r.ok, `配置失败：${r.err}`);
});

await check("在输入框里输入并发送（走真实 UI 路径）", async () => {
	const box = win.locator('[aria-label="消息输入框"]');
	await box.waitFor({ state: "visible", timeout: 30_000 });
	await box.fill("请把这个小任务委派给子代理去办");
	await box.press("Enter");
	await win.waitForTimeout(3000);
});

await check("子代理真的被起了（mock 收到带任务描述的那一轮）", async () => {
	for (let i = 0; i < 40 && mock.requests.length < 3; i++) await win.waitForTimeout(1000);
	const subReq = mock.requests.find(
		(r) => JSON.stringify(r.body?.messages ?? []).includes(TASK_TEXT) && !(r.body?.messages ?? []).some((m) => m.role === "tool"),
	);
	assert.ok(
		subReq,
		`没看到子代理自己那一轮请求 —— 委派可能只发了工具调用、没真起子会话。共收到 ${mock.requests.length} 轮：${mock.requests
			.map((r) => (r.body?.messages ?? []).length)
			.join(", ")}`,
	);
	// 子代理是**隔离会话**：它那轮的上下文里不该有主代理之前的对话
	console.log(`      子代理那一轮消息数 ${(subReq.body?.messages ?? []).length}（隔离会话）`);
});

await check("子代理的产出回传到主代理（最终上下文里有它的标记）", async () => {
	const r = await win.evaluate(
		async (mark) => {
			for (let i = 0; i < 40; i++) {
				const s = await globalThis.kami.snapshot();
				if (JSON.stringify(s).includes(mark)) return { found: true };
				await new Promise((res) => setTimeout(res, 1000));
			}
			const s = await globalThis.kami.snapshot();
			return { found: false, sample: JSON.stringify(s).slice(-300) };
		},
		SUB_MARK,
	);
	assert.ok(r.found, `主代理上下文里找不到子代理的产出 ${SUB_MARK} —— 结果没并回来。快照尾部：${r.sample}`);
});

await check("主代理收尾正常（最终回复渲染到界面上）", async () => {
	const r = await win.evaluate(async (mark) => {
		for (let i = 0; i < 25; i++) {
			if ((document.body.innerText || "").includes(mark)) return { found: true };
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-200) };
	}, FINAL_TEXT);
	assert.ok(r.found, `界面上找不到最终回复 ${FINAL_TEXT}。尾部：${r.sample}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 子代理委派测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`（mock 共收到 ${mock.requests.length} 轮请求）`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);