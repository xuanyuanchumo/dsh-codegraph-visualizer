/**
 * 不变量检查器 I1–I5：索引与图空间的一致性体检。
 *
 * 璇玑图原型：读法可以很多，但「锦缎」与「读法索引」之间的对应关系必须始终成立。
 * 检查器不修复任何东西，只如实报告——修复策略属于增量引擎/invariants 的调用方。
 *
 * 五项不变量（cycle-107 契约）：
 * - I1：rule.edgeTypes 中每类边至少出现在一条 live 物化路径的相邻边上；
 * - I2：图中每种角色（attrs.role，缺省 tags[0]）至少出现在一条 live 路径中；
 * - I3：按边类型聚合的 live 路径平均长度，max-min ≤ thetaDepth；
 * - I4：counters.stale / counters.total ≤ thetaStale（O(1)，total=0 视为比率 0）；
 * - I5：抽样条目的 version ≤ graph.version，且非 stale 条目的每条相邻边仍存在。
 *
 * 零宿主依赖。
 *
 * @module xuanji/ops/invariants
 */

import type { EdgeType, GraphSpace, NodeAttrs } from '../core/graph-space.ts';
import type { PathRule } from '../core/path-rule.ts';
import type { PathEntry } from '../core/path-entry.ts';
import { isLiveEntry } from '../core/path-entry.ts';
import type { PathIndex } from '../index/path-index.ts';

/** 阈值：stale 比例上限与各边类型平均路径长度极差上限。 */
export interface InvariantThresholds {
  /** I4：stale/total 的允许上限（缺省 0.3，与查询回退阈值一致）。 */
  readonly thetaStale?: number;
  /** I3：不同边类型平均路径长度的允许极差（缺省 2）。 */
  readonly thetaDepth?: number;
}

/** 单项不变量结果。 */
export interface InvariantResult {
  readonly id: 'I1' | 'I2' | 'I3' | 'I4' | 'I5';
  readonly ok: boolean;
  readonly detail: string;
  /** 违规条目数（ok 恒为 0；未达标时为具体违规计数）。 */
  readonly violations: number;
}

/** I2 的角色提取：attrs.role 优先，缺省取第一个 tag。 */
function roleOf(attrs: NodeAttrs | undefined): string | undefined {
  if (!attrs) return undefined;
  if (typeof attrs.role === 'string' && attrs.role.length > 0) return attrs.role;
  const first = attrs.tags?.[0];
  if (typeof first === 'string' && first.length > 0) return first;
  return undefined;
}

/** 收集全部 live 物化路径（按规范 hash 去重，起点/终点两路桶都看，避免漏索引）。 */
function collectLiveEntries(index: PathIndex, graph: GraphSpace, rule: PathRule): PathEntry[] {
  const seen = new Set<string>();
  const result: PathEntry[] = [];
  const visit = (entry: PathEntry): void => {
    if (seen.has(entry.hash)) return;
    if (!isLiveEntry(entry, graph, rule)) return;
    seen.add(entry.hash);
    result.push(entry);
  };
  for (const buckets of index.startIndex.values()) {
    for (const entries of buckets.values()) for (const entry of entries) visit(entry);
  }
  for (const buckets of index.endIndex.values()) {
    for (const entries of buckets.values()) for (const entry of entries) visit(entry);
  }
  return result;
}

/** I1–I5 检查器。阈值在构造时固定，检查过程无副作用（只读索引）。 */
export class InvariantChecker {
  private readonly thetaStale: number;
  private readonly thetaDepth: number;

  constructor(thresholds: InvariantThresholds = {}) {
    this.thetaStale = thresholds.thetaStale ?? 0.3;
    this.thetaDepth = thresholds.thetaDepth ?? 2;
  }

  /**
   * I1：每类被规则允许的边，至少出现在一条 live 物化路径的相邻边上。
   * 空 edgeTypes 视为「无可覆盖项」（validateRule 会对此告警）；不谎报失败。
   */
  checkI1(index: PathIndex, rule: PathRule, graph: GraphSpace): InvariantResult {
    const covered = new Set<EdgeType>();
    for (const entry of collectLiveEntries(index, graph, rule)) {
      for (let i = 0; i + 1 < entry.nodes.length; i++) {
        const u = entry.nodes[i]!;
        const v = entry.nodes[i + 1]!;
        for (const type of rule.edgeTypes) {
          if (graph.hasEdge(u, v, type)) covered.add(type);
        }
      }
    }
    const missing: EdgeType[] = [];
    for (const type of rule.edgeTypes) if (!covered.has(type)) missing.push(type);
    return {
      id: 'I1',
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? 'every rule edge type appears on at least one live materialized path'
          : 'edge types without any live materialized path: ' + missing.join(', '),
      violations: missing.length,
    };
  }

