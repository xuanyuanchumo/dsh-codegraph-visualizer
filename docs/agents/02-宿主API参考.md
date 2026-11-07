# 02 · 宿主 API 参考

> cycle-110 更新（2026-10-28）：路由 **18 → 19**（新增 `/churn`）、工具 **10 → 11**（新增 `graph_query`）、
> 错误码口径纠正为 **25**（原文「27」与行号 `:426-452` 都不对）、路由/工具行号按当前源码重取。
> 上一版（cycle-102）：§3.5 ETag 决策矩阵、§3.6 跨源条件请求 CO-3、§13 增量更新层。

> 面向改 `src/index.ts` / `src/host/**` / `src/tools.ts` / `src/adapters/**` 的开发者。
> 所有路径与行号基于 `dsh-codegraph-visualizer@0.2.0`。
> 文档族版本 1.2.0 · 声明宿主 `>=0.2.0-rc.2 <0.4.0-0` · 已验证宿主 `0.2.1-rc.3`（见 [09](./09-破坏性变更与兼容策略.md) §2）

---

## 1. 插件入口 `src/index.ts`

```ts
export const name = 'dsh-codegraph-visualizer';                    // :25
export const inject = ['tools', 'webServer', 'sessions'];          // :30
export async function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>): Promise<void>; // :32
```

**`apply()` 执行顺序**（顺序有语义，不要重排）：

| 步骤 | 调用 | 说明 |
|---|---|---|
| 1 | `closeAllDbConnections()` | 清掉上一次加载残留的 SQLite 连接 |
| 2 | `resolveConfig(userConfig)` | 校验并填默认值，失败抛 `INVALID_CONFIG` |
| 3 | `createSecurityManager()` + `setAllowedWorkspaceRoots(extractWorkspacePaths(ctx))` | 初始 allowlist |
| 4 | `detectHostVersion(ctx)` | 三路启发式，可能得 `unknown` |
| 5 | `createFeatureFlags(hostVersionInfo, createHostCapabilityProbe(ctx))` | **探针只把能力打开，不做 gate** |
| 6 | `createApiCompatLayer(hostVersionInfo)` | 多代适配层 |
| 7 | `new GraphRepository(primaryWorkspace)` + `init()` | 本地图谱库 |
| 8 | `await createGraphTools(ctx, { requestTimeout, apiCompat })` | 得 **11** 个 tool + 一个 dispose |
| 9 | `ctx.effect(...)` 注册 **11** 个 tool | 标签 `'codegraph: tool registrations'`；注册集合必须等于工厂返回集合（`tests/unit/plugin.test.ts`） |
| 10 | `createInvokeUpstream(...)` → `routeDeps` | 路由依赖对象 |
| 11 | `registerService(routeDeps)` + `registerRoutes(routeDeps)` | 服务 + **19** 条路由 |
| 12 | 前置依赖轮询（`MAX_POLLS = 6`） | `emit('codegraph-visualizer/prerequisite/status')` |
| 13 | `registerEventListeners` + `registerWatcher` | 事件与文件监听 |
| 14 | `new McpServer()` 在 `ctx.effect` 内 `start()`/`stop()` | MCP 面 |
| 15 | 末尾 `ctx.effect` 清理 | `destroyed=true`、清两个 Map、`securityManager.reset()`、`disposeGraphTools()`、`closeAllDbConnections()`、`graphRepo.close()` |

**模块级导出**：`PLUGIN_VERSION`、`resolveConfig`、`DEFAULT_CONFIG`、`VisualizerConfig`（类型）、
`SecurityManager`、`createSecurityManager`。

---

## 2. 配置 `src/host/config.ts`

### 2.1 `VisualizerConfig`（11 字段）

| 字段 | 类型 | 默认值 | 语义 |
|---|---|---|---|
| `dataSource` | `'auto'\|'codegraph'\|'lens'\|'tree-sitter'\|'dependency'` | `'auto'` | 上游数据源选择 |
| `requestTimeout` | number | `15000` | 上游请求超时（ms） |
| `scanCacheTtl` | number | `30000` | 扫描缓存存活（ms） |
| `scanCacheLimit` | number | `4` | 扫描缓存条目上限 |
| `maxBodyBytes` | number | `1048576` | 请求体上限（1 MiB） |
| `prerequisiteRetryDelay` | number | `3000` | 前置依赖轮询间隔（ms） |
| `watchDebounce` | number | `500` | 文件监听去抖（ms） |
| `maxNodes` | number | `500000` | 返回节点数硬上限 |
| `allowedOrigins` | string[] | `['http://localhost:3080']` | CORS 白名单 |
| `panelMinHeight` | number | `240` | 面板最小高度（px） |
| `panelDefaultHeight` | number | `600` | 面板默认高度（px） |

### 2.2 `resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig`

校验规则：
- `dataSource` 必须 ∈ `VALID_DATA_SOURCES`（5 值）；
- `allowedOrigins` 每项必须匹配 `ORIGIN_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/`；
- 9 个数字字段必须为**正有限数**；
- `panelDefaultHeight >= panelMinHeight`。

失败时抛 `${ERROR_CODES.INVALID_CONFIG}: ${errors.join('; ')}`。

---

## 3. 服务与路由

### 3.1 服务接口 `IGraphVisualizerService`（`src/types/index.ts:529`）

`registerService(routeDeps)` 把 `deps` 暴露为 Cordis 服务；`routeDeps` 形状见
`src/host/routes/shared.ts:315-331`：

```ts
export interface RouteDeps {
  ctx: Context;
  config: VisualizerConfig;
  securityManager: SecurityManager;
  invokeUpstream?: UpstreamInvoker;
  apiCompat?: ApiCompatLayer;
  featureFlags?: FeatureFlags;
  getLastGraphData: () => GraphData | null;
  setLastGraphData: (data: GraphData | null) => void;
  getLastInitResult: () => { success: boolean; path: string; message: string; timestamp: number } | null;
  setLastInitResult: (data: {...} | null) => void;
  getScanCache: () => Map<string, { data: GraphData; timestamp: number }>;
  getScanInFlight: (path: string) => Promise<GraphData> | null;
  setScanInFlight: (path: string, p: Promise<GraphData> | null) => void;
  graphRepo?: GraphRepository | undefined;
  isDestroyed: () => boolean;
}
```

### 3.2 19 条路由（`src/host/routes.ts` 的 `registerRoutes`）

全部挂在 `/api/v1/codegraph` 前缀下。下表「行」列指**注册函数定义行**
（`grep -n "^export function register" src/host/routes/*.ts` 可复验）；`routePath` 常量紧随其后约 3 行。

