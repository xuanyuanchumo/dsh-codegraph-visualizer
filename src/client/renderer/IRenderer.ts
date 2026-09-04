import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid';
export type ThemeType = 'light' | 'dark';

export interface RendererCallbacks {
  onNodeTap?(nodeId: string): void;
  onEdgeTap?(edgeId: string): void;
  onNodeDoubleTap?(nodeId: string): void;
  onNodeHover?(nodeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeHoverOut?(): void;
}

export interface RendererOptions extends RendererCallbacks {
  container: HTMLElement;
  theme: ThemeType;
}

export interface IRenderer {
  init(): void;
  updateData(nodes: GraphNode[], edges: GraphEdge[]): void;
  applyLayout(layout: LayoutType): void;
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
  highlightInheritance(nodeId: NodeId | null): void;
  getThumbnail(): string | null;
  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  exportJSON(): string;
  exportPNG(): string | null;
  exportSVG(): string | null;
  getSelectedNodeData(): GraphNode | null;
  getNodeData(nodeId: string): GraphNode | null;
  resize(): void;
  updateTheme(theme: ThemeType): void;
  destroy(): void;
}