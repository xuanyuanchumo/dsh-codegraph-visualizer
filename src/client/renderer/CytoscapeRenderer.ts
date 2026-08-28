// Cytoscape.js renderer wrapper
import cytoscape, { Core, LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

// Register extensions
cytoscape.use(dagre);

export interface CytoscapeRendererOptions {
  container: HTMLElement;
  theme: 'light' | 'dark';
  onNodeTap?: (nodeId: string) => void;
  onEdgeTap?: (edgeId: string) => void;
}

export class CytoscapeRenderer {
  private cy: Core | null = null;
  private options: CytoscapeRendererOptions;

  constructor(options: CytoscapeRendererOptions) {
    this.options = options;
  }

  // Initialize Cytoscape instance
  init(): void {
    if (this.cy) return;

    this.cy = cytoscape({
      container: this.options.container,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      style: this.getStylesheet(),
      layout: { name: 'cose' },
    });

    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      this.options.onNodeTap?.(node.id());
    });

    this.cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      this.options.onEdgeTap?.(edge.id());
    });
  }

  // Update graph data
  updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.cy) return;

    const elements = {
      nodes: nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          filePath: n.filePath,
          lineNumber: n.lineNumber,
        },
      })),
      edges: edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
        },
      })),
    };

    this.cy.json({ elements });
  }

  // Apply layout
  applyLayout(layout: 'cose' | 'dagre' | 'circle' | 'grid'): void {
    if (!this.cy) return;

    const layouts: Record<string, any> = {
      cose: { name: 'cose', fit: true },
      dagre: { name: 'dagre', fit: true },
      circle: { name: 'circle', fit: true },
      grid: { name: 'grid', fit: true },
    };

    const layoutOptions = layouts[layout];
    if (layoutOptions) {
      this.cy.layout(layoutOptions).run();
    }
  }

  // Highlight nodes
  highlightNodes(nodeIds: NodeId[]): void {
    if (!this.cy) return;
    const idSet = new Set(nodeIds);

    this.cy.elements().forEach((ele) => {
      if (ele.isNode()) {
        ele.toggleClass('highlighted', idSet.has(ele.id() as NodeId));
      } else {
        const edge = ele as any;
        const src = edge.source();
        const tgt = edge.target();
        edge.toggleClass(
          'highlighted',
          idSet.has(src.id() as NodeId) || idSet.has(tgt.id() as NodeId)
        );
      }
    });
  }

  // Select node
  selectNode(nodeId: NodeId | null): void {
    if (!this.cy) return;
    this.cy.elements().forEach((ele) => {
      ele.toggleClass('selected', ele.isNode() && ele.id() === nodeId);
    });
  }

  // Filter by type
  filterByType(type: string): void {
    if (!this.cy) return;
    this.cy.nodes().forEach((node) => {
      node.style('display', type !== 'all' && node.data('type') !== type ? 'none' : 'element');
    });
    this.cy.edges().forEach((edge) => {
      const srcHidden = edge.source().style('display') === 'none';
      const tgtHidden = edge.target().style('display') === 'none';
      edge.style('display', srcHidden || tgtHidden ? 'none' : 'element');
    });
  }

  // Search and highlight
  search(query: string): void {
    if (!this.cy || !query) return;

    const q = query.toLowerCase();
    this.cy.nodes().forEach((node) => {
      const label = node.data('label');
      node.toggleClass('search-match', typeof label === 'string' && label.toLowerCase().includes(q));
    });
  }

  // Export to JSON
  exportJSON(): string {
    if (!this.cy) return '';
    return JSON.stringify(this.cy.json(), null, 2);
  }

  // Export to PNG
  exportPNG(): string | null {
    if (!this.cy) return null;
    const png = this.cy.png({ full: true, scale: 2 });
    return png;
  }

  // Export to SVG
  exportSVG(): string | null {
    if (!this.cy) return null;
    const svg = (this.cy as any).svg({ full: true });
    return svg;
  }

  // Get stylesheet based on theme
  private getStylesheet(): any[] {
    const isDark = this.options.theme === 'dark';
    return [
      {
        selector: 'node',
        style: {
          'background-color': isDark ? '#4a9eff' : '#2563eb',
          'label': 'data(label)',
          'font-size': '12px',
          'color': '#fff',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 'mapData(weight, 1, 10, 20, 60)',
          'height': 'mapData(weight, 1, 10, 20, 60)',
          'shape': 'ellipse',
          'border-width': 2,
          'border-color': '#fff',
        },
      },
      {
        selector: 'node[type="function"]',
        style: { 'shape': 'round-triangle', 'background-color': isDark ? '#10b981' : '#059669' },
      },
      {
        selector: 'node[type="class"]',
        style: { 'shape': 'rectangle', 'background-color': isDark ? '#8b5cf6' : '#7c3aed' },
      },
      {
        selector: 'node[type="variable"]',
        style: { 'shape': 'diamond', 'background-color': isDark ? '#f59e0b' : '#d97706' },
      },
      {
        selector: 'node[type="module"]',
        style: { 'shape': 'round-rectangle', 'background-color': isDark ? '#ec4899' : '#db2777' },
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': isDark ? '#6b7280' : '#9ca3af',
          'target-arrow-color': isDark ? '#6b7280' : '#9ca3af',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge[type="call"]',
        style: { 'line-color': isDark ? '#60a5fa' : '#3b82f6', 'target-arrow-color': isDark ? '#60a5fa' : '#3b82f6' },
      },
      {
        selector: 'edge[type="import"]',
        style: { 'line-color': isDark ? '#34d399' : '#10b981', 'target-arrow-color': isDark ? '#34d399' : '#10b981' },
      },
      {
        selector: 'edge[type="extend"]',
        style: { 'line-color': isDark ? '#f472b6' : '#ec4899', 'target-arrow-color': isDark ? '#f472b6' : '#ec4899' },
      },
      {
        selector: '.highlighted',
        style: {
          'border-width': 4,
          'border-color': '#fbbf24',
          'background-color': '#fbbf24',
        },
      },
      {
        selector: '.selected',
        style: {
          'border-width': 4,
          'border-color': '#ef4444',
        },
      },
      {
        selector: '.search-match',
        style: {
          'border-width': 3,
          'border-color': '#22c55e',
        },
      },
    ];
  }

  // Cleanup
  destroy(): void {
    this.cy?.destroy();
    this.cy = null;
  }
}
