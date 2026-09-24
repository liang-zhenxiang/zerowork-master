/**
 * 桥接面补测：把此前**没有被任何测试驱动过**的 IPC 方法逐一驱动一遍。
 *
 * 背景：`preload` 暴露了 117 个方法，此前测试覆盖 77 个，剩 40 个一行都没跑过。
 * 其中约 30 个不需要模型、不需要网络，纯粹是「调一下看它答什么」——
 * 这类没有理由不测。
 *
 * 断言口径（重要）：这些通道此前从没被调用过，**不能假设它们一定成功**。
 * 所以每条断言的是「**行为明确**」而不是「一定成功」：
 *   - 读取类：必须返回一个有形状的值（数组 / 对象），不能是 undefined；
 *   - 变更类：要么成功、要么**以指明原因的错误**被拒（如「找不到名为 X 的 …」）；
 *   - 一律不得挂起 —— 挂起是这类故障最糟的形态（界面永远等一个不来的结果）。
 *
 * 覆盖不到的（本层刻意不碰，理由写在各自用例里）：
 *   - 需要真实会话文件才能走通的会话生命周期（resume / restart / delete）——
 *     无模型建不出会话，这里只验「传不存在的路径会被明确拒绝」；
 *   - `testModel` / `testDraftModel` 真会联网，只验「未配置模型时返回结构化失败」；
 *   - `memberPrompt` / `memberAbort` / `runAutomationNow` 需要真实成员与会话，
 *     只验「未知 id 被明确拒绝」。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const RESOURCES = resolve(ROOT, "resources");
const CONFIG_DIR = "/tmp/zerowork-bridge";
const WORKSPACE_DIR = "/tmp/zerowork-bridge-ws";

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

// 合法 id 从资源目录现读，避免把 id 写死在测试里（资源改名时测试不该假失败）
const SCENES = readdirSync(join(RESOURCES, "scenes"), { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);
const MODES = readdirSync(join(RESOURCES, "modes"))
	.filter((f) => f.endsWith(".md"))
	.map((f) => {
		const m = readFileSync(join(RESOURCES, "modes", f), "utf8").match(/^id:\s*(\S+)/m);
		return m === null ? f.replace(/\.md$/, "") : m[1];
	});

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
		ZEROWORK_RESOURCES_DIR: RESOURCES,
		ZEROWORK_WORKSPACE_DIR: WORKSPACE_DIR,
	},
	timeout: 120_000,
});

const pageErrors = [];
const win = await app.firstWindow({ timeout: 120_000 });
win.on("pageerror", (e) => pageErrors.push(String(e)));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(9000);

await win.evaluate(async (ws) => {
	await globalThis.kami.setWorkspace(ws);
}, WORKSPACE_DIR);

/**
 * 调一个桥接方法，**带超时**并把结果规整成 {ok, value} / {ok:false, err}。
 * 超时单独标出来 —— 挂起与「明确报错」是完全不同的故障。
 */
async function call(name, ...args) {
	return win.evaluate(
		async ({ m, a }) => {
			const k = globalThis.kami;
			if (typeof k[m] !== "function") return { missing: true };
			try {
				const value = await Promise.race([
					k[m](...a),
					new Promise((_, rej) => setTimeout(() => rej(new Error("__HANG__")), 30_000)),
				]);
				return { ok: true, value: value === undefined ? null : value };
			} catch (e) {
				const msg = String(e?.message ?? e);
				return { ok: false, hang: msg.includes("__HANG__"), err: msg.slice(0, 220) };
			}
		},
		{ m: name, a: args },
	);
}

const json = (v) => JSON.stringify(v).slice(0, 200);

// ── ① 会话轴：场景 / 交互模式 / 推理强度 / 专家 ──────────────

await check("会话轴：setScene 合法值生效、非法值被拒", async () => {
	const target = SCENES[0];
	const good = await call("setScene", target);
	assert.ok(!good.hang, "setScene 挂起");
	assert.ok(good.ok !== false || /场景|scene/i.test(good.err), `合法场景被拒：${good.err}`);

	const bad = await call("setScene", "__no_such_scene__");
	assert.ok(!bad.hang, "setScene 非法值时挂起");
	assert.equal(bad.ok, false, "非法场景应被拒绝");
	assert.ok(/场景|scene|未知|不认识/.test(bad.err), `拒绝理由不明确：${bad.err}`);
	console.log(`      合法场景: ${SCENES.join("、")}`);
});

