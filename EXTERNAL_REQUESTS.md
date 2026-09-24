# 外部资源请求审计清单

本文件逐条列出**本应用在运行时会向外部发起的网络请求**：请求到哪个地址、做什么用、
由什么触发、能不能关掉。

> 这是给权利人与安全评审看的清单。凡本文件列出的地址，都是**代码里真实存在的**
> 请求路径；不含文档里出现的普通链接（如 `react.dev`、`tailwindcss.com` 这类
> 参考资料链接，它们不会被请求）。

阅读约定：

- **可控** = 应用提供开关 / 需要用户显式配置，或可以整体关闭
- **不可控** = 随包内容自带、当前没有开关（需要改代码或移除该资源才能关掉）
- **已移除** = 曾经存在、本轮已删除的请求

---

## 一、应用本体（`src/`）—— 全部可控

### 1. 模型 API

| 项 | 内容 |
| --- | --- |
| 地址 | **由用户配置**（自定义 provider 的 `baseUrl`），默认不预设任何地址 |
| 用途 | 对话与 agent 循环的推理请求（Anthropic Messages 或 OpenAI 兼容格式） |
| 触发 | 每次发消息 |
| 可控 | ✅ 用户自己在设置页配置；不配就不发 |

### 2. 联网搜索（`web_search` 工具）

| 服务商 | 地址 | 用途 |
| --- | --- | --- |
| 博查 Bocha | `https://api.bochaai.com/v1/web-search` | 中文网页搜索 |
| Tavily | `https://api.tavily.com/search` | 网页搜索（海外服务） |
| Brave | `https://api.search.brave.com/res/v1/web/search` | 网页搜索 |
| Bing | `https://api.bing.microsoft.com/v7.0/search` | 微软搜索 API |

- **触发**：模型调用 `web_search` 工具时
- **可控**：✅ 需要用户在设置页显式选择服务商并填入自己的 API Key；不配置时该工具不可用
- **位置**：`src/main/daemon/command-exec.js`

### 3. 网页抓取（`web_fetch` 工具）

| 项 | 内容 |
| --- | --- |
| 地址 | **任意 URL** —— 由模型在调用工具时给出 |
| 用途 | 抓取指定网页正文 |
| 触发 | 模型调用 `web_fetch` |
| 可控 | ✅ 受权限门约束（工具调用前会按当前权限档位判定） |

### 4. 托管运行时下载（设置页「运行时」里点安装时）

| 运行时 | 地址 | 用途 |
| --- | --- | --- |
| Node（官方源） | `https://nodejs.org/dist/v<版本>/` | 下载 Node 发行包 |
| Node（镜像） | `https://registry.npmmirror.com/-/binary/node/v<版本>/` | 同上，国内镜像 |
| PortableGit（官方源） | `https://github.com/git-for-windows/git/releases/download/<tag>/` | 下载 PortableGit（仅 Windows） |
| PortableGit（镜像） | `https://registry.npmmirror.com/-/binary/git-for-windows/<tag>/` | 同上，国内镜像 |
| Python | 经 `uv` 安装：`https://docs.astral.sh/uv/` 指引 + PyPI / `UV_PYTHON_INSTALL_MIRROR` | 创建 Python 虚拟环境 |

- **触发**：用户在设置页对某个运行时点「安装」
- **可控**：✅ 不点就不下载；镜像地址可由 `UV_INDEX_URL` / `UV_PYTHON_INSTALL_MIRROR` 指向内网
- **校验**：Node 与 PortableGit 的发行包在下载后会做 sha256 校验（整包 + 解包后可执行文件），不通过不启用
- **位置**：`src/main/daemon/runtimes.js`

### 5. 本地预览服务

| 项 | 内容 |
| --- | --- |
| 地址 | `http://127.0.0.1:<随机端口>` |
| 用途 | 为工作区里的 HTML 产物提供本机预览 |
| 可控 | ✅ 只监听本机回环地址，不出网 |

---

## 二、随包资源（`resources/`）—— 部分不可控

