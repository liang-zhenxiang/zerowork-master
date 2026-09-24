import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
import { randomUUID } from "node:crypto";
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
import {
	nextRunAfter,
	scheduleSummary,
	validateSchedule,
} from "./schedule.js";
import { declareReadOnlyTools } from "./command-exec.js";
import {
	gitOutcome,
	runGit,
} from "./git-worktree.js";

async function removeWorktree(repoCwd, worktreePath) {
  await runGit(["worktree", "remove", "--force", worktreePath], repoCwd);
  await gitOutcome(["worktree", "prune"], repoCwd);
}

const SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "out",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage"
]);

function indexFiles(root, options = {}) {
  const maxEntries = options.maxEntries ?? 2e3;
  const maxDepth = options.maxDepth ?? 8;
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) return [];
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= maxEntries || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxEntries) return;
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root, 0);
  return out.sort();
}

const scheduleSchema = Type.Union([
  Type.Object({
    type: Type.Literal("once"),
    at: Type.String({
      description: "触发时刻，ISO 8601 格式（如 2026-09-10T09:00:00）。不带时区按本地时间解释；参照系统提示词里给出的当前时间推算，必须是将来的时刻。"
    })
  }),
  Type.Object({
    type: Type.Literal("interval"),
    everyMinutes: Type.Integer({
      minimum: 1,
      description: "间隔分钟数，最小为 1（如 30 表示每 30 分钟一次）。"
    })
  }),
  Type.Object({
    type: Type.Literal("daily"),
    time: Type.String({
      description: "每天的触发时刻，HH:mm（24 小时制、小时两位，如 09:00）。"
    })
  }),
  Type.Object({
    type: Type.Literal("weekly"),
    time: Type.String({
      description: "触发时刻，HH:mm（24 小时制、小时两位，如 09:00）。"
    }),
    weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), {
      minItems: 1,
      description: "星期集合：0=周日、1=周一 … 6=周六，至少含一个（工作日填 [1,2,3,4,5]）。"
    })
  })
]);

function toSchedule(input) {
  switch (input.type) {
    case "once":
      return { type: "once", at: parseLocalDateTime(input.at) };
    case "interval":
      return { type: "interval", everyMinutes: input.everyMinutes };
    case "daily":
      return { type: "daily", time: input.time };
    case "weekly": {
      const invalid = input.weekdays.filter((d) => !Number.isInteger(d) || d < 0 || d > 6);
      if (invalid.length > 0) {
        throw new Error(
          `weekdays 里的星期必须是 0-6 的整数（0=周日 … 6=周六），收到非法值：${invalid.join("、")}。请改正后重试。`
        );
      }
      return { type: "weekly", time: input.time, weekdays: [...new Set(input.weekdays)] };
    }
  }
}

function parseLocalDateTime(at) {
  const trimmed = at.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
  const ms = new Date(normalized).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(
      `无法解析触发时刻「${at}」。请用 ISO 8601 格式（如 2026-09-10T09:00:00），不带时区时按本地时间解释。`
    );
  }
  return ms;
}

function formatLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => n < 10 ? `0${n}` : `${n}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function briefLine(task) {
  return `- 「${task.name}」（id: ${task.id}，${scheduleSummary(task.schedule)}，状态：${task.status}）`;
}

function automationExtensionFactory(store, getCurrentCwd) {
  declareReadOnlyTools(["automation_list"]);
  return (pi) => {
    pi.registerTool({
      name: "automation_create",
      label: "创建定时任务",
      description: "创建一个定时任务：到点后系统会以任务的工作目录开启一场全新会话，自动执行 prompt 里的指令。用户想让某件事「定时 / 每天 / 每周 / 每隔多久」自动完成时使用。注意：未来的运行看不到本次对话，prompt 必须自包含 —— 时间、文件路径、对象名称（项目名 / 目录 / 文件）都要写进指令本身，不能用「这个」「刚才那份」这类指代。",
      promptSnippet: "automation_create: 用户要「定时/每天/每周」自动做的事，创建定时任务（prompt 必须自包含，写全时间/路径/对象）",
      promptGuidelines: [
        "定时任务的 prompt 必须自包含：未来的运行是一场全新会话，看不到当前对话；时间、文件路径、对象名称都要写进指令本身。",
        "创建定时任务成功后，在回复中向用户复述实际生效的调度与下次运行时间。"
      ],
      parameters: Type.Object({
        name: Type.String({ description: "任务名称，要可辨识（如「工作日早报」）。" }),
        prompt: Type.String({
          description: "到点自动执行的完整指令。必须自包含：写全时间、文件路径、对象名称，不依赖当前对话的上下文。"
        }),
        schedule: scheduleSchema,
        cwd: Type.Optional(
          Type.String({
            description: "任务运行的工作目录，缺省取当前会话的工作目录。任务要操作哪个项目就填那个项目的目录。"
          })
        )
      }),
      async execute(_toolCallId, params) {
        const name = params.name.trim();
        if (name === "") {
          throw new Error("任务名称不能为空。请给任务起一个可辨识的名字（如「工作日早报」）。");
        }
        const prompt = params.prompt.trim();
        if (prompt === "") {
          throw new Error(
            "任务指令（prompt）不能为空。定时任务在未来以全新会话运行、看不到当前对话，请把要执行的内容完整写进 prompt。"
          );
        }
        const cwd = (params.cwd ?? getCurrentCwd()).trim();
        if (cwd === "") {
          throw new Error("未指定 cwd 且当前会话没有工作目录。请显式传入任务的运行目录（cwd）。");
        }
        const schedule = toSchedule(params.schedule);
        const invalid = validateSchedule(schedule);
        if (invalid !== void 0) {
          throw new Error(`调度参数不合法：${invalid}。请改正 schedule 后重新调用。`);
        }
        const nextRunAt = nextRunAfter(schedule, Date.now());
        if (nextRunAt === void 0) {
          throw new Error(
            "指定的触发时刻已经过去，一次性任务不会补跑。请把 schedule 的 at 改成一个将来的时刻再创建。"
          );
        }
        const now = Date.now();
        const task = {
          id: randomUUID(),
          name,
          prompt,
          schedule,
          status: "active",
          cwd,
          nextRunAt,
          runs: [],
          createdAt: now,
          updatedAt: now
        };
        store.upsert(task);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "automation_created",
                id: task.id,
                name: task.name,
                schedule: scheduleSummary(task.schedule),
                nextRunAt: formatLocal(nextRunAt),
                cwd: task.cwd,
                message: "定时任务已创建。请在回复中向用户说明实际生效的调度与下次运行时间。"
              })
            }
          ],
          details: { taskId: task.id }
        };
      }
    });
    pi.registerTool({
      name: "automation_list",
      label: "列出定时任务",
      description: "列出全部定时任务：id、名称、调度摘要、状态、下次与上次运行时间、运行次数。用户问「我有哪些定时任务」、或删除前需要核对任务 id 时使用。不含任务指令全文。",
      promptSnippet: "automation_list: 列出全部定时任务（名称/调度/状态/下次运行时间）",
      parameters: Type.Object({}),
      async execute() {
        const tasks = store.list();
        if (tasks.length === 0) {
          return {
            content: [{ type: "text", text: "当前没有任何定时任务。" }],
            details: { count: 0 }
          };
        }
        const summary = tasks.map((t) => ({
          id: t.id,
          name: t.name,
          schedule: scheduleSummary(t.schedule),
          status: t.status,
          nextRunAt: t.nextRunAt === void 0 ? null : formatLocal(t.nextRunAt),
          lastRunAt: t.lastRunAt === void 0 ? null : formatLocal(t.lastRunAt),
          runs: t.runs.length
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          details: { count: tasks.length }
        };
      }
    });
    pi.registerTool({
      name: "automation_delete",
      label: "删除定时任务",
      description: "删除一个定时任务，按 id 或名称指定（同时给出时以 id 为准）。名称只在精确匹配且唯一命中时删除；有同名任务或找不到时会返回候选列表，需与用户确认或改用 id。删除前如不确定有哪些任务，先调 automation_list。",
      promptSnippet: "automation_delete: 按 id 或名称删除定时任务（同名歧义时改用 id）",
      parameters: Type.Object({
        id: Type.Optional(
          Type.String({ description: "任务 id（automation_list 可查）。与 name 同时给出时以 id 为准。" })
        ),
        name: Type.Optional(
          Type.String({ description: "任务名称。精确匹配且唯一命中时才删除；有同名任务会返回候选列表。" })
        )
      }),
      async execute(_toolCallId, params) {
        const id = params.id?.trim();
        const name = params.name?.trim();
        if ((id === void 0 || id === "") && (name === void 0 || name === "")) {
          throw new Error(
            "请提供要删除的任务 id 或名称（name）。不确定有哪些任务时，先调 automation_list 查看。"
          );
        }
        if (id !== void 0 && id !== "") {
          const task = store.get(id);
          if (task === void 0) {
            throw new Error(
              `没有找到 id 为「${id}」的定时任务。请用 automation_list 获取现有任务的 id 后重试。`
            );
          }
          store.remove(task.id);
          return removedResult(task);
        }
        const matches = store.list().filter((t) => t.name === name);
        const [only] = matches;
        if (matches.length === 1 && only !== void 0) {
          store.remove(only.id);
          return removedResult(only);
        }
        if (matches.length === 0) {
          const all = store.list();
          const candidates = all.length === 0 ? "当前没有任何定时任务。" : `现有任务：
