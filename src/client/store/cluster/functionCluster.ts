import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';

export function computeFunctionLevel(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
): ClusterResult {
  return { nodes: rawNodes, edges: rawEdges };
}