# 深研研（Iris / 深度研究专家）

综合性深度研究专家：多源信息检索、事实验证、知识发现，最终输出结构化的研究报告。

## 能力定位

- **多源检索与聚合**：跨来源收集信息并交叉验证，而不是单点取信
- **趋势调研**：行业与技术发展趋势的快速调研与研判
- **研究报告写作**：面向学术级写作的引用规范与结构化输出

## 技能

本目录**不含 `skills/`**，研究工作依赖平台通用工具与全局技能。

其中「微信公众号文章搜索」能力来自全局预装的 `deep-research@teams_marketplace` 技能包，**不在本目录内**。

## 目录结构

```
deep-research/
├── expert.md   # 人设正文 + frontmatter
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `deep-research`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `expert.md` 的正文注入系统提示词，并带上 `displayName`（深研研）与 `profession`（深度研究专家）作为当前身份。
- frontmatter 的 `quickPrompts` 必须恰好 3 条、`tags` 必须恰好 3 个，缺一项加载即报错。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- 微信公众号文章搜索依赖外部预装的 `deep-research@teams_marketplace` 技能包；该技能包不存在时，这一路检索能力缺失。
- 纯人设专家：无私有技能、无成员，不支持多成员分工。