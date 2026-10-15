# 06-dsh-anic 插件开发规范

> 本文档是 `dsh-anic/` 独立工程的开发规范，服务于在 dsh-anic 上工作的 AI 代理与贡献者。
> 与 [01-插件开发规范.md](./01-插件开发规范.md)（父工程）互补：父工程规范管 `src/`，
> 本文档管 `dsh-anic/src/`。两者**源码零依赖**（G-IND 守卫）。

## 1. 工程定位

`dsh-anic` 是一个**通用 ANIC 工作流可视化插件**，本仓库只是其第一个验证场。
它以 DSH 插件形态运行，渲染 `.cycles/` 目录下的迭代周期数据。

| 属性 | 值 | 来源 |
|---|---|---|
| 包名 | `dsh-anic@0.3.0` | `dsh-anic/package.json:2-3` |
| 模块系统 | ESM (`"type": "module"`) | `dsh-anic/package.json:6` |
| Node 引擎 | `>=22.19` | `dsh-anic/package.json:10` |
| DSH manifest | `manifestVersion: 1` | `dsh-anic/package.json:19` |
| 客户端平台 | `web` | `dsh-anic/package.json:21` |
| 宿主入口 | `dist/host.js`（经 `src/index.ts` 构建） | `dsh-anic/package.json:13` |
| 客户端入口 | `dist/client.js`（经 `src/client/index.ts` 构建） | `dsh-anic/package.json:14` |

## 2. 插件形态与入口

### 2.1 宿主入口（`dsh-anic/src/index.ts`）

```typescript
export const name = 'dsh-anic';
export const inject = ['tools', 'webServer', 'sessions'];

export function apply(ctx: unknown): void {
  // ctx.effect() 包裹资源注册，返回 disposer 供清理
  // 无 webServer 时路由整体跳过，客户端标签 + 嵌入快照不受影响
}
```

- **`inject` 声明**：只列**必需**服务。`webServer` 承载路由；`sessions` 是工作区解析后备；
  `tools` 是 DSH 工具注册槽位（M8 G-TOOL）。
- **`ctx.effect(fn, label)`**：包裹资源注册，返回 disposer。无 `effect` 时直接调用（冒烟测试路径）。
- **`registry` 不在 inject**：用 `ctx.get(key, false)` 探测存在性（strict=true 会杀死正在 loading 的 provider）。

### 2.2 客户端入口（`dsh-anic/src/client/index.ts`）

客户端通过 `ctx.slots.inject()` 注册标签页和视图组件。详见 [03-客户端API参考.md](./03-客户端API参考.md)。

## 3. 六域分区路由架构（M9）

`dsh-anic/src/host/routes/index.ts` 是纯组合层（~110 行），按六域分区注册路由：

| 域 | 路由文件 | 端点 | 说明 |
|---|---|---|---|
| **data** | `snapshotRoute.ts` / `stepTraceRoute.ts` / `selfCheckRoute.ts` / `selfInitRoute.ts` | snapshot + step-trace + self-check + self-init | 数据读取与自检 |
| **cycle** | `cycleRoute.ts` / `ledgerRoute.ts` / `stackProbeRoute.ts` / `segmentedLedgerRoute.ts` | cycle + ledger + stack-probe + seg-ledger | 周期与账本 |
| **review** | `reviewRoute.ts` | review | 条件性 LLM 评审（需 agentCardsDir） |
| **evolution** | `evolutionRoute.ts` | trust + autonomy + breakers + tech-debt | 进化引擎 |
| **governance** | `governanceRoute.ts` | archive + budget + sweep + prune | 治理 |
| **self** | `selfBootstrapRoute.ts` / `skillRoute.ts` / `skillInstallRoute.ts` / `dualBootstrapRoute.ts` / `truthAuditRoute.ts` / `nativeRoute.ts` | self-bootstrap + skill + skill-install + dual + truth-audit + native | 自举闭环与跨项目 |

### 3.1 路由注册纪律

- 每个路由文件导出 `registerXxxRoute(ctx, deps): (() => void) | null`，返回 disposer。
- 共享 deps 经 `routeContext.ts` 的 `buildRouteContext(ctx)` 提取（单一职责）。
- 聚合器 `registerAnicRoutes` 收集所有 disposer，返回统一清理函数。
- **守卫**：`if (!c.webServer || typeof c.webServer.register !== 'function') return null;`

## 4. 模块架构

### 4.1 进化模块（`dsh-anic/src/host/evolution/`）

| 文件 | 职责 |
|---|---|
| `autonomyGovernor.ts` | 自主级治理（L1-L4） |
| `bandDetector.ts` | 频带检测（性能/质量退化识别） |
| `fixLoop.ts` | 自动修复循环（≤3 次） |
| `orgStatus.ts` | 组织状态聚合 |
| `patchEngine.ts` | 补丁引擎（keep/revert 决策） |
| `trustModel.ts` | 信任模型 |
| `truthAudit.ts` / `truthAuditChecks.ts` | 真值审计 |

