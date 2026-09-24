
const defaultClock = { now: () => Date.now() };

function requireNonEmpty(value, label) {
  if (value === "") throw new Error(`${label}不能为空`);
  return value;
}

function snapshot(task) {
  return { ...task, blockedBy: [...task.blockedBy] };
}

class TeamTaskBoard {
  boardsByLeader = /* @__PURE__ */ new Map();
  clock;
  constructor(clock = defaultClock) {
    this.clock = clock;
  }
  /**
   * 批量建任务。blockedBy 只能引用**已存在**的 id（本板已有 + 本批先前创建），
   * 因此图天然无环；引用未来/不存在的 id 响亮报错（静默当无依赖会让任务
   * 在依赖没做完时就开工，那正是依赖要防的事）。
   */
  createTasks(leaderSessionId, inputs) {
    requireNonEmpty(leaderSessionId, "领导会话 id");
    if (inputs.length === 0) throw new Error("至少要有一个任务");
    const board = this.boardOf(leaderSessionId);
    const known = new Set(board.tasks.map((task) => task.id));
    const created = [];
    const now = this.clock.now();
    for (const input of inputs) {
      const title = requireNonEmpty(input.title, "任务标题");
      const blockedBy = input.blockedBy ?? [];
      for (const dep of blockedBy) {
        if (!known.has(dep)) {
          throw new Error(
            `任务「${title}」依赖的「${dep}」不存在：依赖只能指向已创建的任务（同批次里先写的可以）`
          );
        }
      }
      const id = `t${board.nextSeq}`;
      board.nextSeq += 1;
      const task = {
        id,
        title,
        detail: input.detail ?? "",
        owner: input.owner === void 0 ? void 0 : requireNonEmpty(input.owner, "任务 owner"),
        blockedBy: [...blockedBy],
        // 无依赖 → 直接可开工；有依赖 → 等解锁。
        status: blockedBy.length === 0 ? "ready" : "pending",
        result: "",
        createdAt: now,
        updatedAt: now
      };
      board.tasks.push(task);
      known.add(id);
      created.push(snapshot(task));
    }
    return created;
  }
  /** 改状态 / 指派 / 写结果。改成 completed 会触发下游解锁。未知 id → 响亮报错。 */
  updateTask(leaderSessionId, taskId, patch) {
    const task = this.requireTask(leaderSessionId, taskId);
    if (patch.status !== void 0) task.status = patch.status;
    if (patch.owner !== void 0) task.owner = requireNonEmpty(patch.owner, "任务 owner");
    if (patch.result !== void 0) task.result = patch.result;
    task.updatedAt = this.clock.now();
    if (patch.status === "completed" || patch.status === "cancelled") this.refreshUnlocks(leaderSessionId);
    return snapshot(task);
  }
  /** 当前板的全部任务（创建序，快照）。 */
  listTasks(leaderSessionId) {
    return this.boardOf(leaderSessionId).tasks.map(snapshot);
  }
  /**
   * 解锁扫描：pending 且依赖全部 completed → ready；
   * 依赖里出现 cancelled（上游永远不会完成）→ 级联 cancelled。
   * 反复扫到不动为止（一次操作可能连锁解锁多层下游）。
   */
  refreshUnlocks(leaderSessionId) {
    const board = this.boardOf(leaderSessionId);
    const byId = new Map(board.tasks.map((task) => [task.id, task]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of board.tasks) {
        if (task.status !== "pending") continue;
        const deps = task.blockedBy.map((id) => byId.get(id));
        if (deps.some((dep) => dep?.status === "cancelled")) {
          task.status = "cancelled";
          task.result = task.result === "" ? "上游任务已取消，本任务级联取消" : task.result;
          task.updatedAt = this.clock.now();
          changed = true;
          continue;
        }
        if (deps.every((dep) => dep?.status === "completed")) {
          task.status = "ready";
          task.updatedAt = this.clock.now();
          changed = true;
        }
      }
    }
  }
  /** 板内任务（取消后 id 不复用，故按数组查找即可）。 */
  requireTask(leaderSessionId, taskId) {
    const task = this.boardOf(leaderSessionId).tasks.find((candidate) => candidate.id === taskId);
    if (task === void 0) {
      const known = this.boardOf(leaderSessionId).tasks.map((candidate) => candidate.id).join("、");
      throw new Error(`任务「${taskId}」不存在（当前板上有：${known === "" ? "空" : known}）`);
    }
    return task;
  }
  /** 领导的板；首次访问即建空板（一个会话一张，与单会话单团队同构）。 */
  boardOf(leaderSessionId) {
    requireNonEmpty(leaderSessionId, "领导会话 id");
    const existing = this.boardsByLeader.get(leaderSessionId);
    if (existing !== void 0) return existing;
    const board = { tasks: [], nextSeq: 1 };
    this.boardsByLeader.set(leaderSessionId, board);
    return board;
  }
  /**
   * 从落盘快照恢复任务板（spec: add-team-collaboration-parity 批次 ⑤）。
   *
   * nextSeq 取「已有 id 的最大序号 + 1」：直接用任务数会与历史 id 撞车
   * （取消过的任务也占过号），撞车后 `team_task_update t3` 会改到另一条任务上 ——
   * 静默改错对象比报错难查得多。
   */
  restore(leaderSessionId, tasks) {
    requireNonEmpty(leaderSessionId, "领导会话 id");
    if (this.boardsByLeader.has(leaderSessionId)) return;
    const maxSeq = tasks.reduce((max, task) => {
      const seq2 = Number.parseInt(task.id.replace(/^t/, ""), 10);
      return Number.isNaN(seq2) ? max : Math.max(max, seq2);
    }, 0);
    this.boardsByLeader.set(leaderSessionId, {
      tasks: tasks.map((task) => ({ ...task, blockedBy: [...task.blockedBy] })),
      nextSeq: maxSeq + 1
    });
  }
  /** 解散时清板（团队没了，任务板不该留着——重启恢复由批次 ⑤ 的落盘负责）。 */
  clear(leaderSessionId) {
    this.boardsByLeader.delete(leaderSessionId);
  }
}

export {
	TeamTaskBoard,
	defaultClock,
	requireNonEmpty,
	snapshot,
};