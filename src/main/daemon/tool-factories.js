import { basename } from "node:path";
import { createHash } from "node:crypto";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { extname } from "node:path";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { normalize as normalize$1 } from "node:path";
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { resolve } from "node:path";
import { sep } from "node:path";
import { Type } from "typebox";
import { clipAuditDetail } from "./audit.js";
import {
	CHILD_AGENTS_DETAILS_KEY,
	ChildAgentsProjection,
} from "./session-view.js";
import { declareReadOnlyTools } from "./command-exec.js";

const UNATTENDED_TEXT = "当前是无人值守运行（定时任务），没有人在场，无法向用户提问。请按现有信息继续完成任务；确有绕不开的分歧，在最终结果中如实说明这一点。";

const SKIPPED_TEXT = "用户跳过了这次提问，没有选择任何答案。按现有信息继续完成任务，不要就同一问题再向用户追问。";

function questionnaireExtensionFactory(options) {
  declareReadOnlyTools(["questionnaire"]);
  return (pi) => {
    pi.registerTool({
      name: "questionnaire",
      label: "向用户提问",
      description: "动手前就关键选择向用户发起结构化提问，阻塞等待作答后返回答案。一次提 1-4 个问题，每题给 2-6 个候选选项；用户逐题单选，每题也可以选「其他」自由补充，还可以整卡跳过。只用在答案会改变执行方向的关键决策点（成果给谁看、要什么风格、按哪个方向改）；能从工作区查到的信息、无关紧要的细节不要问。",
      promptSnippet: "questionnaire: 动手前就影响方向的关键选择向用户提问（1-4 题，每题 2-6 个互斥选项；用户可跳过，跳过就按现有信息继续、不再追问）",
      promptGuidelines: [
        "只在答案会改变执行方向时提问；能从文件或对话上下文推断的不要问——提问是一次打断，把真正影响方向的问题一次问清。",
        "选项之间要互斥、覆盖常见情况；覆盖不全没关系，用户可以用每题的「其他」自由补充，不要硬凑选项。",
        "被跳过后按现有信息继续，不要换个问法就同一问题再次提问。"
      ],
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            question: Type.String({
              minLength: 1,
              description: "问题正文，一句话说清要用户定什么。"
            }),
            options: Type.Array(Type.String({ minLength: 1 }), {
              minItems: 2,
              maxItems: 6,
              description: "候选答案，2-6 个。互斥并覆盖常见情况；「其他」由界面固定提供，不要写进选项。"
            })
          }),
          {
            minItems: 1,
            maxItems: 4,
            description: "要问的问题，1-4 个。只问真正影响方向的关键决策，一次问清。"
          }
        )
      }),
      async execute(_toolCallId, params) {
        if (options.unattended === true) {
          return {
            content: [{ type: "text", text: UNATTENDED_TEXT }],
            details: { skipped: false }
          };
        }
        const response = await options.requestAnswers({
          id: randomUUID(),
          questions: params.questions
        });
        if (response.skipped) {
          return {
            content: [{ type: "text", text: SKIPPED_TEXT }],
            details: { skipped: true }
          };
        }
        const settled = params.questions.map((q) => {
          const hit = response.answers.find((a) => a.question === q.question);
          return { question: q.question, answer: hit?.answer ?? "（用户未回答此题）" };
        });
        return {
          content: [{ type: "text", text: JSON.stringify(settled, null, 2) }],
          details: { skipped: false }
        };
      }
    });
  };
}

function createSkillInstallTool(options) {
  return (pi) => {
    pi.registerTool({
      name: "skill_install",
      label: "安装技能",
      description: "把工作区里做好的技能目录装进用户技能目录（跨工作区可用），装完即出现在技能页，并在工作区打出一份可分发的 zip。只在用户要求创建/更新技能、且技能文件已经写在工作区里之后调用。",
      promptSnippet: "skill_install: 技能在工作区里写好后用它安装（入参是那个技能目录的绝对路径或它的 SKILL.md），装完再用 present_files 交付它打好的 zip",
      promptGuidelines: [
        "入参是工作区里那个技能目录的路径（或它的 SKILL.md 文件路径），不要传还没写好的路径、也不要传技能名。",
        "装完把返回里的 zip 路径交给 present_files 交付给用户（分享/备份用），并把技能名、安装位置、触发方式一并转述。",
        "安装失败时把工具返回的原始错误按原样转述给用户，并指出要改 SKILL.md 的哪一处；不要只说「安装失败了」。",
        "同名技能：模型自己创建过的可直接覆盖（改技能就是重装一次）；不是模型创建的会被拒 —— 那时请用户到技能页「打开技能目录」处理。"
      ],
      parameters: Type.Object({
        sourcePath: Type.String({
          minLength: 1,
          description: "工作区里含 SKILL.md 的技能目录绝对路径，或该 SKILL.md 的绝对路径。"
        })
      }),
      async execute(_toolCallId, params) {
        const skill = options.installSkill(params.sourcePath.trim());
        const lines = [
          `技能「${skill.name}」已安装到用户技能目录：${skill.filePath}`,
          `触发方式：对话里 /skill:${skill.name}，或让模型按描述自动加载（use_skill "${skill.name}"）。`,
          "它已出现在技能页的列表里，用户可在那里停用它；下一轮对话即生效。"
        ];
        const workspaceDir = options.getWorkspaceDir();
        let zipPath;
        if (workspaceDir === void 0) {
          lines.push("本次会话没有工作区，未生成可分享的 zip；技能本身已装好。");
        } else {
          zipPath = join(workspaceDir, `${skill.name}.zip`);
          try {
            const bytes = await options.packSkill(dirname(skill.filePath), zipPath);
            lines.push(`可分发的打包已生成：${zipPath}（${bytes} 字节）—— 用 present_files 交付它。`);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            lines.push(`技能已装好，但打包 zip 失败：${reason}`);
            zipPath = void 0;
          }
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { name: skill.name, filePath: skill.filePath, ...zipPath === void 0 ? {} : { zipPath } }
        };
      }
    });
  };
}

