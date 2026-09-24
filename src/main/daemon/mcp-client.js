import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { normalize as normalize$1 } from "node:path";
import { openSync } from "node:fs";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readSync } from "node:fs";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { sep } from "node:path";
import { statSync } from "node:fs";
import { Type } from "typebox";
import { writeFileSync } from "node:fs";
import { getResourcesDir } from "./config-paths.js";
import { skillBlockText } from "./session-view.js";
import { declareReadOnlyTools } from "./command-exec.js";

const TodoItemSchema = Type.Object({
  content: Type.String({ minLength: 1, description: "任务内容，一句话说清要做什么。" }),
  activeForm: Type.Optional(
    Type.String({
      minLength: 1,
      description: "进行时短语（如「正在整理数据」），执行期间展示给用户；仅进行中项需要。"
    })
  ),
  status: Type.Union(
    [Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
    { description: "pending 待办 / in_progress 进行中 / completed 已完成。" }
  )
});

function confirmText(todos) {
  if (todos.length === 0) return "待办清单已清空。";
  const done = todos.filter((t) => t.status === "completed").length;
  const current = todos.find((t) => t.status === "in_progress");
  const doing = current === void 0 ? "" : `（进行中：${current.content}）`;
  return `待办清单已更新：${done} 项已完成 / 共 ${todos.length} 项${doing}。`;
}

function todoExtensionFactory() {
  declareReadOnlyTools(["todo_write"]);
  return (pi) => {
    pi.registerTool({
      name: "todo_write",
      label: "任务列表",
      description: "维护会话待办清单，跟踪多步骤任务的执行进度，清单会实时展示给用户。每次调用都传入完整清单（全量替换，不是增量修改），任务推进、完成或计划有变时就更新一次。每项含内容 content 与状态 status（pending 待办 / in_progress 进行中 / completed 已完成）；进行中的那一项用 activeForm 写一个进行时短语（如「正在整理数据」），执行期间界面上展示它。长任务每完成 3-5 项，用一句话在回复里小结：做到了什么、还剩几项、接着做哪一项。任务全部完成时传空数组，表示清单关闭。",
      promptSnippet: "todo_write: 多步任务维护待办清单（全量替换）——进行中项写 activeForm，完成立即标 completed，全部做完传空数组",
      promptGuidelines: [
        "少于 3 步的简单任务不要用这个工具——直接做，清单是纯开销。",
        "任何时刻恰好一项 in_progress；开始下一项前先把当前项标 completed。",
        "每次调用都返回完整清单（全量替换，不是增量）。",
        // 清单在界面上是折叠起来的，用户判断进度只能靠这几句小结 ——
        // 所以这几句是硬要求（不可协商）：
        "长任务每完成 3-5 项，用一段小结点名进度：已完成的要点、还剩几项、接下来做哪一项。",
        "所有任务完成、传空数组收尾时，正文里明确说清做完了什么，不要静默收尾。"
      ],
      parameters: Type.Object({
        todos: Type.Array(TodoItemSchema, {
          maxItems: 50,
          description: "完整待办清单（全量替换，最多 50 项）；全部完成时传空数组收尾。"
        })
      }),
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: confirmText(params.todos) }],
          details: { todos: params.todos }
        };
      }
    });
  };
}

