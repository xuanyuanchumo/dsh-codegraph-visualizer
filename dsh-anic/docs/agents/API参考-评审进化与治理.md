# dsh-anic API 参考 · 评审、进化与治理

> 本册覆盖 **review**（条件性 LLM 接入）、**evolution**（trust / autonomy / breakers / tech-debt）、**governance**（archive / budget / sweep / prune）、**native**（7 个脚本的原生等价物），共 16 个端点。
>
> 公共约定见 [API参考.md](API参考.md)。读取本文件的时机：调用或修改评审、自主级别、熔断、治理与原生脚本端点时。

## 1. review 域

### POST `/anic/review`

| 项 | 值 |
| --- | --- |
| 常量 | `REVIEW_ROUTE`（`src/host/routes/reviewRoute.ts:13`） |
| 注册签名 | `registerReviewRoute(register, opts)`（`reviewRoute.ts:28`） |
| 聚合位置 | `src/host/routes/index.ts:73-83` |

**这是全项目唯一使用位置参数式 `register(method, path, handler)` 的模块**，因此 `index.ts:77` 需要一层适配闭包把它转成对象式。`register` 与 `opts` 的完整形状：

```ts
registerReviewRoute(
  register: (method: string, path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void,
  opts: {
    getAgentCards: () => Map<string, AgentCard>;
    probeCtx: unknown;
    defaultProvider?: string;
    defaultModel?: string;
  },
): void
```

**条件性接入的两层降级**（头部注释：「条件性 LLM 接入：probe → Tier-2 / 降级 → Tier-1。INV-23 fail-closed + INV-24 不进 inject。」）：

```ts
const runtime = probeLlm(opts.probeCtx);           // 非 null → LLM 路径
runtime ? await runLlmReview(runtime, card, request, provider, model)
        : heuristicReview(request);                 // null → Tier-1 启发式
```

provider / model 的取值：`typeof body.provider === 'string' ? body.provider : (opts.defaultProvider ?? 'default')`，model 同理。

**Body**：`{ gate: string; role: string; evidence?: { id: string; content: string }[]; provider?: string; model?: string }`。`evidence` 被过滤为 `id` 与 `content` **都是字符串**的条目，其余静默丢弃。

**这是全项目唯一用 `t()` 生成本地化错误文本的路由模块**（`import { t } from '../i18n.ts'`），也是唯一用 `for await (const chunk of req)` 读 body、用裸 `res.writeHead` / `res.end` 而**不走 `sendJson`** 的模块。

| 码 | 条件 | 体 |
| --- | --- | --- |
| 400 | body 无法 JSON.parse | `{ error: 'INVALID_JSON', message: t('review.badJson') }` |
| 400 | body 非对象，或 `gate` / `role` 非字符串 | `{ error: 'INVALID_REQUEST', message: t('review.missingFields') }` |
| 404 | `cards.get(\`anic.agent.${gate}.${role}\`)` 为 undefined | `{ error: 'AGENT_NOT_FOUND', message: t('review.cardNotFound', { cardId }) }` |
| 200 | 正常 | `ReviewVerdict` 对象；响应头额外带 **`X-ANIC-Review-Tier: verdict.tier`** |
| 500 | 外层 catch | `{ error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }` |

**卡 id 的拼接形状是契约**：`anic.agent.${gate}.${role}` —— 因此 `gate` / `role` 必须与 `assets/agents/*.json` 的卡 id 段严格对应。

`X-ANIC-Review-Tier` 头是消费方判断「本次走的是 LLM 还是启发式」的唯一通道 —— 不要从响应体推断。

---

## 2. evolution 域

`src/host/routes/evolutionRoute.ts`。注册签名 `registerEvolutionRoute(ctx: SnapshotCtx, send: SendFn): Array<(() => void) | null>`，`!ctx.webServer` 时返回 `[]`。

本地 `reg(path, method, handler)` 的 `method` 参数**不被传给宿主**（宿主只按 path 注册），因此**四个端点都没有方法检查**。

