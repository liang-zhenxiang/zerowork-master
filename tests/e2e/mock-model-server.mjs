/**
 * 最小 OpenAI 兼容模型服务，用于端到端测试。
 *
 * 为什么需要它：
 *   「输入 → 模型回复」是这类应用的主链路，但常规做法要求真实 API Key。
 *   应用支持自定义 provider（可配 baseUrl），所以可以在本地起一个假服务，
 *   把整条链路真正跑通：渲染层 → IPC → daemon → pi SDK → HTTP → 模型 → 流式回传。
 *
 * 覆盖范围：
 *   ✅ 请求真的发出去了、发到了哪、body 里有什么
 *   ✅ 流式响应被正确解析并落到会话状态
 *   ✅ 工具调用（tool_calls）的处理路径
 *   ❌ 不验证任何真实模型的能力 —— 它只会回预设的文本
 *
 * 用 node:http 手写，不引第三方依赖：测试基建引入的依赖越多，
 * 它自己出问题的概率越高。
 */
import { createServer } from "node:http";

/**
 * 启动 mock 服务。
 * @param {object} opts
 * @param {string} opts.reply    模型要回复的文本
 * @param {boolean} opts.toolCall 是否返回一个工具调用而不是纯文本
 * @param {number} opts.port     监听端口，0 表示随机
 */
export function startMockModelServer({ reply = "这是 mock 模型的回复。", toolCall = false, port = 0 } = {}) {
	/** 收到的所有请求，供测试断言 */
	const requests = [];

	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				parsed = undefined;
			}
			requests.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });

			if (!req.url?.includes("/chat/completions")) {
				res.writeHead(404, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "not found" } }));
				return;
			}

			// SSE 流式响应：OpenAI 的 chat completions 流格式
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});

			const id = `chatcmpl-mock-${Date.now()}`;
			const created = Math.floor(Date.now() / 1000);
			const base = { id, object: "chat.completion.chunk", created, model: "mock-model" };

			const send = (delta, finish = null) => {
				res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
			};

			send({ role: "assistant", content: "" });

			if (toolCall) {
				// 工具调用路径：模型要求执行一个工具
				send({
					tool_calls: [
						{
							index: 0,
							id: "call_mock_1",
							type: "function",
							function: { name: "ls", arguments: '{"path":"."}' },
						},
					],
				});
				send({}, "tool_calls");
			} else {
				// 分片吐出文本，模拟真实流式行为
				for (const chunk of reply.match(/.{1,8}/gu) ?? []) {
					send({ content: chunk });
				}
				send({}, "stop");
			}

			res.write("data: [DONE]\n\n");
			res.end();
		});
	});

	return new Promise((resolve) => {
		server.listen(port, "127.0.0.1", () => {
			resolve({
				port: server.address().port,
				baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
				requests,
				close: () => new Promise((r) => server.close(r)),
			});
		});
	});
}
