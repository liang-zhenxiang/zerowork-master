/**
 * Agent 团队端到端测试：`team_create` → 成员以**独立长会话**后台起跑 → 产出落盘。
 *
 * 补的是一处零覆盖：团队（`team_create` / `team_send` / `team_read` …）是应用的
 * 头牌能力之一，此前**没有任何测试调用过它**。
 *
 * 有两个容易漏掉的前提，测试里都显式处理了：
 *
 *   ① **团队工具只在「Agent 团队」开启时才注册**（工厂里有 `if (!deps.isEnabled()) return;`）
 *      —— 默认关着，不先打开就根本调不到。
 *   ② `team_create` **不等成员完成**（它自己说「本工具不等它们完成」）：成员在后台跑，
 *      产出留在**自己的会话记录**里，要 `team_read` 才取回。
 *      所以断言不能只看「工具被调用了」，得等成员那轮真的跑完。
 *
 * 做法（确定性，用 mock 模型）：mock 按内容特征分流 ——
 *   - 带**成员任务文本**、且**没有工具结果** ⇒ 成员会话的首轮 → 返回成员标记；
 *   - 带 `role:"tool"` ⇒ 主代理收尾轮 → 返回最终文本；
 *   - 其余（第一条）⇒ 主代理首轮 → 返回 `team_create` 工具调用。
 *
 * 「没有工具结果」这个条件是必须的：主代理收尾轮里也带着成员任务文本
 * （它在 `team_create` 的 toolCall 参数里），只靠文本分不开两方。
 *
 * 断言：**成员会话真的跑起来了、产出落到自己的会话文件里、且与主代理上下文隔离**
 * （直接读 sessions 目录的 JSONL，认 `team_member` 记录 + 成员的 assistant 回复），
 * 以及主代理收尾正常。
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-team";
const WORKSPACE_DIR = "/tmp/zerowork-team-ws";
const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

const TEAM_NAME = "探针团队";
const MEMBER_NAME = "scout1";
// 注意：任务文本里**不能**内嵌成员标记。
// 否则「会话文件里含标记」会被成员那条**用户消息**（= 任务本身）满足，
// 断言就成了空断言 —— 成员哪怕一个字没回也照样通过。
const MEMBER_TASK = "你是侦察兵：确认收到后只回复一行确认标记，不要写别的字。";
const MEMBER_MARK = "TEAM_MEMBER_OK_9183";
const FINAL_TEXT = "TEAM_CREATE_DONE";

// 第二段：成员的产出**不会自动送到领导那里**，要主动 team_read 取回。
// 这条回收链路是团队功能的日常用法，单独验一遍。
const READ_REQUEST = "把成员的产出读回来汇总一下";
const FINAL_TEXT_2 = "TEAM_READ_DONE";

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
			// 同时留 body（解析后，用于**读文本内容**）与 raw（原始文本，用于**快速找候选轮**）。
			// 注意别拿 raw 去匹配含引号的片段 —— body 是 JSON，里面的引号是转义的（`\"`）。
			requests.push({ url: req.url, body: parsed, raw: body });

			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const send = (delta, finish) => {
				const chunk = { id: "chatcmpl-team", object: "chat.completion.chunk", choices: [{ index: 0, delta }] };
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

			const hasToolResult = msgs.some((m) => m.role === "tool");
			const toolResultCount = msgs.filter((m) => m.role === "tool").length;
			// 成员会话 = **隔离上下文**：首轮只有那份任务，且没有任何工具结果。
			// 主代理的收尾轮虽然也带着任务文本（在 team_create 的 toolCall 参数里），
			// 但它有 role:"tool"，用这一条把两者分开。
			const isMemberTurn = flat.includes(MEMBER_TASK) && !hasToolResult;
			// 不能用「最后一条 user 消息」判断用户说了什么 —— 请求里排在最后的是
			// 运行时快照（`<system-reminder data-role="additional-data">`），
			// 用户真正说的话在它前面。所以在**全部** user 消息里找。
			const anyUserText = msgs
				.filter((m) => m.role === "user")
				.map((m) => JSON.stringify(m.content ?? ""))
				.join("\n");
			const askedForRead = anyUserText.includes(READ_REQUEST);

			if (isMemberTurn) {
				// 成员的第一轮 → 回答标记
				asText(MEMBER_MARK);
			} else if (askedForRead && toolResultCount < 2) {
				// 领导被要求取回产出 → 调 team_read
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_team_read",
							type: "function",
							function: { name: "team_read", arguments: JSON.stringify({ to: MEMBER_NAME }) },
						},
					],
				});
				send({}, "tool_calls");
			} else if (askedForRead) {
				asText(FINAL_TEXT_2);
			} else if (hasToolResult) {
				// 主代理拿回了 team_create 的回执 → 收尾
				asText(FINAL_TEXT);
			} else if (requests.length === 1) {
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_team_1",
							type: "function",
							function: {
								name: "team_create",
								arguments: JSON.stringify({
									name: TEAM_NAME,
									members: [{ name: MEMBER_NAME, agent: "scout", task: MEMBER_TASK }],
								}),
							},
						},
					],
				});
				send({}, "tool_calls");
			} else {
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

// ── 会话文件读取（两段共用）──────────────────────────────
const readSessions = () =>
	(existsSync(SESSIONS_DIR) ? readdirSync(SESSIONS_DIR).filter((x) => x.endsWith(".jsonl")) : []).map((f) => {
		const lines = readFileSync(join(SESSIONS_DIR, f), "utf8").trim().split("\n");
		const records = lines.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
		return { file: f, records };
	});

const byRole = (recs, role) =>
	recs
		.filter((r) => r.type === "message" && r.message?.role === role)
		.flatMap((r) => r.message.content ?? [])
		.filter((c) => c.type === "text" || c.type === "toolResult" || typeof c.text === "string")
		.map((c) => c.text ?? "")
		.join("\n");

const assistantText = (recs) => byRole(recs, "assistant");
const toolResultText = (recs) => byRole(recs, "toolResult");

let memberFile = undefined; // 成员会话文件名（第一段确定，第二段复用）

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

await check("配置 mock 模型、工作区，并**开启 Agent 团队**", async () => {
	// 团队工具只在开关打开时才注册（工厂里 `if (!deps.isEnabled()) return;`），
	// 不先打开就根本调不到 —— 这一步是前提，不是可选项。
	const r = await win.evaluate(async ({ baseUrl, ws }) => {
		const k = globalThis.kami;
		try {
			await k.saveCustomProvider(
				{
					id: "mock-team",
					name: "Mock Team",
					baseUrl,
					api: "openai-completions",
					authHeader: true,
					models: [{ id: "team-model", name: "team-model", reasoning: false, vision: false, contextWindow: 128000, maxTokens: 8192 }],
				},
				"mock-key",
			);
			await k.setModel("mock-team/team-model");
			await k.setWorkspace(ws);
			await k.setAgentTeamsEnabled(true);
			return { ok: true, teamsEnabled: await k.getAgentTeamsEnabled() };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 200) };
		}
	}, { baseUrl: mock.baseUrl, ws: WORKSPACE_DIR });
	assert.ok(r.ok, `配置失败：${r.err}`);
	const enabled = typeof r.teamsEnabled === "object" ? r.teamsEnabled.enabled : r.teamsEnabled;
	assert.equal(enabled, true, `Agent 团队开关没打开：${JSON.stringify(r.teamsEnabled)}`);
});

await check("在输入框里输入并发送（走真实 UI 路径）", async () => {
	const box = win.locator('[aria-label="消息输入框"]');
	await box.waitFor({ state: "visible", timeout: 30_000 });
	await box.fill("请建一个团队把这件事办了");
	await box.press("Enter");
	await win.waitForTimeout(3000);
});

await check("成员会话真的被起了（mock 收到带成员任务的那一轮）", async () => {
	for (let i = 0; i < 40 && mock.requests.length < 3; i++) await win.waitForTimeout(1000);
	// 成员那一轮的判据同 mock：带任务文本、且**没有任何工具结果**
	// （主代理的收尾轮也带着任务文本，但它在 team_create 的 toolCall 参数里）。
	const memberReq = mock.requests.find((r) => {
		const msgs = r.body?.messages ?? [];
		return JSON.stringify(msgs).includes(MEMBER_TASK) && !msgs.some((m) => m.role === "tool");
	});
	assert.ok(
		memberReq,
		`没看到成员会话的请求 —— 建团可能只发了工具调用。共收到 ${mock.requests.length} 轮`,
	);
	console.log(`      成员那轮消息数 ${(memberReq.body?.messages ?? []).length}（独立长会话）`);
});

await check("成员的产出落到它自己的会话文件里（真的跑完了）", async () => {
	// `team_create` **不等成员完成**，产出留在成员自己的会话记录里。
	// 所以直接读 sessions 目录的 JSONL —— 这是「成员真的跑完」最硬的证据。
	//
	// 断言落在**成员那条 assistant 消息**上，而不是「文件里出现过这串字符」：
	// 后者会被任何一处提及满足，等于什么都没验。同时认 `team_member` 记录，
	// 确认这确实是**成员自己的**会话，不是主代理把任务回显了一遍。
	let member = undefined;
	let all = [];
	for (let i = 0; i < 40 && member === undefined; i++) {
		all = readSessions();
		member = all.find(
			(s) =>
				s.records.some((r) => r.type === "custom" && r.customType === "team_member" && r.data?.member === MEMBER_NAME) &&
				assistantText(s.records).includes(MEMBER_MARK),
		);
		if (member === undefined) await win.waitForTimeout(1000);
	}
	assert.ok(
		member,
		`没找到「标记为 ${MEMBER_NAME} 的成员会话 + 它的 assistant 回复含 ${MEMBER_MARK}」的组合 —— ` +
			`成员没跑完、产出没落盘，或落盘的不是成员自己的会话。现有会话文件：\n` +
			all
				.map((s) => `  ${s.file}: 记录 ${s.records.length} 条，assistant 文本 ${JSON.stringify(assistantText(s.records).slice(0, 80))}`)
				.join("\n"),
	);
	memberFile = member.file;
	const size = readFileSync(join(SESSIONS_DIR, member.file), "utf8").length;
	console.log(`      成员会话 ${member.file}（${size} 字节）的回复里含标记 ${MEMBER_MARK}`);

	// 反向确认：主代理自己的会话里**不该**出现这个标记 ——
	// 出现了说明它俩其实是同一个上下文，成员并没有真正独立。
	const others = all.filter((s) => s.file !== member.file);
	assert.ok(others.length >= 1, "只看到一个会话文件 —— 成员没有独立会话（和主代理挤在一起了）");
	for (const s of others) {
		assert.ok(
			!assistantText(s.records).includes(MEMBER_MARK),
			`主代理会话 ${s.file} 的 assistant 消息里也出现了成员标记 —— 两者的上下文没隔离`,
		);
	}
	console.log(`      主代理与成员各有独立会话（共 ${all.length} 个），上下文未串`);
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

await check("团队状态可读（建团后团队登记存在）", async () => {
	const r = await win.evaluate(async () => {
		try {
			const s = await globalThis.kami.snapshot();
			return { ok: true, hasTeam: JSON.stringify(s).includes("探针团队") };
		} catch (e) {
			return { ok: false, err: String(e?.message ?? e).slice(0, 160) };
		}
	});
	assert.ok(r.ok, `会话快照不可读：${r.err}`);
	assert.ok(r.hasTeam, "会话快照里找不到刚建的团队（团队登记没进去）");
});

await check("领导下一轮会**自动**收到未见过的成员产出（<team_output> 快照）", async () => {
	// 第二段先验**自动投递**：成员产出不必等领导主动取 —— 领导的下一次请求里
	// 就会带上 `<team_output team="…"><member_output member="…">` 快照，
	// 且按内容指纹去重（同一份产出只投一次）。
	//
	// 这条与产品文案不符：工具描述、promptSnippet 与 4 份专家人设都写着
	// 「产出不会自动送到你这里」。实际实现是**延迟到下一轮自动投递**（超长截断，
	// 提示用 team_read 取全文）。文案与行为的这处出入已记入 EXTERNAL_REQUESTS.md
	// 的待审计项，此处只如实断言**观测到的行为**。
	//
	// 断言落在 mock 收到的**请求体**上 —— 那正是「产出进了领导上下文」的直接证据，
	// 不用靠我们的推测。
	const box = win.locator('[aria-label="消息输入框"]');
	await box.waitFor({ state: "visible", timeout: 30_000 });
	await box.fill(READ_REQUEST);
	await box.press("Enter");

	let injected = undefined;
	for (let i = 0; i < 40 && injected === undefined; i++) {
		injected = mock.requests.find((r) => r.raw.includes("<team_output") && r.raw.includes(MEMBER_MARK));
		if (injected === undefined) await win.waitForTimeout(1000);
	}
	assert.ok(
		injected,
		`领导的请求里没看到含成员产出的 <team_output> 快照 —— 自动投递没发生。` +
			`共 ${mock.requests.length} 轮请求`,
	);
	// 断言用**解析后的消息文本**（模型真正读到的内容），不用原始 JSON 文本 ——
	// 后者里引号是转义的（`\"`），拿含引号的片段去匹配会一直匹配不到。
	const injectedText = (injected.body?.messages ?? [])
		.map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((c) => c.text ?? "").join("\n")))
		.join("\n");
	assert.ok(
		injectedText.includes(`<member_output member="${MEMBER_NAME}">`),
		`快照里没有 <member_output member="${MEMBER_NAME}"> 段落：` +
			`${injectedText.slice(Math.max(0, injectedText.indexOf("<team_output")), injectedText.indexOf("<team_output") + 300)}`,
	);
	console.log(`      <team_output> 快照已随领导请求投递（含 ${MEMBER_NAME} 的产出正文）`);
});

await check("team_read 也能显式取回同一份产出正文", async () => {
	// 自动投递之外，`team_read` 仍是有用的显式路径（快照超长会被截断，
	// 截断提示就写着「全文用 team_read 取回」）。这条验它确实返回**成员正文**。
	let leaderToolText = "";
	let found = false;
	for (let i = 0; i < 40 && !found; i++) {
		for (const s of readSessions().filter((s) => s.file !== memberFile)) {
			leaderToolText = toolResultText(s.records);
			if (leaderToolText.includes(MEMBER_MARK)) {
				found = true;
				break;
			}
		}
		if (!found) await win.waitForTimeout(1000);
	}
	assert.ok(
		found,
		`领导会话的工具结果里找不到成员产出 ${MEMBER_MARK} —— team_read 没取回正文。` +
			`领导会话工具结果尾部：${JSON.stringify(leaderToolText.slice(-200))}`,
	);
	// 取回的是**成员正文**，不是一句「已读取」的空回执
	assert.ok(
		leaderToolText.includes(`成员「${MEMBER_NAME}」的产出`),
		`取回的文本不是 team_read 的产出正文格式：${JSON.stringify(leaderToolText.slice(0, 200))}`,
	);
	console.log(`      team_read 回执含成员正文（toolResult ${leaderToolText.length} 字符）`);
});

await check("取回后主代理收尾正常（渲染到界面上）", async () => {
	const r = await win.evaluate(async (mark) => {
		for (let i = 0; i < 25; i++) {
			if ((document.body.innerText || "").includes(mark)) return { found: true };
			await new Promise((res) => setTimeout(res, 1000));
		}
		return { found: false, sample: (document.body.innerText || "").slice(-200) };
	}, FINAL_TEXT_2);
	assert.ok(r.found, `界面上找不到取回后的最终回复 ${FINAL_TEXT_2}。尾部：${r.sample}`);
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ Agent 团队测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`（mock 共收到 ${mock.requests.length} 轮请求）`);

await app.close();
await mock.close();
process.exit(failed === 0 ? 0 : 1);