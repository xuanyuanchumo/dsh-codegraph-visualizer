/**
 * 查询引擎：枚举（物化）、读取（带失效回退）、存在性（walk / cycle）。
 *
 * 璇玑图原型：同一方锦缎有多种读法。枚举器按规则把「字路」物化进路径索引，
 * 读取器负责回答「从这个字起读，有哪些合法读法」，并保证**永不返回失效条目**——
 * 宁可回退到现场重算，也不把被删边之后的旧读法交给调用方。
 *
 * 完备性与精确性分工（C1）：
 * - 剪枝（rule.start / nodeConstraint / simple / 长度）允许是**超集**；
 * - 是否物化一律由 {@link isLegalPath} 精确终判；
 * - 因此逐节点谓词放宽不会产生错误条目，只会多走几步。
 *
 * 零宿主依赖。
 *
 * @module xuanji/query/query-engine
 */

import type { GraphSpace, NodeId } from '../core/graph-space.ts';
import type { PathRule } from '../core/path-rule.ts';
import { isLegalPath } from '../core/path-rule.ts';
import type { PathEntry } from '../core/path-entry.ts';
import { isLiveEntry, makeEntry } from '../core/path-entry.ts';
import type { PathIndex } from '../index/path-index.ts';
import { hasDirectedCycle } from '../ops/cycle-existence.ts';

export { hasDirectedCycle };
export { hasCycleInAdjacency } from '../ops/cycle-existence.ts';

/** 枚举选项。 */
export interface EnumerateOptions {
  /**
   * 最多物化多少条新路径；达到即停止（DFS 顺序确定，因此截断结果可复现）。
   * 缺省不限。已是 `index.hashIndex` 中存在的路径不计入配额（跳过且不返回）。
   */
  readonly maxPaths?: number;
}

/**
 * 从每个 start 出发 DFS，把合法路径物化进 `index`，返回**本次新增**的条目。
 *
 * 契约：
 * - 节点必须带 attrs（`getNodeAttrs` 为空则跳过）；`rule.start` 不满足的 start 跳过；
 * - 边遍历用 `graph.outNeighbors(node, rule.edgeTypes)`（空边类型集合不吞噬全图）；
 * - 剪枝：simple 用本地 visited；nodeConstraint 不满足的节点不进入（超集剪枝）；
 * - 终判：仅当 `depth >= rule.lMin` 时调用 `isLegalPath`，通过才 `makeEntry`；
 *   hash 已存在则**跳过且不返回**（旋转等价路径天然去重）；
 * - 达到 `options.maxPaths` 立即停止（DFS 顺序确定性）；
 * - `lMax` 必须由调用方保证有限；实现以 `depth <= lMax && depth <= graph.nodeCount` 兜底，
 *   因此 `lMax = Infinity` 且 `simple: true` 的有限图仍然会终止（但非 simple 时结果不完整，
 *   属调用方违约，见 `validateRule`）。
 *
 * 复杂度：O(visited 路径数 × 路径长度)，最坏指数级——这正是需要索引与增量引擎的原因。
 */
export function enumerate(
  graph: GraphSpace,
  rule: PathRule,
  starts: Iterable<NodeId>,
  index: PathIndex,
  options: EnumerateOptions = {},
): PathEntry[] {
  const maxPaths = options.maxPaths ?? Number.POSITIVE_INFINITY;
  const results: PathEntry[] = [];
  if (!(maxPaths > 0) || graph.nodeCount === 0) return results;

  const simple = rule.simple === true;
  // 简单路径长度天然 ≤ |V|-1；非 simple 的 walk 可以超过 |V|（如 a↔b 上长度 3 的 walk），
  // 只有有限 lMax 才是它的真实上界。lMax 无界 + 非 simple 属调用方违约（validateRule 已报错），
  // 这里用 |V| 兜底终止而不是让枚举失控。
  const depthCap = Number.isFinite(rule.lMax)
    ? simple
      ? Math.min(rule.lMax, graph.nodeCount)
      : rule.lMax
    : graph.nodeCount;
  if (!(depthCap >= rule.lMin)) return results;
  const closed = rule.closed === true;
  const path: NodeId[] = [];
  const visited = new Set<NodeId>();

  const expand = (node: NodeId, depth: number, canExpand: boolean): void => {
    if (results.length >= maxPaths) return;

    if (depth >= rule.lMin && isLegalPath(rule, path, graph)) {
      const entry = makeEntry(rule, path, graph.version);
      if (!index.hashIndex.has(entry.hash)) {
        index.add(entry);
        results.push(entry);
        if (results.length >= maxPaths) return;
      }
    }

    if (!canExpand || depth >= depthCap) return;

    for (const next of graph.outNeighbors(node, rule.edgeTypes)) {
      if (results.length >= maxPaths) return;

      // 闭合路径的「末=首」是唯一允许的重复节点；simple 下它只能作为终点，不能继续展开。
      const closesCycle = closed && next === path[0];
      const alreadyVisited = visited.has(next);
      if (simple && alreadyVisited && !closesCycle) continue;

      const attrs = graph.getNodeAttrs(next);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(next, attrs)) continue;

      const pushedToVisited = simple && !alreadyVisited;
      if (pushedToVisited) visited.add(next);
      path.push(next);
      expand(next, depth + 1, !(simple && closesCycle));
      path.pop();
      if (pushedToVisited) visited.delete(next);
    }
  };

  for (const start of starts) {
    if (results.length >= maxPaths) break;
    const attrs = graph.getNodeAttrs(start);
    if (!attrs) continue;
    if (!rule.start(start, attrs)) continue;
    if (rule.nodeConstraint && !rule.nodeConstraint(start, attrs)) continue;

    path.length = 0;
    visited.clear();
    path.push(start);
    if (simple) visited.add(start);
    expand(start, 0, true);
  }

  return results;
}

