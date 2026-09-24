import { normalizeMemberOutput } from "./mailbox.js";
import {
	SNAPSHOT_NOTE,
	TEAM_OUTPUT_MAX_CHARS,
	outputFingerprint,
} from "./subagent.js";

function composePendingTeamOutput(input) {
  const { teamName, members, delivered } = input;
  const maxChars = input.maxChars ?? TEAM_OUTPUT_MAX_CHARS;
  if (members.length === 0) return void 0;
  const statusLines = [];
  const blocks = [];
  const written = /* @__PURE__ */ new Set();
  for (const member of members) {
    const body = normalizeMemberOutput(member.output ?? "");
    if (body === "") {
      statusLines.push(renderStatusLine(member));
      continue;
    }
    const fingerprint = outputFingerprint(body);
    statusLines.push(renderStatusLine(member, fingerprint));
    if (delivered.has(fingerprint)) continue;
    blocks.push(renderMemberBlock(member.name, body, maxChars));
    written.add(fingerprint);
  }
  if (blocks.length === 0) return void 0;
  return { text: assembleSnapshot(teamName, statusLines, blocks), fingerprints: [...written] };
}

function renderStatusLine(member, fingerprint) {
  const base = `- ${member.name}（${member.agentName}）：${member.status}，已完成 ${member.turns} 轮`;
  return fingerprint === void 0 ? base : `${base} [fp ${fingerprint}]`;
}

function assembleSnapshot(teamName, statusLines, blocks) {
  let text = `<team_output team="${teamName}">
${SNAPSHOT_NOTE}

${statusLines.join("\n")}`;
  if (blocks.length > 0) text += `

${blocks.join("\n\n")}`;
  return `${text}
</team_output>`;
}

function renderMemberBlock(member, body, maxChars) {
  const open = `<member_output member="${member}">`;
  if (body.length <= maxChars) return `${open}
${body}
</member_output>`;
  return `${open}
${body.slice(0, maxChars)}
（已截断，全文用 team_read 取回）
</member_output>`;
}

const INTERRUPT_CANDIDATE_STATUSES = /* @__PURE__ */ new Set([
  "spawning",
  "running",
  "closing"
]);

function toPlanStatus(value) {
  return value === "awaiting" || value === "approved" || value === "rejected" ? value : "none";
}

function requireNonEmpty$1(value, label) {
  if (value === "") throw new Error(`${label}不能为空`);
  return value;
}