function createSkillUninstallTool(options) {
  return (pi) => {
    pi.registerTool({
      name: "skill_uninstall",
      label: "删除技能",
      description: "删除一个由模型自己创建的技能（此前用 skill_install 装上的）。只在用户明确要求删除某个技能时调用；内置、市场安装与用户手工放置的技能会被拒，那些要用户自己在技能页处理。",
      promptSnippet: "skill_uninstall: 用户要求删掉某个技能时用它（入参是技能名）",
      promptGuidelines: [
        "只在用户明确说要删掉某个技能时调用，不要为了「清理」自作主张删。",
        "入参是 frontmatter 里的 name（小写字母/数字/连字符），不是技能目录的路径。",
        "被拒时把原始错误原样转述：它要么说这个技能不是模型创建的（要用户自己去技能页处理），要么说这个名字不存在。"
      ],
      parameters: Type.Object({
        name: Type.String({
          minLength: 1,
          description: "要删除的技能名（SKILL.md frontmatter 里的 name，如 weekly-report）。"
        })
      }),
      async execute(_toolCallId, params) {
        const removed = options.removeSkill(params.name.trim());
        return {
          content: [
            {
              type: "text",
              text: `技能「${removed.name}」已删除：${removed.dir}
它已从技能页列表与 / 菜单里消失；下一轮对话的清单段不再包含它。`
            }
          ],
          details: { name: removed.name, dir: removed.dir }
        };
      }
    });
  };
}

const BACKGROUND_JOBS_MAX_PER_SESSION = 8;

const KILL_SETTLE_TIMEOUT_MS = 2e3;

function mergeStreams(stdout, stderr) {
  const parts = [];
  if (stdout !== "") parts.push(stdout.trimEnd());
  if (stderr !== "") {
    parts.push(
      stderr.trimEnd().split("\n").map((line) => `[stderr] ${line}`).join("\n")
    );
  }
  return parts.join("\n");
}

