import cytoscape, { type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export interface LayoutWorkerRequest {
  nodes: { id: string; label: string; type: string }[];
  edges: { id: string; source: string; target: string; type: string }[];
  layout: string;
}

export interface LayoutWorkerResponse {
  positions: Record<string, { x: number; y: number }>;
  error?: string;
}

self.onmessage = (e: MessageEvent<LayoutWorkerRequest>) => {
  const { nodes, edges, layout } = e.data;
  try {
    const cy = cytoscape({
      headless: true,
      elements: [
        ...nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id, label: n.label, type: n.type } })),
        ...edges.map((e2) => ({ group: 'edges' as const, data: { id: e2.id, source: e2.source, target: e2.target, type: e2.type } })),
      ],
    });

    let options: LayoutOptions;
    switch (layout) {
      case 'cose':
        options = { name: 'cose', animate: false, nodeRepulse: () => 120000, idealEdgeLength: () => 400, randomize: true, padding: 120 } as LayoutOptions;
        break;
      case 'dagre':
        options = { name: 'dagre', animate: false, rankDir: 'TB', rankSep: 300, edgeSep: 120, nodeSep: 250, padding: 100 } as LayoutOptions;
        break;
      case 'circle':
        options = { name: 'circle', animate: false, padding: 80 } as LayoutOptions;
        break;
      case 'grid':
        options = { name: 'grid', animate: false, padding: 80, avoidOverlap: true, rows: Math.ceil(Math.sqrt(nodes.length)), cols: Math.ceil(Math.sqrt(nodes.length)) } as LayoutOptions;
        break;
      case 'radial':
        options = { name: 'concentric', animate: false, padding: 80, minNodeSpacing: 40, concentric: (n: { degree: () => number }) => n.degree(), levelWidth: () => 2 } as LayoutOptions;
        break;
      case 'tree':
        options = { name: 'breadthfirst', animate: false, padding: 80, directed: true, spacingFactor: 1.2 } as LayoutOptions;
        break;
      default:
        options = { name: 'grid', animate: false } as LayoutOptions;
    }

    cy.layout(options).run();

    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((n) => {
      const p = n.position();
      positions[n.id()] = { x: p.x, y: p.y };
    });

    cy.destroy();

    const response: LayoutWorkerResponse = { positions };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: LayoutWorkerResponse = { positions: {}, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(response);
  }
};