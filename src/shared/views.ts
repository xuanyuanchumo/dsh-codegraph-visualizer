/**
 * 璇玑图研究方案 §4 的 **Π 视图划分函数**（cycle-138）。
 *
 * ## 它解决什么
 *
 * §4 把图谱定义为 $\\mathcal{G} = (V, E, \\Sigma, \\mathcal{T}, \\Pi)$，其中
 * $\\Pi: V \\cup E \\to 2^{\\mathcal{V}_{\\text{view}}}$ 是**视图划分函数**，
 * 把每个节点/边映射到它所属的视图集合。
 *
 * cycle-137 之前，四个视图（structural / temporal / ownership / domain）只是
 * `graph_slice` 的**经验划分**：同一个视图名在 `domain.ts` 的 `GRAPH_SLICE_VIEWS`
 * 与各处的切片逻辑里各写一份，没有一份正式的「某个节点属于哪些视图」的映射。
 *
 * 本模块把这条映射**正式化**：
 * - `ViewName` 是唯一的视图名集合（单一真源）；
 * - `partitionByView(input)` 是正式的 Π 函数：给定图 + 各视图的输入事实，
 *   返回每个节点/边属于哪些视图；
 * - `graph_slice` 与 `graph_views` 工具**共用**这份定义，不再各写一份。
 *
 * ## 为什么「结构视图」恒属于所有节点
 *
 * 结构视图是**基图**：所有节点与边都属于它。其余三个视图是**叠加**的：
 * 一个节点是否属于时序视图，取决于它的文件是否被 commit 切片触及；
 * 是否属于所有权视图，取决于它是否有 blame 记录；
 * 是否属于领域视图，取决于它是否被分配到社区。
 *
 * 这正是 §4 的「多向自洽连接」：同一节点同时属于多个视图。
 *
 * ## 边级视图的口径
 *
 * §4 的 Π 覆盖 $V \\cup E$。边级口径：
 * - 时序：两端点都在时序切片里；
 * - 所有权：两端点都有 blame 记录；
 * - 领域：两端点在同一社区（跨社区边**不**属于任何单一领域视图——
 *   它是「桥」，属于结构视图但不属于某个领域）。
 *
 * 这是「边属于哪个领域」这个问题的诚实回答：跨社区边不属于任何领域。
 */
import type { GraphData, GraphEdge, GraphNode } from '../types/index.ts';
import { normalizeChurnPath } from './churn.ts';

/** 四个正交视图（§4 的 $\\mathcal{V}_{\\text{view}}$）。 */
export type ViewName = 'structural' | 'temporal' | 'ownership' | 'domain';

/** 视图名的**唯一真源**：`graph_slice` 的 `GRAPH_SLICE_VIEWS` 从它派生。 */
export const VIEW_NAMES: readonly ViewName[] = [
  'structural',
  'temporal',
  'ownership',
  'domain',
] as const;

/** 一个节点/边属于哪些视图。`ReadonlySet` 保证调用方不能改。 */
export type ViewMembership = ReadonlySet<ViewName>;

/** Π 的输入：图 + 各视图的**事实**（缺省即「该视图不提供任何成员」）。 */
export interface ViewPartitionInput {
  /** 基图。 */
  data: Pick<GraphData, 'nodes' | 'edges'>;
  /**
   * 时序事实：被 commit 切片触及的文件（**归一化路径**集合）。
   *
   * 为什么是文件而不是节点：commit 切片是文件级的（`commitSliceGraph` 按
   * `node.filePath` 过滤）。一个文件里的所有节点共享同一个时序归属。
   */
  temporalFiles?: ReadonlySet<string>;
  /**
   * 所有权事实：有 blame 记录的节点 id 集合。
   */
  attributedNodeIds?: ReadonlySet<string>;
  /**
   * 领域事实：节点 id → 社区 id 的映射。
   *
   * 只有**被分配到某个社区**的节点才属于领域视图；未分配的节点不属于。
   */
  domainByNodeId?: ReadonlyMap<string, string>;
}

/** Π 的输出。 */
export interface ViewPartition {
  /** 每个节点属于哪些视图（`nodeViews` 的 key 是节点 id 字符串）。 */
  nodeViews: Map<string, ViewMembership>;
  /** 每个边属于哪些视图（`edgeViews` 的 key 是边 id 字符串）。 */
  edgeViews: Map<string, ViewMembership>;
  /** 每个视图的节点数（用于展示与「各视图是否真的有成员」的校验）。 */
  viewCounts: Record<ViewName, number>;
  /** 各视图的边数。 */
  edgeViewCounts: Record<ViewName, number>;
}

