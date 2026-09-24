import { c as clientExports, j as jsxRuntimeExports, r as reactExports } from "./app.js";
const LOW_FPS = 55;
const LONG_TASK_MS = 50;
const SAMPLE_MS = 1e3;
const STALE_MS = 2e3;
const WINDOW_MS = 1e4;
const EMPTY_SNAPSHOT = { fps: 0, recentLongTasks: 0, longestMs: 0 };
function observeLongTasks(onLongTask) {
  if (typeof PerformanceObserver === "undefined") return void 0;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (supported === void 0 || !supported.includes("longtask")) return void 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration <= LONG_TASK_MS) continue;
      onLongTask({ duration: entry.duration, name: entry.name, startTime: entry.startTime });
    }
  });
  try {
    observer.observe({ entryTypes: ["longtask"] });
  } catch (error) {
    console.warn("[perf] longtask 采集不可用：", error);
    return void 0;
  }
  return observer;
}
function takeSnapshot(fps, longTasks, now) {
  while (longTasks.length > 0 && now - longTasks[0].startTime > WINDOW_MS) longTasks.shift();
  let longestMs = 0;
  for (const task of longTasks) longestMs = Math.max(longestMs, task.duration);
  longestMs = Math.round(longestMs);
  if (fps < LOW_FPS) {
    console.warn(
      `[perf] FPS ${fps}（低于 ${LOW_FPS}）｜最近 ${WINDOW_MS / 1e3}s longtask ${longTasks.length} 条，最长 ${longestMs}ms`,
      longTasks
    );
  }
  return { fps, recentLongTasks: longTasks.length, longestMs };
}
function startPerfMonitor(onSample) {
  let disposed = false;
  let frames = 0;
  let windowStart = performance.now();
  let rafId = 0;
  const longTasks = [];
  const observer = observeLongTasks((task) => {
    longTasks.push(task);
    console.warn(
      `[perf] longtask ${Math.round(task.duration)}ms（startTime ${Math.round(task.startTime)}ms）`,
      task.name
    );
  });
  const tick = (now) => {
    if (disposed) return;
    frames += 1;
    const elapsed = now - windowStart;
    if (elapsed >= SAMPLE_MS) {
      if (elapsed < STALE_MS) onSample(takeSnapshot(Math.round(frames * 1e3 / elapsed), longTasks, now));
      frames = 0;
      windowStart = now;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    observer?.disconnect();
  };
}
const CARD_STYLE = {
  position: "fixed",
  right: "var(--space-5)",
  bottom: "var(--space-5)",
  zIndex: "var(--z-toast)",
  // 采集浮层不许抢业务界面的点击（右下角可能是输入区/按钮），因此只读不可交互。
  pointerEvents: "none",
  display: "grid",
  gap: "var(--space-1)",
  padding: "var(--space-3) var(--space-4)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-meta)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap"
};
const ROW_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-4)"
};
const VALUE_STYLE = {
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums"
};
function PerfOverlay() {
  const [snapshot, setSnapshot] = reactExports.useState(EMPTY_SNAPSHOT);
  reactExports.useEffect(() => {
    const stop = startPerfMonitor(setSnapshot);
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);
  const lowFps = snapshot.fps > 0 && snapshot.fps < LOW_FPS;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: CARD_STYLE, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: ROW_STYLE, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "FPS" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { ...VALUE_STYLE, color: lowFps ? "var(--danger)" : "var(--text)" }, children: snapshot.fps })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: ROW_STYLE, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
        "longtask ",
        WINDOW_MS / 1e3,
        "s"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: VALUE_STYLE, children: snapshot.recentLongTasks })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: ROW_STYLE, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "最长" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: VALUE_STYLE, children: `${snapshot.longestMs}ms` })
    ] })
  ] });
}
function mountPerfOverlay() {
  const container = document.createElement("div");
  document.body.append(container);
  clientExports.createRoot(container).render(/* @__PURE__ */ jsxRuntimeExports.jsx(PerfOverlay, {}));
}
export {
  mountPerfOverlay
};
