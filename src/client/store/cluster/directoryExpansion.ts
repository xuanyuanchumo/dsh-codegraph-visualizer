/**
 * 已展开目录的聚类（cycle-110 Q7 行为等价提取，从 `progressiveCluster.ts` 抽出）。
 *
 * 抽取契约：
 *   · 这是个**就地写入**的过程：`visibleNodes` / `displayedIds` / `nodeIdToVisibleId` 由调用方
 *     持有并按遍历顺序累积，函数本身不排序、不去重、不返回新容器（重构前就是这样）。
 *   · 两条互斥分支由 `MAX_NODES_PER_DIR_BEFORE_SUBGROUP` 决定：
 *     超过阈值走「智能分组」（社区检测，需按目录缓存边集合），否则走「文件簇」。
 *   · `dirEdgeCache` 是**每次 compute 调用**的局部缓存（不是模块级），键是目录路径，
 *     只缓存「两端都在本目录内」的边集合；模块级缓存与本文件无关。
 */
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode } from './types.ts';
import { CLUSTER } from '../../../shared/constants.ts';
import {
  createSubgroupClusters,
  createFileClustersFromGroups,
  processModuleNodeExpanded,
  processModuleNodeCollapsed,
  processNonModuleNode,
} from './clusterNodes.ts';

const MAX_NODES_PER_DIR_BEFORE_SUBGROUP = CLUSTER.MAX_NODES_PER_DIR_BEFORE_SUBGROUP;

export function clusterExpandedDirectory(
  dirPath: string,
  nodes: GraphNode[],
  rawEdges: GraphEdge[],
  parentToChildren: Map<string, GraphNode[]>,
  filePathToNodes: Map<string, GraphNode[]>,
  expandedFileClusters: Set<string>,
  expandedSubgroups: Set<string>,
  dirEdgeCache: Map<string, GraphEdge[]>,
  visibleNodes: (GraphNode | ClusterNode)[],
  displayedIds: Set<string>,
  nodeIdToVisibleId: Map<string, string>,
): void {
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
          processModuleNodeExpanded(n, parentToChildren, filePathToNodes, visibleNodes, displayedIds, nodeIdToVisibleId);
        } else {
          processModuleNodeCollapsed(n, parentToChildren, filePathToNodes, fileClusterId, visibleNodes, nodeIdToVisibleId);
        }
      } else {
        processNonModuleNode(n, expandedFileClusters, visibleNodes, displayedIds, nodeIdToVisibleId, fileGroups);
      }
    }

    createFileClustersFromGroups(fileGroups, filePathToNodes, visibleNodes);
  }
}