这一节的请求由**随包的内置专家 / 技能**发起，不是应用本体发的。

### 6. 首屏案例封面图 —— ⚠️ 不可控

| 项 | 内容 |
| --- | --- |
| 地址 | `https://static.workbuddy.cn/workbuddy/playbook/cases/*.png`（12 张） |
| 用途 | 首页「最佳实践案例」卡片的封面图 |
| 触发 | 渲染首屏时由渲染层直接 `<img>` 加载 |
| 可控 | ❌ 没有开关。**注意：这只是图片地址，不是接口**，服务端不因此获得任何会话数据 |
| 位置 | `resources/welcome/cases.json` 的 `cover` 字段 |

**可选的关掉方式**：把 `cases.json` 的 `cover` 改成随包本地图片路径（需要准备 12 张图），
或清空该字段让卡片不带封面。**改了这两处就断图**，所以当前保持原样。

### 7. 财务数据接口（`neodata-financial-search` 技能）—— ⚠️ 不可控

| 项 | 内容 |
| --- | --- |
| 地址 | `https://copilot.tencent.com/agenttool/v1/neodata`（默认值，可用环境变量 `NEODATA_ENDPOINT` 覆盖） |
| 用途 | 按自然语言查询股票行情、财务、基金、宏观等金融数据 |
| 触发 | 模型调用该技能时 |
| 可控 | ⚠️ 可用环境变量改地址，但**请求体里有一个服务端约定的固定渠道参数**（`sub_channel`），改动该值会导致接口调用失败，因此保留原值 |
| 位置 | `resources/experts/market-researcher/skills/neodata-financial-search/` |

### 8. IMA 知识库文件上传（`ima-skills` 技能）—— ⚠️ 不可控

| 项 | 内容 |
| --- | --- |
| 地址 | `https://<bucket>.cos.<region>.myqcloud.com`（腾讯云对象存储，桶名与地域由配置决定） |
| 用途 | 把文件上传到 IMA 知识库 |
| 触发 | 模型调用该技能的上传命令时 |
| 可控 | ⚠️ 桶名/地域可配，但协议是 COS，换不掉 |
| 位置 | `resources/experts/trend-researcher/skills/ima-skills/knowledge-base/scripts/cos-upload.cjs` |

### 9. 微信公众号文章检索（`wechat-article-search` 技能）—— ⚠️ 不可控

| 项 | 内容 |
| --- | --- |
| 地址 | `https://weixin.sogou.com/weixin` |
| 用途 | 按关键词检索公众号文章并抓取正文 |
| 触发 | 模型调用该技能时 |
| 可控 | ❌ 该技能的实现方式就是爬搜狗微信搜索，没有官方 API 可换 |
| 位置 | `resources/plugins/teams_marketplace/deep-research/1.0.0/skills/wechat-article-search/` |

### 10. 股票数据技能（`stock` / `stock-data` / `stock-tool`）—— ⚠️ 需要你决策

这是随包体积最大的一块（四个打包脚本共约 6.5 MB，**代码经混淆并含 WASM**）。

| 项 | 内容 |
| --- | --- |
| 数据地址 | **不硬编码** —— 由 `mcp_get_connect_info` 从**用户配置的 MCP 连接器**取连接信息后构造（见 `http_build_endpoint`） |
| 内置数据 | 部分查询（如股票搜索）走**随包本地数据**，不发请求 |
| ⚠️ 内置遥测 | 打包进来的监控 SDK（Tencent Galileo）**带有上报地址常量**：<br>`http://otlp.j.woa.com:80/v1/{metrics,traces,logs}`（内网）<br>`https://sg.tgalileo.com/v1/{metrics,traces,logs}`（海外）<br>`http://gocp.woa.com/ocp/api/v1/get_config`、`https://sg.tgalileo.com/ocp/api/v1/get_config`（远程配置） |
| 遥测代码路径 | 存在 `getGalileoLogger()` / `flushGalileoLogs()`，会在工具执行后 flush 日志（含 `os_type`、`arch` 等属性，见 `data-index.js`） |
| 实测 | 本轮在本机跑 `search`（本地数据，无出站）与 `quote`（发起 SSE 请求，因未配置连接器返回 404）。**未观察到向上述遥测地址的实际连接**，但代码路径确实存在 |
| 可控 | ❌ **没有开关**。且因为代码经过混淆 + WASM，改它有破坏功能的风险，本轮**未改动** |

