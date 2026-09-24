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
import { writeFileSync } from "node:fs";
import { getAutomationsFile } from "./config-paths.js";

const TASK_STATUSES = /* @__PURE__ */ new Set(["active", "paused", "missed"]);

const SCHEDULE_TYPES = /* @__PURE__ */ new Set(["once", "interval", "daily", "weekly"]);

class AutomationStore {
  constructor(filePath = getAutomationsFile()) {
    this.filePath = filePath;
  }
  filePath;
  tasks = /* @__PURE__ */ new Map();
  loaded = false;
  /**
   * 从磁盘加载。文件不存在 = 空库；JSON 损坏或结构不符抛错（响亮，不静默重置）。
   *
   * 幂等，且各方法会先确保已加载 —— 但 daemon 启动时仍应显式调一次：
   * 损坏要暴露在启动时刻，而不是推迟到第一次读写才炸。
   * 抛错后 loaded 不置位，修好文件再调会重读。
   */
  load() {
    if (this.loaded) return;
    let raw;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `${this.filePath} 不是合法 JSON，已停止加载以免覆盖你的任务库。请修好或删除该文件后重试。原始错误：${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        `${this.filePath} 的顶层应为任务数组，实际是 ${parsed === null ? "null" : typeof parsed}`
      );
    }
    for (const [index, value] of parsed.entries()) {
      const task = parseTask(value, index, this.filePath);
      this.tasks.set(task.id, task);
    }
    this.loaded = true;
  }
  /**
   * 全部任务（按文件/插入顺序）。返回内部对象的引用 —— 改字段必须走
   * upsert 落盘，直接改引用会造成内存与磁盘漂移。
   */
  list() {
    this.load();
    return [...this.tasks.values()];
  }
  get(id) {
    this.load();
    return this.tasks.get(id);
  }
  /**
   * 新建或替换同 id 任务（整个对象以入参为准），随即落盘。
   * updatedAt / nextRunAt 等字段由调用方维护 —— 这层不知道也不猜业务语义。
   */
  upsert(task) {
    this.load();
    this.tasks.set(task.id, task);
    this.persist();
  }
  /**
   * 删除任务。id 不存在幂等返回（与 removeDisplayName 一致）。
   * 内置任务（builtin）拒删：它是功能的承载体（记忆蒸馏靠它跑），删掉后
   * 设置页的开关就成了一具空壳 —— 想停用它请走 memoryEnabled 开关。
   * 守卫收在这一层而不是 IPC 层：对话内 automation_delete 工具也走这里，
   * 两条删除路径同一道闸。
   */
  remove(id) {
    this.load();
    const task = this.tasks.get(id);
    if (task === void 0) return;
    if (task.builtin === true) {
      throw new Error(`「${task.name}」是内置任务，不可删除（可在设置里停用）`);
    }
    this.tasks.delete(id);
    this.persist();
  }
  /**
   * 追加一条运行记录并修剪至最新 MAX_RUNS 条，随即落盘，返回更新后的任务。
   *
   * 只碰 runs：lastRunAt / nextRunAt / updatedAt 的联动更新由调用方走 upsert。
   * 一次 run 结束处的完整状态在调用方一处组装，免得两个写入口各改一半。
   */
  appendRun(taskId, run) {
    this.load();
    const task = this.tasks.get(taskId);
    if (task === void 0) throw new Error(`定时任务不存在：${taskId}`);
    const next = { ...task, runs: [...task.runs, run].slice(-50) };
    this.tasks.set(taskId, next);
    this.persist();
    return next;
  }
  /** 原子落盘：临时文件写全后 rename 替换（单写者，tmp 名固定即可）。 */
  persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify([...this.tasks.values()], null, 2)}
`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

function parseTask(value, index, filePath) {
  const bad = (reason) => new Error(`${filePath} 第 ${index + 1} 个任务${reason}`);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad("不是对象");
  const record = value;
  const id = record["id"];
  if (typeof id !== "string" || id === "") throw bad("缺少 id");
  const status = record["status"];
  if (typeof status !== "string" || !TASK_STATUSES.has(status)) {
    throw bad(`的 status 非法：${String(status)}`);
  }
  const schedule = record["schedule"];
  if (typeof schedule !== "object" || schedule === null) throw bad("缺少 schedule");
  const type = schedule["type"];
  if (typeof type !== "string" || !SCHEDULE_TYPES.has(type)) {
    throw bad(`的 schedule.type 非法：${String(type)}`);
  }
  return value;
}

export {
	AutomationStore,
	SCHEDULE_TYPES,
	TASK_STATUSES,
	parseTask,
};