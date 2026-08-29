import cytoscape, { type Core, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

cytoscape.use(dagre);

interface SvgExtension {
  svg(options: { full?: boolean }): string;
}


export interface CytoscapeRendererOptions {
  container: HTMLElement;
  theme: 'light' | 'dark';
  onNodeTap?: (nodeId: string) => void;
  onEdgeTap?: (edgeId: string) => void;
  onNodeDoubleTap?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string, renderedPosition: { x: number; y: number }) => void;
  onNodeHoverOut?: () => void;
}

interface ThemeColors {
  nodeDefault: string;
  nodeFunction: string;
  nodeClass: string;
  nodeVariable: string;
  nodeModule: string;
  nodeInterface: string;
  edgeDefault: string;
  edgeCall: string;
  edgeImport: string;
  edgeExtend: string;
  text: string;
  border: string;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function getThemeColors(theme: 'light' | 'dark'): ThemeColors {
  const isDark = theme === 'dark';
  return {
    nodeDefault: readCssVar('--cg-accent', isDark ? '#6366f1' : '#4f46e5'),
    nodeFunction: readCssVar('--cg-success', isDark ? '#10b981' : '#059669'),
    nodeClass: readCssVar('--cg-accent-hover', isDark ? '#818cf8' : '#6366f1'),
    nodeVariable: readCssVar('--cg-warning', isDark ? '#f59e0b' : '#d97706'),
    nodeModule: isDark ? '#ec4899' : '#db2777',
    nodeInterface: isDark ? '#14b8a6' : '#0d9488',
    edgeDefault: readCssVar('--cg-border', isDark ? '#6b7280' : '#9ca3af'),
    edgeCall: isDark ? '#60a5fa' : '#3b82f6',
    edgeImport: isDark ? '#34d399' : '#10b981',
    edgeExtend: isDark ? '#f472b6' : '#ec4899',
    text: readCssVar('--cg-text', isDark ? '#e4e6f0' : '#1f2937'),
    border: readCssVar('--cg-border', isDark ? '#3a3b5c' : '#e5e7eb'),
  };
}

export class CytoscapeRenderer {
  private cy: Core | null = null;
  private options: CytoscapeRendererOptions;
  private currentNodes: Map<string, GraphNode> = new Map();
  private currentEdges: Map<string, GraphEdge> = new Map();
  private layoutRaf: number | null = null;

  constructor(options: CytoscapeRendererOptions) {
    this.options = options;
  }

  init(): void {
    if (this.cy) return;

    this.cy = cytoscape({
      container: this.options.container,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      style: this.getStylesheet(),
      layout: { name: 'cose' },
      headless: false,
    });

    this.cy.on('tap', 'node', (evt) => {
      this.options.onNodeTap?.(evt.target.id());
    });

    this.cy.on('tap', 'edge', (evt) => {
      this.options.onEdgeTap?.(evt.target.id());
    });

    this.cy.on('dbltap', 'node', (evt) => {
      this.options.onNodeDoubleTap?.(evt.target.id());
    });

    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const pos = node.renderedPosition();
      this.options.onNodeHover?.(node.id(), { x: pos.x, y: pos.y });
    });

