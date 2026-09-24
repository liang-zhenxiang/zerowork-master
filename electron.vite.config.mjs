/**
 * electron-vite 构建配置。
 *
 * 产物结构：
 *   out/main/index.mjs        主进程
 *   out/preload/index.mjs     预加载脚本
 *   out/renderer/             渲染层（React SPA）
 *
 * minify 显式关闭：保留原始标识符与注释，便于线上问题定位与堆栈对照。
 */
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const NO_MINIFY = false;

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			minify: NO_MINIFY,
			rollupOptions: {
				input: {
					index: resolve("src/main/index.js"),
					daemon: resolve("src/main/daemon/index.js"),
					"sandbox-prepare-worker": resolve("src/main/sandbox/prepare-worker.js"),
				},
				output: {
					entryFileNames: "[name].mjs",
					chunkFileNames: "chunks/[name]-[hash].mjs",
				},
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			minify: NO_MINIFY,
			rollupOptions: {
				input: { index: resolve("src/preload/index.js") },
				output: {
					entryFileNames: "[name].mjs",
					format: "es",
				},
			},
		},
	},
	renderer: {
		root: resolve("src/renderer"),
		plugins: [react()],
		build: {
			minify: NO_MINIFY,
			rollupOptions: {
				// 入口 chunk 显式命名 `app`，让产物是 app.js / app.css。
				// 不能沿用默认（html 文件名 `index`）：渲染层源码里有一批**运行时**字符串
				// 引用入口样式表（`./app.css`，见下面的说明），名字对不上就会 404。
				input: { app: resolve("src/renderer/index.html") },
				output: {
					// 产物文件名**必须语义化、不带内容哈希** —— 这不是风格偏好，是硬约束。
					//
					// 源码里每个懒加载块的依赖表以**字面量字符串**形式内联（`viteMapDeps([...])`，
					// 形如 ["./office-xlsx.js", "./vendor-lodash.js", "./office-xlsx.css"]）。
					// 这些字符串在运行时被拼成 URL 去预加载，**Vite 不会再改写它们**：
					// 构建只认 import 说明符，不认这种字符串。
					//
					// 所以写进依赖表的文件名必须与构建产出的文件名一致。默认的哈希命名会让
					// 这批字符串全部指向不存在的文件 —— 其中 CSS 那几条是**致命**的
					// （预加载助手对 CSS 失败会 reject 懒加载 promise，渲染层直接进错误边界，
					// 表现为「点开 xlsx / 代码预览即界面渲染出错」）。JS 那几条只是白预载。
					entryFileNames: "assets/[name].js",
					chunkFileNames: "assets/[name].js",
					assetFileNames: "assets/[name][extname]",
				},
			},
		},
	},
});
