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
import { getArchiveFile } from "./config-paths.js";

class SessionArchive {
  constructor(filePath = getArchiveFile()) {
    this.filePath = filePath;
  }
  filePath;
  index = /* @__PURE__ */ new Map();
  loaded = false;
  /** 加载。文件不存在 / JSON 损坏 / 结构不符一律当空索引（理由见文件头）。 */
  ensureLoaded() {
    if (this.loaded) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [path, at] of Object.entries(parsed)) {
          if (typeof at === "number" && Number.isFinite(at)) this.index.set(path, at);
        }
      }
    } catch {
      this.index = /* @__PURE__ */ new Map();
    }
    this.loaded = true;
  }
  /** 是否已归档（未归档 / 从未归档过都是 false）。 */
  isArchived(path) {
    this.ensureLoaded();
    return this.index.has(path);
  }
  /** 归档时刻；未归档为 undefined（列表排序可用）。 */
  archivedAt(path) {
    this.ensureLoaded();
    return this.index.get(path);
  }
  /** 归档 / 取消归档，随即原子落盘。幂等：状态不变时不落盘。 */
  setArchived(path, archived, now) {
    this.ensureLoaded();
    if (archived) {
      if (this.index.has(path)) return;
      this.index.set(path, now);
    } else {
      if (!this.index.delete(path)) return;
    }
    this.persist();
  }
  persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify(Object.fromEntries(this.index), null, 2)}
`,
      "utf8"
    );
    renameSync(tmp, this.filePath);
  }
}

export {
	SessionArchive,
};