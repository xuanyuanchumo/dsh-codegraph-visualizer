# ANIC 插件：DSH 开发规范、API 契约与破坏性变更适配

> 文档族：`docs/anic/`（导航见 [README.md](README.md)）· 版本 v1.2 · 2026-10-13
> 定位：把"要用哪些 DSH 能力""这些能力坏了怎么办""什么算破坏性变更"写成可执行清单——本文是 ANIC 的**宿主契约文档**，也是未来 DSH 升级时逐条比对的 checklist。
> v1.2 修订（M0-② spike）：§2.3 **新增 `ctx.llm` 能力行**（双向证据已证实，附静态提供 + base bundle 装配 + 3 个官方调用点）并写明形态约束（不进硬 `inject`、`purpose` 闭合不可扩展、错误按码分派）；§3 新增 **B11 LLM 契约变更**。证据见 [spike/host-llm-service.md](spike/host-llm-service.md)。
> 证据来源：`docs/research/dsh-0.2.0-插件API权威基线.md`（§1-§7，含 asar 内 `文件:行号` 逐条取证）、`docs/research/dsh-多代API规范差异与兼容矩阵.md`（§2-§7）、`docs/research/dsh-upgrade-research-report.md`（§2.2-§2.5/§3.1-§3.4/§7.1-§7.4）、本仓库 `src/` 实测。

---

## 1. 九条开发红线（DSH 规范合规，升级报告 §3.4）

| # | 红线 | 违规后果 | ANIC 合规做法（具体到代码形态） |
|---|---|---|---|
| R1 | 注册即 effect | 泄漏计时器/句柄，卸载后仍在跑 | 所有 `ctx.tools.register` / `ctx.webServer.register` / `ctx.slots.inject` / `ctx.on` 在 `ctx.effect` 内；**每个返回值都是 disposer，一个都不能丢** |
| R2 | waterfall 委托 | 吞错，调用方看不到失败 | 工具链逐级委托（anic 工具 → MCP 垫片 → 启发式），每级**显式透传错误**，不静默 fallback |
| R3 | Branded ID | NodeId/GateId/CycleId 互相赋值，跨边界串味 | `NodeId`/`GateId`/`PatchId`/`RecordId`/`CycleId` 全部 branded type，构造点集中在解析边界（05 文档 §2.1） |
| R4 | 声明合并事件 | 事件名冲突，监听串味 | `dsh-anic/*` 命名空间前缀 + `declare module` 扩展宿主事件类型 |
| R5 | ESM only | 宿主 ESM 加载 CJS 失败 | `"type": "module"` + 导入带 `.ts` 扩展 |
| R6 | Host/Client 隔离 | 客户端代码被打进宿主 bundle | `tsconfig.host.json` / `tsconfig.client.json` 分编译；共享类型/常量入 `shared/` 且**不引入 React/Node API** |
| R7 | 能力缝三角色 | 只有探测没有降级 = 半成品 | 每个能力位配齐：探测器（`ctx.get(key,false)`）+ 降级路径 + 诊断暴露（`/status` 的 compat 字段） |
| R8 | 配置显式化 | 魔法默认，换宿主行为突变 | `cordis.patch.yml` 显式 config（03 文档 §2.4）；每个默认值有注释说明为何是这个值 |
| R9 | disposer 不丢弃 | 幽灵注册、重复挂载 | 统一收集 + `typeof d === 'function'` 防御检查；**sync 与 async disposer 分数组管理**（06 文档 §1） |

## 2. ANIC 实际使用的 DSH 能力清单（逐条附契约与证据）

### 2.1 包清单契约

