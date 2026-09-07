import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

export function computeFileClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedFiles: Set<string>,
): ClusterResult {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  for (const n of rawNodes) {
    if (n.type === 'module') {
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    } else if (!n.parentId) {
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    } else {
      const parentFileId = n.parentId;
      const fileClusterId = `filecluster__${parentFileId.replace(/[/:\\]/g, '__')}`;
      if (expandedFiles.has(fileClusterId) || expandedFiles.has(parentFileId)) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, fileClusterId);
      }
    }
  }

  const fileClusterChildren = new Map<string, { children: GraphNode[]; parentFileId: string }>();
  for (const n of rawNodes) {
    if (n.type !== 'module') {
      const clusterId = nodeIdToVisibleId.get(n.id);
      if (clusterId && clusterId.startsWith('filecluster__')) {
        const parentFileId = n.parentId ?? '';
        const entry = fileClusterChildren.get(clusterId);
        if (entry) entry.children.push(n);
        else fileClusterChildren.set(clusterId, { children: [n], parentFileId });
      }
    }
  }

  for (const [clusterId, { children, parentFileId }] of fileClusterChildren) {
    const parentNode = rawNodes.find((n) => n.id === parentFileId);
    const clusterNode: ClusterNode = {
      id: NodeId(clusterId),
      label: `${parentNode?.label ?? 'unknown'} (${children.length})`,
      type: 'module',
      filePath: parentNode?.filePath ?? '',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: children.length,
      childIds: children.map((c) => c.id),
      clusterPath: parentFileId,
      clusterLevel: 'file',
    };
    visibleNodes.push(clusterNode);
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'filecluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}