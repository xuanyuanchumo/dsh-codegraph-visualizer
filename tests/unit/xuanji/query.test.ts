/**
 * 查询引擎（enumerate / query / existsWalk / hasDirectedCycle）与 topK 的单元测试。
 *
 * 重点：
 * - 枚举完备性用「小图穷举 + 手算期望」对齐；
 * - lMin/lMax 边界、closed 环、simple 去重、canonical 旋转等价、maxPaths 截断、已存在条目跳过；
 * - query 回退契约：空索引 → fallback，失效比例 > 30% → fallback，且**永不返回 stale 条目**。
 */
import { describe, it, expect, vi } from 'vitest';
import { GraphSpace } from '../../../src/xuanji/core/graph-space.ts';
import type { NodeAttrs } from '../../../src/xuanji/core/graph-space.ts';
import type { PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { effectiveMaxEdges } from '../../../src/xuanji/core/path-rule.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import type { PathEntry } from '../../../src/xuanji/core/path-entry.ts';
import { makeEntry } from '../../../src/xuanji/core/path-entry.ts';
import {
  enumerate,
  query,
  existsWalk,
  hasDirectedCycle,
  readPathPage,
} from '../../../src/xuanji/query/query-engine.ts';
import { topK } from '../../../src/xuanji/query/topk.ts';

type NodeSpec = string | { id: string; role?: string; tags?: string[] };

function buildGraph(nodes: readonly NodeSpec[], edges: ReadonlyArray<readonly [string, string, string]>): GraphSpace {
  const graph = new GraphSpace();
  for (const spec of nodes) {
    const id = typeof spec === 'string' ? spec : spec.id;
    const attrs: NodeAttrs =
      typeof spec === 'string'
        ? { label: id }
        : {
            label: id,
            ...(spec.role !== undefined ? { role: spec.role } : {}),
            ...(spec.tags !== undefined ? { tags: spec.tags } : {}),
          };
    graph.addNode(id, attrs);
  }
  for (const [source, target, type] of edges) {
    graph.addEdge({ id: source + '->' + target + '->' + type, source, target, type });
  }
  return graph;
}

function ruleOf(overrides: Partial<PathRule> = {}): PathRule {
  return {
    name: 'r',
    version: 1,
    start: () => true,
    edgeTypes: new Set(['r']),
    lMin: 1,
    lMax: 1,
    normalize: 'none',
    ...overrides,
  };
}

function sequences(entries: ReadonlyArray<{ nodes: readonly string[] }>): string[] {
  return entries.map((entry) => entry.nodes.join('>')).sort();
}

describe('enumerate：完备性与剪枝', () => {
  it('菱形小图穷举与手算期望完全一致（lMin=1, lMax=2）', () => {
    const graph = buildGraph(['a', 'b', 'c', 'd'], [
      ['a', 'b', 'r'],
      ['a', 'c', 'r'],
      ['b', 'd', 'r'],
      ['c', 'd', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 2, simple: true });
    const entries = enumerate(graph, rule, ['a'], index);
    expect(sequences(entries)).toEqual(['a>b', 'a>b>d', 'a>c', 'a>c>d']);
    expect(index.counters.total).toBe(4);
  });

  it('lMin 下边界：长度不足的路径不物化', () => {
    const graph = buildGraph(['a', 'b', 'd'], [
      ['a', 'b', 'r'],
      ['b', 'd', 'r'],
    ]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 2, lMax: 2, simple: true }), ['a'], index);
    expect(sequences(entries)).toEqual(['a>b>d']);
  });

  it('lMax 上边界：超长路径被截断（lMax=1 只剩单边路径）', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 1, lMax: 1, simple: true }), ['a'], index);
    expect(sequences(entries)).toEqual(['a>b']);
  });

  it('lMin=0 时零长度路径（单节点）也是合法条目', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 0, lMax: 0, simple: true }), ['a', 'b'], index);
    expect(sequences(entries)).toEqual(['a', 'b']);
  });

  it('closed 环：只物化回到起点且长度在区间内的路径', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'a', 'r'],
      ['b', 'c', 'r'],
      ['c', 'a', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 2, lMax: 3, closed: true, simple: true, normalize: 'canonical' });
    const entries = enumerate(graph, rule, ['a', 'b', 'c'], index);
    // [a,b,a] 与 [a,b,c,a] 各一个等价类（三个起点重复发现）
    expect(entries.length).toBe(2);
    for (const entry of entries) {
      expect(entry.nodes[0]).toBe(entry.nodes[entry.nodes.length - 1]);
      expect(entry.nodes.length - 1).toBeGreaterThanOrEqual(2);
      expect(entry.nodes.length - 1).toBeLessThanOrEqual(3);
    }
    expect(new Set(entries.map((entry) => entry.hash)).size).toBe(2);
  });

  it('simple 去重：双向边上的重复节点路径不物化', () => {
    const graph = buildGraph(['a', 'b'], [
      ['a', 'b', 'r'],
      ['b', 'a', 'r'],
    ]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 1, lMax: 5, simple: true }), ['a'], index);
    expect(sequences(entries)).toEqual(['a>b']);
  });

  it('非 simple 规则允许重复节点（walk 语义），直到 lMax 或 |V| 兜底', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['c', 'b', 'r'],
    ]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 3, lMax: 3, simple: false }), ['a'], index);
    expect(sequences(entries)).toEqual(['a>b>c>b']);
  });

  it('canonical 旋转等价：同一环从三个起点发现只物化一次', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['c', 'a', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 3, lMax: 3, closed: true, simple: true, normalize: 'canonical' });
    const entries = enumerate(graph, rule, ['a', 'b', 'c'], index);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.nodes[0]).toBe('a');
    expect(entries[0]!.nodes).toEqual(['a', 'b', 'c', 'a']);
  });

  it('maxPaths 立即截断且 DFS 顺序确定', () => {
    const graph = buildGraph(['a', 'b', 'c', 'd'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['c', 'd', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 3, simple: true });
    const entries = enumerate(graph, rule, ['a'], index, { maxPaths: 2 });
    expect(sequences(entries)).toEqual(['a>b', 'a>b>c']);
    expect(index.counters.total).toBe(2);
  });

  it('pathConstraint 精确终判：整路径谓词拒绝的路径不物化', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    const index = new PathIndex();
    const base = ruleOf({ lMin: 1, lMax: 2, simple: true });
    const onlyPairs: PathRule = {
      ...base,
      pathConstraint: (nodes: readonly string[]) => nodes.length === 2,
    };
    const entries = enumerate(graph, onlyPairs, ['a'], index);
    expect(sequences(entries)).toEqual(['a>b']);
  });

  it('已存在条目跳过且不返回（重复枚举幂等）', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const first = enumerate(graph, rule, ['a'], index);
    const second = enumerate(graph, rule, ['a'], index);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(index.counters.total).toBe(1);
  });

  it('rule.start 不满足的 start 被跳过，不作为枚举根', () => {
    const graph = buildGraph([{ id: 'a', role: 'entry' }, { id: 'b' }, { id: 'x', role: 'inner' }], [
      ['a', 'b', 'r'],
      ['x', 'a', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({
      lMin: 1,
      lMax: 2,
      simple: true,
      start: (_node, attrs) => attrs.role === 'entry',
    });
    const entries = enumerate(graph, rule, ['a', 'x'], index);
    expect(sequences(entries)).toEqual(['a>b']);
  });

  it('nodeConstraint 是超集剪枝：违反约束的节点不进入路径', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['a', 'c', 'r'],
    ]);
    const index = new PathIndex();
    const rule = ruleOf({
      lMin: 1,
      lMax: 2,
      simple: true,
      nodeConstraint: (node) => node !== 'b',
    });
    const entries = enumerate(graph, rule, ['a'], index);
    expect(sequences(entries)).toEqual(['a>c']);
  });

  it('缺失 attrs 的悬空邻居被跳过（不伪造节点）', () => {
    const graph = buildGraph(['a'], [['a', 'ghost', 'r']]);
    const index = new PathIndex();
    const entries = enumerate(graph, ruleOf({ lMin: 1, lMax: 2, simple: true }), ['a'], index);
    expect(entries).toEqual([]);
    expect(index.counters.total).toBe(0);
  });

  it('空 edgeTypes 不吞噬全图：只留下零长度路径', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 0, lMax: 5, simple: true, edgeTypes: new Set() });
    const entries = enumerate(graph, rule, ['a'], index);
    expect(sequences(entries)).toEqual(['a']);
  });

  it('不存在的 start 被忽略，不抛错', () => {
    const graph = buildGraph(['a'], []);
    const index = new PathIndex();
    expect(enumerate(graph, ruleOf({ lMin: 0, lMax: 0 }), ['nope'], index)).toEqual([]);
  });
});