| 字段 | ANIC 取值 | 权威依据（基线 §2） |
|---|---|---|
| `name` / `version` | `dsh-anic` / 语义化 | `dsh-package-manifest` README:78-88 |
| `engines.node` | `>=22.19 \|\| >=24` | 随宿主要求，不硬编码项目假设 |
| `engines.dsh` | **实测未声明**（`dsh-anic/package.json` 的 `engines` 只有 `node`） | **纯声明，无人读取**；父工程 dsh-codegraph-visualizer 的对应值为 cycle-92 抬窗后的 `>=0.2.0-rc.2 <0.4.0` |
| `dsh.manifestVersion` | `1` | 纯声明，无人读取 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | 支持有序数组；launcher 按序应用为 bundle layer |
| `dsh.client.platform` | `'web'` | **非 web 即视为没有客户端半边**（`dsh-client-modules/lib/index.js:714`）；web 是规范值不是缺陷 |
| `dsh.client.inject` | 仅官方包：`dsh-client-ui-conversation` / `-renderer` / `-sidebar-right` | 仅接受官方包；第三方写进去即错。`inject` 是**模块图边**（激活顺序），不是 cordis 服务注入 |
| `exports["./client"]` | 必须存在 | 缺失即 throw（`dsh-client-modules:170-181`） |
| `icon` | ≤256KiB，`.svg/.png/.jpg/.jpeg/.webp` | 读自包顶层 `icon`，限安装目录内 |
| `locale/{en,zh}.json` | `{meta:{title,description}}` | en 为锚 |
| `peerDependencies` | **实测未声明**（`dsh-anic/package.json` 无该字段）⇒ 兼容门必过（`dsh-anic/README.md:71` 同此记载）。父工程参考：`@deepseek-ai/dsh*`: `^0.2.0-rc.2 \|\| ^0.3.0-rc.2`（cycle-92 抬窗），`@deepseek-ai/cordis`: `^4.0.1` / devDep `^4.0.4` | **唯一被强制执行的兼容门**（`dsh-app-boot` evaluatePluginCompatibility，semver includePrerelease）。无声明 = 无承诺 = 不设门 |

### 2.2 客户端槽位契约（ANIC 主入口）

- `conversation.view` 由 `conversation.session` 声明为 `{kind:'list', scope:'session'}`（`dsh-client-ui-conversation/lib/client.js:18209-18214`）；
- 顶层 shell 用 `slots.entries("conversation.view")` 枚举构建标签栏（同文件 `:17972-17984`）；`refreshViews` 订阅 `slots.subscribe("conversation.view", …)`，注册/注销都会刷新；
- **加载期校验违反即 throw**（`dsh-client-ui-slots/lib/index.js:163-200`）：
  - 槽位未声明 → `slot "${name}" is not declared (a parent entry's children table must declare it)`
  - `list` 缺 id → `list slot "${name}" requires options.id`
  - `list` id 重复 → `list slot "${name}" already has an entry with id "${id}"`
  - `single` 已占用 / `keyed` 缺 key / `chain` 无 `select` —— 各自对应报错；
- 官方注册范式（`dsh-cordis-client-runner/lib/client.js:3772`）：`ctx.slots.inject('conversation.view', () => ctx.slots.register({name,id,order,label}, component))`；
- 标签可见性硬规则：无 `id` 静默跳过；文案 = `label ?? id`；**部分标签受开发者工具门控**（trajectory 即如此）→ 验收 J0 时不得假定"所有标签同时存在"；
- **CRITICAL**：`SlotRegistry.register` 必须保持**原型方法**，不可改成实例箭头函数——cordis 服务代理在调用时绑定 `this.ctx`，把 effect+disposal 路由进调用方 fiber；箭头属性会把 `this` 冻结到根 ctx，静默破坏 per-plugin 清理（兼容矩阵 §7）。

### 2.3 宿主服务面（ANIC 使用的注入与注册）

| 能力 | 形态 | 返回 | ANIC 用途 |
|---|---|---|---|
| `ctx.effect(setup, label?)` | 副作用注册 | **同步** disposer | 主干注册通道（R1） |
| `ctx.plugin(child)` | 子 fiber | child fiber | **每 cycle 一个子 fiber**；熔断 = `fiber.dispose()` 递归回收（06 §1） |
| `ctx.on(event, cb)` | 订阅 | 自动清理 | 门禁事件 |
| `ctx.connection.rpc.handle(channel, handler)` | RPC 注册 | **async** disposer | 预留：与宿主前端的事件通道（未验证前不实现） |
| `ctx.connection.fetch.register(route)` | HTTP | **async** disposer | 预留（06 §1 推论 3：与 sync disposer 分开管理） |
| `ctx.tools.register(tool)` | 工具注册 | **同步** disposer | anic_* 工具面（先例：`src/index.ts:52-62`） |
| `ctx.webServer.register` | 路由注册 | 同步 disposer | HTTP 面（先例同文件） |
| `ctx.get(name, strict?)` | 服务查询 | — | **一律 `strict=false` + 调用点决策**；同步 apply() 内严格 get 会永久杀掉仍在 loading 的服务 |
| `ctx.emit(event, payload)` | 事件广播 | — | `dsh-anic/*`（先例：`codegraph-visualizer/prerequisite/status`） |
| **`ctx.llm`（`LlmRuntime`）** | **宿主 LLM 服务，M0-② 双向证据已证实** | `stream()` → `AsyncIterable<StreamChunk>`；`listProviders()` 同步 | Tier-2 语义评审（F5/F39）。**形态约束**：不进硬 `inject`（`ctx.get('llm', false)` 探测 + `ctx.inject(['llm'], cb)` 增量接入）；`GenerateOptions` 见 [spike](spike/host-llm-service.md) §2.3；`purpose` 为**闭合**枚举 `'compaction'\|'session-title'`（不可扩展）；错误按码分派降级 |

