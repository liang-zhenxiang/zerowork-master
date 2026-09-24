/**
 * 应用自有 agent 工具的单元测试。
 *
 * 这些工具此前只有在**模型主动调用**时才被执行到，端到端测试只能覆盖「循环转得起来」，
 * 覆盖不到每个工具自己的校验逻辑 —— 而校验逻辑恰恰是最容易写错、也最该兜住的部分
 * （`show_widget` 有 6 条拒绝规则，`todo_write` 有全量替换语义，`use_skill` 有
 * 三种不可加载的情形）。
 *
 * 它们的实现是**纯函数**（不碰网络、不碰文件系统，除了读技能文件），所以用单测跑
 * 既快又确定，不必依赖模型。这里既测导出的纯函数，也用一个假的 `pi` 把工厂注册出来的
 * 工具抓下来、直接调它的 `execute`。
 */
import { describe, it, expect } from "vitest";
import {
	confirmText,
	createUseSkillTool,
	normalizeLoadingMessages,
	normalizeTitle,
	parseModules,
	validateWidgetCode,
	visualizerExtensionFactory,
	todoExtensionFactory,
} from "../../src/main/daemon/mcp-client.js";

/**
 * 假的 pi：把这些工厂注册的工具抓下来。
 * 只实现工厂用到的两个方法（`registerTool` / `on`），够用且不牵入真实运行时。
 */
function fakePi() {
	const tools = new Map();
	return {
		tools,
		registerTool(def) {
			tools.set(def.name, def);
		},
		on() {},
	};
}

/** 注册工厂里的全部工具并返回 { 名字 -> 定义 }。 */
function toolsOf(factory, options = {}) {
	const pi = fakePi();
	factory(options)(pi);
	return pi.tools;
}

/** 取出工具 execute 返回文本（工具的契约是 content[0].text 是给人/模型看的结果）。 */
async function runTool(tool, params) {
	const result = await tool.execute("test-call-id", params);
	return result.content.map((c) => c.text ?? "").join("\n");
}

// ── todo_write ────────────────────────────────────────────

describe("todo_write", () => {
	it("注册了一个叫 todo_write 的工具，且声明了参数结构", () => {
		const tools = toolsOf(todoExtensionFactory);
		const t = tools.get("todo_write");
		expect(t, "没有注册 todo_write").toBeTruthy();
		expect(t.parameters.type).toBe("object");
		expect(t.parameters.properties.todos).toBeTruthy();
	});

	it("回执里报已完成数与总数，并点名进行中的那一项", async () => {
		const t = toolsOf(todoExtensionFactory).get("todo_write");
		const text = await runTool(t, {
			todos: [
				{ content: "写测试", status: "completed" },
				{ content: "补文档", status: "in_progress", activeForm: "正在补文档" },
				{ content: "发版", status: "pending" },
			],
		});
		expect(text).toContain("1 项已完成");
		expect(text).toContain("共 3 项");
		// ⚠️ 点名用的是 `content` 而不是 `activeForm` —— 起初按「应该展示进行时短语」
		// 写，跑失败后查实现才发现分工不同：`activeForm` 是**执行期间界面上**轮播的
		// 短语（由渲染层消费），回执文本给的是任务本身的名字。
		expect(text).toContain("进行中：补文档");
	});

	it("空数组表示清空清单", async () => {
		const t = toolsOf(todoExtensionFactory).get("todo_write");
		expect(await runTool(t, { todos: [] })).toContain("已清空");
	});

	// confirmText 是纯函数，单独钉住它的分支（工具 execute 只是转发）
	it("confirmText：无进行中项时不写「进行中」", () => {
		const text = confirmText([
			{ content: "a", status: "completed" },
			{ content: "b", status: "pending" },
		]);
		expect(text).toContain("1 项已完成");
		expect(text).not.toContain("进行中：");
	});
});

// ── use_skill ─────────────────────────────────────────────

