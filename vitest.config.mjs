import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// 只跑本工程的测试。
		// resources/ 下是插件市场的第三方内容（如 teams_marketplace），
		// 里面自带 .test.js，用默认的 include 会被 vitest 扫到并因语法不兼容而整体失败。
		include: ["tests/unit/**/*.test.mjs"],
		exclude: ["node_modules/**", "out/**", "resources/**", "artifacts/**"],
	},
});
