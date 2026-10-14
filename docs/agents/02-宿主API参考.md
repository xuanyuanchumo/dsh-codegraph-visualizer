# 02 · 宿主 API 参考

> 面向改 `src/index.ts` / `src/host/**` / `src/tools.ts` / `src/adapters/**` 的开发者。
> 所有路径与行号基于 `dsh-codegraph-visualizer@0.2.0`。
> 文档族版本 1.0.0 · 适用宿主 `>=0.2.0-rc.2 <0.4.0`

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
| 8 | `await createGraphTools(ctx, { requestTimeout, apiCompat })` | 得 8 个 tool + 一个 dispose |
| 9 | `ctx.effect(...)` 注册 8 个 tool | 标签 `'codegraph: tool registrations'` |
| 10 | `createInvokeUpstream(...)` → `routeDeps` | 路由依赖对象 |
| 11 | `registerService(routeDeps)` + `registerRoutes(routeDeps)` | 服务 + 18 条路由 |
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

### 3.2 18 条路由（`src/host/routes.ts:39` `registerRoutes`）

全部挂在 `/api/v1/codegraph` 前缀下。

| # | 注册函数 | 路径 | 文件:行 | 方法 |
|---|---|---|---|---|
| 1 | `registerStatusRoute` | `/status` | `statusRoutes.ts:9` | GET |
| 2 | `registerHealthRoute` | `/health` | `statusRoutes.ts:31` | GET |
| 3 | `registerWorkspaceRoute` | `/workspace` | `statusRoutes.ts:70` | GET |
| 4 | `registerDataRoute` | `/data` | `dataRoutes.ts:65` | GET |
| 5 | `registerScanRoute` | `/scan` | `controlRoutes.ts:17` | POST |
| 6 | `registerInitRoute` | `/init` | `controlRoutes.ts:99` | POST |
| 7 | `registerWatchRoute` | `/watch` | `controlRoutes.ts:168` | POST |
| 8 | `registerDependenciesRoute` | `/dependencies` | `analysisRoutes.ts:22` | GET |
| 9 | `registerDiffRoute` | `/diff` | `analysisRoutes.ts:87` | POST |
| 10 | `registerAstRoute` | `/ast` | `analysisRoutes.ts:138` | POST |
| 11 | `registerTreeSitterRoute` | `/tree-sitter` | `analysisRoutes.ts:177` | POST |
| 12 | `registerBootstrapRoute` | `/bootstrap` | `dataRoutes.ts:107` | GET |
| 13 | `registerNodeChildrenRoute` | `/children` | `dataRoutes.ts:194` | GET |
| 14 | `registerFileOutlineRoute` | `/files/{id}/outline` | `dataRoutes.ts:269` | GET |
| 15 | `registerSymbolASTRoute` | `/symbols/{id}/ast` | `dataRoutes.ts:330` | GET |
| 16 | `registerEdgesRoute` | `/edges` | `dataRoutes.ts:438` | GET |
| 17 | `registerEventsRoute` | `/events` | `controlRoutes.ts:194` | GET（SSE） |
| 18 | `registerLayoutWorkerRoute` | `/worker/layoutWorker.js` | `workerRoutes.ts` | GET |

**共享资源**（`routes.ts:44`）：一个 `TreeSitterAdapter` 实例在 #10/#11 间共享，
并在 `routes.ts:68` 的 `ctx.effect` 里 `destroy()`；`rateLimiter` 在 `:67` `reset()`。

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
   - `etagKeyForEdges(fromId, scope, cursor, limit, detail)` `:166`
   - `resolveAstBudget(raw)` `:161`（两侧**计算**预算，不得各自硬编码）
3. `repoId` 传**请求方声明的工作区**（`resolveWorkspaceFromRequest()` 的结果），
   revision 取槽的——方向刻意偏保守：多算一次不匹配只多回一次 200，假 304 会静默丢真实更新。
