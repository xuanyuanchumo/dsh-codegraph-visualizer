import cytoscape, { type Core, type EdgeSingular, type NodeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import type { GraphNode, GraphEdge, NodeId, HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import type { IRenderer, LayoutType, ThemeType, RankDir } from './IRenderer.ts';
import type { DiffIndex, DiffMarkStats } from '../../shared/diffStatus.ts';
import type { CycleInfo } from './CycleDetector.ts';
import { LayoutController } from './LayoutController.ts';
import { HighlightController } from './HighlightController.ts';
import { CycleDetector } from './CycleDetector.ts';
import { ImpactAnalyzer } from './ImpactAnalyzer.ts';
import { ViewportController } from './ViewportController.ts';
import { DataController } from './DataController.ts';
import { FilterController } from './FilterController.ts';
import { SearchController } from './SearchController.ts';
import { ExportController } from './ExportController.ts';
import { StyleController } from './StyleController.ts';
import { InteractionController, type InteractionCallbacks } from './InteractionController.ts';
import { PathFinder, type PathResult } from './PathFinder.ts';
import { VirtualViewportController } from './VirtualViewportController.ts';
import { AdjacencyCache } from './AdjacencyCache.ts';
import { RENDERER } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('cytoscape-renderer');

function ensureExtensionsRegistered(): void {
  const cy = cytoscape as unknown as { __dagreRegistered?: boolean; __fcoseRegistered?: boolean };
  if (!cy.__dagreRegistered) {
    cytoscape.use(dagre);
    cy.__dagreRegistered = true;
  }
  if (!cy.__fcoseRegistered) {
    cytoscape.use(fcose);
    cy.__fcoseRegistered = true;
  }
}

export interface CytoscapeRendererOptions extends InteractionCallbacks {
  container: HTMLElement;
  theme: ThemeType;
}

export class CytoscapeRenderer implements IRenderer {
  private cy: Core | null = null;
  private options: CytoscapeRendererOptions;
  private layoutCtrl: LayoutController | null = null;
  private highlightCtrl: HighlightController | null = null;
  private cycleDetector: CycleDetector | null = null;
  private impactAnalyzer: ImpactAnalyzer | null = null;
  private viewportCtrl: ViewportController | null = null;
  private dataCtrl: DataController | null = null;
  private filterCtrl: FilterController | null = null;
  private searchCtrl: SearchController | null = null;
  private exportCtrl: ExportController | null = null;
  private styleCtrl: StyleController | null = null;
  private interactionCtrl: InteractionController | null = null;
  private pathFinder: PathFinder | null = null;
  private virtualViewportCtrl: VirtualViewportController | null = null;
  private adjacencyCache: AdjacencyCache | null = null;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: Error | null = null;

  private safeCall<T>(name: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      log.error(`${name} failed`, err);
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return fallback;
    }
  }

  private safeCallVoid(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error(`${name} failed`, err);
      this.lastError = err instanceof Error ? err : new Error(String(err));
    }
  }


  constructor(options: CytoscapeRendererOptions) {
    this.options = options;
  }

  init(): void {
    if (this.cy) return;
    ensureExtensionsRegistered();

    try {
      this.cy = cytoscape({
        container: this.options.container,
        minZoom: RENDERER.MIN_ZOOM,
        maxZoom: RENDERER.MAX_ZOOM,
        wheelSensitivity: 0.3,
        style: [],
        layout: { name: 'cose' },
        headless: false,
        hideEdgesOnViewport: true,
        hideLabelsOnViewport: true,
        textureOnViewport: false,
      });

      const cy = this.cy;
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__cytoscape = cy;
      }
      this.adjacencyCache = new AdjacencyCache();
      this.styleCtrl = new StyleController(cy, this.options.theme);
      cy.style().fromJson(this.styleCtrl.getStylesheet()).update();

      this.layoutCtrl = new LayoutController(cy);
      this.highlightCtrl = new HighlightController(cy);
      this.cycleDetector = new CycleDetector(cy, this.adjacencyCache);
      this.impactAnalyzer = new ImpactAnalyzer(cy);
      this.viewportCtrl = new ViewportController(cy);
      this.dataCtrl = new DataController(cy);
      // cycle-126 · T1：把邻接缓存并网通道交给 DataController——结构性增量路径
      // 由此逐边同步缓存，全量重置路径由此显式 invalidate。
      this.dataCtrl.setAdjacencyCache(this.adjacencyCache!);
      this.filterCtrl = new FilterController(cy);
      this.searchCtrl = new SearchController(cy, this.dataCtrl.getRawNodesMap(), this.dataCtrl.getRawToVisibleMap());
      this.exportCtrl = new ExportController(cy);
      this.interactionCtrl = new InteractionController(cy, {
        onNodeTap: this.options.onNodeTap ?? (() => {}),
        onEdgeTap: this.options.onEdgeTap ?? (() => {}),
        onNodeDoubleTap: this.options.onNodeDoubleTap ?? (() => {}),
        onNodeHover: this.options.onNodeHover ?? (() => {}),
        ...(this.options.onNodeHoverPrefetch ? { onNodeHoverPrefetch: this.options.onNodeHoverPrefetch } : {}),
        onNodeHoverOut: this.options.onNodeHoverOut ?? (() => {}),
        onEdgeHover: this.options.onEdgeHover ?? (() => {}),
        onEdgeHoverOut: this.options.onEdgeHoverOut ?? (() => {}),
        ...(this.options.onNodeContextTap ? { onNodeContextTap: this.options.onNodeContextTap } : {}),
      });
      this.pathFinder = new PathFinder(cy, this.adjacencyCache);
      this.virtualViewportCtrl = new VirtualViewportController(cy);
    } catch (err) {
      this.pathFinder?.destroy();
      this.virtualViewportCtrl?.destroy();
      this.interactionCtrl?.destroy();
      this.exportCtrl?.destroy();
      this.searchCtrl?.destroy();
      this.filterCtrl?.destroy();
      this.impactAnalyzer?.destroy();
      this.cycleDetector?.destroy();
      this.highlightCtrl?.destroy();
      this.viewportCtrl?.destroy();
      this.layoutCtrl?.destroy();
      this.dataCtrl?.destroy();
      this.styleCtrl?.destroy();
      this.cy?.destroy();
      this.cy = null;
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__cytoscape = null;
      }
      this.pathFinder = null;
      this.virtualViewportCtrl = null;
      this.interactionCtrl = null;
      this.exportCtrl = null;
      this.searchCtrl = null;
      this.filterCtrl = null;
      this.impactAnalyzer = null;
      this.cycleDetector = null;
      this.highlightCtrl = null;
      this.viewportCtrl = null;
      this.layoutCtrl = null;
      this.dataCtrl = null;
      this.styleCtrl = null;
      throw err;
    }
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.cy) throw new Error('CytoscapeRenderer: init() must be called before updateData()');
    this.safeCall('updateData', () => {
      // cycle-126 · T1：DataController 返回「邻接缓存同步决定」——
      // patch = 已逐边并网（version 对账通过则禁 invalidate），
      // dirty = 无法追踪（批量异步 / 桩 / 换端点降级），必须整体失效。
      const sync = this.dataCtrl?.updateData(nodes, edges);
      const cache = this.adjacencyCache;
      if (!cache) {
        // 无缓存通道：保持旧总行为（filter/highlight 失效照做）。
      } else if (!sync || sync.kind === 'dirty') {
        cache.invalidate();
      } else if (sync.expectedVersion !== undefined && cache.getVersion() !== sync.expectedVersion) {
        // O(1) 内容对账：版本号不一致说明缓存被别的路径动过（筛选/高亮重建），
        // 此时 DataController 的并网账本已不可信——降级全量重建。
        cache.invalidate();
      }
      // expectedVersion === undefined（旧测试桩未带通道）时保持现状：
      // DataController 已并网或已显式 invalidate，这里不再叠加失效。
      this.filterCtrl?.invalidateCache();
      this.highlightCtrl?.invalidateCache();
      if (this.cy && nodes.length > 0) {
        if (this.fitTimer !== null) clearTimeout(this.fitTimer);
        const fitDelay = nodes.length > RENDERER.LARGE_GRAPH_NODE_THRESHOLD ? RENDERER.FIT_DELAY_LARGE : RENDERER.FIT_DELAY_SMALL;
        this.fitTimer = setTimeout(() => {
          this.fitTimer = null;
          if (this.cy && this.cy.nodes().length > 0) {
            this.cy.fit(undefined, RENDERER.FIT_PADDING);
          }
        }, fitDelay);
      }
    }, undefined);
  }

  setRawNodes(rawNodes: GraphNode[]): void {
    this.dataCtrl?.setRawNodes(rawNodes);
    this.searchCtrl?.rebuildIndex();
  }

  applyLayout(layout: LayoutType): void {
    this.safeCallVoid('applyLayout', () => this.layoutCtrl?.applyLayout(layout));
  }

  setDagreRankDir(dir: RankDir): void {
    if (this.layoutCtrl) this.layoutCtrl.rankDir = dir;
  }

  applyIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void {
    this.safeCallVoid('applyIncrementalLayout', () => this.layoutCtrl?.applyIncrementalLayout(layout, newNodeIds));
  }

  isWorkerLayoutAvailable(): boolean {
    return this.layoutCtrl?.isWorkerAvailable() ?? false;
  }

  applyLayoutWithWorker(nodes: GraphNode[], edges: GraphEdge[], layout: LayoutType): Promise<Record<string, { x: number; y: number }>> {
    return this.layoutCtrl?.applyLayoutWithWorker(nodes, edges, layout) ?? Promise.resolve({});
  }

  applyWorkerLayout(positions: Record<string, { x: number; y: number }>): void {
    this.layoutCtrl?.applyWorkerLayout(positions);
  }

  /**
   * 开启虚拟视口（视口外的节点不渲染）。
   *
   * 这里额外往容器上写一个 `data-cg-virtual-scroll` 标记，原因是这个特性在 DOM 上
   * **完全不可观测**：它只改 cytoscape 内部的 `display` 状态，元素还在、canvas 还在，
   * 任何「元素可见」类断言在开启与未开启时结果相同。cycle-93 之前 E2E 的 J35
   * 因此只能断言「容器可见」，零鉴别力。
   *
   * 标记沿用本仓库既有的 `data-cg-*` 集成标记约定（`useGraphDerivedValues.ts:71` 的
   * `data-cg-integration`）。写成「只有真的启用成功才标记」，避免
   * `virtualViewportCtrl` 为 null 时留下一个骗人的标记。
   */
  enableVirtualScroll(): void {
    this.virtualViewportCtrl?.enable();
    if (this.virtualViewportCtrl?.isEnabled()) {
      this.options.container?.setAttribute?.('data-cg-virtual-scroll', 'on');
    }
  }

  disableVirtualScroll(): void {
    this.virtualViewportCtrl?.disable();
    this.options.container?.removeAttribute?.('data-cg-virtual-scroll');
  }

  isVirtualScrollEnabled(): boolean {
    return this.virtualViewportCtrl?.isEnabled() ?? false;
  }

  shouldEnableVirtualScroll(nodeCount: number): boolean {
    return this.virtualViewportCtrl?.shouldEnable(nodeCount) ?? false;
  }

  highlightNodes(nodeIds: NodeId[]): void {
    this.highlightCtrl?.highlightNodes(nodeIds);
  }

  selectNode(nodeId: NodeId | null): void {
    this.highlightCtrl?.selectNode(nodeId);
  }

  hideNode(nodeId: NodeId): void {
    this.safeCallVoid('hideNode', () => this.cy?.getElementById(nodeId).style('display', 'none'));
  }

  showAllNodes(): void {
    this.safeCallVoid('showAllNodes', () => this.cy?.nodes().style('display', 'element'));
  }

  getVisibleNodeCount(): number {
    return this.safeCall('getVisibleNodeCount', () => this.cy?.nodes(':visible').length ?? 0, 0);
  }

  filterByType(type: string): void {
    this.filterCtrl?.filterByType(type);
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    this.filterCtrl?.filterByGraphType(graphType);
  }

  applyConnectionFilters(
    fanInThreshold: number,
    fanOutThreshold: number,
    visibleNodeTypes: Set<GraphNode['type']>,
    visibleEdgeTypes: Set<GraphEdge['type']>,
  ): void {
    this.safeCallVoid('applyConnectionFilters', () => this.filterCtrl?.applyConnectionFilters(fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes));
  }

  search(query: string): number {
    return this.searchCtrl?.search(query) ?? 0;
  }

  focusOnNode(nodeId: string): void {
    this.viewportCtrl?.focusOnNode(nodeId);
  }

  /**
   * Bring a node the user explicitly asked for (a search hit, a host symbol link) into view even
   * when it is currently hidden, then centre the viewport on it. Returns `false` when the node is
   * not in the rendered graph at all, or when it is excluded by an active type/connection filter —
   * silently panning to an element the filter keeps invisible is what made "search a hidden node"
   * look like a no-op.
   */
  revealNode(nodeId: string): boolean {
    return this.safeCall('revealNode', () => {
      const cy = this.cy;
      const node = cy?.getElementById(nodeId);
      if (!cy || !node || node.empty()) return false;
      if (this.isFilterHidden(node)) return false;

      if (node.style('display') === 'none') {
        node.style('display', 'element');
        node.connectedEdges().forEach((edge: EdgeSingular) => {
          if (this.isFilterHidden(edge)) return;
          if (edge.source().style('display') === 'none' || edge.target().style('display') === 'none') return;
          edge.style('display', 'element');
        });
      }

      this.viewportCtrl?.focusOnNode(nodeId);
      return true;
    }, false);
  }

  private isFilterHidden(el: NodeSingular | EdgeSingular): boolean {
    return el.data('typeFiltered') === true || el.data('connectionFiltered') === true;
  }

  /**
   * Viewport-space position used to anchor the context menu when the user opens it without a
   * pointer. Cytoscape keeps reporting the last computed position for `display: none` elements,
   * and the menu clamps itself into the viewport, so only a node that is really absent returns
   * `null`. Cytoscape 的渲染坐标相对画布容器，这里叠加容器原点换算成视口坐标。
   */
  getNodeRenderedPosition(nodeId: string): { x: number; y: number } | null {
    return this.safeCall('getNodeRenderedPosition', () => {
      const node = this.cy?.getElementById(nodeId);
      if (!node || node.empty() || !node.isNode()) return null;
      const pos = node.renderedPosition();
      const rect = this.options.container?.getBoundingClientRect?.();
      if (!rect) return { x: pos.x, y: pos.y };
      return { x: pos.x + rect.left, y: pos.y + rect.top };
    }, null);
  }

  highlightCallChain(nodeId: NodeId | null): void {
    this.safeCallVoid('highlightCallChain', () => this.highlightCtrl?.highlightCallChain(nodeId));
  }

  detectCycles(): Set<string> {
    return this.safeCall('detectCycles', () => this.cycleDetector?.detectCycles() ?? new Set(), new Set());
  }

  detectCyclesDetailed(): CycleInfo[] {
    return this.safeCall('detectCyclesDetailed', () => this.cycleDetector?.detectCyclesDetailed() ?? [], []);
  }

  highlightCycles(cycleIds: Set<string>): void {
    this.safeCallVoid('highlightCycles', () => this.cycleDetector?.highlightCycles(cycleIds));
  }

  isolateCycles(cycleIds: Set<string>): void {
    this.safeCallVoid('isolateCycles', () => this.cycleDetector?.isolateCycles(cycleIds));
  }

  relayoutCycles(cycleIds: Set<string>): void {
    this.safeCallVoid('relayoutCycles', () => this.cycleDetector?.relayoutCycles(cycleIds));
  }

  restoreIsolation(): void {
    this.safeCallVoid('restoreIsolation', () => this.cycleDetector?.restoreIsolation());
  }

  highlightImpact(nodeId: NodeId | null): void {
    this.safeCallVoid('highlightImpact', () => this.impactAnalyzer?.highlightImpact(nodeId));
  }

  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null {
    return this.safeCall('getImpactStats', () => this.impactAnalyzer?.getImpactStats(nodeId) ?? null, null);
  }

  highlightInheritance(nodeId: NodeId | null): void {
    this.safeCallVoid('highlightInheritance', () => this.highlightCtrl?.highlightInheritance(nodeId));
  }

  focusNeighborhood(nodeId: NodeId | null): void {
    this.safeCallVoid('focusNeighborhood', () => this.viewportCtrl?.focusNeighborhood(nodeId));
  }

  getThumbnail(): string | null {
    return this.viewportCtrl?.getThumbnail() ?? null;
  }

  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null {
    return this.viewportCtrl?.getViewportInfo() ?? null;
  }

  focusOnArea(x: number, y: number, zoom: number): void {
    this.viewportCtrl?.focusOnArea(x, y, zoom);
  }

  exportJSON(): string {
    return this.exportCtrl?.exportJSON() ?? '';
  }

  exportMermaid(): string {
    return this.exportCtrl?.exportMermaid() ?? 'graph TD\n';
  }

  exportMermaidSequence(): string {
    return this.exportCtrl?.exportMermaidSequence() ?? 'sequenceDiagram\n';
  }

  exportMermaidClass(): string {
    return this.exportCtrl?.exportMermaidClass() ?? 'classDiagram\n';
  }

  exportPNG(): string | null {
    return this.safeCall('exportPNG', () => this.exportCtrl?.exportPNG() ?? null, null);
  }

  exportSVG(theme?: ThemeType): string | null {
    return this.safeCall('exportSVG', () => this.exportCtrl?.exportSVG(theme ?? this.options.theme) ?? null, null);
  }

  exportGraphML(): string {
    return this.safeCall('exportGraphML', () => this.exportCtrl?.exportGraphML() ?? '', '');
  }

  exportJSONLD(): string {
    return this.safeCall('exportJSONLD', () => this.exportCtrl?.exportJSONLD() ?? '', '');
  }

  getSelectedNodeData(): GraphNode | ClusterNode | null {
    return this.dataCtrl?.getSelectedNodeData() ?? null;
  }

  getNodeData(nodeId: string): GraphNode | ClusterNode | null {
    return this.dataCtrl?.getNodeData(nodeId) ?? null;
  }

  getEdgeData(edgeId: string): GraphEdge | null {
    return this.dataCtrl?.getEdgeData(edgeId) ?? null;
  }

  resize(): void {
    this.safeCallVoid('resize', () => this.viewportCtrl?.resize());
  }

  updateTheme(theme: ThemeType): void {
    this.options.theme = theme;
    this.styleCtrl?.updateTheme(theme);
  }

  setHeatmapMode(mode: HeatmapMode): void {
    this.styleCtrl?.setHeatmapMode(mode);
  }

  getHeatmapMode(): HeatmapMode {
    return this.styleCtrl?.getHeatmapMode() ?? 'none';
  }

  setTodoMarkerMode(mode: TodoMarkerMode): void {
    this.styleCtrl?.setTodoMarkerMode(mode);
  }

  getTodoMarkerMode(): TodoMarkerMode {
    return this.styleCtrl?.getTodoMarkerMode() ?? 'none';
  }

  setMultiDimensionMapping(sizeMetric: string | null, colorMetric: string | null): void {
    this.safeCallVoid('setMultiDimensionMapping', () => this.styleCtrl?.setMultiDimensionMapping(sizeMetric, colorMetric));
  }

  destroy(): void {
    const safeDestroy = (label: string, fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        log.warn(`destroy: ${label} cleanup failed`, err);
      }
    };
    safeDestroy('interactionCtrl', () => this.interactionCtrl?.destroy());
    safeDestroy('layoutCtrl', () => this.layoutCtrl?.destroy());
    safeDestroy('virtualViewportCtrl', () => this.virtualViewportCtrl?.destroy());
    safeDestroy('exportCtrl', () => this.exportCtrl?.destroy());
    safeDestroy('searchCtrl', () => this.searchCtrl?.destroy());
    safeDestroy('filterCtrl', () => this.filterCtrl?.destroy());
    safeDestroy('dataCtrl', () => this.dataCtrl?.destroy());
    safeDestroy('impactAnalyzer', () => this.impactAnalyzer?.destroy());
    safeDestroy('cycleDetector', () => this.cycleDetector?.destroy());
    safeDestroy('highlightCtrl', () => this.highlightCtrl?.destroy());
    safeDestroy('viewportCtrl', () => this.viewportCtrl?.destroy());
    safeDestroy('styleCtrl', () => this.styleCtrl?.destroy());
    safeDestroy('pathFinder', () => this.pathFinder?.destroy());
    safeDestroy('adjacencyCache', () => this.adjacencyCache?.destroy());
    safeDestroy('cy', () => this.cy?.destroy());
    this.cy = null;
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__cytoscape = null;
    }
    if (this.fitTimer !== null) {
      clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.layoutCtrl = null;
    this.highlightCtrl = null;
    this.cycleDetector = null;
    this.impactAnalyzer = null;
    this.viewportCtrl = null;
    this.dataCtrl = null;
    this.filterCtrl = null;
    this.searchCtrl = null;
    this.exportCtrl = null;
    this.styleCtrl = null;
    this.interactionCtrl = null;
    this.pathFinder = null;
    this.adjacencyCache = null;
  }

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null {
    return this.safeCall('findPath', () => this.pathFinder?.findPath(sourceId, targetId) ?? null, null);
  }

  highlightPath(path: NodeId[] | null): void {
    this.safeCallVoid('highlightPath', () => this.pathFinder?.highlightPath(path));
  }

  expandNeighborhood(nodeId: NodeId, depth: number): Set<string> {
    return this.safeCall('expandNeighborhood', () => this.viewportCtrl?.expandNeighborhood(nodeId, depth) ?? new Set(), new Set());
  }

  setFocusMode(nodeId: NodeId | null, depth: number): void {
    this.safeCallVoid('setFocusMode', () => this.viewportCtrl?.setFocusMode(nodeId, depth));
  }

  clearFocusMode(): void {
    this.safeCallVoid('clearFocusMode', () => this.viewportCtrl?.clearFocusMode());
  }

  isFocusModeActive(): boolean {
    return this.viewportCtrl?.isFocusModeActive() ?? false;
  }

  filterByPath(includePattern: string | null, excludePattern: string | null): void {
    this.safeCall('filterByPath', () => this.filterCtrl?.filterByPath(includePattern, excludePattern), undefined);
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  getZoom(): number {
    return this.safeCall('getZoom', () => this.cy?.zoom() ?? 1, 1);
  }

  onZoomChange(callback: () => void): () => void {
    if (!this.cy) return () => {};
    this.cy.on('zoom', callback);
    return () => {
      this.cy?.off('zoom', callback);
    };
  }

  markDeadCode(nodeIds: Set<string>): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        if (nodeIds.has(node.id())) {
          node.addClass('dead-code');
        }
      });
      this.cy!.edges().forEach((edge) => {
        if (nodeIds.has(edge.source().id()) && nodeIds.has(edge.target().id())) {
          edge.addClass('dead-code-edge');
        }
      });
    });
  }

  clearDeadCodeMarks(): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.nodes().removeClass('dead-code dead-code-suspected');
      this.cy!.edges().removeClass('dead-code-edge');
    });
  }

  /**
   * diff 标记的渲染器入口（研究报告 §六 #13）。
   *
   * 实现全部委托给 `HighlightController`：它已经持有 `cy` 并且是「视图态 class」的归属地，
   * 把标记逻辑写两份必然漂移（`markDeadCode` 就是直接写在这里的，代价是它没有复用任何
   * 控制器设施）。渲染器本身只做 `safeCall` 包裹与「控制器不存在时给空统计」的兜底——
   * 后者很重要：控制器为 `null` 时若返回 `undefined`，调用方读 `.counts.added` 会抛错，
   * 而这条路径在「渲染器尚未完成 init」时是真实可达的。
   */
  applyDiffMarkers(index: DiffIndex): DiffMarkStats {
    const empty: DiffMarkStats = { counts: { added: 0, modified: 0, removed: 0 }, missing: 0, marked: 0 };
    return this.safeCall('applyDiffMarkers', () => this.highlightCtrl?.applyDiffMarkers(index) ?? empty, empty);
  }

  clearDiffMarkers(): void {
    this.safeCallVoid('clearDiffMarkers', () => this.highlightCtrl?.clearDiffMarkers());
  }

  pauseAnimations(): void {
    if (!this.cy) return;
    try {
      this.cy.stop();
      this.cy.nodes().stop();
      this.cy.edges().stop();
    } catch (e) {
      log.warn('pauseAnimations failed', e);
    }
  }

  resumeAnimations(): void {
    if (!this.cy) return;
    try {
      this.cy.resize();
    } catch (e) {
      log.warn('resumeAnimations failed', e);
    }
  }

  /** 缩放画布：factor > 1 放大，factor < 1 缩小。带 200ms 动画过渡。 */
  zoomBy(factor: number): void {
    if (!this.cy) return;
    this.safeCallVoid('zoomBy', () => {
      const current = this.cy!.zoom();
      this.cy!.animate({
        zoom: current * factor,
        duration: RENDERER.FOCUS_NODE_ANIMATION_MS,
      });
    });
  }

  /** 适应窗口：所有元素 fit 到视口，带内边距。 */
  fitToView(): void {
    if (!this.cy) return;
    this.safeCallVoid('fitToView', () => {
      this.cy!.animate({
        fit: { eles: this.cy!.elements(), padding: RENDERER.FIT_PADDING },
        duration: RENDERER.FOCUS_NODE_ANIMATION_MS + 100,
      });
    });
  }

  /** 重置视图：fit + center，即时无动画。 */
  resetView(): void {
    if (!this.cy) return;
    this.safeCallVoid('resetView', () => {
      this.cy!.fit(undefined, RENDERER.FIT_PADDING);
      this.cy!.center();
    });
  }
}
