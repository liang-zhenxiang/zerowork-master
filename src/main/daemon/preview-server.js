import { accessSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { closeSync } from "node:fs";
import { constants } from "node:fs";
import { copyFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { delimiter } from "node:path";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fstatSync } from "node:fs";
import { get } from "node:http";
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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  // .ogg 容器音视频两栖，内容未知时 RFC 5334 推荐 application/ogg（媒体元素会嗅探）。
  ".ogg": "application/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

function mimeOf(path) {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

class PreviewServer {
  server;
  root;
  port;
  get baseUrl() {
    if (this.server === void 0 || this.port === void 0) return void 0;
    return `http://127.0.0.1:${this.port}`;
  }
  /** 当前服务的根目录（调试用）。 */
  get rootDir() {
    return this.root;
  }
  /**
   * 切换服务根目录。undefined 表示停止服务（当前无可预览目录）。
   * 同根重复调用是 no-op —— 不重启服务，正在预览的页面不掉线。
   */
  async setRoot(dir) {
    if (dir === this.root) return;
    await this.close();
    if (dir === void 0) return;
    this.root = dir;
    this.server = createServer((req, res) => this.handle(req.url ?? "/", res));
    await new Promise((resolveListen, rejectListen) => {
      this.server?.once("error", rejectListen);
      this.server?.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (typeof address === "object" && address !== null) this.port = address.port;
        resolveListen();
      });
    });
  }
  async close() {
    const server = this.server;
    this.server = void 0;
    this.root = void 0;
    this.port = void 0;
    if (server !== void 0) {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
  }
  /**
   * URL 路径 → 根内绝对路径。越界返回 undefined。
   * 先 decode 再 resolve：%2e%2e%2f 与 ../ 同等处理，不存在绕过通道。
   */
  resolveWithinRoot(urlPath) {
    if (this.root === void 0) return void 0;
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return void 0;
    }
    const abs = resolve(this.root, decoded.replace(/^[/\\]+/, ""));
    return abs === this.root || abs.startsWith(this.root + sep) ? abs : void 0;
  }
  handle(url, res) {
    const q = url.indexOf("?");
    const path = this.resolveWithinRoot(q === -1 ? url : url.slice(0, q));
    if (path === void 0 || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const headers = { "content-type": mimeOf(path) };
    if (q !== -1 && url.slice(q + 1).split("&").includes("download")) {
      const name = path.slice(path.lastIndexOf(sep) + 1);
      headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    }
    headers["access-control-allow-origin"] = "*";
    headers["access-control-allow-private-network"] = "true";
    res.writeHead(200, headers);
    createReadStream(path).pipe(res);
  }
}

class PreviewServers {
  servers = /* @__PURE__ */ new Map();
  /** 同 cwd 的并发 ensure 共享同一个启动 promise，不会起出两个服务。 */
  starting = /* @__PURE__ */ new Map();
  /** 查询某 cwd 的服务地址；该 cwd 的服务未启动时返回 undefined（契约口径，不视为错误）。 */
  baseUrlFor(cwd) {
    return this.servers.get(cwd)?.baseUrl;
  }
  /**
   * 确保某 cwd 的服务已启动，返回 baseUrl。
   * 启动失败时清掉半成品实例并抛错 —— 调用方决定响亮失败（工作区切换）
   * 还是记日志降级（启动预热），本层不静默吞。
   */
  async ensure(cwd) {
    const running = this.servers.get(cwd);
    if (running !== void 0) return running.baseUrl;
    const pending = this.starting.get(cwd);
    if (pending !== void 0) return pending;
    const attempt = (async () => {
      const server = new PreviewServer();
      try {
        await server.setRoot(cwd);
      } catch (error) {
        await server.close();
        throw error;
      }
      this.servers.set(cwd, server);
      return server.baseUrl;
    })();
    this.starting.set(cwd, attempt);
    try {
      return await attempt;
    } finally {
      this.starting.delete(cwd);
    }
  }
  /** 进程退出前收尾。daemon 随 utilityProcess 被杀时操作系统会回收端口，这里主要服务测试。 */
  async closeAll() {
    const servers = [...this.servers.values()];
    this.servers.clear();
    await Promise.all(servers.map((server) => server.close()));
  }
}

export {
	MIME,
	PreviewServer,
	PreviewServers,
	mimeOf,
};