describe('query：读取与失效回退', () => {
  function starGraph(count: number): GraphSpace {
    const nodes: string[] = ['a'];
    const edges: Array<readonly [string, string, string]> = [];
    for (let i = 0; i < count; i++) {
      nodes.push('x' + i);
      edges.push(['a', 'x' + i, 'r']);
    }
    return buildGraph(nodes, edges);
  }

  it('空索引返回 fallback 的结果', () => {
    const graph = starGraph(1);
    const index = new PathIndex();
    const marker: PathEntry[] = [makeEntry(ruleOf({ normalize: 'none' }), ['a'], graph.version)];
    const fallback = vi.fn(() => marker);
    expect(query(ruleOf({ lMin: 1, lMax: 1, simple: true }), 'a', index, graph, fallback)).toBe(marker);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('空索引且无 fallback 返回 null（"不知道"而非"没有"）', () => {
    const graph = starGraph(1);
    const index = new PathIndex();
    expect(query(ruleOf({ lMin: 1, lMax: 1, simple: true }), 'a', index, graph)).toBeNull();
  });

  it('全部条目存活时直接返回，不触发 fallback', () => {
    const graph = starGraph(3);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    enumerate(graph, rule, ['a'], index);
    const fallback = vi.fn(() => []);
    const result = query(rule, 'a', index, graph, fallback);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('失效比例 > 30% 时回退到 fallback', () => {
    const graph = starGraph(10);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    enumerate(graph, rule, ['a'], index);
    // 删除 4/10 条边 → 4 条条目不再 live（索引里仍在，但 isLiveEntry 为 false）
    for (let i = 0; i < 4; i++) {
      graph.removeEdge({ id: 'a->x' + i + '->r', source: 'a', target: 'x' + i, type: 'r' });
    }
    const marker: PathEntry[] = [makeEntry(ruleOf({ normalize: 'none' }), ['a'], graph.version)];
    const fallback = vi.fn(() => marker);
    expect(query(rule, 'a', index, graph, fallback)).toBe(marker);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('失效比例恰为 30% 时不回退（阈值是严格大于）', () => {
    const graph = starGraph(10);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    enumerate(graph, rule, ['a'], index);
    for (let i = 0; i < 3; i++) {
      graph.removeEdge({ id: 'a->x' + i + '->r', source: 'a', target: 'x' + i, type: 'r' });
    }
    const fallback = vi.fn(() => []);
    const result = query(rule, 'a', index, graph, fallback);
    expect(result).toHaveLength(7);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('永不返回 stale 条目（构造 stale 条目后断言）', () => {
    const graph = starGraph(10);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const entries = enumerate(graph, rule, ['a'], index);
    entries[0]!.stale = true;
    entries[1]!.stale = true;
    const fallback = vi.fn(() => []);
    const result = query(rule, 'a', index, graph, fallback);
    expect(result).not.toBeNull();
    expect(result!.every((entry) => !entry.stale)).toBe(true);
    expect(result!.length).toBeLessThanOrEqual(10);
  });

  it('stale 比例超过 30% 时也不返回 stale（回退或过滤）', () => {
    const graph = starGraph(5);
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const entries = enumerate(graph, rule, ['a'], index);
    for (let i = 0; i < 3; i++) entries[i]!.stale = true;
    const fallback = vi.fn(() => []);
    const result = query(rule, 'a', index, graph, fallback);
    if (result !== null) expect(result.every((entry) => !entry.stale)).toBe(true);
  });

  it('queryByStart 只按起点取桶：其它起点的条目不会被返回', () => {
    const graph = starGraph(2);
    graph.addNode('z', { label: 'z' });
    graph.addEdge({ id: 'z->a->r', source: 'z', target: 'a', type: 'r' });
    const index = new PathIndex();
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    enumerate(graph, rule, ['a', 'z'], index);
    const result = query(rule, 'z', index, graph);
    expect(result).not.toBeNull();
    expect(result!.every((entry) => entry.nodes[0] === 'z')).toBe(true);
  });
});

describe('existsWalk：存在性下界', () => {
  it('存在长度在区间内的 walk 时返回 true', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    expect(existsWalk(graph, ruleOf({ lMin: 2, lMax: 2, simple: true }), 'a', 'c')).toBe(true);
  });

  it('长度区间不可达时返回 false', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    expect(existsWalk(graph, ruleOf({ lMin: 3, lMax: 3, simple: true }), 'a', 'c')).toBe(false);
  });

  it('目标不可达时返回 false', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    expect(existsWalk(graph, ruleOf({ lMin: 1, lMax: 2 }), 'a', 'nope')).toBe(false);
  });

  it('忽略 simple：环上存在重复节点的 walk（但不存在合法简单路径）', () => {
    const graph = buildGraph(['a', 'b'], [
      ['a', 'b', 'r'],
      ['b', 'a', 'r'],
    ]);
    const rule = ruleOf({ lMin: 3, lMax: 3, simple: true });
    expect(existsWalk(graph, rule, 'a')).toBe(true);
    const index = new PathIndex();
    expect(enumerate(graph, rule, ['a'], index)).toEqual([]);
  });

  it('closed 规则要求回到起点', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    expect(existsWalk(graph, ruleOf({ lMin: 2, lMax: 2, closed: true, simple: true }), 'a')).toBe(false);
    graph.addEdge({ id: 'c->a->r', source: 'c', target: 'a', type: 'r' });
    expect(existsWalk(graph, ruleOf({ lMin: 3, lMax: 3, closed: true, simple: true }), 'a')).toBe(true);
  });

  it('rule.start 不满足的起点直接返回 false', () => {
    const graph = buildGraph([{ id: 'a', role: 'inner' }], []);
    const rule = ruleOf({ lMin: 1, lMax: 1, start: (_node, attrs) => attrs.role === 'entry' });
    expect(existsWalk(graph, rule, 'a')).toBe(false);
  });

  it('lMin=0 时起点自身即可接纳', () => {
    const graph = buildGraph(['a'], []);
    expect(existsWalk(graph, ruleOf({ lMin: 0, lMax: 0 }), 'a')).toBe(true);
  });
});

describe('hasDirectedCycle：直接复用 ops/cycle-existence', () => {
  it('有环图返回 true', () => {
    const graph = buildGraph(['a', 'b'], [
      ['a', 'b', 'r'],
      ['b', 'a', 'r'],
    ]);
    expect(hasDirectedCycle(graph, new Set(['r']))).toBe(true);
  });

  it('无环图返回 false', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ]);
    expect(hasDirectedCycle(graph, new Set(['r']))).toBe(false);
  });

  it('按边类型过滤：其它类型的环不误报', () => {
    const graph = buildGraph(['a', 'b'], [
      ['a', 'b', 'r'],
      ['b', 'a', 'x'],
    ]);
    expect(hasDirectedCycle(graph, new Set(['r']))).toBe(false);
    expect(hasDirectedCycle(graph, new Set(['x']))).toBe(false);
    expect(hasDirectedCycle(graph, new Set(['r', 'x']))).toBe(true);
  });
});

describe('topK：稳定选择', () => {
  it('k <= 0 返回空数组', () => {
    expect(topK([1, 2, 3], 0)).toEqual([]);
    expect(topK([1, 2, 3], -2)).toEqual([]);
  });

  it('k >= items.length 返回副本（不是同一引用）', () => {
    const items = [3, 1, 2];
    const result = topK(items, 3);
    expect(result).toEqual([3, 1, 2]);
    expect(result).not.toBe(items);
  });

  it('按 score 降序取前 k 项', () => {
    const items = [{ id: 'a', s: 1 }, { id: 'b', s: 9 }, { id: 'c', s: 5 }];
    const result = topK(items, 2, (item) => item.s);
    expect(result.map((item) => item.id)).toEqual(['b', 'c']);
  });

  it('同分保持原顺序（稳定）', () => {
    const items = ['first', 'second', 'third', 'fourth'];
    const scores = new Map([
      ['first', 5],
      ['second', 5],
      ['third', 9],
      ['fourth', 5],
    ]);
    const result = topK(items, 3, (item) => scores.get(item)!);
    expect(result).toEqual(['third', 'first', 'second']);
  });

  it('不修改输入数组', () => {
    const items = [4, 2, 8, 1];
    const snapshot = [...items];
    topK(items, 2);
    expect(items).toEqual(snapshot);
  });

  it('缺省 score 以元素自身数值计分（非数值视为 0 并保持原序）', () => {
    expect(topK([2, 7, 3], 2)).toEqual([7, 3]);
    const mixed: Array<number | string> = ['x', 5, 'y', 2];
    expect(topK(mixed, 2)).toEqual([5, 2]);
  });
});

/**
 * XJ-07：截断语义收口。
 *
 * 规范 §7.3 写「路径数爆炸 → Top-K 截断，保留高权重路径」，实现一直按 DFS 序截断，
 * 于是高权重路径可能正好是被丢掉的那条。这里把两种语义都钉住：
 * - `maxPaths` 本身只是条数上限（默认 DFS 序）；
 * - 要保权重必须显式 `truncation: 'top-k-weight'`。
 */
describe('XJ-07 截断语义：DFS 序 vs top-k-weight', () => {
  /** a→b→c（权重 1+1）与 a→d→c（权重 5+5），DFS 序先走 b 那条。 */
  function weightedDiamond(): GraphSpace {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id, { label: id });
    graph.addEdge({ id: 'ab', source: 'a', target: 'b', type: 'r', weight: 1 });
    graph.addEdge({ id: 'bc', source: 'b', target: 'c', type: 'r', weight: 1 });
    graph.addEdge({ id: 'ad', source: 'a', target: 'd', type: 'r', weight: 5 });
    graph.addEdge({ id: 'dc', source: 'd', target: 'c', type: 'r', weight: 5 });
    return graph;
  }

  it('默认（DFS 序）截断留下的是先发现的那条，不是高权重那条', () => {
    const graph = weightedDiamond();
    const rule = ruleOf({ lMin: 2, lMax: 2, simple: true });
    const index = new PathIndex();
    const entries = enumerate(graph, rule, ['a'], index, { maxPaths: 1 });
    expect(sequences(entries)).toEqual(['a>b>c']);
  });

  it("truncation: 'top-k-weight' 保留权重最高的路径（本项的核心断言）", () => {
    const graph = weightedDiamond();
    const rule = ruleOf({ lMin: 2, lMax: 2, simple: true });
    const index = new PathIndex();
    const entries = enumerate(graph, rule, ['a'], index, { maxPaths: 1, truncation: 'top-k-weight' });
    expect(sequences(entries)).toEqual(['a>d>c']);
    // 只物化被选中的那条：top-k 不是「先全物化再筛」
    expect(index.counters.total).toBe(1);
  });

  it('缺省 truncation 等价于 dfs-order（结果逐元素相等）', () => {
    const graph = weightedDiamond();
    const rule = ruleOf({ lMin: 1, lMax: 2, simple: true });
    const implicit = sequences(enumerate(graph, rule, ['a'], new PathIndex(), { maxPaths: 1 }));
    const explicit = sequences(
      enumerate(graph, rule, ['a'], new PathIndex(), { maxPaths: 1, truncation: 'dfs-order' }),
    );
    expect(implicit).toEqual(explicit);
  });

  it('权重全缺省时 top-k 退化为 DFS 序（稳定且确定，不制造伪优先级）', () => {
    const graph = buildGraph(['a', 'b', 'c', 'd'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['a', 'd', 'r'],
      ['d', 'c', 'r'],
    ]);
    const rule = ruleOf({ lMin: 2, lMax: 2, simple: true });
    const topk = sequences(
      enumerate(graph, rule, ['a'], new PathIndex(), { maxPaths: 1, truncation: 'top-k-weight' }),
    );
    const dfs = sequences(enumerate(graph, rule, ['a'], new PathIndex(), { maxPaths: 1 }));
    expect(topk).toEqual(dfs);
  });

  it('未知 truncation 策略抛 RuleCompositionError（不静默当作 DFS 序）', () => {
    const graph = weightedDiamond();
    const rule = ruleOf({ lMin: 1, lMax: 2, simple: true });
    expect(() =>
      enumerate(graph, rule, ['a'], new PathIndex(), {
        maxPaths: 1,
        truncation: 'bogus' as unknown as 'dfs-order',
      }),
    ).toThrow(/unknown truncation strategy/);
  });

  it('top-k 的候选集超预算显式抛错（不静默退回 DFS 序）', () => {
    const graph = weightedDiamond();
    const rule = ruleOf({ lMin: 1, lMax: 2, simple: true });
    expect(() =>
      enumerate(graph, rule, ['a'], new PathIndex(), {
        maxPaths: 1,
        truncation: 'top-k-weight',
        candidateBudget: 1,
      }),
    ).toThrow(/candidate set exceeds budget/);
  });
});

