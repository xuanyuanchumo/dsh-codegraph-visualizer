import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { computeFunctionLevel } from './functionCluster.ts';

export class FunctionClusterStrategy implements ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    _expandedNodeIds: Set<string>,
  ): ClusterResult {
    return computeFunctionLevel(rawNodes, rawEdges);
  }
}