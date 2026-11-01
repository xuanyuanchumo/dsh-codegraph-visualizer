// Branded types and graph data structures shared across the Host/Client boundary.
// Graph heat-update events are declared here via Cordis declaration merging.

export type Branded<T, Brand> = T & { __brand: Brand };

export type RepoId = Branded<string, 'RepoId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;

export const RepoId = (id: string): RepoId => {
  if (!id || id.length === 0) throw new Error('RepoId: id must not be empty');
  return id as RepoId;
};
export const NodeId = (id: string): NodeId => {
  if (!id || id.length === 0) throw new Error('NodeId: id must not be empty');
  return id as NodeId;
};
export const EdgeId = (id: string): EdgeId => {
  if (!id || id.length === 0) throw new Error('EdgeId: id must not be empty');
  return id as EdgeId;
};

const NODE_TYPES = ['function', 'class', 'variable', 'module', 'interface', 'type'] as const;

export function isNodeType(value: unknown): value is GraphNode['type'] {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

export function safeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export type HeatmapMode = 'none' | 'instability' | 'lines' | 'complexity';
export type TodoMarkerMode = 'none' | 'todo' | 'fixme' | 'all';

export interface GraphNode {
  id: NodeId;
  label: string;
  type: 'function' | 'class' | 'variable' | 'module' | 'interface' | 'type';
  filePath: string;
  lineNumber?: number;
  properties: Record<string, unknown>;
  parentId?: NodeId;
  summary?: string;
  tags?: string[];
  complexity?: 'simple' | 'moderate' | 'complex';
  layer?: string;
}

export type EdgeDirection = 'forward' | 'backward' | 'bidirectional';

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency' | 'contains' | 'association' | 'aggregation' | 'composition';
  direction?: EdgeDirection;
  weight?: number;
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    repoId: RepoId;
    timestamp: number;
    nodeCount: number;
    edgeCount: number;
    truncated?: boolean;
    totalNodeCount?: number;
    totalEdgeCount?: number;
    /**
     * 璇玑图增量引擎健康面（cycle-122，XJ-11 消费端收口）。
     *
     * 缺口现场：`xuanjiPool.applyDelta(...)` 的返回值（`PoolDeltaResult`：
     * applied / addedPaths / degradedRules / I4 不变量报告）在 `src/tools.ts`
     * 曾被**完全丢弃**——降级信号生产了但没有消费面，「不可观测的降级等于
     * 没有降级」（XJ-11 头注原文）。
     *
     * 字段在 `executeGraphData` 组装（增量分支才有；全量重建时为 undefined）：
     * 模型读 `graph_data` 返回值即可判断「这次合并走的是增量还是全量、有没有
     * 规则被降级」——不再需要读源码才能知道引擎状态。
     */
    xuanji?: {
      /** delta 是否真的被应用到缓存适配层（false = 全量重建 / 尚未装载）。 */
      applied: boolean;
      /** 本轮增量新增的物化路径数（增量引擎的真实产出，量化可观测）。 */
      addedPaths?: number;
      /** 因超出展开预算被降级重建的规则名（空数组 = 无降级）。 */
      degradedRules?: readonly string[];
      /** I4（stale 比例）判为不达标的规则名。 */
      invariantViolations?: readonly string[];
    };
    /**
     * 继承数据增强结果（cycle-123，研究报告 Phase 1 P0 数据质量缺口）。
     *
     * 上游索引对 `interface extends` 检出为 0（本仓 17 处源码 extends 只出
     * 9 条 class→class）——AST 补扫在 merger 之后注入增强边。全量路径才有
     * 此字段（增量轮的缓存已含上轮增强）；`applied: false` = 不可用/零增量
     * （宁缺勿造）。模型可据此向用户披露「继承视图的边含 AST 增补 N 条」。
     */
    inheritance?: {
      applied: boolean;
      extracted: number;
      added: number;
      ambiguous: number;
      unresolved: number;
      duplicates: number;
      filesScanned: number;
      durationMs: number;
    };
    /**
     * 图层来源声明（cycle-127 · T3）：本次合并数据来自哪条通道。
     *
     * - `'upstream'`：上游 dsh-codegraph 索引（SQLite）参与合并；
     * - `'native'`：原生通道（目录结构 + TreeSitter 符号 + AST 边）——仅在
     *   auto 降级链第三级（上游与 lens 双缺席）启用；
     * - `'empty'`：所有通道均无产出（headless / 工作区不可读），诚实空态。
     *
     * 「不可观测的降级等于没有降级」（XJ-11 家族）：模型与客户端据此向用户
     * 披露数据来源，而不是把空图当作「工作区没有代码」。
     */
    graphLayer?: 'upstream' | 'native' | 'empty';
    /**
     * 原生索引命中信息（cycle-128 · T2）：`graphLayer === 'native'` 且索引库
     * 命中时在场——模型/客户端可据此披露「毫秒级索引读取」vs「实时扫描」。
     * 实时扫描路径（回写后）不带此字段（hit 语义仅指本次图来自库）。
     */
    nativeIndex?: {
      hit: true;
      indexedAt: number;
      fingerprint: string;
    };
  };
  layers?: Layer[];
}

