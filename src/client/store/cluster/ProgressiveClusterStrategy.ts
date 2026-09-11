import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { computeProgressiveClusters } from './progressiveCluster.ts';

export class ProgressiveClusterStrategy implements ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    expandedNodeIds: Set<string>,
    initialDepth: number = 0,
  ): ClusterResult {
    return computeProgressiveClusters(rawNodes, rawEdges, expandedNodeIds, initialDepth);
  }
}