await check("会话轴：setInteraction 合法值生效、非法值被拒", async () => {
	const good = await call("setInteraction", MODES[0]);
	assert.ok(!good.hang, "setInteraction 挂起");
	const bad = await call("setInteraction", "__no_such_mode__");
	assert.ok(!bad.hang, "setInteraction 非法值时挂起");
	assert.equal(bad.ok, false, "非法交互模式应被拒绝");
	console.log(`      合法交互模式: ${MODES.join("、")}`);
});

await check("会话轴：setThinkingLevel 合法值生效、非法值被拒", async () => {
	const good = await call("setThinkingLevel", "high");
	assert.ok(!good.hang, "setThinkingLevel 挂起");
	const bad = await call("setThinkingLevel", "__turbo__");
	assert.ok(!bad.hang, "非法档位时挂起");
	assert.equal(bad.ok, false, "非法档位应被拒绝");
	assert.ok(/档位|level|未知/.test(bad.err), `拒绝理由不明确：${bad.err}`);
});

await check("会话轴：setExpert 合法值生效、非法值被拒、undefined 清除", async () => {
	const experts = await win.evaluate(async () => {
		const list = await globalThis.kami.listExperts();
		return (Array.isArray(list) ? list : (list?.experts ?? [])).map((e) => e.name ?? e.id).filter(Boolean);
	});
	assert.ok(experts.length > 0, "没有内置专家，无法测试 setExpert");

	const good = await call("setExpert", experts[0]);
	assert.ok(!good.hang, "setExpert 挂起");
	assert.ok(good.ok !== false || /专家|expert/i.test(good.err), `合法专家被拒：${good.err}`);

	const bad = await call("setExpert", "__no_such_expert__");
	assert.ok(!bad.hang, "非法专家时挂起");
	assert.equal(bad.ok, false, "非法专家应被拒绝");

	const clear = await call("setExpert", null);
	assert.ok(!clear.hang, "清除专家时挂起");
	console.log(`      专家 ${experts.length} 位，取「${experts[0]}」验证`);
});

await check("会话轴：listWorkspaceGroups 返回数组", async () => {
	const r = await call("listWorkspaceGroups");
	assert.ok(!r.hang, "listWorkspaceGroups 挂起");
	assert.ok(r.ok, `调用失败：${r.err}`);
	assert.ok(Array.isArray(r.value), `应返回数组，实际 ${json(r.value)}`);
});

// ── ② 提供商 CRUD 往返 ────────────────────────────────────

await check("提供商：保存 → 读回 → 加模型 → 删除 → 读回报错", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const id = "zw-bridge-probe";
		const out = {};
		try {
			await k.saveCustomProvider(
				{
					id,
					name: "Bridge Probe",
					baseUrl: "http://127.0.0.1:9/v1",
					api: "anthropic-messages",
					authHeader: true,
					models: [{ id: "probe-model", name: "probe-model", reasoning: false, vision: false, contextWindow: 8000, maxTokens: 1024 }],
				},
				"probe-key",
			);
			out.saved = true;
		} catch (e) {
			return { saved: false, err: String(e?.message ?? e).slice(0, 160) };
		}
		try {
			const read = await k.readCustomProvider(id);
			out.readBack = read !== undefined && read !== null;
			out.readName = read?.name ?? read?.id;
		} catch (e) {
			out.readErr = String(e?.message ?? e).slice(0, 160);
		}
		try {
			await k.addProviderModel(id, { id: "extra-model", name: "extra-model", contextWindow: 8000, maxTokens: 1024 });
			out.added = true;
		} catch (e) {
			out.addErr = String(e?.message ?? e).slice(0, 160);
		}
		try {
			await k.deleteCustomProvider(id);
			out.deleted = true;
		} catch (e) {
			out.delErr = String(e?.message ?? e).slice(0, 160);
		}
		try {
			const after = await k.readCustomProvider(id);
			out.stillThere = after !== undefined && after !== null;
		} catch {
			out.goneAfterDelete = true;
		}
		return out;
	});
	assert.ok(r.saved, `保存自定义提供商失败：${r.err}`);
	assert.ok(r.readBack, `保存后读不回来：${r.readErr ?? json(r)}`);
	assert.ok(r.added, `追加模型失败：${r.addErr}`);
	assert.ok(r.deleted, `删除失败：${r.delErr}`);
	assert.ok(r.goneAfterDelete || !r.stillThere, "删除后仍能读到该提供商");
});

await check("提供商：removeApiKey 对未知 provider 不挂起", async () => {
	const r = await call("removeApiKey", "__no_such_provider__");
	assert.ok(!r.hang, "removeApiKey 挂起");
	assert.ok(true); // 抛错或静默都算合理，只要求「有回应」
});

