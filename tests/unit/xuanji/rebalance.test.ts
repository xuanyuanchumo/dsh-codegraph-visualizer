/**
 * 局部重组单测：1-hop 邻域失效 + 邻域内重枚举 + 幂等 + 返回新增数。
 *
 * 邻域定义（本模块契约）：`{node} ∪ 出邻居 ∪ 入邻居`（仅规则边类型），
 * 重枚举出的路径节点一律不出该集合；邻域外的旧条目只失效、不重扫。
 */

import { describe, expect, it } from 'vitest';
import { GraphSpace, type NodeId, type XJEdge } from '../../../src/xuanji/core/graph-space.ts';
import { isLegalPath, type PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { makeEntry, type PathEntry } from '../../../src/xuanji/core/path-entry.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import { rebalance } from '../../../src/xuanji/index/rebalance.ts';

function makeRule(overrides: Partial<PathRule> = {}): PathRule {
  return {
    name: 'rebalance-test',
    version: 1,
    start: () => true,
    edgeTypes: new Set(['call']),
    lMin: 1,
    lMax: 2,
    normalize: 'none',
    ...overrides,
  };
}

function edge(source: NodeId, target: NodeId, type = 'call'): XJEdge {
  return { id: `${source}->${target}->${type}`, source, target, type };
}

/** 独立 oracle：从零全量枚举（与 incremental 测试同构）。 */
function enumerateLegalPaths(graph: GraphSpace, rule: PathRule): NodeId[][] {
  const maxEdges = Number.isFinite(rule.lMax) ? Math.max(0, Math.floor(rule.lMax)) : graph.nodeCount;
  const found: NodeId[][] = [];
  const walk = (nodes: NodeId[], edges: number): void => {
    if (edges >= rule.lMin && isLegalPath(rule, nodes, graph)) found.push(nodes);
    if (edges >= maxEdges) return;
    const last = nodes[nodes.length - 1]!;
    for (const next of graph.outNeighbors(last, rule.edgeTypes)) {
      const attrs = graph.getNodeAttrs(next);
      if (!attrs) continue;
      if (rule.nodeConstraint && !rule.nodeConstraint(next, attrs)) continue;
      if (rule.simple === true && nodes.includes(next)) {
        if (rule.closed === true && next === nodes[0]) walk([...nodes, next], edges + 1);
        continue;
      }
      walk([...nodes, next], edges + 1);
    }
  };
  for (const start of graph.nodeIds()) {
    const attrs = graph.getNodeAttrs(start);
    if (!attrs || !rule.start(start, attrs)) continue;
    walk([start], 0);
  }
  return found;
}

function materializeAll(graph: GraphSpace, rule: PathRule): PathIndex {
  const index = new PathIndex();
  for (const nodes of enumerateLegalPaths(graph, rule)) {
    index.add(makeEntry(rule, nodes, graph.version));
  }
  return index;
}

function liveNodes(index: PathIndex): NodeId[][] {
  return [...index.hashIndex.values()].filter((e) => !e.stale).map((e) => e.nodes);
}

function findEntry(index: PathIndex, rule: PathRule, nodes: readonly NodeId[]): PathEntry | undefined {
  return index.hashIndex.get(makeEntry(rule, nodes, 0).hash);
}

/** 三角形基础图：a→b→c，返回三元组（节点已建好）。 */
function triangleGraph(): GraphSpace {
  const graph = new GraphSpace();
  for (const id of ['a', 'b', 'c']) graph.addNode(id, { label: id });
  graph.addEdge(edge('a', 'b'));
  graph.addEdge(edge('b', 'c'));
  return graph;
}

describe('rebalance：邻域内重新物化', () => {
  it('新边带来的邻域内新路径全部物化，并恢复被保守失效的旧路径', () => {
    const graph = triangleGraph();
    const rule = makeRule({ lMin: 1, lMax: 2 });

    const index = materializeAll(graph, rule);
    expect(liveNodes(index).sort()).toEqual([['a', 'b'], ['a', 'b', 'c'], ['b', 'c']]);
    const totalBefore = index.counters.total;

    graph.addEdge(edge('c', 'a'));
    const added = rebalance('c', rule, graph, index);

    // 净新增 = 3（[c,a] [c,a,b] [b,c,a]）；恢复的 [b,c] [a,b,c] 调用前就是 live，不计入
    expect(added).toBe(3);
    expect(index.counters.total).toBe(totalBefore + 3); // total 只随新入桶增长，恢复不增
    expect(liveNodes(index).map((n) => n.join('')).sort()).toEqual(
      ['ab', 'abc', 'bc', 'bca', 'ca', 'cab'].sort(),
    );
    // 与「新图从零全量物化」完全一致
    const fresh = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(fresh.liveCount());
    expect(
      [...index.hashIndex.values()]
        .filter((e) => !e.stale)
        .map((e) => e.hash)
        .sort(),
    ).toEqual(
      [...fresh.hashIndex.values()]
        .map((e) => e.hash)
        .sort(),
    );
  });

  it('幂等：第二次调用返回 0 且 live 集合 / 计数不变', () => {
    const graph = triangleGraph();
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = materializeAll(graph, rule);
    graph.addEdge(edge('c', 'a'));

    expect(rebalance('c', rule, graph, index)).toBeGreaterThan(0);
    const snapshot = liveNodes(index).map((n) => n.join('')).sort();
    const countersAfterFirst = { ...index.counters };

    expect(rebalance('c', rule, graph, index)).toBe(0);
    expect(liveNodes(index).map((n) => n.join('')).sort()).toEqual(snapshot);
    expect(index.counters).toEqual(countersAfterFirst);
  });

  it('邻域外独立分量完全不受影响（既不失效也不新增）', () => {
    const graph = triangleGraph();
    for (const id of ['x', 'y', 'z']) graph.addNode(id, { label: id });
    graph.addEdge(edge('x', 'y'));
    graph.addEdge(edge('y', 'z'));
    const rule = makeRule({ lMin: 1, lMax: 2 });

    const index = materializeAll(graph, rule);
    const outsideBefore = ['x', 'y', 'z'].flatMap((n) => index.queryByStart(n));
    expect(outsideBefore.length).toBeGreaterThan(0);

    graph.addEdge(edge('c', 'a'));
    rebalance('c', rule, graph, index);

    for (const entry of index.hashIndex.values()) {
      if (entry.nodes.some((n) => n === 'x' || n === 'y' || n === 'z')) {
        expect(entry.stale).toBe(false);
      }
    }
    // 邻域外的条目没有被重建（total 增长量 = 邻域内新入桶数）
    expect(index.queryByStart('x').length).toBe(2); // [x,y] 与 [x,y,z]
  });
});

describe('rebalance：边界与退化', () => {
  it('孤立节点（无相邻边）返回 0 且不改动索引', () => {
    const graph = triangleGraph();
    graph.addNode('z', { label: 'z' });
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = materializeAll(graph, rule);
    const before = { ...index.counters };

    expect(rebalance('z', rule, graph, index)).toBe(0);
    expect(index.counters).toEqual(before);
  });

  it('空图 / 节点不存在时返回 0', () => {
    const empty = new GraphSpace();
    expect(rebalance('a', makeRule(), empty, new PathIndex())).toBe(0);

    const graph = triangleGraph();
    const index = materializeAll(graph, makeRule());
    const before = { ...index.counters };
    expect(rebalance('missing', makeRule(), graph, index)).toBe(0);
    expect(index.counters).toEqual(before);
  });

  it('rule.start 只允许邻域内的 entry 节点作起点', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a', role: 'mid' });
    graph.addNode('b', { label: 'b', role: 'entry' });
    graph.addNode('c', { label: 'c', role: 'mid' });
    graph.addEdge(edge('a', 'b'));
    graph.addEdge(edge('b', 'c'));
    const rule = makeRule({
      start: (_node, attrs) => attrs.role === 'entry',
      lMin: 1,
      lMax: 2,
    });

    const index = materializeAll(graph, rule);
    expect(liveNodes(index)).toEqual([['b', 'c']]);

    graph.addEdge(edge('c', 'a'));
    const added = rebalance('c', rule, graph, index);

    expect(added).toBe(1); // 净新增 [b,c,a]（[b,c] 调用前即 live，恢复不计入）
    expect(findEntry(index, rule, ['b', 'c'])?.stale).toBe(false);
    expect(findEntry(index, rule, ['b', 'c', 'a'])?.stale).toBe(false);
    // 起点不是 entry 的路径不会被物化
    expect(findEntry(index, rule, ['c', 'a'])).toBeUndefined();
    expect(findEntry(index, rule, ['a', 'b'])).toBeUndefined();
  });

  it('nodeConstraint 阻止含违规节点的路径物化', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a', tags: ['ok'] });
    graph.addNode('b', { label: 'b', tags: ['ok'] });
    graph.addNode('c', { label: 'c', tags: [] });
    graph.addEdge(edge('a', 'b'));
    graph.addEdge(edge('b', 'c'));
    const rule = makeRule({
      nodeConstraint: (_node, attrs) => (attrs.tags ?? []).includes('ok'),
      lMin: 1,
      lMax: 2,
    });

    const index = materializeAll(graph, rule);
    expect(liveNodes(index)).toEqual([['a', 'b']]);
    const before = { ...index.counters };

    graph.addEdge(edge('c', 'a'));
    expect(rebalance('c', rule, graph, index)).toBe(0);
    expect(index.counters).toEqual(before);
    expect(liveNodes(index)).toEqual([['a', 'b']]);
  });

  it('lMin = 2 时 1 边路径不物化，2 边路径才入桶', () => {
    const graph = triangleGraph();
    const rule = makeRule({ lMin: 2, lMax: 2 });
    const index = materializeAll(graph, rule);
    expect(liveNodes(index)).toEqual([['a', 'b', 'c']]);

    graph.addEdge(edge('c', 'a'));
    expect(rebalance('c', rule, graph, index)).toBe(2); // 净新增 [c,a,b] [b,c,a]
    expect(findEntry(index, rule, ['c', 'a'])).toBeUndefined();
    expect(liveNodes(index).map((n) => n.join('')).sort()).toEqual(['abc', 'bca', 'cab']);
  });
});

