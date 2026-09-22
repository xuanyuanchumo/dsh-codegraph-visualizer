import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';

export interface AssembledDiagram {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    rootIds: string[];
    maxDepth: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface DiagramLayer {
  level: number;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export interface LayeredDiagram {
  viewMode: ViewMode;
  layers: DiagramLayer[];
  currentLayer: number;
  expandedNodes: Set<string>;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  metadata: {
    rootIds: string[];
    maxDepth: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram;
}

export function computeDepths(
  rootIds: string[],
  edges: Map<string, GraphEdge[]>,
  direction: 'source' | 'target',
): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
  let head = 0;

  while (head < queue.length) {
    const { id, depth } = queue[head++]!;
    if (depths.has(id) && depths.get(id)! <= depth) continue;
    depths.set(id, depth);

    const edgeList = edges.get(id) ?? [];
    for (const edge of edgeList) {
      const nextId = direction === 'source' ? edge.source : edge.target;
      if (!depths.has(nextId) || depths.get(nextId)! > depth + 1) {
        queue.push({ id: nextId, depth: depth + 1 });
      }
    }
  }

  return depths;
}
export function buildAdjacencyMaps(edges: GraphEdge[]): {
  outEdges: Map<string, GraphEdge[]>;
  inEdges: Map<string, GraphEdge[]>;
} {
  const outEdges = new Map<string, GraphEdge[]>();
  const inEdges = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const outList = outEdges.get(e.source) ?? [];
    outList.push(e);
    outEdges.set(e.source, outList);

    const inList = inEdges.get(e.target) ?? [];
    inList.push(e);
    inEdges.set(e.target, inList);
  }
  return { outEdges, inEdges };
}