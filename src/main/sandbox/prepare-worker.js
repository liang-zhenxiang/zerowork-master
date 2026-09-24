import { parentPort } from "node:worker_threads";
import { prepareSandbox, classifyFailure } from "./index.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import "node:buffer";
import "node:crypto";
const ENTRY_SCAN_LIMIT = 5e4;
const ENTRY_SCAN_TIME_LIMIT_MS = 2e3;
function countTreeEntries(root, options = {}) {
  const limit = options.limit ?? ENTRY_SCAN_LIMIT;
  const timeLimitMs = options.timeLimitMs ?? ENTRY_SCAN_TIME_LIMIT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + timeLimitMs;
  let entries = 0;
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === void 0) break;
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      entries += 1;
      if (entries >= limit) return { entries, capped: true };
      if (child.isDirectory() && !child.isSymbolicLink()) {
        pending.push(join(dir, child.name));
      }
    }
    if (now() >= deadline) return { entries, capped: true };
  }
  return { entries, capped: false };
}
const port = requirePort(parentPort);
port.on("message", (request) => {
  void run(request);
});
function requirePort(candidate) {
  if (candidate === null) {
    throw new Error("sandbox-prepare-worker：必须在 worker_thread 里运行");
  }
  return candidate;
}
async function run(request) {
  const scan = countTreeEntries(request.workspaceDir);
  try {
    const result = await prepareSandbox({
      workspaceDir: request.workspaceDir,
      writableDirs: [...request.writableDirs]
    });
    post({
      kind: "done",
      fastPath: result.fastPath,
      elapsedMs: result.elapsedMs,
      entries: scan.entries,
      capped: scan.capped
    });
  } catch (error) {
    post({
      kind: "failed",
      reason: classifyFailure(error),
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
function post(message) {
  port.postMessage(message);
}