function createUseSkillTool(options) {
  declareReadOnlyTools(["use_skill"]);
  return (pi) => {
    pi.registerTool({
      name: "use_skill",
      label: "加载技能",
      description: "加载一个技能的完整说明（SKILL.md 正文）。任务命中技能清单（<available_skills>）里某个技能的描述时，先调用它拿到该技能的步骤、模板与规则，再动手 —— 清单里只有一行描述，照着那行做事会漏掉技能内的关键约定。",
      promptSnippet: "use_skill: 任务命中技能清单里某个技能时，用它加载该技能的完整说明（技能名取自 <available_skills> 的 <name>，不凭记忆拼）",
      promptGuidelines: [
        "技能名只能一字不差地取自技能清单 <available_skills> 里的 <name>；清单里没有的技能名不要调，也不要把用户的话当成技能名。",
        "命中技能的任务先 use_skill 加载，再按其步骤与模板执行；不要加载了却不用。",
        "用户手动 /skill:<name> 已经展开过正文的技能，不必再加载一次。"
      ],
      parameters: Type.Object({
        command: Type.String({
          minLength: 1,
          description: '技能名（不含参数），取自技能清单里的 <name>，如 "docx"。'
        })
      }),
      async execute(_toolCallId, params) {
        const skills = await options.resolveSkills();
        const name = params.command.trim();
        const skill = skills.find((s) => s.name === name);
        if (skill === void 0) {
          const visible = skills.filter((s) => s.enabled && !s.disableModelInvocation).map((s) => s.name);
          const available = visible.length === 0 ? "当前会话没有可自动加载的技能。" : `当前可用的技能：${visible.join("、")}。`;
          throw new Error(
            `没有名为「${name}」的技能。${available}技能名必须取自技能清单 <available_skills> 里的 <name>，不要凭记忆拼写。`
          );
        }
        if (!skill.enabled) {
          throw new Error(
            `技能「${name}」已在技能页被停用，不能自动加载 —— 到技能页把它重新打开即可（技能本身的 SKILL.md 没有被改过）。`
          );
        }
        if (skill.disableModelInvocation) {
          throw new Error(
            `技能「${name}」声明了 disable-model-invocation: true，不能由模型自动加载 —— 它仅供用户手动 /skill:${name} 或其它技能按路径引用。`
          );
        }
        const { stripFrontmatter } = await import("@earendil-works/pi-coding-agent");
        const body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
        const baseDir = dirname(skill.filePath);
        return {
          content: [
            {
              type: "text",
              text: skillBlockText({ name: skill.name, filePath: skill.filePath, baseDir, body })
            }
          ],
          details: { name: skill.name }
        };
      }
    });
  };
}

const BASE_GUIDE_FILES = ["core.md", "colors.md"];

const MODULE_GUIDE_FILES = {
  diagram: ["svg-setup.md", "diagram.md"],
  chart: ["chart.md"]
};

function parseModules(raw) {
  const modules = [];
  const push = (value) => {
    if ((value === "diagram" || value === "chart") && !modules.includes(value)) {
      modules.push(value);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) push(item);
          return modules;
        }
      } catch {
      }
    }
    for (const piece of trimmed.split(",")) push(piece.trim());
  }
  return modules;
}

const NO_VALID_MODULE_TEXT = '本次 read_me 没有命中任何有效模块。v1 支持的模块：diagram（SVG 流程图/结构图/示意图）、chart（Chart.js 数据图表）。请用 modules: ["diagram"] 或 modules: ["chart"]（也可两个都传）重新调用。';

function readGuides(modules) {
  const dir = join(getResourcesDir(), "visualizer");
  const files = [...BASE_GUIDE_FILES, ...modules.flatMap((m) => MODULE_GUIDE_FILES[m])];
  return files.map((name) => {
    const path = join(dir, name);
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      throw new Error(
        `可视化设计指南缺失或不可读：${path}。resources/visualizer/ 应随应用一起分发；若设置了 ZEROWORK_RESOURCES_DIR，请检查其指向。`
      );
    }
  }).join("\n\n---\n\n");
}

function normalizeTitle(raw) {
  const underscored = raw.trim().replace(/[\s-]+/g, "_");
  const kept = underscored.replace(/[^\p{L}\p{N}_]/gu, "");
  const collapsed = kept.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return collapsed === "" ? "widget" : collapsed;
}

function normalizeLoadingMessages(raw) {
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return void 0;
        list = parsed;
      } catch {
        return void 0;
      }
    } else {
      list = trimmed.split(",");
    }
  } else {
    return void 0;
  }
  return list.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item !== "");
}

const DOC_WRAPPER_RE = /<(!DOCTYPE|html|head|body)\b/i;

const WEB_STORAGE_RE = /\b(localStorage|sessionStorage)\b/;

const FIXED_POSITION_RE = /position\s*:\s*fixed/;

