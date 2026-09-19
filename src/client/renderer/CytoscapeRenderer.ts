import cytoscape, { type Core } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import type { IRenderer, LayoutType, ThemeType } from './IRenderer.ts';
import type { CycleInfo } from './HighlightController.ts';
import { LayoutController } from './LayoutController.ts';
import { HighlightController } from './HighlightController.ts';
import { ViewportController } from './ViewportController.ts';
import { DataController } from './DataController.ts';
import { StyleController } from './StyleController.ts';
import { InteractionController, type InteractionCallbacks } from './InteractionController.ts';
import { PathFinder, type PathResult } from './PathFinder.ts';
import { VirtualViewportController } from './VirtualViewportController.ts';
import { RENDERER } from '../../shared/constants.ts';

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
  private viewportCtrl: ViewportController | null = null;
  private dataCtrl: DataController | null = null;
  private styleCtrl: StyleController | null = null;
  private interactionCtrl: InteractionController | null = null;
  private pathFinder: PathFinder | null = null;
  private virtualViewportCtrl: VirtualViewportController | null = null;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;

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
      });

      const cy = this.cy;
      this.styleCtrl = new StyleController(cy, this.options.theme);
      cy.style().fromJson(this.styleCtrl.getStylesheet()).update();

      this.layoutCtrl = new LayoutController(cy);
      this.highlightCtrl = new HighlightController(cy);
      this.viewportCtrl = new ViewportController(cy);
      this.dataCtrl = new DataController(cy);
      this.interactionCtrl = new InteractionController(cy, {
        onNodeTap: this.options.onNodeTap ?? (() => {}),
        onEdgeTap: this.options.onEdgeTap ?? (() => {}),
        onNodeDoubleTap: this.options.onNodeDoubleTap ?? (() => {}),
        onNodeHover: this.options.onNodeHover ?? (() => {}),
        onNodeHoverOut: this.options.onNodeHoverOut ?? (() => {}),
        onEdgeHover: this.options.onEdgeHover ?? (() => {}),
        onEdgeHoverOut: this.options.onEdgeHoverOut ?? (() => {}),
      });
      this.pathFinder = new PathFinder(cy);
      this.virtualViewportCtrl = new VirtualViewportController(cy);
    } catch (err) {
      this.pathFinder?.destroy();
      this.virtualViewportCtrl?.destroy();
      this.interactionCtrl?.destroy();
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
    this.dataCtrl?.updateData(nodes, edges);
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
  }

  setRawNodes(rawNodes: GraphNode[]): void {
    this.dataCtrl?.setRawNodes(rawNodes);
  }

  applyLayout(layout: LayoutType): void {
    this.layoutCtrl?.applyLayout(layout);
  }

  applyIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void {
    this.layoutCtrl?.applyIncrementalLayout(layout, newNodeIds);
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

  filterByType(type: string): void {
    this.dataCtrl?.filterByType(type);
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    this.dataCtrl?.filterByGraphType(graphType);
  }

  applyConnectionFilters(
    fanInThreshold: number,
    fanOutThreshold: number,
    visibleNodeTypes: Set<GraphNode['type']>,
    visibleEdgeTypes: Set<GraphEdge['type']>,
  ): void {
    this.dataCtrl?.applyConnectionFilters(fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes);
  }

  search(query: string): number {
    return this.dataCtrl?.search(query) ?? 0;
  }

  focusOnNode(nodeId: string): void {
    this.viewportCtrl?.focusOnNode(nodeId);
  }

  highlightCallChain(nodeId: NodeId | null): void {
    this.highlightCtrl?.highlightCallChain(nodeId);
  }

  detectCycles(): Set<string> {
    return this.highlightCtrl?.detectCycles() ?? new Set();
  }

  detectCyclesDetailed(): CycleInfo[] {
    return this.highlightCtrl?.detectCyclesDetailed() ?? [];
  }

  highlightCycles(cycleIds: Set<string>): void {
    this.highlightCtrl?.highlightCycles(cycleIds);
  }

  isolateCycles(cycleIds: Set<string>): void {
    this.highlightCtrl?.isolateCycles(cycleIds);
  }

  restoreIsolation(): void {
    this.highlightCtrl?.restoreIsolation();
  }

  highlightImpact(nodeId: NodeId | null): void {
    this.highlightCtrl?.highlightImpact(nodeId);
  }

  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null {
    return this.highlightCtrl?.getImpactStats(nodeId) ?? null;
  }

  highlightInheritance(nodeId: NodeId | null): void {
    this.highlightCtrl?.highlightInheritance(nodeId);
  }

  focusNeighborhood(nodeId: NodeId | null): void {
    this.viewportCtrl?.focusNeighborhood(nodeId);
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
    return this.dataCtrl?.exportJSON() ?? '';
  }

  exportMermaid(): string {
    return this.dataCtrl?.exportMermaid() ?? 'graph TD\n';
  }

  exportPNG(): string | null {
    return this.dataCtrl?.exportPNG() ?? null;
  }

  exportSVG(theme?: ThemeType): string | null {
    return this.dataCtrl?.exportSVG(theme ?? this.options.theme) ?? null;
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
    this.viewportCtrl?.resize();
  }

  updateTheme(theme: ThemeType): void {
    this.options.theme = theme;
    this.styleCtrl?.updateTheme(theme);
  }

  destroy(): void {
    this.interactionCtrl?.destroy();
    this.layoutCtrl?.destroy();
    this.virtualViewportCtrl?.destroy();
    this.dataCtrl?.destroy();
    this.highlightCtrl?.destroy();
    this.viewportCtrl?.destroy();
    this.styleCtrl?.destroy();
    this.pathFinder?.destroy();
    this.cy?.destroy();
    this.cy = null;
    if (this.fitTimer !== null) {
      clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.layoutCtrl = null;
    this.highlightCtrl = null;
    this.viewportCtrl = null;
    this.dataCtrl = null;
    this.styleCtrl = null;
    this.interactionCtrl = null;
    this.pathFinder = null;
  }

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null {
    return this.pathFinder?.findPath(sourceId, targetId) ?? null;
  }

  highlightPath(path: NodeId[] | null): void {
    this.pathFinder?.highlightPath(path);
  }

  expandNeighborhood(nodeId: NodeId, depth: number): Set<string> {
    return this.viewportCtrl?.expandNeighborhood(nodeId, depth) ?? new Set();
  }
}