export interface Layer {
  id: string;
  name: string;
  description?: string;
  nodeIds: NodeId[];
  color?: string;
}

/**
 * 视图模式。前 9 项是图谱视图（结构层 + 行为层），`runtime` 是 cycle-88 新增的
 * 运行时层（`docs/图谱按需加载.md:196-200` 的第三层：Trace / 日志 / 性能排查）。
 *
 * 运行时层刻意**不映射任何图谱装配器**：`src/client/diagram/index.ts` 的
 * `assembleDiagram` 走 `macroAssemblerRegistry.get(viewMode)`，未注册即返回
 * `null`，因此 `runtime` 天然得到空子图——这正是验收原文
 * `docs/图谱按需加载.md:202`「切换层时替换子图，而不是追加节点」要的结果。
 * 运行时层的数据面是进程内可观测数据（`Logger` 环形缓冲 +
 * `PerformanceMonitor`），不是图节点。
 */
export type ViewMode = 'code' | 'dependencies' | 'inheritance' | 'callgraph' | 'package' | 'class' | 'cfg' | 'flowchart' | 'sequence' | 'runtime';


export interface InheritanceNodeProperties {
  depth: number;
  isRoot: boolean;
  parentCount: number;
  childCount: number;
  descendantCount: number;
  isAbstract: boolean;
}

export interface CallGraphNodeProperties {
  depth: number;
  isEntry: boolean;
  entryType: 'export' | 'handler' | 'event' | 'cli' | 'test' | 'none';
  inDegree: number;
  outDegree: number;
  isRecursive: boolean;
}

export type DataSourceType = 'auto' | 'codegraph' | 'lens' | 'tree-sitter' | 'dependency';

export interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: DataSourceType;
  timestamp: number;
  error?: string;
  /**
   * 文件 → 该文件 import 的模块名（cycle-129 · T1，仅 tree-sitter 源产出）。
   *
   * 语法事实（import 语句的 `source` 字符串）与语义裁决（模块名 → workspace
   * 内文件节点）刻意分离：TreeSitter 适配器保持「语法事实收集者」，路径解析
   * 由 FileSystemAdapter 统一裁决（需要目录清单上下文）。消费方按需取用；
   * 其它来源此字段缺席（不编造空对象）。
   */
  importsByFile?: Map<string, string[]>;
}

// ---- Graph heat-update event payloads -------------------------------------

/**
 * Structural difference between two graph revisions (P2-21).
 *
 * Lives here rather than next to its producer so both the host diff engine and the client store can
 * name it without importing each other; `shared/graphDelta.ts` re-exports it and owns the helpers.
 */
