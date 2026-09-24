# 安全策略

## 报告安全漏洞

**请不要通过公开 Issue 报告安全漏洞。**

请通过私有渠道联系维护者，或在 GitHub 上使用
[Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
提交。

请在报告中包含：

- 受影响的版本
- 漏洞类型与影响面
- 复现步骤（最小可复现即可）
- 如可能，附上修复建议

我们会在确认后尽快回复，并在修复发布后致谢（除非你希望匿名）。

## 本项目的安全相关设计

本项目的攻击面与普通桌面应用不同，以下几点值得注意：

### 渲染层隔离

渲染进程运行在沙箱化的 web 环境中，无法直接访问任意文件路径。
需要文件系统能力的操作（文件对话框、读取图片字节）由主进程通过 IPC 应答完成。

### CSP

Content-Security-Policy **不写在 `index.html` 里**，而是由主进程按
dev / prod 分别下发（见 `src/main/index.js` 的 `installCsp`）。
原因：dev 模式下 `@vitejs/plugin-react` 会注入内联的 react-refresh preamble，
静态 meta CSP 收紧 `script-src` 会把它拦掉。

⚠️ 修改 CSP 时请同时验证 dev 与 prod 两种模式。

### 沙箱与权限

Agent 执行命令经过沙箱层（`src/main/sandbox/`），权限预设定义在
daemon 的 `PERMISSION_PRESETS` / `APPROVAL_POLICIES` 中。
放宽权限默认值属于安全敏感变更，请在 PR 中明确说明理由。

### MCP 连接器

MCP server 通过 stdio 或 HTTP 传输启动外部进程，等同于执行用户配置的任意命令。
配置解析在 daemon 的 `readMcpConfig` / `parseServer` 一带，
涉及 JSONC 解析与环境变量展开（`expandEnvVars`）。
**涉及 `expandEnvVars` 的改动需要特别审查**——它处理的是不受信任的配置输入。

### 审计日志

daemon 记录命令执行、沙箱、运行时、审计四类事件（`AUDIT_CATEGORIES`）。
审计日志本身可能包含敏感信息（命令内容、路径），导出与展示时请注意。

## 依赖安全

```bash
npm audit
```

注意本项目依赖 `@earendil-works/pi-coding-agent` 等第三方包，
其安全更新节奏不由本项目控制。
