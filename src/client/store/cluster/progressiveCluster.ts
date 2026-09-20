import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';
import { detectCommunities } from './communityDetection.ts';
import { CLUSTER } from '../../../shared/constants.ts';
import { getTopLevelDir } from '../../../shared/pathUtils.ts';

const MAX_VISIBLE_NODES = CLUSTER.MAX_VISIBLE_NODES;
const SUBGROUP_THRESHOLD = CLUSTER.SUBGROUP_THRESHOLD;
const MAX_NODES_PER_DIR_BEFORE_SUBGROUP = CLUSTER.MAX_NODES_PER_DIR_BEFORE_SUBGROUP;


function getDependencyGroup(node: GraphNode): string | null {
  const depType = node.properties?.depType;
  if (typeof depType === 'string') {
    return `dep:${depType}`;
  }
  return null;
}

function getDirLabel(dirPath: string): string {
  const parts = dirPath.split('/');
  return parts[parts.length - 1] ?? dirPath;
}

export function getFileLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

function buildParentIndex(rawNodes: GraphNode[]): {
  parentToChildren: Map<string, GraphNode[]>;
  filePathToNodes: Map<string, GraphNode[]>;
} {
  const parentToChildren = new Map<string, GraphNode[]>();
  const filePathToNodes = new Map<string, GraphNode[]>();

  for (const n of rawNodes) {
    if (n.parentId) {
      const list = parentToChildren.get(n.parentId);
      if (list) list.push(n);
      else parentToChildren.set(n.parentId, [n]);
    }
    if (n.filePath) {
      const list = filePathToNodes.get(n.filePath);
      if (list) list.push(n);
      else filePathToNodes.set(n.filePath, [n]);
    }
  }

  return { parentToChildren, filePathToNodes };
}