| # | 注册函数 | 路径 | 文件:行 | 方法 |
|---|---|---|---|---|
| 1 | `registerStatusRoute` | `/status` | `statusRoutes.ts:6` | GET |
| 2 | `registerHealthRoute` | `/health` | `statusRoutes.ts:28` | GET |
| 3 | `registerWorkspaceRoute` | `/workspace` | `statusRoutes.ts:67` | GET |
| 4 | `registerDataRoute` | `/data` | `dataRoutes.ts:62` | GET |
| 5 | `registerScanRoute` | `/scan` | `controlRoutes.ts:14` | POST |
| 6 | `registerInitRoute` | `/init` | `controlRoutes.ts:96` | POST |
| 7 | `registerWatchRoute` | `/watch` | `controlRoutes.ts:165` | POST |
| 8 | `registerDependenciesRoute` | `/dependencies` | `analysisRoutes.ts:36` | GET |
| 9 | `registerChurnRoute` | `/churn` | `analysisRoutes.ts:129` | GET |
| 10 | `registerDiffRoute` | `/diff` | `analysisRoutes.ts:198` | POST |
| 11 | `registerAstRoute` | `/ast` | `analysisRoutes.ts:278` | POST |
| 12 | `registerTreeSitterRoute` | `/tree-sitter` | `analysisRoutes.ts:317` | POST |
| 13 | `registerBootstrapRoute` | `/bootstrap` | `dataRoutes.ts:104` | GET |
| 14 | `registerNodeChildrenRoute` | `/children` | `dataRoutes.ts:193` | GET |
| 15 | `registerFileOutlineRoute` | `/files/{id}/outline` | `dataRoutes.ts:268` | GET |
| 16 | `registerSymbolASTRoute` | `/symbols/{id}/ast` | `dataRoutes.ts:329` | GET |
| 17 | `registerEdgesRoute` | `/edges` | `dataRoutes.ts:439` | GET |
| 18 | `registerEventsRoute` | `/events` | `controlRoutes.ts:191` | GET（SSE） |
| 19 | `registerLayoutWorkerRoute` | `/worker/layoutWorker.js` | `workerRoutes.ts:69` | GET |
| **20** | `registerKeywordQueryRoute`（⟨待 T3 落地后回填⟩） | `/query` | ⟨待 T3⟩ | GET |

**行数的当前事实**（cycle-111 实测，T3 落地前）：

```bash
grep -rho "^export function register[A-Za-z]*Route" src/host/routes/*.ts | wc -l   # → 19
grep -rn "registerKeywordQueryRoute" src/                                          # → 0 命中
```

⇒ **上表第 20 行是「已规划、未落地」**。`/query` 的契约见
[11-图检索与关键词查询.md](./11-图检索与关键词查询.md) §5。
`19` 这个数字在本轮**没有变化**；T3 落地后应同时改为 20 并回填行号。

**注册顺序的两条约束**：

1. `/churn` **刻意注册在最后**（`routes.ts:68-73` 有 5 行源码注释）：`registerRoutes` 的
   调用顺序就是 `webServer.register` 的顺序，而既有测试大量用「第 N 次注册」定位路由
   （`getHandler(ctx, 3)`）。插在中间会让十几个无关用例整体错位一格。
2. 新增 `/query` 的**建议位置**：⟨待 T3/Lead 实测后回填⟩——任务书要求「保持在
   `registerChurnRoute` 之前」，但那会让 `getHandler(ctx, N)` 的既有索引整体前移一格，
   必须**先跑 `tests/unit/routes.test.ts` 确认影响面**再定（见 [09](./09-破坏性变更与兼容策略.md) §6）。

> 所有路由都是 `kind: 'exact'` 精确路径，顺序不影响匹配语义。

**共享资源**（同一函数体内）：一个 `TreeSitterAdapter` 实例在 #11/#12 间共享，
并在 `ctx.effect` 里 `destroy()`；`rateLimiter` 同样在 `ctx.effect` 里 `reset()`。

### 3.3 路由中间件管线（`src/host/routes/shared.ts:43` `withRouteMiddleware`）

```
handleCorsPreflight → requireMethod → logRequest → checkRate → try { handler } catch { sendError(500, INTERNAL_ERROR) }
```

**新路由必须走这个包装**，否则会丢掉 CORS、方法校验、限流与统一 500 兜底。

### 3.4 条件请求（ETag）——P3-R18-02 的闭环

`src/host/routes/shared.ts` 提供三个函数，**必须配套使用**：

| 函数 | 行 | 作用 |
|---|---|---|
| `resourceEtag(deps, resource, repoId?, requestKey?)` | `:220` | 校验值**唯一构造点**；槽空返回 `null` |
| `etagGuard(req, res, corsConfig, deps, resource, repoId?, requestKey?)` | `:256` | 返回 `EtagDecision { handled, etag }`——**一次调用同时给两件事** |
| `etagHeaders(etag)` | `:277` | 转成 `sendJson` 的 `extraHeaders` |

**铁律**：
1. **不要**把「算校验值」和「回传校验值」分开写——那正是"校验器可达但校验值不可达"的成因。
   用 `etagGuard` 的返回值，结构上不可能只做一半。
2. 参数化路由（`/children`、`/files/*/outline`、`/symbols/*/ast`、`/edges`）
   **必须**传 `requestKey`，且键必须覆盖所有改变载荷的参数。
   现成构造函数在 `src/shared/graphFingerprint.ts`：
   - `etagKeyForChildren(nodeId, cursor, limit)` `:141`
   - `etagKeyForOutline(nodeId)` `:145`
   - `etagKeyForAst(nodeId, cursor, budget)` `:149`
   - `etagKeyForEdges(fromId, scope, cursor, limit, detail)` `:170`
   - `resolveAstBudget(raw)` `:161`（两侧**计算**预算，不得各自硬编码）
3. `repoId` 传**请求方声明的工作区**（`resolveWorkspaceFromRequest()` 的结果），
   revision 取槽的——方向刻意偏保守：多算一次不匹配只多回一次 200，假 304 会静默丢真实更新。
4. 所有 `sendJson(res, 200, ...)` 都要带 `etagHeaders(etag)`。
   **守卫**：`tests/unit/etagContract.test.ts` 源码扫描 `src/host/routes/` 下**每一个** `sendJson(res, 200, …)` 调用点
   （按文件分组断言，并带「括号平衡」「字符串里的括号」两条反向自检）。
   调用点总数用 `grep -rho "sendJson(res, 200" src/host/routes/ | wc -l` 复验，**不要写死数字**。

### 3.5 ETag 决策矩阵——cycle-100 的收口（§59.32）

**每条路由必须对自己的缓存语义表态**。19 条路由按 RouteClass 分类，
契约由 `tests/unit/etagCoverageContract.test.ts` 钉死（`DECISION_MATRIX` 逐条登记 + 源码扫描提取路由清单 + 反向自检）：