${all.map(briefLine).join("\n")}`;
          return {
            content: [
              {
                type: "text",
                text: `没有找到名为「${name ?? ""}」的定时任务，未删除任何任务。
${candidates}
请与用户核对名称，或改用 id 删除。`
              }
            ],
            details: {}
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `名为「${name ?? ""}」的定时任务有 ${matches.length} 个，无法确定删除哪一个，未删除任何任务：
${matches.map(briefLine).join("\n")}
请与用户确认后，用 id 指定要删除的任务。`
            }
          ],
          details: {}
        };
      }
    });
  };
}

function removedResult(task) {
  return {
    content: [
      {
        type: "text",
        text: `已删除定时任务「${task.name}」（${scheduleSummary(task.schedule)}，id: ${task.id}）。`
      }
    ],
    details: { taskId: task.id }
  };
}

const DEFAULT_LIMIT = 20;

const NO_HIT_TEXT = "没有找到包含这些关键词的历史会话。可以换更核心的关键词（项目名、文件名、具体名词）或减少关键词数量再试一次；如果要找的内容就在当前这场对话里，直接根据当前上下文回答即可，不需要检索。";

function formatWhen(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHits(hits) {
  const sections = hits.map(
    (hit, i) => `【${i + 1}】${hit.title}（${formatWhen(hit.modifiedAt)}）
${hit.snippet}`
  );
  return `找到 ${hits.length} 个包含这些关键词的历史会话：

${sections.join("\n\n---\n\n")}`;
}

function conversationSearchExtensionFactory(deps) {
  declareReadOnlyTools(["conversation_search"]);
  return (pi) => {
    pi.registerTool({
      name: "conversation_search",
      label: "检索历史会话",
      description: "按关键词检索本机保存的历史会话，返回命中会话的标题、日期与命中处的上下文片段。当用户提到「之前讨论过」「上次那个方案」这类过去对话里的内容、而当前上下文中没有时，用它回忆细节。查询必须自包含：这个工具看不到当前对话，要把「刚才说的那个报告」换成「Q3 营收报告」这类具体关键词再查。多个关键词是「并且」关系：只有全部包含的会话才会命中。",
      promptSnippet: "conversation_search: 按关键词检索历史会话（查询要自包含，工具看不到当前对话；用户提及过去的讨论而当前上下文没有时用）",
      promptGuidelines: [
        "查询写成自包含的关键词组：把用户话里的指代（这个、上次那个）替换成具体名词（项目名、文件名、主题）再查，否则大概率查不到。",
        "当前对话里就有的内容直接回答，不要检索——这个工具只查历史会话，查不到当前这场。",
        "没找到时换更核心的关键词或减少关键词数量重试一次；仍没有就如实告诉用户没找到，不要编造。"
      ],
      parameters: Type.Object({
        query: Type.String({
          minLength: 1,
          description: "检索关键词，空格分隔多个词（全部命中才算匹配）。必须自包含：写具体名词，不写指代。"
        }),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 50,
            description: `最多返回几个会话，缺省 ${DEFAULT_LIMIT}。`
          })
        )
      }),
      async execute(_toolCallId, params) {
        const hits = await deps.searchSessions(params.query, params.limit ?? DEFAULT_LIMIT);
        if (hits.length === 0) {
          return {
            content: [{ type: "text", text: NO_HIT_TEXT }],
            details: { hitCount: 0 }
          };
        }
        return {
          content: [{ type: "text", text: formatHits(hits) }],
          details: { hitCount: hits.length }
        };
      }
    });
  };
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1e3));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function formatState(summary, now) {
  if (summary.state === "running") return `运行中，已运行 ${formatDuration(now - summary.startedAt)}`;
  const code = summary.exitCode === null ? "被杀（无退出码）" : `退出码 ${summary.exitCode}`;
  const ran = summary.endedAt === void 0 ? "" : `，共运行 ${formatDuration(summary.endedAt - summary.startedAt)}`;
  return `已退出，${code}${ran}`;
}

function createJobTools(options) {
  return (pi) => {
    pi.registerTool({
      name: "job_output",
      label: "读取后台任务输出",
      description: "读取某个后台任务（用 powershell 的 run_in_background 启动）**自上次读取以来**的新增输出。同一份输出不会被读第二遍，所以排队等它的启动日志时可以反复调用本工具。",
      promptSnippet: "job_output: 读后台任务的新增输出（每次只给上次之后的部分；任务就绪前反复调用即可等到日志）",
      promptGuidelines: [
        "jobId 用启动时返回的那个（形如 job-1）；不确定是哪个就先 job_list。",
        "每次只返回**新增**输出，所以「没有输出」不等于任务死了 —— 状态行会说明它还在运行还是已退出。",
        "服务类任务的启动日志往往要几秒才出现：不要因为一次没读到就重起一个（端口会被占）。"
      ],
      parameters: Type.Object({
        jobId: Type.String({
          minLength: 1,
          description: "后台任务 id（启动时返回，形如 job-1）。"
        })
      }),
      async execute(_toolCallId, params) {
        const result = options.output(params.jobId);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `读取后台任务输出失败：${result.reason}` }],
            details: { jobId: params.jobId, ok: false, state: void 0, exitCode: void 0 }
          };
        }
        const stateLine = formatState(result, Date.now());
        const body = result.text === "" ? "（自上次读取以来没有新输出）" : result.text.trimEnd();
        return {
          content: [
            {
              type: "text",
              text: `任务 ${result.id}（${stateLine}）