**`ctx.llm` 的证据（与"幻影服务"形成对照）**：静态 `constructor(ctx){super(ctx,"llm")}`（`@deepseek-ai/dsh-llm/lib/index.js:1800-1802`）+ base bundle 装配行（asar `@deepseek-ai/dsh-base/cordis.patch.yml:34-35`，适配器 `:525-529`）+ 三个官方真实调用点（`dsh-session-title-llm:226`、`dsh-compaction-basic:323`、`dsh-experimental-auto-review:415`）。**两边都有才算数**——只 README 提过、或只命名像，都按 B1 处理。

### 2.4 客户端插槽树（06 §2 复述，作为 ANIC 渲染面的落位图）

```
root
├─ sidebar { brand.mark, brand.name, panellist, footer.action, workspaces, settings }
├─ main → conversation.session
│         ├→ conversation.view                    ← ANIC 顶部标签
│         ├→ conversation.chat.node → tool.call.toolview
│         └→ conversation.session.header / composer / composer.bar
├─ plugins { item, bundle.config, row.config }
├─ rightbar.session → sidebar.right.pane.tab { +title / tab.guide / tab.menu.item }   ← gen2 增强位
└─ shell.overlay                                                          ← 熔断全屏警示（可选）
```

规则：**子插槽仅在父挂载时存在**——`conversation.view` 只在会话面板存活期间存在（06 §2 的设计约束来源）。

## 3. 破坏性变更分类学（ANIC 需要防御的变更类型）

| 类型 | DSH 侧实例（已实证） | ANIC 的暴露面 | 防御 |
|---|---|---|---|
| **B1 工具/服务移除** | 幻影服务 `remoteWebUI`/`spotlight`/`desktopProfiles` 在三棵树中零 provide + 零 ctx.get（兼容矩阵 §2.3） | 若 ANIC 静态声明依赖 → 永不执行的分支 | 只依赖 §2.2/§2.3 表中**实证存在**的面；其余走 R7 三角色 |
| **B2 代际新增** | gen2 新增 `codegraph_bootstrap`/`codegraph_incremental`（gen1 不存在） | ANIC 若直接调宿主工具 → gen1 崩 | 不调宿主业务工具；流程工具全自有。必须有则走 fallback 链（05/06 §5.1） |
| **B3 工具名变更** | `codegraphStatus` → `codegraph_status` 等 | ANIC 自有工具名不随宿主变 | 自有工具前缀 `anic_` 固定；但**若日后调宿主工具**必须走 `ApiCompatLayer` 映射 + fallback 链 |
| **B4 清单语义变更** | `client.inject` 由服务注入变为模块图边；非 `web` 即无客户端 | 高（ANIC 主入口在客户端） | client.inject 只列官方包；platform 恒 `'web'`；两者均有 manifest 契约测试（基线 §2.3 表） |
| **B5 槽位契约变更** | 槽位未声明 / list 缺 id / id 重复 → 加载期 throw | 高（标签是唯一入口） | 注册包 try/catch + warn 但**必须有运行时证据**（J0）；id 用插件全名避免与邻居冲突 |
| **B6 导出入口变更** | `exports["./client"]` 缺失即 throw | 高 | package.json 契约测试 + 发布物检查（M6-G） |
| **B7 disposer 语义变更** | 某些注册返回 async disposer | 中（异步 dispose 被丢弃 = 幽灵注册） | sync/async 分数组 + await 收集（R9 / 06 §1） |
| **B8 客户端平台差异** | web 与桌面**共用同一 bundle**（`dsh-client-modules:713-719` 仅 `platform==='web'` 加载客户端半边） | 中 | 桌面差异仅 DOM 标记（`<html data-platform>`、`data-windows-titlebar`），**每次调用惰性重读 + MutationObserver**，禁止 apply() 缓存；`process.versions.electron` 全仓零命中，不可用 |
| **B9 版本门策略变更** | `dsh.hostVersion` 字段存在但零读取；`engines.dsh`/manifestVersion 纯声明；**ANIC 实测三者皆未声明或未使用** | 中 | 只信任 peer；peer 是承诺，不是猜测。无 peer 声明时「不设门」是显式立场而非疏漏 |
| **B10 生命周期语义变更** | 子插槽随父卸载；父 fiber 卸载递归子 fiber | 高（标签 + cycle 子树） | 数据真相在文件（标签丢了能重建）；cycle 子树用 `ctx.plugin` 挂载以便整棵丢弃 |
| **B11 LLM 契约变更** | M0-② 实测：`GenerateOptions` 字段集（`types.d.ts:489-530`）、`purpose` **闭合枚举** `'compaction'\|'session-title'`（`lib/index.js` 零引用）、错误码集（`NO_ADAPTER`/`CONTEXT_WINDOW_EXCEEDED`/`QUOTA`/`ACCOUNT_QUOTA`/`EMPTY_RESPONSE`/`INVALID_CREDENTIAL`）、服务键 `llm` | 中（评审子系统；不波及图与流程） | 评审侧只依赖本 spike 记录的契约子集；**不写 `purpose`**（新值编译期即拒）；错误按**码**分派而非按消息文本；服务键探测只开不关 + 调用点决策；降级矩阵（[spike](spike/host-llm-service.md) §4.3）保证契约漂移时退化为启发式而非整体失效 |

