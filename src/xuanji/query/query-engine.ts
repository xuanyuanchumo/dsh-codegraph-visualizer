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
import { RuleCompositionError, effectiveMaxEdges, isLegalPath } from '../core/path-rule.ts';
import type { PathEntry } from '../core/path-entry.ts';
import { entryLabels, isLiveEntry, makeEntry } from '../core/path-entry.ts';
import type { PathIndex } from '../index/path-index.ts';
import { hasDirectedCycle } from '../ops/cycle-existence.ts';
import { topK } from './topk.ts';

export { hasDirectedCycle };
export { hasCycleInAdjacency } from '../ops/cycle-existence.ts';

/**
 * `'top-k-weight'` 的候选集预算（候选路径条数上限）。
 *
 * `'dfs-order'` 可以在达到 `maxPaths` 时立刻停；`'top-k-weight'` **不能**——不看全候选
 * 就无法说「这几条是权重最高的」。因此它必须有一个显式上界，否则「保留高权重」会变成
 * 一次无界内存放大。超界抛错而不是静默退回 DFS 序：静默降级会让调用方以为拿到了
 * 高权重结果（与 XJ-10「非法规则不得静默近似」同一立场）。
 */
const TOP_K_CANDIDATE_BUDGET = 100_000;

function resolveCandidateBudget(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TOP_K_CANDIDATE_BUDGET;
  return Math.max(1, Math.floor(value));
}

/**
 * 路径权重：各步边的 `XJEdge.weight ?? 0` 之和。
 *
 * `weight` 此前全库零使用点（XJ-07 / #32）。未标注权重的边贡献 0，于是「所有权重都是 0」
 * 时 top-k 的分数全相同、`topK` 的稳定性保证它退化为 DFS 序——**确定且可复现**。
 */
function pathWeight(graph: GraphSpace, rule: PathRule, nodes: readonly NodeId[]): number {
  let total = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    for (const type of rule.edgeTypes) {
      const edge = graph.getEdge(nodes[i]!, nodes[i + 1]!, type);
      if (edge) {
        total += edge.weight ?? 0;
        break;
      }
    }
  }
  return total;
}

/** 枚举选项。 */
export interface EnumerateOptions {
  /**
   * 最多物化多少条新路径。
   * - `truncation: 'dfs-order'`（缺省）：达到即停止，截断按 **DFS 序**（确定、可复现）；
   * - `truncation: 'top-k-weight'`：先枚举全部候选再按权重降序取前 k。
   * 已是 `index.hashIndex` 中存在的路径不计入配额（跳过且不返回）。
   */
  readonly maxPaths?: number;
  /**
   * 截断策略（XJ-07）。
   *
   * 规范 §7.3 的原文是「路径数爆炸 → Top-K 截断，保留高权重路径」，而实现一直按 DFS 序
   * 截断——高权重路径可能正好是被 DFS 序丢掉的那条。这里把两种语义都显式化：
   * **`maxPaths` 只表示条数上限，本身不承诺「保留最重要的那些」**；要保权重必须显式选
   * `'top-k-weight'`。缺省为 `'dfs-order'`（与历史行为一致）。
   */
  readonly truncation?: 'dfs-order' | 'top-k-weight';
  /** `'top-k-weight'` 的候选集预算；缺省 {@link TOP_K_CANDIDATE_BUDGET}。 */
  readonly candidateBudget?: number;
}

