import cytoscape, { type Core, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import { computeSmartSpacing } from '../../shared/layoutUtils.ts';
import { LAYOUT } from '../../shared/constants.ts';

cytoscape.use(dagre);
cytoscape.use(fcose);

export interface LayoutWorkerRequest {
  nodes: { id: string; label: string; type: string }[];
  edges: { id: string; source: string; target: string; type: string }[];
  layout: string;
  rankDir?: string;
  containerWidth?: number;
  containerHeight?: number;
}

export interface LayoutWorkerResponse {
  positions: Record<string, { x: number; y: number }>;
  error?: string;
}

self.onmessage = (e: MessageEvent<LayoutWorkerRequest>) => {
  const { nodes, edges, layout, rankDir = 'TB', containerWidth = 800, containerHeight = 600 } = e.data;
  let cyRef: Core | null = null;
  try {
    const cy = cytoscape({
      headless: true,
      elements: [
        ...nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id, label: n.label, type: n.type } })),
        ...edges.map((e2) => ({ group: 'edges' as const, data: { id: e2.id, source: e2.source, target: e2.target, type: e2.type } })),
      ],
    });
    cyRef = cy;

    const sp = computeSmartSpacing(nodes.length, containerWidth, containerHeight);
    let options: LayoutOptions;
    switch (layout) {
      case 'cose':
        options = { name: 'cose', animate: false, nodeRepulse: () => sp.nodeRepulse, idealEdgeLength: () => sp.idealEdgeLength, edgeElasticity: 0.05, gravity: 0.02, numIter: LAYOUT.COSE_LARGE_NUM_ITER, randomize: true, tile: true, padding: sp.padding, avoidOverlap: true } as LayoutOptions;
        break;
      case 'fcose':
        options = { name: 'fcose', animate: false, nodeRepulse: () => sp.nodeRepulse, idealEdgeLength: () => sp.idealEdgeLength, edgeElasticity: 0.05, gravity: 0.02, numIter: LAYOUT.COSE_LARGE_NUM_ITER, randomize: true, tile: true, padding: sp.padding, avoidOverlap: true, quality: 'default', samplingType: true, nodeSeparation: sp.minNodeSpacing } as LayoutOptions;
        break;
      case 'dagre':
        options = { name: 'dagre', animate: false, rankDir: rankDir as 'TB' | 'LR' | 'BT' | 'RL', rankSep: sp.rankSep, edgeSep: sp.edgeSep, nodeSep: sp.nodeSep, ranker: 'tight-tree', padding: sp.padding } as LayoutOptions;
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

    const response: LayoutWorkerResponse = { positions };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: LayoutWorkerResponse = { positions: {}, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(response);
  } finally {
    cyRef?.destroy();
  }
};
