# dsh-anic — AI-Native Iteration Cycle（DSH 插件）

ANIC 技能（`.dsh/skills/ai-native-iteration-cycle/`）插件化的**独立工程**。可行性研究、
需求分析、架构与里程碑见 [`docs/anic/`](../docs/anic/)（README + 01–15 + spike 报告）。

> 定位：通用插件（零项目假设）。本仓库只是它的第一个验证场——快照数据来自本仓库真实的
> `.cycles/`，但生成器只读结构化字段（INV-21 合规），不解析自由文本。

## 当前形态（M1..M11 全功能面，v0.3.0）

- 客户端贡献：`conversation.view` 顶层标签 `ANIC`（`kind:'list'` 可叠加，不顶掉既有标签）。
- 渲染真实 `.cycles/`：138 节点 / 164 边 / 57 cycles / 56 条账本事件（`autonomy L4`）。
- 零 bundle 依赖（react 之外全部外置或内联）；SVG 渲染，无布局引擎。

### M1 四路由 + 三面板区 + 九开关 + 十五 agent 卡

| 域 | 路由 / 面板 | 说明 |
|---|---|---|
| **V 可视化** | `GET /anic/api/workflow-snapshot` | 现场构建快照（与嵌入快照共用 `snapshotCore.ts`），no-store + CORS + digest 头 |
| **W 白盒** | `GET /anic/api/step-trace` | 四源投影（workflow-graph × state × ledger × cycle 工件）；cycle 归属只用位置法（INV-27） |
| **自检** | `GET /anic/api/self-check` | 6 探针（INV-13 确定性 / INV-21 结构化 / INV-25 配置单入口 / agent 卡装载 / INV-18 投影可重算 / INV-26 只读） |
| **B 自举** | `POST /anic/self/init` | flow.selfInit 门控；定位技能 init-workflow.mjs 并 spawnSync；幂等（已有 config→409） |
| **面板** | 工具栏三动作 | 刷新（data-anic-refresh）/ 偏好抽屉（data-anic-prefs-toggle）/ 自举（data-anic-self-init） |
| **开关** | `src/shared/flows.ts` | 9 flow 开关三层合并（user prefs > workspace config > deployment > 默认 true）；核心链路不可关（INV-29） |
| **agent** | `assets/agents/*.json` | 5 门 × 3 角色 = 15 张资产卡（闭合 JSON 输出协议 + evidenceIds 禁编造 + doubt 语义，INV-23） |

### M2-a 运行时接管：状态机 + 账本 + 多栈 + cycle 生命周期

| 域 | 路由 / 模块 | 说明 |
|---|---|---|
| **F1 状态机** | `host/runtime/stateMachine.ts` | parseWorkflowGraph / initState / advance（前驱检查 + gate 需 gateApproved）/ checkStrict |
| **F2 账本** | `host/runtime/ledger.ts` | 哈希链（sha256 canonical 六字段键序）/ appendEntry 原子写 / verifyLedger / isDuplicate 幂等查重 |
| **F3 多栈** | `host/runtime/stackProbe.ts` | 探测 node/cargo/python/go/generic → 生成建议 config.yml |
| **F8 cycle** | `host/runtime/cycleRunner.ts` | initCycle / advanceCycle（状态机 + 账本）/ closeCycle（严格门禁 + 账本验证）/ listCycles 数值序 |
| **F15 单写者** | `POST /anic/api/ledger/append` | 幂等查重 + 哈希链追加；与 tool 面同一路径 |
| **路由** | 5 cycle + 3 ledger + 1 stack-probe | `POST /anic/cycle/{init,advance,close}` + `GET /anic/cycle/{state,list}` + `GET /anic/api/ledger` + `POST /anic/api/ledger/append` + `GET /anic/api/ledger/verify` + `GET /anic/api/stack-probe` |

