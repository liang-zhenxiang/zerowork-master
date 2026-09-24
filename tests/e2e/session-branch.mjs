/**
 * 会话分支端到端测试：从历史里的某条消息分叉出一条新会话。
 *
 * 这是一条**零覆盖**的用户功能：此前只测过「传不存在的路径会被明确拒绝」
 * （见 bridge-rest.mjs），也就是只验了失败分支。真正会用到的那条路 ——
 * 有会话、有历史、从中间某个点分叉出去 —— 一行都没跑过。
 *
 * 断言：
 *   ① 分叉返回 `{ ok: true, branchPath, branchTitle }`，且 `branchPath` 是**另一个文件**；
 *   ② 新会话**真的落盘**（会话列表从 1 条变 2 条，且两条路径不同）；
 *   ③ 分叉后当前会话切到分支上（这是该功能的语义：接着从分叉点往下走）；
 *   ④ 母会话**没有被改坏**——仍在列表里、仍能读快照。
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
const CONFIG_DIR = "/tmp/zerowork-branch";
const WORKSPACE_DIR = "/tmp/zerowork-branch-ws";

// 标记要挑**弱模型也抄得准**的形状（理由见 doc-parsing.mjs 的同类注释）
// 一个只会出现在这条会话里的词，用来证明「母会话确实有历史」。
//
// ⚠️ 提示词**不要说「记住」**（最初写的是「请记住这个词」）：记忆系统的提示词
// 把用户级记忆的路径写成了字面量 `~/.zerowork/MEMORY.md`，并让模型**直接对那个
// 固定路径用 edit 写**。于是模型会绕过本测试设置的 ZEROWORK_CONFIG_DIR，
// 把测试残留写进**用户真实家目录**里 —— 既污染用户状态，也让下一次运行读到
// 「我已经记住过了」而改变行为。用具名痕迹的复述任务即可，别沾记忆语义。
const MARK = "CEDAR3140";

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
console.log(endpoint ? "✓ 模型端点可用" : "⚠ 模型端点不可用 —— 建会话需要模型，整轮跳过");
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

await check("配置真实模型并切换工作区，建出一条有历史的会话", async () => {
	const r = await win.evaluate(
		async ({ baseUrl, token, model, ws, mark }) => {
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
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
			}

			// 发一条消息 → 会话落盘（这一步是后续分叉的前提）
			try {
				await Promise.race([
					k.prompt({ text: `请把这一串字符原样复述一遍，不要做其他操作：${mark}` }),
					new Promise((_, rej) => setTimeout(() => rej(new Error("__TIMEOUT__")), 150_000)),
				]);
			} catch (e) {
				if (String(e?.message ?? "").includes("__TIMEOUT__")) return { ok: false, timedOut: true };
			}

			// 等会话**真正落盘**再返回。
			// ⚠️ 不能只看 listSessions 有没有条目：它会返回「桶里已有、文件还没写下去」
			// 的 pending 条目（见 daemon 里组装列表时的 pending 分支），拿那种路径去分叉
			// 会因 `!existsSync` 得到 `no-file` —— 起初就是这么假失败了一次。
			for (let i = 0; i < 30; i++) {
				const list = await k.listSessions();
				const arr = Array.isArray(list) ? list : (list?.sessions ?? []);
				const real = arr.filter((s) => s?.isTempTask !== true && typeof s?.path === "string");
				// 优先取标了 current 的那条（它就是本条会话），再确认文件确实在磁盘上
				const pick = real.find((s) => s.current === true) ?? real[0];
				if (pick !== undefined) {
					const st = await k.statPath(pick.path).catch(() => undefined);
					if (st?.kind === "file") return { ok: true, count: real.length, path: pick.path };
				}
				await new Promise((res) => setTimeout(res, 1000));
			}
			return { ok: false, err: "发消息后会话文件一直没落到磁盘" };
		},
		{ ...endpoint, ws: WORKSPACE_DIR, mark: MARK },
	);
	assert.ok(r.ok, `建会话失败：${r.err ?? "超时"}`);
	assert.ok(r.path, "会话路径为空");
	console.log(`      母会话: ${String(r.path).split("/").pop()}（列表 ${r.count} 条）`);
});

// 分叉只做一次，结果给下面几条用例共用 —— 分开各做一次会让「已切到分支」那条
// 在分叉失败时反而**假通过**（它读的是母会话的快照，条目当然读得出来）。
let branchRes = undefined;
let motherPath = undefined;

await check("分叉：返回 ok + branchPath，且是另一个文件", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;

		// ⚠️ 先等这一轮**真的结束**（running 变 false）再分叉。
		// 提示词 resolve 只说明「消息发出去了」，daemon 侧的桶可能还标着运行中，
		// 此时分叉会得到 `busy`（「正在生成，稍后再试」）—— 起初就是这么假失败了一次。
		let mother = undefined;
		for (let i = 0; i < 60; i++) {
			const list = await k.listSessions();
			const arr = Array.isArray(list) ? list : (list?.sessions ?? []);
			const real = arr.filter((s) => s?.isTempTask !== true && typeof s?.path === "string");
			mother = real.find((s) => s.current === true) ?? real[0];
			if (mother !== undefined && mother.running === false) break;
			await new Promise((res) => setTimeout(res, 1000));
		}
		if (mother === undefined) return { err: "找不到母会话" };
		if (mother.running !== false) return { err: "母会话一直在运行，等不到可分支的时刻" };

		// 从第 1 条用户消息分叉，并把那一轮带上（includeTurn）—— 不带上会得到空会话，
		// 断言就退化成「生成了一个空文件」，验不出内容有没有正确截断
		const res = await k.branchSessionFrom(mother.path, 0, { includeTurn: true });
		return { motherPath: mother.path, res };
	});
	assert.ok(!r.err, r.err);
	branchRes = r.res;
	motherPath = r.motherPath;
	assert.equal(branchRes?.ok, true, `分叉失败：${branchRes?.message ?? JSON.stringify(branchRes).slice(0, 200)}`);
	assert.ok(typeof branchRes.branchPath === "string" && branchRes.branchPath !== "", "没返回 branchPath");
	assert.notEqual(branchRes.branchPath, motherPath, "分支路径与母会话相同 —— 没真的分叉");
	console.log(`      母会话: ${String(motherPath).split("/").pop()}`);
	console.log(`      分支:   ${String(branchRes.branchPath).split("/").pop()}  标题: ${branchRes.branchTitle ?? "（无）"}`);
});

await check("分叉：新会话落盘，会话列表可见两条且路径不同", async () => {
	assert.ok(branchRes?.ok, "上一步分叉没成功，本步无从验证");
	const r = await win.evaluate(async () => {
		const list = await globalThis.kami.listSessions();
		const arr = Array.isArray(list) ? list : (list?.sessions ?? []);
		return arr.filter((s) => s?.isTempTask !== true && typeof s?.path === "string").map((s) => s.path);
	});
	assert.ok(r.length >= 2, `分叉后会话数应 ≥2，实际 ${r.length}`);
	assert.equal(new Set(r).size, r.length, "会话列表里出现了重复路径");
	assert.ok(r.includes(branchRes.branchPath), "会话列表里找不到刚分叉出来的那个文件");
});

await check("分叉：当前会话已切到分支上（这是该功能的语义）", async () => {
	assert.ok(branchRes?.ok, "上一步分叉没成功，本步无从验证");
	const r = await win.evaluate(async () => {
		const list = await globalThis.kami.listSessions();
		const arr = Array.isArray(list) ? list : (list?.sessions ?? []);
		const cur = arr.find((s) => s.current === true);
		const entries = (await globalThis.kami.snapshot())?.entries ?? [];
		return { currentPath: cur?.path, userTurns: entries.filter((e) => e?.role === "user").length };
	});
	assert.equal(r.currentPath, branchRes.branchPath, `当前会话没切到分支上（当前是 ${String(r.currentPath).split("/").pop()}）`);
	// 分支带上了那一轮，所以它应该读得出这条用户消息
	assert.ok(r.userTurns >= 1, `分支应带上那一轮用户消息，实际 userTurns=${r.userTurns}`);
});

await check("分叉：母会话未被改坏（仍能复开并读出条目）", async () => {
	assert.ok(branchRes?.ok, "上一步分叉没成功，本步无从验证");
	const r = await win.evaluate(async (mother) => {
		try {
			await globalThis.kami.resumeSession(mother);
			const entries = (await globalThis.kami.snapshot())?.entries ?? [];
			return { ok: true, entries: entries.length };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 160) };
		}
	}, motherPath);
	assert.ok(r.ok, `母会话无法复开：${r.err}`);
	assert.ok(r.entries > 0, "母会话复开后读不出条目 —— 被改坏了？");
	console.log(`      母会话复开后条目数 ${r.entries}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 会话分支测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);