describe("use_skill", () => {
	const skills = [
		{ name: "docx", enabled: true, filePath: "/tmp/zw-skill-docx/SKILL.md" },
		{ name: "off-skill", enabled: false, filePath: "/tmp/x/SKILL.md" },
		{ name: "manual-only", enabled: true, disableModelInvocation: true, filePath: "/tmp/y/SKILL.md" },
	];

	it("未知技能名被拒，并把可用技能列出来", async () => {
		const t = toolsOf(createUseSkillTool, { resolveSkills: async () => skills }).get("use_skill");
		await expect(t.execute("id", { command: "__no_such_skill__" })).rejects.toThrow(/没有名为/);
	});

	it("被停用的技能不能自动加载，并指明去哪儿打开", async () => {
		const t = toolsOf(createUseSkillTool, { resolveSkills: async () => skills }).get("use_skill");
		await expect(t.execute("id", { command: "off-skill" })).rejects.toThrow(/技能页/);
	});

	it("声明了 disable-model-invocation 的技能不能由模型加载", async () => {
		const t = toolsOf(createUseSkillTool, { resolveSkills: async () => skills }).get("use_skill");
		await expect(t.execute("id", { command: "manual-only" })).rejects.toThrow(/disable-model-invocation/);
	});

	it("技能名会先 trim（模型常带上多余空格）", async () => {
		const t = toolsOf(createUseSkillTool, { resolveSkills: async () => skills }).get("use_skill");
		// 未知名字 trim 后仍是未知 —— 这里断言的是「trim 发生了」而不是「恰好命中」
		await expect(t.execute("id", { command: "  __no_such_skill__  " })).rejects.toThrow(/「__no_such_skill__」/);
	});
});

// ── show_widget / read_me ─────────────────────────────────

describe("show_widget 的校验规则", () => {
	const tool = () => toolsOf(visualizerExtensionFactory).get("show_widget");

	it("注册了 read_me 与 show_widget 两个工具", () => {
		const tools = toolsOf(visualizerExtensionFactory);
		expect([...tools.keys()].sort()).toEqual(["read_me", "show_widget"]);
	});

	it("缺少 title / widget_code 时返回 success:false 并说明缺哪个", async () => {
		const a = JSON.parse(await runTool(tool(), { widget_code: "<div>x</div>" }));
		expect(a.success).toBe(false);
		expect(a.message).toContain("title");

		const b = JSON.parse(await runTool(tool(), { title: "T" }));
		expect(b.success).toBe(false);
		expect(b.message).toContain("widget_code");
	});

	it("合法的 HTML 片段通过，并按内容推断 render_mode", async () => {
		const r = JSON.parse(
			await runTool(tool(), { title: "我的 报告", widget_code: "<div>hi</div>", loading_messages: ["正在渲染"] }),
		);
		expect(r.success).toBe(true);
		expect(r.render_mode).toBe("html");
		expect(r.title).toBe("我的_报告"); // 空格转下划线
	});

	it("以 <svg 开头时 render_mode 是 svg", async () => {
		const svg = '<svg viewBox="0 0 680 200" width="100%" xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
		const r = JSON.parse(await runTool(tool(), { title: "图", widget_code: svg, loading_messages: ["正在画"] }));
		expect(r.success).toBe(true);
		expect(r.render_mode).toBe("svg");
	});

	it.each([
		["文档包裹标签", "<!DOCTYPE html><html><body>x</body></html>", /DOCTYPE|html/],
		["localStorage", "<div onclick=\"localStorage.setItem('a','b')\">x</div>", /localStorage/],
		["position:fixed", '<div style="position: fixed; top:0">x</div>', /fixed/],
		["<form>", "<form><input/></form>", /form/],
	])("拒绝%s，并给出中文原因", async (_label, code, pattern) => {
		const r = JSON.parse(await runTool(tool(), { title: "T", widget_code: code, loading_messages: ["正在渲染"] }));
		expect(r.success).toBe(false);
		expect(r.message).toMatch(pattern);
	});

	it("SVG 的 viewBox 不是 0 0 680 H 时被拒", async () => {
		const svg = '<svg viewBox="0 0 100 100" width="100%"><circle r="5"/></svg>';
		const r = JSON.parse(await runTool(tool(), { title: "图", widget_code: svg, loading_messages: ["正在画"] }));
		expect(r.success).toBe(false);
		expect(r.message).toContain("viewBox");
	});

	it("loading_messages 条数越界时被拒", async () => {
		const r = JSON.parse(
			await runTool(tool(), {
				title: "T",
				widget_code: "<div>x</div>",
				loading_messages: ["1", "2", "3", "4", "5"],
			}),
		);
		expect(r.success).toBe(false);
		expect(r.message).toContain("1-4");
	});
});