/**
 * XJ-10：`effectiveMaxEdges` 单一实现，且非法规则不再静默近似。
 *
 * 旧实现的 `Number.isFinite(lMax) ? lMax : |V|` 在 incremental / rebalance / query-engine
 * 各写一份，并且把「无界 lMax + 非 simple」这种非法规则静默按 |V| 截断——
 * 得到一份「看起来完整、其实缺一半」的结果。
 */
describe('XJ-10 effectiveMaxEdges：单一实现 + 非法规则显式拒绝', () => {
  it('有限 lMax 直接用（取整、夹到 ≥ 0）', () => {
    expect(effectiveMaxEdges({ lMax: 3, simple: false }, 100)).toBe(3);
    expect(effectiveMaxEdges({ lMax: 3.9, simple: true }, 100)).toBe(3);
    expect(effectiveMaxEdges({ lMax: -1, simple: true }, 100)).toBe(0);
  });

  it('无界 lMax + simple ⇒ 用 |V| 兜底（简单路径天然不超过 |V|-1 条边）', () => {
    expect(effectiveMaxEdges({ lMax: Number.POSITIVE_INFINITY, simple: true }, 7)).toBe(7);
  });

  it('无界 lMax + 非 simple ⇒ 抛错（路径集合无限，属调用方违约）', () => {
    expect(() =>
      effectiveMaxEdges({ lMax: Number.POSITIVE_INFINITY, simple: false }, 7),
    ).toThrow(/unbounded lMax requires simple/);
  });

  it('enumerate 也不再把非法规则静默近似成 |V|（生产路径同样抛错）', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: Number.POSITIVE_INFINITY, simple: false });
    expect(() => enumerate(graph, rule, ['a'], new PathIndex())).toThrow(/unbounded lMax requires simple/);
  });

  it('无界 + simple 的合法规则仍然终止于 |V|（回归：不能把合法输入也拒掉）', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
      ['c', 'b', 'r'],
    ]);
    const rule = ruleOf({ lMin: 1, lMax: Number.POSITIVE_INFINITY, simple: true });
    const entries = enumerate(graph, rule, ['a'], new PathIndex());
    expect(sequences(entries)).toEqual(['a>b', 'a>b>c']);
  });
});

