import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

function getParentDir(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
}

function getDirLabel(dirPath: string): string {
  const parts = dirPath.split(/[\\/]/);
  return parts[parts.length - 1] ?? dirPath;
}

function buildNodeScopeMap(rawEdges: GraphEdge[]): Map<string, string> {
  const scopeMap = new Map<string, string>();
  for (const e of rawEdges) {
    if (e.type === 'dependency' && e.properties?.scope) {
      scopeMap.set(e.target, String(e.properties.scope));
    }
  }
  return scopeMap;
}

function getDependencyScopeGroup(node: GraphNode, nodeScopeMap: Map<string, string>): string | null {
  const isExternal = node.properties?.isExternal;
  if (isExternal) {
    const scope = nodeScopeMap.get(node.id);
    if (scope) return `depscope:${scope}`;
    return 'depscope:prod';
  }
  return null;
}

export function computeFileClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedFiles: Set<string>,
): ClusterResult {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  const nodeScopeMap = buildNodeScopeMap(rawEdges);

  const moduleDirGroups = new Map<string, GraphNode[]>();
  const nonModuleNodes: GraphNode[] = [];

  for (const n of rawNodes) {
    const scopeGroup = getDependencyScopeGroup(n, nodeScopeMap);
    if (scopeGroup) {
      const list = moduleDirGroups.get(scopeGroup);
      if (list) list.push(n);
      else moduleDirGroups.set(scopeGroup, [n]);
    } else if (n.type === 'module' && n.filePath) {
      const parentDir = getParentDir(n.filePath);
      const list = moduleDirGroups.get(parentDir);
      if (list) list.push(n);
      else moduleDirGroups.set(parentDir, [n]);
    } else if (!n.parentId) {
      nonModuleNodes.push(n);
    } else {
      nonModuleNodes.push(n);
    }
  }

  for (const [dirPath, nodes] of moduleDirGroups) {
    const clusterId = `filecluster__dir__${dirPath.replace(/[/:\\]/g, '__')}`;
    if (expandedFiles.has(clusterId)) {
      for (const n of nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else if (nodes.length === 1) {
      visibleNodes.push(nodes[0]!);
      nodeIdToVisibleId.set(nodes[0]!.id, nodes[0]!.id);
    } else {
      const clusterNode: ClusterNode = {
        id: NodeId(clusterId),
        label: `${getDirLabel(dirPath)} (${nodes.length})`,
        type: 'module',
        filePath: dirPath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: nodes.length,
        childIds: nodes.map((n) => n.id),
        clusterPath: dirPath,
        clusterLevel: 'file',
      };
      visibleNodes.push(clusterNode);
      for (const n of nodes) {
        nodeIdToVisibleId.set(n.id, clusterId);
      }
    }
  }

  const fileClusterChildren = new Map<string, { children: GraphNode[]; parentFileId: string }>();
  for (const n of nonModuleNodes) {
    const parentFileId = n.parentId ?? n.filePath;
    if (parentFileId) {
      const clusterId = `filecluster__file__${parentFileId.replace(/[/:\\]/g, '__')}`;
      if (expandedFiles.has(clusterId) || expandedFiles.has(parentFileId)) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, clusterId);
        const entry = fileClusterChildren.get(clusterId);
        if (entry) entry.children.push(n);
        else fileClusterChildren.set(clusterId, { children: [n], parentFileId });
      }
    } else {
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    }
  }

  for (const [clusterId, { children, parentFileId }] of fileClusterChildren) {
    const parentNode = rawNodes.find((n) => n.id === parentFileId || n.filePath === parentFileId);
    const fallbackLabel = parentFileId.split(/[\\/]/).pop() ?? 'unknown';
    const clusterNode: ClusterNode = {
      id: NodeId(clusterId),
      label: `${parentNode?.label ?? fallbackLabel} (${children.length})`,
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

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'filecluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}
