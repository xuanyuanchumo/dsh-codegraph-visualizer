# dsh-anic API 参考（总览）

> 本文件是 HTTP 面的**索引与公共约定**。逐端点的完整定义按域拆分在四个分册：
>
> | 分册 | 覆盖域 | 端点数 |
> | --- | --- | --- |
> | [API参考-数据面.md](API参考-数据面.md) | data（snapshot / step-trace / self-check / self-init） | 4 |
> | [API参考-周期面.md](API参考-周期面.md) | cycle（cycle / ledger / stack-probe / seg-ledger） | 13 |
> | [API参考-评审进化与治理.md](API参考-评审进化与治理.md) | review + evolution + governance + native | 16 |
> | [API参考-自举与技能.md](API参考-自举与技能.md) | self（自举 / skill / install）+ dual + truth-audit | 14 |
>
> 读取本文件的时机：需要知道某个端点属于哪一册、公共响应形状、或公共状态码语义时。

## 1. 注册机制

所有路由经 `ctx.webServer.register(...)` 注册，聚合入口是 `src/host/routes/index.ts:48` `registerAnicRoutes(ctx, options)`。两种调用形态并存：

| 形态 | 签名 | 使用者 |
| --- | --- | --- |
| 对象式（多数） | `webServer.register({ kind: 'exact', path, handler })` | `snapshotRoute.ts:88`、`cycleRoute.ts`、`ledgerRoute.ts`、`stackProbeRoute.ts:22`、`truthAuditRoute.ts:20` 等 |
| 位置参数式 | `webServer.register(method, path, handler)` | 仅 `reviewRoute.ts:29` 的注入签名（经 `index.ts:77` 的适配闭包转成对象式） |

**注意**：位置参数式的 `method` 在多数模块里被显式丢弃 —— `evolutionRoute.ts:34` 与 `dualBootstrapRoute.ts:37`（`void method;`）都只把 `path` 传给宿主。**HTTP 方法的判定因此落在 handler 内部**，而不是注册时。只有三个 handler 真正实现了方法检查：`selfInitRoute.ts:44`、`skillInstallRoute.ts:53`、`skillInstallRoute.ts:90`。

`kind: 'exact'` 表示精确路径匹配（非前缀匹配）。全部端点都是 `exact`。

## 2. 公共请求形状

`RouteReq`（`src/host/routes/routeContext.ts`）与各模块的窄化一致：

```ts
interface RouteReq {
  url?: string;                                        // 含 query string
  body?: string | Record<string, unknown>;             // 宿主可能已解析或给原始字符串
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}
```

**body 解析**：每个模块自带一个 `body<T>(req)` 辅助函数（如 `ledgerRoute.ts:25-31`、`cycleRoute.ts`），语义统一 —— 字符串则 `JSON.parse`，解析失败返回 `{} as T`，对象则原样返回。**因此畸形 JSON 不会 400**，只会退化成空对象（`selfInitRoute.ts:67` 同）。

**query 解析**有两种实现：`ledgerRoute.ts:33-43` 手写 `indexOf('?')` 切分，`segmentedLedgerRoute.ts` 用 `new URL(r.url, 'http://localhost').searchParams`，`nativeRoute.ts` 对 `score` 用正则 `r?.url?.match(/score=([0-9.]+)/)`。

## 3. 公共响应形状

**成功**：`sendJson(res, status, body, extraHeaders?)`（`src/host/snapshotRoute.ts:63`）写死三个头：

```
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Access-Control-Allow-Origin: *
```

外加可选 `extraHeaders`。**若 `res.writeHead` 或 `res.end` 不是函数则静默返回**（smoke 沙盒的容错路径）。

**requestId 通道**：`routeContext.ts` 的 `makeSend()` 在传入 `requestId` 时附加头 `X-ANIC-Request-Id`。使用该通道的模块：`nativeRoute.ts`（每个 handler 都调 `newRequestId()`）、`selfInitRoute.ts:42`、`selfCheckRoute.ts`、`skillInstallRoute.ts`、`dualBootstrapRoute.ts`。`cycleRoute.ts` / `ledgerRoute.ts` / `evolutionRoute.ts` / `governanceRoute.ts` / `skillRoute.ts` **不带** requestId。

**错误形状不统一**，实际存在三种：

| 形状 | 例子 |
| --- | --- |
| `{ error: '<字符串>' }` | `ledgerRoute.ts` 全部错误；`cycleRoute.ts` 全部错误；`evolutionRoute.ts` |
| `{ error: { code, message } }` | `selfInitRoute.ts:49,54,59,76`；`selfCheckRoute.ts`；`skillInstallRoute.ts`；`dualBootstrapRoute.ts` |
| `{ error: '<码>', message: '<本地化文本>' }` | `reviewRoute.ts:49,54,73`（`INVALID_JSON` / `INVALID_REQUEST` / `AGENT_NOT_FOUND`） |

