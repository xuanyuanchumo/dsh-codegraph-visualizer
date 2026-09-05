import cytoscape, { type Core } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { IRenderer, LayoutType, ThemeType } from './IRenderer.ts';
import { LayoutController } from './LayoutController.ts';
import { HighlightController } from './HighlightController.ts';
import { ViewportController } from './ViewportController.ts';
import { DataController } from './DataController.ts';
import { StyleController } from './StyleController.ts';
import { InteractionController, type InteractionCallbacks } from './InteractionController.ts';
import { PathFinder, type PathResult } from './PathFinder.ts';

cytoscape.use(dagre);

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

  constructor(options: CytoscapeRendererOptions) {
    this.options = options;
  }

  init(): void {
    if (this.cy) return;

    this.cy = cytoscape({
      container: this.options.container,
      minZoom: 0.1,
      maxZoom: 3,
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
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.dataCtrl?.updateData(nodes, edges);
  }

  applyLayout(layout: LayoutType): void {
    this.layoutCtrl?.applyLayout(layout);
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

  highlightCycles(cycleIds: Set<string>): void {
    this.highlightCtrl?.highlightCycles(cycleIds);
  }

  highlightImpact(nodeId: NodeId | null): void {
    this.highlightCtrl?.highlightImpact(nodeId);
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

  exportJSON(): string {
    return this.dataCtrl?.exportJSON() ?? '';
  }

  exportPNG(): string | null {
    return this.dataCtrl?.exportPNG() ?? null;
  }

  exportSVG(): string | null {
    return this.dataCtrl?.exportSVG() ?? null;
  }

  getSelectedNodeData(): GraphNode | null {
    return this.dataCtrl?.getSelectedNodeData() ?? null;
  }

  getNodeData(nodeId: string): GraphNode | null {
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
    this.layoutCtrl?.destroy();
    this.dataCtrl?.destroy();
    this.cy?.destroy();
    this.cy = null;
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