| RouteClass | 路由 | 为什么 |
|---|---|---|
| `etag-guarded`（6） | `/data` `/bootstrap` `/children` `/files/*/outline` `/symbols/*/ast` `/edges` | 图数据族：载荷来自图谱槽/DB，`etagGuard` + `requestKey` 完整条件请求 |
| `etag-guarded`（⟨待 T3⟩ +1） | `/query` | 参数化查询（`q`/`depth`/`tokenBudget`/工作区/revision 五维请求键）；契约见 [11](./11-图检索与关键词查询.md) §5.3。**T3 落地前该路由不存在，`DECISION_MATRIX` 里也不应有这一行**——先加行会让 `etagCoverageContract.test.ts` 报「登记了但源码里没有」 |
| `content-etag`（2） | `/dependencies`、`/churn` | 载荷与图谱槽**不同域**，校验值必须同域计算：`/dependencies` = 磁盘 manifest 内容哈希（`computeDependenciesEtag(workspacePath, manifestInputs)`，`analysisRoutes.ts` 内）；`/churn` = git log 输出，校验值 = (工作区, HEAD revision, 可用性) 三元组——采集从失败转成功必须让旧 304 失效 |
| `post`（6） | `/scan` `/init` `/watch` `/diff` `/ast`(POST) `/tree-sitter` | POST 无条件请求语义（GET-only 的 if-none-match 不适用） |
| `sse`（1） | `/events` | SSE 长连接无 304 概念 |
| `diagnostic`（3） | `/status` `/health` `/workspace` | 诊断信息要求每次新鲜，缓存反而有害 |
| `static-worker`（1） | `/worker/layoutWorker.js` | 静态 JS：`cache-control: no-cache` 是它的域，不用 etag |

**给新路由开发者的规则**（两条都由守卫测试强制）：
1. 新增路由**必须**在 `etagCoverageContract.test.ts` 的 `DECISION_MATRIX` 里登记 RouteClass，否则测试红；
2. `etag-guarded`/`content-etag` 类的 200 响应必须带 etag 头，`post`/`sse`/`diagnostic`/`static-worker` 类**禁止**出现条件请求机制——往 POST/SSE 上撒 etag 不是优化，是把「无语义」伪装成「有语义」。

**/dependencies 的教训**（§59.32 R10）：校验器与被校验资源**同域**的第三变体——
第一变体是 `graphEtag`（revision 域，§59.31），第二变体是 requestKey（参数域，cycle-91），
第三变体是内容哈希域（载荷不经过任何槽，直接对原始输入做指纹）。
选错域的家族病都是假 304：用图谱槽的 revision 给 manifest 载荷当校验器，
和当年用 `metadata.timestamp` 当校验器是同一种错。

### 3.6 跨源条件请求（CO-3）——cycle-101 的闭环（§59.33）

**背景**：CORS 头写对了 ≠ 跨源 JS 真的能读到。桌面壳 / dsh-remote-web-ui 场景下，
页面 origin ≠ API origin，条件请求要跑通需要**三元组**全部成立：

| 元 | 实现 | 位置 |
|---|---|---|
| ① 预检放行 `if-none-match` | `allow-headers: 'content-type, if-none-match'` | `HttpHelpers.ts:74-92` `buildCorsHeaders` |
| ② 304 分支也带 CORS 头 | 304 不是 200，走 `writeHead(304, {...buildCorsHeaders(...), etag})`——**不能**只在 200 分支出 CORS 头，否则浏览器把 304 当错误拦截 | `routes/shared.ts:196-211` `checkEtag` 304 分支 |
| ③ 响应头对 JS 可读 | `expose-headers: 'etag, x-truncated'`——没有它跨源 JS 读 `res.headers.get('etag')` 得 `null`，条件请求永远发不出去 | `HttpHelpers.ts:81` |

**白名单**：`allow-origin` 只在请求 `Origin` 精确命中 `config.allowedOrigins` 时回写
（`package` 自带 `cordis.patch.yml` 显式配置 `localhost:3080` + `127.0.0.1:3080`；
未命中时头缺失，浏览器默认拒绝）。源清单经 `ORIGIN_PATTERN` 校验。
**负路径**：opaque origin（沙箱 iframe 的 `Origin: null`）被浏览器拦截——这是预期行为。

**铁律**：
1. etag 头**必须**走 `sendJson` 的 `extraHeaders`（`HttpHelpers.ts:102-106` 注释）——
   直接 `writeHead` 会绕过 `buildCorsHeaders`，同源测试全绿、跨源静默失效；
2. 客户端 304 与网络失败必须区分（`EtagSink.notModified`），`if (!res.ok) return null`
   会把「服务端说没变」吞成「客户端没数据」；
3. 守卫：`tests/unit/routes.test.ts` describe `cross-origin conditional requests (CO-3)` 5 用例
   （origin 回显+expose / 白名单拒绝 / **304 带 etag+allow-origin+expose**——核心回归点 /
   异源 304 语义 / 预检 204 放行 if-none-match）。

---

## 4. HTTP 辅助 `src/host/HttpHelpers.ts`

| 导出 | 行 | 签名 / 作用 |
|---|---|---|
| `getClientIp` | `:9` | `(req) => string` |
| `readBody` | `:14` | `(req, maxBodyBytes) => Promise<string>` |
| `parseJsonBody` | `:33` | `(body) => Record<string, unknown>` |
| `extractStringField` | `:41` | `(obj, field, maxLength?) => string \| undefined` |
| `extractBooleanField` | `:49` | `(obj, field) => boolean \| undefined` |
| `isSafeGitRef` | `:56` | `(ref) => boolean` |
| `CorsConfig` | `:70` | `{ origins: string[] }` |
| `buildCorsHeaders` | `:74` | `(req, config) => Record<string,string>` |
| `handleCorsPreflight` | `:94` | `(req, res, config) => boolean`（true 表示已处理） |
| `ExtraResponseHeaders` | `:107` | `Record<string,string>` |
| `sendJson` | `:109` | `(res, code, payload, req?, config?, extraHeaders?)` |
| `sendError` | `:126` | `(res, httpCode, errorCode, req?, config?, detail?)` |
| `requireMethod` | `:132` | `(req, res, method, config) => boolean` |
| `checkRate` | `:138` | `(req, res, routePath, rateLimiter, config) => boolean` |
| `logRequest` | `:146` | `(req, routePath) => void` |

> ⚠️ `sendJson` 的第 6 参 `extraHeaders` 顺序是
> `{ 'content-type', ...buildCorsHeaders(...), ...extraHeaders }`。
> **不要**绕过 `sendJson` 直接 `writeHead`——会丢掉 `buildCorsHeaders`，
> 跨源客户端（桌面端 / `dsh-remote-web-ui`）读不到 `etag`，条件请求静默失效而本机测试全绿。

---

## 5. 安全 `src/host/security.ts`

```ts
export type WorkspaceRootSource = 'registry' | 'sessions' | 'cwd' | 'unknown';   // :23
export interface WorkspaceRootsSnapshot { ... }                                   // :25
export class SecurityManager { ... }                                              // :30
export function createSecurityManager(): SecurityManager                          // :91
```

**allowlist 必须每请求重新解析**（`ensureWorkspaceRootsAllowed`，`routes/shared.ts:84`）：
曾因在 `apply()` 里冻结 allowlist，导致宿主后注册的工作区被 **403 且无诊断**
（`docs/需求分析.md` §31.7）。roots **只来自宿主服务**（`workspaceRegistry`/`sessions`/cwd），
**绝不来自请求**，所以在请求期扩大列表不可能被用来读任意路径。

### 5.1 路径校验函数族（`routes/shared.ts`）

