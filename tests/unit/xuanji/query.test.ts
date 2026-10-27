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
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import type { PathEntry } from '../../../src/xuanji/core/path-entry.ts';
import { makeEntry } from '../../../src/xuanji/core/path-entry.ts';
import { enumerate, query, existsWalk, hasDirectedCycle } from '../../../src/xuanji/query/query-engine.ts';
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