**四个端点全部只返回 200** —— 没有 404，没有 400。无工作区也不报错。

### 2.1 GET `/anic/api/trust`（`evolutionRoute.ts:40`）

**Query**：`entries` —— 一个 **JSON 字符串**，被 `JSON.parse` 成 `LedgerEntryForTrust[]`。解析失败**静默退化成空数组**（不是 400）。

**响应 200**：`{ trustScores: [...scores.values()], count: result.length }`。

### 2.2 GET `/anic/api/autonomy`（`evolutionRoute.ts:53`）

**Query**：

- `band` —— 默认 `'L2'`，经 `/^L[1-4]$/` 校验，**非法值回退 `'L2'`**（不是 400）。
- `trust` —— 默认 `50`，`parseInt`。

**响应 200**：`{ current: band, trustScore, recommended }`（`recommendBand(band, trustScore)` 的推荐级别）。

### 2.3 POST `/anic/api/breakers`（`evolutionRoute.ts:63`）

**Body**（数字字段经 `Number(parsed.x ?? 0)`，布尔字段经 `Boolean(parsed.x)`，缺省即 0 / false）：

```
consecutiveFixFails, hasDoubt, userDataUnisolated, destructiveNoRollback,
perfUnrecovered, humanRequestsL3, unattendedHours, contextUsagePercent,
totalRetries, totalBreakerTrips
```

**Query**：`band`。

**响应 200**：`{ breakers, action, downgradedBand }` —— 内部流程 `checkBreakers(body)` → `decideAction(band, breakers)` → action 为 `'downgrade'` 时 `downgradeBand(band)`。

**注意布尔强制转换的后果**：`Boolean(parsed.hasDoubt)` 意味着字符串 `'false'` 会被转成 `true`。传参时必须用真正的 JSON 布尔值。

### 2.4 POST `/anic/api/tech-debt`（`evolutionRoute.ts:86`）

**Body**：`results` —— `EvalResult[]`。
**响应 200**：`{ techDebt: entries, count: entries.length }`。

---

## 3. governance 域

`src/host/routes/governanceRoute.ts`。注册签名 `registerGovernanceRoute(ctx: ServerContext, send: SendFn): Array<(() => void) | null>`。

**本域的两处刻意例外，改动前必须知道**：

1. **自带 `resolveRoot(ctx)`**（`governanceRoute.ts:22-28`）：只试 `workspaceRegistry.list()` 再试 `sessions.list()`，**不回退 `process.cwd()`**（与 `snapshotRoute.ts:44` 的 `resolveWorkspaceRoots` 不同）。
2. **无工作区返回 500 而非 404**：`{ error: 'ANIC_ROUTE_NO_WORKSPACE' }`。因为解析不到根在本域被视为服务端错误。

无 `.cycles` 时返回 404 `{ error: 'ANIC_ROUTE_NO_CYCLES' }`。

### 3.1 POST `/anic/governance/archive`（`governanceRoute.ts:42`）

**Body**：`ArchiveOptions`。**响应 200**：`archiveOldCycles(cyclesDir, body)` 的结果。

### 3.2 GET `/anic/governance/budget`（`governanceRoute.ts:54`）

**Query**：`warn` → `thresholds.warnBytes`，`alert` → `thresholds.alertBytes`，两者都 `parseInt`。
**响应 200**：`checkBudget(cyclesDir, thresholds)` 的报告。

### 3.3 POST `/anic/governance/sweep`（`governanceRoute.ts:73`）

**Body**：`SweepOptions`。**响应 200**：`sweepCycles(cyclesDir, body)` 的结果。

### 3.4 GET `/anic/governance/prune`（`governanceRoute.ts:85`）

**响应 200**：`pruneCheck(cyclesDir)` 的报告。**用 GET 做「检查」而非「执行」** —— prune 是只读预检，实际清理走 sweep / archive。

---

## 4. native 域

`src/host/routes/nativeRoute.ts`，头部标注「原生实现路由（7 脚本原生等价物）」。注册签名：

