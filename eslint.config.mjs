import js from "@eslint/js";

/**
 * ESLint 配置。
 *
 * 注意 src/renderer/src/** 与 src/main/daemon/** 是**大块生成式模块**，
 * 不能按普通源码的规则去要求它们（变量名带 `$1` 后缀是 Rollup 命名消解的
 * 结果，不是代码风格问题）。这些文件用宽松规则，只拦真正的错误。
 */
export default [
	{
		ignores: [
			// 构建产物
			"out/**",
			"dist/**",
			"node_modules/**",
			"artifacts/**",
			"coverage/**",

			// resources/ 是随包分发的内容资源，不是本工程源码。
			// 其中的专家技能脚本、插件市场代码来自第三方（如 stock、
			// teams_marketplace），有自己的风格与运行环境，
			// 用本工程的规则去 lint 只会产生数千条无意义报错。
			"resources/**",

			// 体量大、由构建工具产出，不按手写源码的风格要求。
			// 保障它们的是端到端 GUI 测试与模块图检查（npm run check:daemon-graph）。
			"src/renderer/src/**",
			"src/main/daemon/**",
		],
	},
	js.configs.recommended,
	{
		// 工具链、测试、脚本、构建配置
		files: ["tools/**/*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs", "*.mjs"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				process: "readonly",
				console: "readonly",
				URL: "readonly",
				Buffer: "readonly",
			},
		},
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"no-console": "off",
		},
	},
	{
		// 端到端测试：evaluate() 回调体在浏览器上下文里执行，
		// 可以用 document / window 等浏览器全局。
		files: ["tests/e2e/**/*.mjs"],
		languageOptions: {
			globals: {
				document: "readonly",
				window: "readonly",
				getComputedStyle: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				fetch: "readonly",
			},
		},
	},
	{
		// 人工整理过的主进程 / preload / 共享模块
		files: ["src/main/index.js", "src/preload/index.js", "src/shared/*.js", "src/main/sandbox/*.js"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				process: "readonly",
				console: "readonly",
				Buffer: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				URL: "readonly",
				fetch: "readonly",
				// electron-vite 在构建时向主进程注入 CommonJS shim，
				// 提供 __dirname / __filename / require，源码里可直接使用。
				__dirname: "readonly",
				__filename: "readonly",
				require: "readonly",
			},
		},
		rules: {
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			// `catch {}` 用���最佳努力的清理（如删除临时目录失败时忽略），
			// 是刻意写法而非疏漏，不应报错。
			"no-empty": ["error", { allowEmptyCatch: true }],
		},
	},
];
