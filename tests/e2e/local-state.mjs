/**
 * 本地状态读写端到端测试（**不需要模型**）。
 *
 * 补的是 IPC 通道里此前完全没被驱动过的那一大片。它们有个共同点：
 * **不依赖模型、不依赖网络**，纯粹是「界面写进去 → 落盘 → 读回来」，
 * 因此没有任何理由不测 —— 而它们恰好是用户天天在设置页里点的那些开关。
 *
 * 覆盖范围：
 *   ① 设置往返 —— 风格、推理强度、记忆开关/正文、用户画像、个性化、
 *      权限、Agent 团队、默认工作区路径、Web 搜索配置
 *   ② 工作区管理 —— 创建 / 改名 / 移除 / 快照 / git 分支列表
 *   ③ 会话与统计 —— 会话列表、补全项、隐藏上下文、用量统计、运行台账
 *   ④ 审计 —— 列表 / 导出 / 清空
 *   ⑤ 自动化任务 CRUD —— 保存 / 列表 / 启停 / 删除 / 非法入参拒绝
 *   ⑥ 技能开关往返
 *   ⑦ 诊断与路径接口
 *
 * 断言取向：**往返优先**。「调用了不报错」证明不了任何事 ——
 * 通道名拼对但 handler 写了个空函数，照样不报错。所以设置类一律
 * 「读当前值 → 写新值 → 读回来断言变了 → 还原 → 断言变回去」。
 *
 * ⚠️ 与其余 e2e 一致：`ZEROWORK_CONFIG_DIR` 与 `ZEROWORK_WORKSPACE_DIR`
 *    都指向 /tmp 下的隔离目录。画像 / 记忆 / 偏好这些是**用户真实数据**，
 *    不隔离就会把本机配置写坏。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-localstate";
const WORKSPACE_DIR = "/tmp/zerowork-localstate-ws";

const MARK = "ZW_STATE_MARK_7f3a";

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });
writeFileSync(resolve(WORKSPACE_DIR, "probe.txt"), "zw-local-state\n", "utf8");

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

// 后续多数接口都相对「当前工作区」解析路径，先钉住工作区。
await win.evaluate(async (ws) => {
	await globalThis.kami.setWorkspace(ws);
}, WORKSPACE_DIR);

const json = (v) => JSON.stringify(v);

// ── ① 设置往返 ─────────────────────────────────────────────

await check("设置：回复风格切换后生效并可还原", async () => {
	const styles = await win.evaluate(async () => (await globalThis.kami.getStyle()).styles.map((s) => s.id));
	assert.ok(styles.length >= 2, `可用风格不足 2 种，无法做切换断言：${styles.join(", ")}`);
	const r = await win.evaluate(async (all) => {
		const k = globalThis.kami;
		const before = (await k.getStyle()).styleId;
		// 挑一个**不同于当前**的风格（而非写死某个 id）：资源裁剪后也不会假失败
		const target = all.find((s) => s !== before);
		await k.setStyle(target);
		const after = (await k.getStyle()).styleId;
		await k.setStyle(before);
		const restored = (await k.getStyle()).styleId;
		return { before, target, after, restored };
	}, styles);
	assert.equal(r.after, r.target, `写入 ${r.target} 后读回的是 ${r.after}`);
	assert.equal(r.restored, r.before, `还原失败：期望 ${r.before}，实际 ${r.restored}`);
});

await check("设置：非法风格被拒绝", async () => {
	const r = await win.evaluate(async () => {
		try {
			await globalThis.kami.setStyle("__no_such_style__");
			return { rejected: false };
		} catch (e) {
			return { rejected: true, err: String(e?.message ?? "") };
		}
	});
	assert.ok(r.rejected, "未知风格应被拒绝");
	assert.ok(/风格/.test(r.err), `拒绝理由不明确：${r.err}`);
});

await check("设置：推理强度默认档切换后生效并可还原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = (await k.getThinkingLevelDefault()).level;
		const target = before === "high" ? "low" : "high";
		await k.setThinkingLevelDefault(target);
		const after = (await k.getThinkingLevelDefault()).level;
		await k.setThinkingLevelDefault(before);
		return { before, target, after, restored: (await k.getThinkingLevelDefault()).level };
	});
	assert.equal(r.after, r.target, `写入 ${r.target} 后读回 ${r.after}`);
	assert.equal(r.restored, r.before, "还原失败");
});

await check("设置：非法推理强度档位被拒绝", async () => {
	const r = await win.evaluate(async () => {
		try {
			await globalThis.kami.setThinkingLevelDefault("__turbo__");
			return { rejected: false };
		} catch (e) {
			return { rejected: true, err: String(e?.message ?? "") };
		}
	});
	assert.ok(r.rejected, "未知档位应被拒绝");
});

await check("设置：记忆开关切换后生效并可还原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = (await k.getMemoryEnabled()).enabled;
		await k.setMemoryEnabled(!before);
		const after = (await k.getMemoryEnabled()).enabled;
		await k.setMemoryEnabled(before);
		return { before, after, restored: (await k.getMemoryEnabled()).enabled };
	});
	assert.equal(r.after, !r.before, "记忆开关未翻转");
	assert.equal(r.restored, r.before, "还原失败");
});

await check("记忆：开关联动内置「记忆整理」任务（创建 / 转 paused / 不删除）", async () => {
	// 记忆整理是**内置定时任务**（`builtin: true`）：开启记忆时创建它、关闭时把它转
	// 成 paused（不是删掉 —— 关掉开关不该把用户的自定义改动一起丢掉）。
	// 这条是纯本地状态联动，不需要模型。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const asArray = (v) => (Array.isArray(v) ? v : (v?.tasks ?? []));
		const findBuiltin = async () => asArray(await k.listAutomations()).find((t) => t.builtin === true);

		const before = (await k.getMemoryEnabled()).enabled;
		await k.setMemoryEnabled(true);
		const on = await findBuiltin();
		await k.setMemoryEnabled(false);
		const off = await findBuiltin();
		await k.setMemoryEnabled(before);
		const back = await findBuiltin();
		return {
			on: on === undefined ? null : { name: on.name, status: on.status, hasPrompt: String(on.prompt ?? "").length > 0 },
			off: off === undefined ? null : { name: off.name, status: off.status },
			back: back === undefined ? null : { status: back.status },
			restored: (await k.getMemoryEnabled()).enabled,
		};
	});
	assert.ok(r.on, "开启记忆后没有出现内置任务");
	assert.equal(r.on.status, "active", `开启时内置任务应为 active，实际 ${r.on.status}`);
	assert.ok(r.on.hasPrompt, "内置任务没有提示词 —— 建了个空壳");
	assert.ok(r.off, "关闭记忆后内置任务被删掉了（应保留并转 paused）");
	assert.equal(r.off.status, "paused", `关闭时内置任务应为 paused，实际 ${r.off.status}`);
	assert.equal(r.back?.status, r.on.status, "还原后内置任务状态不对");
	assert.equal(r.restored, r.on.status === "active", "记忆开关未按预期还原");
	console.log(`      内置任务「${r.on.name}」：开启 ${r.on.status} / 关闭 ${r.off.status}`);
});

await check("设置：记忆正文写入后可读回并可还原", async () => {
	const r = await win.evaluate(
		async (mark) => {
			const k = globalThis.kami;
			const before = (await k.getMemory()).content;
			await k.setMemory(`# 记忆\n\n${mark}\n`);
			const after = (await k.getMemory()).content;
			await k.setMemory(before);
			return { beforeLen: before.length, after, restored: (await k.getMemory()).content };
		},
		MARK,
	);
	assert.ok(r.after.includes(MARK), `写入的记忆正文未读回：${r.after.slice(0, 120)}`);
	assert.equal(r.restored.length, r.beforeLen, "还原失败（长度不符）");
});

await check("设置：用户画像写入 → 读回 → 重置 → 变空", async () => {
	const r = await win.evaluate(
		async (mark) => {
			const k = globalThis.kami;
			const before = (await k.getProfile()).content;
			await k.setProfile(`画像：${mark}`);
			const after = (await k.getProfile()).content;
			await k.resetProfile();
			const reset = (await k.getProfile()).content;
			await k.setProfile(before);
			return { before, after, reset, restored: (await k.getProfile()).content };
		},
		MARK,
	);
	assert.ok(r.after.includes(MARK), `画像未读回：${r.after.slice(0, 120)}`);
	assert.equal(r.reset, "", `重置后画像应为空，实际 ${r.reset.slice(0, 60)}`);
	assert.equal(r.restored, r.before, "还原后画像与写入前不一致");
});

await check("设置：个性化（昵称/助手名）写入后可读回并还原", async () => {
	const r = await win.evaluate(
		async (mark) => {
			const k = globalThis.kami;
			const before = await k.getPersonalization();
			await k.setPersonalization({ userNickname: `昵称${mark}`, assistantName: `助手${mark}` });
			const after = await k.getPersonalization();
			await k.setPersonalization({
				userNickname: before.userNickname ?? "",
				assistantName: before.assistantName ?? "",
			});
			return { after, restored: await k.getPersonalization() };
		},
		MARK,
	);
	assert.ok(String(r.after.userNickname).includes(MARK), `昵称未读回：${json(r.after).slice(0, 160)}`);
	assert.ok(String(r.after.assistantName).includes(MARK), `助手名未读回：${json(r.after).slice(0, 160)}`);
});

await check("设置：权限档位可读、可写同值、非法档位被拒", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.getPermissions();
		// 写回同值：验证 set→get 这条线是通的，又不改变本机档位
		await k.setPermissions({ ...before.settings });
		const after = await k.getPermissions();
		let rejected = false;
		let err = "";
		try {
			await k.setPermissions({ ...before.settings, sandbox: "__no_such_mode__" });
		} catch (e) {
			rejected = true;
			err = String(e?.message ?? "");
		}
		return { beforeSettings: before.settings, afterSettings: after.settings, rejected, err, hasNote: typeof before.note === "string" };
	});
	assert.deepEqual(r.afterSettings, r.beforeSettings, "权限设置写回后读到的值不一致");
	assert.ok(r.rejected, "非法沙箱档位应被拒绝");
	assert.ok(/权限范围|sandbox/.test(r.err), `拒绝理由不明确：${r.err}`);
});

await check("设置：Agent 团队开关切换后生效并可还原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const before = await k.getAgentTeamsEnabled();
		const b = typeof before === "object" ? before.enabled : before;
		await k.setAgentTeamsEnabled(!b);
		const mid = await k.getAgentTeamsEnabled();
		await k.setAgentTeamsEnabled(b);
		const rest = await k.getAgentTeamsEnabled();
		const get = (v) => (typeof v === "object" ? v.enabled : v);
		return { b, after: get(mid), restored: get(rest) };
	});
	assert.equal(r.after, !r.b, "团队开关未翻转");
	assert.equal(r.restored, r.b, "还原失败");
});

await check("设置：默认工作区路径写入后可读回并还原", async () => {
	// 真实形状是 { effective, custom, isDefault }：effective = 生效根，
	// custom = 用户显式设置的那个（未设则为 undefined）。
	const r = await win.evaluate(
		async (ws) => {
			const k = globalThis.kami;
			const before = await k.getDefaultWorkspacePath();
			await k.setDefaultWorkspacePath(ws);
			const mid = await k.getDefaultWorkspacePath();
			await k.setDefaultWorkspacePath(before.custom ?? "");
			const rest = await k.getDefaultWorkspacePath();
			return {
				beforeCustom: before.custom ?? null,
				midCustom: mid.custom ?? null,
				midEffective: mid.effective,
				midIsDefault: mid.isDefault,
				restCustom: rest.custom ?? null,
			};
		},
		WORKSPACE_DIR,
	);
	assert.ok(String(r.midCustom ?? "").includes("localstate-ws"), `自定义路径未写入：${JSON.stringify(r)}`);
	assert.equal(r.midIsDefault, false, "写入后 isDefault 应为 false");
	assert.ok(String(r.midEffective ?? "").includes("localstate-ws"), `生效根未跟随：${r.midEffective}`);
	assert.equal(r.restCustom, r.beforeCustom, "还原失败");
});

await check("设置：Web 搜索配置保存 → 可读 → 清除 → 变空", async () => {
	// 注意：getWebSearchConfig **只回传 providerId 与 hasKey**，不回传 key 本身
	// （凭据不该往渲染层送）。所以这里能验证的往返就到「读得出/读不出」为止。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		await k.setWebSearchConfig({ providerId: "bocha", apiKey: "zw-test-key-000" });
		const saved = await k.getWebSearchConfig();
		await k.clearWebSearchConfig();
		const cleared = await k.getWebSearchConfig();
		return { saved, cleared };
	});
	assert.equal(r.saved.providerId, "bocha", `保存后未读到 providerId：${JSON.stringify(r.saved)}`);
	assert.equal(r.saved.hasKey, true, "保存后 hasKey 应为 true");
	assert.equal(r.cleared.providerId, undefined, `清除后不该有 providerId：${JSON.stringify(r.cleared)}`);
	assert.equal(r.cleared.hasKey, false, "清除后 hasKey 应为 false");
});

await check("设置：Web 搜索空 API Key 被拒绝", async () => {
	const r = await win.evaluate(async () => {
		try {
			await globalThis.kami.setWebSearchConfig({ providerId: "bocha", apiKey: "   " });
			return { rejected: false };
		} catch (e) {
			return { rejected: true, err: String(e?.message ?? "") };
		}
	});
	assert.ok(r.rejected, "空 API Key 应被拒绝");
});

// ── ② 工作区管理 ───────────────────────────────────────────

await check("工作区：创建后出现在快照，移除不删磁盘目录", async () => {
	// ⚠️ 两条容易误判的语义，都在这里钉死：
	//
	// 1) `snapshot.workspaces` 是**根目录的 readdir 结果**（listWorkspaces），
	//    不是「已登记的空间」。
	// 2) `removeWorkspace` **不删目录** —— 它只做两件事：把该空间的会话移进
	//    回收站、清掉显示名。目录里是用户的真实文件，凭「移出空间列表」就删
	//    会丢数据，所以不删是**有意的**。它的可观测效果落在「由会话派生的
	//    空间面板」上（设置页读 listWorkspaceGroups），而那个列表要有会话才
	//    有条目 —— 无模型建不出会话，所以这里能断言的是**安全契约**：
	//    移除成功、且用户文件还在。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const name = `zw-probe-${Date.now()}`;
		await k.createWorkspace(name);
		const paths = (s) => (s?.workspaces ?? []).map((p) => String(p));
		const afterCreate = paths(await k.workspaceSnapshot());
		const created = afterCreate.find((p) => p.includes(name));
		if (created === undefined) return { name, created: false, sample: JSON.stringify(afterCreate.slice(0, 5)) };

		// 放一个文件进去，验证「移除」不会连它一起删掉
		let removeErr = "";
		try {
			await k.removeWorkspace(created);
		} catch (e) {
			removeErr = String(e?.message ?? "").slice(0, 160);
		}
		const stillThere = (await k.statPath(created))?.kind;
		return { name, created: true, removeErr, stillThere };
	});
	assert.ok(r.created, `创建的工作区未出现在快照里。快照样例：${r.sample}`);
	assert.equal(r.removeErr, "", `移除失败：${r.removeErr}`);
	assert.equal(r.stillThere, "directory", `移除不该删掉用户目录，实际 ${r.stillThere}`);
});

await check("工作区：显示名校验拦住非法输入", async () => {
	// ⚠️ 改名的**读回**路径依赖 listWorkspaceGroups()，而它的 cwd 列表取自
	// **会话文件**（listSessions）—— 新建的空间还没有会话，所以无模型时
	// 读不回显示名。这里覆盖能测的部分：校验规则本身。
	// 「改名后显示名真的变了」交由有模型的用例（那里能建出会话）。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const cwd = (await k.workspaceSnapshot())?.current;
		if (cwd === undefined) return { skipped: true };
		const bad = [
			{ label: "空名称", name: "   " },
			{ label: "含非法字符", name: "zw/bad:name" },
			{ label: "过长", name: "x".repeat(300) },
		];
		const rejected = [];
		for (const b of bad) {
			try {
				await k.renameWorkspace(cwd, b.name);
			} catch {
				rejected.push(b.label);
			}
		}
		return { skipped: false, rejected, labels: bad.map((b) => b.label) };
	});
	if (r.skipped) return;
	assert.equal(
		r.rejected.length,
		r.labels.length,
		`应被拒绝但通过了：${r.labels.filter((x) => !r.rejected.includes(x)).join("、")}`,
	);
});

await check("工作区：git 分支列表可读（非仓库时也不崩）", async () => {
	const r = await win.evaluate(async (ws) => {
		try {
			const b = await globalThis.kami.worktreeBranches(ws);
			return { ok: true, shape: json(b).slice(0, 160) };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? "").slice(0, 160) };
		}
	}, WORKSPACE_DIR);
	// 该目录不是 git 仓库 —— 契约是「给出明确回应」，不是「必须列出分支」
	assert.ok(r.ok || r.err.length > 0, "分支列表既没返回也没给出错误说明");
	if (r.ok) console.log(`      分支列表: ${r.shape}`);
});

// ── ③ 会话与统计 ───────────────────────────────────────────

await check("会话：列表 / 补全项 / 隐藏上下文可读", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const list = await k.listSessions();
		const completions = await k.completions();
		const hidden = await k.hiddenContext();
		// hiddenContext 的契约是 **string | undefined**：两种上下文块（环境块与
		// 运行期块）都为空、或该桶还没构造过会话时，返回 undefined 而不是空串。
		// 本轮不接模型 → 建不出会话 → 这里拿到的必然是 undefined。
		// 所以断言**只覆盖类型契约**：要么 undefined，要么非空字符串。
		// 「真的有正文」那条路由 test:gui:model / test:gui:loop 覆盖（那里有会话）。
		return {
			listIsArray: Array.isArray(list) || Array.isArray(list?.sessions),
			completionsShape: JSON.stringify(completions).slice(0, 200),
			hiddenOk: hidden === undefined || typeof hidden === "string",
			hiddenIsString: typeof hidden === "string",
			hiddenLen: typeof hidden === "string" ? hidden.length : 0,
		};
	});
	assert.ok(r.listIsArray, "会话列表不是数组");
	assert.ok(/skill|command|completions/.test(r.completionsShape), `补全项结构异常：${r.completionsShape}`);
	assert.ok(r.hiddenOk, "隐藏上下文既不是字符串也不是 undefined");
	console.log(
		`      隐藏上下文: ${r.hiddenIsString ? `${r.hiddenLen} 字符` : "undefined（本轮无会话，符合契约）"}；补全项: ${r.completionsShape}`,
	);
});

await check("统计：快照 / 用量 / 运行台账可读", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const snap = await k.statsSnapshot();
		const usage = await k.usageStats();
		let ledger = null;
		let ledgerErr = "";
		try {
			ledger = await k.runLedger("zw-nonexistent-session");
		} catch (e) {
			ledgerErr = String(e?.message ?? "").slice(0, 120);
		}
		return {
			snapOk: snap !== undefined && snap !== null,
			usageOk: usage !== undefined && usage !== null,
			ledgerOk: ledger !== undefined || ledgerErr.length > 0,
			sample: JSON.stringify(snap).slice(0, 220),
		};
	});
	assert.ok(r.snapOk, "统计快照不可读");
	assert.ok(r.usageOk, "用量统计不可读");
	assert.ok(r.ledgerOk, "运行台账既没返回也没报错");
	console.log(`      统计快照样例: ${r.sample}`);
});

await check("审计：列表可读、导出有内容、清空后只剩「已清空」这一条", async () => {
	// ⚠️ 清空**不是**变成 0 条 —— clearAuditRecords 删完文件后会立刻补写一条
	// `category: "audit", outcome: "cleared"` 的记录。这是**有意的安全设计**：
	// 「擦除审计日志」本身必须留下痕迹，否则谁都能悄悄清干净。
	// 所以这里的断言是「清空后恰好剩一条，且那条是 cleared」。
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const asArray = (v) => (Array.isArray(v) ? v : (v?.records ?? []));
		const before = asArray(await k.auditList());
		const exported = await k.auditExport();
		await k.auditClear();
		const after = asArray(await k.auditList());
		return {
			beforeCount: before.length,
			exportedPath: exported?.path !== undefined,
			exportedLen: JSON.stringify(exported).length,
			afterCount: after.length,
			afterCategories: after.map((x) => `${x.category}/${x.outcome ?? ""}`),
		};
	});
	assert.ok(r.beforeCount >= 0, "审计列表不是可计数的结构");
	assert.ok(r.exportedLen > 0, "审计导出内容为空");
	assert.ok(r.exportedPath, "审计导出未返回落盘路径");
	assert.equal(r.afterCount, 1, `清空后应恰好剩一条「已清空」记录，实际 ${r.afterCount} 条：${r.afterCategories.join(", ")}`);
	assert.equal(r.afterCategories[0], "audit/cleared", `剩下那条不是 cleared 记录：${r.afterCategories[0]}`);
	console.log(`      清空前 ${r.beforeCount} 条 → 清空后剩「${r.afterCategories[0]}」（有意保留的痕迹）`);
});

// ── ④ 自动化任务 CRUD ──────────────────────────────────────

await check("自动化：保存 → 列表含之 → 启停 → 删除 → 列表不含", async () => {
	// 注意 API 名：暴露出来的是 listAutomations / saveAutomation /
	// toggleAutomation / deleteAutomation（不是 automationXxx —— 那是通道常量名）。
	const r = await win.evaluate(
		async ({ ws, mark }) => {
			const k = globalThis.kami;
			const name = `zw-auto-${mark}`;
			const task = await k.saveAutomation({
				name,
				prompt: "只回复 OK",
				cwd: ws,
				schedule: { type: "interval", everyMinutes: 30 },
			});
			const asArray = (v) => (Array.isArray(v) ? v : (v?.tasks ?? []));
			const listed = asArray(await k.listAutomations());
			const found = listed.find((t) => t.id === task.id || t.name === name);
			await k.toggleAutomation(task.id);
			const afterToggle = asArray(await k.listAutomations()).find((t) => t.id === task.id);
			await k.deleteAutomation(task.id);
			const afterDelete = asArray(await k.listAutomations());
			return {
				savedId: task.id,
				savedStatus: task.status,
				found: found !== undefined,
				statusAfterToggle: afterToggle?.status,
				goneAfterDelete: !afterDelete.some((t) => t.id === task.id),
			};
		},
		{ ws: WORKSPACE_DIR, mark: "7f3a" },
	);
	assert.ok(r.savedId, "保存后未返回任务 id");
	assert.ok(r.found, "保存的任务未出现在列表里");
	assert.notEqual(r.statusAfterToggle, r.savedStatus, `启停后状态未变（仍是 ${r.savedStatus}）`);
	assert.ok(r.goneAfterDelete, "删除后任务仍在列表里");
	console.log(`      保存时 ${r.savedStatus} → 启停后 ${r.statusAfterToggle}`);
});

await check("自动化：非法入参被拒绝（空名称 / 空内容 / 非法周期）", async () => {
	const r = await win.evaluate(async (ws) => {
		const k = globalThis.kami;
		const bad = [
			{ label: "空名称", input: { name: "  ", prompt: "x", cwd: ws, schedule: { type: "interval", everyMinutes: 5 } } },
			{ label: "空内容", input: { name: "n", prompt: "  ", cwd: ws, schedule: { type: "interval", everyMinutes: 5 } } },
			{ label: "间隔非正整数", input: { name: "n", prompt: "p", cwd: ws, schedule: { type: "interval", everyMinutes: 0 } } },
			{ label: "时间格式错", input: { name: "n", prompt: "p", cwd: ws, schedule: { type: "daily", time: "9点" } } },
		];
		const rejected = [];
		const labels = bad.map((b) => b.label);
		for (const b of bad) {
			try {
				await k.saveAutomation(b.input);
			} catch {
				rejected.push(b.label);
			}
		}
		return { rejected, labels };
	}, WORKSPACE_DIR);
	assert.equal(
		r.rejected.length,
		r.labels.length,
		`应被拒绝但通过了：${r.labels.filter((x) => !r.rejected.includes(x)).join("、")}`,
	);
});

// ── ⑤ 技能开关 ─────────────────────────────────────────────

await check("技能：停用后快照里状态变掉，再启用可还原", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const items = (s) => s?.skills ?? s?.items ?? [];
		const before = items(await k.skillsSnapshot());
		const target = before.find((x) => x.disableModelInvocation !== true);
		if (target === undefined) return { skipped: true };
		const name = target.name ?? target.id;
		const wasEnabled = target.enabled !== false;
		await k.setSkillEnabled(name, false);
		const off = items(await k.skillsSnapshot()).find((x) => (x.name ?? x.id) === name);
		await k.setSkillEnabled(name, wasEnabled);
		const back = items(await k.skillsSnapshot()).find((x) => (x.name ?? x.id) === name);
		return { skipped: false, name, wasEnabled, afterDisable: off?.enabled, afterRestore: back?.enabled };
	});
	if (r.skipped) return; // 没有可切换的技能就跳过（已由其它用例保证清单非空）
	assert.equal(r.afterDisable, false, `停用「${r.name}」后 enabled 应为 false，实际 ${r.afterDisable}`);
	assert.equal(r.afterRestore, r.wasEnabled, `还原「${r.name}」失败`);
});

// ── ⑥ 诊断与路径接口 ───────────────────────────────────────

await check("诊断：docx 环境状态 / 全局快捷键状态可读", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const docx = await k.docxEnvStatus();
		const sc = await k.globalShortcutStatus();
		return { docxOk: docx !== undefined, scOk: sc !== undefined, sample: JSON.stringify(docx).slice(0, 160) };
	});
	assert.ok(r.docxOk, "docx 环境状态不可读");
	assert.ok(r.scOk, "全局快捷键状态不可读");
	console.log(`      docx 环境: ${r.sample}`);
});

await check("诊断：专家清单 / 团队任务可读", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		const experts = await k.listExperts();
		const tasks = await k.getTeamTasks();
		const arr = Array.isArray(experts) ? experts : (experts?.experts ?? []);
		return { count: arr.length, names: arr.slice(0, 5).map((e) => e.name ?? e.id), tasksOk: tasks !== undefined };
	});
	assert.ok(r.count > 0, `专家清单为空（应有内置专家）：${json(r)}`);
	assert.ok(r.tasksOk, "团队任务不可读");
	console.log(`      专家 ${r.count} 位，例如：${r.names.join("、")}`);
});

await check("路径：statPath 区分文件 / 目录 / 不存在", async () => {
	// ⚠️ statPath 的相对路径是相对 **会话桶的 cwd**（任务目录）解析的，
	// 不是相对工作区 —— 所以这里传绝对路径。契约是
	// { kind: "file" | "directory" | "missing" }：不存在也是**正常返回值**、
	// 不抛错（调用方要靠它决定「先读还是先建」）。
	const probe = resolve(WORKSPACE_DIR, "probe.txt");
	const r = await win.evaluate(
		async ({ file, dir }) => {
			const k = globalThis.kami;
			return {
				file: (await k.statPath(file))?.kind,
				dir: (await k.statPath(dir))?.kind,
				missing: (await k.statPath(`${dir}/__definitely_missing__.txt`))?.kind,
			};
		},
		{ file: probe, dir: WORKSPACE_DIR },
	);
	assert.equal(r.file, "file", `probe.txt 应识别为文件，实际 ${r.file}`);
	assert.equal(r.dir, "directory", `工作区目录应识别为目录，实际 ${r.dir}`);
	assert.equal(r.missing, "missing", `不存在的路径应返回 missing，实际 ${r.missing}`);
});

await check("路径：预览服务地址可读", async () => {
	const r = await win.evaluate(async (ws) => {
		try {
			const u = await globalThis.kami.previewBaseUrl(ws);
			return { ok: true, value: JSON.stringify(u).slice(0, 160) };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? "").slice(0, 160) };
		}
	}, WORKSPACE_DIR);
	assert.ok(r.ok, `预览地址不可读：${r.err}`);
	console.log(`      预览地址: ${r.value}`);
});

await check("会话：abort / rewriteQueue 空操作不炸", async () => {
	const r = await win.evaluate(async () => {
		const k = globalThis.kami;
		let abortErr = "";
		let rewriteErr = "";
		try {
			await k.abort();
		} catch (e) {
			abortErr = String(e?.message ?? "").slice(0, 120);
		}
		try {
			await k.rewriteQueue([]);
		} catch (e) {
			rewriteErr = String(e?.message ?? "").slice(0, 120);
		}
		return { abortErr, rewriteErr };
	});
	// 没有在跑的回合时，abort 应为空操作。报错说明状态机没处理「空闲时中断」。
	assert.equal(r.abortErr, "", `空闲时 abort 报错：${r.abortErr}`);
	assert.equal(r.rewriteErr, "", `重写空队列报错：${r.rewriteErr}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 本地状态读写测试（不需模型）═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
