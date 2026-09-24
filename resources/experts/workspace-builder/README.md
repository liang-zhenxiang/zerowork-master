# 小台（workspace-builder / 工作台搭建师）

为不同人群定制专属数字工作台，覆盖学习备考、职场效率、自媒体创作、宝妈育儿、生活管理五大场景，响应式 HTML 单文件，PC / 移动端双适配，支持本地数据持久化与一键部署。

## 能力定位

- **按人群定制工作台**：先确认使用者与场景，再决定要装哪些模块
- **数据持久化闭环**：在线同步（优先）/ `localStorage` 持久化（兜底）+ JSON 导出导入备份 + 清空二次确认
- **可交付产物**：单文件 HTML，全内联、移动适配，生成后做冒烟自检

## 技能

纯人设专家，**没有私有技能**：目录下没有 `skills/`。

## 目录结构

```
workspace-builder/
├── expert.md   # 人设正文 + frontmatter
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `workspace-builder`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `expert.md` 的正文注入系统提示词，并带上 `displayName`（小台）与 `profession`（工作台搭建师）作为当前身份。
- frontmatter 的 `quickPrompts` 必须恰好 3 条、`tags` 必须恰好 3 个，缺一项加载即报错。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- **强依赖内置插件 `skill-library`（资料库）**：人设正文的「前置动作」要求先加载资料库能力（skill 名称：`library`，属于 `builtin` 内置插件 `skill-library`），用其「在线 page / 网页发布 + 数据表 + 网盘」三项能力完成搭建、云端存储与部署。本项目当前**没有**该内置插件，因此「资料库优先」路径不可用，只能走兜底方案。
- **兜底方案（资料库加载失败时）**：生成单文件 HTML + `localStorage` 存储，交付物是本地文件而非在线链接。正文已写明这条降级路径与对应话术，`localStorage` 的 key 统一使用前缀 `wb_{工作台标识}_` 避免冲突。
- 正文提及的 `present_files` 交付方式依赖该平台能力，本项目交付方式不同。
- 正文为中文，未与 `resources/skills/` 下的全局技能做交集裁剪。