/**
 * XJ-03：Ω（惰性输出）接到查询返回面。
 *
 * `readPathPage` 是「条目 → 当前页 + Ω 输出 + 下一页游标」的唯一入口；
 * 宿主（`graph_path_enumerate` / `graph_cycles`）经适配层拿到的 `labels` 就是它。
 */
describe('XJ-03 readPathPage：Ω 惰性输出 + 分页', () => {
  function labelRule(output?: (nodes: readonly string[]) => unknown): PathRule {
    return ruleOf({
      lMin: 1,
      lMax: 1,
      simple: true,
      ...(output ? { output } : {}),
    });
  }

  function entriesOf(count: number, rule: PathRule, graphVersion = 1): PathEntry[] {
    const result: PathEntry[] = [];
    for (let i = 0; i < count; i++) result.push(makeEntry(rule, ['a', 'n' + i], graphVersion));
    return result;
  }

  it('不传 cursor / pageSize 时返回全部条目（不分页），nextCursor 为 null', () => {
    const rule = labelRule();
    const entries = entriesOf(4, rule);
    const page = readPathPage(rule, entries);
    expect(page.entries).toHaveLength(4);
    expect(page.labels).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
  });

  it('分页：pageSize=2 翻两页，条目与 labels 一一对应且不重复', () => {
    const rule = labelRule((nodes) => nodes.join('->'));
    const entries = entriesOf(5, rule);

    const first = readPathPage(rule, entries, { cursor: 0, pageSize: 2 });
    expect(first.entries.map((e) => e.nodes[1])).toEqual(['n0', 'n1']);
    expect(first.labels).toEqual(['a->n0', 'a->n1']);
    expect(first.nextCursor).toBe(2);

    const second = readPathPage(rule, entries, { cursor: first.nextCursor!, pageSize: 2 });
    expect(second.entries.map((e) => e.nodes[1])).toEqual(['n2', 'n3']);
    expect(second.labels).toEqual(['a->n2', 'a->n3']);
    expect(second.nextCursor).toBe(4);

    const third = readPathPage(rule, entries, { cursor: second.nextCursor!, pageSize: 5 });
    expect(third.entries.map((e) => e.nodes[1])).toEqual(['n4']);
    expect(third.nextCursor).toBeNull();

    // 三页并起来 == 全部条目，无重复
    const seen = [...first.entries, ...second.entries, ...third.entries].map((e) => e.nodes[1]);
    expect(new Set(seen).size).toBe(5);
  });

  it('Ω 只对当前页求值，且首次结果缓存（再次读同一页不重复调用 output）', () => {
    const output = vi.fn((nodes: readonly string[]) => nodes.join('>'));
    const rule = labelRule(output);
    const entries = entriesOf(5, rule);

    readPathPage(rule, entries, { cursor: 0, pageSize: 2 });
    expect(output).toHaveBeenCalledTimes(2);

    // 第二页只求值新增的两条
    readPathPage(rule, entries, { cursor: 2, pageSize: 2 });
    expect(output).toHaveBeenCalledTimes(4);

    // 重复读第一页：条目上的 labels 已缓存，不再求值（惰性缓存的全部意义）
    readPathPage(rule, entries, { cursor: 0, pageSize: 2 });
    expect(output).toHaveBeenCalledTimes(4);
  });

  it('output 缺省时 labels 就是 nodes（path-entry 的 `: entry.nodes` 分支）', () => {
    const rule = labelRule();
    const entries = entriesOf(2, rule);
    const page = readPathPage(rule, entries);
    expect(page.labels).toEqual([
      ['a', 'n0'],
      ['a', 'n1'],
    ]);
  });

  it('cursor 超过条目数返回空页且 nextCursor 为 null（不抛错）', () => {
    const rule = labelRule();
    const entries = entriesOf(2, rule);
    const page = readPathPage(rule, entries, { cursor: 10, pageSize: 5 });
    expect(page.entries).toEqual([]);
    expect(page.labels).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});