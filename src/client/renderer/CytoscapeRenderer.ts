import cytoscape, { type Core, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import type { IRenderer, LayoutType, ThemeType } from './IRenderer.ts';

cytoscape.use(dagre);


export interface CytoscapeRendererOptions {
  container: HTMLElement;
  theme: ThemeType;
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

function getThemeColors(theme: ThemeType): ThemeColors {
  const isDark = theme === 'dark';
  return {
    nodeDefault: readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148'),
    nodeFunction: readCssVar('--cg-success', isDark ? '#10b981' : '#059669'),
    nodeClass: readCssVar('--cg-accent-hover', isDark ? '#818cf8' : '#1a2230'),
    nodeVariable: readCssVar('--cg-warning', isDark ? '#f59e0b' : '#d97706'),
    nodeModule: isDark ? '#ec4899' : '#db2777',
    nodeInterface: isDark ? '#14b8a6' : '#0d9488',
    edgeDefault: readCssVar('--cg-border-strong', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
    edgeCall: isDark ? '#60a5fa' : '#3b82f6',
    edgeImport: isDark ? '#34d399' : '#10b981',
    edgeExtend: isDark ? '#f472b6' : '#ec4899',
    text: readCssVar('--cg-text', isDark ? '#f9fafb' : '#0f1115'),
    border: readCssVar('--cg-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
  };
}

export class CytoscapeRenderer implements IRenderer {
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

  applyLayout(layout: LayoutType): void {
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
    const hidden = new Set<string>();
    if (type !== 'all') {
      this.cy.nodes().forEach((node) => {
        if (node.data('type') !== type) hidden.add(node.id());
      });
    }
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        node.style('display', hidden.has(node.id()) ? 'none' : 'element');
      });
      this.cy!.edges().forEach((edge) => {
        const hiddenEdge = hidden.has(edge.source().id()) || hidden.has(edge.target().id());
        edge.style('display', hiddenEdge ? 'none' : 'element');
      });
    });
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    if (!this.cy) return;
    const allowedEdgeTypes = new Set<string>();
    if (graphType === 'all') {
      allowedEdgeTypes.add('call');
      allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('extend');
      allowedEdgeTypes.add('implement');
      allowedEdgeTypes.add('dependency');
    } else if (graphType === 'call') {
      allowedEdgeTypes.add('call');
    } else if (graphType === 'dependency') {
      allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('dependency');
    }

    const connectedNodeIds = new Set<string>();
    this.cy.batch(() => {
      this.cy!.edges().forEach((edge) => {
        const edgeType = edge.data('type') as string;
        const visible = allowedEdgeTypes.has(edgeType);
        edge.style('display', visible ? 'element' : 'none');
        if (visible) {
          connectedNodeIds.add(edge.source().id());
          connectedNodeIds.add(edge.target().id());
        }
      });
      this.cy!.nodes().forEach((node) => {
        node.style('display', connectedNodeIds.has(node.id()) ? 'element' : 'none');
      });
    });
  }

  search(query: string): number {
    if (!this.cy) return 0;
    if (!query) {
      this.cy.nodes().removeClass('search-match');
      return 0;
    }
    const q = query.toLowerCase();
    let matches = 0;
    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        const label = node.data('label');
        const isMatch = typeof label === 'string' && label.toLowerCase().includes(q);
        node.toggleClass('search-match', isMatch);
        if (isMatch) matches++;
      });
    });
    return matches;
  }

  highlightCallChain(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.batch(() => {
      this.cy!.elements().removeClass('call-chain');
      if (!nodeId) return;

      // Traverse via getElementById + connectedEdges (no string selectors, so
      // node ids with quotes/brackets can neither break nor inject a query).
      const visited = new Set<string>();
      const queue = [nodeId];
      let head = 0;

      while (head < queue.length) {
        const id = queue[head++]!;
        if (visited.has(id)) continue;
        visited.add(id);

        const node = this.cy!.getElementById(id);
        if (node.nonempty()) {
          node.addClass('call-chain');
        }

        node.connectedEdges().forEach((edge) => {
          if (edge.source().id() !== id) return;
          edge.addClass('call-chain');
          const target = edge.target().id();
          if (!visited.has(target)) {
            queue.push(target as NodeId);
          }
        });
      }
    });
  }

  detectCycles(): Set<string> {
    const cycles = new Set<string>();
    if (!this.cy) return cycles;

    // Build an adjacency list once: O(V + E), no per-step selector queries.
    const adjacency = new Map<string, string[]>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      const list = adjacency.get(s);
      if (list) list.push(t);
      else adjacency.set(s, [t]);
    });

    // Iterative DFS with explicit frames — no recursion, safe on 10k+ nodes.
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = path.indexOf(target);
          if (cycleStart >= 0) {
            for (let i = cycleStart; i < path.length; i++) cycles.add(path[i]!);
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
          frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

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
    const png = this.cy.png({ full: true, scale: 2 });
    const w = this.cy.width();
    const h = this.cy.height();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${png}" width="${w}" height="${h}"/></svg>`;
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

  updateTheme(theme: ThemeType): void {
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
          'border-color': readCssVar('--cg-warning', '#f59e0b'),
          'z-index': 20,
        },
      },
      {
        selector: '.selected',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'z-index': 30,
        },
      },
      {
        selector: '.search-match',
        style: {
          'border-width': 3,
          'border-color': readCssVar('--cg-success', '#10b981'),
        },
      },
      {
        selector: '.call-chain',
        style: {
          'background-color': readCssVar('--cg-warning', '#f59e0b'),
          'border-width': 3,
          'border-color': readCssVar('--cg-warning', '#f59e0b'),
          'opacity': 0.9,
        },
      },
      {
        selector: '.cycle-highlight',
        style: {
          'border-width': 4,
          'border-color': readCssVar('--cg-error', '#ef4444'),
          'background-color': readCssVar('--cg-error', '#ef4444'),
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
