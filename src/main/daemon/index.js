import { ensureUserMemoryFiles } from "./memory.js";
import { RunLedger } from "./ledger.js";
import { isDaemonRequest } from "./session-state.js";
import {
	appendRule,
	backgroundJobs,
	dispatch,
	eventLog,
	observability,
	parentPort,
	runLedgerDir,
	start,
	teamMessaging,
} from "./session-files.js";

ensureUserMemoryFiles();

RunLedger.sealOrphans(runLedgerDir, (file, message) => {
  eventLog.append({ kind: "run_ledger_error", file, message });
});

observability.replayLedgerDir(runLedgerDir, (message) => {
  eventLog.append({ kind: "run_ledger_error", message });
});

parentPort.on("message", (message) => {
  const frame = message.data;
  if (!isDaemonRequest(frame)) {
    console.error(`收到无法识别的帧：${JSON.stringify(frame)}`);
    return;
  }
  void dispatch(frame);
});

process.on("exit", () => {
  void backgroundJobs.killAll();
});

process.on("uncaughtException", (error) => {
  eventLog.append({
    kind: "fatal",
    why: "uncaughtException",
    message: error.message,
    stack: error.stack
  });
  console.error(error.stack ?? error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  eventLog.append({
    kind: "fatal",
    why: "unhandledRejection",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : void 0
  });
  console.error(reason);
});

try {
  start();
} catch (error) {
  console.error("daemon 启动失败");
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  eventLog.append({
    kind: "fatal",
    why: "startup",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : void 0
  });
  process.exit(1);
}

export {
  appendRule,
  teamMessaging
};