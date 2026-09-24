/**
 * 设置页分组的 GUI 测试。
 *
 * 补的是一块**完全没被 GUI 覆盖过**的地方：`gui-sections.mjs` 覆盖的是**顶层导航**
 * 那几项（助理 / 项目 / 专家·技能·连接器 / 自动化 / 资料库 / 诊断 / 统计），
 * 而**设置对话框里的 9 个分组**（通用 / 个性化 / 记忆与进化 / 模型 / 内置运行时 /
 * 数据管理 / 审计中心 / 提示词预览 / 关于）此前没有任何测试导航过 ——
 * 全仓 grep 连这些标签都没出现过。
 *
 * 设置页是用户配置一切的地方，它渲染不出来（或某个分组点开是空白）属于
 * 「界面看着在、功能全挂」那一类，只断言文本存在是抓不到的。
 *
 * 断言：
 *   ① 齿轮能打开设置对话框（role=dialog）；
 *   ② 侧栏分组清单包含**已知的 9 个标签**（少了任何一个都会露出来）；
 *   ③ 逐个点开，每个分组的面板都渲染出**非空内容**，且没有渲染异常。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-guisettings";
const WORKSPACE_DIR = "/tmp/zerowork-guisettings-ws";
const SHOT_DIR = resolve(ROOT, "artifacts");

/** 设置对话框里应有的分组（与渲染层 NAV_ITEMS 对齐；少一个就说明有分组不见了）。 */
const EXPECTED = [
	"通用",
	"个性化",
	"记忆与进化",
	"模型",
	"内置运行时",
	"数据管理",
	"审计中心",
	"提示词预览",
	"关于",
];

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, String(e.message ?? e).slice(0, 220)]);
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

await check("齿轮按钮能打开设置对话框", async () => {
	await win.evaluate(() => {
		const btn = document.querySelector('[aria-label="设置"]');
		if (btn === null) throw new Error("找不到设置按钮 [aria-label=\"设置\"]");
		btn.click();
	});
	// 等对话框挂上
	let ok = false;
	for (let i = 0; i < 20; i++) {
		ok = await win.evaluate(() => document.querySelector(".settings-card") !== null);
		if (ok) break;
		await win.waitForTimeout(500);
	}
	assert.ok(ok, "点了设置按钮但设置对话框没出现");
});

const navLabels = await win.evaluate(() =>
	[...document.querySelectorAll(".settings-nav-item")].map((n) => (n.textContent || "").trim()),
);

await check("侧栏分组清单包含全部已知分组", async () => {
	assert.ok(navLabels.length > 0, "设置侧栏一个分组都没有");
	const missing = EXPECTED.filter((l) => !navLabels.includes(l));
	assert.equal(missing.length, 0, `设置页缺少分组：${missing.join("、")}（现有：${navLabels.join("、")}）`);
	console.log(`      分组 ${navLabels.length} 个：${navLabels.join("、")}`);
});

/** 点开某个分组，返回面板与整卡的文本。 */
async function openGroup(label) {
	const clicked = await win.evaluate((text) => {
		const items = [...document.querySelectorAll(".settings-nav-item")];
		const hit = items.find((n) => (n.textContent || "").trim() === text);
		if (hit === undefined) return false;
		hit.click();
		return true;
	}, label);
	assert.ok(clicked, `设置侧栏里找不到分组「${label}」`);
	await win.waitForTimeout(600);
	return win.evaluate(() => {
		const panel = document.querySelector(".settings-panel") ?? document.querySelector(".settings-body");
		return {
			panelText: (panel?.innerText ?? "").trim(),
			cardTextLen: (document.querySelector(".settings-card")?.innerText ?? "").trim().length,
			active: [...document.querySelectorAll(".settings-nav-item")].find((n) => n.classList.contains("active"))?.textContent?.trim(),
		};
	});
}

for (const label of EXPECTED) {
	const errBefore = pageErrors.length;
	await check(`设置分组「${label}」渲染出内容`, async () => {
		const s = await openGroup(label);
		await win.screenshot({ path: resolve(SHOT_DIR, `settings-${EXPECTED.indexOf(label)}.png`) });
		// 面板必须有内容：空白面板说明这个分组没接上（或渲染时抛了）
		assert.ok(s.panelText.length > 0, `「${label}」的面板是空的`);
		assert.ok(s.cardTextLen > 40, `「${label}」整卡文本仅 ${s.cardTextLen} 字符，疑似没渲染`);
		assert.equal(s.active, label, `点开后高亮的分组是「${s.active}」，不是「${label}」`);
		console.log(`      「${label}」面板 ${s.panelText.length} 字符`);
	});
	await check(`设置分组「${label}」无渲染异常`, () => {
		const fresh = pageErrors.slice(errBefore);
		assert.equal(fresh.length, 0, fresh.join("; "));
	});
}

await check("关闭设置后对话框消失", async () => {
	await win.evaluate(() => {
		const btn = document.querySelector('[aria-label="关闭设置"]');
		if (btn !== null) btn.click();
	});
	await win.waitForTimeout(800);
	const gone = await win.evaluate(() => document.querySelector(".settings-card") === null);
	assert.ok(gone, "点了关闭但设置对话框还在");
});

await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 设置页分组 GUI 测试 ═══");
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n通过 ${results.length - failed}/${results.length}`);

await app.close();
process.exit(failed === 0 ? 0 : 1);