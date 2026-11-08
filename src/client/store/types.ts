import type { GraphNode, GraphEdge, GraphDelta, NodeId, HealthScore, RuleDefinition, RuleViolation, ViewMode, HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import type { DeadCodeResult } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { DiffIndex } from '../../shared/diffStatus.ts';
import type { ClusterNode, ClusterEdge } from './cluster/index.ts';
import type { LayeredDiagram } from '../diagram/index.ts';
import { type LayoutType, type ThemeType, type RankDir } from '../../shared/viewModeUtils.ts';
import type { IntegrationMode } from '../../shared/constants.ts';
import type { PrerequisiteStatus } from '../../shared/prerequisiteStatus.ts';

export type { ClusterNode, ClusterEdge } from './cluster/index.ts';
export type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';

export type GraphType = 'all' | 'call' | 'dependency';

/**
 * 一次版本对比（diff）在 store 里的形态（研究报告 §六 #13）。
 *
 * `nodes` / `edges` 是 `/diff` 返回的**只含变更项**子图；`index` 是按状态分组的 id 索引，
 * 由 `buildDiffIndex` 从同一份子图算出，缓存下来避免每次渲染重算。
 *
 * `from` / `to` 原样回显请求所用的 git 引用，面板据此显示「main → feature」，
 * 而不是让用户猜「这是哪两个版本的对比」。
 */
export interface DiffState {
  from: string;
  to: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  index: DiffIndex;
  /** 请求发起时刻，供面板显示「对比于 12:34」。 */
  requestedAt: number;
  /**
   * 本次对比的粒度（cycle-105 P0-D）。恒为 `'file'`：`codegraph.db` 没有 revision
   * 维度，宿主改用 `git diff --raw` 给出变更文件清单。面板据此把文案写成「文件变更」，
   * 不让用户以为符号级也对比过了。
   */
  granularity: 'file';
  /** 是否被宿主上限截断（`GIT_DIFF.MAX_FILES`）。截断必须显式披露。 */
  truncated: boolean;
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

/** Segmented-loading progress for one symbol's AST. */
export interface AstPageInfo {
  /** AST nodes already merged into the graph for this symbol. */
  loaded: number;
  /** Server-reported total AST node count for this symbol. */
  total: number;
  /** `true` while the server still holds unmerged pages. */
  hasMore: boolean;
  /** Offset to request next. */
  cursor: number;
}

export interface GraphState {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  savedRawNodes: GraphNode[];
  savedRawEdges: GraphEdge[];
  repoId: string | null;

  truncated: boolean;
  totalNodeCount: number;
  totalEdgeCount: number;

  layout: LayoutType;
  dagreRankDir: RankDir;
  theme: ThemeType;
  searchQuery: string;
  selectedNodeId: NodeId | null;
  highlightedNodeIds: NodeId[];
  /**
   * 多选集合的 store 镜像（cycle-149）。事实源在渲染器 `InteractionController.multiSelectedIds`，
   * 经 `syncMultiSelection` / `clearMultiSelection` 同步——store 侧只做镜像与批量动作消费面，
   * 不自行演化（双集合各自演化必漂移）。不持久化（会话瞬时态，partialize 白名单排除）。
   */
  multiSelectedIds: Set<string>;
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  viewMode: ViewMode;
  diagramData: LayeredDiagram | null;
  currentLayer: number;
  clusterDepth: number;
  hierarchyLevel: number;

  isLoading: boolean;
  error: string | null;
  lastUpdated: number;
  /**
   * 璇玑图增量引擎健康信号（cycle-122，XJ-11 消费端收口的客户端半环）。
   *
   * 来源：`graph_data` 工具返回值 / SSE `graph-data` 载荷的 `metadata.xuanji`
   * （宿主在 `executeGraphData` 组装，见 `src/types/index.ts` 同名字段注释）。
   * StatusBar 据此显示「增量 +N 路径 / 规则 R 降级」——白盒透明化引擎状态。
   *
   * `null` = 本轮没走增量（全量重建 / bootstrap / 尚未收到信号）→ 不显示。
   * 不持久化（引擎状态只对当前画布有意义，persist 后是过期信号）。
   */
  xuanjiSignal: {
    applied: boolean;
    addedPaths?: number;
    degradedRules?: readonly string[];
    invariantViolations?: readonly string[];
  } | null;
  /** `setGraphData` 的 metadata 参数携带 xuanji 信号时写入；缺省 = null（显式清除）。 */
  setXuanjiSignal: (signal: {
    applied: boolean;
    addedPaths?: number;
    degradedRules?: readonly string[];
    invariantViolations?: readonly string[];
  } | null) => void;
  /**
   * 服务端在最近一次 `200 /api/v1/codegraph/data` 里给出的 `etag`，原样保存、原样回传。
   *
   * 与 `lastUpdated` **刻意分开**：`lastUpdated` 是展示用的时间（`Date.now()` 与服务端
   * `metadata.timestamp` 混写，供 StatusBar 显示"最后更新于"），而本字段是 HTTP 校验器域。
   * 把展示时钟当校验器用会同时造成两种错：时钟域不同导致 304 永不命中（每次全量重取），
   * 或身份不同导致**假 304 静默吞掉一次真实更新**（P0-R16-02）。
   *
   * `null` 表示"没有可用校验值"（首次取数、刚切工作区、刚清图、刚应用增量补丁）——此时不带
   * `if-none-match` 发请求，服务端必然回 200，代价只是少省一次传输。
   * 不持久化（不在 `graphStore.ts` 的 partialize 白名单里）：它只对当前会话的这一份画布有意义。
   */
  graphEtag: string | null;

  /**
   * 能力位。形状与语义见 `src/shared/prerequisiteStatus.ts` —— 宿主 `/status` 与客户端 store
   * **共用**同一个类型，避免"宿主加了一个位、客户端读的是旧形状"这类静默漂移。
   *
   * `builtin` 是 `astSource` 的**已弃用别名**（下一轮移除）：保留它只为了让既有组件/测试
   * 不必在同一轮里全部改签名。新代码一律读 `astSource` / `graphSource`。
   */
  prerequisites: PrerequisiteStatus;
  integrationMode: IntegrationMode;
  panelVisible: boolean;
  urlRestored: boolean;
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  initMessage: string | null;
  /** Server-reported index status for the active workspace (from the bootstrap payload). */
  indexStatus: 'ready' | 'building' | 'empty';
  /**
   * 图层来源声明（cycle-130 · T2）：当前图来自上游索引（'upstream'）、原生通道
   * （'native'）还是空态（'empty'）。undefined = host 未提供（旧版 host /
   * 未走原生链路）——StatusBar 来源徽章据此缺席渲染（宁缺勿造）。
   */
  graphLayer?: 'upstream' | 'native' | 'empty';
  watchEnabled: boolean;

  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;
  loadedChildrenByNodeId: Set<string>;
  prefetchedNodeIds: Set<string>;
  loadErrorsByNodeId: Map<string, string>;
  pendingRequests: Map<string, AbortController>;
  pinnedIds: Set<string>;

  /** Lazily fetched per-node edge pages from `GET /api/v1/codegraph/edges`. */
  nodeEdgesByNodeId: Map<string, GraphEdge[]>;
  /** Server-reported total edge count per node (may exceed the loaded page). */
  nodeEdgeTotals: Map<string, number>;
  /** Next cursor to request per node when appending a page. */
  nodeEdgeCursors: Map<string, number>;
  /** Node ids with an in-flight edge request. */
  loadingEdgeNodeIds: Set<string>;

  /**
   * Node ids whose current edge list is the **unaggregated** detail view.
   *
   * `/edges` collapses a dense file neighbourhood into one synthetic edge per
   * file pair, and that aggregate page cannot be paged (`hasMore: false`). Once
   * the user asks for detail, every later page for that node must keep asking
   * for unaggregated edges, or the server would re-collapse the next page and
   * the user would silently lose the edges they just asked to see.
   */
  detailEdgeNodeIds: Set<string>;

  /**
   * Single-symbol AST page progress per function node id.
   *
   * `/symbols/{id}/ast` cuts at `SYMBOL_AST.MAX_NODES` and reports `total` /
   * `cursor` / `hasMore`; this map is what lets the detail panel disclose the
   * cut and pull the remaining pages instead of silently losing them.
   */
  astPageByNodeId: Map<string, AstPageInfo>;

  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];
  /**
   * 会话跟随态（session-follow）：当前对话会话的工作区（`useSessions.byId[id].cwd`）。
   *
   * - `null` = 不可知（宿主未注入会话 scope / 桌面 / 旧代宿主）→ 不跟随；
   * - 非 null 且 `pinnedWorkspace === null` → 跟随副作用会把 `currentWorkspace`
   *   对齐到它。本字段是**可观测的真相源**（UI 显示「跟随中」与诊断），
   *   不是第二个 currentWorkspace。
   * 不进 persist：会话身份每次渲染由宿主重新注入，持久化只会复活过期会话。
   */
  sessionWorkspace: string | null;
  /**
   * 用户手动切换的粘性覆盖（pin）：非 null 时轮询与会话跟随都不得覆盖
   * `currentWorkspace`（cycle-85 教训：显式用户意图必须是粘性状态）。
   * 仅驻内存——刷新后回到跟随态，满足「可切换但刷新后恢复对话工作区」。
   */
  pinnedWorkspace: string | null;
  /** 用户手动切换（写入 pin）；`null` = 解除 pin、回到会话跟随态。 */
  pinWorkspace: (path: string | null) => void;
  /** 会话跟随副作用写入的真相源（不改变 currentWorkspace；对齐由副作用完成）。 */
  setSessionWorkspace: (path: string | null) => void;

  pathStartId: NodeId | null;
  pathEndId: NodeId | null;
  pathResult: NodeId[] | null;

  focusDepth: number;
  focusModeActive: boolean;
  focusModeNodeId: NodeId | null;

  pathFilterInclude: string | null;
  pathFilterExclude: string | null;

  callChainDepth: number;

  fanInThreshold: number;
  fanOutThreshold: number;
  visibleNodeTypes: Set<GraphNode['type']>;
  visibleEdgeTypes: Set<GraphEdge['type']>;
  heatmapMode: HeatmapMode;
  todoMarkerMode: TodoMarkerMode;

  healthScore: HealthScore | null;
  rules: RuleDefinition[];
  ruleViolations: RuleViolation[];
  deadCodeResult: DeadCodeResult | null;
  deadCodeModeActive: boolean;

  /**
   * 当前生效的版本对比结果（研究报告 §六 #13）。
   *
   * `null` 表示「没有在做版本对比」。非 `null` 时 `nodes`/`edges` 是**只含变更项**的子图，
   * 由 `/diff` 返回，绝不能交给 `setGraphData` —— 那会把画布替换成一张只有变更项的残图。
   * 它只用于两件事：① 把 diff 索引标到当前画布上；② 面板显示「新增/修改/删除」计数。
   *
   * 刻意不持久化（不在 `partialize` 白名单里）：diff 结果绑定的是「这一次请求的两个 git
   * 引用」，跨会话恢复出一个上次的对比状态只会让用户看到一个自己没发起的标记层。
   */
  diffResult: DiffState | null;

  panelHeight: number | null;
  panelWidth: number | null;

  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;

  performanceDegradations: string[];

  lodLevel: 'minimal' | 'compact' | 'full';
  lodEnabled: boolean;

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number; timestamp?: number; etag?: string | null; xuanji?: { applied: boolean; addedPaths?: number; degradedRules?: readonly string[]; invariantViolations?: readonly string[] } }) => void;
  setBootstrapData: (rootNodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata: { totalNodeCount: number; totalEdgeCount: number; timestamp: number; graphLayer?: 'upstream' | 'native' | 'empty' }) => void;
  setLayout: (layout: LayoutType) => void;
  setDagreRankDir: (dir: RankDir) => void;
  setTheme: (theme: ThemeType) => void;
  setSearchQuery: (query: string) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setHighlightedNodes: (nodeIds: NodeId[]) => void;
  /** 多选镜像同步（cycle-149）：渲染器 onSelectionToggle 回传的完整集合。 */
  syncMultiSelection: (ids: readonly string[]) => void;
  /** 多选镜像清空（渲染器普通点击 / Esc 静默清空时的对侧同步）。 */
  clearMultiSelection: () => void;
  /** 批量展开选区；返回处理数（0 = 空选区）。复用 batchExpandNodes 的预算/pinned 语义。 */
  batchExpandSelected: () => number;
  /** 批量收起选区（单次重聚类，pinned 豁免）；返回实际收起数。 */
  batchCollapseSelected: () => number;
  /** 导出选区数据快照（rawNodes 过滤；聚合节点跳过）。 */
  exportSelectedNodes: () => GraphNode[];
  setFilterType: (filter: GraphNode['type'] | 'all') => void;
  setGraphType: (graphType: GraphType) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setLayer: (layer: number) => void;
  setClusterDepth: (depth: number) => void;
  setHierarchyLevel: (level: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearGraph: () => void;
  setPrerequisites: (status: PrerequisiteStatus) => void;
  setIntegrationMode: (mode: IntegrationMode) => void;
  setPanelVisible: (visible: boolean) => void;
  setInitStatus: (status: 'idle' | 'initializing' | 'done' | 'error', message?: string | null) => void;
  setIndexStatus: (status: 'ready' | 'building' | 'empty') => void;
  setWatchEnabled: (enabled: boolean) => void;
  expandNode: (nodeId: string) => void;
  loadNodeChildren: (nodeId: string, options?: { signal?: AbortSignal }) => Promise<void>;
  loadBootstrap: () => Promise<boolean>;
  batchExpandNodes: (nodeIds: string[]) => void;
  prefetchExpand: (nodeId: string) => void;
  collapseNode: (nodeId: string) => void;
  collapseAll: () => void;
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name?: string) => void;
  removeWorkspace: (path: string) => void;
  setPathStart: (nodeId: NodeId | null) => void;
  setPathEnd: (nodeId: NodeId | null) => void;
  setPathResult: (path: NodeId[] | null) => void;
  setFocusDepth: (depth: number) => void;
  setFocusMode: (active: boolean, nodeId: NodeId | null) => void;
  setPathFilter: (include: string | null, exclude: string | null) => void;
  setCallChainDepth: (depth: number) => void;
  setFanInThreshold: (threshold: number) => void;
  setFanOutThreshold: (threshold: number) => void;
  setVisibleNodeTypes: (types: Set<GraphNode['type']>) => void;
  setVisibleEdgeTypes: (types: Set<GraphEdge['type']>) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  setTodoMarkerMode: (mode: TodoMarkerMode) => void;
  assembleMultiFunction: (entryNodeId: string) => Promise<void>;
  setHealthScore: (score: HealthScore | null) => void;
  setRules: (rules: RuleDefinition[]) => void;
  setRuleViolations: (violations: RuleViolation[]) => void;
  setDeadCodeResult: (result: DeadCodeResult | null) => void;
  setDeadCodeModeActive: (active: boolean) => void;
  /**
   * 保存一次成功的版本对比结果（研究报告 §六 #13）。
   *
   * 入参是**已归一化**的 diff 子图；`setDiffResult` 只负责落库，不做网络请求——请求在
   * `src/client/api/index.ts` 的 `fetchGraphDiff`，编排在 `useDiffComparison`。
   */
  setDiffResult: (result: DiffState | null) => void;
  /** 清空版本对比（面板关闭 / 工作区切换 / 整图替换时调用）。 */
  clearDiffResult: () => void;
  setSelectedFunction: (fn: { nodeId: string; filePath: string; functionName: string } | null) => void;
  assembleMicro: (viewMode: 'cfg' | 'flowchart' | 'sequence', selectedFunctionOverride?: { nodeId: string; filePath: string; functionName: string } | null) => Promise<void>;
  setPanelSize: (height: number, width: number) => void;
  resetPanelSize: () => void;
  addDegradation: (key: string) => void;
  clearDegradations: () => void;
  setLODLevel: (level: 'minimal' | 'compact' | 'full') => void;
  setLODEnabled: (enabled: boolean) => void;
  pinNode: (nodeId: string) => void;
  unpinNode: (nodeId: string) => void;
  cancelPendingRequest: (nodeId: string) => void;
  loadNodeEdges: (nodeId: string, options?: { append?: boolean; scope?: 'file' | 'symbol'; detail?: boolean }) => Promise<void>;
  /**
   * Fetch and merge the next AST page for a symbol whose body exceeded the
   * single-symbol budget (`SYMBOL_AST.MAX_NODES`).
   *
   * The host cuts `/symbols/{id}/ast` at the budget; without this action the
   * folded part would be unreachable. Returns `false` when there is nothing
   * more to load.
   */
  loadMoreAst: (nodeId: string) => Promise<boolean>;
  /**
   * Apply a targeted update from the host (P2-21).
   *
   * Returns `false` when the delta does not describe the revision the store currently holds, in
   * which case the caller must fall back to a full reload rather than rendering a half-applied
   * graph. Returns `true` when the delta was applied or was legitimately empty.
   */
  applyGraphDelta: (delta: GraphDelta) => boolean;
  restoreFromUrl: () => Promise<void>;
}