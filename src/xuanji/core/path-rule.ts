/**
 * 路径规则 R = (S, Φ, Λ, Ψ, Ω, Δ) 与规则组合代数。
 *
 * 璇玑图原型：十种读法共享同一方锦缎——「内容与规则分离」。
 * 规则是声明式的：起点谓词 / 边类型 / 长度区间 / 节点约束 / 终点 / 闭合 /
 * 输出映射 / 规范化策略，引擎只按规则枚举，不为每种读法写一遍遍历。
 *
 * 扩展（相对 spec §2.2）：
 * - `end` 终点谓词：读法可以在指定的字处收束（如「从 A 读到 B」）；
 * - `closed` 闭合标记：路径必须回到起点（环枚举）；
 * - `pathConstraint` 整路径谓词：组合代数（并/交/拼接/差）用它精确表达
 *   「合法于 R1 或/且/非 R2」，而逐节点谓词保持为超集，保证枚举完备。
 *
 * 零宿主依赖。
 *
 * @module xuanji/core/path-rule
 */

import type { EdgeType, GraphSpace, NodeAttrs, NodeId } from './graph-space.ts';

/** 起点谓词 S: V → {0,1}。 */
export type StartPredicate = (node: NodeId, attrs: NodeAttrs) => boolean;
/** 节点约束 Ψ: V → {0,1}（路径上每个节点都必须满足）。 */
export type NodePredicate = (node: NodeId, attrs: NodeAttrs) => boolean;
/** 终点谓词：路径最后一个节点必须满足。 */
export type EndPredicate = (node: NodeId, attrs: NodeAttrs, start: NodeId) => boolean;
/** 整路径谓词（组合代数用；返回 false 的路径不物化）。 */
export type PathPredicate = (nodes: readonly NodeId[], graph: GraphSpace) => boolean;
/** 输出映射 Ω: Path → 任意值。 */
export type OutputMapper = (nodes: readonly NodeId[]) => unknown;
/** 规范化策略 Δ。 */
export type NormalizeStrategy = 'none' | 'reverse' | 'canonical';

/** 一条路径规则。 */
export interface PathRule {
  readonly name: string;
  /** 单调递增版本号（热插拔/索引回收用）。 */
  readonly version: number;
  readonly start: StartPredicate;
  /** Φ：允许的边类型集合 Σ_R。 */
  readonly edgeTypes: ReadonlySet<EdgeType>;
  /** Λ：长度区间（边数），0 ≤ lMin ≤ lMax。 */
  readonly lMin: number;
  readonly lMax: number;
  /** Ψ：路径上每个节点必须满足。 */
  readonly nodeConstraint?: NodePredicate;
  readonly end?: EndPredicate;
  /** 路径必须回到起点（环）。 */
  readonly closed?: boolean;
  /** 简单路径（不重复节点；闭合路径允许末节点等于首节点）。 */
  readonly simple?: boolean;
  /** 整路径谓词（组合代数产物，通常不手写）。 */
  readonly pathConstraint?: PathPredicate;
  /** 输出映射；惰性求值并缓存于 PathEntry。 */
  readonly output?: OutputMapper;
  readonly normalize: NormalizeStrategy;
}

/** 规则静态校验结果（spec §3.4）。 */
export interface RuleValidation {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * 注册前静态校验（spec §3.4）：
 * 1. Σ_R ⊆ Σ；2. 0 ≤ lMin ≤ lMax；3. simple 且 lMax > |V| 告警；
 * 4. output/normalize 合法；5. 闭合规则要求 lMin ≥ 1；
 * 6. 无界长度必须配 simple（否则路径无限，spec §八）。
 */
export function validateRule(
  rule: PathRule,
  knownEdgeTypes: ReadonlySet<EdgeType>,
  nodeCount?: number,
): RuleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rule.name || rule.name.trim().length === 0) errors.push('rule.name must be non-empty');
  if (!Number.isInteger(rule.version) || rule.version < 1) {
    errors.push('rule.version must be a positive integer');
  }
  if (typeof rule.start !== 'function') errors.push('rule.start must be a predicate');
  for (const type of rule.edgeTypes) {
    if (!knownEdgeTypes.has(type)) errors.push(`edge type "${type}" is not present in the graph space`);
  }
  if (rule.edgeTypes.size === 0) warnings.push('rule.edgeTypes is empty: the rule can never match an edge');
  if (!Number.isFinite(rule.lMin) || rule.lMin < 0) errors.push('rule.lMin must be a finite number ≥ 0');
  if (!(rule.lMax >= rule.lMin)) errors.push('rule.lMax must be ≥ rule.lMin');
  if (rule.lMax === Number.POSITIVE_INFINITY && rule.simple !== true) {
    errors.push('unbounded lMax requires simple: true (otherwise the path set is infinite)');
  }
  if (rule.closed === true && rule.lMin < 1) {
    errors.push('closed rules require lMin ≥ 1 (a zero-edge closed path is a single node, not a cycle)');
  }
  if (rule.simple === true && Number.isFinite(rule.lMax) && nodeCount !== undefined && rule.lMax > nodeCount) {
    warnings.push(`lMax (${rule.lMax}) exceeds |V| (${nodeCount}): simple paths cannot be that long`);
  }
  if (rule.normalize !== 'none' && rule.normalize !== 'reverse' && rule.normalize !== 'canonical') {
    errors.push(`unknown normalize strategy "${String(rule.normalize)}"`);
  }
  return { errors, warnings };
}