  /**
   * I2：图中每种角色至少出现在一条 live 路径中。
   *
   * 诚实说明：nodeConstraint 是**不可反推的任意谓词**——无法从它推导出「哪些角色必须覆盖」。
   * 因此 I2 只统计「图中实际存在的角色」（图像素）在 live 路径里的覆盖率，
   * 缺失角色数即 violations；它不声称 nodeConstraint 满足。
   */
  checkI2(index: PathIndex, rule: PathRule, graph: GraphSpace): InvariantResult {
    const graphRoles = new Set<string>();
    for (const id of graph.nodeIds()) {
      const role = roleOf(graph.getNodeAttrs(id));
      if (role !== undefined) graphRoles.add(role);
    }
    const covered = new Set<string>();
    for (const entry of collectLiveEntries(index, graph, rule)) {
      for (const id of entry.nodes) {
        const role = roleOf(graph.getNodeAttrs(id));
        if (role !== undefined && graphRoles.has(role)) covered.add(role);
      }
    }
    const missing: string[] = [];
    for (const role of graphRoles) if (!covered.has(role)) missing.push(role);
    return {
      id: 'I2',
      ok: missing.length === 0,
      detail:
        graphRoles.size === 0
          ? 'no node in the graph declares a role; I2 is vacuously satisfied'
          : 'role coverage ' +
            (graphRoles.size - missing.length) +
            '/' +
            graphRoles.size +
            (missing.length > 0 ? '; uncovered: ' + missing.join(', ') : ''),
      violations: missing.length,
    };
  }

  /**
   * I3：按边类型聚合 live 路径的平均长度，极差不得超过 thetaDepth。
   * 只有出现在至少一条 live 路径上的边类型参与聚合；少于两类时显然达标。
   */
  checkI3(index: PathIndex, rule: PathRule, graph: GraphSpace): InvariantResult {
    const sums = new Map<EdgeType, { sum: number; count: number }>();
    for (const entry of collectLiveEntries(index, graph, rule)) {
      const length = entry.nodes.length - 1;
      const typesHere = new Set<EdgeType>();
      for (let i = 0; i + 1 < entry.nodes.length; i++) {
        for (const type of rule.edgeTypes) {
          if (graph.hasEdge(entry.nodes[i]!, entry.nodes[i + 1]!, type)) typesHere.add(type);
        }
      }
      for (const type of typesHere) {
        const aggregate = sums.get(type) ?? { sum: 0, count: 0 };
        aggregate.sum += length;
        aggregate.count += 1;
        sums.set(type, aggregate);
      }
    }

    if (sums.size < 2) {
      return {
        id: 'I3',
        ok: true,
        detail: 'fewer than two edge types have live paths; depth spread is 0',
        violations: 0,
      };
    }

    const averages: Array<{ type: EdgeType; avg: number }> = [];
    for (const [type, aggregate] of sums) {
      averages.push({ type, avg: aggregate.sum / aggregate.count });
    }
    let min = averages[0]!.avg;
    let max = averages[0]!.avg;
    for (const item of averages) {
      if (item.avg < min) min = item.avg;
      if (item.avg > max) max = item.avg;
    }
    const spread = max - min;
    const exceeding = averages.filter((item) => item.avg > min + this.thetaDepth);
    const ok = spread <= this.thetaDepth;
    return {
      id: 'I3',
      ok,
      detail:
        'average path length per edge type over [' +
        averages.map((item) => item.type + '=' + item.avg.toFixed(2)).join(', ') +
        '] spread=' +
        spread.toFixed(2) +
        ' thetaDepth=' +
        this.thetaDepth,
      violations: ok ? 0 : exceeding.length,
    };
  }

  /** I4：stale 比例上限。O(1)，不遍历任何条目。 */
  checkI4(index: PathIndex): InvariantResult {
    const total = index.counters.total;
    const stale = index.counters.stale;
    const ratio = total === 0 ? 0 : stale / total;
    const ok = ratio <= this.thetaStale;
    return {
      id: 'I4',
      ok,
      detail:
        'stale/total = ' +
        stale +
        '/' +
        total +
        ' = ' +
        ratio.toFixed(3) +
        ' (thetaStale=' +
        this.thetaStale +
        ')',
      violations: ok ? 0 : stale,
    };
  }

  /**
   * I5：抽样一致性。version ≤ graph.version；非 stale 条目的每条相邻边必须仍存在。
   * 边检查使用 rule.edgeTypes（空集合会让 hasEdgeOfType 永远为 false——那是检查器的错，不是图的错）。
   */
  checkI5(index: PathIndex, rule: PathRule, graph: GraphSpace): InvariantResult {
    const sample = index.sample(100);
    let violations = 0;
    const offenders: string[] = [];
    for (const entry of sample) {
      if (entry.version > graph.version) {
        violations++;
        offenders.push('version ' + entry.version + ' > graph ' + graph.version);
        continue;
      }
      if (entry.stale) continue;
      for (let i = 0; i + 1 < entry.nodes.length; i++) {
        if (!graph.hasEdgeOfType(entry.nodes[i]!, entry.nodes[i + 1]!, rule.edgeTypes)) {
          violations++;
          offenders.push('missing edge ' + entry.nodes[i]! + '->' + entry.nodes[i + 1]!);
          break;
        }
      }
    }
    return {
      id: 'I5',
      ok: violations === 0,
      detail:
        'sampled ' +
        sample.length +
        ' entries; ' +
        (violations === 0 ? 'all consistent' : 'violations: ' + offenders.slice(0, 5).join('; ')),
      violations,
    };
  }

  /** 按 I1→I5 顺序全部检查。 */
  checkAll(index: PathIndex, rule: PathRule, graph: GraphSpace): InvariantResult[] {
    return [
      this.checkI1(index, rule, graph),
      this.checkI2(index, rule, graph),
      this.checkI3(index, rule, graph),
      this.checkI4(index),
      this.checkI5(index, rule, graph),
    ];
  }
}