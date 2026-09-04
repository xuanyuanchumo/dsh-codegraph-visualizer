import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { computeSmartClusters } from './smartCluster.ts';

export class SmartClusterStrategy implements ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    expandedNodeIds: Set<string>,
  ): ClusterResult {
    return computeSmartClusters(rawNodes, rawEdges, expandedNodeIds);
  }
}