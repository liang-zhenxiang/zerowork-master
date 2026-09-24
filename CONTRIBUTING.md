# 贡献指南

## 动手之前

先读 [README.md](./README.md) 与 [docs/architecture.md](./docs/architecture.md)，
了解进程模型、目录职责与渲染层的现状。

## 修改规则

### ✅ 可以改的

- `tools/`、`tests/`、`docs/`、构建配置、治理文件 —— 这些是原创内容
- `src/main/index.js`、`src/preload/index.js`、`src/shared/ipc.js` ——
  已人工整理过，模块边界清晰
- `resources/` —— 场景、专家、技能、提示词等内容资源

### ⚠️ 谨慎改的

- `src/main/daemon/` —— 40 个模块、约 1.9 万行，改动前先确认影响面
- `src/renderer/src/` —— 大块 chunk（`app.js` 单个 6.8 万行），
  且与构建产物的命名约定耦合（见 `electron.vite.config.mjs` 的 renderer 段）

### 🚫 不要做的

- 不要为了让 lint 通过而大规模重排 `src/renderer/src/` 与 `src/main/daemon/`
  的代码格式。格式化会产生巨大的 diff，淹没真实改动
- 不要删除 `$1` `$2` 这类后缀名。它们是 Rollup 消解命名冲突的结果，
  手工"整理"会引入难以发现的引用错误

## 提交规范

使用[约定式提交](https://www.conventionalcommits.org/zh-hans/)：

```
<类型>(<范围>): <描述>

类型：feat | fix | refactor | perf | test | docs | build | chore | revert
范围：main | daemon | renderer | preload | shared | sandbox | tools | docs | ci
```

例：

```
fix(daemon): 修正 daemon ready 推送与渲染层监听的竞态
docs(tools): 补充模块图检查的用法说明
```

## 开发流程

```bash
npm install
npm run dev            # 开发模式

npm run lint           # 静态检查
npm run typecheck      # 类型检查（当前为宽松模式，见 tsconfig.json 注释）
npm run test           # 单元测试
npm run test:gui       # 端到端 GUI 测试
```

**提交前请确保 `npm run test:all` 通过。**

### 关于测试

改 GUI 相关代码时，请务必跑 `npm run test:gui`。
Electron 应用最常见的故障形态是「界面看着正常，但 IPC 全挂」——
只做「能启动」的冒烟测试抓不到。测试会真实启动应用、驱动 DOM、
断言 daemon 存活与 IPC 应答。

新增界面功能时，请同步补充端到端断言。测试截图输出在 `artifacts/`，
可直接肉眼复核。

## daemon 模块图

`src/main/daemon/` 的 40 个模块用相对 import 相连。这层错误构建期抓不到：
漏一个 export、写错一个路径，只会在运行时某个冷门分支抛 `ReferenceError`。

改完 daemon 请跑：

```bash
npm run check:daemon-graph
```

它验相对 import 都指向真实文件、具名 import 都能对上导出。CI 里有一道
同名检查（`daemon-module-graph`）。

## Pull Request

- 一个 PR 只做一件事
- 描述里说明**为什么**改，而不只是改了什么
- 涉及行为变更的，附上验证方式（命令、截图、日志）
- 不要提交 `out/`、`node_modules/`、`artifacts/`（已在 `.gitignore` 中）

## 报告问题

- 功能缺陷 / 崩溃：使用 Issue 模板中的 Bug 报告
- 安全漏洞：**不要**开公开 Issue，见 [SECURITY.md](./SECURITY.md)
- 文档与实现不一致：请指出具体文件与行号
