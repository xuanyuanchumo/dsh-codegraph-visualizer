import type { GraphNode, GraphEdge } from '../types/index.ts';

export interface GraphDiff {
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  modifiedNodes: GraphNode[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  modifiedEdges: GraphEdge[];
}

export function computeGraphDiff(
  beforeNodes: GraphNode[],
  beforeEdges: GraphEdge[],
  afterNodes: GraphNode[],
  afterEdges: GraphEdge[],
): GraphDiff {
  const beforeNodeMap = new Map<string, GraphNode>();
  for (const n of beforeNodes) beforeNodeMap.set(n.id, n);
  const afterNodeMap = new Map<string, GraphNode>();
  for (const n of afterNodes) afterNodeMap.set(n.id, n);

  const beforeEdgeMap = new Map<string, GraphEdge>();
  for (const e of beforeEdges) beforeEdgeMap.set(e.id, e);
  const afterEdgeMap = new Map<string, GraphEdge>();
  for (const e of afterEdges) afterEdgeMap.set(e.id, e);

  const addedNodes: GraphNode[] = [];
  const removedNodes: GraphNode[] = [];
  const modifiedNodes: GraphNode[] = [];

  for (const [id, node] of afterNodeMap) {
    if (!beforeNodeMap.has(id)) {
      addedNodes.push(node);
    } else {
      const before = beforeNodeMap.get(id)!;
      if (before.label !== node.label || before.type !== node.type || before.filePath !== node.filePath ||
          before.lineNumber !== node.lineNumber || before.parentId !== node.parentId ||
          JSON.stringify(before.properties) !== JSON.stringify(node.properties)) {
        modifiedNodes.push(node);
      }
    }
  }
  for (const [id, node] of beforeNodeMap) {
    if (!afterNodeMap.has(id)) removedNodes.push(node);
  }

  const addedEdges: GraphEdge[] = [];
  const removedEdges: GraphEdge[] = [];
  const modifiedEdges: GraphEdge[] = [];
  for (const [id, edge] of afterEdgeMap) {
    const before = beforeEdgeMap.get(id);
    if (!before) {
      addedEdges.push(edge);
    } else {
      if (before.type !== edge.type || before.source !== edge.source || before.target !== edge.target) {
        modifiedEdges.push(edge);
      }
    }
  }
  for (const [id, edge] of beforeEdgeMap) {
    if (!afterEdgeMap.has(id)) removedEdges.push(edge);
  }

  return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges, modifiedEdges };
}

export function diffToGraphData(diff: GraphDiff): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const n of diff.addedNodes) {
    nodes.push({ ...n, properties: { ...n.properties, diffStatus: 'added' } });
  }
  for (const n of diff.modifiedNodes) {
    nodes.push({ ...n, properties: { ...n.properties, diffStatus: 'modified' } });
  }
  for (const n of diff.removedNodes) {
    nodes.push({ ...n, properties: { ...n.properties, diffStatus: 'removed' } });
  }

  for (const e of diff.addedEdges) {
    edges.push({ ...e, properties: { ...e.properties, diffStatus: 'added' } });
  }
  for (const e of diff.modifiedEdges) {
    edges.push({ ...e, properties: { ...e.properties, diffStatus: 'modified' } });
  }
  for (const e of diff.removedEdges) {
    edges.push({ ...e, properties: { ...e.properties, diffStatus: 'removed' } });
  }

  return { nodes, edges };
}