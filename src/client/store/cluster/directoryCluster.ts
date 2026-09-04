import { EdgeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge, NodeId } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

function getTopLevelDir(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 2) return filePath;
  if (parts[0] === 'crates' && parts.length >= 2) {
    return `crates/${parts[1]}`;
  }
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app') {
    return parts.slice(0, 2).join('/');
  }
  return parts.slice(0, 2).join('/');
}

function getDirLabel(dirPath: string): string {
  const parts = dirPath.split('/');
  return parts[parts.length - 1] ?? dirPath;
}

export function computeDirectoryClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedDirs: Set<string>,
): ClusterResult {
  const nodeToDir = new Map<string, string>();
  const dirToNodes = new Map<string, GraphNode[]>();

  for (const n of rawNodes) {
    const dir = getTopLevelDir(n.filePath);
    nodeToDir.set(n.id, dir);
    const list = dirToNodes.get(dir);
    if (list) list.push(n);
    else dirToNodes.set(dir, [n]);
  }

  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  for (const [dirPath, nodes] of dirToNodes) {
    const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
    if (expandedDirs.has(clusterId) || expandedDirs.has(dirPath)) {
      for (const n of nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else {
      const childIds = nodes.map((n) => n.id);
      const clusterNode: ClusterNode = {
        id: clusterId as NodeId,
        label: `${getDirLabel(dirPath)} (${nodes.length})`,
        type: 'module',
        filePath: dirPath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: nodes.length,
        childIds,
        clusterPath: dirPath,
      };
      visibleNodes.push(clusterNode);
      for (const n of nodes) {
        nodeIdToVisibleId.set(n.id, clusterId);
      }
    }
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}