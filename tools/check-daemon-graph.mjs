#!/usr/bin/env node
/**
 * 校验 `src/main/daemon/*.js` 的模块图是否闭合。
 *
 * 守两条性质：
 *   ① 每个相对 import 都指向真实存在的文件；
 *   ② 每个具名 import 都能在目标模块的导出里找到。
 *
 * 为什么需要它：daemon 由 40 个 ES 模块组成，彼此用相对 import 相连。
 * 这层错误**构建期抓不到** —— 漏一个 export、写错一个路径，只会在运行时
 * 某个冷门分支抛 `ReferenceError`。单元测试只跑 `tests/unit`，不碰模块边界。
 *
 * 用法：
 *   node tools/check-daemon-graph.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "espree";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAEMON_DIR = join(ROOT, "src", "main", "daemon");

/** 解析一个模块，取出它的导入与导出「结构」（不含注释、格式、位置）。 */
function readStructure(file) {
	const src = readFileSync(file, "utf8");
	const ast = parse(src, { ecmaVersion: "latest", sourceType: "module" });

	const imports = new Map(); // 来源 -> 具名导入（排序后的数组）
	const exports = new Set();

	for (const node of ast.body) {
		if (node.type === "ImportDeclaration") {
			const names = imports.get(node.source.value) ?? [];
			for (const spec of node.specifiers) {
				// 只关心具名导入：默认/命名空间导入在这个工程里没有用
				if (spec.type === "ImportSpecifier") names.push(spec.local.name);
			}
			imports.set(node.source.value, names.sort());
			continue;
		}
		if (node.type === "ExportNamedDeclaration") {
			for (const spec of node.specifiers) exports.add(spec.exported.name);
			const decl = node.declaration;
			if (decl !== null && decl !== undefined) {
				if (decl.type === "VariableDeclaration") {
					for (const d of decl.declarations) {
						if (d.id.type === "Identifier") exports.add(d.id.name);
					}
				} else if (decl.id !== undefined && decl.id !== null) {
					exports.add(decl.id.name);
				}
			}
			continue;
		}
		if (node.type === "ExportAllDeclaration") exports.add(`* from ${node.source.value}`);
	}

	return { imports, exports };
}

const files = readdirSync(DAEMON_DIR).filter((f) => f.endsWith(".js"));
// 结构缓存按**绝对路径**建：跨目录的相对导入（../sandbox/、../../shared/）
// 也要能查到 —— 只按 daemon 目录内建索引会把它们误报成「模块不存在」。
const cache = new Map();
const structOf = (abs) => {
	if (!cache.has(abs)) cache.set(abs, existsSync(abs) ? readStructure(abs) : undefined);
	return cache.get(abs);
};

const problems = [];
let externalEdges = 0;

for (const file of files) {
	const abs = join(DAEMON_DIR, file);
	const st = structOf(abs);
	for (const [source, names] of st.imports) {
		if (!source.startsWith(".")) continue; // 外部依赖（pi SDK、node: 等）不在校验范围
		const target = resolve(dirname(abs), source);
		const tst = structOf(target);
		if (tst === undefined) {
			problems.push(`${file} 导入了不存在的模块 ${source}`);
			continue;
		}
		if (!target.startsWith(DAEMON_DIR)) externalEdges += 1;
		const wildcard = [...tst.exports].some((e) => e.startsWith("* from "));
		for (const name of names) {
			if (!tst.exports.has(name) && !wildcard) {
				problems.push(`${file} 从 ${source} 导入了 ${name}，但对方没有导出它`);
			}
		}
	}
}

console.log(`daemon 模块：${files.length} 个（其中 ${externalEdges} 条 import 指向 daemon 目录之外）`);

if (problems.length > 0) {
	for (const p of problems) console.error(`  ✗ ${p}`);
	console.error(`\n模块图不闭合：${problems.length} 处问题`);
	process.exit(1);
}
console.log("  ✓ 模块图闭合：相对 import 全部指到真文件，具名导入全部能对上导出");