describe('rebalance：闭合规则与多重边', () => {
  it('闭合规则下邻域内新增环被物化', () => {
    const graph = triangleGraph();
    const rule = makeRule({ closed: true, simple: true, lMin: 1, lMax: 3 });
    const index = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(0);

    graph.addEdge(edge('c', 'a'));
    const added = rebalance('a', rule, graph, index);

    expect(added).toBe(3); // 三个旋转代表
    expect(liveNodes(index).map((n) => n.join('')).sort()).toEqual(['abca', 'bcab', 'cabc']);
    const fresh = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(fresh.liveCount());
  });

  it('同端不同型：删除一条边后另类型仍支撑的条目被恢复', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const original = edge('a', 'b', 'call');
    graph.addEdge(original);
    const rule = makeRule({ edgeTypes: new Set(['call', 'data']), lMin: 1, lMax: 1 });

    const index = materializeAll(graph, rule);
    const entry = [...index.hashIndex.values()][0]!;
    expect(entry.stale).toBe(false);

    // 用「删 call、加 data」模拟类型替换：markStale 的键不含 type，所以条目会被误标
    graph.removeEdge(original);
    graph.addEdge(edge('a', 'b', 'data'));

    // 条目调用前就是 live（只是被本次 markStale 误伤后恢复）→ 净增 0
    expect(rebalance('b', rule, graph, index)).toBe(0);
    expect(entry.stale).toBe(false);
    expect(index.counters.stale).toBe(0);
  });
});

