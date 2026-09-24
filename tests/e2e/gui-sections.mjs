/**
 * 分区域 GUI 测试：逐个导航到应用各功能区，验证每个页面真实渲染。
 *
 * 与 gui-smoke.mjs 的分工：
 *   gui-smoke  —— 启动健康度（窗口、样式、daemon、IPC）
 *   gui-sections —— 功能覆盖面，逐个点开侧边栏各区域
 *
 * 为什么要专门做这个：「界面能启动」和「每个功能区都能用」是两件事。
 * 某个区域因为 IPC 通道对不上或组件渲染报错而白屏，冒烟测试完全发现不了。
 * 这里每个区域都会检查渲染出的 DOM 规模与是否出现未捕获异常。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-sections";
const WORKSPACE_DIR = "/tmp/zerowork-workspaces";
const SHOT_DIR = resolve(ROOT, "artifacts", "sections");

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(SHOT_DIR, { recursive: true });

/**
 * 侧边栏区域。
 *
 * 第三项 `expectsOwnPage` 依据**实测行为**标注：
 *   助理 / 项目 / 资料库 在无数据时渲染的是欢迎页本身（不是独立页面），
 *   因此不能用「欢迎页标语消失」判断导航是否生效。
 *   这一点是跑测试时发现的 —— 最初一律用该断言，把这三个正常页面误判为故障。
 *
 * 标注依据是截图人工核对（artifacts/sections/*.png），不是推测。
 */
const SECTIONS = [
	["助理", "assistant", false],
	["项目", "projects", false],
	["专家·技能·连接器", "experts", true],
	["自动化", "automation", true],
	["资料库", "library", false],
	["诊断", "diagnostics", true],
	["统计", "stats", true],
];

const results = [];
const check = async (name, fn) => {
	try {
		await fn();
		results.push(["PASS", name, ""]);
	} catch (e) {
		results.push(["FAIL", name, e.message]);
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

/** 点击侧边栏中文本等于 label 的元素。 */
async function navigateTo(label) {
	const clicked = await win.evaluate((text) => {
		const nodes = [...document.querySelectorAll("button, a, [role='button'], li, div")];
		// 取「文本恰好等于目标」的最深元素，避免点到外层容器
		const hits = nodes.filter((n) => (n.textContent || "").trim() === text);
		if (hits.length === 0) return false;
		const target = hits[hits.length - 1];
		target.click();
		return true;
	}, label);
	if (!clicked) throw new Error(`未找到侧边栏入口「${label}」`);
	await win.waitForTimeout(2500);
}

/** 读取当前页面状态。 */
async function snapshot() {
	return win.evaluate(() => ({
		elementCount: document.querySelectorAll("*").length,
		textLen: (document.body.innerText || "").length,
		text: (document.body.innerText || "").slice(0, 400),
	}));
}

// 记录基线：欢迎页
const baseline = await snapshot();
console.log(`基线（欢迎页）: ${baseline.elementCount} 元素, ${baseline.textLen} 字符`);

for (const [label, slug, expectsOwnPage] of SECTIONS) {
	const errCountBefore = pageErrors.length;
	await check(`导航到「${label}」`, async () => {
		await navigateTo(label);
		const s = await snapshot();
		// 先截图再断言：断言失败时也要留下现场
		await win.screenshot({ path: resolve(SHOT_DIR, `${slug}.png`) });

		// 不能用元素数量当白屏判据：无数据时这些区域是**正常的空状态页**
		// （如「统计」显示"还没有任何会话"），DOM 天然比欢迎页小得多，
		// 统一阈值会把正常页面误判为白屏。
		assert.ok(s.elementCount > 60, `元素数仅 ${s.elementCount}，疑似白屏`);

		// 判断导航是否真的换了内容区。
		// 也不能用「页面包含区域标题」判断 —— 侧边栏常驻这些标签，
		// body.innerText 里永远能找到，断言会恒真。
		if (expectsOwnPage) {
			assert.ok(!s.text.includes("开工吧"), "内容区仍是欢迎页，导航未生效");
		}
	});
	await check(`「${label}」无渲染异常`, () => {
		const newErrors = pageErrors.slice(errCountBefore);
		assert.equal(newErrors.length, 0, newErrors.join("; "));
	});

	// 回到欢迎页，保证每次导航的起点一致
	await win.evaluate(() => {
		const home = [...document.querySelectorAll("button, a, [role='button']")].find((n) =>
			(n.textContent || "").includes("新建任务"),
		);
		home?.click();
	});
	await win.waitForTimeout(1500);
}

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ 分区域 GUI 测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
	if (status === "FAIL") failed++;
}
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`截图目录: artifacts/sections/`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
