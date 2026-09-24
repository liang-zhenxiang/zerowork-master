import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, delimiter, basename, extname } from "node:path";
import { app, Menu, BrowserWindow, session, ipcMain, shell, utilityProcess, globalShortcut, dialog } from "electron";
import {
  DEFAULT_GLOBAL_SHORTCUT,
  INVOKE,
  PUSH,
  PDF_EXTENSION,
  OFFICE_EXTENSIONS,
  docKindOf,
} from "../shared/ipc.js";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MENU_BAR_ITEMS = [
  { id: "about", label: "关于", mnemonic: "A" },
  { id: "edit", label: "编辑", mnemonic: "E" },
  { id: "window", label: "窗口", mnemonic: "W" }
];
const MENUBAR_HEIGHT = 30;
function appMenuTemplate(isMac, onAbout) {
  const labelOf = (id) => {
    const item = MENU_BAR_ITEMS.find((entry) => entry.id === id);
    if (item === void 0) throw new Error(`菜单项未登记：${id}`);
    return isMac ? item.label : `${item.label}(&${item.mnemonic})`;
  };
  const submenuOf = (id) => {
    if (id === "about") {
      return [
        { label: "关于 ZeroWork", click: onAbout },
        { type: "separator" },
        isMac ? { role: "hide", label: "隐藏" } : { role: "quit", label: "退出" }
      ];
    }
    if (id === "edit") {
      return [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ];
    }
    if (id === "window") {
      return [
        { role: "minimize", label: "最小化" },
        // zoom 只有 macOS 有意义（Windows 的最大化走窗口控件）。
        ...isMac ? [{ role: "zoom", label: "缩放" }] : [],
        { role: "close", label: "关闭" }
      ];
    }
    throw new Error(`菜单项未实现内容：${id}`);
  };
  return MENU_BAR_ITEMS.map((item) => ({
    id: item.id,
    label: labelOf(item.id),
    submenu: submenuOf(item.id)
  }));
}
function decideToggleAction(state) {
  return state.visible && state.focused ? "minimize" : "restore-focus";
}
class GlobalToggleShortcutController {
  constructor(window2, report, shortcuts) {
    this.window = window2;
    this.report = report;
    this.shortcuts = shortcuts;
  }
  window;
  report;
  shortcuts;
  #status;
  get status() {
    return this.#status;
  }
  /**
   * 注册全局热键。返回 false（热键被占用）不抛错 —— 经 report 记录 failed
   * 状态，应用照常启动（连注册异常
   * 也降级成 failed 上报而不是让启动炸掉；热键是便利功能，不配炸启动）。
   */
  register(accelerator = DEFAULT_GLOBAL_SHORTCUT) {
    let ok = false;
    try {
      ok = this.shortcuts.register(accelerator, () => this.toggle());
    } catch {
      ok = false;
    }
    this.#status = ok ? { kind: "registered", accelerator } : { kind: "failed", accelerator };
    this.report(this.#status);
    return ok;
  }
  /** 热键按下：可见且聚焦 → 最小化；否则唤起（还原 + 显示 + 聚焦）。 */
  toggle() {
    const state = {
      focused: this.window.isFocused(),
      visible: this.window.isVisible(),
      minimized: this.window.isMinimized()
    };
    if (decideToggleAction(state) === "minimize") {
      this.window.minimize();
      return;
    }
    if (state.minimized) this.window.restore();
    if (!state.visible) this.window.show();
    this.window.focus();
  }
  /** 进程退出时释放（will-quit）。 */
  dispose() {
    this.shortcuts.unregisterAll();
  }
}
const MAIN_HANDLED = [
  INVOKE.daemonStatus,
  INVOKE.globalShortcutStatus,
  INVOKE.openArtifact,
  INVOKE.menuPopup,
  INVOKE.saveArtifactAs,
  INVOKE.pickWorkspaceDirectory,
  INVOKE.pickSkillDirectory,
  INVOKE.pickInputFiles,
  INVOKE.importProfile,
  INVOKE.workspaceReveal
];
let window;
let daemon;
let daemonStatus = { kind: "starting" };
let globalShortcutStatus;
let toggleShortcut;
const pending = /* @__PURE__ */ new Map();
function send(channel, payload) {
  if (window?.isDestroyed() === false) window.webContents.send(channel, payload);
}
function daemonEnv() {
  const env = { ...process.env, ZEROWORK_APP_DIR: app.getAppPath() };
  if (!app.isPackaged) return env;
  const resourcesDir = join(process.resourcesPath, "resources");
  env.ZEROWORK_RESOURCES_DIR = resourcesDir;
  const uvBinDir = join(resourcesDir, "bin");
  if (existsSync(uvBinDir)) {
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "Path";
    env[pathKey] = `${uvBinDir}${delimiter}${env[pathKey] ?? ""}`;
  }
  return env;
}
function startDaemon() {
  const entry = join(import.meta.dirname, "daemon.mjs");
  const child = utilityProcess.fork(entry, [], {
    // pi 会读 stdout/stderr 之外的诊断，转给父进程便于排障。
    stdio: "pipe",
    serviceName: "zerowork-daemon",
    /*
     * daemon 的 cwd 继承本进程的启动目录、不可靠（换种启动方式就变，打包后更甚）。
     * 而应用根是权限边界的���入（workspace 守卫拒「把应用目录设为工作空间」），
     * 值漂了会误伤无关目录或让边界失效 —— 所以用 Electron 的权威值显式传给 daemon
     * （dev = 项目根，打包 = app.asar）。见 core/config-paths.ts 的 getAppDir。
     * 打包态的 resources 定位与随包 uv 见 daemonEnv。
     */
    env: daemonEnv()
  });
  daemon = child;
  child.stdout?.on("data", (chunk) => process.stdout.write(`[daemon] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[daemon] ${chunk}`));
  child.on("message", (frame) => {
    switch (frame.kind) {
      case "ready":
        daemonStatus = { kind: "ready" };
        send(PUSH.daemonReady, void 0);
        return;
      case "push":
        send(frame.channel, frame.payload);
        return;
      case "response": {
        const slot = pending.get(frame.id);
        if (slot === void 0) return;
        pending.delete(frame.id);
        if (frame.ok) slot.resolve(frame.value);
        else slot.reject(new Error(frame.error));
        return;
      }
    }
  });
  child.on("exit", (code) => {
    daemon = void 0;
    const reason = `daemon 退出（code ${code}）`;
    daemonStatus = { kind: "down", reason };
    for (const [, slot] of pending) slot.reject(new Error(reason));
    pending.clear();
    send(PUSH.daemonDown, { reason });
  });
}
function callDaemon(channel, args) {
  const child = daemon;
  if (child === void 0) return Promise.reject(new Error("daemon 未运行"));
  const id = randomUUID();
  const request = { kind: "request", id, channel, args };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.postMessage(request);
  });
}
function installCsp(isDev) {
  const widgetScriptSrc = " 'unsafe-inline' blob: https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";
  const policy = isDev ? "default-src 'self'; script-src 'self'" + widgetScriptSrc + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://127.0.0.1:*; connect-src 'self' ws://localhost:* http://localhost:* http://127.0.0.1:*; frame-src http://127.0.0.1:*" : "default-src 'self'; script-src 'self'" + widgetScriptSrc + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:*; frame-src http://127.0.0.1:*";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] }
    });
  });
}
function isAppUrl(url, devServer) {
  try {
    const target = new URL(url);
    if (devServer !== void 0) return target.origin === new URL(devServer).origin;
    return target.protocol === "file:" && target.pathname.endsWith("/renderer/index.html");
  } catch {
    return false;
  }
}
function createWindow() {
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "ZeroWork",
    /*
     * 窗口外壳（§4.32）：不用系统标题栏，改由 titleBarOverlay 提供窗口控件，
     * 菜单条与它共用同一条 30px 带子（见 app-menu.ts）。
     * 关键是 color 全透明（#00000000）—— 那条带子自己不画底色，所以视觉上
     * 没有「顶上那根线」，内容区看起来是嵌在窗口里的一张卡。
     * macOS 走 hiddenInset：原生红绿灯保留，不用自绘。
     */
    ...process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {
      /*
       * **必须是 `titleBarStyle: "hidden"`，不能用 `frame: false`。**
       * `titleBarOverlay` 只在设了自定义 titleBarStyle 时才生效
       * （Electron 文档原文：only works whenever a custom titlebarStyle
       * is applied）—— 只写 frame:false 的话窗口控件根本不会被画出来，
       * 用户看到的是一个既没有标题栏也没有按钮的窗口（2026-09-19 实测，
       * 探针截图见 §4.32 修正）。
       */
      titleBarStyle: "hidden",
      titleBarOverlay: {
        height: MENUBAR_HEIGHT,
        color: "#00000000",
        // 窗口控件图标色。与本文件 `:root` 的 --text 同深（当前只有浅色主题）。
        symbolColor: "#333333"
      }
    },
    // 透明 overlay 下露出来的就是它；与 `:root` 的 --bg 一致。
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      // renderer 跑的是不可信内容（模型产出的 HTML 会在预览面板里渲染），
      // 三道开关都不能松：能力只能经 preload 的白名单桥暴露。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
      // preload 需要 require 走 IPC；不开 nodeIntegration 已足够
    }
  });
  window.once("ready-to-show", () => window?.show());
  const openExternally = (url) => {
    void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (details) => {
    if (isAppUrl(details.url, devServer)) return;
    details.preventDefault();
    openExternally(details.url);
  });
  if (devServer !== void 0) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}
