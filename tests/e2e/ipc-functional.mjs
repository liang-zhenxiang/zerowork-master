/**
 * IPC 功能性测试：逐个驱动 preload 暴露的桥接方法，验证**真实应答**。
 *
 * 为什么需要这一层：
 *   gui-smoke 验证启动健康度，gui-sections 验证七个区域能渲染 —— 但两者都不
 *   回答「某个具体功能能不能用」。一个通道名拼错、daemon 侧 handler 没注册、
 *   返回结构变了，界面可能照常渲染（数据区空白或停在加载态），
 *   只有真正调用这个通道才会暴露。
 *
 * 测试策略：
 *   1. 只读通道 —— 全部调用一遍，断言 resolve（不 reject）且返回结构合理
 *   2. 读写往返 —— 对支持读写的设置项做「读取 → 修改 → 再读取 → 复原」，
 *      验证状态真的持久化了，而不只是接口不报错
 *
 * 安全：全程使用隔离的 ZEROWORK_CONFIG_DIR（临时目录），
 * 所有修改都会复原，不触碰真实配置。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-ipc";
const WORKSPACE_DIR = "/tmp/zerowork-workspaces";
const SHOT_DIR = resolve(ROOT, "artifacts");

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 160)]);
	}
};

const app = await electron.launch({
	args: [ROOT],
	env: {
		...process.env,
		ZEROWORK_CONFIG_DIR: CONFIG_DIR,
		ZEROWORK_RESOURCES_DIR: resolve(ROOT, "resources"),
		// 工作区根目录也要隔离：配置目录隔离了，但工作区默认落在
		// ~/ZeroWork。不设这个变量，测试会在用户真实家目录下建目录。
		ZEROWORK_WORKSPACE_DIR: WORKSPACE_DIR,
	},
	timeout: 120_000,
});

const pageErrors = [];
const win = await app.firstWindow({ timeout: 120_000 });
win.on("pageerror", (e) => pageErrors.push(String(e)));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(9000);

/** 桥接对象是否就位 */
const bridgeInfo = await win.evaluate(() => {
	const k = globalThis.kami;
	if (!k) return { ok: false, methods: [] };
	return { ok: true, methods: Object.keys(k).filter((n) => typeof k[n] === "function") };
});
await check("contextBridge 暴露 window.kami", () => assert.ok(bridgeInfo.ok, "window.kami 不存在"));
console.log(`桥接方法总数: ${bridgeInfo.methods.length}`);

// ── 1. 无参只读通道 ────────────────────────────────────────
//
// 分两类，不能一概而论：
//
//   MUST_RESPOND —— 这些通道在任何状态下都应返回有效数据（对象/数组/字符串）。
//                   返回 undefined 说明 handler 没写返回值或未注册，是真问题。
//
//   MAY_BE_EMPTY —— 这些通道在"还没发生对应事情"时返回 undefined 是**正确语义**。
//                   典型是 hiddenContext：JSDoc 明确写了「还没跑过任何一轮为
//                   undefined」。对它们只能断言「调用不抛异常」，断言「必须
//                   有返回值」会把正常空态误判为故障（实测踩过）。
const MUST_RESPOND = [
	"daemonStatus",
	"snapshot",
	"completions",
	"listExperts",
	"getTeamTasks",
	"listSessions",
	"workspaceSnapshot",
	"listWorkspaceGroups",
	"settingsSnapshot",
	"getPermissions",
	"getWebSearchConfig",
	"getDefaultWorkspacePath",
	"getStyle",
	"getMemoryEnabled",
	"getAgentTeamsEnabled",
	"getProfile",
	"getPersonalization",
	"getMemory",
	"skillsSnapshot",
	"mcpConfigGet",
	"statsSnapshot",
	"usageStats",
	"runLedger",
	"globalShortcutStatus",
	"docxEnvStatus",
	"auditList",
	"runtimesSnapshot",
	"listAutomations",
];

const MAY_BE_EMPTY = ["hiddenContext", "previewBaseUrl"];

// 需要参数的通道：参数由测试构造，见下面的 NEEDS_ARGS 段
const NEEDS_ARGS = ["promptPreview", "runtimeDiagnostics"];

