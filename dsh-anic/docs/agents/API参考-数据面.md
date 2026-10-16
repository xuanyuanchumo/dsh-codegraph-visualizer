# dsh-anic API 参考 · 数据面

> 本册覆盖 **data 域**：snapshot / step-trace / self-check / self-init，共 4 个端点。全部只读，唯一例外是 `self-init`（bootstrap 动作）。
>
> 公共约定（注册机制、响应形状、状态码语义、无工作区解析链、磁盘形状）见 [API参考.md](API参考.md)。周期面（cycle / ledger / stack-probe / seg-ledger）见 [API参考-周期面.md](API参考-周期面.md)。
>
> 读取本文件的时机：调用或修改数据面端点时。

## 1. GET `/anic/api/workflow-snapshot`

| 项 | 值 |
| --- | --- |
| 常量 | `SNAPSHOT_ROUTE`（`src/host/snapshotRoute.ts:22`） |
| 注册 | `registerSnapshotRoute(ctx)`（`src/host/snapshotRoute.ts:81`） |
| 聚合位置 | `src/host/routes/index.ts:57-62` |

**Query**：无（workspace 由 `resolveWorkspaceRoots` 在服务端解析）。

**响应 200**：`buildWorkflowSnapshot(cyclesDir)` 的结果 —— `{ nodes, edges, autonomy, counts }`（构建器见 `src/shared/snapshotCore.ts:1-6`；客户端类型见 `src/client/workflowGraphData.ts:12-30`，其中 `WorkflowNode.type` 是 8 值联合 `'phase'|'micro-step'|'gate'|'human-gate'|'cycle'|'gate-event'|'incident'|'autonomy'`）。

**响应头**（`snapshotRoute.ts:96-101`）：

- `X-ANIC-Snapshot-Digest`：`sha256(JSON.stringify({ n: nodes, e: edges })).slice(0, 16)`
- `X-ANIC-Workspace`：`encodeURIComponent(root)`

头部注释（`snapshotRoute.ts:8-11`）明确：digest 是**展示用指纹，不是条件请求语义**，不参与 304 协商。改动前必须知道这一点 —— 把它当作 ETag 使用会得到「永远 200」或「假 304」。

**状态码**：

| 码 | 条件 | 体 |
| --- | --- | --- |
| 404 | `<root>/.cycles` 不存在 | `{ error: 'no .cycles in current workspace', workspace: root }` |
| 200 | 正常 | 快照对象 |
| 500 | 构建抛错 | `{ error: message }` |

## 2. GET `/anic/api/step-trace`

| 项 | 值 |
| --- | --- |
| 常量 | `STEP_TRACE_ROUTE`（`src/host/routes/stepTraceRoute.ts:13`） |
| 注册 | `registerStepTraceRoute(ctx)`（`stepTraceRoute.ts:16`） |

**为什么在服务端组装**（`stepTraceRoute.ts:3-5`）：「客户端拿不到文件句柄，这是白盒透明化的数据面」。服务端把四源投影拼好后整体下发。

**四源**（`src/shared/stepTrace.ts:4-5`）：声明图（`workflow-graph.yaml`）× 节点状态（`workflow-state.json`）× 账本裁决（`gates/ledger.json`）× 周期工件（`cycles/cycle-N` 元数据）。

**响应 200**：`buildStepTrace(snap, { cyclesDir })` 的结果。逐项形状（`stepTrace.ts:18-31`）：

```ts
type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
type StepBasis  = 'structured' | 'heuristic';
interface TraceStep {
  nodeId: string;
  name: string;
  kind: string;
  status: StepStatus;
  basis: StepBasis;
  sources: string[];                                  // 四源中实际参与判定的
  ledgerVerdict: { result: string; timestamp: string } | null;
}
```

**两条承重契约**（`stepTrace.ts:7-13`，改动时必须保留）：

1. **cycle 归属只用位置法** —— 绝不从账本 `detail` 自由文本解析 cycle 号；账本只按 gate 取「最近一次裁决」。
2. **INV-27 诚实标注** —— 推断出来的状态必须 `basis: 'heuristic'`，只有结构化来源给的事实才是 `basis: 'structured'`；任一源缺失标 `'absent'`，不伪造空数据。

**状态码**：404 `{ error: 'no .cycles in current workspace', workspace: root }`（`stepTraceRoute.ts:28`，与 snapshot 同形）；200；500 `{ error: message }`。

## 3. GET `/anic/api/self-check`

| 项 | 值 |
| --- | --- |
| 常量 | `SELF_CHECK_ROUTE`（`src/host/routes/selfCheckRoute.ts:28`） |
| 注册 | `registerSelfCheckRoute(ctx, { send, getWorkspaceRoot, agentCardsDir })` |

**响应 200**：`{ checks: ProbeResult[], allOk: boolean, requestId: string }`，其中

```ts
interface ProbeResult { id: string; inv?: string; ok: boolean; detail: string }   // selfCheckRoute.ts
```

**六个只读探针**（`runSelfChecks(input: { workspaceRoot, agentCardsDir })`）：

