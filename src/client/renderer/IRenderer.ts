import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import type { PathResult } from './PathFinder.ts';
import type { LayoutType, ThemeType } from '../../shared/viewModeUtils.ts';
export type { LayoutType, ThemeType } from '../../shared/viewModeUtils.ts';

export interface RendererCallbacks {
  onNodeTap?(nodeId: string): void;
  onEdgeTap?(edgeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeDoubleTap?(nodeId: string): void;
  onNodeHover?(nodeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeHoverOut?(): void;
  onEdgeHover?(edgeId: string, renderedPosition: { x: number; y: number }): void;
  onEdgeHoverOut?(): void;
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
  filterByType(type: string): void;
  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void;

  search(query: string): number;
  focusOnNode(nodeId: string): void;
  highlightCallChain(nodeId: NodeId | null): void;
  detectCycles(): Set<string>;
  highlightCycles(cycleIds: Set<string>): void;
  highlightImpact(nodeId: NodeId | null): void;
  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null;
  highlightInheritance(nodeId: NodeId | null): void;
  focusNeighborhood(nodeId: NodeId | null): void;
  getThumbnail(): string | null;
  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  focusOnArea(x: number, y: number, zoom: number): void;
  exportJSON(): string;
  exportPNG(): string | null;
  exportSVG(theme?: ThemeType): string | null;
  getSelectedNodeData(): GraphNode | ClusterNode | null;
  getNodeData(nodeId: string): GraphNode | ClusterNode | null;
  getEdgeData(edgeId: string): GraphEdge | null;
  resize(): void;
  updateTheme(theme: ThemeType): void;
  destroy(): void;

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null;
  highlightPath(path: NodeId[] | null): void;
  expandNeighborhood(nodeId: NodeId, depth: number): Set<string>;
}