    this.cy.on('mouseout', 'node', () => {
      this.options.onNodeHoverOut?.();
    });
  }

  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.cy) return;

    const newNodeIds = new Set<string>(nodes.map((n) => n.id));
    const newEdgeIds = new Set<string>(edges.map((e) => e.id));

    this.cy.batch(() => {
      for (const n of nodes) {
        if (!this.currentNodes.has(n.id)) {
          this.cy!.add({
            group: 'nodes',
            data: {
              id: n.id,
              label: n.label,
              type: n.type,
              filePath: n.filePath,
              lineNumber: n.lineNumber,
            },
          });
        }
        this.currentNodes.set(n.id, n);
      }

      for (const e of edges) {
        if (!this.currentEdges.has(e.id)) {
          this.cy!.add({
            group: 'edges',
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
            },
          });
        }
        this.currentEdges.set(e.id, e);
      }

      const staleNodes = this.cy!.nodes().filter((n) => !newNodeIds.has(n.id()));
      const staleEdges = this.cy!.edges().filter((e) => !newEdgeIds.has(e.id()));
      if (staleNodes.length > 0) this.cy!.remove(staleNodes);
      if (staleEdges.length > 0) this.cy!.remove(staleEdges);
    });
  }

  applyLayout(layout: 'cose' | 'dagre' | 'circle' | 'grid'): void {
    if (!this.cy) return;

    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
    }

    this.layoutRaf = requestAnimationFrame(() => {
      const layouts: Record<string, LayoutOptions> = {
        cose: { name: 'cose', fit: true, animate: true, animationDuration: 300 } as LayoutOptions,
        dagre: { name: 'dagre', fit: true, animate: true } as LayoutOptions,
        circle: { name: 'circle', fit: true } as LayoutOptions,
        grid: { name: 'grid', fit: true } as LayoutOptions,
      };

      const options = layouts[layout];
      if (options) {
        this.cy!.layout(options).run();
      }
      this.layoutRaf = null;
    });
  }

  highlightNodes(nodeIds: NodeId[]): void {
    if (!this.cy) return;
    const idSet = new Set(nodeIds);

    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        node.toggleClass('highlighted', idSet.has(node.id() as NodeId));
      });
      this.cy!.edges().forEach((edge) => {
        const srcId = edge.source().id() as NodeId;
        const tgtId = edge.target().id() as NodeId;
        edge.toggleClass('highlighted', idSet.has(srcId) || idSet.has(tgtId));
      });
    });
  }

  selectNode(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().forEach((ele) => {
        ele.toggleClass('selected', ele.isNode() && ele.id() === nodeId);
      });
    });
  }

  filterByType(type: string): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        node.style('display', type !== 'all' && node.data('type') !== type ? 'none' : 'element');
      });
      this.cy!.edges().forEach((edge) => {
        const srcHidden = edge.source().style('display') === 'none';
        const tgtHidden = edge.target().style('display') === 'none';
        edge.style('display', srcHidden || tgtHidden ? 'none' : 'element');
      });
    });
  }

  search(query: string): void {
    if (!this.cy) return;
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return;
    }
    const q = query.toLowerCase();
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        const label = node.data('label');
        node.toggleClass('search-match', typeof label === 'string' && label.toLowerCase().includes(q));
      });
    });
  }

  highlightCallChain(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('call-chain');
      if (!nodeId) return;

      const visited = new Set<string>();
      const queue = [nodeId];

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);

        const node = this.cy!.getElementById(id);
        if (node.nonempty()) {
          node.addClass('call-chain');
        }

        const outEdges = this.cy!.edges(`[source="${id}"]`);
        outEdges.forEach((edge) => {
          edge.addClass('call-chain');
          const target = edge.target();
          if (!visited.has(target.id())) {
            queue.push(target.id() as NodeId);
          }
        });
      }
    });
  }

  detectCycles(): Set<string> {
    const cycles = new Set<string>();
    if (!this.cy) return cycles;

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (id: string): boolean => {
      visited.add(id);
      recStack.add(id);
      path.push(id);

      const outEdges = this.cy!.edges(`[source="${id}"]`);
      let foundCycle = false;

      outEdges.forEach((edge) => {
        const targetId = edge.target().id();
        if (recStack.has(targetId)) {
          const cycleStart = path.indexOf(targetId);
          if (cycleStart >= 0) {
            const cyclePath = path.slice(cycleStart);
            cyclePath.forEach((n) => cycles.add(n));
            cycles.add(`${cyclePath.join('→')}`);
          }
          foundCycle = true;
        } else if (!visited.has(targetId)) {
          if (dfs(targetId)) foundCycle = true;
        }
      });

      recStack.delete(id);
      path.pop();
      return foundCycle;
    };

    this.cy.nodes().forEach((node) => {
      if (!visited.has(node.id())) {
        dfs(node.id());
      }
    });

    return cycles;
  }

  highlightCycles(cycleIds: Set<string>): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('cycle-highlight');
      cycleIds.forEach((id) => {
        const node = this.cy!.getElementById(id);
        if (node.nonempty()) {
          node.addClass('cycle-highlight');
        }
      });
    });
  }

  exportJSON(): string {
    if (!this.cy) return '';
    return JSON.stringify(this.cy.json(), null, 2);
  }

  exportPNG(): string | null {
    if (!this.cy) return null;
    return this.cy.png({ full: true, scale: 2 });
  }

  exportSVG(): string | null {
    if (!this.cy) return null;
    return (this.cy as unknown as SvgExtension).svg({ full: true });
  }

  getSelectedNodeData(): GraphNode | null {
    if (!this.cy) return null;
    const selected = this.cy.nodes('.selected');
    if (selected.length === 0) return null;
    const id = selected.first().id();
    return this.currentNodes.get(id) ?? null;
  }

  getNodeData(nodeId: string): GraphNode | null {
    return this.currentNodes.get(nodeId) ?? null;
  }

  resize(): void {
    if (!this.cy) return;
    this.cy.resize();
  }

  updateTheme(theme: 'light' | 'dark'): void {
    if (!this.cy) return;
    this.options.theme = theme;
    this.cy.style().fromJson(this.getStylesheet()).update();
  }

  private getStylesheet(): cytoscape.StylesheetJson {
    const c = getThemeColors(this.options.theme);
    return [
      {
        selector: 'node',
        style: {
          'background-color': c.nodeDefault,
          'label': 'data(label)',
          'font-size': '11px',
          'color': c.text,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '80px',
          'width': 'mapData(weight, 1, 10, 24, 56)',
          'height': 'mapData(weight, 1, 10, 24, 56)',
          'shape': 'ellipse',
          'border-width': 2,
          'border-color': c.border,
          'transition-property': 'background-color',
          'transition-duration': 200,
        },
      },
      {
        selector: 'node[type="function"]',
        style: { 'shape': 'round-triangle', 'background-color': c.nodeFunction },
      },
      {
        selector: 'node[type="class"]',
        style: { 'shape': 'rectangle', 'background-color': c.nodeClass },
      },
      {
        selector: 'node[type="variable"]',
        style: { 'shape': 'diamond', 'background-color': c.nodeVariable },
      },
      {
        selector: 'node[type="module"]',
        style: { 'shape': 'round-rectangle', 'background-color': c.nodeModule },
      },
      {
        selector: 'node[type="interface"]',
        style: { 'shape': 'hexagon', 'background-color': c.nodeInterface },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': c.edgeDefault,
          'target-arrow-color': c.edgeDefault,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'opacity': 0.7,
        },
      },
      {
        selector: 'edge[type="call"]',
        style: { 'line-color': c.edgeCall, 'target-arrow-color': c.edgeCall },
      },
      {
        selector: 'edge[type="import"]',
        style: { 'line-color': c.edgeImport, 'target-arrow-color': c.edgeImport },
      },
      {
        selector: 'edge[type="extend"]',
        style: { 'line-color': c.edgeExtend, 'target-arrow-color': c.edgeExtend },
      },
      {
        selector: '.highlighted',
        style: {
          'border-width': 4,
          'border-color': '#fbbf24',
          'z-index': 20,
        },
      },
      {
        selector: '.selected',
        style: {
          'border-width': 4,
          'border-color': '#ef4444',
          'z-index': 30,
        },
      },
      {
        selector: '.search-match',
        style: {
          'border-width': 3,
          'border-color': '#22c55e',
        },
      },
      {
        selector: '.call-chain',
        style: {
          'background-color': '#fbbf24',
          'border-width': 3,
          'border-color': '#f59e0b',
          'opacity': 0.9,
        },
      },
      {
        selector: '.cycle-highlight',
        style: {
          'border-width': 4,
          'border-color': '#ef4444',
          'background-color': '#ef4444',

        },
      },
    ];
  }

  destroy(): void {
    if (this.layoutRaf !== null) {
      cancelAnimationFrame(this.layoutRaf);
      this.layoutRaf = null;
    }
    this.cy?.destroy();
    this.cy = null;
    this.currentNodes.clear();
    this.currentEdges.clear();
  }
}