**建议**（本轮未执行，交你决策）：
该技能的数据源依赖一个外部 MCP 连接器，**不配置时 `quote` 这类查询本就不可用**。
若不需要这块能力，**整体删除 `stock` / `stock-data` / `stock-tool` 三个技能目录**
是同时消除「外部依赖」与「内置遥测路径」的最干净做法。

**另外**：这几个脚本经字符串数组混淆，其内部仍有按索引拼接的字符串片段，
其中残留了第三方品牌字样与内部符号名（例如由片段拼出的用法示例文本、
`westock_core_inline` 这个内部模块名）。这些**不是对外可见的品牌展示**，
但仍在文件里。改它们需要动混淆代码，有破坏功能的风险，本轮未改。

### 11. 可视化卡片的 CDN（渲染层）

| 项 | 内容 |
| --- | --- |
| 地址 | `cdnjs.cloudflare.com`、`cdn.jsdelivr.net`、`unpkg.com`、`esm.sh` |
| 用途 | 模型生成的图表卡片（如 Chart.js）通过 `<script src>` 从 CDN 加载库 |
| 触发 | 模型调用 `show_widget` 产出含外部 `<script>` 的卡片时 |
| 可控 | ✅ 该内容由模型生成，可在提示词里约束不用 CDN |

---

## 三、已移除的请求

| 项 | 原地址 | 说明 |
| --- | --- | --- |
| 任务遥测上报器 | 上游 InLong 端点（`task_start` / `task_complete` 事件） | 源专家包自带的 `bin/init_task.py` 会生成设备 UUID 落盘并上报任务开始/完成事件（含耗时、成败、设备标识、由工作区 `.git` 路径推出的会话键）。**本仓库已移除全部网络上报**，改为纯本地 no-op（保留同名命令，是为了让正文里的 `init_task start\|complete` 调用不至于失败）。位置：`resources/experts/stock-partner-team/bin/init_task.py` |

---

## 四、汇总：当前**无法关闭**的请求

按风险从高到低：

| # | 地址 | 用途 | 备注 |
| --- | --- | --- | --- |
| 1 | `otlp.j.woa.com` / `sg.tgalileo.com` / `gocp.woa.com` | 内置监控 SDK 的遥测与远程配置 | **代码路径存在，未实测到实际连接**；无开关；建议整体移除该技能 |
| 2 | `https://copilot.tencent.com/agenttool/v1/neodata` | 金融数据查询 | 请求体含服务端约定的固定渠道参数，改则失效 |
| 3 | `*.myqcloud.com` | IMA 知识库文件上传 | COS 协议，换不掉 |
| 4 | `https://weixin.sogou.com/weixin` | 公众号文章检索 | 实现即爬虫 |
| 5 | `https://static.workbuddy.cn/workbuddy/playbook/cases/*.png` | 首屏封面图（仅图片） | 可换成随包本地图 |

> 除以上五项外，应用本体的全部出站请求都在用户显式配置或点击之后才会发生。

---

## 五、保留的第三方名称（**不是请求**，但一并登记供审计）

有一类名称**刻意保留** —— 它们是**事实性标识符**：改了会让内容变得不准确，
或者直接让功能失效。分类如下。

### 5.1 服务端约定的固定值（改了接口就失败）

| 位置 | 值 |
| --- | --- |
| 财务数据技能的请求体 | `sub_channel: "workbuddy"` —— 服务端约定的渠道参数，必须原样传 |

### 5.2 功能性的域名 / 路径段（改了取不到东西）