| 函数 | 行 | 用途 |
|---|---|---|
| `isSafeRelativePath(value, maxLength)` | `:34` | 形态检查；**两平台都接受 `/` 与 `\`**；拒绝绝对路径、`X:`、`\\` 开头、normalize 后以 `..` 开头 |
| `resolveWorkspaceFromRequest(req, ctx, deps)` | `:99` | 尊重 `?workspace=<path>` |
| `resolveAndValidatePath(pathInput, ...)` | `:113` | 工作区级校验（`PATH_NOT_ALLOWED` / `WORKSPACE_PATH_NOT_ALLOWED` / `SYMLINK_ESCAPE`） |
| `resolveAndValidateRelativePath(relativePath, ...)` | `:138` | 相对路径级（额外 `PATH_OUTSIDE_WORKSPACE`） |
| `validateWorkspacePath(ctx, deps, req?)` | `:166` | 返回路径或 `'__denied__'` |

---

## 6. 错误码 `src/shared/constants.ts`

### 6.1 `ERROR_CODES`（`:460-486`，共 **25** 个）

> **纠偏（cycle-110）**：原文写「`:426-452`，共 27 个」——行号与数量**都不对**。
> 当前 `ERROR_CODES` 起于 `:460`、止于 `:486`，共 25 条；`ERROR_MESSAGES` 紧随其后
> `:488-514`，同样 25 条，两者键集合**完全相等**（无遗漏、无孤儿）。

```
PATH_NOT_ALLOWED            WORKSPACE_PATH_NOT_ALLOWED   SYMLINK_ESCAPE
NO_WORKSPACE_PATH           PATH_OUTSIDE_WORKSPACE       SCAN_FAILED
INIT_FAILED                 WATCH_TOGGLE_FAILED          WATCH_SETUP_FAILED
INTERNAL_ERROR              COMMITS_REQUIRED             INVALID_GIT_REF
GRAPH_DIFF_FAILED           FILEPATH_REQUIRED            FILE_TOO_LARGE
AST_PARSE_FAILED            FILEPATH_AND_CONTENT_REQUIRED INVALID_FILEPATH
CONTENT_TOO_LARGE           METHOD_NOT_ALLOWED           RATE_LIMIT_EXCEEDED
SYMBOL_NOT_FOUND            BODY_TOO_LARGE               INVALID_JSON_BODY
INVALID_CONFIG
```

计数方式（**不要**用 `grep -c "^  [A-Z_]*:" src/shared/constants.ts`，它会把其它常量对象的键一起数进来）：

```bash
awk '/^export const ERROR_CODES/,/^} as const;/' src/shared/constants.ts | grep -c "^  [A-Z_]*:"
# 期望 25
```

### 6.2 `ERROR_MESSAGES`（`:488-514`）—— 每条含 `{ en, zh }`

示例：`PATH_NOT_ALLOWED { en: 'Path not allowed', zh: '路径不允许访问' }`、
`SYMLINK_ESCAPE { en: 'Access denied: symlink escape', zh: '访问被拒绝：符号链接逃逸' }`。

### 6.3 其它常量

- `REPO_URL` `:481` = `https://github.com/xuanyuanchumo/dsh-codegraph-visualizer`
- `IMPORT` `:482` = `{ MAX_PASTE_BYTES: 10 * 1024 * 1024, ... }`
- `RENDERER` / `LAYOUT_WORKER` / `CLUSTER` / `API` 等见 `src/shared/constants.ts` 全文（582 行）

**新增错误码必须同时加 `ERROR_MESSAGES` 的中英双语**，否则 `sendError` 渲染不出可读文案。

---

## 7. 工具面 `src/tools.ts`

`import { defineTool } from '@deepseek-ai/dsh-tools';` —— **11 个工具**（cycle-110 新增第 11 个 `graph_query`）：

| 工具 | `name:` 行 | 参数要点 |
|---|---|---|
| `graph_status` | `:265` | `repoId`（string, required） |
| `graph_data` | `:286` | `repoId` + `source`（enum: `codegraph\|lens\|both\|auto`） |
| `graph_symbol` | `:312` | `repoId` + 符号标识 |
| `graph_impact` | `:333` | `repoId` + 目标节点 |
| `graph_path_find` | `:354` | `repoId` + 起点/终点 |
| `graph_path_enumerate` | `:396` | `repoId` + 规则/长度约束（走璇玑图 `enumerate`） |
| `graph_cycles` | `:480` | `maxLength`（默认 6/上限 12）、`limit`（默认 100/上限 500）、`edgeTypes` |
| `graph_health` | `:553` | `repoId` |
| `graph_rules_check` | `:589` | `repoId` + 规则集 |
| `graph_focus` | `:634` | `repoId` + 聚焦目标 |
| `graph_query` | `:675` | `repoId` + 关键词/符号查询（GF-P0-2；CJK token 估算单独标定，见 [11](./11-图检索与关键词查询.md) §2） |

> 「`name:` 行」用 `grep -n "  name: '" src/tools.ts` 复验。**行号会随改动漂移**，
> 以**工具名**为准、行号只用于快速定位。

**注册集合契约**（这一行比上表更重要）：

```bash
grep -c "defineTool(" src/tools.ts        # 11  —— 工厂产出
grep -c "ctx.tools.register" src/index.ts # 11  —— 入口注册
pnpm vitest run tests/unit/plugin.test.ts # 断言两集合相等且无重复
```

> 历史事故（cycle-107）：`graph_path_enumerate` **只加进了工厂返回对象**，没加进
> `src/index.ts` 的固定解构与注册列表 ⇒ 它不报错、不出现在工具清单、`tools.test.ts`
> 直接调 `execute()` 也永远看不见——「实现了」≠「能被执行」。
> 故计数式断言不够，必须是**集合相等 + 每名唯一**的契约用例。

每个工具的结构：

```ts
defineTool({
  name: 'graph_status',
  parameters: { repoId: { type: 'string', required: true } },
  output: { schema: { type: 'json' }, render: renderGraphStatus },
  presentCall: (args) => ({ card: 'generic', title: 'Check graph status', kind: 'other', rawInput: { repoId: args.repoId } }),
  presentResult: (result) => ({ ... }),
  async execute(args, ctx) { ... },
});
```

> ⚠️ `defineTool` 会**同时**包装两个 presenter 的参数校验门
> （`node_modules/@deepseek-ai/dsh-tools/lib/index.js:838-887`）：
> `tool.presentCall = (args) => { if (validate(args).length > 0) return void 0; return userPresentCall(args); }`。
> 用 schema **非法**的参数调 presenter 会拿到 `undefined`、用户回调永不执行——
> 测试会「通过」而覆盖率停在 0。**测 presenter 必须传 schema 合法的参数**，
> 并额外加一条钉住这个短路的用例。

---

## 8. 适配器层 `src/adapters/`

```ts
// IAdapter.ts
export type UpstreamInvoker = (tool: string, args: Record<string, unknown>) => Promise<unknown | null>;

interface IAdapter { readonly source: DataSourceType; }

export interface IDataAdapter extends IAdapter {
  fetchData(repoId: string, invoke?: UpstreamInvoker): Promise<AdapterResult>;
}

export interface IAnalysisAdapter extends IAdapter {
  init(): Promise<void>;
  isAvailable(): boolean;
  parseFile(filePath: string, content: string): Promise<AdapterResult>;
  destroy(): void;
}
```