describe("read_me", () => {
	it("没有有效模块时返回指引文本而不是报错", async () => {
		const t = toolsOf(visualizerExtensionFactory).get("read_me");
		const r = JSON.parse(await runTool(t, { modules: ["__no_such_module__"] }));
		expect(r.content).toContain("diagram");
		expect(r.content).toContain("chart");
	});
});

// ── 纯函数：标题规范化 / 加载文案 / 模块解析 ────────────────

describe("normalizeTitle", () => {
	it.each([
		["销售 报告", "销售_报告"],
		["a-b c", "a_b_c"],
		["  多  空格  ", "多_空格"],
		["带/非法*字符", "带非法字符"],
		["", "widget"],
		["!!!", "widget"],
	])("%j -> %j", (input, expected) => {
		expect(normalizeTitle(input)).toBe(expected);
	});
});

describe("normalizeLoadingMessages", () => {
	it("接受数组、JSON 串、逗号串三种形态", () => {
		expect(normalizeLoadingMessages(["a", "b"])).toEqual(["a", "b"]);
		expect(normalizeLoadingMessages('["a","b"]')).toEqual(["a", "b"]);
		expect(normalizeLoadingMessages("a,b")).toEqual(["a", "b"]);
	});

	it("剔除空项与非字符串，并 trim", () => {
		expect(normalizeLoadingMessages([" a ", "", "b"])).toEqual(["a", "b"]);
		expect(normalizeLoadingMessages(["a", 42, "b"])).toEqual(["a", "b"]);
	});

	it("非数组/非字符串返回 undefined（由调用方决定怎么报错）", () => {
		expect(normalizeLoadingMessages(42)).toBeUndefined();
		expect(normalizeLoadingMessages(null)).toBeUndefined();
		expect(normalizeLoadingMessages(undefined)).toBeUndefined();
	});

	it("只有以 `[` 开头的串才按 JSON 解析；解析失败返回 undefined", () => {
		// 三种输入走三条路（实测确认，起初我两条都猜错）：
		//   `[...]` 且 JSON 合法 → 解析成数组
		//   `[` 开头但 JSON 损坏 → **undefined**（明确失败，不退回逗号切分）
		//   不以 `[` 开头 → 按逗号切分（JSON 对象串落这条，整串当成一条文案）
		expect(normalizeLoadingMessages('["a"]')).toEqual(["a"]);
		expect(normalizeLoadingMessages("[broken json")).toBeUndefined();
		expect(normalizeLoadingMessages('{"not":"array"}')).toEqual(['{"not":"array"}']);
	});
});

describe("parseModules", () => {
	it("只保留受支持的模块，并去重", () => {
		expect(parseModules(["diagram", "chart"])).toEqual(["diagram", "chart"]);
		expect(parseModules(["diagram", "diagram"])).toEqual(["diagram"]);
		expect(parseModules(["diagram", "__bogus__"])).toEqual(["diagram"]);
	});

	it("接受 JSON 串与逗号串", () => {
		expect(parseModules('["diagram","chart"]')).toEqual(["diagram", "chart"]);
		expect(parseModules("diagram,chart")).toEqual(["diagram", "chart"]);
		expect(parseModules("chart")).toEqual(["chart"]);
	});

	it("全都不认识时返回空数组（调用方据此给指引文本）", () => {
		expect(parseModules("__bogus__")).toEqual([]);
		expect(parseModules([])).toEqual([]);
	});
});

describe("validateWidgetCode", () => {
	it("合法片段返回 undefined（没有原因就是通过）", () => {
		expect(validateWidgetCode("<div>ok</div>")).toBeUndefined();
	});

	it("返回的原因都是中文、且指明该怎么改", () => {
		const reason = validateWidgetCode("<form></form>");
		expect(typeof reason).toBe("string");
		expect(reason).toMatch(/重新提交|改用/);
	});
});