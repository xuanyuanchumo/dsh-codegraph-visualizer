// GraphDataMerger - multi-source aggregation with dedup + delta merge.
import type { GraphNode, GraphEdge, GraphData, AdapterResult } from '../types/index.ts';
import { RepoId } from '../types/index.ts';

export class GraphDataMerger {
  merge(results: AdapterResult[], repoId: RepoId): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();

    for (const r of results) {
      for (const node of r.nodes) nodes.set(node.id, node);
      for (const edge of r.edges) edges.set(edge.id, edge);
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      metadata: {
        repoId: RepoId(repoId),
        timestamp: Date.now(),
        nodeCount: nodes.size,
        edgeCount: edges.size,
      },
    };
  }

  // Delta merge for incremental heat-updates.
  applyDelta(current: GraphData, delta: AdapterResult): GraphData {
    const nodes = new Map(current.nodes.map(n => [n.id, n]));
    const edges = new Map(current.edges.map(e => [e.id, e]));

    for (const node of delta.nodes) {
      const existing = nodes.get(node.id);
      if (existing) {
        nodes.set(node.id, {
          ...existing,
          ...node,
          properties: { ...existing.properties, ...node.properties },
        });
      } else {
        nodes.set(node.id, node);
      }
    }
    for (const edge of delta.edges) {
      const existing = edges.get(edge.id);
      if (existing) {
        edges.set(edge.id, {
          ...existing,
          ...edge,
          properties: { ...existing.properties, ...edge.properties },
        });
      } else {
        edges.set(edge.id, edge);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      metadata: {
        ...current.metadata,
        timestamp: Date.now(),
        nodeCount: nodes.size,
        edgeCount: edges.size,
      },
    };
  }
}