| 实现 | 文件 | 大小 | 角色 |
|---|---|---|---|
| `CodeGraphAdapter` | `CodeGraphAdapter.ts` | 32 401 B | 主数据源（dsh-codegraph） |
| `TreeSitterAdapter` | `TreeSitterAdapter.ts` | 21 307 B | 本地 AST 解析（IAnalysisAdapter） |
| `DependencyAdapter` | `DependencyAdapter.ts` | 9 466 B | 模块依赖图 |
| `FileSystemAdapter` | `FileSystemAdapter.ts` | 7 025 B | 文件系统遍历 |
| `LensAdapter` | `LensAdapter.ts` | 3 317 B | 可选第二数据源（dsh-tool-lens） |

> `LensAdapter` 失败是**预期**的：日志 `Lens fetchData failed — lens is optional` 在正常测试运行中也会出现，
> 不要把它当失败。

---

## 9. 前置依赖探测 `src/host/prerequisites.ts`

```ts
checkPrerequisites(ctx, apiCompat?): PrerequisiteStatus        // :98
setAstSourceProbe(probe): () => void                          // :62（返回注销函数）
detectCodegraphCli()                                          // 跑 `codegraph.cmd --version`（win32 用 shell）
```

### 9.1 `Prerequisites` 的**当前**形状（cycle-111 / T2 已落地）

**唯一定义处是 `src/shared/prerequisiteStatus.ts:55-69`**（宿主与客户端共用；两侧都不许自己拼字段）：

```ts
export interface PrerequisiteStatus {
  codegraph: boolean;    // 上游 dsh-codegraph 工具面
  lens: boolean;         // 上游 dsh-tool-lens 工具面
  astSource: boolean;    // 内置 AST 分析通道（TreeSitter 已初始化）
  graphSource: boolean;  // 内置图数据通道（manifest 依赖图解析器自检通过）
  builtin: boolean;      // @deprecated 别名，值恒等于 astSource，cycle-112 移除
}
```

| 字段 | 判据（实现行） | 方向性 |
|---|---|---|
| `codegraph` | `isToolPresent(ctx, apiCompat,'codegraphStatus', CODEGRAPH_TOOL_EVIDENCE)`（`:112`） | 工具探针 |
| `lens` | `isToolPresent(ctx, apiCompat,'lensAnalyze', LENS_TOOL_EVIDENCE)`（`:113`） | 工具探针 |
| `astSource` | **模块级探针** `astSourceProbe()`（`:103`）；探针由 `src/host/routes.ts` 在构造共享 TreeSitterAdapter 之后用 `ctx.effect(() => setAstSourceProbe(probeAstSource), …)` 登记（**用 grep 定位，不要引行号**），判据是 `sharedTreeSitterAdapter.isAvailable() \|\| isTreeSitterRuntimePresent()` | **无探针 ⇒ `false`**（`:103` 的 `astSourceProbe ? … : false`）。「不知道」不等于「有」 |
| `graphSource` | **跑一遍解析器自检** `probeGraphSource()`（`:80-88`）：用固定 JSON 调 `parsePackageJson`，要求 `nodes.length > 0 && edges.length > 0` | **不写 `true`**——这个函数存在的全部理由就是不让第二个恒真式出现（`:75`） |
| `builtin` | `builtin: astSource`（`:116`，异常分支 `:122` 同） | **派生别名，不接受单独声明** |

**为什么 `astSource` 是模块级探针而不是 async**：`checkPrerequisites(ctx)` 是**同步**签名，
被 20+ 处调用（含 `src/index.ts` 的同步轮询定时器）；而解析器初始化
（`await import('web-tree-sitter')` + `Parser.init()`）是异步的。改成 async 的代价
远大于收益，所以用「宿主在构造适配器后登记探针」这一层间接（`prerequisites.ts:46-54` 的注释原文）。

**注销是必须的**：`setAstSourceProbe` 返回注销函数（`prerequisites.ts:62-65`），`routes.ts` 把它接进
`ctx.effect` 清理链。模块级状态在卸载后仍指向已 `destroy()` 的适配器时，下一次 `apply()`
会读到上一轮实例（HMR / profile 重载场景）。

**异常分支也要如实**：`codegraph`/`lens` 的探测抛错时，`astSource`/`graphSource`
**不被牵连成 false**——它们与 `ctx.tools` 无关（`:118-123` 的注释与返回）。

### 9.2 `/health` 的 healthy 判定

**实现**：`src/host/routes/statusRoutes.ts:51` 调
`isGraphServiceHealthy(status)`；判据唯一定义在 `src/shared/prerequisiteStatus.ts:127-131`：

```ts
export function isGraphServiceHealthy(
  status: Pick<PrerequisiteStatus, 'codegraph' | 'lens' | 'graphSource'>,
): boolean {
  return status.codegraph || status.lens || status.graphSource;
}
```

| 项 | 结论 |
|---|---|
| 响应码 | `healthy ? 200 : 503`（`statusRoutes.ts:52`） |
| `status` 字段 | `healthy ? 'healthy' : 'degraded'`（`:53`） |
| **`degraded` 现在可达吗** | ✅ **可达**。修前 `healthy = codegraph \|\| lens \|\| builtin` 而 `builtin` 硬编码 `true` ⇒ 恒 healthy（`statusRoutes.ts:48-50` 的注释记录了这段） |
| `astSource` 参与判定吗 | ❌ **不参与**（`:49-50`、`prerequisiteStatus.ts:123`）。AST 可用 ≠ 画得出图 |
| `hasGraphData` 参与判定吗 | ❌ **不参与**（`prerequisiteStatus.ts:124-125`）。它是「这一次的结果」，不是「通道存在」 |
| 503 时能看出差在哪吗 | ✅ 两个内置位都上报（`statusRoutes.ts:56-59`）：「AST 有、图没有」与「两个都没有」可区分 |

### 9.3 证据常量

- `CODEGRAPH_TOOL_EVIDENCE = ['codegraph_status', 'codegraph_graph', 'codegraph_query', 'mcp__codegraph__codegraph_explore']`（`:34-41`）
- `LENS_TOOL_EVIDENCE = ['lens_analyze', 'lens_impact']`（`:44`）

> 本机 `dsh-codegraph@0.1.3` **只贡献 `mcp__codegraph__codegraph_explore` 一个工具**
> （`:26-32` 的注释记录了这次实测）。只认前三者会在真机误报「前置缺失」并抑制客户端
> 自动 bootstrap，所以第四个必须保留。

### 9.4 `/status` 响应字段

**当前**（`statusRoutes.ts:20-26`）：`{ codegraph, lens, astSource, graphSource, builtin, compat }`。

> `builtin` 行上方有源码注释（`:24`）：*"兼容别名（= astSource），下一轮移除。旧客户端读它；
> 新代码一律读上面两个字段。"*
> `compat` 字段的注释（`:20-21` 原文）：*"Diagnostics only: the generation-dated capability
> record resolved at boot. Runtime behaviour is decided by which upstream tools are actually
> available, not by these flags."* —— 不要用 `compat` 做运行期判定。

