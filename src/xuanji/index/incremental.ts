/**
 * 增量引擎：新增一条边后，只物化「包含这条新边」的新合法路径（C3 完备性）。
 *
 * 设计说明（与契约文档的差异，已在 cycle-107 报告中说明）：
 * 文档原稿的「从 endIndex[u] / startIndex[v] 取前缀/后缀再拼接」只在
 * 前缀/后缀**已被物化**时成立；而索引只存 len ≥ lMin 且整条合法的条目，
 * 于是两类合法新路径永远找不到：
 *   1) lMin ≥ 2：前缀/后缀各自短于 lMin 时不入桶（例：lMin=2，图 a→b、c→d，
 *      新增 b→c，新路径 a→b→c 的前缀 [a,b] 与后缀 [c,d] 都只有 1 条边）；
 *   2) closed=true：环的前缀从 s 到 u 不闭合，因此不是规则的合法路径，不在桶里
 *      （例：闭合规则，图 a→b→c，新增 c→a，三角形 a→b→c→a 找不到）。
 *
 * 因此这里把「前缀/后缀」取成**可作前缀/后缀的合法走法**（索引条目的超集）：
 * - 前缀：在旧图 G \ {e} 上从 u 反向 DFS（含零长度虚拟前缀 [u]，必须）；
 * - 后缀：在新图 G' 上从 v 正向 DFS（因此也覆盖「新边被使用多次」的走法）；
 * - 拼接公式仍是契约里的 `pre.nodes.concat(suf.nodes)`：pre 已以 u 结尾、
 *   suf 已以 v 开头，接起来正好跨过 u→v，不额外插入 [u,v]。
 *
 * 终判一律 `isLegalPath`（精确），DFS 只做超集剪枝（长度 / 节点约束 / simple 去重）。
 *
 * 复杂度与降级（spec §5.4 / §7.3「路径数爆炸 → 回退」）：
 * 每条前缀 × 每条后缀都会被尝试展开，lMax 大时可能指数爆炸，因此设有
 * `INCREMENTAL_WORK_BUDGET` 展开预算（前缀展开 + 后缀展开都计数）。一旦超预算，
 * 说明本次增量已经比全量枚举更贵：`index.clear()` 把整索引降级为空并返回 []，
 * 查询层自然回退到全量枚举（fallback 契约），不抛异常、不留半成品。
 * 降级可通过 `wasLastIncrementalDegraded()` 观测（每次 onEdgeAdded 开头重置）。
 *
 * @module xuanji/index/incremental
 */

import type { EdgeType, GraphSpace, NodeId, XJEdge } from '../core/graph-space.ts';
import type { PathRule } from '../core/path-rule.ts';
import { isLegalPath } from '../core/path-rule.ts';
import type { PathEntry } from '../core/path-entry.ts';
import { makeEntry } from '../core/path-entry.ts';
import { edgePairKey, reviveEntry } from './path-index.ts';
import type { PathIndex } from './path-index.ts';

/** 增量展开预算（前缀展开 + 后缀展开次数）。超出即触发整索引降级。 */
export const INCREMENTAL_WORK_BUDGET = 50_000;

/** onEdgeAdded 的可选参数（适配层不传，默认 INCREMENTAL_WORK_BUDGET）。 */
export interface IncrementalOptions {
  /** 覆盖展开预算；测试用它把小预算注入到正常路径上。 */
  readonly workBudget?: number;
}

/** 降级哨兵：只在模块内部抛出/捕获，不泄漏给调用方。 */
const WORK_BUDGET_EXCEEDED: unique symbol = Symbol('xuanji.incremental.work-budget-exceeded');

interface WorkMeter {
  used: number;
  budget: number;
}

/** 记一次展开；超预算立即抛哨兵（由 onEdgeAdded 统一降级）。 */
function spend(meter: WorkMeter): void {
  meter.used += 1;
  if (meter.used > meter.budget) throw WORK_BUDGET_EXCEEDED;
}

function resolveBudget(options?: IncrementalOptions): number {
  const requested = options?.workBudget;
  if (requested === undefined || !Number.isFinite(requested)) return INCREMENTAL_WORK_BUDGET;
  return Math.max(0, Math.floor(requested));
}

let lastDegraded = false;

/** 最近一次 onEdgeAdded 是否因超出展开预算而降级（每次调用开头重置）。 */
export function wasLastIncrementalDegraded(): boolean {
  return lastDegraded;
}

/**
 * 有效长度上界（边数）。
 *
 * 有限 lMax 直接用；无界 lMax 只在 simple 规则下合法（validateRule §6），
 * 此时路径长度受 |V| 限制；这里统一用 |V| 兜底，避免非 simple 的无界规则把枚举拖进死循环。
 */