- **配置管理**：`host/config.ts` 唯一 loader（canonical `.cycles/config.yml` → legacy `cycle-config.yml` 告警 → 缺失响亮，INV-25）。
- **日志错误**：`host/logger.ts` scoped 前缀 `[dsh-anic]` + requestId 贯穿；四域错误码 `ANIC_{ROUTE|FETCH|RENDER|CONFIG}_*`；诊断域隔离（插件错误永不写 `.cycles/incidents/`，INV-26）。
- **原子写**：`shared/fs-safe.ts` write-then-rename（INV-7 前置）。
- **M2-b 分段账本**：`host/runtime/segmentedLedger.ts` head.json + seg-NNNNNN.jsonl 只追加（O(1) append，消除单文件 O(n²) 重写）；4 路由 init/append/verify/read。
- **M3 可视化完整版**：`client/features/graph/gateColors.ts` 三态色（PASS 绿/FAIL 红/doubt 黄/pending 灰）+ FAIL 脉冲 CSS（prefers-reduced-motion 禁用）+ 控制带 2σ/3σ + 节点详情抽屉；`renderGraph` 接受 verdicts map + onNodeClick。
- **M4 LLM 评审引擎（条件）**：`host/llm/reviewEngine.ts` probeLlm（ctx.get('llm', false)，INV-24 不进 inject）+ 闭合 JSON 协议校验（INV-23 fail-closed → doubt）+ Tier-1 启发式降级（诚实标注「非模型评审」）；`POST /anic/review`。
- **M5 动态自主进化引擎**：`host/evolution/trustModel.ts` 信任度累积（阈值 L2→L3 ≥70 / L3→L4 ≥85）+ `autonomyGovernor.ts` 8 熔断（先修复后降级）+ `patchEngine.ts` tech-debt 提案（不自我改码 R-31）；4 路由。
- **M5-a 规模治理**：`host/governance/` Archiver（移动不删除）+ Budget（三级阈值）+ Sweep（删空+过期 .tmp）+ Prune（孤儿检测）；4 路由。
- **M6 通用性收口 v0.1.0**：i18n 双语（zh + en，panel/flows/gate 三域）+ CHANGELOG.md + private:false。
- **M7 自举闭环**：`host/selfBootstrap.ts` 状态机 IDLE→EVALUATING→GATE_CHECKING→FIXING→VERIFYING→CONVERGED/EXHAUSTED + `host/skillInvoker.ts` 15 脚本白名单 + 路径遍历防护；4 路由。
- **M8 跨项目+DSH 工具**：`host/tools.ts` 9 DSH 工具（anic_evaluate/iterate/gate_check/bootstrap/snapshot/self_check/hitl/install/status）+ skillRoute 4 路由；inject=['tools','webServer','sessions']。
- **M9 结构优化**：`host/routes/routeContext.ts` 提取共享依赖 + `routes/index.ts` 瘦身至 ~75 行纯组合 + 六域分区（data/cycle/review/evolution/governance/self）。
- **M10 发布 v0.2.0**：CHANGELOG + README + package.json 0.2.0。
- **M11 技能内联+原生等价物+双向自举**：`assets/skill/` 63 文件内联（安装即用）+ `skillInstallRoute` 自动安装/更新 + 7 原生模块（hitlAudit/bandDetector/orgStatus/factBaseVerify/planSync/multiAgentGate/fixLoop）+ `dualBootstrap.ts` 双向自举（插件⇄技能）+ org 面板。
- **真实性审计（自举目标）**：`host/evolution/truthAudit.ts` + `truthAuditChecks.ts` — T1 真实性（文件存在）/ T2 准确性（计数+版本）/ T3 结构性（250 行模块限制）/ T4 逻辑性（路由注册+工具数）；`dualBootstrap` 评估权重 60% 基线 + 40% 审计分；GET `/anic/api/truth-audit`。
- **数据结构优化**：snapshotCore O(n²)→O(n)（Map 替 find/some）；stateMachine O(n)→O(1)（buildGraphIndex nodeMap+predecessors 邻接表）。
- **适配器层**：`adapters/index.ts` — FsAdapter/ExecAdapter/HttpAdapter 三接口隔离外部依赖（Q5 架构约束，eval-runner PASS）。
- **模块化**：WorkflowGraphPanel 303→~140 行，纯渲染提取至 `features/graph/renderGraph.ts`（155 行）。
- 冒烟 19/19 PASS · 规范门 12/12 · vitest 153/153 · typecheck 0/0 · **v0.3.0**。

## 热加载与热更新（三层机制）