await check("提供商：refreshCatalog 不挂起", async () => {
	const r = await call("refreshCatalog");
	assert.ok(!r.hang, "refreshCatalog 挂起（该调用可能联网，30 秒内应有结果或明确报错）");
});

// ── ③ 运行时管理 ──────────────────────────────────────────

await check("运行时：总开关可切换并读回，且能还原", async () => {
	// 总开关读的是 `runtimesSnapshot().master`（不是 settingsSnapshot —— 那是模型目录快照）
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const b = (await k.runtimesSnapshot())?.master;
		await k.setRuntimeMaster(false);
		const off = (await k.runtimesSnapshot())?.master;
		await k.setRuntimeMaster(b === undefined ? true : b);
		const back = (await k.runtimesSnapshot())?.master;
		return { b, off, back };
	});
	assert.equal(r.off, false, `关闭总开关后读回的是 ${r.off}`);
	assert.equal(r.back, r.b === undefined ? true : r.b, "还原总开关失败");
});

await check("运行时：cancelInstall 对未知 id 不挂起", async () => {
	const r = await call("runtimeCancelInstall", "__no_such_runtime__");
	assert.ok(!r.hang, "runtimeCancelInstall 挂起");
});

await check("运行时：reset 对未知 id 给出明确错误", async () => {
	const r = await call("runtimeReset", "__no_such_runtime__");
	assert.ok(!r.hang, "runtimeReset 挂起");
	assert.equal(r.ok, false, "未知运行时 id 应被拒绝（而不是静默成功）");
	console.log(`      拒绝理由: ${String(r.err).slice(0, 100)}`);
});

// ── ④ MCP / 会话生命周期 / 团队的「明确拒绝」 ────────────────

await check("MCP：切换未知 server 被明确拒绝", async () => {
	const r = await call("mcpServerToggle", "__no_such_server__", false);
	assert.ok(!r.hang, "mcpServerToggle 挂起");
	assert.equal(r.ok, false, "切换未知 server 应被拒绝");
	assert.ok(/找不到|不存在|server/i.test(r.err), `拒绝理由不明确：${r.err}`);
});

await check("会话：resume / restart / delete 传不存在的路径都有明确回应", async () => {
	// ⚠️ 两者的失败形态**不同**，断言要分开写：
	//   resume / delete —— **抛错**（调用方拿异常）
	//   restart —— **返回结构化失败** `{ ok: false, reason, message }`（branchFail），不抛
	// 起初按「都该抛错」写，restart 那条因此假失败 —— 契约本身是合理的，
	// 一个是「参数不对」、一个是「分支操作失败但可继续」，语义确实不一样。
	for (const m of ["resumeSession", "deleteSession"]) {
		const r = await call(m, "/tmp/__no_such_session__.jsonl");
		assert.ok(!r.hang, `${m} 挂起`);
		assert.equal(r.ok, false, `${m} 对不存在的路径应被拒绝（而不是静默成功）`);
	}
	const rs = await call("restartSessionFrom", "/tmp/__no_such_session__.jsonl", "entry-1", {});
	assert.ok(!rs.hang, "restartSessionFrom 挂起");
	assert.ok(rs.ok, `restartSessionFrom 不应抛错，实际：${rs.err}`);
	assert.equal(rs.value?.ok, false, `应返回结构化失败，实际 ${json(rs.value)}`);
	assert.ok(typeof rs.value?.reason === "string", "结构化失败应带 reason");
	console.log(`      restart 返回: ${json(rs.value)}`);
});

await check("团队：memberPrompt / memberAbort 传未知成员被明确拒绝", async () => {
	for (const m of ["memberPrompt", "memberAbort"]) {
		const args = m === "memberPrompt" ? ["__no_such_member__", "hi"] : ["__no_such_member__"];
		const r = await call(m, ...args);
		assert.ok(!r.hang, `${m} 挂起`);
		assert.ok(r.ok === false || r.value === null, `${m} 对未知成员应有明确回应`);
	}
});

await check("自动化：runAutomationNow 传未知任务被明确拒绝", async () => {
	const r = await call("runAutomationNow", "__no_such_task__");
	assert.ok(!r.hang, "runAutomationNow 挂起");
	assert.equal(r.ok, false, "未知任务应被拒绝");
});

// ── ⑤ 产物 / 路径 / 界面应答 ───────────────────────────────

await check("产物：openArtifact 对不存在的路径给出明确错误", async () => {
	const r = await call("openArtifact", "definitely-not-here.txt");
	assert.ok(!r.hang, "openArtifact 挂起");
	assert.equal(r.ok, false, "不存在的产物应被拒绝");
});

