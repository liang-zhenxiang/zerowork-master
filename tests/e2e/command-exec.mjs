/**
 * 命令执行链路端到端测试：模型 → powershell 工具 → 权限门 → 沙箱/降级 → 输出回传。
 *
 * 这块此前**从未被端到端验证过**：`tool-loop` 用的是 pi 内置的 `ls`（只读文件工具），
 * 而应用自己那条命令执行链路 —— 权限门判定、沙箱探测与降级分支、托管运行时注入、
 * 输出回传 —— 一行都没跑过。它是 Agent 的主干能力（「让它帮我做点事」就靠它）。
 *
 * ## 本机（macOS）上必须知道的一件事
 *
 * 命令沙箱靠 `koffi` 调 Windows 的 kernel32/advapi32 —— **Windows 专有**。
 * 所以在本机 `sandbox.probe()` 必然 `available: false`，于是：
 *
 *   - `workspace-write` / `read-only` 档（**含默认档**）→ **命令被直接拒绝**，
 *     理由是「为避免在没有操作系统写入约束的情况下执行命令」，并给出逃生指引
 *     （切到「允许完全访问」）。这是**有意的安全设计**：宁可不执行，
 *     也不静默地无约束执行。
 *   - `danger-full-access` 档 → 不经沙箱、直接 spawn，**可以执行**。
 *
 * 于是本测试断言两件相反的事，两件都必要：
 *   A. **默认档下拒绝执行**，且审计里留下 `sandbox/blocked` 痕迹（安全性质）；
 *   B. **切到完全访问档后命令真的跑起来**，标记经工具结果回到模型回复（功能性质）。
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
const CONFIG_DIR = "/tmp/zerowork-cmdexec";
const WORKSPACE_DIR = "/tmp/zerowork-cmdexec-ws";

// 标记要挑**弱模型也抄得准**的形状（理由见 doc-parsing.mjs 的同类注释）
const MARK = "ORBIT5280";

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
console.log(endpoint ? "✓ 模型端点可用" : "⚠ 模型端点不可用 —— 本测试需要模型，整轮跳过");
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

// 自动批准 + 记录权限请求（命令执行是 `ask` 档，应走审批；这一步同时把链路走通）
await win.evaluate(() => {
	globalThis.__zwPermLog = [];
	const k = globalThis.kami;
	if (typeof k.onPermissionRequest === "function") {
		k.onPermissionRequest((req) => {
			globalThis.__zwPermLog.push({ id: req?.id, toolName: req?.toolName, risk: req?.risk });
			try {
				k.respondToPermission({ id: req.id, decision: "allow" });
			} catch {
				/* 应答失败忽略：本用例只关心主链路 */
			}
		});
	}
});

/** 让模型跑一条 echo 命令，返回 {found, text, timedOut}。 */
async function askModelToRun(text) {
	return win.evaluate(
		async ({ t, mark, ms }) => {
			const k = globalThis.kami;
			try {
				await Promise.race([
					k.prompt({ text: t }),
					new Promise((_, rej) => setTimeout(() => rej(new Error("__TIMEOUT__")), ms)),
				]);
			} catch (e) {
				if (String(e?.message ?? "").includes("__TIMEOUT__")) return { timedOut: true };
			}
			for (let i = 0; i < 45; i++) {
				const s = await k.snapshot();
				const a = (s?.entries ?? []).filter((x) => x?.role === "assistant" && String(x?.text ?? "").length > 0);
				const txt = a.map((x) => x.text).join("\n");
				if (txt.includes(mark)) return { found: true, text: txt.slice(-300) };
				await new Promise((res) => setTimeout(res, 2000));
			}
			const s = await k.snapshot();
			const a = (s?.entries ?? []).filter((x) => x?.role === "assistant");
			return { found: false, text: JSON.stringify(a).slice(-400) };
		},
		{ t: text, mark: MARK, ms: 180_000 },
	);
}

const promptText = `请用 powershell 工具在我的工作区（${WORKSPACE_DIR}）里执行一条命令，把文本 ${MARK} 打印出来，然后告诉我这条命令的实际输出是什么。`;

// ── A. 默认档：沙箱不可用 ⇒ 拒绝执行（安全性质）─────────────

await check("沙箱不可用时：默认档拒绝执行命令（不静默无约束执行）", async () => {
	// 先确认本机确实没有沙箱 —— 有沙箱的机器（Windows）上这条用例的前提不成立
	const sb = await win.evaluate(async () => {
		const p = await globalThis.kami.getPermissions();
		return { mode: p?.settings?.sandbox, note: String(p?.sandboxNote ?? "") };
	});
	console.log(`      当前权限档: ${sb.mode}`);

	await win.evaluate(async () => {
		await globalThis.kami.setPermissions({ sandbox: "workspace-write", approval: "ask" });
	});
	await win.evaluate(async () => {
		await globalThis.kami.auditClear();
	});

	const r = await askModelToRun(promptText);

	// 关键断言：审计里留下「沙箱不可用 ⇒ 拦下」的痕迹。
	// 用审计而不是模型复述 —— 拒绝对不对是**产品行为**，不该依赖弱模型转述准确。
	const audit = await win.evaluate(async () => {
		const a = await globalThis.kami.auditList("sandbox");
		return (a?.records ?? []).map((x) => ({ outcome: x.outcome, detail: String(x.detail ?? "").slice(0, 120) }));
	});

	if (process.platform !== "win32") {
		assert.ok(
			audit.some((x) => x.outcome === "blocked"),
			`本机没有命令沙箱，默认档下命令应被拦下并写审计，实际审计: ${JSON.stringify(audit).slice(0, 250)}`,
		);
		console.log(`      审计: ${JSON.stringify(audit.find((x) => x.outcome === "blocked"))?.slice(0, 160)}`);
	} else {
		// Windows 上有沙箱，这条不适用；直接执行应成功
		console.log("      （Windows 上有沙箱，跳过拒绝断言）");
	}
	void r;
});