function createBackgroundJobRegistry(options = {}) {
  const maxPerSession = options.maxPerSession ?? BACKGROUND_JOBS_MAX_PER_SESSION;
  const records = /* @__PURE__ */ new Map();
  let seq2 = 0;
  const observe = (record) => {
    const snapshot2 = record.handle.snapshot();
    if (!snapshot2.running && record.endedAt === void 0) record.endedAt = Date.now();
    return snapshot2;
  };
  const find = (id, sessionKey) => {
    const record = records.get(id);
    if (record === void 0) {
      return {
        ok: false,
        reason: `未知的任务 id「${id}」：本会话没有这个任务（可能已被清理，或从来没有过）。先用 job_list 查看本会话的后台任务。`
      };
    }
    if (record.sessionKey !== sessionKey) {
      return {
        ok: false,
        reason: `任务「${id}」不属于当前会话：后台任务按会话隔离，只能读/停本会话启动的任务。先用 job_list 查看本会话的后台任务。`
      };
    }
    return { ok: true, record };
  };
  const auditStopped = (record) => {
    options.onAudit?.({
      category: "sandbox",
      outcome: "allowed",
      detail: clipAuditDetail(`后台任务已停止（pid ${record.pid}）：${record.command}`)
    });
  };
  const countRunning = (sessionKey) => {
    let count = 0;
    for (const record of records.values()) {
      if (record.sessionKey !== sessionKey) continue;
      if (observe(record).running) count += 1;
    }
    return count;
  };
  const settleAll = async (targets) => {
    await Promise.all(
      targets.map(async (record) => {
        const wasRunning = observe(record).running;
        try {
          record.handle.kill();
        } catch {
        }
        if (wasRunning) auditStopped(record);
        await Promise.race([
          record.handle.done.then(
            () => void 0,
            () => void 0
          ),
          new Promise((resolve2) => {
            const timer = setTimeout(resolve2, KILL_SETTLE_TIMEOUT_MS);
            timer.unref();
          })
        ]);
      })
    );
    for (const record of targets) records.delete(record.id);
  };
  return {
    register(input) {
      const running = countRunning(input.sessionKey);
      if (running >= maxPerSession) {
        return {
          ok: false,
          reason: `本会话运行中的后台任务已达上限（${maxPerSession} 个）。请先用 job_kill 停掉不再需要的，或等其中某个自然结束后再试。`
        };
      }
      seq2 += 1;
      const id = `job-${seq2}`;
      records.set(id, {
        id,
        sessionKey: input.sessionKey,
        command: input.command,
        pid: input.pid,
        startedAt: Date.now(),
        handle: input.handle,
        stdoutOffset: 0,
        stderrOffset: 0,
        endedAt: void 0
      });
      void input.handle.done.catch(() => void 0);
      return { ok: true, id };
    },
    output(id, sessionKey) {
      const found = find(id, sessionKey);
      if (!found.ok) return { ok: false, reason: found.reason };
      const record = found.record;
      const snapshot2 = observe(record);
      const stdout = snapshot2.stdout.slice(record.stdoutOffset);
      const stderr = snapshot2.stderr.slice(record.stderrOffset);
      record.stdoutOffset = snapshot2.stdout.length;
      record.stderrOffset = snapshot2.stderr.length;
      return {
        ok: true,
        id: record.id,
        command: record.command,
        pid: record.pid,
        startedAt: record.startedAt,
        state: snapshot2.running ? "running" : "exited",
        exitCode: snapshot2.exitCode,
        ...record.endedAt === void 0 ? {} : { endedAt: record.endedAt },
        text: mergeStreams(stdout, stderr)
      };
    },
    kill(id, sessionKey) {
      const found = find(id, sessionKey);
      if (!found.ok) return { ok: false, reason: found.reason };
      const snapshot2 = observe(found.record);
      if (!snapshot2.running) return { ok: true, killed: false };
      found.record.handle.kill();
      auditStopped(found.record);
      return { ok: true, killed: true };
    },
    list(sessionKey) {
      const summaries = [];
      for (const record of records.values()) {
        if (record.sessionKey !== sessionKey) continue;
        const snapshot2 = observe(record);
        summaries.push({
          id: record.id,
          command: record.command,
          pid: record.pid,
          state: snapshot2.running ? "running" : "exited",
          exitCode: snapshot2.exitCode,
          startedAt: record.startedAt,
          ...record.endedAt === void 0 ? {} : { endedAt: record.endedAt }
        });
      }
      return summaries;
    },
    async killAllForSession(sessionKey) {
      const targets = [...records.values()].filter((record) => record.sessionKey === sessionKey);
      await settleAll(targets);
    },
    async killAll() {
      await settleAll([...records.values()]);
    }
  };
}

const TaskItem = Type.Object({
  agent: Type.String({ minLength: 1, description: "要委派的子代理名。" }),
  task: Type.String({
    minLength: 1,
    description: "任务描述。子代理看不到这次对话，必须把背景、文件路径、要求写全。"
  })
});

const BUDGET_EXHAUSTED_TEXT = "本次会话的子代理调用预算已耗尽（每个会话最多 20 次，防止失控循环）。请按现有信息继续完成任务；确有必要，告知用户新建任务后再委派。";

function availableAgentsText(agents) {
  if (agents.length === 0) return "当前没有可用的子代理。";
  return `可用子代理：
${agents.map((a) => `- ${a.name}：${a.description}`).join("\n")}`;
}

function formatReport(report) {
  if (report.ok) {
    return `子代理「${report.agent}」完成（${report.turns} 轮）：
${report.text === "" ? "（无输出）" : report.text}`;
  }
  return `子代理「${report.agent}」失败：
诊断：${report.text}`;
}