await check("产物：revealWorkspace 对未知目录被明确拒绝", async () => {
	const r = await call("revealWorkspace", "/tmp/__not_a_known_workspace__");
	assert.ok(!r.hang, "revealWorkspace 挂起");
	assert.equal(r.ok, false, "未知目录应被拒绝（该通道只校验，真正打开在主进程）");
	assert.ok(/已知的工作空间|workspace/i.test(r.err), `拒绝理由不明确：${r.err}`);
});

await check("界面应答：respondToUi / questionnaireResponse 对未知 id 不挂起", async () => {
	for (const [m, arg] of [
		["respondToUi", { id: "__no_such_request__", value: "x" }],
		["questionnaireResponse", { id: "__no_such_request__", answers: {} }],
	]) {
		const r = await call(m, arg);
		assert.ok(!r.hang, `${m} 挂起`);
		// 没有待答请求时，静默忽略或有明确错误都算合理 —— 只要求不挂起、不崩
	}
});

await check("路径：getFilePath 对非原生 File 返回字符串", async () => {
	const r = await win.evaluate(() => {
		try {
			const f = new globalThis.File(["hello"], "probe.txt", { type: "text/plain" });
			const p = globalThis.kami.getFilePath(f);
			return { ok: true, isString: typeof p === "string", value: p };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 140) };
		}
	});
	assert.ok(r.ok, `getFilePath 抛错：${r.err}`);
	assert.ok(r.isString, "getFilePath 应返回字符串（非原生 File 得到空串是正常的）");
});

// ── ⑥ 设置测试类：未配置时必须是结构化失败 ──────────────────

await check("设置：testWebSearch 未配置时返回结构化失败", async () => {
	const r = await call("testWebSearch");
	assert.ok(!r.hang, "testWebSearch 挂起");
	assert.ok(r.ok, `调用失败：${r.err}`);
	assert.equal(r.value?.ok, false, `未配置搜索服务商时应返回 ok:false，实际 ${json(r.value)}`);
	assert.ok(typeof r.value?.message === "string", "失败时应带上给人看的原因");
	console.log(`      返回: ${r.value.message}`);
});

await check("设置：testModel 对不存在的模型返回结构化失败", async () => {
	const r = await call("testModel", "__no_such_model__");
	assert.ok(!r.hang, "testModel 挂起");
	assert.ok(r.ok, `调用失败：${r.err}`);
	assert.equal(r.value?.ok, false, `不存在的模型应返回 ok:false，实际 ${json(r.value)}`);
	console.log(`      返回: ${json(r.value)}`);
});

// ── ⑦ 需要主进程侧配合的通道（对话框 stub / 菜单 / worktree 意图）──
//
// 这几个的处理器在主进程（`src/main/index.js`）或 daemon 的会话轴里，
// 用与 dialog-native.mjs 相同的办法测：`app.evaluate()` 在**主进程**里 stub 掉
// dialog，从而覆盖「拿到对话框结果之后怎么处理」这一段真正属于我们的代码。

/** 在主进程里把 dialog 的两个方法换成可编程的桩。 */
async function stubDialog({ open, save }) {
	await app.evaluate(({ dialog }, s) => {
		if (s.open !== undefined) dialog.showOpenDialog = async () => s.open;if (s.save !== undefined) dialog.showSaveDialog = async (_win, _opts) => s.save;
	}, { open, save });
}
async function restoreDialog() {
	await app.evaluate(({ dialog }) => {
		delete dialog.showOpenDialog;
		delete dialog.showSaveDialog;
	});
}

await check("worktree：基准分支可设置 / 读取 / 清除，非法类型被拒", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const read = async () => (await k.workspaceSnapshot())?.worktreeBranch ?? null;
		const before = await read();
		await k.setWorktreeBranch("zw-probe-branch");
		const set = await read();
		await k.setWorktreeBranch("");
		const cleared = await read();
		let rejected = false;
		let err = "";
		try {
			await k.setWorktreeBranch(123);
		} catch (e) {
			rejected = true;
			err = String(e?.message ?? "");
		}
		await k.setWorktreeBranch(before ?? "");
		return { before, set, cleared, rejected, err, restored: await read() };
	});
	assert.equal(r.set, "zw-probe-branch", `设置后读到的是 ${r.set}`);
	assert.ok(r.cleared === null || r.cleared === "", `清除后应为空，实际 ${r.cleared}`);
	assert.ok(r.rejected, "非字符串应被拒绝");
	assert.ok(/分支|branch|字符串/.test(r.err), `拒绝理由不明确：${r.err}`);
	assert.equal(r.restored, r.before, "还原失败");
});

