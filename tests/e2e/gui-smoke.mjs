/**
 * 端到端 GUI 冒烟测试。
 *
 * 目标不是"跑起来不报错"，而是验证**重建后的源码构建产物**真的可用：
 * 主窗口渲染出真实界面、daemon 子进程起来并应答 IPC、关键交互可用。
 *
 * 之所以用 Playwright 的 _electron 而不是截图比对：Electron 应用的很多
 * 失败是"界面看着在、但 IPC 全挂"（daemon 没起来、通道名对不上）。
 * 必须真正驱动 DOM、读回状态，才能发现这类问题。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_DIR = "/tmp/zerowork-e2e";
const WORKSPACE_DIR = "/tmp/zerowork-workspaces";
const SHOT_DIR = resolve(ROOT, "artifacts");

rmSync(CONFIG_DIR, { recursive: true, force: true });
rmSync(WORKSPACE_DIR, { recursive: true, force: true });
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
/** 逐条记录断言结果，不因单条失败中断整轮测试。 */
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

const procLines = [];
app.process().stdout?.on("data", (b) => procLines.push(String(b).trimEnd()));
app.process().stderr?.on("data", (b) => procLines.push(String(b).trimEnd()));

const pageErrors = [];
const win = await app.firstWindow({ timeout: 120_000 });
win.on("pageerror", (e) => pageErrors.push(String(e)));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(9000);

// ── 断言 ─────────────────────────────────────────────
await check("窗口标题为 ZeroWork", async () => assert.equal(await win.title(), "ZeroWork"));

const probe = await win.evaluate(() => {
	const sideNav = document.querySelector("aside, nav, [class*='sidebar'], [class*='sider']");
	return {
		rootChildren: document.getElementById("root")?.childElementCount ?? -1,
		text: document.body.innerText || "",
		textareas: document.querySelectorAll("textarea").length,
		buttons: document.querySelectorAll("button").length,
		elementCount: document.querySelectorAll("*").length,
		// 样式加载检测：无样式时 body 字体是浏览器默认衬线字体，
		// 侧边栏也不会被 flex 撑开。只看"有没有文本"抓不到丢 CSS 的问题。
		styleSheets: document.styleSheets.length,
		bodyFont: getComputedStyle(document.body).fontFamily,
		sideNavWidth: sideNav ? sideNav.getBoundingClientRect().width : -1,
	};
});

await check("React 已挂载到 #root", () => assert.ok(probe.rootChildren > 0, `root 子节点=${probe.rootChildren}`));
await check("渲染出足量 DOM 元素", () => assert.ok(probe.elementCount > 100, `元素数=${probe.elementCount}`));
await check("存在输入框", () => assert.ok(probe.textareas > 0, "未找到 textarea"));
await check("存在按钮", () => assert.ok(probe.buttons > 0, "未找到 button"));
await check("侧边栏导航渲染", () => assert.ok(probe.text.includes("新建任务"), "缺少「新建任务」"));
await check("欢迎页文案渲染", () => assert.ok(probe.text.includes("开工吧"), "缺少欢迎页文案"));
await check("场景标签渲染", () => assert.ok(probe.text.includes("日常办公"), "缺少场景标签"));
await check("最佳实践案例渲染", () => assert.ok(probe.text.includes("最佳实践"), "缺少案例区"));
await check("样式表已加载", () => assert.ok(probe.styleSheets > 0, "未加载任何样式表"));
await check(
	"样式实际生效（非默认字体）",
	() => assert.ok(!/^(Times|serif|"Times New Roman")/.test(probe.bodyFont.trim()), `body 字体=${probe.bodyFont}`),
);
await check("侧边栏布局生效", () => assert.ok(probe.sideNavWidth > 120, `侧边栏宽度=${probe.sideNavWidth}`));

// daemon 是独立 utility process，它没起来的话界面会一直在「正在启动」
await win.waitForTimeout(4000);
await check(
	"daemon 子进程已启动",
	() => assert.ok(procLines.some((l) => l.includes("daemon 启动")), "未看到 daemon 启动日志"),
);
await check(
	"daemon 在 darwin 上运行",
	() => assert.ok(procLines.some((l) => l.includes("darwin")), "未看到 darwin 平台标识"),
);
await check(
	"daemon 正常应答 IPC",
	() => assert.ok(procLines.some((l) => l.includes("settings:snapshot")), "未看到 settings:snapshot 应答"),
);
await check("无 daemon 崩溃", () => assert.ok(!procLines.some((l) => l.includes("daemon 退出")), "daemon 退出"));
await check("无渲染层未捕获异常", () => assert.equal(pageErrors.length, 0, pageErrors.join("; ")));

await win.screenshot({ path: resolve(SHOT_DIR, "e2e-smoke.png") });

// ── 报告 ─────────────────────────────────────────────
console.log("\n═══ GUI 端到端测试 ═══");
let failed = 0;
for (const [status, name, msg] of results) {
	console.log(`  [${status}] ${name}${msg ? `  —— ${msg}` : ""}`);
	if (status === "FAIL") failed++;
}
console.log(`\n通过 ${results.length - failed}/${results.length}`);
console.log(`截图: artifacts/e2e-smoke.png`);

await app.close();
process.exit(failed === 0 ? 0 : 1);