export function createSubgroupClusters(
  dirNodes: GraphNode[],
  dirEdges: GraphEdge[],
  dirPath: string,
  expandedSubgroups: Set<string>,
): { nodes: (GraphNode | ClusterNode)[]; nodeIdToVisibleId: Map<string, string> } {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  const communities = detectCommunities(dirNodes, dirEdges);

  for (const [communityLabel, group] of communities) {
    if (group.nodes.length <= SUBGROUP_THRESHOLD) {
      for (const n of group.nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
      continue;
    }

    const subgroupClusterId = `subgroup__${dirPath.replace(/[/:\\]/g, '__')}__${communityLabel}`;
    if (expandedSubgroups.has(subgroupClusterId)) {
      for (const n of group.nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else {
      const primaryNode = group.nodes[0]!;
      const clusterNode: ClusterNode = {
        id: NodeId(subgroupClusterId),
        label: `${primaryNode.label.split(/[\\/]/).pop()?.split('.')[0] ?? 'group'} +${group.nodes.length - 1}`,
        type: primaryNode.type,
        filePath: primaryNode.filePath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: group.nodes.length,
        childIds: group.nodes.map((n) => n.id),
        clusterPath: `${dirPath}/${communityLabel}`,
        clusterLevel: 'smart',
      };
      visibleNodes.push(clusterNode);
      for (const n of group.nodes) {
        nodeIdToVisibleId.set(n.id, subgroupClusterId);
      }
    }
  }

  return { nodes: visibleNodes, nodeIdToVisibleId };
}

export function parseExpandedNodeIds(expandedNodeIds: Set<string>): {
  expandedDirs: Set<string>;
  expandedFileClusters: Set<string>;
  expandedFuncClusters: Set<string>;
  expandedSubgroups: Set<string>;
} {
  const expandedDirs = new Set<string>();
  const expandedFileClusters = new Set<string>();
  const expandedFuncClusters = new Set<string>();
  const expandedSubgroups = new Set<string>();
  for (const id of expandedNodeIds) {
    if (id.startsWith('cluster__')) {
      expandedDirs.add(id);
    } else if (id.startsWith('filecluster__file__')) {
      expandedFileClusters.add(id);
    } else if (id.startsWith('funccluster__')) {
      expandedFuncClusters.add(id);
    } else if (id.startsWith('subgroup__')) {
      expandedSubgroups.add(id);
    }
  }
  return { expandedDirs, expandedFileClusters, expandedFuncClusters, expandedSubgroups };
}

function buildDirMapping(rawNodes: GraphNode[]): {
  nodeToDir: Map<string, string>;
  dirToNodes: Map<string, GraphNode[]>;
} {
  const nodeToDir = new Map<string, string>();
  const dirToNodes = new Map<string, GraphNode[]>();
  for (const n of rawNodes) {
    const depGroup = getDependencyGroup(n);
    const dir = depGroup ?? (n.filePath ? getTopLevelDir(n.filePath) : n.id);
    nodeToDir.set(n.id, dir);
    const list = dirToNodes.get(dir);
    if (list) list.push(n);
    else dirToNodes.set(dir, [n]);
  }
  return { nodeToDir, dirToNodes };
}

export function applyInitialDepth(
  initialDepth: number,
  dirToNodes: Map<string, GraphNode[]>,
  rawNodes: GraphNode[],
  expandedDirs: Set<string>,
  expandedFileClusters: Set<string>,
): void {
  if (initialDepth >= 1) {
    for (const [dirPath] of dirToNodes) {
      const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
      expandedDirs.add(clusterId);
    }
  }
  if (initialDepth >= 2) {
    for (const [dirPath, nodesInDir] of dirToNodes) {
      const dirClusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
      if (!expandedDirs.has(dirClusterId)) continue;
      const fileGroups = new Map<string, GraphNode[]>();
      for (const n of nodesInDir) {
        const fileKey = n.parentId ?? n.filePath ?? n.id;
        const group = fileGroups.get(fileKey);
        if (group) group.push(n);
        else fileGroups.set(fileKey, [n]);
      }
      for (const [fileKey] of fileGroups) {
        const fileClusterId = `filecluster__file__${fileKey.replace(/[/:\\]/g, '__')}`;
        expandedFileClusters.add(fileClusterId);
      }
    }
  }

}

export function computeProgressiveClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
  initialDepth: number = 0,
): ClusterResult {
  if (rawNodes.length === 0) return { nodes: [], edges: [] };

  const { parentToChildren, filePathToNodes } = buildParentIndex(rawNodes);

  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();
  const displayedIds = new Set<string>();

  const { expandedDirs, expandedFileClusters, expandedFuncClusters: _expandedFuncClusters, expandedSubgroups } =
    parseExpandedNodeIds(expandedNodeIds);

  const { nodeToDir: _nodeToDir, dirToNodes } = buildDirMapping(rawNodes);

  applyInitialDepth(initialDepth, dirToNodes, rawNodes, expandedDirs, expandedFileClusters);


  const dirEdgeCache = new Map<string, GraphEdge[]>();

  for (const [dirPath, nodes] of dirToNodes) {
    const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;

    if (expandedDirs.has(clusterId) || expandedDirs.has(dirPath)) {
      if (nodes.length > MAX_NODES_PER_DIR_BEFORE_SUBGROUP) {
        let dirEdges = dirEdgeCache.get(dirPath);
        if (!dirEdges) {
          const nodeIds = new Set(nodes.map((n) => n.id));
          dirEdges = rawEdges.filter(
            (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
          );
          dirEdgeCache.set(dirPath, dirEdges);
        }
        const { nodes: subgroupNodes, nodeIdToVisibleId: subgroupMap } =
          createSubgroupClusters(nodes, dirEdges, dirPath, expandedSubgroups);
        for (const n of subgroupNodes) visibleNodes.push(n);
        for (const [rawId, visId] of subgroupMap) nodeIdToVisibleId.set(rawId, visId);
      } else {
        const fileGroups = new Map<string, GraphNode[]>();

        for (const n of nodes) {
          if (n.type === 'module') {
            const fileClusterId = `filecluster__file__${(n.parentId ?? n.filePath ?? n.id).replace(/[/:\\]/g, '__')}`;
            if (expandedFileClusters.has(fileClusterId)) {
              const childNodes = parentToChildren.get(n.id) ?? filePathToNodes.get(n.filePath) ?? [];
              if (childNodes.length > 0) {
                visibleNodes.push(n);
                displayedIds.add(n.id);
                nodeIdToVisibleId.set(n.id, n.id);
                for (const child of childNodes) {
                  if (child.id === n.id) continue;
                  if (displayedIds.has(child.id)) continue;
                  visibleNodes.push(child);
                  displayedIds.add(child.id);
                  nodeIdToVisibleId.set(child.id, child.id);
                }
              } else {
                visibleNodes.push(n);
                displayedIds.add(n.id);
                nodeIdToVisibleId.set(n.id, n.id);
              }
            } else {
              const childNodes = parentToChildren.get(n.id) ?? filePathToNodes.get(n.filePath) ?? [];
              const filteredChildren = childNodes.filter((c) => c.id !== n.id);
              if (filteredChildren.length > 0) {
                nodeIdToVisibleId.set(n.id, fileClusterId);
                for (const child of filteredChildren) {
                  nodeIdToVisibleId.set(child.id, fileClusterId);
                }
                const clusterNode: ClusterNode = {
                  id: NodeId(fileClusterId),
                  label: `${n.label} (${filteredChildren.length + 1})`,
                  type: 'module',
                  filePath: n.filePath,
                  lineNumber: 0,
                  properties: {},
                  isCluster: true,
                  childCount: filteredChildren.length + 1,
                  childIds: [n.id, ...filteredChildren.map((c) => c.id)],
                  clusterPath: n.filePath ?? n.id,
                  clusterLevel: 'file',
                };
                visibleNodes.push(clusterNode);
              } else {
                visibleNodes.push(n);
                nodeIdToVisibleId.set(n.id, n.id);
              }
            }
          } else {
            const parentFileId = n.parentId ?? n.filePath;
            if (parentFileId) {
              const fileClusterId = `filecluster__file__${parentFileId.replace(/[/:\\]/g, '__')}`;
              if (expandedFileClusters.has(fileClusterId)) {
                if (!displayedIds.has(n.id)) {
                  visibleNodes.push(n);
                  displayedIds.add(n.id);
                  nodeIdToVisibleId.set(n.id, n.id);
                }
              } else {
                nodeIdToVisibleId.set(n.id, fileClusterId);
                const list = fileGroups.get(fileClusterId);
                if (list) list.push(n);
                else fileGroups.set(fileClusterId, [n]);
              }
            } else {
              visibleNodes.push(n);
              displayedIds.add(n.id);
              nodeIdToVisibleId.set(n.id, n.id);
            }
          }
        }

        for (const [fileClusterId, children] of fileGroups) {
          const parentFileId = children[0]?.parentId ?? children[0]?.filePath ?? '';
          const parentNode = filePathToNodes.get(parentFileId)?.[0];
          const clusterNode: ClusterNode = {
            id: NodeId(fileClusterId),
            label: `${parentNode?.label ?? getFileLabel(parentFileId)} (${children.length})`,
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
      }
    } else {
      const childIds = nodes.map((n) => n.id);
      const clusterNode: ClusterNode = {
        id: NodeId(clusterId),
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

  if (visibleNodes.length > MAX_VISIBLE_NODES) {
    return enforceNodeLimit(visibleNodes, nodeIdToVisibleId, rawEdges);
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}

export function enforceNodeLimit(
  visibleNodes: (GraphNode | ClusterNode)[],
  nodeIdToVisibleId: Map<string, string>,
  rawEdges: GraphEdge[],
): ClusterResult {
  const clusterNodes = visibleNodes.filter(
    (n): n is ClusterNode => 'isCluster' in n && n.isCluster === true,
  );
  const nonClusterNodes = visibleNodes.filter(
    (n): n is GraphNode => !('isCluster' in n && n.isCluster === true),
  );

  const nodesToKeep = new Set<string>();
  const collapsedChildIds = new Set<string>();
  const overLimit = visibleNodes.length - MAX_VISIBLE_NODES;

  const sortedClusters = [...clusterNodes].sort((a, b) => a.childCount - b.childCount);
  let collapsed = 0;
  for (const cluster of sortedClusters) {
    if (collapsed >= overLimit) break;
    for (const childId of cluster.childIds) {
      nodeIdToVisibleId.set(childId, cluster.id);
      collapsedChildIds.add(childId);
    }
    collapsed += cluster.childCount;
  }

  for (const n of nonClusterNodes) {
    if (!collapsedChildIds.has(n.id)) {
      nodesToKeep.add(n.id);
    }
  }
  for (const n of clusterNodes) {
    nodesToKeep.add(n.id);
  }

  const finalNodes = visibleNodes.filter((n) => nodesToKeep.has(n.id));
  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: finalNodes, edges: visibleEdges };
}