function taskExtensionFactory(options) {
  declareReadOnlyTools(["task"]);
  const agentLines = options.listAgents().map((a) => `- ${a.name}：${a.description}`).join("\n");
  return (pi) => {
    pi.registerTool({
      name: "task",
      label: "子任务",
      description: `把可独立完成的子任务委派给子代理，在隔离上下文中执行，结果回传给你整合。三种用法恰好选一种：单发 { agent, task }；并行 { tasks: [{ agent, task }, ...] }（1-8 个，同时执行）；链式 { chain: [{ agent, task }, ...] }（1-8 步，顺序执行，task 里的 {previous} 会被替换为上一步输出）。子代理看不到这次对话：任务描述必须自包含，把需要的文件路径、背景与验收要求都写全。
可用子代理：
${agentLines}`,
      promptSnippet: "task: 把可独立的调研/汇总/执行委派给子代理（隔离上下文）——单发 agent+task、并行 tasks 数组、链式 chain 数组（{previous} 占位上一步输出）；任务描述必须自包含",
      promptGuidelines: [
        "子代理看不到这次对话，「这个」「刚才那份」这类指代会落空——任务描述里写全文件路径与背景。",
        "互相独立、可并行的事项用 tasks 一次发多个；后一步依赖前一步产出的用 chain 与 {previous} 占位符。",
        "琐碎的小事不要委派——委派的收益是隔离上下文与并行，一步能查完的直接自己查。"
      ],
      parameters: Type.Object({
        agent: Type.Optional(
          Type.String({ minLength: 1, description: "单发模式：要委派的子代理名。" })
        ),
        task: Type.Optional(
          Type.String({ minLength: 1, description: "单发模式：任务描述（自包含）。" })
        ),
        tasks: Type.Optional(
          Type.Array(TaskItem, {
            minItems: 1,
            maxItems: 8,
            description: "并行模式：1-8 个 { agent, task }，同时执行。"
          })
        ),
        chain: Type.Optional(
          Type.Array(TaskItem, {
            minItems: 1,
            maxItems: 8,
            description: "链式模式：1-8 步顺序执行，task 里可用 {previous} 引用上一步输出。"
          })
        )
      }),
      async execute(_toolCallId, params, signal, onUpdate) {
        const singleAgent = params.agent;
        const singleTask = params.task;
        const tasks = params.tasks;
        const chain = params.chain;
        const modeCount = Number(singleAgent !== void 0) + Number(tasks !== void 0) + Number(chain !== void 0);
        if (singleAgent === void 0 !== (singleTask === void 0) || modeCount !== 1) {
          return {
            content: [
              {
                type: "text",
                text: "task 工具需要且只能选择一种用法：单发 { agent, task }、并行 { tasks: [...] } 或链式 { chain: [...] }。请按其中一种重新调用。"
              }
            ],
            details: { mode: "single", results: [], subagents: [] }
          };
        }
        const mode = tasks !== void 0 ? "parallel" : chain !== void 0 ? "chain" : "single";
        const agents = options.listAgents();
        const plan = tasks ?? chain ?? // 走到这里三选一判定已保证单发两半齐全；写全条件让窄化自足。
        (singleAgent !== void 0 && singleTask !== void 0 ? [{ agent: singleAgent, task: singleTask }] : []);
        const projection = new ChildAgentsProjection(
          plan.map((p) => ({
            agent: p.agent,
            task: p.task,
            // model 徽标数据在初始化时定格（agent 定义在会话内不变）。
            model: agents.find((a) => a.name === p.agent)?.model
          }))
        );
        const emitProjection = () => {
          onUpdate?.({
            content: [{ type: "text", text: "" }],
            details: { mode, results: [], subagents: projection.snapshot() }
          });
        };
        emitProjection();
        const stripPrefix = (agentName, text) => {
          const prefix = `${agentName}：`;
          return text.startsWith(prefix) ? text.slice(prefix.length) : text;
        };
        const runOne = async (index, agentName, taskText) => {
          const agent = agents.find((a) => a.name === agentName);
          if (agent === void 0) {
            const text = `没有名为「${agentName}」的子代理。${availableAgentsText(agents)}
请改用上述之一重新委派。`;
            projection.patch(index, { status: "failed", output: text });
            emitProjection();
            return { agent: agentName, ok: false, text, turns: 0 };
          }
          if (!options.checkBudget()) {
            projection.patch(index, { status: "failed", output: BUDGET_EXHAUSTED_TEXT });
            emitProjection();
            return { agent: agentName, ok: false, text: BUDGET_EXHAUSTED_TEXT, turns: 0 };
          }
          projection.patch(index, { status: "running" });
          emitProjection();
          try {
            const { output, turns } = await options.runSubagent({
              agent,
              task: taskText,
              ...signal === void 0 ? {} : { signal },
              // 排队消息（并发上限超出的「排队等待空位」）也经此落到
              // activity：状态保持 running，等待原因对用户可见。
              onProgress: (text) => {
                projection.pushActivity(index, stripPrefix(agent.name, text));
                emitProjection();
              }
            });
            projection.patch(index, { status: "done", turns, output });
            emitProjection();
            return { agent: agentName, ok: true, text: output, turns };
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            projection.patch(index, { status: "failed", output: text });
            emitProjection();
            return { agent: agentName, ok: false, text, turns: 0 };
          }
        };
        const finalDetails = (results) => ({
          mode,
          results,
          subagents: projection.snapshot()
        });
        if (singleAgent !== void 0 && singleTask !== void 0) {
          const report = await runOne(0, singleAgent, singleTask);
          return {
            content: [{ type: "text", text: formatReport(report) }],
            details: finalDetails([report])
          };
        }
        if (tasks !== void 0) {
          const reports2 = await Promise.all(
            tasks.map((t, index) => runOne(index, t.agent, t.task))
          );
          const okCount = reports2.filter((r) => r.ok).length;
          return {
            content: [
              {
                type: "text",
                text: `并行执行 ${reports2.length} 个子任务，成功 ${okCount} 个：

` + reports2.map(formatReport).join("\n\n---\n\n")
              }
            ],
            details: finalDetails(reports2)
          };
        }
        if (chain === void 0) {
          throw new Error("task 工具模式判定失效：三种用法均未命中");
        }
        const reports = [];
        let previous = "";
        for (const [index, step] of chain.entries()) {
          const report = await runOne(index, step.agent, step.task.replaceAll("{previous}", previous));
          reports.push(report);
          if (!report.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: `链式执行在第 ${reports.length} 步（${step.agent}）中止，后续步骤未执行：

` + reports.map(formatReport).join("\n\n---\n\n")
                }
              ],
              details: finalDetails(reports)
            };
          }
          previous = report.text;
        }
        return {
          content: [
            {
              type: "text",
              text: `链式执行完成 ${reports.length} 步：

` + reports.map(formatReport).join("\n\n---\n\n")
            }
          ],
          details: finalDetails(reports)
        };
      }
    });
  };
}