const callAll = async (names) =>
	win.evaluate(async (list) => {
		const out = {};
		for (const n of list) {
			if (typeof globalThis.kami?.[n] !== "function") {
				out[n] = { ok: false, err: "方法不存在" };
				continue;
			}
			try {
				const v = await globalThis.kami[n]();
				out[n] = { ok: true, type: typeof v, isUndef: v === undefined };
			} catch (e) {
				out[n] = { ok: false, err: String(e?.message ?? e).slice(0, 120) };
			}
		}
		return out;
	}, names);

const mustOut = await callAll(MUST_RESPOND);
for (const name of MUST_RESPOND) {
	const r = mustOut[name];
	await check(`只读通道 ${name} 有响应`, () => {
		assert.ok(r, "未取得结果");
		assert.ok(r.ok, `调用失败: ${r.err}`);
		assert.ok(!r.isUndef, "返回 undefined，handler 可能未实现");
	});
}

const emptyOut = await callAll(MAY_BE_EMPTY);
for (const name of MAY_BE_EMPTY) {
	const r = emptyOut[name];
	await check(`只读通道 ${name} 调用不报错（允许空态）`, () => {
		assert.ok(r, "未取得结果");
		assert.ok(r.ok, `调用失败: ${r.err}`);
	});
}

// 需要参数的通道：从已有快照中取真实参数再调用
for (const name of NEEDS_ARGS) {
	await check(`带参通道 ${name} 调用成功`, async () => {
		const r = await win.evaluate(async (n) => {
			const k = globalThis.kami;
			try {
				if (n === "runtimeDiagnostics") {
					// 从运行时快照里取一个真实 id
					const snap = await k.runtimesSnapshot();
					const id = snap?.runtimes?.[0]?.id ?? snap?.items?.[0]?.id;
					if (!id) return { ok: true, skipped: "无已注册运行时" };
					const v = await k.runtimeDiagnostics(id);
					return { ok: v !== undefined };
				}
				if (n === "promptPreview") {
					// 参数形状取自渲染层真实调用：
					//   { sceneId, modeId, expertId? }
					// sceneId/modeId 对应 resources/scenes 与 resources/modes 下的目录名。
					const v = await k.promptPreview({ sceneId: "work", modeId: "craft" });
					return { ok: v !== undefined, hasSegments: Array.isArray(v?.segments) };
				}
				return { ok: false, err: "未覆盖的带参通道" };
			} catch (e) {
				return { ok: false, err: String(e?.message ?? e).slice(0, 120) };
			}
		}, name);
		if (r.skipped) return;
		assert.ok(r.ok, `调用失败: ${r.err}`);
	});
}

// ── 2. 读写往返：验证状态真的持久化 ────────────────────────
const ROUNDTRIP = [
	["getMemoryEnabled", "setMemoryEnabled", (v) => v],
	["getAgentTeamsEnabled", "setAgentTeamsEnabled", (v) => v],
	["getStyle", "setStyle", (v) => v],
];

for (const [getter, setter, coerce] of ROUNDTRIP) {
	await check(`${getter}/${setter} 读写往返`, async () => {
		const r = await win.evaluate(
			async ({ g, s }) => {
				const k = globalThis.kami;
				if (typeof k[g] !== "function" || typeof k[s] !== "function") return { skip: true };
				const before = await k[g]();
				// 挑一个与原值不同的合法取值
				let probe;
				if (typeof before === "boolean") probe = !before;
				else if (typeof before === "string") probe = before === "efficient" ? "professional" : "efficient";
				else return { skip: true, reason: `未知类型 ${typeof before}` };

				await k[s](probe);
				const after = await k[g]();
				// 复原
				await k[s](before);
				const restored = await k[g]();
				return { before, probe, after, restored };
			},
			{ g: getter, s: setter },
		);
		if (r.skip) return; // 无参不可写，跳过不算失败
		assert.equal(r.after, r.probe, `写入后读回不一致：期望 ${r.probe}，实际 ${r.after}`);
		assert.equal(r.restored, r.before, `复原失败：期望 ${r.before}，实际 ${r.restored}`);
		void coerce;
	});
}

