import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';
import { getTopLevelDir } from '../../../shared/pathUtils.ts';
import { INCREMENTAL_CLUSTER, CLUSTER, getDynamicMaxVisibleNodes, getAutoClusterDepth } from '../../../shared/constants.ts';
import { computeProgressiveClusters } from './progressiveCluster.ts';

function getDependencyGroup(node: GraphNode): string | null {
  const depType = node.properties?.depType;
  if (typeof depType === 'string') {
    return `dep:${depType}`;
  }
  return null;
}

function getDirClusterId(dirPath: string): string {
  return `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
}

export interface IncrementalClusterContext {
  prevResult: ClusterResult;
  prevNodeIdToVisibleId: Map<string, string>;
  prevRawNodes: GraphNode[];
  prevRawEdges: GraphEdge[];
}

export function computeIncrementalClusters(
  ctx: IncrementalClusterContext,
  newRawNodes: GraphNode[],
  newRawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
  initialDepth: number,
  viewportWidth?: number,
): ClusterResult | null {
  const { prevResult, prevNodeIdToVisibleId, prevRawNodes } = ctx;

  if (prevRawNodes.length < INCREMENTAL_CLUSTER.MIN_PREV_NODES) return null;
  if (prevResult.nodes.length === 0) return null;

  const prevIds = new Set<string>(prevRawNodes.map((n) => n.id));
  const newIds = new Set<string>(newRawNodes.map((n) => n.id));

  const addedNodes: GraphNode[] = [];
  const removedIds: string[] = [];
  for (const n of newRawNodes) {
    if (!prevIds.has(n.id)) addedNodes.push(n);
  }
  for (const id of prevIds) {
    if (!newIds.has(id)) removedIds.push(id);
  }

  const totalChanges = addedNodes.length + removedIds.length;
  const changeRatio = totalChanges / Math.max(prevRawNodes.length, 1);
  if (changeRatio > INCREMENTAL_CLUSTER.MAX_CHANGE_RATIO) return null;

  const nodeIdToVisibleId = new Map(prevNodeIdToVisibleId);

  for (const id of removedIds) nodeIdToVisibleId.delete(id);

  const newDirs = new Set<string>();
  for (const node of addedNodes) {
    const depGroup = getDependencyGroup(node);
    const dir = depGroup ?? (node.filePath ? getTopLevelDir(node.filePath) : node.id);
    const clusterId = getDirClusterId(dir);
    nodeIdToVisibleId.set(node.id, clusterId);
    if (!prevIds.has(dir) && !newDirs.has(dir)) newDirs.add(dir);
  }

  const maxVisibleNodes = viewportWidth != null
    ? getDynamicMaxVisibleNodes(viewportWidth)
    : CLUSTER.MAX_VISIBLE_NODES;

  const effectiveDepth = viewportWidth != null
    ? Math.max(initialDepth, getAutoClusterDepth(newRawNodes.length, maxVisibleNodes))
    : initialDepth;

  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const clusterChildMap = new Map<string, GraphNode[]>();

  for (const n of newRawNodes) {
    const visId = nodeIdToVisibleId.get(n.id);
    if (!visId) continue;
    if (visId === n.id) {
      visibleNodes.push(n);
    } else {
      const list = clusterChildMap.get(visId);
      if (list) list.push(n);
      else clusterChildMap.set(visId, [n]);
    }
  }

  for (const [clusterId, children] of clusterChildMap) {
    const isExpanded = expandedNodeIds.has(clusterId);
    const prevCluster = prevResult.nodes.find((n): n is ClusterNode =>
      'isCluster' in n && n.isCluster === true && n.id === clusterId,
    );

    if (isExpanded) {
      if (children.length > CLUSTER.MAX_NODES_PER_DIR_BEFORE_SUBGROUP) return null;
      for (const child of children) {
        visibleNodes.push(child);
        nodeIdToVisibleId.set(child.id, child.id);
      }
    } else {
      const primaryNode = children[0];
      const clusterNode: ClusterNode = {
        id: NodeId(clusterId),
        label: prevCluster?.label ?? `${primaryNode?.label ?? clusterId} (${children.length})`,
        type: prevCluster?.type ?? 'module',
        filePath: prevCluster?.filePath ?? primaryNode?.filePath ?? '',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: children.length,
        childIds: children.map((c) => c.id),
        clusterPath: prevCluster?.clusterPath ?? clusterId,
        clusterLevel: prevCluster?.clusterLevel ?? 'directory',
      };
      visibleNodes.push(clusterNode);
      for (const child of children) {
        nodeIdToVisibleId.set(child.id, clusterId);
      }
    }
  }

  for (const dir of newDirs) {
    const clusterId = getDirClusterId(dir);
    if (clusterChildMap.has(clusterId)) continue;
    const dirNodes = newRawNodes.filter((n) => {
      const depGroup = getDependencyGroup(n);
      const d = depGroup ?? (n.filePath ? getTopLevelDir(n.filePath) : n.id);
      return d === dir;
    });
    if (dirNodes.length === 0) continue;
    if (effectiveDepth >= 1 && expandedNodeIds.has(clusterId)) {
      for (const n of dirNodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else {
      const primaryNode = dirNodes[0]!;
      const clusterNode: ClusterNode = {
        id: NodeId(clusterId),
        label: `${dir.split('/').pop() ?? dir} (${dirNodes.length})`,
        type: 'module',
        filePath: dir,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: dirNodes.length,
        childIds: dirNodes.map((n) => n.id),
        clusterPath: dir,
        clusterLevel: 'directory',
      };
      visibleNodes.push(clusterNode);
      for (const n of dirNodes) nodeIdToVisibleId.set(n.id, clusterId);
    }
  }

  if (visibleNodes.length > maxVisibleNodes) {
    return null;
  }

  const visibleEdges = aggregateEdges(newRawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}

export function tryIncrementalOrFull(
  ctx: IncrementalClusterContext | null,
  newRawNodes: GraphNode[],
  newRawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
  initialDepth: number,
  viewportWidth?: number,
): ClusterResult {
  if (ctx) {
    const incremental = computeIncrementalClusters(
      ctx, newRawNodes, newRawEdges, expandedNodeIds, initialDepth, viewportWidth,
    );
    if (incremental) return incremental;
  }
  return computeProgressiveClusters(newRawNodes, newRawEdges, expandedNodeIds, initialDepth, viewportWidth);
}