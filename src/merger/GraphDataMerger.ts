// GraphDataMerger - Multi-source data aggregation with dedup
import type { GraphNode, GraphEdge, GraphData, AdapterResult, NodeId } from '../types';
import { NodeId, EdgeId } from '../types';

export class GraphDataMerger {
  merge(results: AdapterResult[], repoId: string): GraphData {
    const allNodes = results.flatMap(r => r.nodes);
    const allEdges = results.flatMap(r => r.edges);

    // Deduplicate nodes by id (prefer later sources for richer data)
    const nodeMap = new Map<string, GraphNode>();
    for (const node of allNodes) {
      nodeMap.set(node.id, node);
    }

    // Deduplicate edges by id
    const edgeMap = new Map<string, GraphEdge>();
    for (const edge of allEdges) {
      edgeMap.set(edge.id, edge);
    }

    const nodes = Array.from(nodeMap.values());
    const edges = Array.from(edgeMap.values());

    return {
      nodes,
      edges,
      metadata: {
        repoId: repoId as any,
        timestamp: Date.now(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  }

  // Delta merge for incremental updates
  applyDelta(current: GraphData, delta: AdapterResult): GraphData {
    const nodeMap = new Map(current.nodes.map(n => [n.id, n]));
    const edgeMap = new Map(current.edges.map(e => [e.id, e]));

    for (const node of delta.nodes) {
      nodeMap.set(node.id, node);
    }
    for (const edge of delta.edges) {
      edgeMap.set(edge.id, edge);
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
      metadata: {
        ...current.metadata,
        timestamp: Date.now(),
        nodeCount: nodeMap.size,
        edgeCount: edgeMap.size,
      },
    };
  }
}