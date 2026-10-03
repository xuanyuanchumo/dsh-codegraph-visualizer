import type { GraphNode, GraphEdge, NodeId, HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
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
  pauseAnimations(): void;
  resumeAnimations(): void;
}