| 层 | 机制 | 生效方式 |
|---|---|---|
| **bundle 热更新** | `link:` 安装（Junction 指向本工程）——宿主加载的就是 `dist/client.js` 本体 | `pnpm --dir dsh-anic run build:watch`（tsdown `--watch` 重建 + 自动重 wrap）→ 保存源码 → 浏览器刷新即生效；**无需重装/重启宿主** |
| **数据热更新** | 宿主路由现场构建快照 + 面板 live fetch + 「刷新」按钮 | `.cycles/` 一变（新 cycle/新账本事件），点刷新即见；路由不可用时自动回退嵌入快照 |
| **运行时热卸载** | 遥测句柄 + kill-switch | DevTools：`__ANIC_TAB_SPIKE__.unregister()` / `.reregister()`；`localStorage['anic-workflow-tab']='off'` 零注册 |

## 构建

```bash
pnpm --dir dsh-anic run snapshot      # .cycles/ → src/client/workflowGraphData.ts（已生成）
pnpm --dir dsh-anic run typecheck     # client + host（0 错误）
pnpm --dir dsh-anic run build         # dist/client.js + dist/host.js
pnpm --dir dsh-anic run build:watch   # 热更新开发模式（watch + 自动重 wrap）
pnpm --dir dsh-anic run test          # 全链离线测试：规范门 12 + vitest 147 + 冒烟 19
```

> typecheck/build 依赖父工作区 `node_modules`（typescript/tsdown/@types/react 走目录向上解析）。

## 测试体系

四层金字塔（`node scripts/run-tests.mjs` 一条命令，fail-fast，`--only=<id>` 单跑）：

| 层 | 命令 | 内容 | 数量 |
|---|---|---|---|
| L1 规范门 | `pnpm run validate:dsh` | C1-C12 DSH 清单/exports/locale/icon/产物契约（依据 docs/anic/07 §2 asar 取证，每条注出处） | 12 |
| L2 单元 | `pnpm run test:unit` | snapshotCore + snapshotRoute + runtime（ledger/stateMachine/stackProbe/cycleRunner）+ segmentedLedger + reviewEngine + evolution + governance + native + dshConformance | 132 |
| L3 契约守卫 | （同上，vitest 内） | 源码形状守卫：register 原型形态（禁未绑定提取，放行 disposer 捕获）/inject 回调形态/disposer 不丢弃/遥测+kill-switch/src 零 console.*；**反向自检 + 样例拼接构造** | 15 |
| L4 机制冒烟 | `pnpm run test:smoke` | stub 宿主 19 断言（__ModuleLoader__ 契约/138 点 164 线/热卸载/kill-switch） | 19 |
| L5 真实宿主 | `pnpm run j0` | j0-probe.mjs 经 CDP(9222) 六判据：标签可见/共存/图渲染/遥测/来源如实/热卸载+恢复/kill-switch | 8 |

测试环境脚本（派生自父工程 `scripts/start-dsh-test.mjs` 895 行，实测修复全保留；PID/日志改 `dsh-anic-*`，遮蔽预检针对 dsh-anic）：

```bash
pnpm run test:dsh:start     # 启动 DSH(3080) + 调试 Chrome(9222)，捕获认证 URL
pnpm run test:dsh:stop|restart|status|check
pnpm run test:live          # = run-tests --live（离线三层 + j0-probe）
```

**纪律**：j0-probe 绝不启动/杀死宿主进程（前置 = start-dsh-test 启动的调试 Chrome）；本脚本与父工程
脚本共用 3080，同时只跑一个测试宿主，切换前先 `stop`；`check` 只读评估端口，绝不越权杀进程。

## 安装（已完成：web + desktop 双 profile）