---

## 10. 宿主版本检测 `src/host/compat/HostVersionDetector.ts`

`detectHostVersion(ctx): DshVersionInfo` —— 三路启发式，**全可能落空**：

1. `detectFromContext`：`ctx.hostVersion` / `ctx.version` / `ctx.app?.version` / `ctx.runtime?.version`
2. `detectFromEnv`：`DSH_HOST_VERSION` / `DSH_VERSION` / `CODEARTS_HOST_VERSION`
3. `detectFromToolNames`：`codegraph_incremental|codegraph_bootstrap` → gen2；`codegraph_status|codegraph_graph` → gen1

全部未命中 ⇒ `log.info('host version unknown, using conservative flags')` + `unknownDshVersion()`。
**真机就是这条路径**，见 [01-插件开发规范.md](./01-插件开发规范.md) §2.4。

---

## 11. 代际模型 `src/shared/dshGeneration.ts`

| 导出 | 行 | 值 / 签名 |
|---|---|---|
| `DshGeneration` | `:44` | `'gen1'\|'gen2'\|'gen3'\|'unknown'` |
| `DSH_GENERATIONS` | `:47` | `['gen1','gen2','gen3'] as const` |
| `DSH_GENERATION_PROBES` | `:64` | `{ gen1:'0.1.7-rc.2', gen2:'0.2.0-rc.2', gen3:'0.3.0-rc.2' }` |
| `DSH_PROMISED_GENERATIONS` | `:80` | `['gen2','gen3'] as const` |
| `DSH_LEGACY_GENERATIONS` | `:90` | `['gen1'] as const` |
| `DSH_SUPPORTED_RANGE` | `:119` | `'>=0.2.0-rc.2 <0.4.0-0'` |
| `DSH_UNSUPPORTED_PROBE` | `:131` | `'0.4.0-rc.1'`（cycle-110 由 `'0.4.0'` 收紧，见 [09](./09-破坏性变更与兼容策略.md) §3.2） |
| `DSH_UNSUPPORTED_PROBES` | `:139` | `['0.4.0-rc.1','0.4.0','1.0.0']`（多点探针，单点只能证明一格被排除） |
| `isDshGeneration(value)` | `:143` | type guard |
| `generationOfVersion(major, minor)` | `:170` | `major>=1→gen3`；`major!==0→unknown`；`minor>=3→gen3`；`minor===2→gen2`；`minor===1→gen1`；否则 `unknown` |
| `parseDshVersion(raw)` | `:180` | 正则 `/^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/` |
| `unknownDshVersion(raw)` | `:202` | 保守基线 |
| `probeReleaseFor(generation)` | `:207` | 代际 → 代表版本 |

---

## 12. 插件生命周期事件（13 条）

```
codegraph-visualizer/prerequisite/status      codegraph-visualizer/prerequisite/request
codegraph-visualizer/graph/updated            codegraph-visualizer/graph/data
codegraph-visualizer/graph/delta              codegraph-visualizer/watch/error
codegraph-visualizer/watch/toggle             codegraph-visualizer/repo/imported
codegraph-visualizer/repo/scanned             codegraph-visualizer/repo/request-scan
codegraph-visualizer/graph/init               codegraph-visualizer/graph/init-result
codegraph-visualizer/source/open
```

事件负载类型见 `src/types/index.ts`（`GraphUpdatedEvent` / `GraphDataEvent` / `GraphDeltaEvent` /
`RepoImportedEvent` / `RepoScannedEvent` / `RepoRequestScanEvent` / `SourceOpenEvent` /
`PrerequisiteStatusEvent` / `GraphInitEvent` / `GraphInitResultEvent` / `WatchToggleEvent` /
`HealthScoreEvent` / `RuleViolationEvent` / `PathFoundEvent` / `FocusChangedEvent`）。

---

## 15. 运行时 Skill 贡献 `src/host/skills.ts`（cycle-111）

11 个 `graph_*` 工具全部带 `presentCall` / `presentResult`（`src/tools.ts`，逐个可 `grep -c presentCall` = 11），
所以「轨迹里能看到本插件的调用」在**契约层**已经成立。缺的是**触发**：工具描述只回答
「这个工具做什么」，回答不了「什么时候该用」。宿主侧因此额外贡献一条运行时 Skill
（`codegraph-visualizer`），把「先查图再 grep」这条判断告诉模型。

### 15.1 契约与落点

| 项 | 值 | 依据 |
|---|---|---|
| 注册入口 | `ctx.skills.register(skill)` → disposer | kb `site/reference/subsystems/skills.md:299` |
| 必填字段 | `name` / `description` / `content` | 同文件 `:183-190`（`SkillRegistration` = `SkillDefinition` 去掉两个可选字段） |
| 省略 `invocation` | 模型侧与用户侧**都**可见 | 同文件 `:132`（`isModelInvocable` / `isUserInvocable` 各读一个必填字段，省略即 `true`） |
| 同层同名 | **first-wins**，重复注册记 warning 并返回 **no-op disposer**，不抛错 | 同文件 `:299-303` |
| 层内优先级 | project > runtime > user | 同文件 `:299`。因此用户在 `.dsh/skills/` 放同名 skill 会胜出——这是刻意的：插件给默认指令，项目可覆盖 |
| 探针方式 | 响应式 `ctx.inject(['skills'], …)`，**不写静态 `inject`** | 静态 inject 必须全部满足，否则整个插件 INACTIVE；与 `src/client/index.ts:36` 对 `betterSidebar`/`commandUi` 的处置同源 |
| Skill 名 | `codegraph-visualizer`（= 包名） | `src/host/skills.ts` 的 `GRAPH_SKILL_NAME` |

### 15.2 返回值是判定证据，不是装饰

`contributeGraphSkill(ctx): SkillContribution` 返回 `{ registered, reason? }`。

这条失败路径**完全静默**：依赖永不出现 ⇒ `ctx.inject` 回调永不执行 ⇒ 插件照常加载、
工具照常注册、`/` 面板与模型侧都看不到这条 Skill，**零错误**。因此返回值是唯一能说
「模型侧到底有没有这条指令」的观测点，`src/index.ts` 把它挂进 `ctx.effect` 收尾日志。

### 15.3 守卫（`tests/unit/hostSkillContribution.test.ts`，12 用例）

四条不变量，缺一条都会让「贡献了 Skill」变成不可证伪的说法：

1. **真的调了 register**，且三件必填都在；`invocation` 键**根本不存在**（`'invocation' in arg === false`）。
2. **`content` 提到 `src/tools.ts` 里每一个工具名**——工具名从源码**实时解析**，不手写清单；
   并有 `toolNames.length >= 11` 的防空扫断言。新增工具忘了写进 Skill 时这条会红（实测探针 A）。
3. **disposer 挂到注入 scope 上**，跑一次必须调起 `skills.register` 的 disposer。
4. **失败路径响亮**：依赖未就绪 / 服务形状不对 / `register` 抛错 / `inject` 抛错四种情况
   都要返回 `registered: false` + reason；`register` 返回 `undefined` 时仍算成功（不重试，否则会重复注册而 first-wins 等于白干）。