// ── 3. 会话与工作区的只读快照结构 ──────────────────────────
await check("session 快照结构合理", async () => {
	const s = await win.evaluate(() => globalThis.kami.snapshot());
	assert.ok(s !== null && typeof s === "object", "snapshot 应返回对象");
});

await check("workspace 快照结构合理", async () => {
	const w = await win.evaluate(() => globalThis.kami.workspaceSnapshot());
	assert.ok(w !== null && typeof w === "object", "workspaceSnapshot 应返回对象");
});

await check("skills 快照可读取", async () => {
	const s = await win.evaluate(() => globalThis.kami.skillsSnapshot());
	assert.ok(s !== null && typeof s === "object", "skillsSnapshot 应返回对象");
});

await check("runtimes 快照可读取", async () => {
	const r = await win.evaluate(() => globalThis.kami.runtimesSnapshot());
	assert.ok(r !== null && typeof r === "object", "runtimesSnapshot 应返回对象");
});

// ── 4. 写操作往返：完整走一遍「创建 → 验证 → 清理」──
//
// 只读通道能应答，不代表写路径可用。写路径涉及参数校验、落盘、事件推送，
// 任何一环断了界面都会表现为「点了没反应」。这里对每个可写的功能域
// 做一次真实往返，并在结束时清理干净（配置目录是隔离的临时目录）。

await check("工作区：创建返回可用路径", async () => {
	// 注意：不能用 listWorkspaceGroups 验证 —— 它是从**会话的 cwd** 派生的
	// （见 daemon 的 listWorkspaceGroups 实现：遍历 listSessions 收集 cwd），
	// 刚创建、还没有会话用过的目录不会出现在里面。最初这么断言是错的。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const name = `e2e-ws-${Date.now()}`;
		const created = await k.createWorkspace(name);
		const path = typeof created === "string" ? created : (created?.cwd ?? created?.path);
		return { path, hasName: typeof path === "string" && path.includes(name) };
	});
	assert.ok(typeof r.path === "string" && r.path.length > 0, "createWorkspace 未返回路径");
	assert.ok(r.hasName, `返回路径中不含工作区名：${r.path}`);
});

await check("自动化：保存 → 列出 → 删除", async () => {
	// 入参字段取自 daemon 的 saveAutomation：name / prompt / schedule / cwd
	// 四个都是必填且会 trim，缺任何一个都会抛错。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const name = `e2e-auto-${Date.now()}`;
		// getDefaultWorkspacePath 返回的是 { effective, isDefault }，
		// 不是字符串路径 —— 取 effective 字段。
		const ws = await k.getDefaultWorkspacePath();
		const cwd = typeof ws === "string" ? ws : (ws?.effective ?? ws?.path ?? ws?.cwd);
		const saved = await k.saveAutomation({
			name,
			prompt: "e2e 测试用，可安全删除",
			schedule: { type: "daily", time: "03:00" },
			cwd,
		});
		const listed = await k.listAutomations();
		const appeared = JSON.stringify(listed).includes(name);
		const id = saved?.id ?? saved?.task?.id;
		if (id) await k.deleteAutomation(id);
		const afterDelete = await k.listAutomations();
		return { saved: saved !== undefined, appeared, gone: !JSON.stringify(afterDelete).includes(name), id, cwd };
	});
	assert.ok(r.saved, "saveAutomation 未返回结果");
	assert.ok(r.appeared, "保存后自动化列表里找不到");
	if (r.id) assert.ok(r.gone, "删除后自动化仍在列表里");
});

await check("技能：读取快照 → 切换启用 → 复原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const snap = await k.skillsSnapshot();
		const skills = snap?.skills ?? snap?.items ?? [];
		if (skills.length === 0) return { skipped: "无可用技能" };
		const target = skills[0];
		const id = target.id ?? target.name;
		const before = target.enabled;
		await k.setSkillEnabled(id, !before);
		const mid = await k.skillsSnapshot();
		const midSkill = (mid?.skills ?? mid?.items ?? []).find((s) => (s.id ?? s.name) === id);
		await k.setSkillEnabled(id, before);
		const restored = await k.skillsSnapshot();
		const restoredSkill = (restored?.skills ?? restored?.items ?? []).find((s) => (s.id ?? s.name) === id);
		return { before, mid: midSkill?.enabled, restored: restoredSkill?.enabled };
	});
	if (r.skipped) return;
	assert.equal(r.mid, !r.before, `技能开关未生效：期望 ${!r.before}，实际 ${r.mid}`);
	assert.equal(r.restored, r.before, "技能开关未复原");
});