/** 组合代数失败（不可表达的组合）。 */
export class RuleCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleCompositionError';
  }
}

function combinePredicates(
  a: NodePredicate | undefined,
  b: NodePredicate | undefined,
  op: 'or' | 'and',
): NodePredicate | undefined {
  if (!a) return op === 'and' ? b : undefined;
  if (!b) return op === 'and' ? a : undefined;
  return op === 'or' ? (n, attrs) => a(n, attrs) || b(n, attrs) : (n, attrs) => a(n, attrs) && b(n, attrs);
}

/**
 * 并 R1 ∪ R2：谓词析取、长度取并。
 * 逐节点谓词取超集（OR），并用 pathConstraint 精确过滤——
 * 只有「超集剪枝 + 精确终判」才能同时保证完备与正确（spec §2.4 封闭性）。
 */
export function unionRules(r1: PathRule, r2: PathRule): PathRule {
  const bothEnd = r1.end && r2.end;
  return {
    name: `${r1.name}∪${r2.name}`,
    version: Math.max(r1.version, r2.version),
    start: (n, a) => r1.start(n, a) || r2.start(n, a),
    edgeTypes: new Set([...r1.edgeTypes, ...r2.edgeTypes]),
    lMin: Math.min(r1.lMin, r2.lMin),
    lMax: Math.max(r1.lMax, r2.lMax),
    nodeConstraint: combinePredicates(r1.nodeConstraint, r2.nodeConstraint, 'or'),
    ...(bothEnd ? { end: (n: NodeId, a: NodeAttrs, s: NodeId) => r1.end!(n, a, s) || r2.end!(n, a, s) } : {}),
    closed: r1.closed === true && r2.closed === true,
    simple: r1.simple === true && r2.simple === true,
    pathConstraint: (nodes, graph) => isLegalPath(r1, nodes, graph) || isLegalPath(r2, nodes, graph),
    ...(r1.output ? { output: r1.output } : r2.output ? { output: r2.output } : {}),
    normalize: r1.normalize,
  };
}

/** 交 R1 ∩ R2：谓词合取、长度取交。 */
export function intersectRules(r1: PathRule, r2: PathRule): PathRule {
  const lMin = Math.max(r1.lMin, r2.lMin);
  const lMax = Math.min(r1.lMax, r2.lMax);
  if (lMin > lMax) throw new RuleCompositionError('intersectRules: the length intervals are disjoint');
  const end =
    r1.end && r2.end
      ? (n: NodeId, a: NodeAttrs, s: NodeId) => r1.end!(n, a, s) && r2.end!(n, a, s)
      : (r1.end ?? r2.end);
  return {
    name: `${r1.name}∩${r2.name}`,
    version: Math.max(r1.version, r2.version),
    start: (n, a) => r1.start(n, a) && r2.start(n, a),
    edgeTypes: new Set([...r1.edgeTypes].filter((t) => r2.edgeTypes.has(t))),
    lMin,
    lMax,
    nodeConstraint: combinePredicates(r1.nodeConstraint, r2.nodeConstraint, 'and'),
    ...(end ? { end } : {}),
    closed: r1.closed === true || r2.closed === true,
    simple: r1.simple === true || r2.simple === true,
    pathConstraint: (nodes, graph) => isLegalPath(r1, nodes, graph) && isLegalPath(r2, nodes, graph),
    ...(r1.output ? { output: r1.output } : r2.output ? { output: r2.output } : {}),
    normalize: r1.normalize,
  };
}