消费方必须按端点分别处理，不能假设统一形状。

## 4. 公共状态码语义

| 码 | 语义 | 出现在 |
| --- | --- | --- |
| 200 | 成功 | 几乎全部 |
| 201 | **创建成功**（仅 seg-ledger 的 append 与 init） | `segmentedLedgerRoute.ts` |
| 400 | 参数缺失/非法 | `ledgerRoute.ts`、`cycleRoute.ts`、`segmentedLedgerRoute.ts`、`skillRoute.ts`、`reviewRoute.ts` |
| 403 | 功能开关关闭 | `selfInitRoute.ts:49`（`flow.selfInit` 关） |
| 404 | 无工作区 / 无 `.cycles` / 技能脚本缺失 / 路由资源不存在 | 多数模块 |
| 405 | 方法不符 | `selfInitRoute.ts:45`、`skillInstallRoute.ts:54,91` |
| 409 | 幂等冲突（重复条目 / 状态不允许） | `ledgerRoute.ts`、`segmentedLedgerRoute.ts`、`cycleRoute.ts`（advance/close 的 `result.ok === false`）、`selfInitRoute.ts:59` |
| 500 | 内部错误 / 无工作区（**governance 域特有**） | `snapshotRoute.ts`、`stepTraceRoute.ts`、`governanceRoute.ts`（`ANIC_ROUTE_NO_WORKSPACE`）、`selfBootstrapRoute.ts`、`selfInitRoute.ts` |

**两处刻意的不一致，改动前必须知道**：

1. **无工作区**：绝大多数模块返回 **404** `{ error: 'no workspace' }`；`governanceRoute.ts` 返回 **500** `{ error: { code: 'ANIC_ROUTE_NO_WORKSPACE' } }`。原因是 `governanceRoute.ts` 自带 `resolveRoot(ctx)`，**不回退 `process.cwd()`**（不同于 `snapshotRoute.ts:44` 的 `resolveWorkspaceRoots`），因此「解析不到根」在它看来是服务端错误而非客户端错误。
2. **自检探针失败**：`selfCheckRoute.ts` 的单个探针失败**仍返回 200**，逐项 `ok: false` + `detail`；只有探针机制本身不可用才是 500。头部注释即契约：「失败不抛异常：逐项 ok:false + detail，整体 200（诊断端点的诚实形态——探针本身不可用才是 500）」。

## 5. 无工作区时的统一行为

`snapshotRoute.ts:44` `resolveWorkspaceRoots(ctx)` 的解析链，**每个请求重新解析**（不做 capability 快照）：

1. `ctx.workspaceRegistry.list()` 中第一个有 `path` 的项；
2. `ctx.sessions.list()` 中第一个有 `header.cwd` 的项；
3. `process.cwd()`。

三步各包 try/catch，因此任一服务缺失都能安全降级到下一步。头部注释记录了纪律：「capability 快照是『一刻决定永远』的缺陷放大器」。

`governanceRoute.ts` 是唯一例外：它只做第 1、2 步，**不回退 `process.cwd()`**。

## 6. 数据面磁盘形状（端点契约的上游）

端点的响应形状由磁盘工件决定，改动磁盘形状等于改动 API：

| 工件 | 形状 |
| --- | --- |
| 账本 `<root>/.cycles/gates/ledger.json` | **`{ entries: [...] }`**（不是裸数组）—— 由 `src/host/runtime/ledger.ts` 的 `loadLedger` 读取 |
| 分段账本 `<root>/.cycles/gates/head.json` + `seg-*.jsonl` | head 对象 + 每行一条 JSON 的追加式分段文件（`segmentedLedgerRoute.ts:12` 注释：`.cycles/gates/ 下放 head.json + seg-*.jsonl`） |
| 配置 `<root>/.cycles/config.yml` | 唯一合法名（`src/host/config.ts` `CANONICAL_CONFIG`）；legacy `cycle-config.yml` 仅兼容读且必须响亮告警（INV-25） |
| 流程跟踪 `<root>/.cycles/flow-tracker.json` | 由 `src/host/runtime/flowTracker.ts` 读写 |
| 工作区覆盖的 agent 卡 `<root>/.cycles/agents/` | 出厂默认在 `assets/agents/*.json`，工作区优先（`src/host/agents.ts:4-5`） |

