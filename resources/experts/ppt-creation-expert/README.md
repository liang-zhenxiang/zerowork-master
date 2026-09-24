# 汇报演示专家（ppt-creation-expert / PPT 制作专家）

基于汇报材料生成平台，整合通用汇报、面客方案、高拜材料与演讲讲稿生成的 PPT 制作专家。

## 能力定位

- **通用汇报**：把已有文档或材料整理成汇报用演示文稿
- **面客方案**：面向客户的行业解决方案材料
- **高拜材料**：高层拜访场景的汇报材料
- **演讲讲稿**：与演示文稿配套的讲稿生成

## 技能

纯人设专家，**没有私有技能**：目录下没有 `skills/`。

PPT 生成能力来自全局预装的 `ppt-implement@teams_marketplace` 技能包，**不在本目录内**。

## 目录结构

```
ppt-creation-expert/
├── expert.md   # 人设正文 + frontmatter
└── README.md   # 本文件
```

## 加载方式

- 会话按 `expertId` 绑定专家，取值就是本目录名 `ppt-creation-expert`，且必须与 `expert.md` frontmatter 的 `name` 一致。
- `expert.md` 的正文注入系统提示词，并带上 `displayName`（汇报演示专家）与 `profession`（PPT 制作专家）作为当前身份。
- frontmatter 的 `quickPrompts` 必须恰好 3 条、`tags` 必须恰好 3 个，缺一项加载即报错。
- 未声明 `expertType`，按单人设专家加载；目录下没有 `agents/`，不挂载成员。

## 已知限制

- 演示文稿的实际生成依赖外部预装的 `ppt-implement@teams_marketplace` 技能包；该技能包不存在时，只能产出大纲、文案与讲稿，无法生成文件。
- 单人设形态，无私有技能、无成员，不支持多成员分工。