/**
 * 拼接 R1 · R2：p1 终点 = p2 起点，长度相加。
 * 整路径合法性 = ∃ 切分点 k，使前段合法于 R1、后段合法于 R2（O(L²)，路径短）。
 */
export function concatRules(r1: PathRule, r2: PathRule): PathRule {
  return {
    name: `${r1.name}·${r2.name}`,
    version: Math.max(r1.version, r2.version),
    start: r1.start,
    edgeTypes: new Set([...r1.edgeTypes, ...r2.edgeTypes]),
    lMin: r1.lMin + r2.lMin,
    lMax: r1.lMax + r2.lMax,
    nodeConstraint: combinePredicates(r1.nodeConstraint, r2.nodeConstraint, 'and'),
    ...(r2.end ? { end: r2.end } : {}),
    closed: false,
    simple: r1.simple === true && r2.simple === true,
    pathConstraint: (nodes, graph) => {
      for (let k = 1; k < nodes.length; k++) {
        const head = nodes.slice(0, k);
        const tail = nodes.slice(k - 1);
        if (isLegalPath(r1, head, graph) && isLegalPath(r2, tail, graph)) return true;
      }
      return false;
    },
    ...(r1.output ? { output: r1.output } : r2.output ? { output: r2.output } : {}),
    normalize: r1.normalize,
  };
}

/** 迭代 R*（有界重复 n 次）：R·R·…·R。 */
export function repeatRule(rule: PathRule, times: number): PathRule {
  if (!Number.isInteger(times) || times < 1) {
    throw new RuleCompositionError('repeatRule: times must be a positive integer');
  }
  let acc = rule;
  for (let i = 1; i < times; i++) acc = concatRules(acc, rule);
  return { ...acc, name: `${rule.name}^{*${times}}` };
}

/** 差 R1 \ R2：合法于 R1 且不合法于 R2（剪枝沿用 R1 的超集）。 */
export function differenceRules(r1: PathRule, r2: PathRule): PathRule {
  return {
    ...r1,
    name: `${r1.name}\${r2.name}`,
    pathConstraint: (nodes, graph) => isLegalPath(r1, nodes, graph) && !isLegalPath(r2, nodes, graph),
  };
}

/** 路径是否重复访问节点（闭合路径允许唯一的「末=首」重复）。 */
export function hasDuplicateNodes(nodes: readonly NodeId[], allowClosedReturn: boolean): boolean {
  const seen = new Set<NodeId>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (i === nodes.length - 1 && allowClosedReturn && i > 0 && node === nodes[0]) continue;
    if (seen.has(node)) return true;
    seen.add(node);
  }
  return false;
}

/**
 * 整路径合法性判定（C1 可靠性）：S、Φ、Λ、Ψ、Δ 之外的可判定约束全在此处。
 * 枚举器只做剪枝，最终是否物化以本函数为准——「剪枝可以是超集，判据必须精确」。
 */
export function isLegalPath(
  rule: PathRule,
  nodes: readonly NodeId[],
  graph: GraphSpace,
): boolean {
  if (nodes.length === 0) return false;
  const edges = nodes.length - 1;
  if (edges < rule.lMin || edges > rule.lMax) return false;
  if (rule.closed === true) {
    if (edges < 1 || nodes[0] !== nodes[nodes.length - 1]) return false;
  }
  if (rule.simple === true && hasDuplicateNodes(nodes, rule.closed === true)) return false;

  const startAttrs = graph.getNodeAttrs(nodes[0]!);
  if (!startAttrs || !rule.start(nodes[0]!, startAttrs)) return false;

  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i]!;
    const attrs = graph.getNodeAttrs(id);
    if (!attrs) return false;
    if (rule.nodeConstraint && !rule.nodeConstraint(id, attrs)) return false;
  }

  if (rule.end) {
    const last = nodes[nodes.length - 1]!;
    const lastAttrs = graph.getNodeAttrs(last);
    if (!lastAttrs || !rule.end(last, lastAttrs, nodes[0]!)) return false;
  }

  for (let i = 0; i + 1 < nodes.length; i++) {
    if (!graph.hasEdgeOfType(nodes[i]!, nodes[i + 1]!, rule.edgeTypes)) return false;
  }

  if (rule.pathConstraint && !rule.pathConstraint(nodes, graph)) return false;
  return true;
}
