/**
 * 可视化卡片**渲染**端到端测试（不需要真实模型 —— 用 mock 服务）。
 *
 * 补的是一处零覆盖：`show_widget` 的**校验规则**已有单元测试
 * （`tests/unit/tools.test.mjs`：6 条拒绝规则、render_mode 推断等），
 * 但**卡片是否真的画到界面上**从来没验过 —— 而那才是这个功能的全部意义。
 * 工具返回对了、渲染层没接上，用户看到的就是「回复里什么都没有」，
 * 而单测与 IPC 断言全都照过。
 *
 * 做法：mock 模型服务按轮次返回 ——
 *   第 1 轮：一个 `tool_calls`，调用 `show_widget`，参数是一段合法 SVG；
 *   第 2 轮（请求体里出现 role:"tool" 说明工具已执行完）：普通最终文本。
 * 然后用**真实 UI 路径**发消息（在输入框打字 + Enter），最后断言 DOM 里
 * 出现了 `.widget-card` 与标题。
 *
 * 为什么不用真实模型：这条验的是**渲染链路**，不是模型能力。mock 让轮次完全确定，
 * 也就没有「弱模型不肯调工具」这类抖动。
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-widget";
const WORKSPACE_DIR = "/tmp/zerowork-widget-ws";

const WIDGET_TITLE = "渲染探针图";
const FINAL_TEXT = "WIDGET_RENDER_DONE";
// 合法片段：恰好一个 <svg>，viewBox 为 "0 0 680 H"（这两条是工具的硬校验）
const WIDGET_CODE =
	'<svg viewBox="0 0 680 200" width="100%" xmlns="http://www.w3.org/2000/svg">' +
	'<rect x="20" y="20" width="640" height="160" rx="12" fill="#1470b4"/>' +
	'<text x="340" y="110" text-anchor="middle" fill="#fff" font-size="32">WIDGET</text></svg>';

// ── mock 模型服务 ────────────────────────────────────────────
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
				const chunk = { id: "chatcmpl-widget", object: "chat.completion.chunk", choices: [{ index: 0, delta }] };
				if (finish !== undefined) chunk.choices[0].finish_reason = finish;
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			};

			send({ role: "assistant", content: "" });

			// 请求体里出现 role:"tool" ⇒ 工具已经执行完，该收尾了
			const msgs = parsed?.messages ?? [];
			const hasToolResult = msgs.some((m) => m.role === "tool");

			if (!hasToolResult && requests.length === 1) {
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_widget_1",
							type: "function",
							function: {
								name: "show_widget",
								arguments: JSON.stringify({
									title: WIDGET_TITLE,
									widget_code: WIDGET_CODE,
									loading_messages: ["正在绘制"],
								}),
							},
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

await check("注册指向 mock 的 provider 并切模型", async () => {
	const r = await win.evaluate(async ({ baseUrl, ws }) => {
		const k = globalThis.kami;
		try {
			await k.saveCustomProvider(
				{
					id: "mock-widget",
					name: "Mock Widget",
					baseUrl,
					api: "openai-completions",
					authHeader: true,
					models: [{ id: "widget-model", name: "widget-model", reasoning: false, vision: false, contextWindow: 128000, maxTokens: 8192 }],
				},
				"mock-key",
			);
			await k.setModel("mock-widget/widget-model");
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
	await box.fill("请给我画一张示意图");
	await box.press("Enter");
	await win.waitForTimeout(3000);
});

await check("mock 收到了两轮请求（工具调用循环转起来了）", async () => {
	for (let i = 0; i < 20 && mock.requests.length < 2; i++) await win.waitForTimeout(1000);
	assert.ok(mock.requests.length >= 2, `mock 只收到 ${mock.requests.length} 轮请求 —— 循环没转起来`);
	const second = mock.requests[1];
	const hasToolMsg = (second?.body?.messages ?? []).some((m) => m.role === "tool");
	assert.ok(hasToolMsg, "第二轮请求里没有 role:tool —— 工具结果没回传");
	console.log(`      mock 收到 ${mock.requests.length} 轮请求`);
});

await check("可视化卡片渲染到界面上（.widget-card + 标题）", async () => {
	const r = await win.evaluate(async () => {
		for (let i = 0; i < 30; i++) {
			const card = document.querySelector(".widget-card");
			if (card !== null) {
				return {
					found: true,
					titleText: (card.querySelector(".widget-title")?.textContent ?? "").trim(),
					hasFrame: card.querySelector(".widget-frame") !== null,
					hasError: card.querySelector(".widget-error") !== null,
					cardText: (card.textContent ?? "").slice(0, 120),
				};
			}
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-300) };
	});
	assert.ok(r.found, `界面上没有出现 .widget-card —— 工具返回对了但没渲染？界面尾部：${r.sample}`);
	assert.equal(r.titleText, WIDGET_TITLE, `卡片标题不对：${JSON.stringify(r.titleText)}`);
	assert.ok(r.hasFrame, "卡片里没有 .widget-frame —— 内容没挂上");
	assert.ok(!r.hasError, `卡片是错误态：${r.cardText}`);
	console.log(`      卡片标题「${r.titleText}」，含 frame ✓`);
});

await check("最终回复也渲染出来（工具调用后模型继续说话）", async () => {
	const r = await win.evaluate(async (mark) => {
		for (let i = 0; i < 20; i++) {
			if ((document.body.innerText || "").includes(mark)) return { found: true };
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-200) };
	}, FINAL_TEXT);
	assert.ok(r.found, `界面上找不到最终回复 ${FINAL_TEXT}。尾部：${r.sample}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 可视化卡片渲染测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);