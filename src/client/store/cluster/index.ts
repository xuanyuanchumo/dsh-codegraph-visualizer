import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { ProgressiveClusterStrategy } from './ProgressiveClusterStrategy.ts';

const strategyRegistry = new Map<string, ClusterStrategy>([
  ['progressive', new ProgressiveClusterStrategy()],
]);

export function computeClusteredGraph(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterLevel: string,
  expandedNodeIds: Set<string>,
  initialDepth: number = 0,
  viewportWidth?: number,
): ClusterResult {
  const strategy = strategyRegistry.get(clusterLevel);
  if (!strategy) throw new Error(`Unknown cluster level: ${clusterLevel}`);
  return strategy.compute(rawNodes, rawEdges, expandedNodeIds, initialDepth, viewportWidth);
}

export function registerClusterStrategy(level: string, strategy: ClusterStrategy): void {
  strategyRegistry.set(level, strategy);
}

export type { ClusterLevel, ClusterNode, ClusterEdge, ClusterResult } from './types.ts';
export type { ClusterStrategy } from './ClusterStrategy.ts';
