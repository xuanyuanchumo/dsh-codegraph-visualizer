import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

function getFuncClusterId(filePath: string): string {
  return `funccluster__${filePath.replace(/[/:\\]/g, '__')}`;
}

function getFileLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

export function computeFunctionLevel(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
): ClusterResult {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  const fileGroups = new Map<string, GraphNode[]>();
  const standaloneNodes: GraphNode[] = [];

  for (const n of rawNodes) {
    if (n.type === 'module' || !n.filePath) {
      standaloneNodes.push(n);
      continue;
    }
    const clusterId = getFuncClusterId(n.filePath);
    if (expandedNodeIds.has(clusterId) || expandedNodeIds.has(n.filePath)) {
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    } else {
      nodeIdToVisibleId.set(n.id, clusterId);
      const list = fileGroups.get(clusterId);
      if (list) list.push(n);
      else fileGroups.set(clusterId, [n]);
    }
  }

  for (const n of standaloneNodes) {
    visibleNodes.push(n);
    nodeIdToVisibleId.set(n.id, n.id);
  }

  for (const [clusterId, children] of fileGroups) {
    const filePath = children[0]?.filePath ?? '';
    const parentNode = rawNodes.find((n) => n.id === filePath || n.filePath === filePath);
    const clusterNode: ClusterNode = {
      id: NodeId(clusterId),
      label: `${parentNode?.label ?? getFileLabel(filePath)} (${children.length})`,
      type: 'module',
      filePath,
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: children.length,
      childIds: children.map((c) => c.id),
      clusterPath: filePath,
      clusterLevel: 'function',
    };
    visibleNodes.push(clusterNode);
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'funccluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}
