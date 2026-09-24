import {
	getConfigDir,
	getSessionsDir,
} from "./config-paths.js";
import { profilePath } from "./memory.js";

const BUILTIN_MEMORY_TASK_ID = "builtin-memory-distill";

const MINUTE_MS = 6e4;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTime(time) {
  const match = TIME_PATTERN.exec(time);
  if (match === null || match[1] === void 0 || match[2] === void 0) {
    throw new Error(`非法时间格式「${time}」，应为 HH:mm（如 09:00）`);
  }
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function nextRunAfter(schedule, from) {
  switch (schedule.type) {
    case "once":
      return schedule.at > from ? schedule.at : void 0;
    case "interval": {
      if (!Number.isInteger(schedule.everyMinutes) || schedule.everyMinutes < 1) {
        throw new Error(`非法间隔「${schedule.everyMinutes}」，应为正整数分钟`);
      }
      const intervalMs = schedule.everyMinutes * MINUTE_MS;
      return (Math.floor(from / intervalMs) + 1) * intervalMs;
    }
    case "daily": {
      const { hours, minutes } = parseTime(schedule.time);
      const fromDate = new Date(from);
      const today = new Date(
        fromDate.getFullYear(),
        fromDate.getMonth(),
        fromDate.getDate(),
        hours,
        minutes
      );
      if (today.getTime() > from) return today.getTime();
      return new Date(
        fromDate.getFullYear(),
        fromDate.getMonth(),
        fromDate.getDate() + 1,
        hours,
        minutes
      ).getTime();
    }
    case "weekly": {
      const { hours, minutes } = parseTime(schedule.time);
      const days = new Set(schedule.weekdays);
      if (days.size === 0) return void 0;
      const fromDate = new Date(from);
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = new Date(
          fromDate.getFullYear(),
          fromDate.getMonth(),
          fromDate.getDate() + offset,
          hours,
          minutes
        );
        if (!days.has(candidate.getDay())) continue;
        if (candidate.getTime() > from) return candidate.getTime();
      }
      return void 0;
    }
  }
}

function validateSchedule(schedule) {
  switch (schedule.type) {
    case "once":
      return void 0;
    case "interval":
      return Number.isInteger(schedule.everyMinutes) && schedule.everyMinutes >= 1 ? void 0 : "间隔分钟数必须是正整数";
    case "daily":
      return TIME_PATTERN.test(schedule.time) ? void 0 : "时间格式应为 HH:mm（如 09:00）";
    case "weekly":
      if (!TIME_PATTERN.test(schedule.time)) return "时间格式应为 HH:mm（如 09:00）";
      return schedule.weekdays.length === 0 ? "请至少选择一个星期" : void 0;
  }
}

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function pad2$1(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function scheduleSummary(schedule) {
  switch (schedule.type) {
    case "once": {
      const at = new Date(schedule.at);
      return `一次性 · ${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()} ${pad2$1(at.getHours())}:${pad2$1(at.getMinutes())}`;
    }
    case "interval":
      return `每 ${schedule.everyMinutes} 分钟`;
    case "daily":
      return `每天 ${schedule.time}`;
    case "weekly": {
      const days = new Set(schedule.weekdays);
      const names = WEEKDAY_DISPLAY_ORDER.filter((d) => days.has(d)).map(
        (d) => WEEKDAY_NAMES[d]
      );
      return `每周${names.join("、")} ${schedule.time}`;
    }
  }
}

const SCHEDULE = { type: "daily", time: "03:00" };

function distillPrompt(sessionsDir, profile) {
  return [
    "你是 ZeroWork 的记忆整理任务，每晚在无人值守下自动运行。没有人与你对话：你的价值在落盘的文件里，不在回复本身。",
    "",
    "按以下步骤工作：",
    `1. 会话文件在 ${sessionsDir} 下（JSONL，一行一条消息）。用 ls 按修改时间找出最近 3 天内有改动的会话文件；一个都没有就到此为止，不改写任何文件。`,
    "2. 用 read 浏览这些会话，提取关于用户本人的持久信息，分两类：",
    "   - 工作背景：角色与职责、手头在做的项目、常用技术栈、工作环境（操作系统、工具链等）；",
    "   - 个人背景：沟通偏好（语言、语气）、输出偏好（格式、详略）、稳定的工作习惯。",
    "   只留跨会话稳定的事实；一次性的事务内容、临时状态不要提炼。",
    `3. 画像文件是 ${profile}（不存在就视为空白）。先 read 现状，再用 write/edit 更新它：保持「## 工作背景」「## 个人背景」两节结构，新信息合并进去，仍有价值的旧内容保留，已被新信息证伪或过时的条目删掉。没有新信息时不改写文件。`,
    "",
    "完成后只回一两句简短总结（如「已更新画像的工作背景一节」或「无新信息，未改动」）。"
  ].join("\n");
}

function ensureBuiltinMemoryTask(store, memoryEnabled, now = Date.now()) {
  const desiredStatus = memoryEnabled ? "active" : "paused";
  const existing = store.get(BUILTIN_MEMORY_TASK_ID);
  if (existing === void 0) {
    store.upsert({
      id: BUILTIN_MEMORY_TASK_ID,
      name: "记忆整理",
      prompt: distillPrompt(getSessionsDir(), profilePath()),
      schedule: SCHEDULE,
      status: desiredStatus,
      cwd: getConfigDir(),
      runs: [],
      createdAt: now,
      updatedAt: now,
      nextRunAt: nextRunAfter(SCHEDULE, now),
      builtin: true
    });
    return true;
  }
  if (existing.status === desiredStatus) return false;
  const nextRunAt = desiredStatus === "active" ? nextRunAfter(existing.schedule, now) : existing.nextRunAt;
  store.upsert({ ...existing, status: desiredStatus, nextRunAt, updatedAt: now });
  return true;
}

export {
	BUILTIN_MEMORY_TASK_ID,
	MINUTE_MS,
	SCHEDULE,
	TIME_PATTERN,
	WEEKDAY_DISPLAY_ORDER,
	WEEKDAY_NAMES,
	distillPrompt,
	ensureBuiltinMemoryTask,
	nextRunAfter,
	pad2$1,
	parseTime,
	scheduleSummary,
	validateSchedule,
};