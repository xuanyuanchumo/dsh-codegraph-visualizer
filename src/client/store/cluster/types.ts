import { NodeId, EdgeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';

export type ClusterLevel = 'directory' | 'file' | 'function' | 'smart';

export interface ClusterNode extends GraphNode {
  isCluster: true;
  childCount: number;
  childIds: NodeId[];
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

export function getDependencyGroup(node: GraphNode): string | null {
  const depType = node.properties?.depType;
  if (typeof depType === 'string') {
    return `dep:${depType}`;
  }
  return null;
}

const EDGE_AGGREGATION_THRESHOLD = 20;

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

  const clusterPrefixes = [clusterPrefix, 'filecluster__', 'smartcluster__', 'funccluster__', 'subgroup__'];

  const nonClusterAggKeys = new Set<string>();
  for (const [, agg] of aggregation) {
    const sourceIsCluster = clusterPrefixes.some((p) => agg.source.startsWith(p));
    const targetIsCluster = clusterPrefixes.some((p) => agg.target.startsWith(p));
    if (!sourceIsCluster && !targetIsCluster) {
      nonClusterAggKeys.add(`${agg.source}→${agg.target}`);
    }
  }

  const nonClusterEdges = new Map<string, GraphEdge[]>();
  if (nonClusterAggKeys.size > 0) {
    for (const e of rawEdges) {
      const sv = nodeIdToVisibleId.get(e.source);
      const tv = nodeIdToVisibleId.get(e.target);
      if (sv && tv) {
        const key = `${sv}→${tv}`;
        if (nonClusterAggKeys.has(key)) {
          const list = nonClusterEdges.get(key);
          if (list) list.push(e);
          else nonClusterEdges.set(key, [e]);
        }
      }
    }
  }

  const visibleEdges: (GraphEdge | ClusterEdge)[] = [];
  for (const [key, agg] of aggregation) {
    const sourceIsCluster = clusterPrefixes.some((p) => agg.source.startsWith(p));
    const targetIsCluster = clusterPrefixes.some((p) => agg.target.startsWith(p));

    if (!sourceIsCluster && !targetIsCluster) {
      const edges = nonClusterEdges.get(key);
      if (edges) {
        if (agg.count > EDGE_AGGREGATION_THRESHOLD) {
          visibleEdges.push({
            id: EdgeId(`clusteredge__${agg.source}__${agg.target}`),
            source: NodeId(agg.source),
            target: NodeId(agg.target),
            type: (agg.types.size === 1 ? [...agg.types][0]! : 'dependency') as GraphEdge['type'],
            properties: { aggregatedFromCount: agg.count },
            isCluster: true,
            aggregatedCount: agg.count,
          });
        } else {
          for (const e of edges) visibleEdges.push(e);
        }
      }
    } else {
      visibleEdges.push({
        id: EdgeId(`clusteredge__${agg.source}__${agg.target}`),
        source: NodeId(agg.source),
        target: NodeId(agg.target),
        type: (agg.types.size === 1 ? [...agg.types][0]! : 'dependency') as GraphEdge['type'],
        properties: {},
        isCluster: true,
        aggregatedCount: agg.count,
      });
    }
  }

  return visibleEdges;
}