export interface GraphDelta {
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  modifiedNodes: GraphNode[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  modifiedEdges: GraphEdge[];
}

export interface GraphUpdatedEvent {
  repoId: RepoId;
  nodeCount: number;
  edgeCount: number;
  timestamp: number;
  /** P0-6 structural fingerprint; stable while graph content is unchanged. */
  fingerprint?: string;
  /** File paths that triggered an incremental re-scan, when the watcher drove the update. */
  changedFiles?: string[];
  /**
   * P2-21: this update is followed by a `graph/delta` carrying the actual changes, so consumers that
   * understand deltas must not re-fetch the whole graph in response to this event.
   */
  incremental?: boolean;
}

export interface GraphDataEvent {
  repoId: RepoId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  timestamp: number;
  /** P0-6 structural fingerprint; stable while graph content is unchanged. */
  fingerprint?: string;
  /** File paths that triggered an incremental re-scan, when the watcher drove the update. */
  changedFiles?: string[];
  /**
   * 璇玑图增量引擎健康信号（cycle-122）：`executeGraphData` 组装、SSE 透传到
   * 客户端 StatusBar（XJ-11 消费端收口）。增量分支才有；全量重建缺省。
   */
  xuanji?: {
    applied: boolean;
    addedPaths?: number;
    degradedRules?: readonly string[];
    invariantViolations?: readonly string[];
  };
}

/**
 * P2-21 targeted update: only the entries that actually changed since the consumer's revision.
 *
 * Consumers apply this with `applyGraphDelta()` and must check `canApplyGraphDelta()` first — a
 * delta is only meaningful against the exact revision it was computed from.
 */
export interface GraphDeltaEvent {
  repoId: RepoId;
  delta: GraphDelta;
  timestamp: number;
  /** P0-6 structural fingerprint of the resulting graph. */
  fingerprint?: string;
  /** File paths that triggered this update. */
  changedFiles?: string[];
}

export interface RepoImportedEvent {
  repoId: RepoId;
  path: string;
  timestamp: number;
}

export interface RepoScannedEvent {
  repoId: RepoId;
  fileCount: number;
  timestamp: number;
}

export interface RepoRequestScanEvent {
  path: string;
  timestamp: number;
}

export interface SourceOpenEvent {
  filePath: string;
  lineNumber: number;
}

/**
 * 能力位变更事件。
 *
 * `astSource` / `graphSource` 是两个**不同**的能力（`docs/需求分析.md` §61.10）：
 * AST 分析通道存在 ≠ 能产出一张图。（cycle-118：`builtin` 兼容别名已移除，
 * 事件载荷不再携带；监听方读 `astSource` / `graphSource`。）
 */
export interface PrerequisiteStatusEvent {
  codegraph: boolean;
  lens: boolean;
  /** 内置 AST 分析通道是否可用（TreeSitter）。 */
  astSource: boolean;
  /** 内置图数据通道是否存在（manifest 依赖图）。 */
  graphSource: boolean;
  timestamp: number;
}

export interface GraphInitEvent {
  path: string;
  timestamp: number;
}

export interface GraphInitResultEvent {
  success: boolean;
  path: string;
  message: string;
  errorCode?: string;
  timestamp: number;
}

export interface WatchToggleEvent {
  enabled: boolean;
  path: string;
  timestamp: number;
}

export interface HealthScoreEvent {
  repoId: RepoId;
  score: HealthScore;
  timestamp: number;
}

export interface RuleViolationEvent {
  violations: RuleViolation[];
  timestamp: number;
}

export interface PathFoundEvent {
  path: PathResult;
  timestamp: number;
}

export interface FocusChangedEvent {
  nodeId: NodeId | null;
  depth: number;
  timestamp: number;
}

export interface HealthScore {
  coupling: number;
  cohesion: number;
  cyclicDependencyRate: number;
  modularity: number;
  overall: number;
}

export type RuleType = 'forbidden-edge' | 'required-edge' | 'max-indegree' | 'max-outdegree' | 'cross-layer-call';

export interface RuleDefinition {
  id: string;
  name: string;
  type: RuleType;
  params: Record<string, unknown>;
  severity: 'error' | 'warning';
  enabled: boolean;
}

export interface RuleViolation {
  ruleId: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  message: string;
  severity: 'error' | 'warning';
}

export interface PathResult {
  source: NodeId;
  target: NodeId;
  path: NodeId[];
  length: number;
}

// ---- Cordis event declaration merging ------------------------------------
// These are emitted by the host plugin; Client/host listeners subscribe via
// `ctx.on(...)`. Keep them writer-only so consumers never redefine the contract.
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * @mode serial
     * @param event Repository imported into the workspace
     */
    'codegraph-visualizer/repo/imported'(event: RepoImportedEvent): void;
    /**
     * @mode serial
     * @param event Repository scan completed with file count
     */
    'codegraph-visualizer/repo/scanned'(event: RepoScannedEvent): void;
    /**
     * @mode serial
     * @param event Request to scan a repository at the given path
     */
    'codegraph-visualizer/repo/request-scan'(event: RepoRequestScanEvent): void;
    /**
     * @mode serial
     * @param event Graph updated with new node/edge counts
     */
    'codegraph-visualizer/graph/updated'(event: GraphUpdatedEvent): void;
    /**
     * @mode serial
     * @param event Full graph data payload for rendering
     */
    'codegraph-visualizer/graph/data'(event: GraphDataEvent): void;
    /**
     * @mode serial
     * @param event Targeted graph update carrying only the entries that changed (P2-21)
     */
    'codegraph-visualizer/graph/delta'(event: GraphDeltaEvent): void;
    /**
     * @mode serial
     * @param event Request to open a source file at a specific line
     */
    'codegraph-visualizer/source/open'(event: SourceOpenEvent): void;
    /**
     * @mode serial
     * @param event Prerequisite service availability status changed
     */
    'codegraph-visualizer/prerequisite/status'(event: PrerequisiteStatusEvent): void;
    /**
     * @mode serial
     * @param event Request prerequisite status check
     */
    'codegraph-visualizer/prerequisite/request'(event: { timestamp: number }): void;
    /**
     * @mode serial
     * @param event Request to initialize graph for a repository path
     */
    'codegraph-visualizer/graph/init'(event: GraphInitEvent): void;
    /**
     * @mode serial
     * @param event Graph initialization result (success/failure)
     */
    'codegraph-visualizer/graph/init-result'(event: GraphInitResultEvent): void;
    /**
     * @mode serial
     * @param event File watcher toggle state changed
     */
    'codegraph-visualizer/watch/toggle'(event: WatchToggleEvent): void;
    /**
     * @mode serial
     * @param event File watcher error occurred
     */
    'codegraph-visualizer/watch/error'(event: { path: string; message: string; errorCode?: string; timestamp: number }): void;
    /**
     * @mode serial
     * @param event Architecture health score calculated
     */
    'codegraph-visualizer/health/scored'(event: HealthScoreEvent): void;
    /**
     * @mode serial
     * @param event Architecture rule violation detected
     */
    'codegraph-visualizer/rules/violation'(event: RuleViolationEvent): void;
    /**
     * @mode serial
     * @param event Shortest path found between two symbols
     */
    'codegraph-visualizer/path/found'(event: PathFoundEvent): void;
    /**
     * @mode serial
     * @param event Focus changed to a different node (or null to clear)
     */
    'codegraph-visualizer/focus/changed'(event: FocusChangedEvent): void;
  }
  interface Context {
    webServer: WebServerService;
    effect(execute: () => (() => void) | void, label?: string): () => void;
    emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void;
    on<K extends keyof Events>(name: K, listener: Events[K]): () => boolean;
    get(name: string, strict?: boolean): unknown;
    provide(name: string, service: unknown): () => void;
    /**
     * 响应式服务注入：**等到依赖到齐才跑回调**，且依赖被替换时会重跑
     * （旧 scope 先卸载、再跑新回调）。
     *
     * 契约与真实 cordis 对齐（cycle-83 修正，此前这里错写成
     * `callback: (injected: Map<string, unknown>) => void`，与实现不符）：
     *
     *   - `inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>`
     *     （`<A>\cordis\lib\types\registry.d.ts:111` 与 `:185`）
     *   - `interface Function<T> extends Base<T> { (ctx: Context, config: T): any }`
     *     （`registry.d.ts:71-73`）⇒ **回调首参是 `Context`**，不是 Map
     *   - JSDoc 逐字：「Run a callback once the requested services are available.
     *     Shorthand for `ctx.plugin({ inject, apply: callback })`: the callback is
     *     unloaded and re-run whenever a required service changes.」
     *
     * 返回值是**子 fiber**，随父 fiber 卸载自动释放，因此不需要手工 dispose。
     * 依赖永不到齐时回调永不执行，且不阻塞父插件 apply（cordis 探针实验 1 实测）。
     */
    inject(deps: string[], callback: (scope: Context, config?: unknown) => void): import('@deepseek-ai/cordis').Fiber & PromiseLike<import('@deepseek-ai/cordis').Fiber>;
    slots: {
      inject(slotName: string, callback: () => void): (() => void) | void;
      register(options: { name: string; id?: string; key?: string; order?: number; label?: () => string; inject?: (...args: unknown[]) => unknown }, component?: unknown): (() => void) | void;
    };
    betterSidebar?: {
      version: string;
      features: string[];
      registerTab(descriptor: {
        id: string;
        title: string | (() => string);
        description?: string | (() => string);
        icon?: unknown;
        order?: number;
        single?: boolean;
        hidden?: boolean;
        badge?: () => string | number | null | undefined;
        onOpen?: (tab: unknown, scope: unknown) => void;
        onActivate?: (tab: unknown, scope: unknown) => void;
        onClose?: (tab: unknown, scope: unknown) => void;
        component: (props: {
          ctx: Context;
          store: unknown;
          scope: unknown;
          tab: { id: string; title: string; path?: string };
          visible: boolean;
          expanded?: string[];
          revealed?: string[];
        }) => unknown;
      }): (() => void) | void;
      openTab(seed: { type: string; title?: string; path?: string; target?: 'right' | 'bottom' }): void;
      closeTab(tabId: string, scope?: unknown): void;
      activateTab(tabId: string, scope?: unknown): void;
      updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void;
      subscribe(listener: () => void): () => void;
      subscribeState(listener: () => void): () => void;
      getSnapshot(): {
        sessionId: string | undefined;
        state: {
          activePane: string | null;
          bottomOpen: boolean;
          bottomHeight: number;
          expanded: string[];
          revealed: string[];
        } | undefined;
        prefs: unknown;
      };
    };
    /**
     * DSH 斜杠命令贡献面（`@deepseek-ai/dsh-client-ui-commands`）。
     *
     * 契约逐字来源：`lib/types/client/contract.d.ts:129`
     * `register(contribution: CommandContribution): () => void`，JSDoc
     * 「Register one client command contribution; effect disposer. Duplicate names throw
     * at registration.」；`CommandContribution`（同文件 `:92-105`）必填
     * `name` 与 `available(session)`；`ActionSpec`（`:75-82`）为
     * `{ kind: 'action'; run(session): void }`。
     *
     * 本服务由 `Service` 基类 `super(ctx, 'commandUi')` 注册（gen2
     * `dsh-client-ui-commands/lib/client.js:771`、gen1 同文件 `:737`），因此两代都在。
     * 它替代了本项目 cycle-83 清除的 `spotlight` 幻影服务。
     */
    commandUi?: {
      register(contribution: {
        name: string;
        label?: () => string;
        description?: () => string;
        icon?: unknown;
        available: (session: unknown) => boolean;
        ui: { kind: 'action'; run: (session: unknown) => void };
      }): (() => void) | void;
    };

    /**
     * DSH 原生右侧栏的 tab 类型注册表（`@deepseek-ai/dsh-client-ui-sidebar-right`）。
     *
     * 形状逐字对齐 `lib/types/client/tab-registry.d.ts:75-120` 的
     * `SidebarRightTabDefinition`：
     *   - `title: (address: string) => string` —— **必填**，且收 `address` 形参；
     *     旧声明写成可选且无形参，是契约不精确。
     *   - `keepMounted?: boolean` —— 「Lazily keep a visited body mounted through hiding,
     *     Session changes and docking; default false」，图表面板需要它。
     *   - `multiple?: boolean` —— 缺省即「每个 pane 每 kind 一页」。
     *   - **没有 `order` 字段** —— 排序由 `priority` band 与 `RANKS`
     *     （`extension: 3 / builtin: 2 / fallback: 1`，见
     *     `dsh-client-ui-sidebar-right/lib/client.js:8619-8623`）决定，旧声明多写了 `order`。
     */
    sidebarRightTabs?: {
      register(definition: {
        id: string;
        kind: string;
        title: (address: string) => string;
        multiple?: boolean;
        keepMounted?: boolean;
        patterns?: string[];
        priority?: 'extension' | 'builtin' | 'fallback';
        canOpen?: (address: string) => boolean;
        guide?: readonly { id: string; [key: string]: unknown }[];
      }): (() => void) | void;
    };

    workspaceRegistry?: {
      list?(): Array<{ path?: string }>;
    };

    hostVersion?: string;
    version?: string;
    app?: { version?: string };
    runtime?: { version?: string };
  }
}

