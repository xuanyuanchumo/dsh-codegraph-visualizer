# ANIC — AI-Native Iteration Cycle 通用插件（可行性研究 × 需求分析 × 架构草案 × 开发计划）

> 状态：**研究文档（v1.13，2026-10-13）**。本文档族只做研究与设计，不含实现代码。
> 研究对象：`.dsh/skills/ai-native-iteration-cycle/`（平行副本 `.codeartsdoer/skills/`）。
> 目标形态：**通用 DSH 插件**（任何项目、任何技术栈的工作区装上即用），把该技能的"自进化/自评审开发流程"升级为**可视化、可审计、模型增强、动态自主进化**的流程运行时。
> v1.1 修订：① 定位从"本项目伴生插件"改为**通用插件**（本仓库仅作验证场/狗粮场，不是运行时依赖）；② 新增**动态自主进化**需求族（F16-F22）——技能现有进化能力是死端数据，插件化必须闭环。
> v1.2 修订：新增深化三篇——**05 数据结构与算法设计**、**06 生命周期/状态机/引擎研究**、**07 DSH 开发规范与破坏性变更适配**（用户 m00134 要求的设计深度）。
> v1.3 修订：新增 **08 产物规模与生命周期治理**（用户 m00196："要考虑多次调用插件的大量产物的问题"）——治 O(n²) 账本、无界证据字段、重复调用污染、空目录堆积；**GAP-9 / F23-F30 / N11 / A8-A9 / J9-J10 / R14-R18 / M2-b + M5-a** 全族联动，并新增**进化宪法条款 6/7**（永不自动销毁工件；账本形状一次定死）。
> v1.4 修订（复评轮，用户 m00491"重新评估…要从结构设计考虑优化相关逻辑"）：对 16 个脚本重新做静态取证，推翻 01 的"技能能跑"半句——**确定性门禁层在真实条件下静默失效或不可运行**（S-1 配置文件名漂移：`gate-check` 直接 exit(1)、`eval-runner` 的构建/静态检查维度恒 PASS；S-7 自主降级用正则改写 YAML 且记录与效果解耦；S-11 未知维度静默丢弃）。新增 **09 结构优化与逻辑重构设计**：11 项结构缺陷（S-1..S-11）→ 5 个结构根因（R-A..R-E）→ 目标结构 **L0-L5 单向依赖分层 + 七条结构原则** → 逻辑级优化（评审两级化/信任派生化/门禁完整化/失败响亮化）→ **INV-10..INV-19 + GUARD-1..6** → M1-M6 迁移映射。**01 的 GO 裁决不变，但前置条件升级为"先重构结构，不能逐脚本搬运"。**
> v1.6 修订（iteration-2）：skill-creator 第二轮循环——修复 e2e 挖出的 N-1/N-2/N-3/N-4/N-5/N-6/N-7/N-8a/N-9/N-11（G1 改任务表行解析不再模板自陷、`gate-check --record` 门禁结果自动入账本带去重、中文按字计数、快速启动补 init-cycle、路径/模板清单文档对齐、评估报告按维度合并不再覆盖、空账本显式注记、`(3/2)`→`(3/3 agents, threshold 2)`）；契约套件 11→**15 场景**（new 15/15、旧版快照 15/15 缺陷复现）；N-8b 归因撤销（band-history 写者只有 band-detector）；N-10/N-12 留档插件层；技能版本 **1.7.0→1.8.0**，镜像重同步 0 差异。
> iteration-4/5 续记（技能版本 **1.8.3 → 1.9.0**）：1.8.3 修账本级 P0 ×2（`archive-cycle` 归档删改账本、`hitl-audit` H4 改写历史）+ 反模式 ×18；1.9.0 修读侧 **fail-open 家族**（维度裁决改 PASS/FAIL/**SKIP** 三态、`gate-check --quality` 无 Q 行/无证据一律不可关门、G0/G2 由"文件存在"升级为"证据存在"）+ 新增 4 类机器漂移守卫（版本三锚点 / 配置入口唯一 / 绕过原子写 / 词表绑定判罚），首次校准即抓出 23 处词表残留；契约套件 17→**20 场景**（new 20/20 vs 旧版 20/20 缺陷复现）、聚合基准刷新 **87.5% vs 28.9%（delta +0.59）**、evals 10→13 条。详见 [10-技能进化记录.md](10-技能进化记录.md) §9.7/§9.8。
> iteration-6 续记（**M0-③ spike，无技能代码改动**）：验证「插件能否接续既有账本」这一承重假设——既有 56 条 **hash 56/56 复现**（唯一形式＝固定六字段键序 + `JSON.stringify`；字典序 0/56、去空白 1/56 均被否证），链 55/56（断点仅 genesis 且属历史形态），跨工作区机制已在 `src/host/security.ts` 就位。**R11 退场**；[05](05-数据结构与算法设计.md) §3.2 的旧规范化描述（`sortedKeys`/`no whitespace`/拼接 `prevHash`）**三个半句全被实测否证**并改正，新增 **INV-20**；canonical 形式冻结为契约场景 **K1**（字面 golden vector + 硬编码 hash），并以变异探针证明该守卫**可失败**（键序互换 → K1+F1 双红）。详见 [spike/ledger-canonical-form.md](spike/ledger-canonical-form.md)。
> iteration-7 续记（**M0-④ spike，无技能代码改动**）：进化引擎离线回放仿真 **判定 PASS**（不触发"降级为建议模式"）。规则层零越权：8/8 熔断条件有决定、自动修复仅限 CB3/CB4/CB8、破坏性动作不入任何授权带、升级需人类而降级可自动、补丁 keep/revert **4/4**、13 条决策 **13 条留痕**且沙盒链 valid。数据层三项 P0 确认：**①自主级变更无法审计**（incidents 声明 2 次 L4→L3，账本 0 条；边界：只能判"无法审计"，可能落在已裁剪前缀）**②cycle 身份只存在于自由文本 `detail`**（按文本归属造出 3 组"乱序"假象、按位置归属 0 组——**假象不是缺陷**）**③门禁事件与人类门事件分处两个载体**。新增 **INV-21**（身份结构化）/ **INV-22**（裁剪保留可审计路径）+ 风险 R23-R25。详见 [spike/evolution-replay-simulation.md](spike/evolution-replay-simulation.md)。
> iteration-8 续记（**M0-② spike，无技能代码改动**）：**推翻"宿主 LLM 服务面按幻影对待"**——`ctx.llm` 双向证据齐备（静态 `constructor(ctx){super(ctx,"llm")}` @ `dsh-llm/lib/index.js:1800-1802`；base bundle 装配行 @ asar `dsh-base/cordis.patch.yml:34-35`；三个官方真实调用点 @ `dsh-session-title-llm:226`/`dsh-compaction-basic:323`/`dsh-experimental-auto-review:415`）。全 asar 扫描 12967 条目 → 50 处命中、11 处调用点级、12 个官方包。**判定 GO，F5 不再 DEFER**；三条形态约束入册：**宿主不保证结构化输出**（闭合协议+本地严格校验+失败即 `doubt`）、**`purpose` 是闭合枚举不可扩展**、**`'llm'` 不进硬 `inject`**（否则无适配器宿主上整个插件变死）。新增 **F39 / INV-23 / INV-24 / B11 / R-26 / R-27**，**R1 关闭**。详见 [spike/host-llm-service.md](spike/host-llm-service.md)。
> iteration-9 续记（**M0-① 插件主线第一个切片，工程落点 `dsh-anic/`**）：M0 四项全部完成。按用户三次方向纠正落成**独立工程 `dsh-anic/`**（技能插件不放项目插件里；`.anic-skill-evo/` 只放评测产物；命名符合 DSH 规范）——`conversation.view` 顶层标签 `ANIC` 渲染**真实** `.cycles/`（138 节点/164 边/57 cycles/56 账本事件/L4，快照生成器只读结构化字段＝INV-21 合规），react 之外零 bundle 依赖。**机制验证 17/17 PASS**（stub 复现 `__ModuleLoader__.load` 契约全链）；typecheck/build/`node --check` 全绿；**父插件 `src/` 零变更**。真实宿主 J0 六步协议在 [dsh-anic/README.md](../../dsh-anic/README.md)。**已按用户要求完成网页端安装**（web profile `link:` + bundles 追加 + `pnpm install`，Junction 与 served-bundle 语法均验证），并落地**热加载/热更新三层**：`build:watch` bundle 级热更新、宿主路由 `GET /anic/api/workflow-snapshot` 数据热更新（与嵌入快照共用唯一构建器，失败如实回退）、kill-switch/遥测热卸载；机制冒烟扩至 19/19，typecheck 0 错误。待用户重启宿主跑 J0。详见 [spike/conversation-view-tab.md](spike/conversation-view-tab.md)。
>
> iteration-9 增补（**测试体系，用户 m03040**）：`dsh-anic/` 建立五层测试金字塔——L1 DSH 规范符合性门 C1-C12（`validate-dsh.mjs`，依据 07 §2 asar 取证每条注出处）、L2 单元 21 例（snapshotCore/snapshotRoute：数值序/降级/disposer/404/500/解析链/effect 承接）、L3 源码契约守卫 15 例（register 原型形态守卫区分「未绑定提取=禁」与「捕获 disposer=必需」；反向自检+样例拼接构造）、L4 机制冒烟 19 断言、L5 真实宿主探针 `j0-probe.mjs`（CDP 六判据，**绝不启停宿主**）。编排器 `run-tests.mjs` fail-fast；测试宿主脚本 `start-dsh-test.mjs` 派生自父工程 895 行实测版（PID/日志隔离为 `dsh-anic-*`、安装锚点遮蔽预检针对 dsh-anic、与父脚本共用 3080 互斥）。终态：**validate 12/12 + vitest 36/36 + smoke 19/19 + typecheck 0 错误**。
>
> iteration-9 增补 2（**双端同步安装，用户 m03165**）：桌面 profile（`%USERPROFILE%\.dsh\profiles\desktop\`，18 bundle 的 0.4.x 生态）完成同款 `link:` 安装 + bundles 追加 + `pnpm install`；Junction / served-bundle 语法 / locale-icon 可达 / 18 既有 bundle 行逐一解析全部验证（4 个 `@deepseek-ai/*` 行为宿主内建，从安装锚点解析，与安装前一致）。dsh-anic 零 `@deepseek-ai/dsh*` peer ⇒ 兼容门必过；桌面端 = 0.4.x 宿主首挂载，即 07 §3 unknown 宿主姿态实测场。两端生效均需重启对应宿主。
>
> iteration-10 续记（**插件功能设计，用户 m03199**）：新增 **[11-插件功能设计](11-插件功能设计-配置-日志-白盒-响应式.md)**——在已有可视化之上设计五组功能 + 一个自举闭环：**C-\* 三层配置单 loader**（宿主 bundle config / 技能域 `.cycles/config.yml` 唯一规范入口 / 客户端视图偏好）、**L-\* 日志错误管理**（错误分类学四域类型化 + scoped logger + 客户端遥测环形缓冲与诊断面板；**诊断域隔离**：插件错误永不写 `.cycles/`）、**W-\* 步骤流程白盒透明化**（StepTrace 四源投影：声明图 × 节点状态 × 账本裁决 × 工件元数据；cycle 归属只用位置法、启发式字段必须标注=INV-27）、**R-\* 响应式动态收纳**（断点驱动分区收纳 + 图内簇折叠 + CSS 回退纪律）、**V-\* 可视化动态优化**（If-None-Match 条件请求复用父工程 etagGuard 全套结论 + 门禁/控制带数据驱动着色 + FAIL 脉冲）、**B-\* 自举闭环**（技能评估插件=写侧：G0-G3 ⇔ 测试金字塔 L1-L5、benchmark ⇔ 评估维；插件=技能插件化=读侧：ANIC 标签渲染插件自己的 `.cycles/`；边界纪律防自指事故）。新增 **INV-25/26/27** 与 **R-28/29/30**，里程碑映射进 04 §2（M1 吸收 C/L/W 投影/R/V-1/V-2/B 协议）。
>
> iteration-11 续记（**六自能力 + 插件开发规范，用户 m03247**）：新增 **[12-自进化插件标准与六自能力架构](12-自进化插件标准与六自能力架构.md)**——①**六自能力架构**：自评审（构建/运行/评审三层证据化裁决 + Runtime INV Probes + INV-28「无证据的自主动作在 L≥3 被拒绝并记 SELF_REFUSAL」）、自进化（参数域限配置与参数 + 代码自进化只产 tech-debt 不自我改码 + 技能协同进化协议）、自举（`anic_self_init` 自己吃自己的狗粮，第一份输入=设计遗留项）、自迭代（CycleRunner 七步无人值守、门禁是唯一暂停点）、自优化（性能/质量/体验三维度量闭环）、全自主（授权带 + 8 熔断 + HITL 双路：`userQuestionPanels`（gen2-only 探测）→批准卡降级→账本回写）；②**独立性宪章 6 条**：dsh-anic 是独立工程，源码零依赖父项目（G-IND 守卫）、构建自包含（M2-a 退出判据，当前借用父 node_modules 是过渡=TD-A1）、可迁移、文档自持、宿主假设最小化、父项目只是验证场；③**技能插件开发规范**：模块化（L0-L5 铁律 + 特性模块制 + 单实现原则 + barrel 纪律）、扩展性（五注册表 Dimension/Gate/Projection/Evaluator/PanelSection + 对外稳定 API v0 = HTTP 路由契约与账本只读投影 + 声明合并事件外发）、守卫族 G-DEP/G-FEAT/G-SINGLE/G-IND/G-REG（三条守卫纪律继承）。R-31..33。
>
> iteration-12 续记（**智能体编排 + 功能开关，用户 m03297**）：新增 **[13-智能体编排与功能开关体系](13-智能体编排与功能开关体系.md)**——①**A 族 子代理与 agents 配置**：插件发三样东西——**资产**（`assets/agents/` 五门角色卡：gate/systemPrompt/toolsAllowlist/autonomyBand/outputContract/escalation，自举复制到 `.cycles/agents/` 可覆盖、加载即 schema 校验）、**配方**（`agents/orchestration.md` + 任务板模板：Team Lead 按门派 3 角色子代理、真 LLM 替代关键词计数、失败即 `doubt`、门禁不自动通过）、**执行面**（`anic_*` 工具 = DSH 任何会话/子代理调用插件的最低保证路径 + HTTP 面）；**诚实前提**：agent preset 注册是宿主/部署概念，未发现插件注册 API，不发明（双向证据纪律）；②**F 族 功能与流程独立开关**：三层开关（用户 prefs > 工作区 config.yml anic 段 > 部署 bundle config，越具体越优先、来源层可观测）× 9 个 flow 开关（workflowTab/stepTrace/diagnostics/approvals/autoRefresh/gateRecord/budgetEnforce/selfInit/agentsOrchestration），每个开关声明**关闭形态契约**（关闭=unregister/隐藏/响亮禁用响应 + `flow-disabled` 遥测，重开即热重注册）；**核心链路不可关**（标签壳+快照路由+只读工具不在可关清单，INV-29）；**INV-30 全开关可观测**（诊断面板列出每个开关的生效值/来源层/关闭时间）；守卫 **G-TOGGLE**（特性模块必须注册开关并声明关闭形态）；R-34 角色卡漂移/R-35 组合爆炸（契约化关闭形态+抽样组合矩阵）/R-36 编排成本（Tier-1 优先+每 cycle 子代理预算）。
> iteration-13 续记（**M1 全功能面实现，用户 m03330 确认 + m03367 模块化纪律**）：dsh-anic M1 落盘——四路由（`/anic/api/workflow-snapshot` + `/anic/api/step-trace` + `/anic/api/self-check` + `/anic/self/init`）+ 三面板区（stepTrace/diagnostics/prefs）+ 九开关三层合并（`shared/flows.ts` INV-29）+ 十五 agent 资产卡（`assets/agents/{gate}-{role}.json` INV-23）+ 配置唯一 loader（`host/config.ts` INV-25）+ scoped logger（`host/logger.ts`）+ 四域错误码（`shared/errors.ts`）+ StepTrace 四源投影（`shared/stepTrace.ts` INV-27 位置法归属）。模块化纪律：单文件 ≤~250 行 / 一域一文件 / 路由按端点拆 / 特性模块制。验证全绿：规范门 12/12 · vitest 36/36 · 冒烟 19/19 · typecheck 0/0 · build OK。双端 link: 安装完成（web + desktop profile）。
> v1.5 修订（进化轮，用户 m00759 要求用 skill-creator 方法论实操进化技能）：按 09 的设计对技能本体做了第一轮结构进化（v1.6.0→**v1.7.0**）——新增 `scripts/lib/` 五个共享库（唯一配置入口/维度注册表/账本唯一实现/数值序 cycle/原子写），修 S-1/S-5/S-6/S-7/S-11 + cycle-N 字典序，文档面词表统一（S-2/S-10）。**完整 A/B 评测**：11 场景契约断言新版 11/11 vs 旧版真实通过 3/11；两个独立 subagent 黑盒端到端 6/8 vs 3/7；聚合基准 87.5% vs 35.1%（delta +0.52）；静态评审页 `.anic-skill-evo/review.html`；双镜像 62 文件逐字节相等。e2e 另暴露 12 项新缺陷（G1 模板自陷、账本无自动写者、countWords 中文偏差等）= iteration-2 候选。全程记录见 **[10-技能进化记录.md](10-技能进化记录.md)**；本轮只动技能本体与 `.anic-skill-evo/`，docs/anic/ 文档族未改设计结论。

---

## 0. 一句话结论（TL;DR）

**可行，且有独特杠杆。** 技能的流程骨架（有向图工作流 + 门禁账本 + 评估维度）今天已经是"脚本 + YAML/JSON 文件"形态，天然可迁移为 DSH 插件的 Host 服务面；`references/graph.md` 证明技能的工作流**本来就是机器可读有向图**（`workflow-graph.yaml`），任何项目的工作流都能用它声明并可视化。三个必须补齐的缺口：**① 所有"评审/修复/多智能体"环节都是纯正则启发式，没有 LLM 参与**（自评审是拟真）；**② 自进化要素（信任分、retrospectives）是"只写不读"的死端，band-history 虽被 `org-status` 读取却不在自动化链上**（v1.2 更正口径，证据见 01 §2.7 P-2）——插件化的第二价值就是把它们接成闭环：**信任分驱动自主级动态升降、复盘驱动过程补丁、补丁带度量与自动回退**；**③ 每次调用都往 `.cycles/` 无条件堆产物**——实测 57 个 cycle 目录已产生 264 文件 / 1.55 MB / 12 个空目录，且单文件数组账本在 10k 条时需累计写 44.7 GB，**必须在首个真实 cycle 之前把账本形状一次定死**（08 文档）。**复评轮（09 文档）进一步收紧了前置条件**：技能的 16 个脚本不是"各自独立的模块"，而是"各自独立的程序"——配置路径、维度词表、路径常量在每个文件里各写一遍，且**没有任何执行契约测试**（`evals/evals.json` 只有 5 条 prompt 触发评测、`"files": []`）。后果已经发生：3 个核心脚本读的配置文件名 `init-workflow` 从不创建（`gate-check` 直接 `exit(1)`；`eval-runner` 读不到 `build_cmd`/`lint_cmd` 于是**构建与静态检查维度恒 PASS**），自主级降级用正则改写 YAML 且**降级记录无条件落盘**（可能"没降级但记录说降了"）。因此结论从"可以插件化"变为"**可以插件化，但必须先立契约层，不能逐脚本搬运**"。

## 1. 通用性声明（本插件是什么 / 不是什么）

- **是**：一个装进 DSH profile 的通用插件。用户在任何工作区（任意语言/技术栈/是否 git 仓库）打开 DSH，即可 `init` 出该项目的 `.cycles/` 工作流并开始运行。所有项目状态都在**工作区内**（`.cycles/` 天然 per-workspace），插件本身无项目硬编码。
- **不是**：不是 dsh-codegraph-visualizer 的伴生件，不预设 Node/pnpm/React 技术栈（build/test/lint 命令来自项目 config，init 向导可从 package.json 等启发式探测，探测不到就手填）。
- **关系**：`D:\Projects\TraeProjects\dsh-codegraph-visualizer` 是**第一个重度用户与验证场**（57 个 cycle 目录的真实工件 = 最好的测试数据），仅此而已。

## 2. 文档地图

| 文档 | 内容 | 读者 |
|---|---|---|
| [01-可行性研究.md](01-可行性研究.md) | 技能现状取证（含**完善度缺口清单**）→ DSH 宿主面事实（**§3.3 LLM 服务面已由 M0-② 证实**）→ 差距分析（GAP-1..10，含进化/通用性/产物规模/结构契约）→ **复评补充（S-1..S-11 结构性缺陷）** → 分维度裁决 | 决策者、架构师 |
| [02-需求分析.md](02-需求分析.md) | 用户/旅程/功能需求（F1-F39，含动态自主进化族 F16-F22、产物规模族 F23-F30、**结构契约族 F31-F38**、**LLM 接入族 F39**）/非功能（N1-N12）/负需求（X1-X10）/验收（A1-A10） | 产品、开发 |
| [03-架构设计草案.md](03-架构设计草案.md) | 通用插件分层（**模块表含 L0-L5 层级归属**）、服务面、**§6 LLM 评审引擎（宿主面已证实 + 编码级契约表）**、信任模型与进化引擎（补丁生命周期/宪法 7 条款/防抖）、账本分段布局与产物治理模块、多代兼容 | 架构师、开发 |
| [04-开发计划与里程碑.md](04-开发计划与里程碑.md) | M0（**②③④ 已完成，仅剩 ①**）/ **M1（契约层+端口薄壳）** / **M2-a + M2-b** / M3 / M4 / **M5 + M5-a** / M6 里程碑、验收门、风险登记册（R1-R25 + R-26/R-27） | 项目管理、开发 |
| [05-数据结构与算法设计.md](05-数据结构与算法设计.md) | 工作流图 CSR、账本哈希链与**已实测钉死的规范化形式（固定六字段键序 + `JSON.stringify`，56/56 复现，golden vector 入 K1）**、分段布局与 v2 记录形状、状态投影 fold、信任滞回、补丁状态机、并发一致性（含幂等键）、**INV-1..24 不变量**、schema 迁移、复杂度与性能预算 | 开发、评审者 |
| [06-生命周期状态机与引擎研究.md](06-生命周期状态机与引擎研究.md) | Cordis fiber 生命周期、插槽树生命周期单元、三层嵌套状态机、八类引擎的存活期（**ReviewEngine 依赖 `ctx.llm`，M0-② 已证实**）、fiber×状态机竞态 | 架构师、开发 |
| [07-DSH开发规范与破坏性变更适配.md](07-DSH开发规范与破坏性变更适配.md) | 九条红线、ANIC 实际用到的 DSH 能力逐条附证据（**新增 `ctx.llm` 双向证据行**）、破坏性变更**十一类**（B1-B11，含 **B11 LLM 契约变更**）与防御、unknown 宿主安全映射、升级 checklist | 架构师、升级负责人 |
| [08-产物规模与生命周期治理.md](08-产物规模与生命周期治理.md) | 「多次调用产生大量产物」的实测取证与十种失效模式；分段只追加账本、证据外置+内容寻址、幂等键、索引+目录白名单、分层归档、存储预算、只读健康报告 | 开发、运维、评审者 |
| [09-结构优化与逻辑重构设计.md](09-结构优化与逻辑重构设计.md) | **复评轮**：11 项结构性缺陷（S-1..S-11，含 3 项 P0）与 5 个结构根因（R-A..R-E）；目标结构 **L0-L5 单向依赖分层 + 七条结构原则**；逻辑级优化（评审两级化 + **§6.1 宿主现实四条编码规则**、信任派生化、门禁完整化、失败响亮化）；INV-10..24 与 GUARD-1..6；M1-M6 迁移映射 | 架构师、开发、评审者 |
| [10-技能进化记录.md](10-技能进化记录.md) | **进化轮实操记录**：skill-creator 七步流程对技能本体 v1.6→v1.7.0→**v1.9.0** 的五轮结构进化与收口（lib/ 六文件、十余脚本改造、文档/评测/机器三面统一；1.8.3 iteration-4 修账本级缺陷：归档删链 + H4 改历史，新增 lib/tasks.mjs；1.9.0 iteration-5 修读侧 fail-open 家族：维度三态裁决 + 门禁无证据不可关门 + `quick-validate` 四类漂移机器守卫，词表漂移 23 处清零）；**iteration-6/7/8 = M0-③/④/② 三个 spike（均无技能代码改动：账本 canonical 56/56 + K1 冻结锁；进化回放 PASS；宿主 LLM 服务面 GO）**；契约 A/B 11→**21 场景**（new 21/21 vs 旧版 21/21 缺陷复现）、双 subagent 端到端 A/B（6/8 vs 3/7）、聚合基准（87.5% vs 28.9%，+0.59）；e2e 12 项发现全部处置（10 修复 / 1 撤销归因 / N-10 脚本侧落地 + 语义评审留插件层） | 评审者、维护者 |
| [spike/ledger-canonical-form.md](spike/ledger-canonical-form.md) | **M0-③ spike 报告（已完成，GO）**：既有 56 条账本 hash **56/56 复现**（唯一形式＝固定六字段键序 + `JSON.stringify`）+ 五种候选形式的否证 + 链 55/56（genesis 断点是历史形态）+ golden vector + **adoption 接续语义**（三选项与推荐）+ 跨工作区机制证据（`src/host/security.ts`）+ R11 退场 | 架构师、开发 |
| [spike/evolution-replay-simulation.md](spike/evolution-replay-simulation.md) | **M0-④ spike 报告（已完成，PASS）**：Tier A 真实回放（门禁 14/14 组严格有序、canonical 56/56、**自主级变更无法审计**、**cycle 身份只在自由文本里**）与 Tier B 规则验证（8 熔断、授权带、非对称转移、滞回、补丁 keep/revert 4/4、13/13 留痕且沙盒链 valid）+ R23-R25 | 架构师、评审者 |
| [11-插件功能设计-配置-日志-白盒-响应式.md](11-插件功能设计-配置-日志-白盒-响应式.md) | **dsh-anic 功能设计（用户 m03199）**：三层配置单 loader（C-*）· 错误分类学与诊断域隔离（L-*，插件错误永不写 `.cycles/`）· StepTrace 四源投影与位置法归属（W-*，INV-21）· 断点驱动收纳布局（R-*，CSS 回退纪律）· 条件请求+数据驱动着色（V-*，复用 etagGuard 结论）· **自举闭环 B-\***（技能评估插件=写侧，插件=技能插件化=读侧，边界纪律与评估协议）；INV-25..27 + R-28..30；里程碑映射 §8 | 架构师、开发 |
| [12-自进化插件标准与六自能力架构.md](12-自进化插件标准与六自能力架构.md) | **六自能力架构 × 技能插件开发规范 × 独立性宪章（用户 m03247）**：自评审/自进化/自举/自迭代/自优化/全自主六能力总表与逐项设计（Runtime INV Probes、`anic_self_init`、CycleRunner、度量闭环、授权带+HITL DSH 原生形态、**INV-28 运行时自证/SELF_REFUSAL**）；**独立性宪章 6 条**（源码零依赖父项目、构建自包含、可迁移、文档自持、宿主假设最小化、父=验证场）；**技能插件开发规范**（模块化 L0-L5+特性模块制+单实现原则、扩展性五注册表+对外稳定 API v0+事件外发、守卫族 G-DEP/G-FEAT/G-SINGLE/G-IND/G-REG）；R-31..33 | 架构师、评审者 |
| [13-智能体编排与功能开关体系.md](13-智能体编排与功能开关体系.md) | **智能体编排（A 族）× 功能开关（F 族）（用户 m03297）**：① **agent 资产卡**（5 门角色卡：systemPrompt/toolsAllowlist/autonomyBand/outputContract/escalation，出厂卡可被工作区卡覆盖）+ **DSH 三条调用路径**（anic_* 工具面=最低保证 / 编排配方=每门 3 角色真 LLM 子代理替代关键词计数 / HTTP 面）+ 诚实前提（agent preset 注册是宿主概念，插件不发明的双向证据）；② **三层开关**（用户 prefs > 工作区 config.yml anic 段 > 部署 bundle config）+ 9 个 flow 开关的**关闭形态契约**（关闭=降级与 unregister，不是拆除）+ **核心链路不可关**；INV-29/30 + G-TOGGLE + R-34..36 | 架构师、开发 |
| [spike/host-llm-service.md](spike/host-llm-service.md) | **M0-② spike 报告（已完成，GO）**：`ctx.llm` **双向证据**（静态 `super(ctx,"llm")` + base bundle 装配行 + 3 个官方真实调用点 + 全 asar 扫描 50 命中/11 调用点级/12 包）；编码级契约（`GenerateOptions` 字段、错误码表、`LlmRuntime` 方法面、`llm/stream` waterfall、`purpose` 闭合）；三个可复制范式（fail-closed 决策协议 / 超时+留痕+成对路由 / 缓存复用摘要）；接入形态与降级矩阵（不进硬 `inject`）+ R-26/R-27 | 架构师、开发 |
| [spike/conversation-view-tab.md](spike/conversation-view-tab.md) | **M0-① spike 报告（机制级 PASS，真实宿主 J0 待验证）**：独立工程 `dsh-anic/` 第一切片（`conversation.view` 标签 `ANIC` 渲染真实 `.cycles/` 138 节点/164 边）；机制冒烟 17/17（`__ModuleLoader__.load` 契约全链、dispose→重进、kill-switch、遥测与快照一致）；两个冒烟器缺陷（函数组件/数组层不展开）与 J0 协议六步 | 架构师、开发、评审者 |
| [14-自举闭环与跨项目技能调用架构.md](14-自举闭环与跨项目技能调用架构.md) | **自举闭环 + 跨项目技能调用 + DSH 工具注册 + 结构优化（用户 m04066）**：§0 现状评估（技能 v1.9.0 + 插件 v0.2.0 + 3 核心缺口 G-BOOT/G-CROSS/G-TOOL）→ §1 自举状态机 + .cycles/self-bootstrap.json → §2 跨项目 API（workspace 参数 + 脚本白名单 + 路径遍历防护）→ §3 DSH 工具注册（inject 扩展 + 6 工具）→ §4 结构优化（26 路由→6 域分区）→ §5 M7-M10 里程碑 → §6 R-37..42 | 架构师、开发 |
| [15-插件化评审与独立性连通性分析.md](15-插件化评审与独立性连通性分析.md) | **插件化评审（用户 m04204）**：独立性分析（源码零依赖 ✅ + 两层架构）· 安装模型（双体分离 + 方案 C 混合内联）· 插件化覆盖（8 原生 + 5 脚本代理 + 3 未实现 + MCP 4/15）· 透明性缺口 G-T1..T6 · 连通性缺口 G-C1..C6 · 改进路线图 M11-M15 | 评审者、架构师 |

## 3. 证据来源（全部为本机实测/源码取证，无推测）

- 技能本体：`.dsh/skills/ai-native-iteration-cycle/SKILL.md`（297 行）、`scripts/` 16 个 .mjs、`references/` 15 篇（尤其 `graph.md` 128 行）。
- **复评静态取证（09 文档 §1，可复现命令表）**：`rg cycle-config` 全技能 4 命中且只在 3 个脚本 / 文档中 0 命中；`eval-runner.mjs:14-21` 与 `references/evaluation.md:10-141` 的 E1-E8 为两套互不重叠词表；`org-status.mjs:590-597` 的 `content.replace(/autonomy_level:\s*L4/, …)` 与 `:606` 无条件事故记录；`evals/evals.json` 5 条 `files: []`；`multi-agent-gate.mjs:417-422` 以 `existsSync(ledger)` 充当 "verified"。全部为逐行实测行号。
- DSH API 权威基线：`docs/research/dsh-0.2.0-插件API权威基线.md`（§1-§7 门禁结论）。
- **M0-② 宿主 LLM 面取证（[spike/host-llm-service.md](spike/host-llm-service.md) §1，可复现）**：静态提供 `dsh-llm/lib/index.js:1800-1802`（`super(ctx,"llm")`）+ `lib/types/index.d.ts:28-31`；装配 `@deepseek-ai/dsh-base/cordis.patch.yml:34-35`（适配器 `:525-529`）；真实调用点 `dsh-session-title-llm:226`、`dsh-compaction-basic:323`、`dsh-experimental-auto-review:415`（其 `inject` 声明 `:45-51`）；契约 `GenerateOptions` `types.d.ts:489-530`（`purpose` 闭合枚举 `:530`）；错误码 `lib/types/error.d.ts:18/20/22/32/40` + `lib/index.js:2238`（`NO_ADAPTER`）；自建 asar 扫描器/抽取器（`.anic-skill-evo/spike/asar-scan-llm.mjs`、`asar-extract.mjs`）产出 12967 条目 / 8507 文件 / 50 命中 / 11 调用点级。
- 多代兼容矩阵：`docs/research/dsh-多代API规范差异与兼容矩阵.md`（§1-§11，cycle-83 取证）。
- 宿主面先例：`src/index.ts`（169 行）、`src/tools.ts:4`、`cordis.patch.yml`、`package.json`。
- 真实运行痕迹：`.cycles/`（**实测 57 个 cycle 目录、编号至 cycle-91 非连续**、config.yml、band-history.json、incidents、gates/ 账本 **56 条**、retrospectives、tech-debt）。
- **口径说明**：本文档族多处写"76-cycle 量级/历史数据"，指**本仓库真实工件的规模口径**（57 个 cycle 目录、56 条账本记录、单 cycle 八件套 27–81 KB）；该称呼沿用技能自身文档的编号习惯，不代表现存 76 个完整 cycle。规模结论的绝对数字以 [08](08-产物规模与生命周期治理.md) §1 的实测表为准。

## 4. 核心名词表

| 名词 | 含义 |
|---|---|
| ANIC | AI-Native Iteration Cycle，AI 原生迭代循环（研究对象技能与目标插件共用名） |
| 宏观循环 / 微观迭代 | Plan→Design→Build→Test→Deploy→Maintain × 评估→规划→拆测→验证→修复→门禁→复盘 |
| E1-E8 / Q1-Q8 | 评估八维 / 质量评审八维（SKILL.md、references/evaluation.md） |
| G0-G3 | 收敛门：G0 评估基线(Q1+Q5) → G1 任务清零(Q7) → G2 测试零错(Q2) → G3 构建零败(Q3+Q4) |
| 人类门（Gates） | 唯一不可跳过的判断点；**宪法约束：任何进化（含 L4）不得移除** |
| Play / Artifact / Gate / Trigger | graph.md 四类图节点：工作单元 / 产物 / 人类判断点 / 触发边 |
| `workflow-graph.yaml` | 机器可读工作流有向图（可视化第一数据源；过程补丁的修改对象） |
| `gates/ledger.json` | 门禁账本（哈希链）；**进化补丁的应用记录也走同一账本**（单一真相） |
| L1-L4 | 自主级：L1 辅助 → L2 半自动 → L3 监督自主 → L4 全自主（仅事后审计） |
| **动态自主进化** | 信任分驱动自主级在授权带内升降 + 复盘驱动过程补丁 + 补丁带度量与自动回退（F16-F22） |
| 信任模型（TrustModel） | 按门角色累积的信任分（种子=multi-agent-gate trustScore），带滞回与非对称升降 |
| 过程补丁（Process Patch） | 结构化进化提案：{假设, 变更(图/阈值/维度), 度量计划, 有效期}；经账本+元门应用，可一键回退 |
| 安全带（Safe Bands） | 预授权的阈值/配置变化区间；带内可自动应用（L4 事后审计），带外/结构性变更必须人类门 |
| 8 熔断条件 | 先修复后降级：连续 3 次修复失败/门禁存疑/真实用户数据无隔离/破坏性不可回滚/性能 1 轮未恢复/人类要求/会话>24h 或上下文>85%/重试>10 或熔断>3。**宪法约束：熔断条件本身不可被进化修改** |
| HITL | H1-H4 人类在环审计（敏感文件/真实数据/破坏性操作/权限提升） |
| 验证场 | 本仓库（dsh-codegraph-visualizer）：插件的首个狗粮项目与测试数据源，非运行时依赖 |
| **产物规模** | **账本分段只追加**：`.cycles/gates/head.json`（chainHead/segCount/entryCount/checkpointSeq）+ `seg-NNNNNN.jsonl`（段满 1000 条开新段，链跨段连续）；追加 O(1)，与总量无关（F23） |
| **幂等键** | 每条 v2 账本记录带 `requestId = <宿主 runId>-<序号>`；宿主崩溃重投 / 事件重发 / 用户双击都产生重复调用，`Ledger.append` 内查重——重复即污染（F25） |
| **unmanaged** | `.cycles/` 目录白名单之外的一切（实测根目录混有 probe-*.mjs、commit-*.txt、dsh-asar/、j0probe/ 等用户研究残留）；**永不索引、永不归档、永不删除**（F26 / R18） |
| **归档** | 分层只移动不删除（热 20 / 温 / 冷 >60 cycle 或 >90 天）+ `archive/index.jsonl`；链与归档策略完全解耦（F27） |
| **S-n（结构缺陷）** | 09 文档的结构性缺陷编号 S-1..S-11（与 08 的规模失效模式 P-S1..P-S10、01 的能力缺口 GAP-1..9 是三个不同维度：GAP 说"缺什么功能"，S 说"现有功能的骨架错在哪"） |
| **R-A..R-E（结构根因）** | 多源定义 / 正则即接口 / 状态多副本 / 派生被当真相源 / 安全机制无执行契约——11 项 S 缺陷的共同根因 |
| **L0-L5（分层）** | 目标结构的单向依赖分层：L0 contracts（冻结数据）→ L1 core（纯函数）→ L2 store（唯一写者）→ L3 engine（编排）→ L4 ports（DSH/CLI/MCP 适配）→ L5 projections（纯投影） |
| **效果即记录（Post-Verify）** | 结构原则 7：安全动作必须写入后回读断言，`observed !== intent` 即失败且**不得**写"已完成"记录（S-7 的结构性解药） |
| **`ctx.llm` / `LlmRuntime`** | 宿主 LLM 服务（服务键 `llm`），**M0-② 双向证据已证实**：`stream({provider, model, messages, system, temperature, signal})` 返回 token 级流，`listProviders()` 同步可用。**形态约束**：不进硬 `inject`、`purpose` 闭合不可扩展、错误按码降级（F39 / INV-24） |
| **Tier-1 / Tier-2 评审** | Tier-1 = L1 纯函数确定性检查（产出证据 id）；Tier-2 = 经 `ctx.llm` 的语义评审（只处理 Tier-1 判不了的），**必须携带注入集合内的 `evidenceIds`**，否则无效（09 §6.1 / INV-23） |
| **`doubt`（三态）** | 评审第三态：合法但未决。规则是**"没有证据 ≠ 通过"**——模型沉默、结构非法、证据越界一律 `doubt`，门禁**不得**据此关门（INV-23 / R-26） |

## 5. 与既有文档的关系

- 不重复 `docs/research/` 两篇基线研究，只引用其结论（标注章节号）。
- 与 `docs/评估评审研究开发体系.md`（7 维框架）的关系：E1-E8/Q1-Q8 与该框架同构；插件化后 Q 维由 LLM 评审引擎实现（F5）——**M0-② 已证实宿主 `ctx.llm` 可用**（原按幻影对待的判定被推翻，见 [spike/host-llm-service.md](spike/host-llm-service.md)），且**维度/权重本身可进化**（F18）。
- 08 文档的实测数据来自本仓库 `.cycles/` 真实目录（`pwsh` 测量），所以本文档族里的规模结论对本仓库成立；其他项目的绝对值不同，但**失效模式与形状判据与项目无关**（这是本插件通用性的一部分）。
- 09 文档与 03 文档是**约束关系**而非并列关系：03 按功能域分模块（runtime/evolve/init/tools/routes/llm/shared），09 按依赖方向分层（L0-L5）；09 的 L0-L5 是 03 模块表的**层级归属约束**（runtime→L2/L3、evolve 判定→L1/应用→L3、shared→L0、tools/routes→L4）。
- 三个 spike 报告（M0-②/③/④）是**宿主面事实的最终来源**：文档族中的 LLM 契约以 [spike/host-llm-service.md](spike/host-llm-service.md) 为准，账本规范化形式以 [spike/ledger-canonical-form.md](spike/ledger-canonical-form.md) 为准，护栏在历史数据上的表现以 [spike/evolution-replay-simulation.md](spike/evolution-replay-simulation.md) 为准；三者**任一被实测推翻，相关文档必须同步修订**（复现判据见各报告末节）。