### 4.2 治理模块（`dsh-anic/src/host/governance/`）

| 文件 | 职责 |
|---|---|
| `archiver.ts` | 周期归档 |
| `budget.ts` | 预算管理 |
| `factBaseVerify.ts` | 事实基座验证 |
| `hitlAudit.ts` | HITL 审计（H1-H4） |
| `planSync.ts` | 计划同步 |
| `prune.ts` | 剪枝 |
| `sweep.ts` | 清扫 |

### 4.3 LLM 模块（`dsh-anic/src/host/llm/`）

| 文件 | 职责 |
|---|---|
| `multiAgentGate.ts` | 多 agent 门控 |
| `reviewEngine.ts` | LLM 评审引擎 |

### 4.4 运行时模块（`dsh-anic/src/host/runtime/`）

| 文件 | 职责 |
|---|---|
| `cycleRunner.ts` | 周期运行器（七步无人值守） |
| `ledger.ts` | 账本 |
| `segmentedLedger.ts` | 分段账本 |
| `stackProbe.ts` | 栈探针 |
| `stateMachine.ts` | 状态机 |

### 4.5 适配器层（`dsh-anic/src/adapters/index.ts`）

所有外部依赖（文件系统、子进程、网络 fetch）经此层抽象：

```typescript
export interface Adapters {
  fs: FsAdapter;    // readText / readDir / exists / writeText
  exec: ExecAdapter; // run(cmd, args, opts) → {stdout, stderr, exitCode}
  http: HttpAdapter; // fetch(url, opts) → {ok, status, json, text}
}
export function createNodeAdapters(): Adapters; // 生产用；测试注入 mock
```

- **INV-25**：配置单入口；**INV-26**：诊断域隔离。
- Node 内部导入延迟绑定（文件底部），便于测试 mock。

## 5. 工具注册（工具域：`tools.ts` + `toolsSkillGateway.ts`）

注册 **10 个** DSH 工具供其他会话/agent 调用。技能调用域工具（anic_install + anic_skill）拆分至 `src/host/toolsSkillGateway.ts`（T3 ≤250 行模块化纪律），槽位形状契约在 `src/host/toolsSlot.ts`。

| 工具 | 功能 | 底层技能脚本 | 文件 |
|---|---|---|---|
| `anic_evaluate` | 评估当前周期 | eval-runner | tools.ts |
| `anic_iterate` | 推进一个迭代步 | eval-runner + gate-check | tools.ts |
| `anic_gate_check` | 门禁检查（G0-G3） | gate-check | tools.ts |
| `anic_bootstrap` | 自举初始化（评估插件自身） | eval-runner + gate-check | tools.ts |
| `anic_snapshot` | 生成快照 | （宿主原生） | tools.ts |
| `anic_self_check` | 自检 | （宿主原生） | tools.ts |
| `anic_hitl` | 人工介入审计 | （宿主原生） | tools.ts |
| `anic_status` | 状态查询 | （宿主原生） | tools.ts |
| `anic_install` | 技能安装到工作区（真执行 autoInstallSkill，可 bootstrap 尚不存在的目录） | — | toolsSkillGateway.ts |
| `anic_skill` | **全白名单通用网关**：任意 15 脚本原生调用（script+workspace+args+timeout） | 15/15 | toolsSkillGateway.ts |

### 5.0 覆盖性契约（用户需求：所有功能业务脚本必须能 DSH 原生调用）

- `anic_skill` 的 `script` 枚举在**运行时**取自 `listSkillScripts()`——单一事实源，绝不在 schema 手抄第二份数组（两份有序列表必然漂移）。
- 契约测试 `tests/unit/skillToolNative.test.ts` 钉死：白名单 15 项 ⇄ 内联底座 `scripts/*.mjs`（扣除传输层 mcp-server）集合**恰好相等**；schema 枚举 ≡ 白名单；行为级证明（stub 宿主槽位 → 真实 spawn → 安装→init→workflow-state 全链退出 0）；dispose 调用每一个注册 disposer。
- `anic_install` 只做路径形状校验（拒绝 `..`），**不要求目录已存在**——安装本身就是 bootstrap 新工作区的动作，`autoInstallSkill` 会 mkdirSync recursive（先跑 validateWorkspace 会让安装永远无法 bootstrap 新目录，vitest 实测教训）。
- truthAudit T4 工具计数扫描**整个工具域**（`src/host/tools*.ts`），不硬编码单文件——工具拆分后单文件计数漏报的教训。

未走工具的其余入口经 HTTP 网关 `POST /anic/skill/invoke`（白名单 15 脚本 + workspace 校验，`src/host/routes/skillRoute.ts`）——与 `anic_skill` 工具同源同安全模型。

### 5.1 技能脚本调用约定（P1 教训）

