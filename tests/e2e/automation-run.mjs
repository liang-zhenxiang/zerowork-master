/**
 * 定时任务**执行**链路端到端测试：入队 → 起会话 → 跑提示词 → 落运行记录。
 *
 * 此前只测过定时任务的 CRUD（建/改/启停/删，见 local-state.mjs），**执行**这一半
 * 一行都没跑过 —— 而「到点真的把任务跑起来」才是这个功能存在的意义。
 * CRUD 全绿而执行不通，用户看到的是「任务都在列表里，但从来没跑过」。
 *
 * 断言的是整条链路：
 *   ① `automationRunNow` 入队后，调度器真的起了会话、把提示词跑完；
 *   ② 运行记录落盘（`runs[0]` 有 `success: true` 与非空 `sessionId`）；
 *   ③ 任务本身仍留在列表里（执行不该把任务弄丢）。
 *
 * ⚠️ 凭据运行时从 ~/.claude/settings.json 读取，不进仓库、不打印。
 *    端点不可用时整轮跳过。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-auto";
const WORKSPACE_DIR = "/tmp/zerowork-auto-ws";

// ── 模型端点（可选）──────────────────────────────────────────
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
console.log(endpoint ? "✓ 模型端点可用" : "⚠ 模型端点不可用 —— 执行链路需要模型，整轮跳过");
if (endpoint === undefined) process.exit(0);

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 260)]);
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

// 权限自动批准：任务执行时若遇到审批会一直挂着
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

/** 自定义任务用的标记：形如一个单词加数字，弱模型也抄得准。 */
const TASK_NAME = "zw-auto-run-probe";

await check("自动化执行：手动触发后真的跑完并落运行记录", async () => {
	const r = await win.evaluate(
		async ({ ws, name }) => {
			const k = globalThis.kami;
			const asArray = (v) => (Array.isArray(v) ? v : (v?.tasks ?? []));

			// 先清掉可能存在的同名残留
			for (const t of asArray(await k.listAutomations())) {
				if (t.name === name) await k.deleteAutomation(t.id).catch(() => {});
			}

			const task = await k.saveAutomation({
				name,
				prompt: "请只回复：定时任务已执行",
				cwd: ws,
				schedule: { type: "interval", everyMinutes: 60 },
			});

			await k.runAutomationNow(task.id);

			// 轮询运行记录：调度器是**入队即返回**，跑完才 appendRun
			let last = undefined;
			for (let i = 0; i < 90; i++) {
				last = asArray(await k.listAutomations()).find((t) => t.id === task.id);
				if ((last?.runs ?? []).length > 0) break;
				await new Promise((res) => setTimeout(res, 2000));
			}

			const run = (last?.runs ?? [])[0];
			const result = {
				stillListed: last !== undefined,
				runCount: (last?.runs ?? []).length,
				success: run?.success,
				sessionId: run?.sessionId,
				error: run?.error,
				startedAt: run?.startedAt,
				finishedAt: run?.finishedAt,
			};
			// 收尾：删掉探针任务，别把状态留给后续
			await k.deleteAutomation(task.id).catch(() => {});
			return result;
		},
		{ ws: WORKSPACE_DIR, name: TASK_NAME },
	);

	assert.ok(r.runCount > 0, "任务触发了但运行记录一直没落 —— 调度器没把它跑完");
	assert.ok(r.stillListed, "执行后任务从列表里消失了");
	assert.equal(r.success, true, `任务执行失败：${r.error ?? "（无错误说明）"}`);
	assert.ok(typeof r.sessionId === "string" && r.sessionId !== "", "运行记录里没有 sessionId —— 没起会话？");
	assert.ok(
		typeof r.finishedAt === "number" && r.finishedAt >= r.startedAt,
		`运行记录的时间字段不对：started=${r.startedAt} finished=${r.finishedAt}`,
	);
	console.log(`      运行记录: success=${r.success} sessionId=${String(r.sessionId).slice(0, 12)}… 耗时 ${r.finishedAt - r.startedAt}ms`);
});

await check("自动化执行：探针任务已清理干净", async () => {
	const r = await win.evaluate(async (name) => {
		const v = await globalThis.kami.listAutomations();
		const arr = Array.isArray(v) ? v : (v?.tasks ?? []);
		return { leftover: arr.filter((t) => t.name === name).length };
	}, TASK_NAME);
	assert.equal(r.leftover, 0, `还有 ${r.leftover} 个探针任务没删掉`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 定时任务执行链路测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);