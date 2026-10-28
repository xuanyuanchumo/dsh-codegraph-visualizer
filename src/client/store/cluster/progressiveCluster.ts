/**
 * 渐进式聚类（cycle-110 Q7 重组后的**编排层**）。
 *
 * 本文件现在只保留「编排」：入口（`computeProgressiveClusters`）、上限收敛（`enforceNodeLimit`）、
 * 以及三个与展开状态直接相关的纯函数（`parseExpandedNodeIds` / `buildDirMapping` /
 * `applyInitialDepth`）。构造簇节点、智能分组、展开代价缓存分别搬到：
 *   · `clusterNodes.ts`        —— 簇节点构造器（无状态）
 *   · `directoryExpansion.ts`  —— 已展开目录的聚类流程（就地写容器）
 *   · `clusterExpandCost.ts`   —— 模块级展开代价缓存（有状态，`disposeStore` 唯一入口）
 *
 * 行为等价承诺：这次重组只移动代码，没有改任何条件、顺序、字符串或返回值形状。为了让既有
 * import 路径（生产代码与 30+ 个用例）全部继续成立，被搬走的导出名在这里**原样 re-export**。
 * 也就是说「以本文件为入口」的公开面仍是重构前的那个公开面。
 *
 * ⚠️ 注释纪律：**不要在这里写出「from + 本文件路径」的字面量**（哪怕只是举例）。Q5 的环检测器
 * 用相对 import 图做 DFS，而它不剥注释——一句形如 `from './xxx.ts'` 的示例会被当成真 import，
 * 于是本文件被判成「自环」，Q5 直接 FAIL。cycle-110 实盘踩过：把示例改成白话即恢复。
 */
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges, getDependencyGroup } from './types.ts';
import { CLUSTER, getDynamicMaxVisibleNodes, getAutoClusterDepth } from '../../../shared/constants.ts';
import { getTopLevelDir } from '../../../shared/pathUtils.ts';
import { buildParentIndex, createDirectoryCluster } from './clusterNodes.ts';
import { clusterExpandedDirectory } from './directoryExpansion.ts';

const MAX_VISIBLE_NODES = CLUSTER.MAX_VISIBLE_NODES;

// —— 公开面保持：搬走的符号从新家再导出，调用方零改动 ——
export { getFileLabel, createSubgroupClusters } from './clusterNodes.ts';
export { invalidateExpandCostCache, estimateExpandCost } from './clusterExpandCost.ts';

/**
 * 把 `expandedNodeIds` 这个「已展开 id 集合」按前缀分成四类。
 *
 * 契约：四个前缀互斥且**按顺序判定**（`cluster__` 先于 `filecluster__file__`；
 * 两者不会互相命中，但顺序决定新增前缀时的插入点）。未识别的 id 被静默丢弃——
 * 展开状态是从 UI 传回来的字符串集合，来源不止一处，宁可不展开也不要猜错类型。
 */
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

/**
 * 原始节点 → 所属目录（同一份判定与 `clusterExpandCost` 的目录缓存保持一致：
 * 依赖分组优先，其次文件路径的顶层目录，最后退回节点 id）。
 */
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

/**
 * 按初始展开深度预置展开状态。
 *
 * 契约：`initialDepth >= 1` 展开全部目录；`>= 2` 在此基础上再展开二级文件簇，
 * 且**只展开本轮已被目录级展开的目录**（跳过 `continue` 的那条依赖 `expandedDirs` 的写入顺序）。
 */
export function applyInitialDepth(
  initialDepth: number,
  dirToNodes: Map<string, GraphNode[]>,

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
  viewportWidth?: number,
): ClusterResult {
  if (rawNodes.length === 0) return { nodes: [], edges: [] };

  const maxVisibleNodes = viewportWidth !== null && viewportWidth !== undefined
    ? getDynamicMaxVisibleNodes(viewportWidth)
    : MAX_VISIBLE_NODES;

  const effectiveDepth = initialDepth > 0 && viewportWidth !== null && viewportWidth !== undefined
    ? Math.max(initialDepth, getAutoClusterDepth(rawNodes.length, maxVisibleNodes))
    : initialDepth;

  const { parentToChildren, filePathToNodes } = buildParentIndex(rawNodes);

  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();
  const displayedIds = new Set<string>();

  const { expandedDirs, expandedFileClusters, expandedFuncClusters: _expandedFuncClusters, expandedSubgroups } =
    parseExpandedNodeIds(expandedNodeIds);

  const { nodeToDir: _nodeToDir, dirToNodes } = buildDirMapping(rawNodes);

  applyInitialDepth(effectiveDepth, dirToNodes, expandedDirs, expandedFileClusters);

  const dirEdgeCache = new Map<string, GraphEdge[]>();

  for (const [dirPath, nodes] of dirToNodes) {
    const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;

    if (expandedDirs.has(clusterId) || expandedDirs.has(dirPath)) {
      clusterExpandedDirectory(
        dirPath, nodes, rawEdges, parentToChildren, filePathToNodes,
        expandedFileClusters, expandedSubgroups, dirEdgeCache,
        visibleNodes, displayedIds, nodeIdToVisibleId,
      );
    } else {
      const { clusterNode, nodeIdToVisibleId: dirMap } = createDirectoryCluster(dirPath, nodes, clusterId);
      visibleNodes.push(clusterNode);
      for (const [rawId, visId] of dirMap) nodeIdToVisibleId.set(rawId, visId);
    }
  }

  if (visibleNodes.length > maxVisibleNodes) {
    return enforceNodeLimit(visibleNodes, nodeIdToVisibleId, rawEdges, maxVisibleNodes);
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}

export function enforceNodeLimit(
  visibleNodes: (GraphNode | ClusterNode)[],
  nodeIdToVisibleId: Map<string, string>,
  rawEdges: GraphEdge[],
  maxVisibleNodes: number = MAX_VISIBLE_NODES,
): ClusterResult {
  const clusterNodes = visibleNodes.filter(
    (n): n is ClusterNode => 'isCluster' in n && n.isCluster === true,
  );
  const nonClusterNodes = visibleNodes.filter(
    (n): n is GraphNode => !('isCluster' in n && n.isCluster === true),
  );

  const nodesToKeep = new Set<string>();
  const collapsedChildIds = new Set<string>();
  const overLimit = visibleNodes.length - maxVisibleNodes;

  const sortedClusters = [...clusterNodes].sort((a, b) => b.childCount - a.childCount);
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