describe('rebalance：局部性边界（有意保留的语义）', () => {
  it('穿过节点但抵达 2-hop 以外的旧条目只失效、不重扫', () => {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd', 'e']) graph.addNode(id, { label: id });
    for (const [s, t] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ] as const) {
      graph.addEdge(edge(s, t));
    }
    const rule = makeRule({ lMin: 1, lMax: 6 });
    const index = materializeAll(graph, rule);
    const totalBefore = index.counters.total;

    graph.addEdge(edge('e', 'a'));
    const added = rebalance('c', rule, graph, index);

    // 邻域 {c,b,d} 内只有已有路径：恢复 3 条、净增 0；邻域外 7 条保持 stale
    expect(added).toBe(0);
    expect(index.counters.total).toBe(totalBefore);

    // [b,c] / [c,d] / [b,c,d] 恢复为 live
    for (const nodes of [
      ['b', 'c'],
      ['c', 'd'],
      ['b', 'c', 'd'],
    ]) {
      expect(findEntry(index, rule, nodes)?.stale).toBe(false);
    }
    // 邻域外：这几条只失效，不重扫（查询层 fallback 兜底）
    for (const nodes of [
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
      ['b', 'c', 'd', 'e'],
    ]) {
      expect(findEntry(index, rule, nodes)?.stale).toBe(true);
    }
    // 新边 e→a 不会把任何跨出邻域的路径带进来
    expect(findEntry(index, rule, ['a', 'b', 'c', 'd', 'e', 'a'])).toBeUndefined();
  });
});
