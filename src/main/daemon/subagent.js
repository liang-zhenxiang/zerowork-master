import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { normalizeMemberOutput } from "./mailbox.js";

const TEAM_OUTPUT_MAX_CHARS = 4e3;

const SNAPSHOT_NOTE = "以下是你还没见过的成员产出增量；状态行末尾的 [fp xxxxxxxx] 只用于跨轮去重，你可以忽略它。";

function outputFingerprint(output) {
  return createHash("sha256").update(normalizeMemberOutput(output)).digest("hex").slice(0, 8);
}

function collectFingerprintsFromSession(text) {
  const found = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/\[fp ([0-9a-f]{8})\]/g)) {
    const fingerprint = match[1];
    if (fingerprint !== void 0) found.add(fingerprint);
  }
  return found;
}

function collectTeamOutputMembers(team, readOutput) {
  if (team === void 0) return void 0;
  const members = [];
  for (const member of team.members.values()) {
    const facts = {
      name: member.name,
      agentName: member.agentName,
      status: member.status,
      turns: member.turns
    };
    if (member.sessionId === void 0) {
      members.push(facts);
      continue;
    }
    const output = readOutput(member.sessionId);
    if (output === void 0 || output.trim() === "") {
      members.push(facts);
      continue;
    }
    members.push({ ...facts, output });
  }
  return members;
}

export {
	SNAPSHOT_NOTE,
	TEAM_OUTPUT_MAX_CHARS,
	collectFingerprintsFromSession,
	collectTeamOutputMembers,
	outputFingerprint,
};