/**
 * 读取某个起点的物化路径。
 *
 * 契约：`index.queryByStart` 已过滤 stale；这里再用 {@link isLiveEntry} 逐条确认
 * （版本与相邻边存在性），因此**永不返回 stale 条目**。
 * 存活率过低（(原条目数 - live) / 原条目数 > 0.3）说明索引对该起点已大面积失效，
 * 交给 `fallback` 现场重算；没有 fallback 就返回 `null`（"不知道"而不是"没有"）。
 *
 * @param fallback 惰性重算（通常 `() => enumerate(graph, rule, [start], index)`）
 * @returns 存活条目；空或失效比例 > 0.3 时为 `fallback() ?? null`
 */
export function query(
  rule: PathRule,
  start: NodeId,
  index: PathIndex,
  graph: GraphSpace,
  fallback?: () => PathEntry[],
): PathEntry[] | null {
  // 分母必须包含**已标记 stale** 的条目（getStartBuckets 不做过滤），否则
  // 「100 条里 40 条被删边置 stale」的索引会被算成 0% 失效，永远不回退（§5.4 的契约就失效了）。
  const buckets = index.getStartBuckets(start);
  const all: PathEntry[] = [];
  for (const entries of buckets.values()) all.push(...entries);
  const live = all.filter((entry) => isLiveEntry(entry, graph, rule));
  if (live.length === 0) return fallback ? fallback() : null;
  const staleRatio = (all.length - live.length) / all.length;
  if (staleRatio > 0.3) return fallback ? fallback() : null;
  return live;
}

/**
 * 存在性判定：(node, depth) 乘积状态 BFS，O(V · lMax)。
 *
 * 语义边界（务必如实理解）：本函数回答「存在一条**walk**」，忽略 simple 的重复节点约束，
 * 也不检查整路径谓词 `pathConstraint`——因此：
 * - 返回 `false` ⇒ 一定不存在合法路径（可靠的否定下界）；
 * - 返回 `true` ⇒ 可能存在合法 walk，但**未必**存在合法简单路径。
 *
 * 逐节点谓词（rule.start / nodeConstraint）与终点谓词（rule.end）参与剪枝与接纳，
 * 因为违反它们的节点不可能出现在任何合法路径上（见 {@link isLegalPath}）。
 *
 * @param target 若给出，只接受终点为该节点的 walk
 */
export function existsWalk(
  graph: GraphSpace,
  rule: PathRule,
  start: NodeId,
  target?: NodeId,
): boolean {
  const startAttrs = graph.getNodeAttrs(start);
  if (!startAttrs) return false;
  if (!rule.start(start, startAttrs)) return false;
  if (rule.nodeConstraint && !rule.nodeConstraint(start, startAttrs)) return false;

  // walk 语义：状态是 (node, depth)，深度上界就是 lMax。这里**不能**再用 |V| 兜底——
  // 非 simple 的 walk 允许重复节点，长度可以超过 |V|（如 a↔b 上长度 3 的 walk）。
  // lMax 无界时用 |V| 终止（非 simple 的无界 walk 集合无限，属调用方违约）。
  const depthCap = Number.isFinite(rule.lMax) ? rule.lMax : graph.nodeCount;
  if (!(depthCap >= rule.lMin)) return false;

  const closed = rule.closed === true;
  const accepts = (node: NodeId, depth: number): boolean => {
    if (depth < rule.lMin) return false;
    if (closed && !(depth >= 1 && node === start)) return false;
    if (target !== undefined && node !== target) return false;
    if (rule.end) {
      const attrs = graph.getNodeAttrs(node);
      if (!attrs || !rule.end(node, attrs, start)) return false;
    }
    return true;
  };

  if (accepts(start, 0)) return true;

  const seen = new Set<string>();
  const stateKey = (node: NodeId, depth: number): string => `${node}\u0000${depth}`;
  const queue: Array<{ node: NodeId; depth: number }> = [{ node: start, depth: 0 }];
  seen.add(stateKey(start, 0));
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++]!;
    if (current.depth >= depthCap) continue;
    for (const next of graph.outNeighbors(current.node, rule.edgeTypes)) {
      const depth = current.depth + 1;
      const key = stateKey(next, depth);
      if (seen.has(key)) continue;
      const attrs = graph.getNodeAttrs(next);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(next, attrs)) continue;
      seen.add(key);
      if (accepts(next, depth)) return true;
      queue.push({ node: next, depth });
    }
  }
  return false;
}