function appendMainEventLog(record) {
  const override = process.env["ZEROWORK_CONFIG_DIR"];
  const configDir = override !== void 0 && override !== "" ? override : join(homedir(), ".zerowork");
  const logDir = join(configDir, "logs");
  const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, `events-${day}.jsonl`), `${JSON.stringify({ ts: Date.now(), ...record })}
`, "utf8");
  } catch (error) {
    console.error("[main] 事件日志落盘失败:", error);
  }
}
function setupGlobalShortcut() {
  toggleShortcut = new GlobalToggleShortcutController(
    {
      minimize: () => window?.minimize(),
      restore: () => window?.restore(),
      show: () => window?.show(),
      focus: () => window?.focus(),
      isFocused: () => window?.isFocused() ?? false,
      isVisible: () => window?.isVisible() ?? false,
      isMinimized: () => window?.isMinimized() ?? false
    },
    (status) => {
      globalShortcutStatus = status;
      if (status.kind === "failed") {
        console.warn(`[main] 全局唤起热键 "${status.accelerator}" 注册失败，可能被其他程序占用`);
        appendMainEventLog({ kind: "global_shortcut", event: "register_failed", accelerator: status.accelerator });
      }
    },
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregisterAll: () => globalShortcut.unregisterAll()
    }
  );
  toggleShortcut.register();
}
function registerIpc() {
  for (const channel of Object.values(INVOKE)) {
    if (MAIN_HANDLED.includes(channel)) continue;
    ipcMain.handle(channel, (_event, ...args) => callDaemon(channel, args));
  }
  ipcMain.handle(INVOKE.daemonStatus, () => daemonStatus);
  ipcMain.handle(INVOKE.globalShortcutStatus, () => globalShortcutStatus);
  ipcMain.handle(INVOKE.openArtifact, async (_event, path) => {
    const error = await shell.openPath(path);
    if (error !== "") throw new Error(error);
  });
  ipcMain.handle(INVOKE.menuPopup, (event, id, x, y) => {
    const item = Menu.getApplicationMenu()?.items.find((entry) => entry.id === id);
    if (item?.submenu === void 0 || item.submenu === null) {
      throw new Error(`找不到菜单项：${id}`);
    }
    const sender = BrowserWindow.fromWebContents(event.sender);
    item.submenu.popup({ ...sender === null ? {} : { window: sender }, x, y });
  });
  ipcMain.handle(INVOKE.workspaceReveal, async (_event, cwd) => {
    await callDaemon(INVOKE.workspaceReveal, [cwd]);
    const error = await shell.openPath(cwd);
    if (error !== "") throw new Error(error);
  });
  ipcMain.handle(INVOKE.saveArtifactAs, async (_event, request) => {
    if (window === void 0) return void 0;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: request.suggestedName
    });
    return canceled ? void 0 : filePath;
  });
  ipcMain.handle(INVOKE.pickWorkspaceDirectory, async () => {
    if (window === void 0) return void 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "选择工作空间目录",
      properties: ["openDirectory", "createDirectory"]
    });
    return canceled ? void 0 : filePaths[0];
  });
  ipcMain.handle(INVOKE.pickSkillDirectory, async () => {
    if (window === void 0) return void 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "选择技能文件夹（需包含 SKILL.md）",
      properties: ["openDirectory"]
    });
    return canceled || filePaths.length === 0 ? void 0 : filePaths[0];
  });
  ipcMain.handle(INVOKE.importProfile, async () => {
    if (window === void 0) return void 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "选择画像文件（Markdown）",
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (canceled || filePaths.length === 0) return void 0;
    const path = filePaths[0];
    if (path === void 0) return void 0;
    const content = await readFile(path, "utf8");
    return { content };
  });
  ipcMain.handle(INVOKE.pickInputFiles, async () => {
    if (window === void 0) return void 0;
    const imageExts = ["png", "jpg", "jpeg", "gif", "webp"];
    const docExts = [PDF_EXTENSION, ...OFFICE_EXTENSIONS].map((ext) => ext.slice(1));
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "选择图片或文档",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "所有支持的文件", extensions: [...imageExts, ...docExts] },
        { name: "图片", extensions: imageExts },
        { name: "文档", extensions: docExts }
      ]
    });
    if (canceled || filePaths.length === 0) return void 0;
    const images = [];
    const documents = [];
    for (const path of filePaths) {
      const kind = docKindOf(path);
      if (kind === "pdf" || kind === "office") {
        documents.push({ path, name: basename(path) });
      } else {
        images.push(await readImageFile(path));
      }
    }
    return { images, documents };
  });
}
function imageMimeTypeOf(path) {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`不支持的图片格式：${path}`);
  }
}
async function readImageFile(path) {
  const { size } = await stat(path);
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`「${basename(path)}」超过 5MB 上限`);
  }
  const data = await readFile(path);
  return { type: "image", data: data.toString("base64"), mimeType: imageMimeTypeOf(path) };
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window === void 0) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  void app.whenReady().then(() => {
    installCsp(process.env["ELECTRON_RENDERER_URL"] !== void 0);
    registerIpc();
    startDaemon();
    app.setAboutPanelOptions({
      applicationName: "ZeroWork",
      applicationVersion: app.getVersion()
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(process.platform === "darwin", () => app.showAboutPanel())
      )
    );
    createWindow();
    setupGlobalShortcut();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    daemon?.kill();
  });
  app.on("will-quit", () => {
    toggleShortcut?.dispose();
  });
}
