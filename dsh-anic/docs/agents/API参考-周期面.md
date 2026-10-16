# dsh-anic API 参考 · 周期面

> 本册覆盖 **cycle 域**：cycle / ledger / stack-probe / seg-ledger，共 13 个端点。
>
> 公共约定（注册机制、响应形状、状态码语义、无工作区解析链、磁盘形状）见 [API参考.md](API参考.md)。数据面见 [API参考-数据面.md](API参考-数据面.md)。
>
> 读取本文件的时机：调用或修改周期状态机、账本、或技术栈探测端点时。

## 1. POST `/anic/cycle/init`

| 项 | 值 |
| --- | --- |
| 路径 | `src/host/routes/cycleRoute.ts:37` |
| 注册 | `registerCycleRoute(ctx, { send, getWorkspaceRoot })`（`cycleRoute.ts:31`） |

**Body**：`{ projectName?: string }`。
**响应 200**：`{ ok: true, ...initCycle(cyclesDir, projectName) }`。
**404**：无工作区 → `{ error: 'no workspace' }`。

## 2. POST `/anic/cycle/advance`

**路径**：`cycleRoute.ts:46`。

**Body**：

```ts
{ cycleNumber: number; nodeId: string; gateApproved?: boolean;
  gate?: string; gateName?: string; result?: 'PASS' | 'FAIL'; detail?: string }
```

**校验**（`cycleRoute.ts:47`）：

```ts
if (!cycleNumber || !nodeId || !Number.isInteger(cycleNumber) || cycleNumber < 1)
  → 400 { error: 'cycleNumber (positive integer) and nodeId required' }
```

注意 `!cycleNumber` 使 `0` 也落进 400，与 `cycleNumber < 1` 冗余但无害。

**响应**：`advanceCycle(cyclesDir, cycleNumber, nodeId, record)` 的结果对象本身，状态码 `result.ok ? 200 : 409` —— **不是** `{ ok: true }` 信封，而是业务结果整体作为响应体。

## 3. POST `/anic/cycle/close`

**路径**：`cycleRoute.ts:56`。**Body** `{ cycleNumber: number }`。
**400**：`{ error: 'cycleNumber (positive integer) required' }`。
**响应**：`closeCycle(cyclesDir, cycleNumber)` 结果，`result.ok ? 200 : 409`。

## 4. GET `/anic/cycle/state`

**路径**：`cycleRoute.ts:66`。**Query**：无。

**响应 200（两个分支）**：

```ts
// 无 workflow graph：
{ nodes: [], state: {} }
// 有 graph：
{ nodes: graph.nodes, edges: graph.edges, state }
```

`state` 的取值有回退：`loadState(cyclesDir)` 为空对象时用 `initState(graph)` 初始化（`cycleRoute.ts`）。

## 5. GET `/anic/cycle/list`

**路径**：`cycleRoute.ts:77`。**响应 200**：`{ cycles, nextCycleNumber }`（来自 `listCycles(cyclesDir)` 与 `nextCycleNumber(cyclesDir)`）。

## 6. ledger 家族

`src/host/routes/ledgerRoute.ts`，三个端点，全部 `kind: 'exact'`，全部在无工作区时 404 `{ error: 'no workspace' }`。读写经 `src/host/runtime/ledger.ts`（`loadLedger` / `appendEntry` / `verifyLedger` / `isDuplicate` / `computeHash`）。

**磁盘形状：`<root>/.cycles/gates/ledger.json` 是 `{ entries: [...] }`，不是裸数组。** 这是所有 ledger 端点响应形状的上游 —— 改磁盘形状等于改 API。

### 6.1 GET `/anic/api/ledger`（`ledgerRoute.ts:46`）

**Query**：`offset`（默认 0）、`limit`（默认 `entries.length`），两者都走 `parseInt(_, 10)`。**非法值不做校验** —— `parseInt('abc')` 得到 `NaN`，`slice(NaN, NaN)` 得到空数组，因此畸形 query 返回空 `entries` 而非 400。

**响应 200**：

```ts
{ total: entries.length, entries: entries.slice(off, off + lim) }
```

`total` 是**切片前**的总数，因此消费方可以据此判断是否还有更多。

### 6.2 POST `/anic/api/ledger/append`（`ledgerRoute.ts:57`）

**Body**：`{ gate: string; gateName?: string; result: 'PASS' | 'FAIL'; detail?: string }`

