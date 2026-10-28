/**
 * 簇节点构造器（cycle-110 Q7 行为等价提取，从 `progressiveCluster.ts` 抽出）。
 *
 * 抽取契约（改这个文件前先读，抽取只允许行为等价）：
 *   · 本文件的函数**只产出**节点/映射，不读也不写任何模块级可变状态；调用方给什么就用什么。
 *   · 除 `buildParentIndex` 外，全部函数只做一次线性遍历（O(n) / O(n+e)），不改变调用方传入的数组。
 *   · `nodeIdToVisibleId` 的写入方向恒为「原始节点 id → 可见 id」；簇自身的 id 只出现在
 *     `visibleNodes` 与返回值里，绝不出现在 map 的 value 之外。
 *   · 标签文案（`(n)` / `+n-1`）是 UI 契约的一部分，由 `tests/unit/progressiveCluster.test.ts`
 *     与组件用例钉住，等价重构不得改动字符串形状。
 *
 * 为什么拆出来：band-detector 的复杂度是**按文件**的文本面计数（`branches + functions*2`），
 * 单文件 127 越过预算 100 的上带 115。这些构造器与「编排」是本文件里两块可以按职责切开的东西，
 * 切分只移动代码，不合并条件、不改分支顺序。
 */
import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode } from './types.ts';
import { detectCommunities } from './communityDetection.ts';
import { CLUSTER } from '../../../shared/constants.ts';

const SUBGROUP_THRESHOLD = CLUSTER.SUBGROUP_THRESHOLD;

/** 目录显示名：按 `/` 切最后一段（目录键来自 `getTopLevelDir`，恒为 `/` 分隔）。 */
function getDirLabel(dirPath: string): string {
  const parts = dirPath.split('/');
  return parts[parts.length - 1] ?? dirPath;
}

/** 文件显示名：两种分隔符都要认（上游索引可能给 Windows 路径）。与重构前逐字符一致。 */
export function getFileLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

/**
 * 建两张索引：父节点 → 子节点、文件路径 → 节点。
 *
 * 契约：同一个键下的节点保持 `rawNodes` 的原始顺序（展开后的可见顺序依赖它）。
 */
export function buildParentIndex(rawNodes: GraphNode[]): {
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

/**
 * 目录内节点过多时的「智能分组」层：按社区检测把同目录节点切成若干子簇。
 *
 * 契约：`group.nodes.length <= SUBGROUP_THRESHOLD` 的社区**不簇化**（直接原样露出），
 * 已展开的子簇同样原样露出；只有未展开且超过阈值的社区才折叠成 `subgroup__…` 簇。
 * 模块级缓存不参与（社区检测每次按传入的 `dirNodes`/`dirEdges` 重算，调用方负责缓存边）。
 */
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

/**
 * 未展开目录的簇节点。
 *
 * 契约：`clusterPath` 取目录原值（不是簇 id）；`clusterLevel` 恒为 `'directory'`；
 * 返回的映射把目录下**所有**原始节点指向该簇 id。
 */
export function createDirectoryCluster(
  dirPath: string,
  nodes: GraphNode[],
  clusterId: string,
): { clusterNode: ClusterNode; nodeIdToVisibleId: Map<string, string> } {
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
  const nodeIdToVisibleId = new Map<string, string>();
  for (const n of nodes) {
    nodeIdToVisibleId.set(n.id, clusterId);
  }
  return { clusterNode, nodeIdToVisibleId };
}

/**
 * `module` 节点且文件簇**已展开**：模块自身可见，其子节点一并露出（去重靠 `displayedIds`）。
 *
 * 契约：子节点来源优先 `parentToChildren.get(id)`，其次 `filePathToNodes.get(filePath)`；
 * 不含子节点时退化为「只露出自己」，与展开前渲染一致。
 */
export function processModuleNodeExpanded(
  n: GraphNode,
  parentToChildren: Map<string, GraphNode[]>,
  filePathToNodes: Map<string, GraphNode[]>,
  visibleNodes: (GraphNode | ClusterNode)[],
  displayedIds: Set<string>,
  nodeIdToVisibleId: Map<string, string>,
): void {
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
}

/**
 * `module` 节点且文件簇**未展开**：折叠成 `filecluster__file__…` 簇。
 *
 * 契约：`childCount` 是「自己 + 过滤掉自指后的子节点数」，标签里的数字用的是同一个值；
 * 没有子节点时不造簇，直接露出自己（否则会出现只有一个成员的假簇）。
 */
export function processModuleNodeCollapsed(
  n: GraphNode,
  parentToChildren: Map<string, GraphNode[]>,
  filePathToNodes: Map<string, GraphNode[]>,
  fileClusterId: string,
  visibleNodes: (GraphNode | ClusterNode)[],
  nodeIdToVisibleId: Map<string, string>,
): void {
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

/**
 * 非 `module` 节点：文件簇展开就露出，否则攒进 `fileGroups` 由
 * {@link createFileClustersFromGroups} 统一造簇；没有文件归属的直接露出。
 *
 * 契约：`displayedIds` 只在「已露出」时写入；簇化路径**不**写 `displayedIds`
 * （簇成员不可单独再被露出），这是与重构前一致的关键差别。
 */
export function processNonModuleNode(
  n: GraphNode,
  expandedFileClusters: Set<string>,
  visibleNodes: (GraphNode | ClusterNode)[],
  displayedIds: Set<string>,
  nodeIdToVisibleId: Map<string, string>,
  fileGroups: Map<string, GraphNode[]>,
): void {
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

/**
 * 把攒下来的文件分组折成文件簇（顺序 = `fileGroups` 的插入顺序）。
 *
 * 契约：标签优先用父节点 label，没有父节点时退回文件名；`clusterPath` 是父文件 id
 * （可能为空字符串——调用方只用于显示，不参与寻址）。
 */
export function createFileClustersFromGroups(
  fileGroups: Map<string, GraphNode[]>,
  filePathToNodes: Map<string, GraphNode[]>,
  visibleNodes: (GraphNode | ClusterNode)[],
): void {
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