**网页端**（`%USERPROFILE%\.dsh\profiles\web\`）：`dependencies["dsh-anic"] = "link:D:/Projects/TraeProjects/dsh-codegraph-visualizer/dsh-anic"`
+ `dsh.profile.bundles` 追加 `"dsh-anic"`，`pnpm install` 完成（Junction 已验证，
`node_modules/dsh-anic/dist/client.js` 经链接可达且语法可解析；父插件链接未受影响）。

**桌面端**（`%USERPROFILE%\.dsh\profiles\desktop\`，2026-10-13 同步）：同款 `link:` 依赖 + bundles 末尾追加；
`pnpm install` 后 Junction、served bundle `node --check`、locale/icon 可达性全部验证；18 个既有 bundle 行
逐一在 node_modules 解析通过（4 个 `@deepseek-ai/*` 行是宿主内建，从安装锚点解析，不在 profile 依赖里——安装前后一致）。
dsh-anic 无 `@deepseek-ai/dsh*` peer 依赖 ⇒ 兼容门必过；桌面端是 dsh-anic 在 0.4.x 生态宿主上的首次挂载（07 §3 unknown 宿主姿态的实测场）。

**两端生效都需要重启对应宿主**（bundle 在启动时装载）；`link:` 安装下重启后再次 `build` 即热更新。

### J0 验证清单（重启宿主后逐条勾）

1. 顶层标签栏出现 `ANIC`，可点击，SVG 图渲染 138 圆点 / 164 边线；
2. 底行显示 `live …`（宿主路由生效）；把 `.cycles/` 里造一个变化后点「刷新」→ 数字变化；
3. DevTools：`window.__ANIC_TAB_SPIKE__.registered === true`，`nodes/edges/autonomy` 与快照一致；
4. 既有「对话 / 代码图谱」等标签不受影响（`kind:'list'` 共存）；
5. `__ANIC_TAB_SPIKE__.unregister()` → 标签消失；`reregister()` → 重现（dispose 干净）；
6. 停用开关：`localStorage['anic-workflow-tab'] = 'off'` 后重载 → 零注册、零遥测副作用；
7. 卸载 = 从 profile `package.json` 移除依赖与 bundle 行 + `pnpm install` + 重启（无残留注册）。

### 观察点（CLAUDE.md 纪律）

- `ctx.slots.register` 必须保持原型方法调用（否则 per-plugin disposal 失效）；
- apply() 内不做能力快照门控；slots 缺失走 `skipped='slots-absent'` 响亮降级；
- 路由注册经 `ctx.effect`，disposer 不丢弃（插件级卸载 = 路由注销）。

## 目录

```
dsh-anic/
  package.json            # name=dsh-anic, manifestVersion 1, client.platform web, inject=['slots']
  icon.svg  locale/       # DSH 清单资产（en/zh）
  src/index.ts            # 宿主入口：inject=['webServer','sessions']，注册四路由（ctx.effect）
  src/host/snapshotRoute.ts         # GET /anic/api/workflow-snapshot（现场构建，no-store+CORS）
  src/host/routes/selfInitRoute.ts  # POST /anic/self/init（自举，flow.selfInit 门控）
  src/host/routes/selfCheckRoute.ts # GET /anic/api/self-check（6 探针）
  src/host/routes/index.ts          # 路由聚合 + makeSend（requestId 头）
  src/host/config.ts                # C 域唯一 loader（canonical/legacy/missing，INV-25）
  src/host/logger.ts                # scoped logger + requestId（M2 宿主日志服务唯一缝）
  src/host/agents.ts                # agent 卡 loader（5 门 × 3 角色，闭合 schema 校验）
  src/shared/snapshotCore.ts        # 快照构建唯一实现（生成器与宿主路由共用）
  src/shared/stepTrace.ts           # 四源投影（INV-27 诚实标注，位置法归属）
  src/shared/flows.ts               # 9 flow 开关三层合并（INV-29 核心不可关）
  src/shared/errors.ts              # 四域错误码 anicError()（client/host 共用）
  src/client/index.ts     # 客户端入口（name='dsh-anic-client'，inject=['slots']）
  src/client/integrations/WorkflowTabIntegration.ts
  src/client/WorkflowGraphPanel.ts  # 取数组件 + 三工具栏按钮 + 三面板区（stepTrace/diagnostics/prefs）
  src/client/features/stepTrace/renderStepTrace.ts    # 纯渲染：步骤轨迹树
  src/client/features/diagnostics/renderDiagnostics.ts # 纯渲染：自检探针行
  src/client/features/prefs/prefsDrawer.ts            # 纯渲染：偏好抽屉 + localStorage 读写
  src/client/workflowGraphData.ts   # 生成文件（嵌入快照）
  assets/agents/                    # 15 张 agent 资产卡（{gate}-{role}.json）
  scripts/generate-snapshot.mjs     # 薄封装（import snapshotCore.ts，Node≥22.18 原生 TS）
  scripts/build-client.mjs          # 构建 + --watch 热更新模式
  scripts/wrap-client-bundle.mjs    # 与父工程同契约的包装器（styleId=dsh-anic-styles）
  scripts/offline-smoke.mjs         # 机制冒烟（stub 宿主，19 断言）
  scripts/validate-dsh.mjs          # L1 规范门 C1-C12（--json 可选）
  scripts/run-vitest.mjs  vitest.config.ts   # L2/L3 测试执行器与配置（pool=forks）
  scripts/run-tests.mjs             # 测试编排器（validate→vitest→smoke[→j0]，fail-fast）
  scripts/start-dsh-test.mjs        # 测试宿主环境（DSH 3080 + 调试 Chrome 9222，PID/日志隔离）
  scripts/j0-probe.mjs              # L5 真实宿主探针（CDP 六判据，绝不启停宿主）
  tests/unit/snapshotCore.test.ts   # 13 用例
  tests/unit/snapshotRoute.test.ts  # 8 用例
  tests/contract/dshConformance.test.ts  # 15 用例（含源码形状守卫）
  artifacts/workflow-snapshot.json  # 快照留档（审计/复现）
```

## 与父插件的关系

- **独立工程**：不 import 父项目源码；tsconfig 严格分立（client/host 隔离沿用父纪律）。
- 父插件 `src/` 保持零变更（本切片未触碰）；两插件可并存（bundle id / 样式 id / 标签 id 均隔离）。
- 评测产物（契约套件、基准、技能快照）在 `.anic-skill-evo/`，不放本工程。

## M11 技能内联 + 原生插件化 + 双向自举（v0.3.0）

> 来源：用户 m04286「将项目技能实现原生插件，安装即用，双向自举自进化」。

### 技能内联与自动安装

- `assets/skill/`：技能全量内联（63 文件），安装插件即含技能底座。
- `POST /anic/skill/install`：自动安装/更新技能到工作区 `.dsh/skills/`（幂等版本比对）。
- `GET /anic/skill/status`：查询已安装版本 / 来源（workspace / repo / inline）。
- `resolveSkillScriptsDir` 三层混合查找：workspace `.dsh` → repo `.dsh` → inline `assets/skill`。

### 7 脚本原生等价物

| 脚本 | 原生模块 | 路由 |
|---|---|---|
| hitl-audit | `governance/hitlAudit.ts` | `POST /anic/hitl-audit` |
| band-detector | `evolution/bandDetector.ts` | `GET /anic/band-detect` |
| org-status | `evolution/orgStatus.ts` | `GET /anic/org-status` |
| fact-base-verify | `governance/factBaseVerify.ts` | `GET /anic/fact-base` |
| plan-sync-check | `governance/planSync.ts` | `GET /anic/plan-sync` |
| multi-agent-gate | `llm/multiAgentGate.ts` | `POST /anic/multi-agent-gate` |
| auto-fix-loop | `evolution/fixLoop.ts` | `POST /anic/fix-loop` |

### 双向自举

- `dualBootstrap.ts`：`DualBootstrapState { plugin, skill, crossProposals }`。
- `evaluatePluginSelf`：统计 src/test 文件比 → 综合分。
- `evaluateSkillSelf`：检查 `.cycles/` 工件完整性 → 综合分。
- `advanceDualBootstrap`：推进一轮，失败时产跨向提案（不互相改码，R-31）。
- 3 路由：`POST /anic/self/dual-evaluate` / `POST /anic/self/dual-advance` / `GET /anic/self/dual-status`。

### 9 DSH 工具

`anic_evaluate` / `anic_iterate` / `anic_gate_check` / `anic_bootstrap` / `anic_snapshot` / `anic_self_check` / **`anic_hitl`** / **`anic_install`** / **`anic_status`**（粗体为 M11 新增）。

### 透明性 + 连通性增强

- 面板新增 **org status 全景区**：cycle 列表 + 信任分 + 自主级 + 熔断 + 带检测 + 警告。
- 并行 fetch snapshot / step-trace / self-check / org-status（各自 404 降级，不伪造空数据）。

### 验证

```
typecheck   client 0  host 0
vitest      147/147  (10 test files)
smoke       19/19 ALL PASS
validate    12/12    (dsh-anic@0.3.0)
build       dist/client.js + dist/host.js OK
```