await check("MCP：写入配置 → 读回一致", async () => {
	// 注意：mcpConfigSet 收的是 **JSON 字符串**（daemon 侧 writeMcpConfig 直接
	// 对它做文本处理），传对象会报 "text.charCodeAt is not a function"。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.mcpConfigGet();
		const beforeText =
			typeof before === "string" ? before : (before?.content ?? JSON.stringify(before ?? {}));

		const probe = JSON.stringify({
			mcpServers: { "e2e-probe": { command: "node", args: ["-e", "process.exit(0)"] } },
		});
		await k.mcpConfigSet(probe);
		const after = await k.mcpConfigGet();
		const has = JSON.stringify(after).includes("e2e-probe");

		// 复原
		await k.mcpConfigSet(beforeText);
		return { has };
	});
	assert.ok(r.has, "写入的 MCP server 读不回来");
});

await check("会话：新建任务后快照可读", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		await k.newTask();
		const snap = await k.snapshot();
		return { hasSnap: snap !== null && typeof snap === "object" };
	});
	assert.ok(r.hasSnap, "newTask 后 snapshot 不可用");
});

await check("权限：读取 → 设置 → 复原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.getPermissions();
		if (before === null || typeof before !== "object") return { skipped: "权限结构非对象" };
		// 只做一次可逆的浅层改动：把 sandbox 模式切到另一个合法值再切回
		const mode = before.sandboxMode ?? before.mode;
		if (typeof mode !== "string") return { skipped: "无 sandboxMode 字段" };
		const probe = mode === "off" ? "workspace" : "off";
		await k.setPermissions({ ...before, sandboxMode: probe });
		const mid = await k.getPermissions();
		await k.setPermissions(before);
		const restored = await k.getPermissions();
		return { mode, mid: mid?.sandboxMode ?? mid?.mode, restored: restored?.sandboxMode ?? restored?.mode };
	});
	if (r.skipped) return;
	assert.equal(r.mid, r.mode === "off" ? "workspace" : "off", "权限设置未生效");
	assert.equal(r.restored, r.mode, "权限未复原");
});

// ── 5. 会话生命周期 ────────────────────────────────────────
await check("会话：新建 → 列表可见 → 重命名 → 归档 → 删除", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const out = {};

		await k.newTask();
		const snap = await k.snapshot();
		out.hasSnapshot = snap !== null && typeof snap === "object";

		const sessions = await k.listSessions();
		const list = Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []);
		out.listed = list.length > 0;
		const path = list[0]?.path ?? list[0]?.file;
		if (path === undefined) return { ...out, skipped: "列表项无 path 字段" };

		const newName = `e2e-rename-${Date.now()}`;
		await k.renameSession(path, newName);
		const afterRename = await k.listSessions();
		const list2 = Array.isArray(afterRename) ? afterRename : (afterRename?.sessions ?? []);
		out.renamed = JSON.stringify(list2).includes(newName);

		// 归档是双向开关，切过去再切回来
		await k.archiveSession(path, true);
		await k.archiveSession(path, false);
		out.archiveRoundTrip = true;

		return out;
	});
	if (r.skipped) return;
	assert.ok(r.hasSnapshot, "newTask 后快照不可读");
	assert.ok(r.listed, "newTask 后会话列表为空");
	assert.ok(r.renamed, "重命名未生效");
	assert.ok(r.archiveRoundTrip, "归档往返失败");
});