## 4. 三层兼容架构（ANIC 移植版）

```
HostVersionDetector ──► HostVersionInfo { generation: gen1 | gen2 | gen3 | unknown }
        │
        ▼
FeatureFlags（开关层）── ANIC 泛化为三类能力位：
        │   host.ui.questionPanels   （gen2-only：userQuestionPanels）
        │   host.nav.pluginNavigation（gen2-only：pluginNavigation）
        │   host.slots.core          （全代：slots 字节一致）
        │   workflow.autoChain       （ANIC 自有，版本无关）
        ▼
ApiCompatLayer（API 层）── ToolNameMapping(anic_* 恒定) + UI 能力 fallback：
        │   标签不可用 → 报诊断（无静默）
        │   问答面板不可用 → 标签内审批卡降级
        ▼
调用点决策（永不 apply() 快照）
```

关键实况（升级报告 §2.2-§2.4）：
- 12 位 FeatureFlags 的分代实况：gen2-only 4 项（`incrementalBootstrap`/`workspaceRegistry`/`betterSidebar`/`multiWorkspace`）、两代均有 5 项（`sessionsApi`/`mcpServer`/`rateLimiting`/`healthScore`/`rulesCheck`）、`spotlight`/`remoteWebUi` 已作为幻影删除、`treeSitterWasm` 因"自家依赖不是宿主能力且全仓无读取点"被删除；
- 版本检测 = `detectFromToolNames`（工具名探测）+ `detectFromContext`（4 候选全 undefined）；**真实 0.2.0-rc.2 宿主被判 `unknown`**，日志 `host version unknown, using conservative flags`；
- 因此运行时行为**不得以世代为门**：本仓库 `triggerBackgroundBuild` 的教训是 `if (flags.incrementalBootstrap && …)` 只可能产生假阴性（挡住确实存在的 bootstrap 工具），已改为调用时 `apiCompat.getAvailableToolName(ctx, …)` 判定，featureFlags 降级为诊断，随 `GET /status` 的 `compat` 字段暴露；
- 探测时机在 `apply()` 开头（`src/index.ts:38-42`），此时兄弟插件可能未挂载 → **探测只能开不能关**。

## 5. ANIC 的 `unknown` 安全映射（自定义但可辩护）

宿主版本未知时（真实 0.2.0-rc.2 就是这个状态），本仓库的保守策略是"按 gen2 基线 + 扣留高风险特性"。ANIC 的对应裁定：

