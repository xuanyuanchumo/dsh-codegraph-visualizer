import cytoscape, { type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export interface LayoutWorkerRequest {
  nodes: { id: string; label: string; type: string }[];
  edges: { id: string; source: string; target: string; type: string }[];
  layout: string;
  containerWidth?: number;
  containerHeight?: number;
}

export interface LayoutWorkerResponse {
  positions: Record<string, { x: number; y: number }>;
  error?: string;
}

function computeSmartSpacing(nodeCount: number, w: number, h: number) {
  const containerArea = w * h;
  const containerMinDim = Math.min(w, h);
  const areaPerNode = containerArea / Math.max(nodeCount, 1);
  const idealSpacing = Math.sqrt(areaPerNode);
  let densityFactor: number;
  if (nodeCount < 50) densityFactor = 1.5;
  else if (nodeCount < 200) densityFactor = 1.0;
  else if (nodeCount < 500) densityFactor = 0.7;
  else densityFactor = 0.5;
  const s = Math.max(40, idealSpacing * densityFactor);
  return {
    nodeRepulse: s * s * 10,
    idealEdgeLength: s * 2,
    rankSep: Math.min(Math.max(30, s * 0.3), 80),
    edgeSep: Math.min(Math.max(15, s * 0.15), 40),
    nodeSep: Math.min(Math.max(20, s * 0.2), 40),
    padding: Math.max(40, Math.min(120, containerMinDim * 0.05)),
    minNodeSpacing: Math.max(20, s * 0.3),
    spacingFactor: nodeCount < 100 ? 1.2 : nodeCount < 300 ? 1.0 : 0.8,
  };
}

self.onmessage = (e: MessageEvent<LayoutWorkerRequest>) => {
  const { nodes, edges, layout, containerWidth = 800, containerHeight = 600 } = e.data;
  try {
    const cy = cytoscape({
      headless: true,
      elements: [
        ...nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id, label: n.label, type: n.type } })),
        ...edges.map((e2) => ({ group: 'edges' as const, data: { id: e2.id, source: e2.source, target: e2.target, type: e2.type } })),
      ],
    });

    const sp = computeSmartSpacing(nodes.length, containerWidth, containerHeight);
    let options: LayoutOptions;
    switch (layout) {
      case 'cose':
        options = { name: 'cose', animate: false, nodeRepulse: () => sp.nodeRepulse, idealEdgeLength: () => sp.idealEdgeLength, edgeElasticity: 0.05, gravity: 0.02, numIter: 15000, randomize: true, tile: true, padding: sp.padding, avoidOverlap: true } as LayoutOptions;
        break;
      case 'dagre':
        options = { name: 'dagre', animate: false, rankDir: 'TB', rankSep: sp.rankSep, edgeSep: sp.edgeSep, nodeSep: sp.nodeSep, ranker: 'tight-tree', padding: sp.padding } as LayoutOptions;
        break;
      case 'circle':
        options = { name: 'circle', animate: false, padding: sp.padding } as LayoutOptions;
        break;
      case 'grid':
        options = { name: 'grid', animate: false, padding: sp.padding, avoidOverlap: true, rows: Math.ceil(Math.sqrt(nodes.length)), cols: Math.ceil(Math.sqrt(nodes.length)) } as LayoutOptions;
        break;
      case 'radial':
        options = { name: 'concentric', animate: false, padding: sp.padding, minNodeSpacing: sp.minNodeSpacing, concentric: (n: { degree: () => number }) => n.degree(), levelWidth: () => 2 } as LayoutOptions;
        break;
      case 'tree': {
        const rootNodes = cy.nodes().roots();
        let roots;
        if (rootNodes.nonempty()) {
          roots = rootNodes;
        } else {
          roots = cy.nodes().sort((a, b) => b.degree() - a.degree()).slice(0, 1);
        }
        options = { name: 'breadthfirst', animate: false, padding: sp.padding, directed: true, spacingFactor: sp.spacingFactor, roots } as LayoutOptions;
        break;
      }
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
