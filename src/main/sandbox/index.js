import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
const PROCESS_QUERY_INFORMATION = 1024;
const TOKEN_ASSIGN_PRIMARY = 1;
const TOKEN_DUPLICATE = 2;
const TOKEN_QUERY = 8;
const TOKEN_ADJUST_DEFAULT = 128;
const SE_GROUP_LOGON_ID = 3221225472;
const DISABLE_MAX_PRIVILEGE = 1;
const LUA_TOKEN = 4;
const WRITE_RESTRICTED = 8;
const WinWorldSid = 1;
const TokenGroups = 2;
const TokenDefaultDacl = 6;
const FILE_GENERIC_WRITE = 1179926;
const DELETE = 65536;
const FILE_DELETE_CHILD = 64;
const GRANT_MASK = (FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD) & -131073;
const FILE_ALL_ACCESS = 2032127;
const DACL_SECURITY_INFORMATION = 4;
const SE_FILE_OBJECT = 1;
const TRUSTEE_IS_UNKNOWN = 0;
const TRUSTEE_IS_SID = 0;
const NO_MULTIPLE_TRUSTEE = 0;
const GRANT_ACCESS = 1;
const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 3;
const ACCESS_ALLOWED_ACE_TYPE = 0;
const SID_MAX_SUB_AUTHORITIES = 15;
const SECURITY_MAX_SID_SIZE = 68;
const GENERIC_READ = 2147483648;
const GENERIC_WRITE = 1073741824;
const FILE_SHARE_READ = 1;
const FILE_SHARE_WRITE = 2;
const OPEN_ALWAYS = 4;
const MAX_PATH = 260;
const LOCKFILE_EXCLUSIVE_LOCK = 2;
const STARTF_USESTDHANDLES = 256;
const HANDLE_FLAG_INHERIT = 1;
const CREATE_SUSPENDED = 4;
const CREATE_BREAKAWAY_FROM_JOB = 16777216;
const CREATE_NO_WINDOW = 134217728;
const CREATE_UNICODE_ENVIRONMENT = 1024;
const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 258;
const WAIT_FAILED = 4294967295;
const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
const JOBOBJECT_EXTENDED_LIMIT_SIZE = 144;
const JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16;
const STARTUPINFOW_SIZE = 104;
const PROCESS_INFORMATION_SIZE = 24;
const SID_AND_ATTRIBUTES_SIZE = 16;
const TOKEN_GROUPS_OFFSET = 8;
const EXPLICIT_ACCESS_W_SIZE = 48;
const ERROR_SUCCESS = 0;
const ERROR_INSUFFICIENT_BUFFER = 122;
const ERROR_BROKEN_PIPE = 109;
const ERROR_NO_DATA = 232;
const FORMAT_MESSAGE_FROM_SYSTEM = 4096;
const FORMAT_MESSAGE_IGNORE_INSERTS = 512;
class Win32Error extends Error {
  constructor(api, code, detail) {
    super(`${api} 失败（Win32 ${code}${detail === void 0 || detail === "" ? "" : `：${detail}`}）`);
    this.api = api;
    this.code = code;
    this.name = "Win32Error";
  }
  api;
  code;
}
class FfiUnavailableError extends Error {
  constructor(detail) {
    super(`无法加载 Win32 FFI：${detail}`);
    this.name = "FfiUnavailableError";
  }
}
let loaded;
async function loadWin32() {
  if (loaded !== void 0) return loaded.api;
  loaded = await initialize();
  return loaded.api;
}
function requireLoaded() {
  if (loaded === void 0) {
    throw new Error("Win32 绑定尚未加载：请先 await loadWin32()");
  }
  return loaded;
}
async function initialize() {
  let koffi;
  try {
    const mod = await import("koffi");
    const resolved = mod.default ?? mod;
    if (typeof resolved.load !== "function") {
      throw new Error("koffi 模块形状异常：没有 load 函数");
    }
    koffi = resolved;
  } catch (error) {
    throw new FfiUnavailableError(error instanceof Error ? error.message : String(error));
  }
  let kernel32;
  let advapi32;
  try {
    kernel32 = koffi.load("kernel32.dll");
    advapi32 = koffi.load("advapi32.dll");
  } catch (error) {
    throw new FfiUnavailableError(error instanceof Error ? error.message : String(error));
  }
  const PVOID = koffi.pointer("void");
  const PPVOID = koffi.pointer(PVOID);
  const PUINT32 = koffi.pointer("uint32");
  const startupInfo = koffi.struct("KAMI_STARTUPINFOW", {
    cb: "uint32",
    lpReserved: "str16",
    lpDesktop: "str16",
    lpTitle: "str16",
    dwX: "uint32",
    dwY: "uint32",
    dwXSize: "uint32",
    dwYSize: "uint32",
    dwXCountChars: "uint32",
    dwYCountChars: "uint32",
    dwFillAttribute: "uint32",
    dwFlags: "uint32",
    wShowWindow: "uint16",
    cbReserved2: "uint16",
    lpReserved2: koffi.pointer("uint8"),
    hStdInput: PVOID,
    hStdOutput: PVOID,
    hStdError: PVOID
  });
  const processInfo = koffi.struct("KAMI_PROCESS_INFORMATION", {
    hProcess: PVOID,
    hThread: PVOID,
    dwProcessId: "uint32",
    dwThreadId: "uint32"
  });
  if (startupInfo.size !== STARTUPINFOW_SIZE) {
    throw new FfiUnavailableError(
      `STARTUPINFOW 布局不符：koffi 算出 ${startupInfo.size} 字节，期望 ${STARTUPINFOW_SIZE}`
    );
  }
  if (processInfo.size !== PROCESS_INFORMATION_SIZE) {
    throw new FfiUnavailableError(
      `PROCESS_INFORMATION 布局不符：koffi 算出 ${processInfo.size} 字节，期望 ${PROCESS_INFORMATION_SIZE}`
    );
  }
  const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
  const api = {
    closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
    getLastError: bind(kernel32, "GetLastError", "uint32", []),
    formatMessageW: bind(kernel32, "FormatMessageW", "uint32", [
      "uint32",
      PVOID,
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      PVOID
    ]),
    openProcess: bind(kernel32, "OpenProcess", PVOID, ["uint32", "int", "uint32"]),
    openProcessToken: bind(advapi32, "OpenProcessToken", "int", [PVOID, "uint32", PPVOID]),
    getTokenInformation: bind(advapi32, "GetTokenInformation", "int", [
      PVOID,
      "int",
      PVOID,
      "uint32",
      PUINT32
    ]),
    setTokenInformation: bind(advapi32, "SetTokenInformation", "int", [PVOID, "int", PVOID, "uint32"]),
    createRestrictedToken: bind(advapi32, "CreateRestrictedToken", "int", [
      PVOID,
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      PVOID,
      "uint32",
      PVOID,
      PPVOID
    ]),
    convertStringSidToSidW: bind(advapi32, "ConvertStringSidToSidW", "int", ["str16", PPVOID]),
    createWellKnownSid: bind(advapi32, "CreateWellKnownSid", "int", ["int", PVOID, PVOID, PUINT32]),
    isValidSid: bind(advapi32, "IsValidSid", "int", [PVOID]),
    getLengthSid: bind(advapi32, "GetLengthSid", "uint32", [PVOID]),
    copySid: bind(advapi32, "CopySid", "int", ["uint32", PVOID, PVOID]),
    localAlloc: bind(kernel32, "LocalAlloc", PVOID, ["uint32", "size_t"]),
    localFree: bind(kernel32, "LocalFree", PVOID, [PVOID]),
    setEntriesInAclW: bind(advapi32, "SetEntriesInAclW", "uint32", ["uint32", PVOID, PVOID, PPVOID]),
    getNamedSecurityInfoW: bind(advapi32, "GetNamedSecurityInfoW", "uint32", [
      "str16",
      "int",
      "uint32",
      PPVOID,
      PPVOID,
      PPVOID,
      PPVOID,
      PPVOID
    ]),
    setNamedSecurityInfoW: bind(advapi32, "SetNamedSecurityInfoW", "uint32", [
      "str16",
      "int",
      "uint32",
      PVOID,
      PVOID,
      PVOID,
      PVOID
    ]),
    createFileW: bind(kernel32, "CreateFileW", PVOID, [
      "str16",
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      "uint32",
      PVOID
    ]),
    lockFileEx: bind(kernel32, "LockFileEx", "int", [PVOID, "uint32", "uint32", "uint32", "uint32", PVOID]),
    unlockFileEx: bind(kernel32, "UnlockFileEx", "int", [PVOID, "uint32", "uint32", "uint32", PVOID]),
    getTempPathW: bind(kernel32, "GetTempPathW", "uint32", ["uint32", PVOID]),
    getVolumePathNameW: bind(kernel32, "GetVolumePathNameW", "int", ["str16", PVOID, "uint32"]),
    getVolumeInformationW: bind(kernel32, "GetVolumeInformationW", "int", [
      "str16",
      PVOID,
      "uint32",
      PVOID,
      PVOID,
      PVOID,
      PVOID,
      "uint32"
    ]),
    createPipe: bind(kernel32, "CreatePipe", "int", [PPVOID, PPVOID, PVOID, "uint32"]),
    setHandleInformation: bind(kernel32, "SetHandleInformation", "int", [PVOID, "uint32", "uint32"]),
    createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
      PVOID,
      "str16",
      "str16",
      PVOID,
      PVOID,
      "int",
      "uint32",
      PVOID,
      "str16",
      koffi.pointer(startupInfo),
      koffi.pointer(processInfo)
    ]),
    readFile: bind(kernel32, "ReadFile", "int", [PVOID, PVOID, "uint32", PUINT32, PVOID]),
    peekNamedPipe: bind(kernel32, "PeekNamedPipe", "int", [
      PVOID,
      PVOID,
      "uint32",
      PUINT32,
      PUINT32,
      PUINT32
    ]),
    waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
    getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, PUINT32]),
    terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
    resumeThread: bind(kernel32, "ResumeThread", "uint32", [PVOID]),
    createJobObjectW: bind(kernel32, "CreateJobObjectW", PVOID, [PVOID, "str16"]),
    setInformationJobObject: bind(kernel32, "SetInformationJobObject", "int", [
      PVOID,
      "int",
      PVOID,
      "uint32"
    ]),
    assignProcessToJobObject: bind(kernel32, "AssignProcessToJobObject", "int", [PVOID, PVOID]),
    isProcessInJob: bind(kernel32, "IsProcessInJob", "int", [PVOID, PVOID, PUINT32]),
    queryInformationJobObject: bind(kernel32, "QueryInformationJobObject", "int", [
      PVOID,
      "int",
      PVOID,
      "uint32",
      PUINT32
    ])
  };
  return { koffi, api, startupInfo, processInfo, pvoid: PVOID };
}
function isNullPtr(value) {
  return value === null || value === void 0 || value === 0n;
}
function isInvalidHandle(handle) {
  if (isNullPtr(handle)) return true;
  return handle === 0xffffffffffffffffn || handle === -1n;
}
function allocPtrSlot() {
  const { koffi, pvoid } = requireLoaded();
  return koffi.alloc(pvoid, 1);
}
function allocUint32() {
  const { koffi } = requireLoaded();
  return koffi.alloc("uint32", 1);
}
function allocBytes(length) {
  const { koffi } = requireLoaded();
  return koffi.alloc("uint8", length);
}
function allocOverlapped() {
  return allocBytes(32);
}
function freeNative(ptr) {
  if (ptr === null || ptr === void 0) return;
  requireLoaded().koffi.free(ptr);
}
function encodeUint32(slot, value) {
  requireLoaded().koffi.encode(slot, "uint32", value);
}
function decodePtr(slot) {
  const { koffi, pvoid } = requireLoaded();
  const value = koffi.decode(slot, pvoid);
  return isNullPtr(value) ? null : value;
}
function decodeUint32(slot) {
  return requireLoaded().koffi.decode(slot, "uint32");
}
function decodePtrAt(buffer, offset) {
  const { koffi, pvoid } = requireLoaded();
  const value = koffi.decode(buffer, offset, pvoid);
  return isNullPtr(value) ? null : value;
}
function decodeUint8At(ptr, offset) {
  return requireLoaded().koffi.decode(ptr, offset, "uint8");
}
function decodeUint16At(ptr, offset) {
  return requireLoaded().koffi.decode(ptr, offset, "uint16");
}
function decodeUint32At(ptr, offset) {
  return requireLoaded().koffi.decode(ptr, offset, "uint32");
}
function ptrAddress(ptr) {
  return requireLoaded().koffi.address(ptr);
}
function allocStartupInfo() {
  const { koffi, startupInfo } = requireLoaded();
  return koffi.alloc(startupInfo, 1);
}
function encodeStartupInfo(slot, fields) {
  const { koffi, startupInfo } = requireLoaded();
  koffi.encode(slot, startupInfo, fields);
}
function allocProcessInfo() {
  const { koffi, processInfo } = requireLoaded();
  return koffi.alloc(processInfo, 1);
}
function decodeProcessInfo(slot) {
  const { koffi, processInfo } = requireLoaded();
  return koffi.decode(slot, processInfo);
}
function sameSidAt(left, leftOffset, right, rightOffset) {
  if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset)) return false;
  const leftCount = decodeUint8At(left, leftOffset + 1);
  const rightCount = decodeUint8At(right, rightOffset + 1);
  if (leftCount !== rightCount || leftCount > SID_MAX_SUB_AUTHORITIES) return false;
  for (let index = 0; index < 6; index += 1) {
    if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) {
      return false;
    }
  }
  for (let index = 0; index < leftCount; index += 1) {
    if (decodeUint32At(left, leftOffset + 8 + index * 4) !== decodeUint32At(right, rightOffset + 8 + index * 4)) {
      return false;
    }
  }
  return true;
}
function errorText(api, code) {
  const buffer = Buffer.alloc(1024);
  const length = api.formatMessageW(
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    null,
    code,
    0,
    buffer,
    buffer.length / 2,
    null
  );
  return length === 0 ? "" : buffer.subarray(0, length * 2).toString("utf16le").trim();
}
function throwLastError(api, name, detail) {
  const code = api.getLastError();
  throw new Win32Error(name, code, detail ?? errorText(api, code));
}
function throwWin32(api, name, code, detail) {
  throw new Win32Error(name, code, detail ?? errorText(api, code));
}
function getTempPath(api) {
  const buffer = Buffer.alloc((MAX_PATH + 1) * 2);
  const length = api.getTempPathW(buffer.length / 2, buffer);
  if (length === 0) throwLastError(api, "GetTempPathW");
  if (length > buffer.length / 2) {
    throw new Win32Error(
      "GetTempPathW",
      ERROR_INSUFFICIENT_BUFFER,
      `需要 ${length} 字符，超过 ${buffer.length / 2} 字符的缓冲；什么都没写入`
    );
  }
  return buffer.subarray(0, length * 2).toString("utf16le");
}
function buildExplicitAccess(sid, mode, permissions) {
  const entry = Buffer.alloc(EXPLICIT_ACCESS_W_SIZE);
  entry.writeUInt32LE(permissions, 0);
  entry.writeUInt32LE(mode, 4);
  entry.writeUInt32LE(SUB_CONTAINERS_AND_OBJECTS_INHERIT, 8);
  entry.writeUInt32LE(NO_MULTIPLE_TRUSTEE, 24);
  entry.writeUInt32LE(TRUSTEE_IS_SID, 28);
  entry.writeUInt32LE(TRUSTEE_IS_UNKNOWN, 32);
  entry.writeBigUInt64LE(ptrAddress(sid), 40);
  return entry;
}
function lockFilePath(api, path) {
  const digest = createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 16);
  return join(getTempPath(api), "zerowork-acl-locks", `${digest}.lock`);
}
function withPathLock(api, path, action) {
  const lockPath = lockFilePath(api, path);
  mkdirSync(dirname(lockPath), { recursive: true });
  const handle = api.createFileW(
    lockPath,
    GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_ALWAYS,
    0,
    null
  );
  if (isInvalidHandle(handle)) throwLastError(api, "CreateFileW", lockPath);
  const overlapped = allocOverlapped();
  try {
    if (api.lockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, overlapped) === 0) {
      const code = api.getLastError();
      api.closeHandle(handle);
      throwWin32(api, "LockFileEx", code, lockPath);
    }
    try {
      return action();
    } finally {
      api.unlockFileEx(handle, 0, 1, 0, overlapped);
    }
  } finally {
    api.closeHandle(handle);
    freeNative(overlapped);
  }
}
function readCurrentDacl(api, path) {
  const owner = allocPtrSlot();
  const group = allocPtrSlot();
  const dacl = allocPtrSlot();
  const sacl = allocPtrSlot();
  const descriptor = allocPtrSlot();
  try {
    const result = api.getNamedSecurityInfoW(
      path,
      SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION,
      owner,
      group,
      dacl,
      sacl,
      descriptor
    );
    if (result !== ERROR_SUCCESS) throwWin32(api, "GetNamedSecurityInfoW", result, path);
    return { oldAcl: decodePtr(dacl), descriptor: decodePtr(descriptor) };
  } finally {
    for (const slot of [owner, group, dacl, sacl, descriptor]) freeNative(slot);
  }
}
function mergeAndApply(api, path, entry, current, label) {
  const newAclSlot = allocPtrSlot();
  try {
    const merged = api.setEntriesInAclW(1, entry, current.oldAcl, newAclSlot);
    if (merged !== ERROR_SUCCESS) {
      if (current.descriptor !== null) api.localFree(current.descriptor);
      throwWin32(api, "SetEntriesInAclW", merged, `${label}(${path})`);
    }
    const newAcl = decodePtr(newAclSlot);
    if (newAcl === null) {
      if (current.descriptor !== null) api.localFree(current.descriptor);
      throwWin32(api, "SetEntriesInAclW", api.getLastError(), `${label}(${path})：合并结果为空`);
    }
    if (current.descriptor !== null) api.localFree(current.descriptor);
    const applied = api.setNamedSecurityInfoW(
      path,
      SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION,
      null,
      null,
      newAcl,
      null
    );
    api.localFree(newAcl);
    if (applied !== ERROR_SUCCESS) throwWin32(api, "SetNamedSecurityInfoW", applied, `${label}(${path})`);
  } finally {
    freeNative(newAclSlot);
  }
}
function hasExactGrant(oldAcl, sid) {
  const aclSize = decodeUint16At(oldAcl, 2);
  const aceCount = decodeUint16At(oldAcl, 4);
  if (aclSize < 8 || aclSize > 1048576) return false;
  let offset = 8;
  for (let index = 0; index < aceCount; index += 1) {
    const aceSize = decodeUint16At(oldAcl, offset + 2);
    if (aceSize < 8 || offset + aceSize > aclSize) return false;
    const shapeMatches = decodeUint8At(oldAcl, offset) === ACCESS_ALLOWED_ACE_TYPE && decodeUint8At(oldAcl, offset + 1) === SUB_CONTAINERS_AND_OBJECTS_INHERIT && decodeUint32At(oldAcl, offset + 4) === GRANT_MASK;
    if (shapeMatches && sameSidAt(oldAcl, offset + 8, sid, 0)) return true;
    offset += aceSize;
  }
  return false;
}
function grantWrite(api, path, sid) {
  return withPathLock(api, path, () => {
    const current = readCurrentDacl(api, path);
    if (current.oldAcl !== null && hasExactGrant(current.oldAcl, sid)) {
      if (current.descriptor !== null) {
        const freed = api.localFree(current.descriptor);
        if (!isNullPtr(freed)) throwLastError(api, "LocalFree", `grantWrite(${path}) descriptor`);
      }
      return true;
    }
    mergeAndApply(api, path, buildExplicitAccess(sid, GRANT_ACCESS, GRANT_MASK), current, "grantWrite");
    return false;
  });
}
function quoteArg(argument) {
  if (argument === "") return '""';
  if (!/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  for (let index = 0; index < argument.length; index += 1) {
    let backslashes = 0;
    while (index < argument.length && argument.charAt(index) === "\\") {
      backslashes += 1;
      index += 1;
    }
    if (index === argument.length) {
      quoted += "\\".repeat(backslashes * 2);
    } else if (argument.charAt(index) === '"') {
      quoted += `${"\\".repeat(backslashes * 2 + 1)}"`;
    } else {
      quoted += "\\".repeat(backslashes) + argument.charAt(index);
    }
  }
  return `${quoted}"`;
}
function buildCommandLine(program, args) {
  return [program, ...args].map(quoteArg).join(" ");
}
function buildEnvBlock(overrides, base = process.env) {
  const merged = /* @__PURE__ */ new Map();
  const put = (key, value) => {
    merged.set(key.toLowerCase(), [key, value]);
  };
  for (const [key, value] of Object.entries(base)) {
    if (value !== void 0) put(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) put(key, value);
  const parts = [...merged.values()].map(([key, value]) => `${key}=${value}\0`);
  return Buffer.from(`${parts.join("")}\0`, "utf16le");
}
function createPipe(api) {
  const readSlot = allocPtrSlot();
  const writeSlot = allocPtrSlot();
  try {
    if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, "CreatePipe");
    const read = decodePtr(readSlot);
    const write = decodePtr(writeSlot);
    if (read === null || write === null) {
      if (read !== null) api.closeHandle(read);
      if (write !== null) api.closeHandle(write);
      throwLastError(api, "CreatePipe", "管道句柄为空");
    }
    return { read, write };
  } finally {
    freeNative(writeSlot);
    freeNative(readSlot);
  }
}
function createKillOnCloseJob(api) {
  const job = api.createJobObjectW(null, null);
  if (isNullPtr(job)) throwLastError(api, "CreateJobObjectW");
  const information = Buffer.alloc(JOBOBJECT_EXTENDED_LIMIT_SIZE);
  information.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET);
  if (api.setInformationJobObject(
    job,
    JobObjectExtendedLimitInformation,
    information,
    information.length
  ) === 0) {
    const code = api.getLastError();
    api.closeHandle(job);
    throwWin32(api, "SetInformationJobObject", code, "kill-on-close");
  }
  return job;
}
const DEFAULT_DESKTOP = "Winsta0\\Default";
function spawnConfined(api, request) {
  const job = createKillOnCloseJob(api);
  let stdIn;
  let stdOut;
  let stdErr;
  let startupInfo;
  let processInfo;
  let cleaned = false;
  const abandon = () => {
    if (cleaned) return;
    cleaned = true;
    for (const pair of [stdIn, stdOut, stdErr]) {
      if (pair === void 0) continue;
      api.closeHandle(pair.read);
      api.closeHandle(pair.write);
    }
    api.closeHandle(job);
  };
  try {
    stdIn = createPipe(api);
    stdOut = createPipe(api);
    stdErr = createPipe(api);
    for (const [handle, label] of [
      [stdIn.read, "stdin 读端"],
      [stdOut.write, "stdout 写端"],
      [stdErr.write, "stderr 写端"]
    ]) {
      if (api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, "SetHandleInformation", label);
      }
    }
    startupInfo = allocStartupInfo();
    const desktop = request.desktop === void 0 ? DEFAULT_DESKTOP : request.desktop;
    encodeStartupInfo(startupInfo, {
      cb: STARTUPINFOW_SIZE,
      dwFlags: STARTF_USESTDHANDLES,
      hStdInput: stdIn.read,
      hStdOutput: stdOut.write,
      hStdError: stdErr.write,
      ...desktop === null ? {} : { lpDesktop: desktop }
    });
    processInfo = allocProcessInfo();
    const created = api.createProcessAsUserW(
      request.token,
      null,
      buildCommandLine(request.command, request.args),
      null,
      null,
      1,
      // bInheritHandles
      // CREATE_UNICODE_ENVIRONMENT 与显式环境块配对，缺了就是 ERROR_INVALID_PARAMETER。
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | // 不给子进程新建控制台：daemon 是 GUI 进程、没有宿主控制台可继承，
      // 不加这个标志时用户会看到「闪一下空终端」（理由与实测见 win32-abi.ts）。
      CREATE_NO_WINDOW | // 诊断矩阵用：脱离调用链所在的 Job（Job 未禁止时才生效）。
      (request.breakawayFromJob === true ? CREATE_BREAKAWAY_FROM_JOB : 0),
      // envBase 缺省时继承 process.env（正常路径）；诊断脚本可换基底。
      buildEnvBlock(request.env, request.envBase),
      request.cwd,
      startupInfo,
      processInfo
    );
    if (created === 0) {
      const code = api.getLastError();
      abandon();
      throwWin32(api, "CreateProcessAsUserW", code, `${request.command} @ ${request.cwd}`);
    }
    const info = decodeProcessInfo(processInfo);
    if (info.hProcess === null || info.hThread === null) {
      if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1);
      if (info.hThread !== null) api.closeHandle(info.hThread);
      if (info.hProcess !== null) api.closeHandle(info.hProcess);
      abandon();
      throw new Error(`CreateProcessAsUserW 成功但句柄为空（pid ${info.dwProcessId}）`);
    }
    const assigned = api.assignProcessToJobObject(job, info.hProcess);
    if (assigned === 0) {
      const code = api.getLastError();
      api.terminateProcess(info.hProcess, 1);
      api.closeHandle(info.hThread);
      api.closeHandle(info.hProcess);
      abandon();
      throwWin32(api, "AssignProcessToJobObject", code, `pid ${info.dwProcessId}`);
    }
    if (api.resumeThread(info.hThread) === WAIT_FAILED) {
      const code = api.getLastError();
      api.closeHandle(info.hThread);
      api.closeHandle(info.hProcess);
      abandon();
      throwWin32(api, "ResumeThread", code, `pid ${info.dwProcessId}`);
    }
    api.closeHandle(info.hThread);
    api.closeHandle(stdIn.read);
    api.closeHandle(stdIn.write);
    api.closeHandle(stdOut.write);
    api.closeHandle(stdErr.write);
    return {
      pid: info.dwProcessId,
      process: info.hProcess,
      job,
      stdoutRead: stdOut.read,
      stderrRead: stdErr.read
    };
  } catch (error) {
    if (processInfo === void 0) abandon();
    throw error;
  } finally {
    freeNative(processInfo);
    freeNative(startupInfo);
  }
}
const POLL_START_MS = 1;
const POLL_MAX_MS = 15;
const sleep$1 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function drainPipeInto(api, handle, sink) {
  let chunks = 0;
  const countSlot = allocUint32();
  let delay = POLL_START_MS;
  try {
    for (; ; ) {
      if (api.peekNamedPipe(handle, null, 0, null, countSlot, null) === 0) {
        const code = api.getLastError();
        if (code === ERROR_BROKEN_PIPE || code === ERROR_NO_DATA) break;
        throwWin32(api, "PeekNamedPipe", code, `已读 ${chunks} 块后失败`);
      }
      const available = decodeUint32(countSlot);
      if (available > 0) {
        const chunk = Buffer.alloc(available);
        if (api.readFile(handle, chunk, chunk.length, countSlot, null) === 0) {
          throwLastError(api, "ReadFile", `已读 ${chunks} 块后失败`);
        }
        const read = chunk.subarray(0, decodeUint32(countSlot));
        chunks += 1;
        sink?.(read);
        delay = POLL_START_MS;
      } else {
        delay = Math.min(delay * 2, POLL_MAX_MS);
      }
      await sleep$1(delay);
    }
  } finally {
    freeNative(countSlot);
    api.closeHandle(handle);
  }
}
async function drainPipe(api, handle) {
  const chunks = [];
  await drainPipeInto(api, handle, (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}
function hasExited(api, handle) {
  const result = api.waitForSingleObject(handle, 0);
  if (result === WAIT_OBJECT_0) return true;
  if (result === WAIT_TIMEOUT) return false;
  throwLastError(api, "WaitForSingleObject");
}
function readExitCode(api, handle) {
  const slot = allocUint32();
  try {
    if (api.getExitCodeProcess(handle, slot) === 0) throwLastError(api, "GetExitCodeProcess");
    return decodeUint32(slot);
  } finally {
    freeNative(slot);
  }
}
async function waitForChild(api, child, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let delay = POLL_START_MS;
  let jobClosed = false;
  const closeJobOnce = () => {
    if (jobClosed) return;
    jobClosed = true;
    api.closeHandle(child.job);
  };
  try {
    for (; ; ) {
      if (hasExited(api, child.process)) {
        return { exitCode: readExitCode(api, child.process), timedOut: false, aborted: false };
      }
      if (signal?.aborted === true) {
        closeJobOnce();
        return { exitCode: void 0, timedOut: false, aborted: true };
      }
      if (Date.now() >= deadline) {
        closeJobOnce();
        return { exitCode: void 0, timedOut: true, aborted: false };
      }
      delay = Math.min(delay * 2, POLL_MAX_MS);
      await sleep$1(delay);
    }
  } finally {
    api.closeHandle(child.process);
    closeJobOnce();
  }
}
function openCurrentProcessToken(api) {
  const processHandle = api.openProcess(PROCESS_QUERY_INFORMATION, 0, process.pid);
  if (isNullPtr(processHandle)) throwLastError(api, "OpenProcess", `pid ${process.pid}`);
  const tokenSlot = allocPtrSlot();
  try {
    const opened = api.openProcessToken(
      processHandle,
      TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY,
      tokenSlot
    );
    if (opened === 0) {
      const code = api.getLastError();
      api.closeHandle(processHandle);
      throwWin32(api, "OpenProcessToken", code, `pid ${process.pid}`);
    }
    api.closeHandle(processHandle);
    const token = decodePtr(tokenSlot);
    if (token === null) throwWin32(api, "OpenProcessToken", api.getLastError(), "令牌句柄为空");
    return token;
  } finally {
    freeNative(tokenSlot);
  }
}
function findLogonSid(api, token) {
  const neededSlot = allocUint32();
  try {
    api.getTokenInformation(token, TokenGroups, null, 0, neededSlot);
    const needed = decodeUint32(neededSlot);
    if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenGroups 尺寸查询");
    if (needed < TOKEN_GROUPS_OFFSET) {
      throwWin32(api, "GetTokenInformation", api.getLastError(), `TokenGroups 尺寸不合理：${needed}`);
    }
    const groups = Buffer.alloc(needed);
    if (api.getTokenInformation(token, TokenGroups, groups, groups.length, neededSlot) === 0) {
      throwLastError(api, "GetTokenInformation", "TokenGroups");
    }
    const groupCount = groups.readUInt32LE(0);
    for (let index = 0; index < groupCount; index += 1) {
      const at = TOKEN_GROUPS_OFFSET + index * SID_AND_ATTRIBUTES_SIZE;
      const sidPtr = decodePtrAt(groups, at);
      const attributes = groups.readUInt32LE(at + 8);
      const isLogonId = (attributes & SE_GROUP_LOGON_ID) >>> 0 === SE_GROUP_LOGON_ID >>> 0;
      if (sidPtr === null || !isLogonId) continue;
      const length = api.getLengthSid(sidPtr);
      if (length === 0) throwLastError(api, "GetLengthSid", `登录 SID（组 ${index}）`);
      const copy = allocBytes(length);
      if (api.copySid(length, copy, sidPtr) === 0) throwLastError(api, "CopySid", `登录 SID（组 ${index}）`);
      return copy;
    }
    throw new Error(`受限令牌前置条件不满足：令牌的 ${groupCount} 个组里找不到登录 SID`);
  } finally {
    freeNative(neededSlot);
  }
}
function makeWellKnownSid(api, type) {
  const sid = allocBytes(SECURITY_MAX_SID_SIZE);
  const sizeSlot = allocUint32();
  try {
    encodeUint32(sizeSlot, SECURITY_MAX_SID_SIZE);
    if (api.createWellKnownSid(type, null, sid, sizeSlot) === 0) {
      throwLastError(api, "CreateWellKnownSid", `type ${type}`);
    }
    if (api.isValidSid(sid) === 0) throwLastError(api, "IsValidSid", `CreateWellKnownSid type ${type}`);
    return sid;
  } finally {
    freeNative(sizeSlot);
  }
}
function sidFromString(api, text) {
  const slot = allocPtrSlot();
  try {
    if (api.convertStringSidToSidW(text, slot) === 0) {
      throwLastError(api, "ConvertStringSidToSidW", text);
    }
    const localAllocated = decodePtr(slot);
    if (localAllocated === null) {
      throwWin32(api, "ConvertStringSidToSidW", api.getLastError(), `${text} 解析结果为空`);
    }
    try {
      const length = api.getLengthSid(localAllocated);
      if (length === 0) throwLastError(api, "GetLengthSid", text);
      const copy = allocBytes(length);
      if (api.copySid(length, copy, localAllocated) === 0) throwLastError(api, "CopySid", text);
      return copy;
    } finally {
      api.localFree(localAllocated);
    }
  } finally {
    freeNative(slot);
  }
}
function setTokenDefaultDaclGrant(api, token, sid) {
  const neededSlot = allocUint32();
  const newDaclSlot = allocPtrSlot();
  try {
    api.getTokenInformation(token, TokenDefaultDacl, null, 0, neededSlot);
    const needed = decodeUint32(neededSlot);
    if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenDefaultDacl 尺寸查询");
    const buffer = Buffer.alloc(needed);
    if (api.getTokenInformation(token, TokenDefaultDacl, buffer, buffer.length, neededSlot) === 0) {
      throwLastError(api, "GetTokenInformation", "TokenDefaultDacl");
    }
    const currentDacl = decodePtrAt(buffer, 0);
    if (currentDacl === null) throw new Error("setTokenDefaultDaclGrant：令牌没有默认 DACL 可扩展");
    const merged = api.setEntriesInAclW(
      1,
      buildExplicitAccess(sid, GRANT_ACCESS, FILE_ALL_ACCESS),
      currentDacl,
      newDaclSlot
    );
    if (merged !== ERROR_SUCCESS) throwWin32(api, "SetEntriesInAclW", merged, "默认 DACL 合并");
    const newDacl = decodePtr(newDaclSlot);
    if (newDacl === null) throwWin32(api, "SetEntriesInAclW", merged, "默认 DACL 合并结果为空");
    try {
      const info = Buffer.alloc(8);
      info.writeBigUInt64LE(newDacl, 0);
      if (api.setTokenInformation(token, TokenDefaultDacl, info, info.length) === 0) {
        throwLastError(api, "SetTokenInformation", "TokenDefaultDacl");
      }
    } finally {
      api.localFree(newDacl);
    }
  } finally {
    freeNative(newDaclSlot);
    freeNative(neededSlot);
  }
}
function buildRestrictingSids(sids) {
  const buffer = Buffer.alloc(SID_AND_ATTRIBUTES_SIZE * sids.length);
  sids.forEach((sid, index) => {
    buffer.writeBigUInt64LE(ptrAddress(sid), SID_AND_ATTRIBUTES_SIZE * index);
  });
  return buffer;
}
function createRestrictedToken(api, currentToken, logonSid, worldSid, writeSids, mode) {
  if (mode === "workspace-write" && writeSids.length === 0) {
    throw new Error("createRestrictedToken：workspace-write 至少需要一个写 SID");
  }
  const sids = mode === "read-only" ? [logonSid, worldSid] : [logonSid, worldSid, ...writeSids];
  const restrictingSids = buildRestrictingSids(sids);
  const tokenSlot = allocPtrSlot();
  try {
    const created = api.createRestrictedToken(
      currentToken,
      DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
      0,
      null,
      // 不禁用任何 SID
      0,
      null,
      // 不删除任何特权
      sids.length,
      restrictingSids,
      tokenSlot
    );
    if (created === 0) throwLastError(api, "CreateRestrictedToken", `${sids.length} 个受限 SID`);
    const token = decodePtr(tokenSlot);
    if (token === null) throwWin32(api, "CreateRestrictedToken", api.getLastError(), "令牌句柄为空");
    return token;
  } finally {
    freeNative(tokenSlot);
  }
}
function pathDigest(path, salt) {
  const digest = createHash("sha256").update(`${salt}:${path.toLowerCase()}`).digest();
  return digest.readUInt32BE(0) >>> 0;
}
function workspaceWriteSid(workspaceDir) {
  const high = pathDigest(workspaceDir, "workspace");
  const low = pathDigest(workspaceDir, "workspace-low") % 65536;
  return `S-1-4-${high}-${low}`;
}
function tempWriteSid(tempDir) {
  const high = pathDigest(tempDir, "temp");
  const low = pathDigest(tempDir, "temp-low") % 65536;
  return `S-1-4-${high}-${low}`;
}
let cachedSelfCheck;
const cachedFileSystemByWorkspace = /* @__PURE__ */ new Map();
async function probeSandbox(workspaceDir) {
  if (process.platform !== "win32") {
    return { available: false, reason: "not-windows", detail: `当前平台是 ${process.platform}` };
  }
  let api;
  try {
    api = await loadWin32();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: "ffi-load-failed",
      detail: error instanceof FfiUnavailableError ? detail : `未预期的加载失败：${detail}`
    };
  }
  const fileSystem = probeFileSystem(api, workspaceDir);
  if (!fileSystem.available) return fileSystem;
  if (cachedSelfCheck === void 0) {
    cachedSelfCheck = await selfCheck(api);
  }
  return cachedSelfCheck;
}
function probeFileSystem(api, workspaceDir) {
  const key = workspaceDir.toLowerCase();
  const cached = cachedFileSystemByWorkspace.get(key);
  if (cached !== void 0) return cached;
  const verdict = readFileSystemVerdict(api, workspaceDir);
  cachedFileSystemByWorkspace.set(key, verdict);
  return verdict;
}
function readFileSystemVerdict(api, workspaceDir) {
  const fileSystem = readFileSystemName(api, workspaceDir);
  if (fileSystem !== void 0 && !isAclCapableFileSystem(fileSystem)) {
    return {
      available: false,
      reason: "unsupported-filesystem",
      detail: `工作区所在卷的文件系统是 ${fileSystem}，不支持 ACL`
    };
  }
  return { available: true };
}
const SELF_CHECK_EXIT_CODE = 7;
async function selfCheck(api) {
  let scratch;
  try {
    const dir = mkdtempSync(join(getTempPath(api), "zerowork-selfcheck-"));
    scratch = dir;
    await prepareSandbox({ workspaceDir: dir, writableDirs: [dir] });
    const outcome = await runSandboxed({
      command: "cmd.exe",
      args: ["/c", `exit ${SELF_CHECK_EXIT_CODE}`],
      cwd: dir,
      workspaceDir: dir,
      writableDirs: [dir],
      timeoutMs: SELF_CHECK_TIMEOUT_MS,
      mode: "workspace-write"
    });
    if (outcome.exitCode === SELF_CHECK_EXIT_CODE) return { available: true };
    return {
      available: false,
      reason: "process-start-failed",
      detail: describeSelfCheckFailure(outcome)
    };
  } catch (error) {
    return { available: false, reason: classifyFailure(error), detail: errorDetail(error) };
  } finally {
    if (scratch !== void 0) {
      try {
        rmSync(await sandboxPrivateTempDir(scratch), { recursive: true, force: true });
      } catch {
      }
      try {
        rmSync(scratch, { recursive: true, force: true });
      } catch {
      }
    }
  }
}
const SELF_CHECK_TIMEOUT_MS = 3e4;
function describeSelfCheckFailure(outcome) {
  if (outcome.timedOut) return `自检命令 ${SELF_CHECK_TIMEOUT_MS} 毫秒未结束`;
  const code = outcome.exitCode;
  if (code === null) return "自检进程被终止，没有退出码";
  const unsigned = code >>> 0;
  const hex = `0x${unsigned.toString(16).toUpperCase().padStart(8, "0")}`;
  const known = unsigned === 3221225794 ? "（STATUS_DLL_INIT_FAILED：进程在 DLL 初始化阶段就失败了）" : "";
  const tail = [outcome.stdout.trim(), outcome.stderr.trim()].filter((s) => s !== "").join(" / ");
  return `受限令牌下的自检命令没有正常退出：期望 ${SELF_CHECK_EXIT_CODE}，实际 ${code}（${hex}）${known}${tail === "" ? "" : `，输出：${tail.slice(0, 200)}`}`;
}
function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}
const ACL_CAPABLE_FILE_SYSTEMS = /* @__PURE__ */ new Set(["NTFS", "REFS"]);
function isAclCapableFileSystem(name) {
  return ACL_CAPABLE_FILE_SYSTEMS.has(name.toUpperCase());
}
function readFileSystemName(api, path) {
  const rootBuffer = Buffer.alloc((MAX_PATH + 1) * 2);
  if (api.getVolumePathNameW(path, rootBuffer, MAX_PATH + 1) === 0) return void 0;
  const root = decodeWideString(rootBuffer);
  if (root === "") return void 0;
  const nameBuffer = Buffer.alloc((MAX_PATH + 1) * 2);
  if (api.getVolumeInformationW(root, null, 0, null, null, null, nameBuffer, MAX_PATH + 1) === 0) {
    return void 0;
  }
  const name = decodeWideString(nameBuffer);
  return name === "" ? void 0 : name;
}
function decodeWideString(buffer) {
  const text = buffer.toString("utf16le");
  const nul = text.indexOf("\0");
  return (nul === -1 ? text : text.slice(0, nul)).trim();
}
async function prepareSandbox(request) {
  const api = await loadWin32();
  const started = Date.now();
  const tempDir = privateTempDir(api, request.workspaceDir);
  mkdirSync(tempDir, { recursive: true });
  let allFast = true;
  const sids = [];
  try {
    for (const dir of request.writableDirs) {
      const sid = sidFromString(api, workspaceWriteSid(dir));
      sids.push(sid);
      if (!grantWrite(api, dir, sid)) allFast = false;
    }
    const tempSid = sidFromString(api, tempWriteSid(tempDir));
    sids.push(tempSid);
    if (!grantWrite(api, tempDir, tempSid)) allFast = false;
  } finally {
    for (const sid of sids) freeNative(sid);
  }
  return { fastPath: allFast, elapsedMs: Date.now() - started };
}
function privateTempDir(api, workspaceDir) {
  const digest = createHash("sha256").update(workspaceDir.toLowerCase()).digest("hex").slice(0, 16);
  return join(getTempPath(api), "zerowork-sandbox", digest);
}
async function sandboxPrivateTempDir(workspaceDir) {
  const api = await loadWin32();
  return privateTempDir(api, workspaceDir);
}
function packageManagerScratchEnv(scratchDir) {
  return { npm_config_cache: join(scratchDir, "npm-cache") };
}
function openConfinedChild(api, request) {
  const tempDir = privateTempDir(api, request.workspaceDir);
  mkdirSync(tempDir, { recursive: true });
  const owned = [];
  let processToken;
  let restricted;
  try {
    processToken = openCurrentProcessToken(api);
    const logonSid = findLogonSid(api, processToken);
    owned.push(logonSid);
    const worldSid = makeWellKnownSid(api, WinWorldSid);
    owned.push(worldSid);
    const writeSids = [];
    if (request.mode === "workspace-write") {
      for (const dir of request.writableDirs) {
        const sid = sidFromString(api, workspaceWriteSid(dir));
        owned.push(sid);
        writeSids.push(sid);
      }
      const tempSid = sidFromString(api, tempWriteSid(tempDir));
      owned.push(tempSid);
      writeSids.push(tempSid);
    }
    restricted = createRestrictedToken(api, processToken, logonSid, worldSid, writeSids, request.mode);
    setTokenDefaultDaclGrant(api, restricted, logonSid);
    return spawnConfined(api, {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      token: restricted,
      /*
       * 只覆盖 TMP/TEMP、包管理器缓存与调用方给的注入补丁，其余继承 —— 不改本进程
       * 环境（那会污染整个 daemon）。私有 temp 与其派生的缓存落点放在最后：
       * 补丁若也带这些键，必须被沙箱自己的、已被授权的那个目录压过。
       */
      env: {
        ...request.env,
        TMP: tempDir,
        TEMP: tempDir,
        ...packageManagerScratchEnv(tempDir)
      }
    });
  } finally {
    for (const sid of owned) freeNative(sid);
    for (const handle of [restricted, processToken]) {
      if (handle !== void 0) api.closeHandle(handle);
    }
  }
}
async function runSandboxed(request) {
  const api = await loadWin32();
  const child = openConfinedChild(api, request);
  const [stdoutBuffer, stderrBuffer, waited] = await Promise.all([
    drainPipe(api, child.stdoutRead),
    drainPipe(api, child.stderrRead),
    waitForChild(api, child, request.timeoutMs, request.signal)
  ]);
  return {
    stdout: stdoutBuffer.toString("utf8"),
    stderr: stderrBuffer.toString("utf8"),
    // undefined → null：对齐 powershell 工具的 CommandOutcome 形状。
    exitCode: waited.exitCode ?? null,
    timedOut: waited.timedOut,
    aborted: waited.aborted
  };
}
const BACKGROUND_POLL_START_MS = 5;
const BACKGROUND_POLL_MAX_MS = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function startSandboxed(request) {
  const api = await loadWin32();
  const child = openConfinedChild(api, request);
  let stdout = "";
  let stderr = "";
  let running = true;
  let killed = false;
  let exitCode = null;
  let jobClosed = false;
  const closeJobOnce = () => {
    if (jobClosed) return;
    jobClosed = true;
    api.closeHandle(child.job);
  };
  const done = (async () => {
    const drained = Promise.all([
      drainPipeInto(api, child.stdoutRead, (chunk) => {
        stdout += chunk.toString("utf8");
      }),
      drainPipeInto(api, child.stderrRead, (chunk) => {
        stderr += chunk.toString("utf8");
      })
    ]);
    let delay = BACKGROUND_POLL_START_MS;
    try {
      while (!hasExited(api, child.process)) {
        delay = Math.min(delay * 2, BACKGROUND_POLL_MAX_MS);
        await sleep(delay);
      }
      exitCode = killed ? null : readExitCode(api, child.process);
    } finally {
      running = false;
      closeJobOnce();
      api.closeHandle(child.process);
    }
    await drained;
    return { stdout, stderr, exitCode, killed };
  })();
  return {
    pid: child.pid,
    snapshot: () => ({
      stdout,
      stderr,
      running,
      exitCode: running ? null : exitCode
    }),
    kill: () => {
      if (!running) return;
      if (!hasExited(api, child.process)) killed = true;
      closeJobOnce();
    },
    done
  };
}
class SandboxPrepareFailure extends Error {
  reason;
  constructor(reason, detail) {
    super(detail);
    this.name = "SandboxPrepareFailure";
    this.reason = reason;
  }
}
function classifyFailure(error) {
  if (error instanceof SandboxPrepareFailure) return error.reason;
  if (error instanceof FfiUnavailableError) return "ffi-load-failed";
  if (error instanceof Error) {
    if (/CreateRestrictedToken|OpenProcessToken|SetTokenInformation/.test(error.message)) {
      return "token-creation-failed";
    }
    if (/SetNamedSecurityInfoW|SetEntriesInAclW|GetNamedSecurityInfoW/.test(error.message)) {
      return "acl-grant-failed";
    }
  }
  return "token-creation-failed";
}
export {
  SandboxPrepareFailure,
  prepareSandbox,
  classifyFailure,
  probeSandbox,
  runSandboxed,
  startSandboxed,
};