function effectiveMaxEdges(rule: PathRule, graph: GraphSpace): number {
  if (Number.isFinite(rule.lMax)) return Math.max(0, Math.floor(rule.lMax));
  return Math.max(0, graph.nodeCount);
}

/**
 * u→v 是否还有**别的类型**的边。
 * 反向遍历时新边（u→v, newEdge.type）必须被排除，否则前缀会包含新边本身；
 * 但同端不同型的既有边是合法的旧边，不能误排除（多重边场景）。
 */
function hasOtherTypeEdge(
  graph: GraphSpace,
  types: ReadonlySet<EdgeType>,
  excluded: EdgeType,
  source: NodeId,
  target: NodeId,
): boolean {
  for (const type of types) {
    if (type === excluded) continue;
    if (graph.hasEdge(source, target, type)) return true;
  }
  return false;
}

/**
 * 在旧图 G \ {e} 上反向收集所有可作前缀的走法（以 head = u 结尾）。
 *
 * 总是包含零长度虚拟前缀 [head]——索引只存 len ≥ lMin 的条目，缺了它就永远发现不了
 * 「新边直接闭合一个以 u 为起点的路径」的新环。
 */
function collectBackwardPrefixes(
  graph: GraphSpace,
  rule: PathRule,
  newEdge: XJEdge,
  head: NodeId,
  maxPrefixEdges: number,
  meter: WorkMeter,
): NodeId[][] {
  const prefixes: NodeId[][] = [[head]];
  const path: NodeId[] = [head];
  const onPath = new Set<NodeId>([head]);

  const walkBack = (current: NodeId, edges: number): void => {
    if (edges >= maxPrefixEdges) return;
    for (const source of graph.inNeighbors(current, rule.edgeTypes)) {
      spend(meter);
      // 新边不算旧图的一部分（同端不同型的旧边则允许）
      if (
        source === newEdge.source &&
        current === newEdge.target &&
        !hasOtherTypeEdge(graph, rule.edgeTypes, newEdge.type, source, current)
      ) {
        continue;
      }
      // simple 规则下前缀必须无重复节点（安全剪枝：重复前缀不可能是简单路径的前缀）
      if (rule.simple === true && onPath.has(source)) continue;
      const attrs = graph.getNodeAttrs(source);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(source, attrs)) continue;

      path.unshift(source);
      onPath.add(source);
      prefixes.push([...path]);
      walkBack(source, edges + 1);
      onPath.delete(source);
      path.shift();
    }
  };

  walkBack(head, 0);
  return prefixes;
}

/**
 * 新增边 e = (u,v) 之后，物化所有「包含 e」的新合法路径。
 *
 * @param options.workBudget DFS 展开预算（默认 INCREMENTAL_WORK_BUDGET）；超预算时整索引降级为空并返回 []
 * @returns 本次新入桶的条目（不含同 hash 已存在者；降级时为空数组）
 */
export function onEdgeAdded(
  edge: XJEdge,
  rule: PathRule,
  graph: GraphSpace,
  index: PathIndex,
  options?: IncrementalOptions,
): PathEntry[] {
  lastDegraded = false;

  // Φ：类型不在规则里 → 与新边无关
  if (!rule.edgeTypes.has(edge.type)) return [];
  const u = edge.source;
  const v = edge.target;
  // 端点必须已在图空间中（否则路径无法终判）
  if (!graph.getNodeAttrs(u) || !graph.getNodeAttrs(v)) return [];

  const maxEdges = effectiveMaxEdges(rule, graph);
  if (maxEdges < 1) return [];
  if (maxEdges < rule.lMin) return [];

  const added: PathEntry[] = [];
  const meter: WorkMeter = { used: 0, budget: resolveBudget(options) };

  const materialize = (nodes: readonly NodeId[]): void => {
    const entry = makeEntry(rule, nodes, graph.version);
    const existing = index.hashIndex.get(entry.hash);
    if (existing) {
      // 同 hash 已存在：不重复入桶、不返回；但若它只是被保守地误标 stale，且节点序列仍合法，则恢复
      if (existing.stale && isLegalPath(rule, existing.nodes, graph)) reviveEntry(index, existing);
      return;
    }
    if (index.add(entry)) added.push(entry);
  };

  /** 从 pre + [v] 出发，在 G' 上向后续走（新边可以再次被使用，覆盖多次穿越的走法）。 */
  const walkForward = (nodes: NodeId[], edges: number): void => {
    if (edges > maxEdges) return;
    if (edges >= rule.lMin && isLegalPath(rule, nodes, graph)) materialize(nodes);
    if (edges >= maxEdges) return;

    const last = nodes[nodes.length - 1]!;
    for (const next of graph.outNeighbors(last, rule.edgeTypes)) {
      spend(meter);
      const attrs = graph.getNodeAttrs(next);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(next, attrs)) continue;
      if (rule.simple === true && nodes.includes(next)) {
        // 简单路径里唯一合法的重复是「闭合回到起点」且必须是末节点
        if (rule.closed === true && next === nodes[0] && edges + 1 >= rule.lMin) {
          const closedNodes = [...nodes, next];
          if (isLegalPath(rule, closedNodes, graph)) materialize(closedNodes);
        }
        continue;
      }
      walkForward([...nodes, next], edges + 1);
    }
  };

  try {
    const maxPrefixEdges = Math.max(0, maxEdges - 1);
    for (const prefix of collectBackwardPrefixes(graph, rule, edge, u, maxPrefixEdges, meter)) {
      const seed = [...prefix, v];
      walkForward(seed, seed.length - 1);
    }
    return added;
  } catch (error) {
    if (error !== WORK_BUDGET_EXCEEDED) throw error;
    // spec §5.4 / §7.3：本次增量已比全量还贵 → 整索引降级为空，查询层回退全量枚举。
    // 不抛异常、不留半成品（cleared 后 counters 归零，hashIndex 为空）。
    index.clear();
    lastDegraded = true;
    return [];
  }
}

