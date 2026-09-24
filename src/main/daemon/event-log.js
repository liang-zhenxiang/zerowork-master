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

class EventLog {
  /** 注入时钟便于测试断言文件名；生产用 Date.now。 */
  constructor(logDir, now = Date.now) {
    this.logDir = logDir;
    this.now = now;
    mkdirSync(logDir, { recursive: true });
  }
  logDir;
  now;
  get dir() {
    return this.logDir;
  }
  /** 追加一条记录。ts 由这里统一打点，调用方不各自取时间。 */
  append(record) {
    const ts = this.now();
    const line = `${JSON.stringify({ ts, ...record })}
`;
    appendFileSync(this.fileFor(ts), line, "utf8");
  }
  /** 按日期分文件：events-2026-09-07.jsonl。天然轮转，查问题按天翻。 */
  fileFor(ts) {
    const day = new Date(ts).toISOString().slice(0, 10);
    return join(this.logDir, `events-${day}.jsonl`);
  }
}

export {
	EventLog,
};