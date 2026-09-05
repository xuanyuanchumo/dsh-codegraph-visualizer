
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

function getFileClusterId(filePath: string): string {
  return `filecluster__${filePath.replace(/[/:\\]/g, '__')}`;
}

function computeFileClusterNodesForDir(
  dirNodes: GraphNode[],
  dirPath: string,
  expandedFileClusters: Set<string>,
): { nodes: (GraphNode | ClusterNode)[]; nodeIdToVisibleId: Map<string, string> } {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  const fileGroups = new Map<string, GraphNode[]>();

  for (const n of dirNodes) {
    if (n.type === 'module') {
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    } else {
      const parentFileId = n.parentId ?? n.filePath;
      const fileClusterId = getFileClusterId(parentFileId);
      if (expandedFileClusters.has(fileClusterId)) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, fileClusterId);
        const list = fileGroups.get(fileClusterId);
        if (list) list.push(n);
        else fileGroups.set(fileClusterId, [n]);
      }
    }
  }

  for (const [fileClusterId, children] of fileGroups) {
    const parentFileId = children[0]?.parentId ?? children[0]?.filePath ?? '';
    const parentNode = dirNodes.find((n) => n.id === parentFileId || n.filePath === parentFileId);
    const clusterNode: ClusterNode = {
      id: fileClusterId as NodeId,
      label: `${parentNode?.label ?? parentFileId.split(/[\\/]/).pop() ?? 'unknown'} (${children.length})`,
      type: 'module',
      filePath: parentNode?.filePath ?? parentFileId,
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

  return { nodes: visibleNodes, nodeIdToVisibleId };
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

  const expandedFileClusters = new Set<string>();
  for (const id of expandedDirs) {
    if (id.startsWith('filecluster__')) {
      expandedFileClusters.add(id);
    }
  }

  for (const [dirPath, nodes] of dirToNodes) {
    const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
    if (expandedDirs.has(clusterId) || expandedDirs.has(dirPath)) {
      const { nodes: fileNodes, nodeIdToVisibleId: fileMap } =
        computeFileClusterNodesForDir(nodes, dirPath, expandedFileClusters);
      for (const n of fileNodes) {
        visibleNodes.push(n);
      }
      for (const [rawId, visId] of fileMap) {
        nodeIdToVisibleId.set(rawId, visId);
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
        clusterLevel: 'directory',
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
