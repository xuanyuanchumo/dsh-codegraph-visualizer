import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterLevel, ClusterResult } from './types.ts';
import type { ClusterStrategy } from './ClusterStrategy.ts';
import { DirectoryClusterStrategy } from './DirectoryClusterStrategy.ts';
import { FileClusterStrategy } from './FileClusterStrategy.ts';
import { FunctionClusterStrategy } from './FunctionClusterStrategy.ts';
import { SmartClusterStrategy } from './SmartClusterStrategy.ts';

const strategyRegistry = new Map<ClusterLevel, ClusterStrategy>([
  ['directory', new DirectoryClusterStrategy()],
  ['file', new FileClusterStrategy()],
  ['function', new FunctionClusterStrategy()],
  ['smart', new SmartClusterStrategy()],
]);

export function computeClusteredGraph(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterLevel: ClusterLevel,
  expandedNodeIds: Set<string>,
): ClusterResult {
  const strategy = strategyRegistry.get(clusterLevel);
  if (!strategy) throw new Error(`Unknown cluster level: ${clusterLevel}`);
  return strategy.compute(rawNodes, rawEdges, expandedNodeIds);
}

export function registerClusterStrategy(level: ClusterLevel, strategy: ClusterStrategy): void {
  strategyRegistry.set(level, strategy);
}

export type { ClusterLevel, ClusterNode, ClusterEdge, ClusterResult } from './types.ts';
export type { ClusterStrategy } from './ClusterStrategy.ts';