`invokeSkillScript(scriptsDir, script, args, workspace, timeoutMs)`（`src/host/skillInvoker.ts`）内部：

```
node <scriptPath> <workspace> ...args
```

**项目目录是第一个位置参数**（全部 15 个技能脚本约定 `args._[0]`，转录自 mcp-server.mjs:35 的参考调用形态）。绝不能追加 `--project-dir <ws>` —— 脚本不认识该旗标，会把它当位置参数收进 `args._[0]`，解析出 `<scriptsDir>/--project-dir` 幽灵目录（此缺陷曾长期潜伏，因为单元测试只测状态机、从不真正 spawn 脚本；现由 `tests/unit/skillReplaceE2E.test.ts` 端到端钉死：脚手架产物必须落在 workspace，调用目录不得出现 `--project-dir` 残留）。

`resolveSkillScriptsDir(workspace)`（同文件，唯一定义——selfInitRoute 的本地副本已删）候选链：`ANIC_SKILL_DIR` env → `workspace/.dsh` → `workspace/../.dsh` → `process.cwd()/.dsh` → 插件内联底座；所有外部候选必须通过哨兵检查（`init-workflow.mjs` 存在）。

## 6. 测试金字塔

| 层 | 命令 | 范围 | 当前状态 |
|---|---|---|---|
| L1 validate | `pnpm run lint` | DSH 规范符合性门（`validate-dsh.mjs`） | 12/12 ✅ |
| L2 vitest | `pnpm run test:unit` | 单元/契约测试 | 165/165 ✅ |
| L3 smoke | `pnpm run test:smoke` | stub 宿主机制冒烟 | 19/19 ✅ |
| L4 j0-probe | `pnpm run j0` | 真实宿主 J0 六步协议探针 | 按需运行 |
| L5 替代性 e2e | vitest（`skillReplaceE2E`） | 插件内联技能 → 全新工作区完整自举 | 7/7 ✅ |

### 6.1 测试文件清单

```
dsh-anic/tests/unit/
  evolution.test.ts        # 进化引擎模块
  governance.test.ts       # 治理模块
  native.test.ts           # 原生路由
  reviewEngine.test.ts     # LLM 评审引擎
  runtime.test.ts          # 运行时模块
  segmentedLedger.test.ts  # 分段账本
  selfBootstrap.test.ts    # 自举闭环
  truthAudit.test.ts       # 真值审计
  skillInvokerContract.test.ts  # 技能调用器契约（唯一定义 + 真实使用方）
  skillReplaceE2E.test.ts  # 技能替代能力端到端（安装→脚手架→状态，P1 回归锚点）
  ...（共 13 个套件）
```

## 7. 独立性守卫（G-IND）

**硬约束**：`dsh-anic/src/` 不得 import 父项目 `src/`——只许借 `node_modules`。

- 过渡态（TD-A1）：dsh-anic 无 `dependencies`/`devDependencies` 字段，借用父工程 `node_modules`。
- typecheck 脚本 `scripts/typecheck.mjs` 向上查 4 级祖先找 `node_modules/typescript/bin/tsc`。
- build 脚本 `scripts/build-client.mjs` 同模式查 `tsdown`。

## 8. 开发命令

```bash
cd dsh-anic
pnpm run typecheck   # tsconfig.client + tsconfig.host
pnpm run test        # validate + vitest + smoke 三层
pnpm run build       # client bundle + host bundle（tsdown）
pnpm run lint        # DSH 规范符合性门
pnpm run j0          # 真实宿主 J0 探针（不启停宿主）
```

**验证工作**：`pnpm run typecheck && pnpm run test && pnpm run build` 全绿后方可提交。

## 9. 常见陷阱

| 陷阱 | 说明 |
|---|---|
| `tsc` 不在 PATH | 用 `node scripts/typecheck.mjs`，不要直接调 `tsc` |
| `ctx.get(name)` strict=true 杀死 loading provider | 探测存在性用 `ctx.get(key, false)` |
| 嵌入快照与路由快照共用构建器 | 改 `snapshotCore.ts` 要同步两处 |
| 测试读 `dist/` 对 `src/` 变更惰性 | 先 `pnpm run build` 再跑 smoke |
| 父工程 `src/` 零变更 | dsh-anic 是独立工程，不改父项目源码 |

## 10. 相关文档

| 文档 | 内容 |
|---|---|
| [docs/anic/](../anic/) | dsh-anic 设计文档族（01-15 + spikes） |
| [docs/anic/14-自举闭环与跨项目技能调用架构.md](../anic/14-自举闭环与跨项目技能调用架构.md) | 六域分区与自举闭环设计 |
| [docs/anic/15-插件化评审与独立性连通性分析.md](../anic/15-插件化评审与独立性连通性分析.md) | 独立性与连通性分析 |
| [05-DSH官方规范检索证据.md](./05-DSH官方规范检索证据.md) | DSH 契约断言的官方依据 |
