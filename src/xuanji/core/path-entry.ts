/**
 * 路径条目 PathEntry：物化路径 + Δ-规范哈希 + 版本 + 惰性输出。
 *
 * 契约（spec §4.3）：
 * - nodes 存完整节点序列（前缀/后缀拼接需要）；
 * - hash 必须基于 Δ-规范形式计算（循环等价才能去重）；
 * - labels 惰性构建：长尾路径不付出字符串成本；
 * - version 记录生成时的图版本，供不变量 I5 检查。
 *
 * @module xuanji/core/path-entry
 */

import type { GraphSpace, NodeId } from './graph-space.ts';
import type { PathRule } from './path-rule.ts';
import { boothMinimalRotation } from '../ops/booth.ts';
import { RollingHash } from '../ops/rolling-hash.ts';

/** 一条被物化的路径。 */
export interface PathEntry {
  /** 完整节点序列（原序，不是规范序）。 */
  readonly nodes: NodeId[];
  /** Δ-规范形式的指纹。 */
  readonly hash: string;
  /** 生成时的图版本。 */
  readonly version: number;
  /** 惰性失效标记（删除边后置位，查询永不返回 stale 条目）。 */
  stale: boolean;
  /** 惰性输出（Ω 的结果，首次查询时构建）。 */
  labels?: unknown;
}

/** 按元素字典序比较两个节点序列（-'<' | 0 | '>'）。 */
export function compareNodeSequences(a: readonly NodeId[], b: readonly NodeId[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/**
 * 按规则的 Δ 策略求规范形式。
 * - none：原序；
 * - reverse：正/反序中字典序较小者；
 * - canonical：Booth 最小循环旋转。
 *
 * 闭合路径的表示是 `[v0, v1, …, vk]` 且 `vk === v0`；直接对含重复首节点的序列做
 * 旋转会得到 `[v1, …, vk, v0]` 这类**非法路径表示**（末节点不再等于首节点）。
 * 因此闭合路径只对「开核」`nodes.slice(0, -1)` 做旋转——哈希取的是环的等价类，
 * 而 `PathEntry.nodes` 仍保存调用方传入的完整路径。
 */
export function canonicalNodes(
  rule: Pick<PathRule, 'normalize' | 'closed'>,
  nodes: readonly NodeId[],
): NodeId[] {
  switch (rule.normalize) {
    case 'reverse': {
      const reversed = [...nodes].reverse();
      return compareNodeSequences(reversed, nodes) < 0 ? reversed : [...nodes];
    }
    case 'canonical': {
      if (rule.closed === true && nodes.length > 1 && nodes[0] === nodes[nodes.length - 1]) {
        return boothMinimalRotation(nodes.slice(0, -1));
      }
      return boothMinimalRotation(nodes);
    }
    case 'none':
    default:
      return [...nodes];
  }
}

/** 创建路径条目：规范哈希在库内一次算好，调用方不重复计算。 */
export function makeEntry(
  rule: Pick<PathRule, 'normalize' | 'closed'>,
  nodes: readonly NodeId[],
  graphVersion: number,
): PathEntry {
  const canonical = canonicalNodes(rule, nodes);
  return {
    nodes: [...nodes],
    hash: RollingHash.hashSequence(canonical),
    version: graphVersion,
    stale: false,
  };
}

/** 惰性输出映射 Ω：首次调用才求值并缓存到条目上。 */
export function entryLabels(entry: PathEntry, rule: PathRule): unknown {
  if (entry.labels !== undefined) return entry.labels;
  const produced = rule.output ? rule.output(entry.nodes) : entry.nodes;
  entry.labels = produced;
  return produced;
}

/** 条目是否可作为查询结果（未失效，且边仍全部存在——I5 的查询侧防线）。 */
export function isLiveEntry(entry: PathEntry, graph: GraphSpace, rule: PathRule): boolean {
  if (entry.stale) return false;
  if (entry.version > graph.version) return false;
  for (let i = 0; i + 1 < entry.nodes.length; i++) {
    if (!graph.hasEdgeOfType(entry.nodes[i]!, entry.nodes[i + 1]!, rule.edgeTypes)) return false;
  }
  return true;
}