// ---- DSH WebServer service (Host-side HTTP route registration) -----------

export interface IGraphVisualizerService {
  getCurrentGraph(): GraphData | null;
  getGraphData(repoId: RepoId): Promise<GraphData | null>;
  getSymbolDetail(symbolId: string): Promise<Record<string, unknown> | null>;
  getImpactAnalysis(symbolId: string): Promise<{ affected: string[]; depth: number } | null>;
  onGraphUpdate(callback: (data: GraphData) => void): () => void;
}

export interface WebServerRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface WebServerService {
  register(route: WebServerRoute): () => void;
  registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void;
}

// Minimal Node.js HTTP types (avoid pulling in @types/node for client builds)
export interface IncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'close', handler: () => void): void;
  destroy(): void;
}

export interface ServerResponse {
  writeHead(code: number, headers?: Record<string, string>): void;
  write(data: string): boolean;
  end(data?: string): void;
  headersSent: boolean;
}

// ---- DSH Module Loader (runtime global) ----------------------------------
// Injected by the DSH web app boot script. Client bundles register themselves
// via __ModuleLoader__.load({ id, factory }) so the shell can wire them into
// the page (slots, overlays, etc.). The factory receives a `require` function
// for resolving platform externals (react, react-dom, cordis, etc.).
interface ModuleLoader {
  load(registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }): void;
}

declare const __ModuleLoader__: ModuleLoader | undefined;