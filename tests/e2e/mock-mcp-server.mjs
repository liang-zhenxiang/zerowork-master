#!/usr/bin/env node
/**
 * 最小 MCP stdio server，用于端到端测试 MCP 连接器。
 *
 * 实现 MCP 协议里连接器最关心的四个方法：
 *   initialize              → 握手，回报 capabilities 与 serverInfo
 *   notifications/initialized → 客户端通知，无需应答
 *   tools/list              → 暴露工具清单
 *   tools/call              → 执行工具并回结果
 *
 * 传输：stdio 上的**换行分隔 JSON**（MCP 的 stdio 传输约定）。
 *
 * 为什么不用官方 SDK：为了测「本工程的连接器实现对不对」，服务端越简单越好。
 * 引 SDK 会把 SDK 自己的行为也带进来，出问题时分不清是谁的锅。
 */
import { createInterface } from "node:readline";

const TOOL_NAME = "zw_probe_tool";
const TOOL_MARK = "ZW_MCP_TOOL_OK";

const TOOLS = [
	{
		name: TOOL_NAME,
		description: "端到端测试用的探针工具：调用后返回一个固定标记。",
		inputSchema: {
			type: "object",
			properties: { echo: { type: "string", description: "原样回显的文本" } },
			required: [],
		},
	},
];

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
	const text = line.trim();
	if (text === "") return;
	let msg;
	try {
		msg = JSON.parse(text);
	} catch {
		return;
	}

	// 通知（无 id）不需要应答
	if (msg.id === undefined) return;

	const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
	const fail = (code, message) => send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });

	switch (msg.method) {
		case "initialize":
			reply({
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "zw-mock-mcp", version: "1.0.0" },
			});
			break;

		case "tools/list":
			reply({ tools: TOOLS });
			break;

		case "tools/call": {
			const name = msg.params?.name;
			if (name !== TOOL_NAME) {
				fail(-32602, `未知工具：${name}`);
				break;
			}
			const echo = msg.params?.arguments?.echo ?? "";
			reply({
				content: [{ type: "text", text: `${TOOL_MARK}${echo === "" ? "" : `:${echo}`}` }],
			});
			break;
		}

		default:
			fail(-32601, `未实现的方法：${msg.method}`);
	}
});
