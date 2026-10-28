import type { GraphNode, GraphEdge, GraphDelta } from '../types/index.ts';

/**
 * Structural difference between two graph revisions.
 *
 * The shape is declared in `types/index.ts` (where the Cordis event payloads live) and re-exported
 * here so both the host diff engine and the client store can name it without importing each other.
 */
export type { GraphDelta };

export interface GraphSkeleton {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 写入侧防缩水守卫的阈值与规模下限。
 *
 * **两个调用点（client store 与 host incrementalUpdate）必须传同一个 `MIN_RETAIN_RATIO`**：
 * 一处拦一处放只会把问题推迟到另一条路径上。所以常量放在这里（共享层），而不是每个调用点各写
 * 一个数字字面量。
 */
export const GRAPH_DELTA_SHRINK = Object.freeze({
  /**
   * delta 应用后必须保留的最低比例。0 = 关闭（守卫的默认状态）。
   *
   * 取值 0.5：一次"删掉一半以上"的增量几乎不可能是正常的单文件改动，而落回全量重取总能拿到
   * 正确结果。代价是**不对称**的，故意偏向拒绝：
   *   - 误拒：多一次全量重载 = 一次传输（结果仍然正确，只是慢一拍）；
   *   - 误受：静默丢图 = 用户看到的图不再对应索引，而且**没有任何错误可见**。
   * 所以这里宁可多拒，也不接受一次错误的缩水。
   *
   * 诚实边界：本守卫只防**断崖**（一次掉到阈值以下），不防渐进缩水（每次掉 40% 连掉三次）。
   * 它也不是"覆盖率 100%"的保证，只是把最坏的一种失败从"静默丢图"换成"多一次重载"。
   */
  MIN_RETAIN_RATIO: 0.5,
  /**
   * 比例判定的规模下限：节点/边少于这个数时**不做**缩水判定。
   *
   * 比例在极小图上没有意义 —— 3 个节点删 2 个是 0.33，删掉一个文件的全部符号是再正常不过的
   * 改动。阈值因此只在图上还有一定规模时生效；本仓库已有的同类决策
   * （`INCREMENTAL_CLUSTER.MIN_PREV_NODES`）用的也是"先看规模再谈比例"的形状。
   */
  MIN_GUARDED_NODES: 20,
  MIN_GUARDED_EDGES: 20,
});

/** `canApplyGraphDelta` 的可选守卫项。全部可选，且默认值等于旧行为。 */
export interface GraphDeltaGuardOptions {
  /**
   * delta 应用后必须保留的节点/边比例，取值 (0, 1]；0 或省略 = 关闭守卫（向后兼容）。
   *
   * 比较的是「delta 应用**后**的保留比例」，不是「被删掉的比例」：`next / current`。
   * 判定是**严格小于**：恰好等于阈值视为通过（边界被 `graphDeltaShrinkGuard.test.ts` 钉死）。
   */
  minRetainRatio?: number;
}

/** No structural change at all — callers use this to skip an emit entirely. */
export function isEmptyGraphDelta(delta: GraphDelta): boolean {
  return delta.addedNodes.length === 0 && delta.removedNodes.length === 0 &&
    delta.modifiedNodes.length === 0 && delta.addedEdges.length === 0 &&
    delta.removedEdges.length === 0 && delta.modifiedEdges.length === 0;
}

/** Counts per side, for logging and for the SSE payload's own summary. */
export function graphDeltaSize(delta: GraphDelta): { nodes: number; edges: number } {
  return {
    nodes: delta.addedNodes.length + delta.removedNodes.length + delta.modifiedNodes.length,
    edges: delta.addedEdges.length + delta.removedEdges.length + delta.modifiedEdges.length,
  };
}

/**
 * Apply `delta` to `current`, returning a new skeleton.
 *
 * Removals are processed before upserts: `computeGraphDiff` reports the *before* state for removed
 * entries and the *after* state for added/modified ones, so an id that moved between buckets within
 * one delta would otherwise resurrect a deleted node.
 */
export function applyGraphDelta(current: GraphSkeleton, delta: GraphDelta): GraphSkeleton {
  const removedNodeIds = new Set<string>(delta.removedNodes.map((n) => n.id as string));
  const removedEdgeIds = new Set<string>(delta.removedEdges.map((e) => e.id as string));

  const nodes = new Map<string, GraphNode>();
  for (const n of current.nodes) {
    if (!removedNodeIds.has(n.id as string)) nodes.set(n.id as string, n);
  }
  for (const n of delta.addedNodes) nodes.set(n.id as string, n);
  for (const n of delta.modifiedNodes) nodes.set(n.id as string, n);

  const edges = new Map<string, GraphEdge>();
  for (const e of current.edges) {
    if (!removedEdgeIds.has(e.id as string)) edges.set(e.id as string, e);
  }
  for (const e of delta.addedEdges) edges.set(e.id as string, e);
  for (const e of delta.modifiedEdges) edges.set(e.id as string, e);

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * 保留比例：delta 应用后的规模 / 当前规模。当前规模为 0 时返回 1（没有可缩水的图）。
 */
function retainedRatio(currentSize: number, nextSize: number): number {
  if (currentSize === 0) return 1;
  return nextSize / currentSize;
}

/**
 * Whether `delta` can be applied to `current` without corrupting it.
 *
 * A delta is only meaningful against the exact revision it was computed from. When the client's
 * copy has drifted (a full `graph/data` landed mid-flight, a reconnect skipped events, the store
 * was reset) applying it would silently drop or resurrect entries, so the client uses this to
 * decide between `applyGraphDelta` and a full re-bootstrap.
 *
 * Two things are checked: every removed/modified entry must exist in `current` (otherwise the
 * delta describes a revision we never had), and every edge the delta introduces or touches must
 * have both endpoints present once the node changes are folded in (otherwise we would publish
 * dangling edges).
 *
 * P0-3（写入侧防缩水）：可选的 `options.minRetainRatio` 增加**规模维度**——上面两条都通过、
 * 但 delta 会把图缩到阈值以下时也返回 false，让调用方落回全量重取（`false` 的既有语义就是
 * "别应用，重新取一份"）。判定只比较 delta 应用后的保留比例，理由与边界写在
 * `GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO` 上；默认 0 表示关闭，既有调用方不传选项时行为不变。
 */
export function canApplyGraphDelta(
  current: GraphSkeleton,
  delta: GraphDelta,
  options: GraphDeltaGuardOptions = {},
): boolean {
  const currentNodeIds = new Set<string>(current.nodes.map((n) => n.id as string));
  const currentEdgeIds = new Set<string>(current.edges.map((e) => e.id as string));

  for (const n of delta.removedNodes) if (!currentNodeIds.has(n.id as string)) return false;
  for (const n of delta.modifiedNodes) if (!currentNodeIds.has(n.id as string)) return false;
  for (const e of delta.removedEdges) if (!currentEdgeIds.has(e.id as string)) return false;
  for (const e of delta.modifiedEdges) if (!currentEdgeIds.has(e.id as string)) return false;

  const nextNodeIds = new Set<string>(currentNodeIds);
  for (const n of delta.removedNodes) nextNodeIds.delete(n.id as string);
  for (const n of delta.addedNodes) nextNodeIds.add(n.id as string);
  for (const n of delta.modifiedNodes) nextNodeIds.add(n.id as string);

  for (const e of [...delta.addedEdges, ...delta.modifiedEdges]) {
    if (!nextNodeIds.has(e.source as string) || !nextNodeIds.has(e.target as string)) return false;
  }

  const minRetainRatio = options.minRetainRatio ?? 0;
  if (minRetainRatio > 0) {
    const nextEdgeIds = new Set<string>(currentEdgeIds);
    for (const e of delta.removedEdges) nextEdgeIds.delete(e.id as string);
    for (const e of delta.addedEdges) nextEdgeIds.add(e.id as string);
    for (const e of delta.modifiedEdges) nextEdgeIds.add(e.id as string);

    if (currentNodeIds.size >= GRAPH_DELTA_SHRINK.MIN_GUARDED_NODES
      && retainedRatio(currentNodeIds.size, nextNodeIds.size) < minRetainRatio) return false;
    if (currentEdgeIds.size >= GRAPH_DELTA_SHRINK.MIN_GUARDED_EDGES
      && retainedRatio(currentEdgeIds.size, nextEdgeIds.size) < minRetainRatio) return false;
  }
  return true;
}