**变异探针（cycle-111 实测，全部红→绿）**：

| 探针 | 改坏点 | 结果 |
|---|---|---|
| A | 删掉 content 里 `graph_focus` 那两行 | `1 failed / 11 passed`：`Skill 正文漏了这些工具名 … expected [ 'graph_focus' ]` |
| B | `content: SKILL_CONTENT` → `content: ''` | `4 failed`：长度断言 + 工具覆盖 + `truncated` 断言 |
| C | 删掉 `scope.effect(() => disposer, …)` | `1 failed / 11 passed`：`expected [] to have a length of 1` |

> 探针 A 第一次跑**没变红**，原因是替换字符串没匹配上（多行缩进差异），变异根本没生效。
> 这正是本仓「探针先证明自己生效」那条纪律的现场复现：**变异没生效的绿是假绿**。

### 15.4 诚实缺口

- **真机未验证「模型真的会调用」**：`ctx.skills.register` 的贡献在单测里被完整模拟，
  但「模型读到这条 Skill 后是否真的优先 `graph_status` 而不是 grep」只有真机会话能证明，
  且需要有效模型密钥。本轮登记为未验证（见 `docs/用户旅程.md` 与交付清单）。
- **`register` 返回 no-op disposer 时无法区分**「首次成功」与「同层同名被忽略」——
  返回值形状不提供这个信息。当前只记一条 `log.info`，不编造更强的「已注册」断言。

---

## 13. 增量更新层 `src/host/incrementalUpdate.ts`（Round 16，cycle-102 补记）

文件监听的**更新层**——watcher 检测到文件变更后，不再无条件全量重取，而是做文件级增量 diff：

```ts
// 契约（src/host/incrementalUpdate.ts:12-33）
buildIncrementalUpdate(input: IncrementalUpdateInput): IncrementalUpdateResult  // :81，同步函数

interface IncrementalUpdateInput {
  workspacePath: string;    // 工作区根；索引经 resolveDbPath 从它解析（:14）
  changedFiles: string[];   // watcher 观察到的 repo 相对路径；空数组 = 无可定向变更（:16）
  current: GraphData;       // 客户端当前渲染的图；diff 以此为基线（:18）
  timestamp?: number;       // 产出 revision 的时间戳；默认 Date.now()，可注入对齐事件载荷（:23）
}
interface IncrementalUpdateResult {
  delta: GraphDelta;        // 待发布的结构差；变更未产生图变化时为空（:28）
  next: GraphData;          // current 折入 delta 后的宿主新权威图（:30）
  scanned: { nodes: number; edges: number };  // 定向读回的索引行数，仅用于日志/诊断（:32）
}
```

**接线**：`src/host/watcher.ts:9`（导入）+ `:51`（调用）——`scanAndPush` 检测到变更后调
`buildIncrementalUpdate`，产出 delta 下发 `codegraph-visualizer/graph/delta`；
只有工作区级重置（repo/imported、手动 scan）才走全量 `graph/data`。

**给开发者的三条边界**（对应需求分析 P2-21 的实现注记）：
1. **外来图不作 diff 基线**——`repo/imported` 导入的图没有 `current` 可比，直接全量；
2. `changedFiles` 是**检测层**产物（`computeGraphFingerprint` + 文件对比），
   更新层只信这个清单，不自己再监听一次——两层职责分离是 Round 13/16 分工的延续；
   节点归属判定 `belongsToChangedFile`（:36-44）按文件路径前缀匹配（含目录级变更）；
3. delta 合并在客户端走 `applyGraphDelta`（store 侧），宿主侧**不**做合并——
   `next` 只作为宿主下一次 diff 的基线（:30 注释），不是给客户端的指令。

**状态**：P2-21 登记关闭候选（需求分析.md:3178）；研究报告 §六 #21 已同步 ✅（cycle-102 复核）。
**教训**：`scanned` 是**计数**不是文件清单（`{nodes, edges}`）——写文档前先读源码字段类型，
凭名字想象契约正是 §59.20 一族「校验器可达≠值可达」的认知错误。


---

## 附：LLM 工具注册链路真机验证（cycle-114）

**结论**：`ctx.tools.register()` 的插件工具经宿主聚合后，出现在发给 LLM 的每次请求的
`tools` 数组（会话日志 `request/header` 行可证）。链路：

```
ctx.tools.register(tool)  →  dsh-tools 聚合  →  request/header.tools[]  →  LLM 工具发现
```

**实证**（宿主 0.2.1-rc.3 + 本插件 0.2.0，非 PTC preset 会话）：71 个工具中
`graph_status/data/symbol/impact/path_find/path_enumerate/cycles/health/rules_check/focus/query`
11 个全部在列；PTC preset（standard + run_code 聚合）会话中它们经 `tools.*` 绑定间接可达。

**排障教训（P0）**：LLM 不调插件工具时，先查宿主日志 `skipping profile bundle` ——
旧版同族插件（如 dsh-codegraph@0.1.3 peer ^0.1.0-rc.6）与新宿主不兼容被拒载，
会连带污染同 slots 的 bundle 解析。修复：profile 移除旧插件（直接改 package.json + 删
node_modules 链接可绕过 pnpm store 冲突），重启宿主后重验。

**验证方法**：DSH 会话日志是**多帧 zstd 容器**（每帧独立、尾帧可截断），`zstdDecompressSync`
只解第一帧。逐帧扫描算法：解析 frame header（magic 0xFD2FB528 / descriptor / window / blocks /
checksum）定位帧边界后逐帧解拼。可复用 `dsh-session-persistence-jsonl/lib/index.js` 的
`scanZstdFrames` 同款逻辑。

## 14. 业务注册矩阵路由（cycle-116）

`GET /api/v1/codegraph/registry` —— 注册-生产-消费四面全量清单（白盒透明化看板）。

- **四面**：`tools`（11 个 graph_*）/ `routes`（20 条，含 /worker 布局脚本）/ `entries`（4 通道优先级链）/ `skill`（1 个图检索贡献）；
- **每项字段**：`id` / `face` / `registeredAt`（file:line）/ `produces` / `consumers[]`（空 = 断链）/ `guardTest` / `lifecycle`（五态：registered→producing→consuming→degraded→disposed）；
- **断链判定**：`brokenLinks` 非空即有业务注册了但无人消费——看板直接标红；
- **契约守卫**：`tests/unit/registryContract.test.ts` 5 例（guardTest 文件存在性 / 断链为空 / routes.ts 注册数 = 清单数 / 四面计数 / 反向自检）；
- **快捷入口**：`/status` 响应新增 `registry` 摘要字段（additive，四面计数 + 断链清单）——既有 status 消费者零成本获得可观测性。

**运维用法**：`curl /api/v1/codegraph/registry | jq '.brokenLinks, .lifecycleCounts'`；
新增业务时必须同时在 `src/host/registry/businessRegistry.ts` 登记一行——漏登记会被契约测试第 3 例抓住（routes.ts 注册数 ≠ 清单数）。

## 16. 图谱管理路由族（cycle-141，T9-T11）

`src/host/routes/controlRoutes.ts` 的 manage 段——代码图谱索引的构建/更新/删除/指标四条路由：