| 能力 | unknown 时的 ANIC 行为 | 理由 |
|---|---|---|
| 标签槽位 | **照常使用** | `dsh-client-ui-slots` 跨代字节一致（SHA256 相同，兼容矩阵 §3.1），且 unknown 保守表不得成为"不使用已存在能力"的理由（基线 §7.7） |
| 问答面板增强 | 降级为标签内审批卡 | `userQuestionPanels` 是 gen2-only 且需双向证据 |
| 多工作区并行 cycle | **扣留**（单工作区） | 对应 `multiWorkspace` 的保守扣留 |
| 自动执行链默认级 | **默认 L2**（不是 L4） | 熔断/自主级是安全面；L4 必须人类显式授权进带（F17） |
| 补丁自动应用 | **扣留**（提案进队列等人） | 版本未知时不假定宿主能正确上报事件（事件名可能变） |

原则一句话：**渲染面尽量乐观（跨代一致），自动化面尽量保守（安全关键）**。

## 6. DSH 升级时的逐条比对 checklist（ANIC 专用）

升级任一 `@deepseek-ai/dsh*` 时，按序执行：

1. **peer 门验证**：ANIC 当前**无 `@deepseek-ai/dsh*` peer 声明**，故本步对 ANIC 恒过；对父工程 dsh-codegraph-visualizer 用 DSH 自带 semver（`includePrerelease: true`）跑 `^0.2.0-rc.2 || ^0.3.0-rc.2` 对新版本 `satisfies` —— 不满足则改 peer，不改则明确记录"未支持"；
2. **能力面重扫**：对新版 asar 树跑 `provide(` 静态扫描 + 全量 `ctx.get` 调用点扫描 → 更新 §2.2/§2.3 表；**任何新增/移除的服务键都要落一行结论**（存在/不存在 + 文件行号）；
3. **幻影清理**：新出现的"看起来能用"的服务（README 提及、命名像）必须双向证据，否则删引用并记 CONFIRMED NEGATIVE；
4. **gen 判定更新**：`DSH_GENERATION_PROBES` 若新增世代，`FEATURE_FLAGS_BY_GENERATION`/`TOOL_MAPPING_BY_GENERATION` 在**类型层**报错提醒补表（`Record<DshGeneration, …>` 让漏配变编译错误而非静默 if 链漏分支）；
5. **gen3 表纪律**：未发布世代的表**故意等于上一代**（未证实的能力不得授予），真实新能力靠运行时探测只增不减地打开；
6. **槽位契约复核**：`conversation.view` 声明、list id 校验、label 解析、开发者工具门控列表（基线 §1.3-1.4）逐条对照；
7. **运行时验收（J0）**：**唯一可信验收 = 真实宿主 + DevTools 观察**（基线 §7.2：注册失败会被 try/catch 吞掉，单测无法证伪）。J0 必测：① 标签实际渲染；② 注册无 throw 日志；③ dispose 后重挂载无重复；④ 熔断 overlay 可关闭；
8. **插件自身工件回归**：76-cycle 账本全链 verify 绿 + 状态重放幂等（05 文档 §4.3 不变量）——宿主升级最容易破坏的是"读旧工件"；
9. **文档同更新**：本 07 文档 §2/§3 表 + `docs/anic/03` 的兼容层章节同步（兼容性文档漂移 = 幻影叙事，本仓库反复出现的缺陷模式）。

## 7. 研究结论

1. ANIC 对 DSH 的依赖面**极窄且已实证**：清单 9 字段 + `conversation.view` 一个槽位 + 5 个宿主能力（`ctx.effect`/`ctx.plugin`/`ctx.on`/`ctx.tools.register`/`ctx.webServer.register`）——**不依赖任何宿主业务工具**，因此 B2/B3 两类破坏性变更对 ANIC 天然免疫；
2. 真正的暴露面集中在**清单契约（B4/B6）**与**槽位契约（B5）**——这两类都是加载期/发布期可静态发现的问题（manifest 契约测试 + package.json 测试），不必等运行时；
3. 生命周期的最大风险不是 API 变更而是**父级卸载语义（B10）**——对策不是防御 API，而是"真相在文件、视图可重建"的设计纪律；
4. `unknown` 宿主是**常态而非异常**（真实 0.2.0-rc.2 即被判 unknown）：ANIC 的自动化面必须能在零版本信息下安全运行——这正是 §5 安全映射存在的理由，也是 M5 进化引擎默认 L2 的依据。

后续：[05-数据结构与算法设计.md](05-数据结构与算法设计.md)（数据结构与算法）、[06-生命周期状态机与引擎研究.md](06-生命周期状态机与引擎研究.md)（生命周期与引擎）。