class TeamRegistry {
  teamsByLeader = /* @__PURE__ */ new Map();
  /** 成员会话 id → 领导 id（成员回投/按会话查团队的反向索引）。 */
  leaderByMemberSession = /* @__PURE__ */ new Map();
  /**
   * 建团。单会话单团队（重复 → 报错并报告现有团队名）；成员名唯一；
   * 1-8 人（对齐并行派发上限）。
   * 成员以 spawning 起步，sessionId 由接线层 spawn ack 后回填。
   */
  createTeam(leaderSessionId, name, members) {
    requireNonEmpty$1(leaderSessionId, "领导会话 id");
    requireNonEmpty$1(name, "团队名");
    if (members.length === 0) throw new Error("团队至少需要一名成员");
    if (members.length > 8) throw new Error(`团队成员最多 8 名，当前 ${members.length} 名`);
    const existing = this.teamsByLeader.get(leaderSessionId);
    if (existing !== void 0) {
      throw new Error(`本会话已存在团队「${existing.name}」，先解散（team_delete）才能再建`);
    }
    const team = { name, members: /* @__PURE__ */ new Map() };
    for (const spec of members) {
      const memberName = requireNonEmpty$1(spec.name, "成员名");
      if (team.members.has(memberName)) {
        throw new Error(`成员名「${memberName}」重复：成员名是 @寻址的唯一键`);
      }
      team.members.set(memberName, {
        name: memberName,
        sessionId: void 0,
        agentName: requireNonEmpty$1(spec.agentName, `成员「${memberName}」的 agent 名`),
        task: requireNonEmpty$1(spec.task, `成员「${memberName}」的初始任务`),
        model: "",
        status: "spawning",
        turns: 0,
        lastActivity: "",
        toolCalls: 0,
        tokens: 0,
        cost: 0,
        planStatus: "none",
        planFeedback: "",
        waitingSince: 0
      });
    }
    this.teamsByLeader.set(leaderSessionId, team);
    return team;
  }
  /**
   * 从落盘快照恢复团队（spec: add-team-collaboration-parity 批次 ⑤）。
   *
   * **宿主不可恢复**（理由见 core/team-store.ts 文件头），所以恢复态只能是
   * 「需重建」的终态。但**两种终态要分开**（spec: add-team-interrupt-diagnostics
   * 批次 ①，2026-09-19 实测驱动）：
   *
   * - 落盘时该成员 `idle`/`closed`/`failed` → 恢复为 `closed`，附「需重建」。
   *   它上一次已经是终态，进程被杀不损失任何未回投的产出。
   * - 落盘时该成员 `spawning`/`running`/`closing` → 恢复为 **`interrupted`**，
   *   附「上次运行在「X」时中断，该轮产出未回投」。
   *
   * 区分这两者的全部价值是**诊断**：前一种用户可以放心重开，后一种意味着
   * 「有一轮很可能跑完了但产出没回来」，用户该去会话文件里捞。一律折成 closed
   * 会把这个信号抹掉 —— 那正是本次实测里最误导人的地方。
   */
  /**
   * 从落盘快照恢复团队（spec: add-team-collaboration-parity 批次 ⑤；
   * spec: add-team-pull-model 批次 ② 改为**派生优先**）。
   *
   * **宿主不可恢复**（理由见 core/team-store.ts 文件头），所以恢复态只能是
   * 「需重建」的终态。判据取派生结果（`deriveMemberStatus`）——
   * **先读成员会话文件派生，派生不出才回落到落盘的 status 字面量**：
   *
   * | 派生结果（`deriveMemberStatus`） | 恢复为 | 含义 |
   * |---|---|---|
   * | `completed` | `closed` | 跑完了、产出在会话文件里，可去读 |
   * | `killed` | `interrupted` | 被中止，那一轮没跑完 |
   * | `failed` | `failed` | 那一轮失败了 |
   * | `undefined`（派生不出） | 见下 | 回落到落盘 status 判据 |
   *
   * 为什么派生优先（终态事件走 ACP 实时通道、**进程重启就丢**）：
   * 落盘 status 是**运行时状态**，它记录的是「杀进程那一刻它在干什么」，
   * 而不是「它最终跑成什么样」。若成员其实已经跑完（产出完整写进 JSONL），
   * 只是没来得及把 status 翻成 idle 就死了，落盘会说 `running` → 被误判成
   * `interrupted`（用户以为要重跑）。而**读文件能拿到确切答案**。
   *
   * 回落分支（派生出 `undefined`）沿用原判据：
   * - 落盘 `spawning`/`running`/`closing` → `interrupted`
   * - 落盘 `idle`/`closed`/`failed` → `closed`
   *
   * @param deriveStatus 派生器（注入以便测试；缺省用会话文件派生）。
   *   接 `(sessionId) => MemberTranscriptStatus`，`undefined` = 派生不出。
   */
  restoreTeam(leaderSessionId, name, members, deriveStatus) {
    requireNonEmpty$1(leaderSessionId, "领导会话 id");
    if (this.teamsByLeader.has(leaderSessionId)) return;
    const team = { name, members: /* @__PURE__ */ new Map() };
    for (const stored of members) {
      let derived;
      if (stored.sessionId !== void 0 && deriveStatus !== void 0) {
        try {
          derived = deriveStatus(stored.sessionId);
        } catch {
          derived = void 0;
        }
      } else {
        derived = void 0;
      }
      const wasWorking = INTERRUPT_CANDIDATE_STATUSES.has(stored.status);
      let status;
      let activity;
      if (derived === "completed") {
        status = "closed";
        activity = "上次运行已完成，产出在它的会话记录里（可用 team_read 取回）";
      } else if (derived === "killed") {
        status = "interrupted";
        activity = "上次运行被中止，那一轮没有跑完";
      } else if (derived === "failed") {
        status = "failed";
        activity = "上次运行失败，看它的会话记录可了解原因";
      } else if (wasWorking) {
        status = "interrupted";
        activity = `上次运行在「${stored.status === "closing" ? "收尾" : "任务执行"}」时中断（会话记录里读不到完整产出）`;
      } else {
        status = "closed";
        activity = "进程重启后成员需重建";
      }
      team.members.set(stored.name, {
        name: stored.name,
        sessionId: stored.sessionId,
        agentName: stored.agentName,
        task: stored.task,
        status,
        model: "",
        turns: stored.turns,
        lastActivity: activity,
        toolCalls: stored.toolCalls,
        tokens: stored.tokens,
        cost: stored.cost,
        planStatus: toPlanStatus(stored.planStatus),
        planFeedback: stored.planFeedback ?? "",
        waitingSince: 0
      });
    }
    this.teamsByLeader.set(leaderSessionId, team);
  }
  /**
   * 把仍是 `running` 的成员强制收敛到终态（spec: add-team-pull-model 批次②）。
   *
   * ═══════════════════════════════════════════════════════════════════════
   *  三条不变量（改这个函数前先读那三条注释）
   * ═══════════════════════════════════════════════════════════════════════
   *
   * 1. **只动 `status === "running"`**：已终态的成员有自己的证据链，不能被
   *    父状态覆盖 —— 证据在子 transcript 里（SendMessage / cancel record）。
   *
   * 2. **父 `idle` 只在冷启动 hydrate 完成后才 settle**：运行时 idle 不触发。
   *    主 agent end_turn 不代表 subagent 已经结束（fire-and-forget），
   *    硬 settle 会引入『子在跑却说 completed/cancelled』的假态。
   *    我们这边对应：领导跑完一轮（idle）**不代表**成员也停了 —— 成员是
   *    独立长会话，可能正跑在后台。
   *
   * 3. **父进入 `{terminated, error, failed}` → 强制收敛**：这类是「父真的结束了」，
   *    子不可能再有回音。
   *
   * @param reason 父的终态。`terminated`/`idle` → 成员标 `interrupted`；
   *   `error`/`failed` → 成员标 `failed`。
   *   成员侧用 `interrupted` 表达「被中止」。
   * @returns 实际被收敛的成员名（调用方据此决定要不要刷投影）。
   */
  settleRunningMembers(leaderSessionId, reason) {
    const team = this.teamsByLeader.get(leaderSessionId);
    if (team === void 0) return [];
    const target = reason === "terminated" || reason === "idle" ? "interrupted" : "failed";
    const settled = [];
    for (const member of team.members.values()) {
      if (member.status !== "running") continue;
      member.status = target;
      member.waitingSince = 0;
      member.lastActivity = target === "interrupted" ? "会话已停，这一轮没有回音（产出看它的会话记录）" : "会话失败中止，这一轮没有回音";
      settled.push(member.name);
    }
    return settled;
  }
  /** 领导的团队；没有 → undefined。 */
  getTeam(leaderSessionId) {
    return this.teamsByLeader.get(leaderSessionId);
  }
  /** 按成员会话 id 反查所属团队（成员回投路由用）；找不到 → undefined。 */
  getTeamByMemberSession(memberSessionId) {
    const leader = this.leaderByMemberSession.get(memberSessionId);
    return leader === void 0 ? void 0 : this.teamsByLeader.get(leader);
  }
  /** spawn ack：成员会话 id 回填 + 状态翻 running。未知成员/团队 → 响亮抛错。 */
  markSpawned(leaderSessionId, memberName, memberSessionId) {
    const member = this.requireMember(leaderSessionId, memberName);
    if (member.sessionId !== void 0) {
      throw new Error(`成员「${memberName}」已绑定会话，spawn ack 重复`);
    }
    member.sessionId = memberSessionId;
    member.status = "running";
    member.lastActivity = "";
    member.waitingSince = Date.now();
    this.leaderByMemberSession.set(memberSessionId, leaderSessionId);
  }
  /**
   * 回填成员实际使用的模型（spec: add-team-collaboration-parity 批次 ⑥）。
   *
   * 解析链（成员显式 → agent 定义 → 领导模型）在成员执行器里算 —— 那里才知道
   * 目录里哪些模型可用。接线层拿到 handle 后回填这里，`team_status` 才有真值可显示。
   */
  recordMemberModel(leaderSessionId, memberName, modelKey) {
    const member = this.requireMember(leaderSessionId, memberName);
    member.model = modelKey;
  }
  /**
   * 状态迁移（批次 ② 起同时维护 `waitingSince`）。
   *
   * 等待计时只在 `running` 期间有意义 —— 领导派了活、成员还没交回来。
   * 所以：
   * - 翻到 `running` → **刷新**起点（新的一轮派活，上一次的等待作废）
   * - 翻到 `idle`/`closed`/`failed` → **清零**（活交回来了 / 不用等了）
   * - `interrupted` → 清零（不再等待，它是终态）
   * - `closing` → 保持原值（收尾也是「领导在等它交报告」）
   *
   * @param at 测试注入用的「现在」（缺省 Date.now()）；生产调用不传。
   */
  markStatus(leaderSessionId, memberName, status, activity, at) {
    const member = this.requireMember(leaderSessionId, memberName);
    member.status = status;
    if (activity !== void 0) member.lastActivity = activity;
    if (status === "running") {
      member.waitingSince = at ?? Date.now();
    } else if (status !== "closing" && status !== "spawning") {
      member.waitingSince = 0;
    }
  }
  /**
   * 回填一轮的收尾结果（spec: add-team-interrupt-diagnostics 批次 ③.4）。
   *
   * **它是轮数的对齐点，不是唯一写点**：`recordProgress` 已按事件增量
   * （`assistant_done` → +1）实时同步同一个数，所以长 run 期间 `team_status` 的
   * 「已完成 N 轮」是真的。这里在 run 收尾再用**绝对值**对齐一次 ——
   * 万一有事件没走那条路（重复回调、竞态），它把数字拉回真值。
   *
   * 因此这里是**直接赋值而不是累加**：它是「这个成员共跑完几轮」的绝对值，
   * 累加会让重复回调把数字顶飞。
   *
   * 历史（别把这段当现状读）：2026-09-19 之前接线层把 `turnsDelta` 写死传 0，
   * 注册表的 `turns` 永远停在 0（实测反例：`activity = 已完成 2 轮` 而 `turns = 0`），
   * 那个字段还被误当成「一轮没收尾」的判据、推错过一次方向。根因是 `onProgress`
   * 钩子只带一句文本、拿不到轮数增量 —— 已由 `MemberHooks.onProgress` 的第三参修掉。
   */
  recordCompletion(leaderSessionId, memberName, turns, activity) {
    const member = this.requireMember(leaderSessionId, memberName);
    member.turns = turns;
    if (activity !== "") member.lastActivity = activity;
  }
  /**
   * 追加轮数与动作行（接线层从成员事件回填）。
   *
   * `turnsDelta` 是**事件级增量**（成员执行器给：`assistant_done` → 1、工具事件 → 0），
   * 不是绝对值 —— 所以这里是 `+=`。绝对值由 `recordCompletion`（run 收尾）负责对齐，
   * 两者口径相同（都只数 `assistant_done`），因此累加结果与收尾赋值不会互相顶飞。
   */
  recordProgress(leaderSessionId, memberName, turnsDelta, activity) {
    const member = this.requireMember(leaderSessionId, memberName);
    member.turns += turnsDelta;
    if (activity !== "") member.lastActivity = activity;
  }
  /**
   * 按成员会话 id 回填计数增量（spec: add-team-foundations 批 8）：
   * 成员执行器的 onEvent 只知道自己的 sessionId，用反向索引找归属成员累加。
   * 返回领导 id（调用方据此发 team_member_progress）；成员未归属（spawn
   * ack 前的零星事件）→ undefined，调用方跳过。
   */
  recordCountersBySession(memberSessionId, deltas) {
    const leaderId = this.leaderByMemberSession.get(memberSessionId);
    const team = leaderId === void 0 ? void 0 : this.teamsByLeader.get(leaderId);
    if (team === void 0 || leaderId === void 0) return void 0;
    let member;
    for (const candidate of team.members.values()) {
      if (candidate.sessionId === memberSessionId) {
        member = candidate;
        break;
      }
    }
    if (member === void 0) return void 0;
    member.toolCalls += deltas.toolCalls;
    member.tokens += deltas.tokens;
    member.cost += deltas.cost;
    return leaderId;
  }
  /**
   * 记录计划裁决（spec: add-team-collaboration-parity 批次 ④）。
   *
   * `decision` 三值：`awaiting`（领导读了回投的计划、先记一笔待审）、
   * `approve`、`reject`。**驳回必须给反馈**——没有反馈的驳回等于让成员
   * 重新猜一遍，那还不如不要审批这一环。
   *
   * 这里只写状态；唤醒成员（team_send）由接线层做：注册表不碰宿主。
   */
  reviewPlan(leaderSessionId, memberName, decision, feedback) {
    const member = this.requireMember(leaderSessionId, memberName);
    if (decision === "reject" && (feedback === void 0 || feedback.trim() === "")) {
      throw new Error("驳回计划必须给 feedback —— 否则成员只能重猜，等于白跑一轮");
    }
    member.planStatus = decision === "awaiting" ? "awaiting" : decision === "approve" ? "approved" : "rejected";
    member.planFeedback = feedback ?? "";
    return member;
  }
  requireMember(leaderSessionId, memberName) {
    const team = this.getTeam(leaderSessionId);
    const member = team?.members.get(memberName);
    if (team === void 0 || member === void 0) {
      throw new Error(
        team === void 0 ? "本会话没有团队，先 team_create 建团" : `团队「${team.name}」中没有成员「${memberName}」`
      );
    }
    return member;
  }
  /**
   * 按成员名列表解析会话 id（team_send 的 @寻址）。任一未知 → 响亮抛错。
   *
   * 已关闭 / 已中断的成员**响亮拒绝**（spec: add-team-collaboration-parity 批次 ②
   * + add-team-interrupt-diagnostics 批次 ①）：它们的宿主已经 dispose（或随进程
   * 一起没了），再投消息会撞一个不可预期的内部错误。措辞按死因分开 ——
   * 用户据此知道该「另派一名成员」还是「去会话文件里捞产出」。
   */
  resolveMemberSessions(leaderSessionId, memberNames) {
    return memberNames.map((name) => {
      const member = this.requireMember(leaderSessionId, name);
      if (member.sessionId === void 0) {
        throw new Error(`成员「${name}」还在启动中，稍后再发消息`);
      }
      if (member.status === "interrupted" || member.status === "closed") {
        if (member.status === "interrupted") {
          throw new Error(
            `成员「${name}」上次那一轮没有跑完（进程中断），会话已失效。它中断前的产出若已落盘，可用 team_read 取回；要它继续工作请重新建团`
          );
        }
        throw new Error(`成员「${name}」已关闭、不再接收消息（它的产出可用 team_read 取回；要它继续工作就另派一名成员）`);
      }
      return member.sessionId;
    });
  }
  /**
   * 解散：从注册表摘除团队与全部反向索引，返回成员名列表（接线层据此
   * abort+dispose 宿主）。
   */
  disband(leaderSessionId) {
    const team = this.teamsByLeader.get(leaderSessionId);
    if (team === void 0) return [];
    this.teamsByLeader.delete(leaderSessionId);
    const names = [];
    for (const member of team.members.values()) {
      if (member.sessionId !== void 0) this.leaderByMemberSession.delete(member.sessionId);
      names.push(member.name);
    }
    return names;
  }
}

export {
	INTERRUPT_CANDIDATE_STATUSES,
	TeamRegistry,
	assembleSnapshot,
	composePendingTeamOutput,
	renderMemberBlock,
	renderStatusLine,
	requireNonEmpty$1,
	toPlanStatus,
};