const TaskInputItem = Type.Object({
  title: Type.String({ minLength: 1, description: "任务标题（一句话，可判定完成）。" }),
  detail: Type.Optional(Type.String({ description: "任务说明（自包含：成员看不到本会话历史）。" })),
  owner: Type.Optional(Type.String({ description: "指派的成员名（@寻址键）；缺省 = 未指派。" })),
  blockedBy: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: "依赖的任务 id（必须已创建）；上游全部完成后本任务自动变 ready。"
    })
  )
});

function renderTask(task, all) {
  const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
  const owner = task.owner === void 0 ? "未指派" : task.owner;
  const deps = task.blockedBy.length === 0 ? "" : `｜依赖：${task.blockedBy.map((id) => `${id}(${byId.get(id)?.status ?? "?"})`).join("、")}`;
  const result = task.result === "" ? "" : `｜结果：${task.result}`;
  return `[${task.id}] ${task.status} · ${task.title}｜owner：${owner}${deps}${result}`;
}

function renderBoard(tasks) {
  if (tasks.length === 0) return "任务板是空的。用 team_task_create 建任务。";
  const order = ["ready", "in_progress", "pending", "completed", "cancelled"];
  const lines = [];
  for (const status of order) {
    const group = tasks.filter((task) => task.status === status);
    if (group.length === 0) continue;
    lines.push(`## ${status}（${group.length}）`);
    for (const task of group) lines.push(renderTask(task, tasks));
  }
  return lines.join("\n");
}

function teamTaskExtensionFactory(deps) {
  declareReadOnlyTools(["team_task_create", "team_task_update", "team_task_list"]);
  return (pi) => {
    if (!deps.isEnabled()) return;
    pi.registerTool({
      name: "team_task_create",
      label: "建任务",
      description: "在团队共享任务板上建任务：支持一次建多条、指派 owner（成员名）、声明依赖。依赖只能指向已创建的任务（含本批次里先写的）；上游全部完成后下游自动解锁为 ready。建好任务后用 team_send 把对应任务说明发给成员，成员完成后用 team_task_update 标完成。",
      promptSnippet: "team_task_create: 建团队共享任务（可指派 owner 与依赖），是并行协调的账本",
      promptGuidelines: [
        "任务要可判定完成：标题写成「产出什么」，detail 写清验收要求。",
        "依赖只用于真实的先后关系（写作等调研），别为了排序造依赖。",
        "任务数就是并行度；1-2 个任务的小活直接做，不必上板。"
      ],
      parameters: Type.Object({
        tasks: Type.Array(TaskInputItem, { minItems: 1, maxItems: 20, description: "要建的任务（1-20 条）。" })
      }),
      async execute(_toolCallId, params) {
        const created = deps.createTasks(
          params.tasks.map((task) => ({
            title: task.title,
            ...task.detail === void 0 ? {} : { detail: task.detail },
            ...task.owner === void 0 ? {} : { owner: task.owner },
            ...task.blockedBy === void 0 ? {} : { blockedBy: task.blockedBy }
          }))
        );
        const all = deps.listTasks();
        const summary = created.map((task) => `- [${task.id}] ${task.title}（${task.status}${task.owner === void 0 ? "" : `，owner：${task.owner}`}）`).join("\n");
        return {
          content: [{ type: "text", text: `已建 ${created.length} 条任务：
${summary}

当前任务板：
${renderBoard(all)}` }],
          details: {}
        };
      }
    });
    pi.registerTool({
      name: "team_task_update",
      label: "更新任务",
      description: "更新任务：改状态（in_progress / completed / cancelled）、指派或改派 owner、写结果摘要。标 completed 会**自动解锁**依赖它的任务；标 cancelled 会**级联取消**下游任务。",
      promptSnippet: "team_task_update: 标任务状态/改派 owner/写结果；完成上游会自动解锁下游",
      parameters: Type.Object({
        id: Type.String({ minLength: 1, description: "任务 id（如 t1）。" }),
        status: Type.Optional(
          Type.Union([
            Type.Literal("in_progress"),
            Type.Literal("completed"),
            Type.Literal("cancelled"),
            Type.Literal("ready"),
            Type.Literal("pending")
          ])
        ),
        owner: Type.Optional(Type.String({ description: "指派/改派的成员名。" })),
        result: Type.Optional(Type.String({ description: "结果摘要（完成时写，便于回溯）。" }))
      }),
      async execute(_toolCallId, params) {
        const updated = deps.updateTask(params.id, {
          ...params.status === void 0 ? {} : { status: params.status },
          ...params.owner === void 0 ? {} : { owner: params.owner },
          ...params.result === void 0 ? {} : { result: params.result }
        });
        return {
          content: [
            {
              type: "text",
              text: `已更新：[${updated.id}] ${updated.title} → ${updated.status}

当前任务板：
${renderBoard(deps.listTasks())}`
            }
          ],
          details: {}
        };
      }
    });
    pi.registerTool({
      name: "team_task_list",
      label: "任务清单",
      description: "查看团队共享任务板：按状态分组列出任务、owner 与依赖，据此决定下一步派谁、还能开工什么。",
      promptSnippet: "team_task_list: 查任务板（ready 的可以开工、pending 的在等上游）",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: renderBoard(deps.listTasks()) }], details: {} };
      }
    });
  };
}

