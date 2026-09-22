import cytoscape, { type Core } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import type { GraphNode, GraphEdge, NodeId, HeatmapMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import type { IRenderer, LayoutType, ThemeType, RankDir } from './IRenderer.ts';
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
      return fallback;
    }
  }

  private safeCallVoid(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error(`${name} failed`, err);
    }
  }

  private safeCallWithError<T>(name: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      log.error(`${name} failed`, err);
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return fallback;
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
        style: [],
        layout: { name: 'cose' },
        headless: false,
        hideEdgesOnViewport: true,
        hideLabelsOnViewport: true,
        textureOnViewport: false,
      });

      const cy = this.cy;
      this.adjacencyCache = new AdjacencyCache();
      this.styleCtrl = new StyleController(cy, this.options.theme);
      cy.style().fromJson(this.styleCtrl.getStylesheet()).update();

      this.layoutCtrl = new LayoutController(cy);
      this.highlightCtrl = new HighlightController(cy);
      this.cycleDetector = new CycleDetector(cy, this.adjacencyCache);
      this.impactAnalyzer = new ImpactAnalyzer(cy);
      this.viewportCtrl = new ViewportController(cy);
      this.dataCtrl = new DataController(cy);
      this.filterCtrl = new FilterController(cy);
      this.searchCtrl = new SearchController(cy, this.dataCtrl.getRawNodesMap(), this.dataCtrl.getRawToVisibleMap());
      this.exportCtrl = new ExportController(cy);
      this.interactionCtrl = new InteractionController(cy, {
        onNodeTap: this.options.onNodeTap ?? (() => {}),
        onEdgeTap: this.options.onEdgeTap ?? (() => {}),
        onNodeDoubleTap: this.options.onNodeDoubleTap ?? (() => {}),
        onNodeHover: this.options.onNodeHover ?? (() => {}),
        onNodeHoverOut: this.options.onNodeHoverOut ?? (() => {}),
        onEdgeHover: this.options.onEdgeHover ?? (() => {}),
        onEdgeHoverOut: this.options.onEdgeHoverOut ?? (() => {}),
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
    this.safeCallWithError('updateData', () => {
      this.dataCtrl?.updateData(nodes, edges);
      this.adjacencyCache?.invalidate();
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

  enableVirtualScroll(): void {
    this.virtualViewportCtrl?.enable();
  }

  disableVirtualScroll(): void {
    this.virtualViewportCtrl?.disable();
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

  exportPNG(): string | null {
    return this.safeCall('exportPNG', () => this.exportCtrl?.exportPNG() ?? null, null);
  }

  exportSVG(theme?: ThemeType): string | null {
    return this.safeCall('exportSVG', () => this.exportCtrl?.exportSVG(theme ?? this.options.theme) ?? null, null);
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

  setMultiDimensionMapping(sizeMetric: string | null, colorMetric: string | null): void {
    this.safeCallVoid('setMultiDimensionMapping', () => this.styleCtrl?.setMultiDimensionMapping(sizeMetric, colorMetric));
  }

  destroy(): void {
    this.interactionCtrl?.destroy();
    this.layoutCtrl?.destroy();
    this.virtualViewportCtrl?.destroy();
    this.exportCtrl?.destroy();
    this.searchCtrl?.destroy();
    this.filterCtrl?.destroy();
    this.dataCtrl?.destroy();
    this.impactAnalyzer?.destroy();
    this.cycleDetector?.destroy();
    this.highlightCtrl?.destroy();
    this.viewportCtrl?.destroy();
    this.styleCtrl?.destroy();
    this.pathFinder?.destroy();
    this.adjacencyCache?.destroy();
    this.cy?.destroy();
    this.cy = null;
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
    this.safeCallWithError('filterByPath', () => this.filterCtrl?.filterByPath(includePattern, excludePattern), undefined);
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }
}