```ts
registerNativeRoute(ctx: unknown, deps: {
  send: SendFn;
  getWorkspaceRoot: () => string | null;
  agentCards: Map<string, AgentCard>;
}): Array<(() => void) | null>
```

`const log = createScoped('anic:route:native')` —— 本模块用 scoped logger。

**两个贯穿全域的约定**：

1. **每个 handler 都调 `newRequestId()` 并把 `rid` 作为 `send` 的第 4 个参数**，因此本域**每个响应都带 `X-ANIC-Request-Id`**。
2. 每个 handler 无工作区时返回 404 `{ error: 'no workspace' }`。

**本域用原生 TS 实现替代了 7 个 skill 脚本**，因此它**不需要** `.dsh/skills/` 已安装 —— 这是与 self / skill 域的关键差异。

### 4.1 POST `/anic/hitl-audit`（`nativeRoute.ts:37`）

**响应 200**：`runHitlAudit(root)` 的结果。

### 4.2 GET `/anic/band-detect`（`nativeRoute.ts:46`）

**Query**：`score` —— 经正则 `r?.url?.match(/score=([0-9.]+)/)` 提取，默认 `1.0`，再 `Math.max(0, Math.min(1, parsed))` 夹取到 `[0,1]`。

**响应 200**：`runBandDetection(root, score)` 的结果。

**正则提取意味着非数字输入静默回退到 1.0** —— 不会 400。示例：`/anic/band-detect?score=0.75`。

### 4.3 GET `/anic/org-status`（`nativeRoute.ts:59`）

**响应 200**：`runOrgStatus(root, {})` 的结果。这是客户端 `ORG_STATUS_URL`（`src/client/WorkflowGraphPanel.ts:30`）消费的端点，也被 `src/host/tools.ts:195` 作为工具返回的指针 URL。

### 4.4 GET `/anic/fact-base`（`nativeRoute.ts:68`）

**响应 200**：`runFactBaseVerify(root)` 的结果。

### 4.5 GET `/anic/plan-sync`（`nativeRoute.ts:77`）

**响应 200**：`runPlanSync(root)` 的结果。

### 4.6 POST `/anic/multi-agent-gate`（`nativeRoute.ts:86`）

**Body 被完全忽略** —— handler 的参数名是 `_req`。

```ts
const evidenceByGate: Record<string, { content: string; id: string }[]> = {};
const results = runAllGates(deps.agentCards, evidenceByGate);
send(res, 200, { gates: results, allPassed: results.every((g) => g.passed) });
```

源码注释：`// 简化：运行全部门禁`。因此**当前无法按 gate 传入 evidence** —— 无论请求体里传什么，都是对全部 gate 跑一次空证据评估。若需要按 gate 定向评估，必须改这个 handler，而不是改调用方。

**响应 200**：`{ gates, allPassed }`。

### 4.7 POST `/anic/fix-loop`（`nativeRoute.ts:97`）

**Body 也被忽略**（同样 `_req`）。头部注释里写的 `verifyCommand` 参数**未实现**。

**实际校验函数只做一件事**：

```ts
const ledgerExists = existsSync(join(root, '.cycles', 'gates', 'ledger.json'));
{ passed: ledgerExists, report: ledgerExists ? 'all checks passed' : 'ledger missing' }
```

**响应 200**：`runFixLoop(root, verifyFn)` 的结果。

**这是全项目最弱的验证**：它只检查账本文件**存在**，不校验内容、不运行任何命令、不比对哈希。`report: 'all checks passed'` 的实际含义仅是「文件在」。把它当作「修复已验证」会得到错误结论。

---

## 相关文档

- 公共约定与端点总索引 → [API参考.md](API参考.md)
- 数据面 → [API参考-数据面.md](API参考-数据面.md)
- 周期面 → [API参考-周期面.md](API参考-周期面.md)
- 自举 / 技能 / 安装 / 双自举面 → [API参考-自举与技能.md](API参考-自举与技能.md)