/**
 * 从每个 start 出发 DFS，把合法路径物化进 `index`，返回**本次新增**的条目。
 *
 * 契约：
 * - 节点必须带 attrs（`getNodeAttrs` 为空则跳过）；`rule.start` 不满足的 start 跳过；
 * - 边遍历用 `graph.outNeighbors(node, rule.edgeTypes)`（空边类型集合不吞噬全图）；
 * - 剪枝：simple 用本地 visited；nodeConstraint 不满足的节点不进入（超集剪枝）；
 * - 终判：仅当 `depth >= rule.lMin` 时调用 `isLegalPath`，通过才物化；
 *   hash 已存在则**跳过且不返回**（旋转等价路径天然去重）；
 * - 截断（XJ-07）：缺省 `'dfs-order'` 达 `maxPaths` 即停；`'top-k-weight'` 先收全部候选
 *   再按 `weight` 降序取前 `maxPaths`（同分稳定保持 DFS 序）。未知策略抛
 *   {@link RuleCompositionError}，不静默当作 DFS 序；
 * - 长度上界由 {@link effectiveMaxEdges} 统一给出（XJ-10）：有限 `lMax` 用它；
 *   无界 + simple 用 |V| 兜底；**无界 + 非 simple 是非法规则，直接抛错**而不是
 *   静默用 |V| 近似出一份「看起来完整」的结果。
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
  const truncation = options.truncation ?? 'dfs-order';
  if (truncation !== 'dfs-order' && truncation !== 'top-k-weight') {
    throw new RuleCompositionError(`unknown truncation strategy "${String(truncation)}"`);
  }
  const maxPaths = options.maxPaths ?? Number.POSITIVE_INFINITY;
  const results: PathEntry[] = [];
  if (!(maxPaths > 0) || graph.nodeCount === 0) return results;

  const simple = rule.simple === true;
  // 剪枝用 pruneClosed（组合规则可能与判定用 closed 不同），判定仍由 isLegalPath 负责。
  const closedForPruning = (rule.pruneClosed ?? rule.closed) === true;
  // 长度上界统一由库内唯一实现给出（XJ-10）。非法规则（无界 + 非 simple）在此抛错。
  const depthCap = effectiveMaxEdges(rule, graph.nodeCount);
  if (!(depthCap >= rule.lMin)) return results;

  const topKMode = truncation === 'top-k-weight';
  const candidateBudget = topKMode ? resolveCandidateBudget(options.candidateBudget) : Number.POSITIVE_INFINITY;
  const candidates: NodeId[][] = [];

  const closed = closedForPruning;
  const path: NodeId[] = [];
  const visited = new Set<NodeId>();

  /** DFS 序：立刻物化并计数；top-k：只收候选（顺序由 topK 决定）。 */
  const accept = (nodes: readonly NodeId[]): void => {
    if (topKMode) {
      candidates.push([...nodes]);
      if (candidates.length > candidateBudget) {
        throw new RuleCompositionError(
          `top-k-weight: candidate set exceeds budget (${candidateBudget}); narrow the rule or raise candidateBudget`,
        );
      }
      return;
    }
    const entry = makeEntry(rule, nodes, graph.version);
    if (index.hashIndex.has(entry.hash)) return;
    index.add(entry);
    results.push(entry);
  };

  /** 是否已达条数上限（只有 DFS 序模式会提前停）。 */
  const full = (): boolean => !topKMode && results.length >= maxPaths;

  const expand = (node: NodeId, depth: number, canExpand: boolean): void => {
    if (full()) return;

    if (depth >= rule.lMin && isLegalPath(rule, path, graph)) {
      accept(path);
      if (full()) return;
    }

    if (!canExpand || depth >= depthCap) return;

    for (const next of graph.outNeighbors(node, rule.edgeTypes)) {
      if (full()) return;

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
    if (full()) break;
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

  if (!topKMode) return results;

  // top-k：候选已全部收齐（含旋转等价重复），按权重降序取前 maxPaths。
  // 同 hash 的第二条会被下面继续跳过，因此返回条数可能少于 maxPaths——如实返回，不补齐。
  const ranked = topK(candidates, maxPaths, (nodes) => pathWeight(graph, rule, nodes));
  for (const nodes of ranked) {
    const entry = makeEntry(rule, nodes, graph.version);
    if (index.hashIndex.has(entry.hash)) continue;
    index.add(entry);
    results.push(entry);
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
 * 查询返回面的**一页**：条目 + Ω 惰性输出 + 下一页游标（XJ-03）。
 *
 * 为什么需要它：规范 §5.4 要求「return live 的 **labels**」、§10-9 要求「labels 惰性构建」，
 * 但 `PathEntry.labels` 在此之前只有 `entryLabels` 内部读写，宿主拿到的永远是
 * `string[][]`——Ω 在类型里存在，在返回面上不存在。这个函数把两者接到一起：
 * - 只对**当前页**求 Ω（`entryLabels` 首次调用才求值并缓存到条目上），长尾路径不付成本；
 * - `cursor`/`pageSize` 表达分页：调用方可以从上次的 `nextCursor` 继续；
 * - 不传 `cursor`/`pageSize` 时返回全部条目（与「不分页」的旧行为同序同值）。
 *
 * @param entries 已按规则排好序的物化条目（通常来自 `enumerate` 的返回值）
 */
export function readPathPage(
  rule: PathRule,
  entries: readonly PathEntry[],
  options: { readonly cursor?: number; readonly pageSize?: number } = {},
): { entries: PathEntry[]; labels: unknown[]; nextCursor: number | null } {
  const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
  const pageSize =
    options.pageSize === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.pageSize));
  const page = Number.isFinite(pageSize)
    ? entries.slice(cursor, cursor + pageSize)
    : entries.slice(cursor);
  const end = cursor + page.length;
  return {
    entries: page,
    // Ω 只对当前页求值：惰性的意义就是「没被返回的路径不付输出成本」。
    labels: page.map((entry) => entryLabels(entry, rule)),
    nextCursor: end < entries.length ? end : null,
  };
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

  // walk 语义：状态是 (node, depth)，深度上界就是 lMax。这里**不能**直接用
  // `effectiveMaxEdges`（XJ-10 的唯一实现）——那个函数把「无界 + 非 simple」判为非法规则并抛错，
  // 而 walk 存在性判定恰恰要在这种（调用方违约的）规则上仍给出可靠的**否定**下界：
  // 无界时用 |V| 终止比抛错更有用，且不夸大结果（见上面「语义边界」）。
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