// ── B. 完全访问档：命令真的跑起来（功能性质）────────────────

await check("完全访问档下：命令真的执行，输出回传到模型回复", async () => {
	const beforeStat = await win.evaluate(async () => {
		const a = await globalThis.kami.auditList("sandbox");
		const recs = a?.records ?? [];
		return { n: recs.length, blocked: recs.filter((x) => x.outcome === "blocked").length };
	});
	const before = beforeStat.n;
	const beforeBlocked = beforeStat.blocked;

	await win.evaluate(async ({ ws }) => {
		await globalThis.kami.setPermissions({ sandbox: "danger-full-access", approval: "ask" });
		// ⚠️ 必须开新会话：上一轮里模型已经收到了「命令被拒」的结果，它在同一个会话里
		// 会一直纠结「要不要提权重试」，而不是重新执行。清空上下文才是干净的重试。
		await globalThis.kami.newTask(ws);
	}, { ws: WORKSPACE_DIR });

	// 提示词**点名命令**：不留给模型「该跑哪条」的决策空间。
	// 弱模型在开放式指令下常常反复权衡（实测：它会纠结「要不要再试一次」而始终不动手），
	// 而我们这条用例要验的是**执行链路**，不是模型的决策能力。
	const explicit = `现在权限档是「允许完全访问」，可以直接执行命令。请调用 powershell 工具执行这一条命令：echo ${MARK} —— 然后用一句话告诉我它的实际输出。`;
	let r = await askModelToRun(explicit);
	if (!r.found && !r.timedOut) {
		// 模型抖动（第一轮没动手）时再催一次；只重试一次，避免把抖动当成常态
		r = await askModelToRun(`请现在就调用 powershell 工具执行：echo ${MARK}。只做这一件事。`);
	}
	assert.ok(!r.timedOut, "命令执行挂起");
	assert.ok(r.found, `标记 ${MARK} 未出现在回复里 —— 命令没跑通或输出没回传。回复尾部: ${String(r.text).slice(-240)}`);

	// 这一档不该**再新增**「被拦下」的审计（A 那条 blocked 记录本来就还在，
	// 所以看的是增量而不是绝对条数 —— 起初按绝对值断言，假失败了一次）
	const after = await win.evaluate(async () => {
		const a = await globalThis.kami.auditList("sandbox");
		return {
			n: (a?.records ?? []).length,
			blocked: (a?.records ?? []).filter((x) => x.outcome === "blocked").length,
		};
	});
	assert.equal(after.blocked, beforeBlocked, `完全访问档下不该新增「被拦下」记录（前 ${beforeBlocked} → 后 ${after.blocked}）`);
	console.log(`      回复尾部: ${String(r.text).replace(/\s+/g, " ").slice(-140)}（审计 ${before} → ${after.n} 条）`);
});

await check("命令执行：受限档下绝不静默执行（要么走审批、要么被拦下）", async () => {
	// ⚠️ 这条断言的是**可移植的安全性质**，不是「一定有权限弹窗」。
	// 档位与审批的关系（见 command-exec.js:295 与 createSandboxedRunner 的分支顺序）：
	//   - `danger-full-access` → 判定直接 `{kind:"allow"}`，**按设计不问**
	//     （该档的语义就是「用户已明示授权、无约束」）；
	//   - 受限档 → 本机沙箱不可用，**在审批之前就拒了**，所以也不会问。
	// 于是「必须有弹窗」在本机永远不成立 —— 起初就是这么写的，假失败了一次。
	// 真正该守的是：受限档下命令**不得静默跑掉** —— 要么有审批请求，要么审计里有拦截记录。
	const perm = await win.evaluate(() => ({ log: globalThis.__zwPermLog ?? [] }));
	const audit = await win.evaluate(async () => {
		const a = await globalThis.kami.auditList("sandbox");
		return (a?.records ?? []).map((x) => x.outcome);
	});
	const asked = perm.log.some((x) => x.toolName === "powershell");
	const blocked = audit.includes("blocked");
	assert.ok(asked || blocked, `受限档下命令既没走审批、也没被拦下 —— 静默执行了？审批: ${JSON.stringify(perm.log).slice(0, 160)}`);
	console.log(`      审批请求 ${perm.log.length} 次（含 powershell: ${asked}）；审计里被拦下: ${blocked}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 命令执行链路测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);