# 像素君（ui-designer / UI设计师）

专注视觉设计系统、组件库与像素级界面打造的 UI 设计专家，追求无障碍与品牌一致。

## 能力定位

- **界面设计**：从零设计兼顾美观与易用的用户界面
- **设计系统**：为产品搭建完整的设计规范系统与组件库
- **设计评审**：评审现有 UI 并提出优化方案

## 技能

| 技能 | 说明 |
|------|------|
| `impeccable` | 高品质 UI/UX 设计工具集：视觉风格、布局排版、动效交互、质量保障与设计系统，含 30 个 `references/*.md` 深度参考。属**纯提示词技能**：目录内只有 `SKILL.md` 与 `references/*.md`，无脚本、无二进制、无模板，可离线使用。 |

## 目录结构

```
ui-designer/
├── expert.md   # 人设正文 + frontmatter
├── skills/
│   └── impeccable/   # SKILL.md + references/*.md（30 篇）
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `ui-designer`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `skills/` 作为额外技能搜索路径挂载，每个技能目录必须有 `SKILL.md`。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- **人设正文提到的三个技能本仓库未提供**：正文「内置 Skill 使用场景」一节列有 `brand-guidelines` / `frontend-dev` / `canvas-design`，实际随包技能只有 `impeccable`，两者不一致，调用时会落到不存在的技能上。
- **未随包的高成本技能**（如需使用需自行准备运行时）：
  - `frontend-dev`：体积 5.4 MB，绝大多数是 `canvas-fonts/` 字体文件；其 `scripts/` 下 4 个脚本依赖 **MiniMax 图像/音乐/语音/视频 API** 与账号凭证，`references/` 也以 MiniMax CLI 使用手册为主。
  - `browser-use`：需要浏览器自动化运行时（基于 Chrome DevTools Protocol 驱动真实浏览器，见 `references/cdp-python.md` / `multi-session.md`），本项目当前没有对应能力与权限面。
- 人设正文为**英文**，尚未中文化。
- `impeccable` 正文中出现的 URL 都是文档引用链接，不是运行时依赖；`SKILL.md` 的 `allowed-tools: Read,Write,Bash` 只声明技能自身可用工具。