| id | 不变量 | 判定 |
| --- | --- | --- |
| P1 | INV-13 确定性 | 用固定时间戳 `'2025-01-01T00:00:00.000Z'` 构建快照两次，比较 `sha256(JSON.stringify(x)).slice(0,16)`；无 `.cycles` 时标 `'absent'` |
| P2 | INV-21 结构化身份 | `STRUCTURED_PREFIXES = ['wf:', 'cycle:', 'evt:', 'inc:', 'aux:']`；无 `.cycles` 时空过 |
| P3 | INV-25 配置单入口 | `loadWorkspaceConfig(cyclesDir).source !== 'missing' && !== 'legacy'` |
| P4 | agent 卡可加载 | `loadAgentCards(input.agentCardsDir)` 且 `agents.errors.length === 0` |
| P5 | INV-18 step-trace 可复现 | 仅当 `<cyclesDir>/workflow-graph.yaml` 存在时跑，同一固定时间戳；否则空过 |
| P6 | INV-26 诊断域隔离 | **硬编码 `ok: true`**，detail `'self-check is read-only by construction (no write path in this module)'` |

P6 是形态声明而非运行时探测 —— 它不检验任何东西，只是把「本模块无写路径」写进响应。真正的保证来自源码守卫与评审。

**每个探针独立 try/catch**，抛错转成 `ok: false` + `detail: 'threw: …'`，不向上传播。

**状态码（刻意的不对称）**：

| 码 | 条件 |
| --- | --- |
| 404 | 无工作区 → `{ error: { code: 'ANIC_ROUTE_SELF_CHECK_NO_WORKSPACE', message: 'no workspace resolvable' } }` |
| **200** | 探针失败 —— 逐项 `ok: false`，整体仍 200 |
| 500 | 探针**机制**本身抛错 → `{ error: message }` |

头部注释即契约（`selfCheckRoute.ts`）：「失败不抛异常：逐项 ok:false + detail，整体 200（诊断端点的诚实形态——探针本身不可用才是 500）」。**不要「修正」成失败即 5xx** —— 那会让一个探针的失败掩盖其余五个的结果。

## 4. POST `/anic/self/init`

| 项 | 值 |
| --- | --- |
| 常量 | `SELF_INIT_ROUTE`（`src/host/routes/selfInitRoute.ts:21`） |
| 注册 | `registerSelfInitRoute(ctx, { send, getWorkspaceRoot, loadFlows })` |

**Body**：`{ name?: string }` → 非空时转成 CLI 参数 `['--name', name.trim()]`（注释引 `init-workflow.mjs:66` N-6）。

**实际执行**（`selfInitRoute.ts`）：

```ts
spawnSync(process.execPath, [join(scriptsDir, 'init-workflow.mjs'), root, ...nameArg],
          { cwd: root, encoding: 'utf-8', timeout: 60_000 })
```

**状态码 —— 判定顺序有语义，不可重排**：

| 顺序 | 码 | 条件 | 体 |
| --- | --- | --- | --- |
| 1 | 405 | `(r?.method ?? 'GET') !== 'POST'` | `{ error: 'POST only' }` |
| 2 | 403 | `!deps.loadFlows().selfInit` | `{ error: { code: 'ANIC_ROUTE_SELF_INIT_DISABLED', message: 'flow.selfInit is switched off (workspace/deployment layer)' } }` |
| 3 | 404 | 无工作区 | `{ code: 'ANIC_ROUTE_SELF_INIT_NO_WORKSPACE' }` |
| 4 | 409 | `<root>/.cycles/config.yml` 已存在 | `{ code: 'ANIC_ROUTE_SELF_INIT_ALREADY', message: '.cycles/config.yml already exists at this workspace — self-init is refuse-to-rerun (idempotent by design)' }` |
| 5 | 404 | `resolveSkillScriptsDir(root)` 为 null | `{ code: 'ANIC_ROUTE_SELF_INIT_SKILL_MISSING' }` |
| 6 | 200 / 500 | `result.status === 0` / 否则 | 见下 |

**成功体**：`{ ok, requestId, durationMs, stdout, stderr, configPath: ok ? configPath : null, digest: ok ? sha256(stdout).slice(0,16) : null }`。

**409 是设计而非意外** —— 注释写明 `refuse-to-rerun (idempotent by design)`：自举只在空工作区发生，重复调用必须响亮拒绝而不是静默覆盖已有配置。

**INV-26 声明**（`selfInitRoute.ts` 头部）：「本路由自身错误只进日志/响应，**绝不写 `.cycles/incidents/`**」。

## 相关文档

- 公共约定与端点总索引 → [API参考.md](API参考.md)
- 周期面（cycle / ledger / stack-probe / seg-ledger） → [API参考-周期面.md](API参考-周期面.md)
- 评审 / 进化 / 治理 / 原生脚本面 → [API参考-评审进化与治理.md](API参考-评审进化与治理.md)
- 自举 / 技能 / 安装 / 双自举面 → [API参考-自举与技能.md](API参考-自举与技能.md)