命令：${result.command}
pid：${result.pid}
【新增输出】
${body}`
            }
          ],
          details: {
            jobId: result.id,
            ok: true,
            state: result.state,
            exitCode: result.exitCode
          }
        };
      }
    });
    pi.registerTool({
      name: "job_kill",
      label: "停止后台任务",
      description: "停止一个后台任务：关闭它的 Job 句柄即杀掉整棵进程树（含它拉起的子进程）。任务已经结束时不报错，只如实说明。用完后请收掉，别把服务留在后台。",
      promptSnippet: "job_kill: 停止后台任务（杀整棵进程树）；已经结束的任务不算错误",
      promptGuidelines: [
        "任务已经结束时调用它是安全的（结果会说「已经结束」），不需要先判断。",
        "jobId 不确定就先 job_list。"
      ],
      parameters: Type.Object({
        jobId: Type.String({
          minLength: 1,
          description: "要停止的后台任务 id（启动时返回，形如 job-1）。"
        })
      }),
      async execute(_toolCallId, params) {
        const result = options.kill(params.jobId);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `未停止后台任务：${result.reason}` }],
            details: { jobId: params.jobId, ok: false, killed: void 0 }
          };
        }
        return {
          content: [
            {
              type: "text",
              text: result.killed ? `已停止后台任务 ${params.jobId}（整棵进程树已收掉）。` : `后台任务 ${params.jobId} 已经结束了，无需停止。`
            }
          ],
          details: { jobId: params.jobId, ok: true, killed: result.killed }
        };
      }
    });
    pi.registerTool({
      name: "job_list",
      label: "列出后台任务",
      description: "列出本会话启动过的后台任务（id、状态、命令、pid、运行时长）。起常驻服务之前先用它确认没有同一个服务已经在跑；忘了 jobId 时也用它。",
      promptSnippet: "job_list: 列本会话的后台任务（起服务前先看有没有已在跑的，避免撞端口）",
      // 只有一条但必须写：模型最常犯的错是「重新起一个」而不是「读已有的」。
      promptGuidelines: ["要起常驻服务前先 job_list 看一眼：同一个服务已经在跑时，重起会撞端口。"],
      parameters: Type.Object({}),
      async execute() {
        const jobs = options.list();
        if (jobs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "本会话还没有后台任务。需要常驻服务（监听端口、WebSocket bridge、watcher）时，用 powershell 带 run_in_background: true 启动。"
              }
            ],
            details: { count: 0 }
          };
        }
        const now = Date.now();
        const lines = jobs.map(
          (job) => `${job.id} [${formatState(job, now)}] ${job.command}（pid ${job.pid}）`
        );
        return {
          content: [
            {
              type: "text",
              text: `本会话的后台任务（${jobs.length} 个）：
${lines.join("\n")}`
            }
          ],
          details: { count: jobs.length }
        };
      }
    });
  };
}

export {
	DEFAULT_LIMIT,
	NO_HIT_TEXT,
	SKIP_DIRS,
	automationExtensionFactory,
	briefLine,
	conversationSearchExtensionFactory,
	createJobTools,
	formatDuration,
	formatHits,
	formatLocal,
	formatState,
	formatWhen,
	indexFiles,
	parseLocalDateTime,
	removeWorktree,
	removedResult,
	scheduleSchema,
	toSchedule,
};