**快照摘要头**：`GET /anic/api/workflow-snapshot` 额外返回 `X-ANIC-Snapshot-Digest`（sha256 前 16 位十六进制）与 `X-ANIC-Workspace`（`encodeURIComponent` 后的根路径），见 `snapshotRoute.ts:101`。头部注释明确 digest 是**展示用指纹，不是条件请求语义**（不参与 304）。

## 7. 端点总索引

| 方法 | 路径 | 分册 |
| --- | --- | --- |
| GET | `/anic/api/workflow-snapshot` | 数据面 |
| GET | `/anic/api/step-trace` | 数据面 |
| GET | `/anic/api/self-check` | 数据面 |
| POST | `/anic/self/init` | 数据面 |
| POST | `/anic/cycle/init` | 周期面 |
| POST | `/anic/cycle/advance` | 周期面 |
| POST | `/anic/cycle/close` | 周期面 |
| GET | `/anic/cycle/state` | 周期面 |
| GET | `/anic/cycle/list` | 周期面 |
| GET | `/anic/api/ledger` | 周期面 |
| POST | `/anic/api/ledger/append` | 周期面 |
| GET | `/anic/api/ledger/verify` | 周期面 |
| GET | `/anic/api/stack-probe` | 周期面 |
| GET | `/anic/api/seg-ledger` | 周期面 |
| POST | `/anic/api/seg-ledger/append` | 周期面 |
| GET | `/anic/api/seg-ledger/verify` | 周期面 |
| GET | `/anic/api/seg-ledger/init` | 周期面 |
| POST | `/anic/review` | 评审进化与治理 |
| GET | `/anic/api/trust` | 评审进化与治理 |
| GET | `/anic/api/autonomy` | 评审进化与治理 |
| POST | `/anic/api/breakers` | 评审进化与治理 |
| POST | `/anic/api/tech-debt` | 评审进化与治理 |
| POST | `/anic/governance/archive` | 评审进化与治理 |
| GET | `/anic/governance/budget` | 评审进化与治理 |
| POST | `/anic/governance/sweep` | 评审进化与治理 |
| GET | `/anic/governance/prune` | 评审进化与治理 |
| POST | `/anic/hitl-audit` | 评审进化与治理 |
| GET | `/anic/band-detect` | 评审进化与治理 |
| GET | `/anic/org-status` | 评审进化与治理 |
| GET | `/anic/fact-base` | 评审进化与治理 |
| GET | `/anic/plan-sync` | 评审进化与治理 |
| POST | `/anic/multi-agent-gate` | 评审进化与治理 |
| POST | `/anic/fix-loop` | 评审进化与治理 |
| POST | `/anic/self/evaluate` | 自举与技能 |
| POST | `/anic/self/gate-check` | 自举与技能 |
| POST | `/anic/self/iterate` | 自举与技能 |
| GET | `/anic/self/status` | 自举与技能 |
| GET | `/anic/skill/list` | 自举与技能 |
| POST | `/anic/skill/invoke` | 自举与技能 |
| POST | `/anic/evaluate` | 自举与技能 |
| POST | `/anic/iterate` | 自举与技能 |
| POST | `/anic/skill/install` | 自举与技能 |
| GET | `/anic/skill/status` | 自举与技能 |
| POST | `/anic/self/dual-evaluate` | 自举与技能 |
| POST | `/anic/self/dual-advance` | 自举与技能 |
| GET | `/anic/self/dual-status` | 自举与技能 |
| GET | `/anic/api/truth-audit` | 自举与技能 |

共 47 个端点（与源码中 `'/anic/...'` 路径字面量的去重计数一致，已用脚本比对，双向零差异）。

## 8. 客户端消费的端点

`src/client/WorkflowGraphPanel.ts:27-31` 只消费其中 5 个：

```ts
const SNAPSHOT_URL    = '/anic/api/workflow-snapshot';
const STEP_TRACE_URL  = '/anic/api/step-trace';
const SELF_CHECK_URL  = '/anic/api/self-check';
const ORG_STATUS_URL  = '/anic/org-status';
const SELF_INIT_URL   = '/anic/self/init';
```

服务端另有三个 URL 构造点供 DSH 工具返回指针：`src/host/tools.ts:195`（`/anic/org-status?workspace=`）、`src/host/toolsPointerGateway.ts:34,51,68`（snapshot / self-check / hitl-audit）、`src/host/toolsSkillGateway.ts:81`（`/anic/skill/install?workspace=`）。

## 相关文档

- 模块布局 → [架构总览.md](架构总览.md)
- 开发规范与守卫 → [开发规范.md](开发规范.md)
- 测试分层 → [测试指南.md](测试指南.md)
