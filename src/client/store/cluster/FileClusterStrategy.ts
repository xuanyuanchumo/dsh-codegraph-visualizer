import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { computeFileClusters } from './fileCluster.ts';

export class FileClusterStrategy implements ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    expandedNodeIds: Set<string>,
  ): ClusterResult {
    return computeFileClusters(rawNodes, rawEdges, expandedNodeIds);
  }
}