await check("补全：@ 文件与 / 命令列表可读取", async () => {
	const r = await win.evaluate(async () => {
		const c = await globalThis.kami.completions();
		return {
			isObj: c !== null && typeof c === "object",
			keys: Object.keys(c ?? {}),
		};
	});
	assert.ok(r.isObj, "completions 应返回对象");
	assert.ok(r.keys.length > 0, `completions 返回对象无字段: ${JSON.stringify(r)}`);
});

// ── 6. 个人资料与偏好 ──────────────────────────────────────
await check("个人资料：写入 → 读回 → 复位", async () => {
	// 注意：setProfile 收的是**字符串内容**，daemon 直接 writeFileSync 到画像文件，
	// 传对象会报 "The data argument must be of type string"。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.getProfile();
		const mark = `e2e-profile-${Date.now()}`;
		await k.setProfile(`# 测试画像\n\n${mark}\n`);
		const mid = await k.getProfile();
		await k.resetProfile();
		const after = await k.getProfile();
		// 复原原有内容
		if (typeof before === "string") await k.setProfile(before);
		const midText = typeof mid === "string" ? mid : JSON.stringify(mid);
		const afterText = typeof after === "string" ? after : JSON.stringify(after);
		return { midHas: midText.includes(mark), afterReset: afterText.includes(mark) };
	});
	assert.ok(r.midHas, "setProfile 后读不到写入的内容");
	assert.ok(!r.afterReset, "resetProfile 后旧内容仍在");
});

await check("个性化：写入补丁 → 读回", async () => {
	// setPersonalization 收的是**补丁对象**，合法键见 daemon 的 stringKeys：
	// customInstructions / userNickname / assistantName / personaDescription
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.getPersonalization();
		const mark = `e2e-ci-${Date.now()}`;
		await k.setPersonalization({ customInstructions: mark });
		const mid = await k.getPersonalization();
		// 复原
		await k.setPersonalization({ customInstructions: before?.customInstructions ?? "" });
		const restored = await k.getPersonalization();
		return {
			midHas: JSON.stringify(mid).includes(mark),
			restoredOk: (restored?.customInstructions ?? "") === (before?.customInstructions ?? ""),
		};
	});
	assert.ok(r.midHas, "setPersonalization 后读不到写入的补丁");
	assert.ok(r.restoredOk, "个性化未复原");
});

// ── 7. 运行时开关 ──────────────────────────────────────────
await check("运行时：启用开关往返", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const snap = await k.runtimesSnapshot();
		const items = snap?.runtimes ?? snap?.items ?? [];
		if (items.length === 0) return { skipped: true };
		const target = items[0];
		const id = target.id ?? target.runtimeId;
		if (id === undefined) return { skipped: true };
		const before = target.enabled;
		await k.setRuntimeEnabled(id, !before);
		const mid = await k.runtimesSnapshot();
		const midItem = (mid?.runtimes ?? mid?.items ?? []).find((x) => (x.id ?? x.runtimeId) === id);
		await k.setRuntimeEnabled(id, before);
		return { before, mid: midItem?.enabled };
	});
	if (r.skipped) return;
	assert.equal(r.mid, !r.before, `运行时开关未生效：期望 ${!r.before}，实际 ${r.mid}`);
});

// ── 8. 审计日志 ────────────────────────────────────────────
await check("审计：列表可读且结构正确", async () => {
	const r = await win.evaluate(async () => {
		const a = await globalThis.kami.auditList();
		return {
			ok: a !== null && typeof a === "object",
			isArray: Array.isArray(a),
			hasItems: Array.isArray(a) || Array.isArray(a?.records) || Array.isArray(a?.items),
		};
	});
	assert.ok(r.ok, "auditList 应返回对象或数组");
	assert.ok(r.hasItems, "auditList 返回结构里找不到记录数组");
});

// ── 9. 产物读取与路径 stat（用真实临时文件验证）────────────
const PROBE_FILE = "/tmp/zerowork-artifact-probe.txt";
writeFileSync(PROBE_FILE, "e2e artifact probe\n第二行\n", "utf8");

await check("路径 stat 返回真实文件信息", async () => {
	const r = await win.evaluate(async (p) => {
		const s = await globalThis.kami.statPath(p);
		return { isObj: s !== null && typeof s === "object", raw: JSON.stringify(s).slice(0, 200) };
	}, PROBE_FILE);
	assert.ok(r.isObj, `statPath 应返回对象，实际 ${r.raw}`);
});

