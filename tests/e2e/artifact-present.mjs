/**
 * 产物交付端到端测试：`present_files` → 会话事件 → 界面上的产物卡片。
 *
 * 补的是一处零覆盖：`present_files`（「把成果文件交付给用户」）此前只在一处注释里
 * 被提到过，没有任何测试真正调用它。而它是**任务收尾的最后一环** ——
 * 模型干完活把文件交给用户，用户能不能在界面上看到那张卡片，全看这条链路。
 *
 * 走的是**确定性**路径（mock 模型 + 真实 UI 发送），验三件事：
 *   ① 合法绝对路径 → 工具成功，且界面上渲染出 `.artifact-card` 与文件名；
 *   ② **相对路径必须被拒** —— 契约写明 files 只能是绝对路径或 URL，
 *      静默接受相对路径会让「产物」指向不可预期的地方；
 *   ③ 拒绝时**给出可读原因**（模型据此改），而不是含糊报错。
 *
 * 不用真实模型：这条验的是**交付链路与渲染**，不是模型能力。
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-artifact";
const WORKSPACE_DIR = "/tmp/zerowork-artifact-ws";
const PRESENTED = "交付探针报告.md";
const FINAL_TEXT = "ARTIFACT_PRESENT_DONE";

// ── mock 模型服务：按轮次返回不同的工具调用 ──────────────────
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
				const chunk = { id: "chatcmpl-artifact", object: "chat.completion.chunk", choices: [{ index: 0, delta }] };
				if (finish !== undefined) chunk.choices[0].finish_reason = finish;
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			};
			const callTool = (name, args, id) => {
				send({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
				send({}, "tool_calls");
			};

			send({ role: "assistant", content: "" });
			const msgs = parsed?.messages ?? [];
			const toolResults = msgs.filter((m) => m.role === "tool").length;

			if (toolResults === 0) {
				// 第 1 轮：用**绝对路径**交付（合法）
				callTool("present_files", { files: [resolve(WORKSPACE_DIR, PRESENTED)], explanation: "交付探针" }, "call_pf_1");
			} else if (toolResults === 1) {
				// 第 2 轮：用**相对路径**交付（必须被拒）
				callTool("present_files", { files: [PRESENTED] }, "call_pf_2");
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
// 交付的文件必须真实存在（工具会 stat 它，不存在的会被标 missing）
writeFileSync(resolve(WORKSPACE_DIR, PRESENTED), "# 交付探针\n\n这段用于验证交付链路。\n", "utf8");

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
					id: "mock-artifact",
					name: "Mock Artifact",
					baseUrl,
					api: "openai-completions",
					authHeader: true,
					models: [{ id: "artifact-model", name: "artifact-model", reasoning: false, vision: false, contextWindow: 128000, maxTokens: 8192 }],
				},
				"mock-key",
			);
			await k.setModel("mock-artifact/artifact-model");
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
	await box.fill("把报告交付给我");
	await box.press("Enter");
	await win.waitForTimeout(3000);
});

await check("产物卡片渲染到界面上（.artifact-card + 文件名）", async () => {
	const r = await win.evaluate(async () => {
		for (let i = 0; i < 30; i++) {
			const card = document.querySelector(".artifact-card");
			if (card !== null) {
				return {
					found: true,
					name: (card.querySelector(".artifact-name")?.textContent ?? "").trim(),
					hasPreviewBtn: card.querySelector(".artifact-preview-btn") !== null,
					gridCount: document.querySelectorAll(".artifact-card").length,
				};
			}
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-300) };
	});
	assert.ok(r.found, `界面上没有出现 .artifact-card —— 交付事件没画出来？界面尾部：${r.sample}`);
	assert.ok(String(r.name).includes(basename(PRESENTED, ".md")), `卡片上的文件名不对：${JSON.stringify(r.name)}`);
	console.log(`      产物卡片「${r.name}」（共 ${r.gridCount} 张，含预览按钮：${r.hasPreviewBtn}）`);
});

await check("相对路径被拒绝，且给出可读原因", async () => {
	// 第 2 轮 mock 用相对路径交付 —— 工具契约要求绝对路径或 URL，必须被拒。
	// 断言落在**第二轮请求带回的工具结果**上（那正是模型看到的东西），
	// 而不是我们的推测。
	for (let i = 0; i < 20 && mock.requests.length < 3; i++) await win.waitForTimeout(1000);
	assert.ok(mock.requests.length >= 3, `mock 只收到 ${mock.requests.length} 轮请求 —— 第二轮工具没跑完`);

	const third = mock.requests[2];
	const toolMsgs = (third?.body?.messages ?? []).filter((m) => m.role === "tool");
	assert.ok(toolMsgs.length >= 2, `第三轮请求里只有 ${toolMsgs.length} 条工具结果，期望 ≥2`);
	const second = JSON.stringify(toolMsgs[1]?.content ?? "");
	assert.ok(
		/绝对路径|无效/.test(second),
		`相对路径没有被拒，或原因不含可操作信息：${second.slice(0, 200)}`,
	);
	console.log(`      拒绝原因: ${second.slice(0, 120)}`);
});

await check("最终回复也渲染出来", async () => {
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
console.log("\n═══ 产物交付测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);