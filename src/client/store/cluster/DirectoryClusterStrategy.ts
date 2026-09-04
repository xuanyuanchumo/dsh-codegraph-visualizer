import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { computeDirectoryClusters } from './directoryCluster.ts';

export class DirectoryClusterStrategy implements ClusterStrategy {
  compute(
    rawNodes: GraphNode[],
    rawEdges: GraphEdge[],
    expandedNodeIds: Set<string>,
  ): ClusterResult {
    return computeDirectoryClusters(rawNodes, rawEdges, expandedNodeIds);
  }
}