/** 构造一个视图集合（结构视图恒在）。 */
function membership(extra: readonly ViewName[]): ViewMembership {
  return new Set<ViewName>(['structural', ...extra]);
}

/**
 * 正式的 Π 函数。
 *
 * 契约：
 * - **结构视图恒属所有节点与边**（它是基图）；
 * - 时序视图 ⇒ 节点的文件在 `temporalFiles` 里；
 * - 所有权视图 ⇒ 节点 id 在 `attributedNodeIds` 里；
 * - 领域视图 ⇒ 节点在 `domainByNodeId` 里有社区；
 * - 边级口径见模块头注（两端点都在才算）。
 */
export function partitionByView(input: ViewPartitionInput): ViewPartition {
  const { data, temporalFiles, attributedNodeIds, domainByNodeId } = input;

  const nodeViews = new Map<string, ViewMembership>();
  const edgeViews = new Map<string, ViewMembership>();
  const viewCounts: Record<ViewName, number> = { structural: 0, temporal: 0, ownership: 0, domain: 0 };
  const edgeViewCounts: Record<ViewName, number> = { structural: 0, temporal: 0, ownership: 0, domain: 0 };

  for (const node of data.nodes) {
    const id = String(node.id);
    const extra: ViewName[] = [];
    if (temporalFiles && temporalFiles.has(normalizeChurnPath(node.filePath))) extra.push('temporal');
    if (attributedNodeIds && attributedNodeIds.has(id)) extra.push('ownership');
    if (domainByNodeId && domainByNodeId.has(id)) extra.push('domain');
    const views = membership(extra);
    nodeViews.set(id, views);
    for (const v of views) viewCounts[v] += 1;
  }

  for (const edge of data.edges) {
    const id = String(edge.id);
    const src = nodeViews.get(String(edge.source));
    const tgt = nodeViews.get(String(edge.target));
    const extra: ViewName[] = [];
    // 边级口径：两端点都在该视图里，边才算。
    if (src && tgt && src.has('temporal') && tgt.has('temporal')) extra.push('temporal');
    if (src && tgt && src.has('ownership') && tgt.has('ownership')) extra.push('ownership');
    if (src && tgt && src.has('domain') && tgt.has('domain')) {
      // 只有两端点在**同一**社区时，边才属于某个领域视图。
      // 跨社区边是「桥」：属于结构视图，不属于任何单一领域。
      const srcDomain = domainByNodeId?.get(String(edge.source));
      const tgtDomain = domainByNodeId?.get(String(edge.target));
      if (srcDomain !== undefined && srcDomain === tgtDomain) extra.push('domain');
    }
    const views = membership(extra);
    edgeViews.set(id, views);
    for (const v of views) edgeViewCounts[v] += 1;
  }

  return { nodeViews, edgeViews, viewCounts, edgeViewCounts };
}

/**
 * 把 `ViewPartition` 转成「节点 id → 视图名数组」的可序列化形状（工具输出用）。
 *
 * 为什么单独一个函数：`Map`/`Set` 不能直接 `JSON.stringify`，而工具的输出要经
 * `toJsonValue`。集中转换避免每个调用点各写一份。
 */
export function serializeViewPartition(partition: ViewPartition): {
  nodes: Array<{ id: string; views: string[] }>;
  edges: Array<{ id: string; views: string[] }>;
  viewCounts: Record<string, number>;
  edgeViewCounts: Record<string, number>;
} {
  return {
    nodes: [...partition.nodeViews.entries()].map(([id, views]) => ({
      id,
      views: [...views].sort(),
    })),
    edges: [...partition.edgeViews.entries()].map(([id, views]) => ({
      id,
      views: [...views].sort(),
    })),
    viewCounts: { ...partition.viewCounts },
    edgeViewCounts: { ...partition.edgeViewCounts },
  };
}

/** 便于测试与工具使用的「空 Π」：只有结构视图。 */
export function emptyViewPartition(data: Pick<GraphData, 'nodes' | 'edges'>): ViewPartition {
  return partitionByView({ data });
}

/** 类型守卫：`GraphNode` / `GraphEdge` 的 id 转字符串（避免到处 `String()`）。 */
export function nodeIdOf(node: GraphNode): string {
  return String(node.id);
}

export function edgeIdOf(edge: GraphEdge): string {
  return String(edge.id);
}