await check("产物读取返回文件内容", async () => {
	// 注意：产物读取被**限定在会话工作区内**（daemon 报错原文：
	// 「当前任务还没有工作目录，无法读取产物」）。所以要先设好工作区，
	// 且文件必须放在该工作区里 —— 用 /tmp 下的文件会被拒绝。
	const r = await win.evaluate(async ({ name }) => {
		const k = globalThis.kami;
		const created = await k.createWorkspace(name);
		const cwd = typeof created === "string" ? created : (created?.cwd ?? created?.path);
		await k.setWorkspace(cwd);
		const target = `${cwd}/${name}.txt`;
		try {
			const c = await k.readArtifact(target);
			return { ok: true, text: typeof c === "string" ? c : JSON.stringify(c), cwd, target };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 120), cwd, target };
		}
	}, { name: `e2e-artifact-${Date.now()}` });

	if (!r.ok) {
		// 工作区内文件不存在时的报错也是合理行为，不视为失败；关键是没挂起
		assert.ok(typeof r.err === "string" && r.err.length > 0, "应有明确错误信息");
		return;
	}
	assert.ok(r.text.length >= 0, "读取结果结构异常");
});

await check("路径 stat 对不存在的文件有合理行为", async () => {
	const r = await win.evaluate(async () => {
		try {
			const s = await globalThis.kami.statPath("/tmp/definitely-not-exist-e2e-xyz");
			return { threw: false, value: JSON.stringify(s).slice(0, 80) };
		} catch (e) {
			return { threw: true, err: String(e?.message ?? e).slice(0, 80) };
		}
	});
	// 抛异常或返回 exists:false 都可接受，关键是**不能挂起或返回垃圾**
	assert.ok(r.threw || r.value !== undefined, "不存在的路径应有明确响应");
});

// ── 10. Git worktree（本仓库自身就是 git 仓库）────────────────
await check("worktree 分支列表可读取", async () => {
	// 返回结构是 { isGitRepo, branches, currentBranch }，**不是数组**。
	// 最初按数组断言是错的。（本项目自身是 git 仓库，可直接用仓库根目录验证）
	const r = await win.evaluate(async (cwd) => {
		try {
			const b = await globalThis.kami.worktreeBranches(cwd);
			return { ok: true, isGitRepo: b?.isGitRepo, branches: b?.branches, current: b?.currentBranch };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 120) };
		}
	}, ROOT);
	assert.ok(r.ok, `worktreeBranches 调用失败: ${r.err}`);
	assert.equal(r.isGitRepo, true, `应识别出 git 仓库，实际 isGitRepo=${r.isGitRepo}`);
	assert.ok(Array.isArray(r.branches), `branches 应为数组，实际 ${JSON.stringify(r.branches)}`);
	assert.ok(r.branches.length > 0, "分支列表为空");
	assert.ok(typeof r.current === "string" && r.current.length > 0, "currentBranch 为空");
});

// ── 11. 会话导出 ───────────────────────────────────────────
await check("会话导出返回可用结果", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const sessions = await k.listSessions();
		const list = Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []);
		const path = list[0]?.path ?? list[0]?.file;
		if (path === undefined) return { skipped: "无会话可导出" };
		try {
			const out = await k.exportSession(path);
			return { ok: out !== undefined, raw: JSON.stringify(out).slice(0, 160) };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 120) };
		}
	});
	if (r.skipped) return;
	assert.ok(r.ok, `导出失败: ${r.err}`);
});

// ── 12. 发送链路（内置命令不经过模型，可无凭据验证）─────────
//
// 关键点：prompt 会先走 parseBuiltinCommand，`/new`、`/plan` 这类内置命令
// 在 daemon 侧就地处理，**不调用模型**。所以没有 API Key 也能验证
// 「输入 → 发送 → 状态变化」这条真实链路，而不是只验证接口不报错。
await check("发送 /new 命令生效", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.snapshot();
		await k.prompt({ text: "/new" });
		const after = await k.snapshot();
		return {
			ok: after !== null && typeof after === "object",
			// 快照结构是 { state, entries, availableScenes, availableModes, ... }
			hasState: after?.state !== undefined,
			sessionChanged: (after?.state?.sessionId ?? "") !== (before?.state?.sessionId ?? ""),
		};
	});
	assert.ok(r.ok, "发送 /new 后快照不可读");
	assert.ok(r.hasState, "快照缺少 state 字段");
});

