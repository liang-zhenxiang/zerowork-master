/**
 * 定时任务的时间计算与校验单元测试。
 *
 * 这块是**日期数学**，最容易写出「平时都对、跨天/跨周就错」的 bug，
 * 而且错了不会报错，只会让任务在该跑的时候不跑。纯函数 + 固定时间点 = 完全确定，
 * 正适合单测钉住。
 *
 * 注意：`nextRunAfter` 走的是**本地时间**（`new Date(y, m, d, h, min)`），
 * 所以断言也用本地时间构造，避免依赖时区。
 */
import { describe, it, expect } from "vitest";
import {
	MINUTE_MS,
	nextRunAfter,
	parseTime,
	scheduleSummary,
	validateSchedule,
} from "../../src/main/daemon/schedule.js";

/** 构造本地时间戳，读起来比 `new Date(...).getTime()` 干净。 */
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("parseTime", () => {
	it("解析 HH:mm", () => {
		expect(parseTime("09:30")).toEqual({ hours: 9, minutes: 30 });
		expect(parseTime("00:00")).toEqual({ hours: 0, minutes: 0 });
		expect(parseTime("23:59")).toEqual({ hours: 23, minutes: 59 });
	});
});

describe("validateSchedule", () => {
	it("合法配置返回 undefined", () => {
		expect(validateSchedule({ type: "once", at: Date.now() + 60_000 })).toBeUndefined();
		expect(validateSchedule({ type: "interval", everyMinutes: 30 })).toBeUndefined();
		expect(validateSchedule({ type: "daily", time: "09:00" })).toBeUndefined();
		expect(validateSchedule({ type: "weekly", time: "09:00", weekdays: [1, 3] })).toBeUndefined();
	});

	it.each([
		["间隔为 0", { type: "interval", everyMinutes: 0 }],
		["间隔为负", { type: "interval", everyMinutes: -5 }],
		["间隔不是整数", { type: "interval", everyMinutes: 1.5 }],
		["时间格式错", { type: "daily", time: "9点" }],
		["时间越界", { type: "daily", time: "25:00" }],
		["weekly 没选星期", { type: "weekly", time: "09:00", weekdays: [] }],
	])("非法配置给出中文原因：%s", (_label, schedule) => {
		const reason = validateSchedule(schedule);
		expect(typeof reason).toBe("string");
		expect(reason.length).toBeGreaterThan(0);
	});
});

describe("nextRunAfter：once", () => {
	const from = at(2026, 3, 10, 12, 0);

	it("时刻在未来 → 就返回它", () => {
		const target = from + 3_600_000;
		expect(nextRunAfter({ type: "once", at: target }, from)).toBe(target);
	});

	it("时刻已过 → 返回 undefined（不再调度）", () => {
		expect(nextRunAfter({ type: "once", at: from - 1 }, from)).toBeUndefined();
		expect(nextRunAfter({ type: "once", at: from }, from)).toBeUndefined();
	});
});

describe("nextRunAfter：interval", () => {
	const from = at(2026, 3, 10, 12, 7, 13);

	it("返回下一个整间隔边界（严格大于当前时刻）", () => {
		const next = nextRunAfter({ type: "interval", everyMinutes: 30 }, from);
		const intervalMs = 30 * MINUTE_MS;
		expect(next).toBeGreaterThan(from);
		expect(next % intervalMs).toBe(0);
		// 上一个边界不应晚于当前时刻，否则就是跳过了一整个周期
		expect(next - intervalMs).toBeLessThanOrEqual(from);
	});

	it("间隔非法时抛错（不静默返回一个错的时间）", () => {
		expect(() => nextRunAfter({ type: "interval", everyMinutes: 0 }, from)).toThrow(/正整数/);
	});
});

describe("nextRunAfter：daily", () => {
	it("今天还没到点 → 今天的那个时刻", () => {
		const from = at(2026, 3, 10, 8, 0);
		expect(nextRunAfter({ type: "daily", time: "09:00" }, from)).toBe(at(2026, 3, 10, 9, 0));
	});

	it("今天已经过点 → 明天的那个时刻", () => {
		const from = at(2026, 3, 10, 10, 0);
		expect(nextRunAfter({ type: "daily", time: "09:00" }, from)).toBe(at(2026, 3, 11, 9, 0));
	});

	it("正好等于该时刻 → 顺延到明天（下次，不是这次）", () => {
		const from = at(2026, 3, 10, 9, 0);
		expect(nextRunAfter({ type: "daily", time: "09:00" }, from)).toBe(at(2026, 3, 11, 9, 0));
	});

	it("跨月边界正确", () => {
		const from = at(2026, 3, 31, 10, 0);
		expect(nextRunAfter({ type: "daily", time: "09:00" }, from)).toBe(at(2026, 4, 1, 9, 0));
	});
});

describe("nextRunAfter：weekly", () => {
	// 2026-03-10 是周二。用 dayOfWeek 反查一个确定的周一，避免把星期算错。
	const monday = (() => {
		const d = new Date(2026, 2, 10);
		while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
		return d;
	})();
	const nextMonday = (() => {
		const d = new Date(monday);
		d.setDate(d.getDate() + 7);
		return d;
	})();

	it("本周的那天还没到 → 本周", () => {
		const from = new Date(monday).setHours(8, 0, 0, 0);
		const expected = new Date(monday).setHours(9, 0, 0, 0);
		expect(nextRunAfter({ type: "weekly", time: "09:00", weekdays: [1] }, from)).toBe(expected);
	});

	it("本周的那天已经过点 → 下周同一天", () => {
		const from = new Date(monday).setHours(10, 0, 0, 0);
		const expected = new Date(nextMonday).setHours(9, 0, 0, 0);
		expect(nextRunAfter({ type: "weekly", time: "09:00", weekdays: [1] }, from)).toBe(expected);
	});

	it("多选星期时取最近的那一天", () => {
		const from = new Date(monday).setHours(10, 0, 0, 0); // 周一 10:00，周一的点已过
		const tuesday = new Date(monday);
		tuesday.setDate(tuesday.getDate() + 1);
		const expected = new Date(tuesday).setHours(9, 0, 0, 0);
		expect(nextRunAfter({ type: "weekly", time: "09:00", weekdays: [1, 2] }, from)).toBe(expected);
	});
});

describe("scheduleSummary", () => {
	it("四种类型都能给出可读的中文摘要", () => {
		expect(scheduleSummary({ type: "interval", everyMinutes: 30 })).toContain("30");
		expect(scheduleSummary({ type: "daily", time: "09:00" })).toContain("09:00");
		const weekly = scheduleSummary({ type: "weekly", time: "09:00", weekdays: [1, 3] });
		expect(weekly).toContain("09:00");
		// 格式是「每周<短名顿号相连> <时间>」，即 `每周一、三 09:00`（不是「周一、周三」）
		expect(weekly).toContain("每周");
		expect(weekly).toContain("一");
		expect(weekly).toContain("三");
		const once = scheduleSummary({ type: "once", at: at(2026, 3, 10, 9, 0) });
		expect(once).toContain("2026");
	});

	it("星期的显示顺序是周一优先（符合中文习惯，而非周日打头）", () => {
		// 短名：日/一/二/… —— 所以断言的是它们在串里的先后
		const text = scheduleSummary({ type: "weekly", time: "09:00", weekdays: [0, 1] });
		expect(text.indexOf("一")).toBeLessThan(text.indexOf("日"));
	});
});