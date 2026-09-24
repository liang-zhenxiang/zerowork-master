/**
 * 权限判定规则的单元测试。
 *
 * 这是**安全关键**的一段代码：它决定模型的哪条命令要拦、哪个路径不许碰。
 * 写成纯函数正好，用单测把每条判据钉住 —— 端到端测试只能验「权限请求发出去了」，
 * 验不了「该拦的到底拦没拦」。
 *
 * 覆盖：凭据目录清单、路径包含判定（含目录穿越）、命令意图分类（读/写/删）、
 * 不透明命令识别（编码命令、解释器内联执行）、config-as-code 路径判定。
 */
import { describe, it, expect } from "vitest";
import {
	canonicalizePath,
	classifyCommandOperation,
	defaultProtectedDirs,
	extractPathCandidates,
	isConfigAsCodePath,
	isOpaqueCommand,
	isPathContained,
	isScriptExecution,
} from "../../src/main/daemon/permission-rules.js";

// ── 凭据目录 ──────────────────────────────────────────────

describe("defaultProtectedDirs", () => {
	const home = "/home/tester";
	const dirs = defaultProtectedDirs(home);

	it("覆盖常见的凭据落点", () => {
		for (const name of [".ssh", ".gnupg", ".aws", ".kube", ".docker"]) {
			expect(dirs, `缺少 ${name}`).toContain(`${home}/${name}`);
		}
	});

	it("包含单文件凭据（isInside 对文件同样成立）", () => {
		expect(dirs).toContain(`${home}/.npmrc`);
		expect(dirs).toContain(`${home}/.git-credentials`);
	});

	it("全部是绝对路径", () => {
		for (const d of dirs) expect(d.startsWith("/"), `${d} 不是绝对路径`).toBe(true);
	});
});

// ── 路径包含 ──────────────────────────────────────────────

describe("isPathContained", () => {
	const base = "/home/tester/workspace";

	it("自身与子路径算包含", () => {
		expect(isPathContained(base, base)).toBe(true);
		expect(isPathContained(base, `${base}/src/app.js`)).toBe(true);
		expect(isPathContained(base, `${base}/a/b/c.txt`)).toBe(true);
	});

	it("外部路径不算包含", () => {
		expect(isPathContained(base, "/home/tester/other")).toBe(false);
		expect(isPathContained(base, "/etc/passwd")).toBe(false);
	});

	it("目录穿越逃不出去（`..` 归一化后再判）", () => {
		expect(isPathContained(base, `${base}/../secrets`)).toBe(false);
		expect(isPathContained(base, `${base}/a/../../secrets`)).toBe(false);
	});

	it("同前缀但不同目录不算包含（不是字符串前缀匹配）", () => {
		// `/home/tester/workspace-other` 以 `/home/tester/workspace` 开头，
		// 但它是**另一个目录** —— 朴素的前缀匹配会在这里放行。
		expect(isPathContained(base, "/home/tester/workspace-other/x")).toBe(false);
	});
});

describe("canonicalizePath", () => {
	it("相对路径补成绝对路径", () => {
		expect(canonicalizePath("a/b")).toBe(`${process.cwd()}/a/b`);
	});

	it("归一化 `.` 与 `..`", () => {
		expect(canonicalizePath("/a/b/../c")).toBe("/a/c");
		expect(canonicalizePath("/a/./b")).toBe("/a/b");
	});
});

// ── 命令意图分类 ──────────────────────────────────────────

describe("classifyCommandOperation", () => {
	it.each([
		["Remove-Item foo.txt", "delete"],
		["rm -rf build", "delete"],
		["del x.txt", "delete"],
		["git reset --hard", "delete"],
		["Set-Content a.txt hi", "write"],
		["echo hi > out.txt", "write"],
		["Get-ChildItem", "read"],
		["ls", "read"], // `ls` 在 READ_VERBS 里 —— 它确实在读文件系统，起初我按「只读列表」猜成 access
		["cd /tmp", "access"], // 既没读也没写，最轻的一档
		["git status", "access"],
	])("%j -> %j", (cmd, expected) => {
		expect(classifyCommandOperation(cmd)).toBe(expected);
	});

	it("空命令按最轻的档（access）处理，不误报为危险操作", () => {
		expect(classifyCommandOperation("   ")).toBe("access");
	});
});

// ── 不透明命令 ────────────────────────────────────────────

describe("isOpaqueCommand", () => {
	it.each([
		["powershell -EncodedCommand aQBlAHgA"],
		["python -c \"import os\""],
		["node -e \"require('fs')\""],
		["cmd /c dir"],
	])("识别为不透明：%j", (cmd) => {
		expect(isOpaqueCommand(cmd)).toBe(true);
	});

	it("普通命令不误判", () => {
		expect(isOpaqueCommand("Get-ChildItem -Path .")).toBe(false);
		expect(isOpaqueCommand("echo hello")).toBe(false);
	});
});

describe("isScriptExecution", () => {
	it("直接执行脚本文件算脚本执行", () => {
		expect(isScriptExecution("./deploy.ps1")).toBe(true);
		expect(isScriptExecution("setup.sh")).toBe(true);
	});

	it("用解释器执行脚本文件算脚本执行", () => {
		expect(isScriptExecution("python scripts/run.py")).toBe(true);
		expect(isScriptExecution("node build.mjs")).toBe(true);
	});

	it("解释器不带脚本文件时不算", () => {
		expect(isScriptExecution("node --version")).toBe(false);
	});
});

// ── config-as-code ────────────────────────────────────────

describe("isConfigAsCodePath", () => {
	it.each([
		"/home/tester/proj/package.json", // scripts 能跑任意命令
		"/home/tester/.npmrc", // 供应链入口
		"/home/tester/proj/.envrc", // 进目录即执行
		"/home/tester/proj/.pi/settings.json",
	])("受管路径：%s", (p) => {
		expect(isConfigAsCodePath(p)).toBe(true);
	});

	it("技能目录是**例外** —— 能力即数据、加载时不执行", () => {
		// 这条是刻意留的判据（见 permission-rules.js 文件头）：
		// `.pi/skills/**` 是纯文本，不该按 config-as-code 拦。
		expect(isConfigAsCodePath("/home/tester/proj/.pi/skills/foo/SKILL.md")).toBe(false);
	});

	it("普通源码路径不受管", () => {
		expect(isConfigAsCodePath("/home/tester/proj/src/app.js")).toBe(false);
		expect(isConfigAsCodePath("/home/tester/proj/README.md")).toBe(false);
	});
});

// ── 路径候选抽取 ──────────────────────────────────────────

describe("extractPathCandidates", () => {
	it("从命令里挑出像路径的 token", () => {
		const out = extractPathCandidates("copy src/a.txt dst/b.txt");
		expect(out).toContain("src/a.txt");
		expect(out).toContain("dst/b.txt");
	});

	it("纯命令名不被当成路径", () => {
		expect(extractPathCandidates("Get-ChildItem")).toEqual([]);
	});

	it("多条命令用分隔符拆开分别取", () => {
		const out = extractPathCandidates("cp a.txt b/; rm c.txt");
		expect(out).toContain("a.txt");
		expect(out).toContain("c.txt");
	});
});