| 码 | 条件 | 体 |
| --- | --- | --- |
| 400 | `!gate \|\| !result` | `{ error: 'gate and result required' }` |
| 400 | `result !== 'PASS' && result !== 'FAIL'` | `{ error: 'result must be PASS or FAIL' }` |
| 409 | `isDuplicate(cyclesDir, gate, result)` | `{ error: 'duplicate', message: \`last entry is already ${gate}/${result}\` }` |
| 200 | 正常 | `{ ok: true, entry }` |

写入时 `gateName` 缺省回退为 `gate`，`detail` 缺省回退为空串：`appendEntry(cyclesDir, { gate, gateName: gateName ?? gate, result, detail: detail ?? '' })`。

**409 的语义**：只比对**最后一条**条目（`last entry is already …`），不是全量查重。因此 `A/PASS → B/PASS → A/PASS` 的第三条会被接受。

### 6.3 GET `/anic/api/ledger/verify`（`ledgerRoute.ts:73`）

**响应 200**：`verifyLedger(cyclesDir)` 的结果，形状 `{ ok, total, brokenAt, reason }`。**校验失败也是 200** —— 与 self-check 同族的「诚实形态」：链断裂是一个被成功报告的事实，不是请求失败。

## 7. GET `/anic/api/stack-probe`

| 项 | 值 |
| --- | --- |
| 路径 | `src/host/routes/stackProbeRoute.ts:22` |
| 注册 | `registerStackProbeRoute(ctx, { send, getWorkspaceRoot })`（`stackProbeRoute.ts:17`） |

**响应 200**：`{ ...probeStack(root), configYaml: configToYaml(result.config) }` —— 探测结果与生成的 YAML 配置文本一并返回（F3 能力：探测技术栈并给出建议配置）。
**404**：`{ error: 'no workspace' }`。

## 8. seg-ledger 家族

`src/host/routes/segmentedLedgerRoute.ts`，四个端点。目录常量 `LEDGER_SEG_DIR = 'gates'`（`segmentedLedgerRoute.ts:15`），实际路径 `<root>/.cycles/gates/`，内含 `head.json` + `seg-*.jsonl`。

**两处与其他模块不同，必须注意**：

1. **注册守卫更弱**：只有 `if (!c.webServer) return null;`，**不检查** `typeof register === 'function'`（其余模块都查）。
2. **无工作区返回 404 `{ error: 'workspace not found' }`** —— 措辞与其他模块的 `'no workspace'` 不同，消费方若按字符串匹配会漏。

### 8.1 GET `/anic/api/seg-ledger`（`segmentedLedgerRoute.ts:43`）

**响应**：

| 码 | 条件 | 体 |
| --- | --- | --- |
| 404 | `loadSegmented(dir)` 为 null | `{ error: 'segmented ledger not initialized' }` |
| 200 | 正常 | `{ head, entryCount: data.entries.length, entries: data.entries.slice(-100), segmentFiles: listSegmentFiles(dir) }` |

**`entries` 是「最后 100 条」**（源码注释 `// 最后 100 条`），取尾部而非头部；`entryCount` 是总数，因此两者不等时说明被截断。

### 8.2 POST `/anic/api/seg-ledger/append`（`segmentedLedgerRoute.ts:61`）

**先调 `initSegmentedLedger(dir)`（幂等）**，因此 append 可以隐式初始化分段账本。

**Body**：`{ gate?, gateName?, result?, detail? }`

| 码 | 条件 | 体 |
| --- | --- | --- |
| 400 | `!body \|\| !body.gate \|\| !body.result` | `{ error: 'missing gate or result' }` |
| 409 | `isDuplicateSegmented` | `{ error: 'duplicate entry (idempotent reject)' }` |
| **201** | 正常 | `{ entry, head }` |

**这是全项目唯一返回 201 的写端点**（与 `/anic/api/seg-ledger/init` 并列）。时间戳由服务端生成：`timestamp: new Date().toISOString()`。

### 8.3 GET `/anic/api/seg-ledger/verify`（`segmentedLedgerRoute.ts:102`）

**响应 200**：`verifySegmented(dir)` 的结果。

### 8.4 GET `/anic/api/seg-ledger/init`（`segmentedLedgerRoute.ts:113`）

**响应 201**：`{ head }`。**用 GET 做写操作**是该端点的既定形态（初始化幂等），但它意味着任何预取/爬虫式 GET 都可能创建文件。

## 相关文档

- 公共约定与端点总索引 → [API参考.md](API参考.md)
- 数据面（snapshot / step-trace / self-check / self-init） → [API参考-数据面.md](API参考-数据面.md)
- 评审 / 进化 / 治理 / 原生脚本面 → [API参考-评审进化与治理.md](API参考-评审进化与治理.md)
- 自举 / 技能 / 安装 / 双自举面 → [API参考-自举与技能.md](API参考-自举与技能.md)