见第二节第 6–9 项。要点：`static.workbuddy.cn`（封面图）、
`copilot.tencent.com`（数据接口）、`*.myqcloud.com`（COS 上传）、
`weixin.sogou.com`（公众号检索）。

### 5.3 npm 包名 / 配置文件姓名（文档里让你执行的东西）

| 名称 | 说明 |
| --- | --- |
| `@cloudbase/cli`、`cloudbaserc.json`、`@cloudbase/framework-plugin-*`、`@cloudbase/monitor` | 文档中给出的安装与配置命令，包名与配置文件名都是真实存在的标识符 |

### 5.4 第三方库内部标识符（打包进来的依赖，改了会破坏行为）

| 位置 | 名称 | 说明 |
| --- | --- | --- |
| `resources/experts/market-researcher/skills/stock/scripts/data-vendor.js`、`tool-vendor.js` | `image/vnd.tencent.tap` | **IANA 注册的 MIME 类型**，不是品牌展示 |
| 同上 | `@tencent/trpc-rpc-client`、`@tencent/trpc-rpc-server` | OpenTelemetry 对真实 npm 包的插桩目标名 |
| 同上 | `TST(Tencent_Security_Team)` | 某个安全扫描库的内部签名 |
| `.../stock/scripts/data-index.js`、`tool-index.js` | `westock_core_inline` 等 | 混淆代码的内部模块名；以及由字符串数组拼出的用法示例文本 |

### 5.5 文档中列举的第三方平台（检索源 / 技术选型对照）

| 位置 | 内容 |
| --- | --- |
| `resources/experts/technical-documentation-engineer/skills/deep-research/agents/web-search-*.md` | 检索源清单里的平台名（与 CSDN、知乎、掘金、Reddit、Stack Overflow 等并列）—— 名字本身就是**要检索的目标**，泛化掉反而降低指引质量 |
| `resources/experts/mvp-dev-expert-team/references/architecture/mvp-stack.md` 等 | 技术选型对照表：厂商名已改为能力描述（如「云对象存储（COS）」），仅保留真实包名与配置名 |

### 5.6 厂商文档链接（实现依据，读者可能需要）

| 位置 | 内容 |
| --- | --- |
| `resources/experts/trend-researcher/skills/ima-skills/knowledge-base/scripts/cos-upload.cjs` | `// Reference: https://cloud.tencent.com/document/product/436/7778` —— COS 签名算法（`buildAuthorization`）的**实现依据**。它不是品牌指涉，是「这段签名逻辑照哪份规范写的」，删掉会让读者失去校验实现的入口 |

### 5.7 判定口径

名称如果是「你得照着敲的东西」（包名、配置名、请求参数、MIME 类型、要检索的平台名），
保留；如果只是行文里的品牌指涉，改掉。

---

## 六、文案与实现不一致（**不是品牌问题，需要你决策**）

以下**不属于**第三方字样登记范围，
是写测试时撞上的**文案与代码行为不符**。因为改的是**模型可见的指令文案**、
会改变产品行为，我没有擅自改，登记在此供你裁决。

### 6.1 Agent 团队成员产出：文案说「不会自动送到」，实现是**自动投递**

**文案（9 处）**：

| 位置 | 原文 |
| --- | --- |
| `src/main/daemon/tool-factories.js:695` | `取产出用 team_read（不会自动送到你这里）` |
| `src/main/daemon/tool-factories.js:700` | `成员跑完后用 team_read 取回产出再汇总 —— 产出不会自动出现。` |
| `src/main/daemon/tool-factories.js:759` | `**它们完成后产出不会自动送到你这里**` |
| `src/main/daemon/tool-factories.js:791` | `（产出存在它的会话记录里，不会自动送到你这里）` |
| `src/main/daemon/tool-factories.js:823` | `不要干等它「自动送过来」—— 产出不会自动送达。` |
| `resources/experts/{mvp-dev-expert-team,openspec-doc-team,gpt-researcher-team,stock-partner-team}/expert.md` | `产出**留在它自己的会话记录里，不会自动送到你这里**` |