| 路由 | 方法 | 语义 | 错误码 |
|---|---|---|---|
| `/manage/build` | POST | 全量扫描建索引（codegraph_scan） | 请求进行中 409（scanInFlight） |
| `/manage/update` | POST | 增量同步（codegraph_sync，与 build 区分） | 同上 |
| `/manage/delete` | POST | 删除索引 + 失效 scanCache/scanInFlight + 发 `graph/deleted` 事件 | `INDEX_NOT_FOUND` / `DELETE_FAILED` |
| `/manage/metrics` | GET | 原生图谱指标（graphMetrics）+ 索引覆盖范围 `coverage` 字段 | `INDEX_NOT_FOUND`（无 DB 时**不再**假成功全零） |

**契约要点**：

- **指标边集上限**：节点数由 `MANAGE_METRICS.MAX_NODES` 限制，边集同上限并在超限时
  返回 `truncated: true` 披露——「静默全量」与「截断不可见」都是 cycle-141 前的缺陷形态；
- **`computeMs` 披露**：响应携带指标计算耗时（白盒透明化），同时记入 observability
  的 `pipeline.metricsCompute` 键（累计）/`pipeline.metricsCompute.count`（次数）；
- **介数采样预算**：大图 Brandes 采样有界（65.4s→2.7s 实测），采样数写进响应；
- **coverage 字段**（cycle-141 第七轮）：`{ gitignorePresent, gitignoreRules, ignoredEntries, indexedAt }`
  来自 `index_meta` 三新列 + `readNativeIndexCoverage`——上游索引 coverage=null 时**不渲染**（宁缺勿造）。

**守卫**：`tests/unit/routes.test.ts` manage describe（错误码化/幂等删除/无 DB 假成功修复/截断披露）
+ `tests/unit/nativeIndexContract.test.ts` NB 契约（coverage 沉淀 14 用例）。

## 17. 可观测性数据面（cycle-141 第二轮 + cycle-142 流动升级）

三个模块自上而下的分工——**计数归 observability，耗时归 PerformanceMonitor，可视化升维归 observabilityFlow**：

| 模块 | 职责 | 消费者 |
|---|---|---|
| `src/shared/observability.ts` | 计数器（`incr`/`snapshot`/`reset`）+ 管线阶段计时（LIFO 栈语义，支持同阶段嵌套，每阶段留最近 100 样本） | RuntimePanel 白盒区、测试 |
| `src/shared/observabilityFlow.ts` | **纯函数升维**：管线耗时占比条（`leftPct`/`widthPct` 前置计算）、缓存命中率（判零为 null 不伪造 100%）、ETag 决策分布、AST 预算用量 | `RuntimePanel.ObservabilitySection` |
| `src/shared/runtimeSnapshot.ts` | 日志窗口裁剪 + 性能样本聚合（先窗口后条数的顺序契约） | RuntimePanel 主体 |

**OBS_KEYS 分组**（`runtime.flow*` 可视化按此前缀分组渲染）：
`cache.{scan|indexeddb|diagram|cluster}.{hit|miss}` / `etag.{200|304|rejected}` /
`ast.{requested|returned|truncated|hasMore}` / `pipeline.{scan|init|import|dbRead|merge|xuanjiDelta|xuanjiDegraded}`。

**设计约束**（写新计数器时必须遵守）：

1. 零依赖纯计数，无副作用——不写文件不发事件；
2. `reset()` 必须成对清空所有模块级单例状态（counters + pipelineDurations + pipelinePendingMarks，
   cycle-141 第四轮修复的「成对重置」教训）；
3. 占比数学放 `observabilityFlow.ts` 纯函数，**不放组件**（CLAUDE.md「预算规则属于纯函数」）；
4. 面板 CSS 只准用 `tokens.css` 已定义 token——裸色值/内联回退/未定义 token 被
   `tests/unit/tokensContract.test.ts` 三条守卫拒绝（cycle-142 现场抓到过）。

**守卫**：`tests/unit/observabilityFlow.test.ts` 14 用例（占比归一/判零/确定性逐字节比较）
+ `tests/component/RuntimePanel.test.tsx` 流动区 5 用例（真实单例驱动）。

## 18. Config schema 导出与诊断四态（cycle-146）

### 18.1 Config Schemastery schema（`src/host/config.ts`）

- **导出面**：`Config`（Standard Schema 接口，`~standard.validate`）+ 既有
  `resolveConfig`/`DEFAULT_CONFIG`/`VisualizerConfig`。宿主设置 UI 与 cordis 加载期
  校验都以 schema 为数据源（dsh-context/dsh-ops 双插件的 `Config` 导出模式）。
- **单一真源关系**：schema `.default()` 的值必须逐字段等于 `DEFAULT_CONFIG`——
  `tests/unit/configSchemaContract.test.ts` CS-2 行为反射钉死（缺失输入调 schema、
  比对产出）。schema 是加载时防线（枚举外/越界值在插件加载即抛），`resolveConfig`
  是运行时防线（错误信息更具体），两道防线同形状、各有职责。
- **依赖位置**：`@deepseek-ai/schemastery` 放 `dependencies`（运行时校验器，
  官方 cookbook adding-a-package 的约定），peer 同步声明。

### 18.2 诊断四态 + 问题码分类学（`src/shared/prerequisiteStatus.ts`）

- `diagnosePrerequisiteStatus(status) → { state, issues, readyChannels, astReady }`：
  四态 `ready | degraded | disabled | not-selected` + 稳定问题码
  （`ALL_GRAPH_CHANNELS_ABSENT` / `CODEGRAPH_UPSTREAM_ABSENT` / `LENS_UPSTREAM_ABSENT` /
  `AST_SOURCE_UNAVAILABLE` / `GRAPH_SOURCE_UNAVAILABLE`）。
- **四态语义**（对齐 dsh-ops diagnose 模式）：`ready`=全功能；`degraded`=有图可看但
  AST 缺席；`disabled`=零图数据通道（装上游插件才能画图）；`not-selected`=预留
  （会话未绑定工作区）。**AST 在场不救 disabled**（§61.10 能力位拆分教训的直接回归
  DQ-5）。
- **问题码是对外契约**：客户端/管理面板按 code 匹配渲染修复指引，改名即破坏性变更。
- **消费点**：`/status` 响应新增 additive 字段 `diagnosis`（`statusRoutes.ts`）；
  `ready` 语义是「全功能」而非「零问题」——lens 缺席不阻塞 ready（DQ-3）。

### 18.3 限流器白盒快照（`src/host/RateLimiter.ts`）

- `snapshot() → { activeBuckets, buckets[], limits{heavy,regular,windowMs} }`：
  活跃桶的只读投影。三条不变式（`tests/unit/rateLimiterSnapshot.test.ts`）：
  快照不改变限流行为（零观测者效应 RL-2）、过期桶不虚报（RL-3）、
  输出按键排序确定（RL-4）。
- **消费点**：`/manage/metrics` 响应新增 additive 字段 `rateLimiter`（管理面板
  「限流观测」区渲染活跃桶/配额/窗口剩余）。