const FORM_RE = /<form\b/i;

const SVG_TAG_RE = /<svg\b/gi;

const SVG_VIEWBOX_RE = /viewBox\s*=\s*["']0\s+0\s+680\s+\d+["']/i;

function validateWidgetCode(code) {
  if (DOC_WRAPPER_RE.test(code)) {
    return "widget_code 只能是片段，不能含 <!DOCTYPE>、<html>、<head>、<body> 文档包裹标签——片段会被注入宿主卡片容器，不是完整网页。请去掉这些标签后重新提交。";
  }
  if (WEB_STORAGE_RE.test(code)) {
    return "widget_code 不能使用 localStorage/sessionStorage：沙箱环境禁止访问，运行即抛异常。请改用片段内的 JS 变量保存状态后重新提交。";
  }
  if (FIXED_POSITION_RE.test(code)) {
    return "widget_code 不能使用 position: fixed——卡片高度靠文档流随内容自适应，固定定位会脱离文档流，导致高度测量失效并遮挡聊天界面。请改用文档流内布局后重新提交。";
  }
  if (FORM_RE.test(code)) {
    return "widget_code 不能使用 <form>——片段没有提交目标。需要输入交互请改用普通控件（button / select / input）加事件监听。";
  }
  if (code.toLowerCase().startsWith("<svg")) {
    const svgCount = code.match(SVG_TAG_RE)?.length ?? 0;
    if (svgCount !== 1) {
      return `SVG widget 必须恰好包含一个 <svg> 元素，当前检测到 ${svgCount} 个。请合并为一幅图后重新提交。`;
    }
    if (!SVG_VIEWBOX_RE.test(code)) {
      return 'SVG 的 viewBox 必须是 "0 0 680 <高度>"（680 是固定坐标基准宽度，根 svg 的 width 写 100%，高度 = 最底部元素 + 20）。请按 680 宽坐标系重排后重新提交。';
    }
  }
  return void 0;
}

function fail(message) {
  const payload = {
    type: "visualizer_show_widget_result",
    success: false,
    message
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: payload
  };
}

function visualizerExtensionFactory() {
  declareReadOnlyTools(["read_me", "show_widget"]);
  return (pi) => {
    pi.registerTool({
      name: "read_me",
      // 「可视化指南」而不是「设计指南」：与 tool.visualizerReadMe 同词，
      // 也让界面上的这行（「读取可视化指南中 / 已读取可视化指南」）一看就知道读的不是用户文件。
      label: "读取可视化指南",
      description: "返回 show_widget 的设计指南：CSS 变量、配色、排版、SVG 布局管线或 Chart.js 规则与示例。第一次调用 show_widget 之前必须先调用本工具加载对应模块；之后要换一种可视化类型时，按新模块再调一次。这是内部准备步骤——不要向用户提及或叙述这次调用。",
      promptSnippet: "read_me: 首次 show_widget 前按模块（diagram | chart）加载设计指南；内部步骤，不要向用户提及",
      promptGuidelines: [
        "生成任何可视化之前先 read_me 加载对应模块的指南，产出的尺寸、配色、字号必须遵守指南。",
        "不要向用户叙述 read_me 这次调用本身；指南是给你看的，不是给用户的。"
      ],
      parameters: Type.Object({
        modules: Type.Union([Type.Array(Type.String()), Type.String()], {
          description: '要加载的模块："diagram"（SVG 流程图/结构图/示意图）或 "chart"（Chart.js 数据图表）。数组（["diagram"]）或字符串（"diagram,chart"）均可，可同时传两个。'
        })
      }),
      async execute(_toolCallId, params) {
        const modules = parseModules(params.modules);
        const payload = {
          type: "visualizer_read_me_result",
          content: modules.length === 0 ? NO_VALID_MODULE_TEXT : readGuides(modules)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          details: { type: "visualizer_read_me_result" }
        };
      }
    });
    pi.registerTool({
      name: "show_widget",
      label: "生成可视化",
      description: "把一段 SVG 或 HTML 片段作为可视化卡片内联渲染在文字回复旁边（图表、流程图、结构图等）。第一次使用前必须先调用 read_me 加载对应模块的设计指南并严格遵守。要点：只提交片段，不要完整 HTML 文档（禁 DOCTYPE/html/head/body/form，禁 localStorage，禁 position:fixed）；SVG 的 viewBox 必须是 0 0 680 <高度>（680 为固定坐标基准，width 写 100%）；数据图表用 Chart.js（cdnjs 的 UMD 普通 script）。校验失败会返回 success:false 与中文原因，按原因修正后重新提交。",
      promptSnippet: "show_widget: 提交 SVG/HTML 片段内联出图（先 read_me；SVG viewBox 固定 0 0 680 H）",
      promptGuidelines: [
        "第一次出图前必须先 read_me 对应模块；指南没加载就不要调用 show_widget。",
        "返回 success:false 时按 message 修正 widget_code 重新提交，不要把失败原因转述给用户。",
        "可视化只是补充：解释与结论照常写在文字回复里，不要用 widget 替代文字。"
      ],
      parameters: Type.Object({
        title: Type.Optional(
          Type.String({
            description: "可视化标题，用作卡片标题与下载文件名；空格与连字符会转成下划线。"
          })
        ),
        widget_code: Type.Optional(
          Type.String({
            description: "SVG 或 HTML 片段本体。SVG：恰好一个 <svg>，viewBox 为 0 0 680 <高度>，width=100%。HTML：定高容器 + 内容；Chart.js 用 cdnjs 的 UMD 普通 script 引入。"
          })
        ),
        loading_messages: Type.Optional(
          Type.Union([Type.String(), Type.Array(Type.String())], {
            description: '流式生成期间轮播的加载文案，1-4 条（如 "正在整理数据" "正在绘制图形"）。JSON 数组串或数组均可。'
          })
        )
      }),
      async execute(_toolCallId, params) {
        const title = typeof params.title === "string" ? params.title : "";
        if (title.trim() === "") {
          return fail("缺少必填参数 title（可视化标题）。请补上 title 后重新提交。");
        }
        const widgetCode = typeof params.widget_code === "string" ? params.widget_code : "";
        if (widgetCode.trim() === "") {
          return fail("缺少必填参数 widget_code（SVG/HTML 片段本体）。");
        }
        const loadingMessages = normalizeLoadingMessages(params.loading_messages);
        if (loadingMessages === void 0) {
          return fail(
            'loading_messages 无法解析：请给 JSON 数组串或数组（1-4 条非空文案），例如 ["正在整理数据","正在绘制图形"]。'
          );
        }
        if (loadingMessages.length < 1 || loadingMessages.length > 4) {
          return fail(
            `loading_messages 需要 1-4 条加载文案，当前为 ${loadingMessages.length} 条。请增减到区间内后重新提交。`
          );
        }
        const trimmedCode = widgetCode.trim();
        const codeError = validateWidgetCode(trimmedCode);
        if (codeError !== void 0) {
          return fail(codeError);
        }
        const payload = {
          type: "visualizer_show_widget_result",
          success: true,
          title: normalizeTitle(title),
          widget_code: widgetCode,
          loading_messages: loadingMessages,
          // render_mode 由内容形态推断（无类型枚举）：<svg 开头走 SVG 管线，其余按 HTML。
          render_mode: trimmedCode.toLowerCase().startsWith("<svg") ? "svg" : "html"
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          details: payload
        };
      }
    });
  };
}

export {
	BASE_GUIDE_FILES,
	DOC_WRAPPER_RE,
	FIXED_POSITION_RE,
	FORM_RE,
	MODULE_GUIDE_FILES,
	NO_VALID_MODULE_TEXT,
	SVG_TAG_RE,
	SVG_VIEWBOX_RE,
	TodoItemSchema,
	WEB_STORAGE_RE,
	confirmText,
	createUseSkillTool,
	fail,
	normalizeLoadingMessages,
	normalizeTitle,
	parseModules,
	readGuides,
	todoExtensionFactory,
	validateWidgetCode,
	visualizerExtensionFactory,
};