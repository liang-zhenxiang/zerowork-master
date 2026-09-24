# 首页预设（能力胶囊 + 最佳实践案例）

首页输入框上方那一横条**能力胶囊**，和下方**最佳实践案例**卡片的数据。

加载器：`src/main/daemon/resources.js` 的 `loadWelcome`（坏数据抛错，不静默少一块）；
下发链路：daemon 随会话快照的 `welcome` 字段给 renderer；渲染见
`src/renderer/src/app.js` 的 `HomeView`，选取逻辑（过滤/分页/下钻）同在该文件里。

## 两份数据

| 文件 | 内容 |
|---|---|
| `chips.json` | 能力胶囊（work 4 个 + code 4 个）。`playbook` 类型的胶囊点开后的下钻列表由 `cases.json` 提供 |
| `cases.json` | 最佳实践案例 12 条（每个胶囊 3 条）。`chipId` 指回所属胶囊 |

两处要保持一致：`cases.json` 里任何一条 case 的 `chipId` 必须指向 `chips.json` 里
真实存在的胶囊（否则加载器报错），而 `playbook` 类型的胶囊必须至少配一条 case。

## 字段

`chips.json`（数组）：

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，`cases.json` 的 `chipId` 指向它 |
| `scene` | 归属场景轴，必须是 `resources/scenes/<id>/` 里存在的场景（写错加载即报错） |
| `label` / `description` | 胶囊文字与 tooltip |
| `icon` | 图标键（`doc`/`chart`/`slide`/`research`/`code`/`web`/`terminal`），组件映射在 `home-view.tsx` 的 `CHIP_ICONS` |
| `chipKind` | `playbook` 或 `scene`，只决定提示词从哪来 |
| `prompts` | 仅 `chipKind: "scene"` 用：内联提示词数组 |

`cases.json`（数组）：`id` / `chipId` / `title` / `subtitle` / `prompt` / `expert` / `cover`。

## 案例绑定的专家（已随包预装）

每条案例都带一个专家，专家在 `resources/experts/`（人设 + 各自私有技能）。
`cases.json` 的 `expert` 存的是**我们的专家目录名**：

| 案例 | 案例侧的专家 id | 我们的目录 |
|---|---|---|
| doc-book-summary-notes / doc-api-reference | TechnicalDocumentationEngineer | `technical-documentation-engineer` |
| doc-meeting-decision-digest | OpenSpecDocTeam | `openspec-doc-team` |
| data-global-population-structure / data-ecommerce-rfm-value | DataAnalyticsReporter | `data-analytics-reporter` |
| data-gdp-hdi-explorer | VisualStorytellingExpert | `visual-storytelling-expert` |
| research-cheetah-conservation | DeepResearchExpert | `deep-research` |
| research-gold-price-drivers | FsiMarketResearcher | `market-researcher` |
| research-ai-coding-business-model | TrendResearcher | `trend-researcher` |
| ppt-popmart-brand-intro / ppt-journey-west-intro | PptCreationExpert | `ppt-creation-expert` |
| ppt-ai-history-timeline | DeveloperEvangelist | `developer-evangelist` |

`expert` 目前只进数据与校验（`resources.test.ts` 断言它指向真实存在的专家目录），
**尚未参与交互** —— 点卡片时顺带安装/启用该专家这一步还没做。

## 依赖的插件（已随包预装）

插件**随包预装**：插件原样落在 `resources/plugins/`，建会话时自动纳入技能搜索路径。
胶囊与插件的对应关系：

| 胶囊 | 依赖插件 |
|---|---|
| 文档处理 | `document-skills` |
| 数据分析及可视化 | `data-analysis`（市场里实际叫 `data`） |
| 深度研究 | `deep-research` |
| 幻灯片 | `ppt-implement` |
| 网站开发 | `modern-webapp` |
| 日常开发 / CI/CD / 文档 | 无 |

版本、许可与**待适配项**见 [../plugins/README.md](../plugins/README.md)。

## 加一个胶囊或案例

只改数据，零行代码：

- **加一个 case**：往 `cases.json` 追一条，`chipId` 指向已有胶囊即可（胶囊的下钻列表
  与卡片列表共用这份数据，不会漂移）；
- **加一个胶囊**：`chips.json` 追一条；`playbook` 类型必须至少配一条 case（否则点开是
  空列表，加载器会报错），`scene` 类型必须给非空 `prompts`。

## 已知差异 / 待办（对比测试时注意）

- **work 胶囊只取了 4 个**：日常办公分组下共 8 个，其余 4 个（金融服务 / 产品管理 /
  视频生成 / 个人工作台）未取。补的话按 `scenario_id` 101 / 106 / 104 / 122 再取。
- **案例只取了 12 条**（每胶囊 3 条），筛选条件是「无 skills / 无 mcps 依赖」，
  其余 1041 条可按需再取。
- **代码场景的提示词带云端依赖**：code 场景的「网站开发」胶囊提示词里写「数据使用云端
  数据库存储」—— 我们还没有这条路，提示词保留原文；真的跑不通时再做兼容改写。
- **封面是远程图**：直接引远程 CDN 地址（CSP `img-src` 已放行 `https:`），加载失败
  回落图标底。**离线可用尚未做** —— 断网场景需要在主进程侧做磁盘缓存 + 降采样
  （COS 响应不带 Cache-Control），这是一条已知缺口。
- **胶囊点击后的「插件自动安装」未实现**：改成随包预装（见上一节）—— 数据里因此不含
  `plugins` 字段，插件版本固定在本仓库。