/**
 * 删除边之后的增量处理：保守失效经过 (u,v) 的全部条目。
 *
 * 只置 stale（不重新枚举），返回**本次新置**的条数；类型不在规则里则不触碰索引。
 * 幂等：重复调用返回 0。
 *
 * 这是 XJ-04 之前的**旧入口**，返回 number 的语义被既有调用方（含 `XuanjiAdapter`）
 * 依赖，因此原样保留；需要「是否该重建」的判定请用 {@link onEdgeRemovedDetailed}。
 */
export function onEdgeRemoved(edge: XJEdge, rule: PathRule, index: PathIndex): number {
  return onEdgeRemovedDetailed(edge, rule, index).newlyStale;
}

/** 删除单条边之后的判定结果（XJ-04）。 */
export interface EdgeRemovalResult {
  /** 本次新置 stale 的条目数（幂等：重复调用为 0）。 */
  readonly newlyStale: number;
  /** 索引的**全量** stale 比例：counters.stale / counters.total。 */
  readonly staleRatio: number;
  /** stale 比例是否已超过阈值，即索引需要全量重建。 */
  readonly needsRebuild: boolean;
}

/** stale 比例超过该值即视为索引需要全量重建（与 query-engine 的回退阈值 0.3 一致）。 */
export const DEFAULT_THETA_STALE = 0.3;

/** {@link onEdgeRemovedDetailed} 的可选参数。 */
export interface EdgeRemovalOptions {
  /** 覆盖 stale 阈值（缺省 {@link DEFAULT_THETA_STALE}）；用于测试与按读法调参。 */
  readonly thetaStale?: number;
}

function resolveTheta(options?: EdgeRemovalOptions): number {
  const requested = options?.thetaStale;
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_THETA_STALE;
  return Math.max(0, requested);
}

/**
 * 删除边并**如实报告**索引的失效程度（XJ-04：阈值必须到达动作）。
 *
 * 关键分母：`staleRatio` 的分子分母都取自 `index.counters`（**全量**计数，含已 stale 的条目），
 * 不能用 `queryByStart`/`sample` 过滤后的 live 数当分母——那样一个「全部条目都已失效」的索引
 * 会被算成 0% 失效，阈值永不触发（同样的坑见 `query-engine.ts` 的 `query()`）。
 *
 * 阈值语义是**严格大于**：比例恰等于 theta 时不重建（与 `query-engine.ts` 的 `> 0.3` 一致）。
 * `total === 0`（空索引）时比例定义为 0、`needsRebuild` 为 false，不谎报。
 *
 * 边类型不在规则里时 `newlyStale` 必为 0（这条边与该读法无关），但比例与判定仍如实返回——
 * 调用方问的是「这个索引还能不能用」，答案不取决于刚删的那条边属不属于这条规则。
 */
export function onEdgeRemovedDetailed(
  edge: XJEdge,
  rule: PathRule,
  index: PathIndex,
  options?: EdgeRemovalOptions,
): EdgeRemovalResult {
  const newlyStale = rule.edgeTypes.has(edge.type)
    ? index.markStale(edgePairKey(edge.source, edge.target))
    : 0;
  const total = index.counters.total;
  const staleRatio = total === 0 ? 0 : index.counters.stale / total;
  return { newlyStale, staleRatio, needsRebuild: staleRatio > resolveTheta(options) };
}
