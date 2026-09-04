import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';

export interface ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    expandedNodeIds: Set<string>,
  ): ClusterResult;
}