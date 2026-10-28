/**
 * 局部重组：节点附近发生结构变化后，只在 1-hop 邻域内失效 + 重新物化。
 *
 * 契约（cycle-107 任务 A）：
 * 1) 用 incident edges 的 `${u}->${v}` 键 markStale；
 * 2) 对 1-hop 邻域内满足 rule.start 的节点重新枚举（DFS 只在邻域内、长度 ≤ lMax）；
 * 3) 返回本次调用带来的 **liveCount 净增量**（≥ 0），不改全索引。
 *
 * 为什么不用 query-engine 的 enumerate：并行任务 B 尚未交付，这里自带一个局部 DFS，
 * 避免跨任务阻塞；逻辑与 enumerate 的超集剪枝一致（长度 / 节点约束 / simple 去重），
 * 终判仍为 isLegalPath。
 *
 * 已知边界（刻意保留，属「局部性」的代价）：穿过该节点、但抵达 2-hop 以外的旧路径
 * 会被保守失效而不会在本次重组中重新物化——查询层用 fallback 兜底，重组不做全索引重扫。
 *
 * @module xuanji/index/rebalance
 */

import type { GraphSpace, NodeId } from '../core/graph-space.ts';
import type { PathRule } from '../core/path-rule.ts';
import { effectiveMaxEdges, isLegalPath } from '../core/path-rule.ts';
import { makeEntry } from '../core/path-entry.ts';
import { edgePairKey, reviveEntry } from './path-index.ts';
import type { PathIndex } from './path-index.ts';

/**
 * 长度上界统一由 {@link effectiveMaxEdges} 给出（XJ-10：此前本文件自带一份
 * `Number.isFinite(lMax) ? lMax : nodeCount`，与 incremental / query-engine 三处重复）。
 * 无界 + 非 simple 的非法规则会在此抛 `RuleCompositionError`，不再静默近似。
 */

/**
 * 重组 node 的 1-hop 邻域。
 *
 * @returns 本次调用带来的 liveCount 净增量（≥ 0）；恢复旧条目与新增条目都通过状态体现，
 *          但只有「调用前不可查询、调用后可查询」的净变化才计数
 */
export function rebalance(
  node: NodeId,
  rule: PathRule,
  graph: GraphSpace,
  index: PathIndex,
): number {
  if (!graph.hasNode(node)) return 0;

  // 1-hop 邻域：自身 + 规则的边类型上的出/入邻居（顺序确定：自身、出邻居、入邻居）
  const outNeighbors = graph.outNeighbors(node, rule.edgeTypes);
  const inNeighbors = graph.inNeighbors(node, rule.edgeTypes);
  const neighborhood = new Set<NodeId>([node]);
  for (const next of outNeighbors) neighborhood.add(next);
  for (const prev of inNeighbors) neighborhood.add(prev);

  // 返回值 = 本次调用带来的 liveCount 净增量（≥ 0），必须在 markStale **之前**取样：
  // 「本次自己失效、又自己恢复」的条目调用前后都是可查询的，不能算作新增。
  // 这样重复调用返回 0（幂等），也不会把恢复旧条目谎报成新物化。
  const liveBefore = index.liveCount();

  // 1) 保守失效：只针对规则边类型上的相邻边对
  for (const next of outNeighbors) index.markStale(edgePairKey(node, next));
  for (const prev of inNeighbors) index.markStale(edgePairKey(prev, node));

  // 2) 邻域内局部重枚举
  const maxEdges = effectiveMaxEdges(rule, graph.nodeCount);

  const materialize = (nodes: readonly NodeId[]): void => {
    const entry = makeEntry(rule, nodes, graph.version);
    const existing = index.hashIndex.get(entry.hash);
    if (existing) {
      // 同 hash 已存在：若仅被保守误标 stale 且节点序列仍合法，恢复为 live（不计入返回数）
      if (existing.stale && isLegalPath(rule, existing.nodes, graph)) reviveEntry(index, existing);
      return;
    }
    index.add(entry);
  };

  const walk = (nodes: NodeId[], edges: number): void => {
    if (edges > maxEdges) return;
    if (edges >= rule.lMin && isLegalPath(rule, nodes, graph)) materialize(nodes);
    if (edges >= maxEdges) return;

    const last = nodes[nodes.length - 1]!;
    for (const next of graph.outNeighbors(last, rule.edgeTypes)) {
      // 局部性：路径节点一律不出邻域
      if (!neighborhood.has(next)) continue;
      const attrs = graph.getNodeAttrs(next);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(next, attrs)) continue;
      if (rule.simple === true && nodes.includes(next)) {
        if (rule.closed === true && next === nodes[0] && edges + 1 >= rule.lMin) {
          const closedNodes = [...nodes, next];
          if (isLegalPath(rule, closedNodes, graph)) materialize(closedNodes);
        }
        continue;
      }
      walk([...nodes, next], edges + 1);
    }
  };

  for (const start of neighborhood) {
    const attrs = graph.getNodeAttrs(start);
    if (!attrs) continue;
    if (!rule.start(start, attrs)) continue;
    walk([start], 0);
  }

  return Math.max(0, index.liveCount() - liveBefore);
}
