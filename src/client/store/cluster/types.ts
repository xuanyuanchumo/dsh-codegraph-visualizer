import type { GraphNode, GraphEdge, NodeId } from '../../../types/index.ts';

export type ClusterLevel = 'directory' | 'file' | 'function' | 'smart';

export interface ClusterNode extends GraphNode {
  isCluster: true;
  childCount: number;
  childIds: string[];
  clusterPath: string;
  clusterLevel?: ClusterLevel;
}

export interface ClusterEdge extends GraphEdge {
  isCluster: true;
  aggregatedCount: number;
}

export interface ClusterResult {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
}

export interface EdgeAggregation {
  source: string;
  target: string;
  count: number;
  types: Set<string>;
}

export function aggregateEdges(
  rawEdges: GraphEdge[],
  nodeIdToVisibleId: Map<string, string>,
  clusterPrefix: string,
): (GraphEdge | ClusterEdge)[] {
  const aggregation = new Map<string, EdgeAggregation>();
  for (const e of rawEdges) {
    const sourceVisibleId = nodeIdToVisibleId.get(e.source);
    const targetVisibleId = nodeIdToVisibleId.get(e.target);
    if (!sourceVisibleId || !targetVisibleId) continue;
    if (sourceVisibleId === targetVisibleId) continue;

    const key = `${sourceVisibleId}→${targetVisibleId}`;
    const existing = aggregation.get(key);
    if (existing) {
      existing.count++;
      existing.types.add(e.type);
    } else {
      aggregation.set(key, {
        source: sourceVisibleId,
        target: targetVisibleId,
        count: 1,
        types: new Set([e.type]),
      });
    }
  }

  const clusterPrefixes = [clusterPrefix, 'filecluster__', 'smartcluster__'];

  const visibleEdges: (GraphEdge | ClusterEdge)[] = [];
  for (const [, agg] of aggregation) {
    const sourceIsCluster = clusterPrefixes.some((p) => agg.source.startsWith(p));
    const targetIsCluster = clusterPrefixes.some((p) => agg.target.startsWith(p));

    if (!sourceIsCluster && !targetIsCluster) {
      for (const e of rawEdges) {
        if (nodeIdToVisibleId.get(e.source) === agg.source &&
            nodeIdToVisibleId.get(e.target) === agg.target) {
          visibleEdges.push(e);
        }
      }
    } else {
      visibleEdges.push({
        id: `clusteredge__${agg.source}__${agg.target}` as GraphEdge['id'],
        source: agg.source as NodeId,
        target: agg.target as NodeId,
        type: (agg.types.size === 1 ? [...agg.types][0]! : 'dependency') as GraphEdge['type'],
        properties: {},
        isCluster: true,
        aggregatedCount: agg.count,
      });
    }
  }

  return visibleEdges;
}