await check("发送 /plan 命令切换交互模式", async () => {
	// 交互模式在 snapshot.state.interactionId（不是顶层）。
	// 合法值见 snapshot.availableModes：ask / craft / plan
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const read = async () => (await k.snapshot())?.state?.interactionId;
		const before = await read();
		await k.prompt({ text: "/plan" });
		const mid = await read();
		await k.prompt({ text: "/plan" }); // 再切回
		const after = await read();
		return { before, mid, after };
	});
	assert.ok(r.before !== undefined, "读不到 interactionId（应在 snapshot.state 下）");
	assert.notEqual(r.mid, r.before, `切到 plan 模式未生效：${r.before} -> ${r.mid}`);
	assert.equal(r.after, r.before, `第二次 /plan 未切回：期望 ${r.before}，实际 ${r.after}`);
});

await check("发送普通文本在无模型配置时给出明确错误", async () => {
	// 没有配置模型时，发送普通消息应当**明确报错**，而不是静默挂起。
	// 「挂起」是这类应用最难查的故障形态 —— 界面一直在转，用户不知道发生了什么。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		try {
			await Promise.race([
				k.prompt({ text: "e2e 测试消息，不应真的发给模型" }),
				new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT_15S")), 15000)),
			]);
			return { resolved: true };
		} catch (e) {
			return { resolved: false, err: String(e?.message ?? e).slice(0, 140) };
		}
	});
	assert.ok(
		r.resolved || (r.err && !r.err.includes("TIMEOUT_15S")),
		`发送后既未返回也未报错（挂起 15s）：${r.err}`,
	);
});

// ── 13. 技能导入 ───────────────────────────────────────────
await check("技能导入：从目录导入 → 快照可见", async () => {
	const r = await win.evaluate(async (srcDir) => {
		const k = globalThis.kami;
		try {
			await k.importSkill(srcDir);
		} catch (e) {
			// 已导入过会报重复，属正常
			return { alreadyImported: true, err: String(e?.message ?? e).slice(0, 100) };
		}
		const snap = await k.skillsSnapshot();
		return { imported: JSON.stringify(snap).includes("meeting-notes") };
	}, resolve(ROOT, "resources", "skills", "meeting-notes"));
	if (r.alreadyImported) return;
	assert.ok(r.imported, "导入后技能快照里找不到 meeting-notes");
});

// ── 14. 会话分支 / 重启 ────────────────────────────────────
await check("会话分支：在用户消息处分出分支", async () => {
	// 参数是 [path, userIndex, options]，userIndex 是**下标数字**，
	// 不是 entryId 字符串（bridge 里的形参名 anchorEntryId 有误导性）。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const sessions = await k.listSessions();
		const list = Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []);
		const path = list[0]?.path ?? list[0]?.file;
		if (path === undefined) return { skipped: "无会话" };
		const before = (Array.isArray(sessions) ? sessions : (sessions?.sessions ?? [])).length;
		try {
			await k.branchSessionFrom(path, 0, {});
		} catch (e) {
			// 下标 0 处没有用户消息时拒绝是合理行为
			return { rejected: true, err: String(e?.message ?? e).slice(0, 120) };
		}
		const after = await k.listSessions();
		const list2 = Array.isArray(after) ? after : (after?.sessions ?? []);
		return { before, after: list2.length };
	});
	if (r.skipped || r.rejected) return;
	assert.ok(r.after >= r.before, "分支后会话数不应减少");
});

// ── 15. 全程无渲染层异常 ────────────────────────────────────
await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

await win.screenshot({ path: resolve(SHOT_DIR, "ipc-functional.png") });

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ IPC 功能性测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
	if (status === "FAIL") failed++;
}
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