4. 所有 `sendJson(res, 200, ...)` 都要带 `etagHeaders(etag)`。
   **守卫**：`tests/unit/etagContract.test.ts` 源码扫描全部 20 个调用点。

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

### 6.1 `ERROR_CODES`（`:426-452`，共 27 个）

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

### 6.2 `ERROR_MESSAGES`（`:454-480`）—— 每条含 `{ en, zh }`

示例：`PATH_NOT_ALLOWED { en: 'Path not allowed', zh: '路径不允许访问' }`、
`SYMLINK_ESCAPE { en: 'Access denied: symlink escape', zh: '访问被拒绝：符号链接逃逸' }`。

### 6.3 其它常量

- `REPO_URL` `:481` = `https://github.com/xuanyuanchumo/dsh-codegraph-visualizer`
- `IMPORT` `:482` = `{ MAX_PASTE_BYTES: 10 * 1024 * 1024, ... }`
- `RENDERER` / `LAYOUT_WORKER` / `CLUSTER` / `API` 等见 `src/shared/constants.ts` 全文（582 行）

**新增错误码必须同时加 `ERROR_MESSAGES` 的中英双语**，否则 `sendError` 渲染不出可读文案。

---

## 7. 工具面 `src/tools.ts`

`import { defineTool } from '@deepseek-ai/dsh-tools';` —— 8 个工具：

| 工具 | 起始行 | 参数要点 |
|---|---|---|
| `graph_status` | `:214` | `repoId`（string, required） |
| `graph_data` | `:235` | `repoId` + `source`（enum: `codegraph\|lens\|both\|auto`） |
| `graph_symbol` | `:261` | `repoId` + 符号标识 |
| `graph_impact` | `:282` | `repoId` + 目标节点 |
| `graph_path_find` | `:303` | `repoId` + 起点/终点 |
| `graph_health` | `:345` | `repoId` |
| `graph_rules_check` | `:381` | `repoId` + 规则集 |
| `graph_focus` | `:426` | `repoId` + 聚焦目标 |

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
checkPrerequisites(ctx, apiCompat?): { codegraph: boolean; lens: boolean; builtin: boolean }
detectCodegraphCli()  // 跑 `codegraph.cmd --version`（win32 用 shell）
```

**证据常量**（`:…`）：

- `CODEGRAPH_TOOL_EVIDENCE = ['codegraph_status', 'codegraph_graph', 'codegraph_query', 'mcp__codegraph__codegraph_explore']`
- `LENS_TOOL_EVIDENCE = ['lens_analyze', 'lens_impact']`

> 本机 `dsh-codegraph@0.1.3` **只贡献 `mcp__codegraph__codegraph_explore` 一个工具**。
> 只认前三者会在真机误报「前置缺失」并抑制客户端自动 bootstrap，所以第四个必须保留。

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
| `DshGeneration` | `:16` | `'gen1'\|'gen2'\|'gen3'\|'unknown'` |
| `DSH_GENERATIONS` | `:19` | `['gen1','gen2','gen3'] as const` |
| `DSH_GENERATION_PROBES` | `:36` | `{ gen1:'0.1.7-rc.2', gen2:'0.2.0-rc.2', gen3:'0.3.0-rc.2' }` |
| `DSH_PROMISED_GENERATIONS` | `:52` | `['gen2','gen3'] as const` |
| `DSH_LEGACY_GENERATIONS` | `:62` | `['gen1'] as const` |
| `DSH_SUPPORTED_RANGE` | `:65` | `'>=0.2.0-rc.2 <0.4.0'` |
| `DSH_UNSUPPORTED_PROBE` | `:79` | `'0.4.0'` |
| `isDshGeneration(value)` | `:83` | type guard |
| `generationOfVersion(major, minor)` | `:97` | `major>=1→gen3`；`major!==0→unknown`；`minor>=3→gen3`；`minor===2→gen2`；`minor===1→gen1`；否则 `unknown` |
| `parseDshVersion(raw)` | `:107` | 正则 `/^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/` |

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
