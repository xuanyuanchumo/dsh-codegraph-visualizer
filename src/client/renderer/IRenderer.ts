import type { GraphNode, GraphEdge, NodeId, HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import type { DiffIndex, DiffMarkStats } from '../../shared/diffStatus.ts';
import type { PathResult } from './PathFinder.ts';
import type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';
import type { CycleInfo } from './CycleDetector.ts';
export type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';

export type { HeatmapMode, TodoMarkerMode } from '../../types/index.ts';

export interface RendererCallbacks {
  onNodeTap?(nodeId: string): void;
  onEdgeTap?(edgeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeDoubleTap?(nodeId: string): void;
  onNodeHover?(nodeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeHoverPrefetch?(nodeId: string): void;
  onNodeHoverOut?(): void;
  onEdgeHover?(edgeId: string, renderedPosition: { x: number; y: number }): void;
  onEdgeHoverOut?(): void;
  onNodeContextTap?(nodeId: string, renderedPosition: { x: number; y: number }): void;
}

export interface RendererOptions extends RendererCallbacks {
  container: HTMLElement;
  theme: ThemeType;
}

export interface IRenderer {
  init(): void;
  updateData(nodes: GraphNode[], edges: GraphEdge[]): void;
  setRawNodes(rawNodes: GraphNode[]): void;
  applyLayout(layout: LayoutType): void;
  setDagreRankDir(dir: RankDir): void;
  applyIncrementalLayout(layout: LayoutType, newNodeIds: Set<string>): void;
  isWorkerLayoutAvailable(): boolean;
  applyLayoutWithWorker(nodes: GraphNode[], edges: GraphEdge[], layout: LayoutType): Promise<Record<string, { x: number; y: number }>>;
  applyWorkerLayout(positions: Record<string, { x: number; y: number }>): void;
  enableVirtualScroll(): void;
  disableVirtualScroll(): void;
  isVirtualScrollEnabled(): boolean;
  shouldEnableVirtualScroll(nodeCount: number): boolean;
  highlightNodes(nodeIds: NodeId[]): void;
  selectNode(nodeId: NodeId | null): void;
  hideNode(nodeId: NodeId): void;
  showAllNodes(): void;
  getVisibleNodeCount(): number;
  filterByType(type: string): void;
  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void;
  applyConnectionFilters(
    fanInThreshold: number,
    fanOutThreshold: number,
    visibleNodeTypes: Set<GraphNode['type']>,
    visibleEdgeTypes: Set<GraphEdge['type']>,
  ): void;

  search(query: string): number;
  focusOnNode(nodeId: string): void;
  /** Reveal a node hidden by `hideNode`, then focus it. `false` when it is absent or filter-hidden. */
  revealNode(nodeId: string): boolean;
  /**
   * Viewport-space position of a node, used to anchor the context menu when it is opened from the
   * keyboard (Shift+F10 / the menu key) rather than from a pointer. `null` when the node is not part
   * of the rendered graph, so the caller can skip a menu it has no place to anchor.
   */
  getNodeRenderedPosition(nodeId: string): { x: number; y: number } | null;
  highlightCallChain(nodeId: NodeId | null): void;
  detectCycles(): Set<string>;
  detectCyclesDetailed(): CycleInfo[];
  highlightCycles(cycleIds: Set<string>): void;
  isolateCycles(cycleIds: Set<string>): void;
  relayoutCycles(cycleIds: Set<string>): void;
  restoreIsolation(): void;
  highlightImpact(nodeId: NodeId | null): void;
  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null;
  highlightInheritance(nodeId: NodeId | null): void;
  focusNeighborhood(nodeId: NodeId | null): void;
  /** 清空多选集合（cycle-149）：集合 + `multi-selected` class + 通知消费方一体完成。 */
  clearMultiSelect(): void;
  getThumbnail(): string | null;
  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  focusOnArea(x: number, y: number, zoom: number): void;
  exportJSON(): string;
  exportMermaid(): string;
  exportMermaidSequence(): string;
  exportMermaidClass(): string;
  exportPNG(): string | null;
  exportSVG(theme?: ThemeType): string | null;
  exportGraphML(): string;
  exportJSONLD(): string;
  getSelectedNodeData(): GraphNode | ClusterNode | null;
  getNodeData(nodeId: string): GraphNode | ClusterNode | null;
  getEdgeData(edgeId: string): GraphEdge | null;
  resize(): void;
  updateTheme(theme: ThemeType): void;
  setHeatmapMode(mode: HeatmapMode): void;
  getHeatmapMode(): HeatmapMode;
  setTodoMarkerMode(mode: TodoMarkerMode): void;
  getTodoMarkerMode(): TodoMarkerMode;
  setMultiDimensionMapping(sizeMetric: string | null, colorMetric: string | null): void;
  destroy(): void;

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null;
  highlightPath(path: NodeId[] | null): void;
  expandNeighborhood(nodeId: NodeId, depth: number): Set<string>;
  setFocusMode(nodeId: NodeId | null, depth: number): void;
  clearFocusMode(): void;
  isFocusModeActive(): boolean;
  filterByPath(includePattern: string | null, excludePattern: string | null): void;
  getLastError(): Error | null;
  clearLastError(): void;
  getZoom(): number;
  onZoomChange(callback: () => void): () => void;
  markDeadCode(nodeIds: Set<string>): void;
  clearDeadCodeMarks(): void;
  /**
   * 把一份 diff 索引标记到画布上（研究报告 §六 #13）。
   *
   * 与 `markDeadCode` 同一族「视图态标记」：只加 cytoscape class，不改数据。
   * 返回实际标记统计，让调用方能把「diff 里有、但当前视图没渲染」的差额如实披露出来。
   */
  applyDiffMarkers(index: DiffIndex): DiffMarkStats;
  clearDiffMarkers(): void;
  pauseAnimations(): void;
  resumeAnimations(): void;
  /** 缩放画布：factor > 1 放大，factor < 1 缩小。带动画过渡。 */
  zoomBy(factor: number): void;
  /** 适应窗口：所有元素 fit 到视口，带内边距。 */
  fitToView(): void;
  /** 重置视图：fit + center，无动画（即时）。 */
  resetView(): void;
}