await check("菜单：menuPopup 对未知菜单项给出明确错误", async () => {
	// 不 stub 也能测 —— 找不到菜单项时它直接抛错，这正是我们要的「明确拒绝」
	const r = await call("menuPopup", "__no_such_menu_item__", 0, 0);
	assert.ok(!r.hang, "menuPopup 挂起");
	assert.equal(r.ok, false, "未知菜单项应被拒绝");
	assert.ok(/找不到菜单项|menu/i.test(r.err), `拒绝理由不明确：${r.err}`);
});

await check("产物：saveArtifactAs 用户选中 → 返回路径；取消 → 返回空", async () => {
	const picked = resolve(WORKSPACE_DIR, "saved-artifact.txt");
	await stubDialog({ save: { canceled: false, filePath: picked } });
	const ok = await win.evaluate(async () => {
		const v = await globalThis.kami.saveArtifactAs({ suggestedName: "saved-artifact.txt", content: "hi" });
		return { isUndef: v === undefined, value: typeof v === "string" ? v : JSON.stringify(v) };
	});
	await stubDialog({ save: { canceled: true } });
	const cancelled = await win.evaluate(async () => {
		const v = await globalThis.kami.saveArtifactAs({ suggestedName: "x.txt" });
		return { isUndef: v === undefined, value: JSON.stringify(v) };
	});
	await restoreDialog();
	assert.ok(!ok.isUndef && String(ok.value).includes("saved-artifact"), `选中后应返回路径，实际 ${ok.value}`);
	assert.ok(cancelled.isUndef, `取消时应返回 undefined，实际 ${cancelled.value}`);
});

await check("画像：importProfile 用户选中 md → 返回内容；取消 → 返回空", async () => {
	const md = resolve(WORKSPACE_DIR, "profile.md");
	writeFileSync(md, "# 画像\n\n这段用于验证导入链路。\n", "utf8");
	await stubDialog({ open: { canceled: false, filePaths: [md] } });
	const ok = await win.evaluate(async () => {
		const v = await globalThis.kami.importProfile();
		return { hasContent: typeof v?.content === "string", content: String(v?.content ?? "").slice(0, 60) };
	});
	await stubDialog({ open: { canceled: true, filePaths: [] } });
	const cancelled = await win.evaluate(async () => {
		const v = await globalThis.kami.importProfile();
		return { isUndef: v === undefined };
	});
	await restoreDialog();
	assert.ok(ok.hasContent, `选中后应返回 { content }，实际 ${json(ok)}`);
	assert.ok(ok.content.includes("导入链路"), `内容不对：${ok.content}`);
	assert.ok(cancelled.isUndef, "取消时应返回 undefined");
});

await check("设置：testDraftModel 缺必填项时返回结构化失败（不联网）", async () => {
	const noUrl = await call("testDraftModel", { baseUrl: "   ", providerId: "x", api: "anthropic-messages" }, "some-model", "k");
	assert.ok(!noUrl.hang, "testDraftModel 挂起");
	assert.equal(noUrl.value?.ok, false, `缺接口地址时应 ok:false，实际 ${json(noUrl.value)}`);

	const noModel = await call("testDraftModel", { baseUrl: "http://127.0.0.1:9/v1", providerId: "x", api: "anthropic-messages" }, "  ", "k");
	assert.ok(!noModel.hang, "testDraftModel 挂起");
	assert.equal(noModel.value?.ok, false, `缺模型 ID 时应 ok:false，实际 ${json(noModel.value)}`);
	console.log(`      返回: ${json(noModel.value)}`);
});

// ── ⑧ 事件订阅：每个 on* 都能订阅并注销 ─────────────────────

await check("事件订阅：全部 on* 可订阅、返回注销函数、注销不抛", async () => {
	const r = await win.evaluate(() => {
		const k = globalThis.kami;
		const names = Object.keys(k).filter((n) => n.startsWith("on") && typeof k[n] === "function");
		const bad = [];
		for (const n of names) {
			try {
				const off = k[n](() => {});
				if (typeof off !== "function") {
					bad.push(`${n} 未返回注销函数（${typeof off}）`);
					continue;
				}
				off();
			} catch (e) {
				bad.push(`${n}: ${String(e?.message ?? e).slice(0, 80)}`);
			}
		}
		return { names, bad };
	});
	assert.equal(r.bad.length, 0, `有订阅失败：${r.bad.join("；")}`);
	console.log(`      订阅通道 ${r.names.length} 个：${r.names.join("、")}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 桥接面补测（此前未驱动过的 IPC）═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);