const TeamMemberItem = Type.Object({
  name: Type.String({ minLength: 1, description: "成员名（@寻址键，团队内唯一）。" }),
  agent: Type.String({ minLength: 1, description: "agents 库里的定义名（人格与工具面来源）。" }),
  task: Type.String({ minLength: 1, description: "初始任务（自包含：背景、文件路径、验收要求）。" }),
  model: Type.Optional(
    Type.String({ description: "该成员用的模型（providerId/modelId）；缺省跟随你当前的模型。" })
  )
});

const emptyDetails = { teamName: "", [CHILD_AGENTS_DETAILS_KEY]: [] };

function teamExtensionFactory(deps) {
  declareReadOnlyTools([
    "team_create",
    "team_send",
    "team_status",
    "team_read",
    "team_plan_review",
    "team_delegate_mode",
    "team_shutdown",
    "team_delete"
  ]);
  return (pi) => {
    if (!deps.isEnabled()) return;
    pi.registerTool({
      name: "team_create",
      label: "建团队",
      description: "创建团队并启动成员：每个成员是一个独立长会话，带各自人格（agents 库定义）与初始任务。成员在后台独立执行（本工具不等它们完成），它们的产出**存在各自的会话记录里**。取产出用 team_read（不会自动送到你这里）；查进度用 team_status，追加指示用 team_send，解散用 team_delete。每个会话同时只能有一个团队。成员 1-8 名，成员名是 @寻址的唯一键。",
      promptSnippet: "team_create: 建团队并行攻坚——成员独立长会话后台跑，产出用 team_read 取回；适合可分片的并行任务",
      promptGuidelines: [
        "任务拆分要自包含：成员看不到本会话历史，初始任务里写全背景与验收要求。",
        "先想清楚分工再建团：成员数就是并行度，1-8 人；琐碎任务直接自己做。",
        "成员跑完后用 team_read 取回产出再汇总 —— 产出不会自动出现。"
      ],
      parameters: Type.Object({
        name: Type.String({ minLength: 1, description: "团队名（展示用）。" }),
        members: Type.Array(TeamMemberItem, {
          minItems: 1,
          maxItems: 8,
          description: "1-8 名成员，名字唯一。"
        })
      }),
      async execute(_toolCallId, params, _signal, onUpdate) {
        const plan = {
          name: params.name,
          members: params.members.map((m) => ({
            name: m.name,
            agentName: m.agent,
            task: m.task,
            ...m.model === void 0 ? {} : { model: m.model }
          }))
        };
        const agents = deps.listAgents();
        const projection = new ChildAgentsProjection(
          plan.members.map((m) => ({
            agent: m.name,
            task: m.task,
            model: agents.find((a) => a.name === m.agentName)?.model
          })),
          "team"
        );
        const emitProjection = () => {
          onUpdate?.({
            content: [{ type: "text", text: "" }],
            details: { teamName: plan.name, [CHILD_AGENTS_DETAILS_KEY]: projection.snapshot() }
          });
        };
        emitProjection();
        const indexOf = (memberName) => plan.members.findIndex((m) => m.name === memberName);
        const acks = await deps.startTeam(plan, {
          onProgress: (memberName, text) => {
            projection.pushActivity(indexOf(memberName), text);
            emitProjection();
          },
          onComplete: () => {
          },
          onFailed: (memberName, message) => {
            projection.patch(indexOf(memberName), { status: "failed", output: message });
            emitProjection();
          }
        });
        for (const ack of acks) {
          projection.patch(indexOf(ack.name), { status: "running", activity: "已启动" });
        }
        emitProjection();
        const names = acks.map((a) => a.name).join("、");
        return {
          content: [
            {
              type: "text",
              text: `团队「${plan.name}」已建立（${acks.length} 名成员）：${names}。
成员已在后台独立执行各自任务。**它们完成后产出不会自动送到你这里** —— 先 team_status 看谁「有产出可读」，再用 team_read 取回正文。追加指示用 team_send，解散用 team_delete。`
            }
          ],
          details: { teamName: plan.name, [CHILD_AGENTS_DETAILS_KEY]: projection.snapshot() }
        };
      }
    });
    pi.registerTool({
      name: "team_send",
      label: "发成员消息",
      description: '向团队成员发消息：to 填成员名或 "@all"（全员广播）。正在工作的成员会排队收到，已完成的成员会被唤醒继续。消息要自包含——成员不共享你的对话历史。',
      promptSnippet: "team_send: 给团队成员追加指示或提问（@name 定向 / @all 广播），唤醒 idle 成员继续工作",
      parameters: Type.Object({
        to: Type.String({ minLength: 1, description: '成员名或 "@all"。' }),
        text: Type.String({ minLength: 1, description: "消息正文（自包含）。" })
      }),
      async execute(_toolCallId, params) {
        const delivered = await deps.sendToMembers(params.to, params.text);
        return {
          content: [
            {
              type: "text",
              text: `已投递给：${delivered.join("、")}。成员将按 followUp 语义消费（工作中排队、已完成则唤醒）。`
            }
          ],
          details: emptyDetails
        };
      }
    });
    pi.registerTool({
      name: "team_status",
      label: "团队状态",
      description: "查看团队成员的当前状态（工作/空闲/失败/已中断）、已完成轮数、最近动作，以及你等它多久了。某成员标注「有产出可读」时，用 team_read 取回它的产出正文（产出存在它的会话记录里，不会自动送到你这里）。",
      promptSnippet: "team_status: 查团队成员状态，决定等待、追加指示还是 team_read 取产出",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const state = deps.getTeamState();
        if (state === void 0) {
          return {
            content: [{ type: "text", text: "当前会话没有团队。先用 team_create 建团。" }],
            details: emptyDetails
          };
        }
        const lines = state.members.map((m) => {
          const plan = m.planStatus === void 0 || m.planStatus === "none" ? "" : `，计划：${m.planStatus}`;
          const model = m.model === void 0 || m.model === "" ? "" : `，模型：${m.model}`;
          const recent = m.lastActivity === "" ? "" : `，最近：${m.lastActivity}`;
          const readable = m.outputAvailable === true ? "，**有产出可读（team_read 可取回）**" : "";
          const waited = m.waitedMinutes === void 0 || m.waitedMinutes <= 0 ? "" : m.waitedMinutes < 5 ? `，你已等 ${m.waitedMinutes} 分钟` : `，你已等 ${m.waitedMinutes} 分钟（**偏久，考虑 team_send 问一句或 team_shutdown 收尾**）`;
          return `- ${m.name}（${m.agentName}）：${m.status}，已完成 ${m.turns} 轮${plan}${model}${recent}${readable}${waited}`;
        });
        return {
          content: [{ type: "text", text: `团队「${state.name}」：
${lines.join("\n")}` }],
          details: emptyDetails
        };
      }
    });
    pi.registerTool({
      name: "team_read",
      label: "读成员产出",
      description: "读取某个成员的产出正文（它最近一轮交出的完整内容）。成员的产出**存在它自己的会话记录里**，完成时不会自动推到你这里 —— 你要用本工具主动取回。典型用法：team_status 看到某成员「有产出可读」或「已完成 N 轮」后调 team_read 取回内容，再决定下一步。同一份产出可以反复读，内容不变（不会重复、不会丢失）。",
      promptSnippet: "team_read: 取回某个成员的产出正文（产出在它的会话记录里，要用这个读）",
      promptGuidelines: [
        "成员跑完一轮后主动 team_read 取它的产出，不要干等它「自动送过来」—— 产出不会自动送达。",
        "汇总多名成员的产出时逐个 team_read，再自己整合；不要假定内容已在你的上下文里。"
      ],
      parameters: Type.Object({
        to: Type.String({ minLength: 1, description: "成员名（@寻址键）。" })
      }),
      async execute(_toolCallId, params) {
        const result = await deps.readMemberOutput(params.to);
        if (result === void 0) {
          return {
            content: [{ type: "text", text: "当前会话没有团队。" }],
            details: emptyDetails
          };
        }
        if (result.output === void 0) {
          const why = result.status === "running" ? "它还在跑，产出还没落盘" : result.status === "interrupted" ? "它上次运行被中断，没有完整产出" : result.status === "failed" ? "它上次运行失败了，没有产出" : "它的会话记录里还没有产出";
          return {
            content: [
              {
                type: "text",
                text: `成员「${result.member}」暂无产出可读（${why}）。可以 team_status 看它的状态，或用 team_send 问一句。`
              }
            ],
            details: emptyDetails
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `成员「${result.member}」的产出：

${result.output}`
            }
          ],
          details: emptyDetails
        };
      }
    });
    pi.registerTool({
      name: "team_plan_review",
      label: "审计划",
      description: "裁决成员交回的计划：`awaiting` 只把状态记为待审（你读了它的计划但还没决定）；`approve` 批准并自动让它开工；`reject` 驳回并自动把 feedback 发给它改计划（**驳回必须给反馈**）。用法：在初始任务里要求成员「先交计划再动手」，它把计划作为一轮产出自带回投，你审阅后用本工具裁决。计划状态可在 team_status 里看到。",
      promptSnippet: "team_plan_review: 裁决成员交回的计划（批准即开工 / 驳回必带反馈）",
      promptGuidelines: [
        "只在初始任务里明确要求过「先交计划」时才走这条链路——小任务交计划纯属多一轮往返。",
        "驳回要写清楚改哪一点（缺什么证据、范围该收在哪），不要只说「再想想」。"
      ],
      parameters: Type.Object({
        member: Type.String({ minLength: 1, description: "成员名。" }),
        decision: Type.Union([Type.Literal("awaiting"), Type.Literal("approve"), Type.Literal("reject")]),
        feedback: Type.Optional(Type.String({ description: "驳回时必须给的修改要求（批准时可留一句批注）。" }))
      }),
      async execute(_toolCallId, params) {
        const text = await deps.reviewPlan(params.member, params.decision, params.feedback);
        return { content: [{ type: "text", text }], details: emptyDetails };
      }
    });
    pi.registerTool({
      name: "team_delegate_mode",
      label: "委派模式",
      description: "开关委派模式：开启后你（领导）**只协调不下场**——保留团队、任务、提问与交付工具，失去读写文件、执行命令、检索与再委派的能力，所有实际工作必须由成员完成。适合「这次我只做编排与裁决」的任务；想自己下场就先关掉它。只影响本会话（不写设置）。",
      promptSnippet: "team_delegate_mode: 开启后领导工具面收窄为团队/任务/交付类，只协调不下场",
      parameters: Type.Object({
        enabled: Type.Boolean({ description: "true 开、false 关。" }),
        reason: Type.Optional(Type.String({ description: "开启/关闭理由（写进回执，便于用户理解这次策略）。" }))
      }),
      async execute(_toolCallId, params) {
        const text = await deps.setDelegateMode(params.enabled);
        return { content: [{ type: "text", text }], details: emptyDetails };
      }
    });
    pi.registerTool({
      name: "team_shutdown",
      label: "收尾成员",
      description: "让**单个**成员收尾退出：它会把手上的工作整理成最终报告（写在它的会话记录里，用 team_read 取回），然后结束。适合收掉跑偏的成员、或某个维度已经问完不再需要它。与 team_delete 的区别：后者中止**整个**团队。成员交完报告后状态变 closed，不能再给它发消息；若它长时间不收尾，可用 force 强制中止（当前轮产出会丢弃）。",
      promptSnippet: "team_shutdown: 让单个成员收尾退出（交回报告后关闭），区别于整队 team_delete",
      parameters: Type.Object({
        to: Type.String({ minLength: 1, description: '成员名（单成员语义，不支持 "@all"；整队请用 team_delete）。' }),
        reason: Type.Optional(
          Type.String({ description: "收尾原因（写进给成员的消息里，让它知道该收在哪）。" })
        ),
        force: Type.Optional(Type.Boolean({ description: "true = 直接中止，不等它交报告。" }))
      }),
      async execute(_toolCallId, params) {
        const text = await deps.shutdownMember(params.to, params.reason, params.force === true);
        return { content: [{ type: "text", text }], details: emptyDetails };
      }
    });
    pi.registerTool({
      name: "team_delete",
      label: "解散团队",
      description: "解散当前团队：中止全部成员并清理。成员未完成的任务会丢失；解散前先用 team_read 取回还需要保留的产出。",
      promptSnippet: "team_delete: 中止并清理全部团队成员",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        await deps.closeTeam();
        return {
          content: [{ type: "text", text: "团队已解散，成员已中止。" }],
          details: emptyDetails
        };
      }
    });
  };
}

export {
	BACKGROUND_JOBS_MAX_PER_SESSION,
	BUDGET_EXHAUSTED_TEXT,
	KILL_SETTLE_TIMEOUT_MS,
	SKIPPED_TEXT,
	TaskInputItem,
	TaskItem,
	TeamMemberItem,
	UNATTENDED_TEXT,
	availableAgentsText,
	createBackgroundJobRegistry,
	createSkillInstallTool,
	createSkillUninstallTool,
	emptyDetails,
	formatReport,
	mergeStreams,
	questionnaireExtensionFactory,
	renderBoard,
	renderTask,
	taskExtensionFactory,
	teamExtensionFactory,
	teamTaskExtensionFactory,
};