**实现**：领导**下一次请求**会带上未见过的成员产出快照
（`takePendingTeamOutput` → `composePendingTeamOutput`，`src/main/daemon/teams.js`），
形如：

```xml
<team_output team="…">
以下是你还没见过的成员产出增量；状态行末尾的 [fp xxxxxxxx] 只用于跨轮去重…
- scout1（scout）：idle，已完成 1 轮 [fp 67c8f1cc]

<member_output member="scout1">
…产出正文…
</member_output>
</team_output>
```

两个投递通道（`src/main/daemon/session-files.js`）挂的都是同一个判据：
工具结果挂载点 `createTeamOutputHook`（2742 行）与运行起点快照 `composeTeamOutput`（2821 行），
注释里明确写着 `spec: inject-team-output-snapshot` —— 即**自动投递是刻意设计**。

**实测证据**：`tests/e2e/team-create.mjs` 断言了领导请求体里确实出现上述快照，
并含 `<member_output member="scout1">` 段落（断言抓的是 mock 收到的原始请求，
不是推测）。

**为什么我建议改文案、但没改**：按指纹去重 + 超长截断（截断提示写「全文用 team_read 取回」）看，
`team_read` 的正确定位是「取全文」而非「唯一通道」。照现在的文案，模型每轮都会
多调一次 `team_read` 把已经看到的产出再拉一遍 —— 不影响正确性，但白费 token，
也让「产出不会自动出现」这句话与它自己下一轮看到的 `<team_output>` 自相矛盾。

**改法（供你决定）**：把上述 9 处从「不会自动送到」改为
「**下一次请求会自动带上未见过的产出；超长会被截断，截断时用 team_read 取全文**」。
因为这是模型可见的指令，会改变它的取用习惯，所以我留给你拍板 ——
你说改，我就一次改干净（含 4 份专家人设）。

### 6.2 用户级记忆的路径：提示词写死 `~/.zerowork`，实现读的是**配置目录**

**提示词（模型照它执行）**：`resources/prompts/memory-system.md`

| 行 | 原文 |
| --- | --- |
| 5 | `两个用户级文件（MEMORY.md / PROFILE.md）由系统保证存在……读取与更新直接对固定路径用 read / edit，不要先探测。` |
| 10 | `用户级记忆 \`~/.zerowork/MEMORY.md\`：跨项目长期生效的精确规则。……用 edit 原地更新` |

**实现**：`src/main/daemon/memory.js:37` 是 `join(getConfigDir(), "MEMORY.md")`，
而 `getConfigDir()`（`config-paths.js:19`）取 `ZEROWORK_CONFIG_DIR`，**没设才**回落到
`~/.zerowork`。读侧（`buildMemorySection`）与写侧（记忆工具）都走这个函数。

**后果**：默认安装下两者都是 `~/.zerowork`，**没有任何差异**；但一旦配置目录被覆盖
（便携部署、或任何 `ZEROWORK_CONFIG_DIR` 场景），就会出现**读 A 写 B**：
应用从配置目录读记忆，模型却把记忆写到家目录 —— 记忆功能静默失效，且**往用户家目录
写文件**。这不是推测：本项目自己的端到端测试就是这么被污染的（见 CHANGELOG
`0.1.4-zerowork.23`：测试设了隔离目录，模型仍把标记写进了 `~/.zerowork/MEMORY.md`）。

**改法（供你决定）**：把提示词里那两处 `~/.zerowork/MEMORY.md` 换成**运行时注入的
实际路径**。注意 `memory-system.md` 目前是**整段注入**的（`prompt-compose.js:147`
只把它包进「记忆系统」小节），不走 `{{...}}` 槽位填充 —— 所以要么给这段也接上填充，
要么在 `memory.js` 的加载处直接替换。默认配置下替换结果与原文字节相同，行为零变化；
只有配置目录被覆盖时才产生差异，且那个差异正是修 bug。

我没动它的原因：这是模型可见的指令文案，且它同时决定了「模型往哪里写文件」，
改它等于改产品行为 —— 与 6.1 同一条口径，交给你拍板。
