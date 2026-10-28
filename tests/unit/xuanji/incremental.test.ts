/**
 * 增量引擎单测。
 *
 * 核心是 C3 完备性 oracle：文件内自带一个**独立**的全量枚举器（从零 DFS + isLegalPath），
 * 对 200 组随机图 × 随机规则做如下比对：
 *   1) 原图上全量物化 → indexA；
 *   2) 加入一条随机新边；
 *   3) 对 indexA 执行 onEdgeAdded；
 *   4) 对新图从零全量物化 → indexB；
 *   5) 断言两者 live 哈希集合完全相等。
 * 这是证明「增量 = 全量」的唯一可信方式：任何漏物化或误物化都会让集合不等。
 *
 * ## 与 spec §5.2「长度分桶增量」的偏差声明（cycle-107 报告用）
 *
 * spec §5.2 的设想是「endIndex[u] 的每条前缀 × startIndex[v] 的每条后缀」配对，
 * 复杂度 O(|P_in|·|P_out|)。但该配对只在**前缀/后缀已被物化**时成立：
 *   - lMin ≥ 2 时，短于 lMin 的前缀/后缀不入桶 → 新增边接出的中等长度路径漏物化；
 *   - closed=true 时，环的前缀从 s 到 u 不闭合，因此不是规则的合法路径，不在桶里。
 * 因此实现改为「旧图反向 DFS 前缀 × 新图正向 DFS 后缀」，拼接公式不变
 * （pre.nodes.concat(suf.nodes)，pre 以 u 结尾、suf 以 v 开头，不插入 [u,v]）。
 * 复杂度从 O(|P_in|·|P_out|) 变为 O(前缀走法 × 后缀走法)，最坏仍是指数级，
 * 于是用 INCREMENTAL_WORK_BUDGET（默认 50_000 次展开）兜底：超预算即 index.clear()
 * 整索引降级为空（spec §5.4 / §7.3「路径数爆炸 → 回退」），查询层回退全量枚举，
 * 由 wasLastIncrementalDegraded() 观测。长度分桶仍保留在 PathIndex 里（Λ 剪枝与
 * 按长度查询、O(1) liveCount 依赖它），只是不再作为增量配对的数据源。
 */

import { describe, expect, it } from 'vitest';
import { GraphSpace, type NodeId, type XJEdge } from '../../../src/xuanji/core/graph-space.ts';
import { isLegalPath, type PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { makeEntry, type PathEntry } from '../../../src/xuanji/core/path-entry.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import {
  DEFAULT_THETA_STALE,
  INCREMENTAL_WORK_BUDGET,
  onEdgeAdded,
  onEdgeRemoved,
  onEdgeRemovedDetailed,
  wasLastIncrementalDegraded,
} from '../../../src/xuanji/index/incremental.ts';

const NODE_POOL = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

function makeRule(overrides: Partial<PathRule> = {}): PathRule {
  return {
    name: 'incremental-test',
    version: 1,
    start: () => true,
    edgeTypes: new Set(['call']),
    lMin: 1,
    lMax: 4,
    normalize: 'none',
    ...overrides,
  };
}

function edge(source: NodeId, target: NodeId, type = 'call'): XJEdge {
  return { id: `${source}->${target}->${type}`, source, target, type };
}

/** 固定种子 LCG：测试必须可复现。 */
class Lcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  int(bound: number): number {
    return Math.floor(this.next() * bound);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

/**
 * 独立 oracle：从零 DFS 枚举全部合法路径（节点序列）。
 * 只做安全剪枝（长度 / 节点约束 / simple 去重），终判 isLegalPath。
 */
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
        // 唯一合法的重复是「闭合回到起点」且位于末节点
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

/** 在给定图上做一次全量物化（oracle 侧）。 */
function materializeAll(graph: GraphSpace, rule: PathRule): PathIndex {
  const index = new PathIndex();
  for (const nodes of enumerateLegalPaths(graph, rule)) {
    index.add(makeEntry(rule, nodes, graph.version));
  }
  return index;
}

/** live 哈希集合（排序后便于逐项比较）。 */
function liveHashes(index: PathIndex): string[] {
  return [...index.hashIndex.values()]
    .filter((entry) => !entry.stale)
    .map((entry) => entry.hash)
    .sort();
}

function nodesOf(index: PathIndex, rule: PathRule): NodeId[][] {
  return [...index.hashIndex.values()].filter((e) => !e.stale).map((e) => e.nodes);
}

interface Scenario {
  graph: GraphSpace;
  rule: PathRule;
  types: string[];
}

/** 随机图 + 随机规则（固定种子可复现）。 */
function buildScenario(rng: Lcg): Scenario {
  const nodeCount = 2 + rng.int(3); // 2..4
  const ids = NODE_POOL.slice(0, nodeCount);
  const typePool = rng.bool(0.4) ? ['call', 'data', 'ref'] : ['call', 'data'];

  const graph = new GraphSpace();
  for (const id of ids) {
    graph.addNode(id, {
      label: id,
      role: rng.bool(0.35) ? 'entry' : 'mid',
      tags: rng.bool(0.5) ? ['ok'] : [],
    });
  }

  const baseEdges = rng.int(nodeCount + 2); // 0..5
  for (let i = 0; i < baseEdges; i++) {
    const s = rng.pick(ids);
    const t = rng.pick(ids);
    const type = rng.pick(typePool);
    graph.addEdge(edge(s, t, type));
  }
  // 额外随机边，提高出现环/多路径的概率
  if (rng.bool(0.8)) {
    const s = rng.pick(ids);
    const t = rng.pick(ids);
    graph.addEdge(edge(s, t, rng.pick(typePool)));
  }

  const closed = rng.bool(0.35);
  const rawLMin = rng.int(3); // 0..2
  const lMin = closed ? Math.max(1, rawLMin) : rawLMin;
  const lMax = Math.min(lMin + rng.int(2), 3); // ≤ 3
  const simple = rng.bool(0.5);
  const startByRole = rng.bool(0.4);
  const constrained = rng.bool(0.3);

  const rule: PathRule = {
    name: 'rnd',
    version: 1,
    start: startByRole ? (_node, attrs) => attrs.role === 'entry' : () => true,
    edgeTypes: new Set(typePool),
    lMin,
    lMax,
    ...(closed ? { closed: true } : {}),
    ...(simple ? { simple: true } : {}),
    ...(constrained ? { nodeConstraint: (_node, attrs) => (attrs.tags ?? []).includes('ok') } : {}),
    normalize: rng.pick(['none', 'reverse', 'canonical'] as const),
  };
  return { graph, rule, types: typePool };
}

describe('onEdgeAdded：C3 完备性（200 组随机属性测试）', () => {
  it('增量物化结果与「新图从零全量物化」逐哈希一致', () => {
    const rng = new Lcg(0x5eed107);
    let compared = 0;
    let nonEmpty = 0;
    let grown = 0;
    let newEntries = 0;
    let degradedCases = 0;

    for (let attempt = 0; attempt < 20000 && compared < 200; attempt++) {
      const { graph, rule, types } = buildScenario(rng);
      const ids = [...graph.nodeIds()];
      if (ids.length === 0) continue;
      const u = rng.pick(ids);
      const v = rng.pick(ids);
      const type = rng.pick(types);
      const candidate = edge(u, v, type);
      if (graph.hasEdge(u, v, type)) continue; // 该边已存在，增量不适用

      // (1) 原图全量物化
      const indexA = materializeAll(graph, rule);
      const before = liveHashes(indexA);

      // (2) 加入新边
      if (!graph.addEdge(candidate)) continue;

      // (3) 增量
      const produced = onEdgeAdded(candidate, rule, graph, indexA);
      if (wasLastIncrementalDegraded()) {
        // 随机小图不应触发预算降级；真触发说明预算对该图族偏紧，单列出来而不是误报 C3 缺陷
        degradedCases++;
        continue;
      }

      // (4) 新图从零全量物化
      const indexB = materializeAll(graph, rule);

      const afterA = liveHashes(indexA);
      const afterB = liveHashes(indexB);
      const missing = afterB.filter((h) => !afterA.includes(h));
      const extra = afterA.filter((h) => !afterB.includes(h));
      if (missing.length > 0 || extra.length > 0) {
        const describeRule = {
          lMin: rule.lMin,
          lMax: rule.lMax,
          closed: rule.closed ?? false,
          simple: rule.simple ?? false,
          normalize: rule.normalize,
        };
        throw new Error(
          `C3 mismatch @ case ${compared} (attempt ${attempt}) rule=${JSON.stringify(describeRule)} ` +
            `newEdge=${u}->${v}->${type}\n` +
            `missing(H)${missing.length}=${missing.join(',')}\n` +
            `extra(H)${extra.length}=${extra.join(',')}\n` +
            `A(stale-aware)=${JSON.stringify([...indexA.hashIndex.values()].map((e) => ({ n: e.nodes, s: e.stale })))}\n` +
            `B=${JSON.stringify([...indexB.hashIndex.values()].map((e) => e.nodes))}`,
        );
      }

      // 返回数组：无重复、全部是新入桶的 live 条目
      const returnedHashes = produced.map((e) => e.hash);
      expect(new Set(returnedHashes).size).toBe(returnedHashes.length);
      for (const hash of returnedHashes) {
        expect(before.includes(hash)).toBe(false);
        expect(indexA.hashIndex.get(hash)?.stale).toBe(false);
      }
      expect(indexA.liveCount()).toBe(afterB.length);

      compared++;
      newEntries += produced.length;
      if (afterB.length > 0) nonEmpty++;
      if (afterA.length > before.length) grown++;
    }

    expect(compared).toBe(200);
    // 防退化：随机集必须真的产生过路径、且真的有「新增边带来新路径」的样本
    expect(nonEmpty).toBeGreaterThan(40);
    expect(grown).toBeGreaterThan(30);
    expect(newEntries).toBeGreaterThan(50);
    expect(degradedCases).toBe(0);
  });
});

describe('onEdgeAdded：边界与退化', () => {
  it('边类型不在 rule.edgeTypes 时返回空数组且不触碰索引', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const candidate = edge('a', 'b', 'data');
    graph.addEdge(candidate);

    const index = new PathIndex();
    const rule = makeRule({ edgeTypes: new Set(['call']) });

    expect(onEdgeAdded(candidate, rule, graph, index)).toEqual([]);
    expect(index.counters.total).toBe(0);
    expect(index.hashIndex.size).toBe(0);
  });

  it('端点缺少 attrs 时跳过（不制造悬空路径）', () => {
    const graph = new GraphSpace();
    graph.addNode('b', { label: 'b' });

    const index = new PathIndex();
    expect(onEdgeAdded(edge('ghost', 'b'), makeRule(), graph, index)).toEqual([]);
    expect(onEdgeAdded(edge('b', 'ghost'), makeRule(), graph, index)).toEqual([]);
    expect(index.counters.total).toBe(0);
  });

  it('空图 / 无节点的边不产生任何条目', () => {
    const graph = new GraphSpace();
    const index = new PathIndex();
    expect(onEdgeAdded(edge('a', 'b'), makeRule(), graph, index)).toEqual([]);
    expect(index.liveCount()).toBe(0);
  });

  it('lMin = 0：零边路径已存在，新边只补一条单边路径', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const rule = makeRule({ lMin: 0, lMax: 1 });

    const index = materializeAll(graph, rule);
    expect(nodesOf(index, rule)).toEqual([['a'], ['b']]);

    const candidate = edge('a', 'b');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(produced.map((e) => e.nodes)).toEqual([['a', 'b']]);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });

  it('自环：闭合规则下新增 a->a 产生 [a,a]', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    const rule = makeRule({ closed: true, simple: true, lMin: 1, lMax: 3 });

    const index = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(0);

    const candidate = edge('a', 'a');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(produced.map((e) => e.nodes)).toEqual([['a', 'a']]);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });

  it('多重边（同端不同型）：新类型不产生重复节点序列，add 返回 false 且不进返回数组', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge(edge('a', 'b', 'call'));
    const rule = makeRule({ edgeTypes: new Set(['call', 'data']), lMin: 1, lMax: 1 });

    const index = materializeAll(graph, rule);
    expect(nodesOf(index, rule)).toEqual([['a', 'b']]);

    const candidate = edge('a', 'b', 'data');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(produced).toEqual([]);
    expect(nodesOf(index, rule)).toEqual([['a', 'b']]);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });

  it('lMin = 2 时短于 lMin 的前缀/后缀仍要参与拼接（契约文档原稿在此不完备）', () => {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id, { label: id });
    graph.addEdge(edge('a', 'b'));
    graph.addEdge(edge('c', 'd'));
    const rule = makeRule({ lMin: 2, lMax: 3, simple: true });

    const index = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(0); // 原图没有任何 ≥2 边的路径

    const candidate = edge('b', 'c');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(produced.map((e) => e.nodes).sort()).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
      ['b', 'c', 'd'],
    ]);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });

  it('闭合规则下新边闭合既有路径（三角形）必须被发现', () => {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c']) graph.addNode(id, { label: id });
    graph.addEdge(edge('a', 'b'));
    graph.addEdge(edge('b', 'c'));
    const rule = makeRule({ closed: true, simple: true, lMin: 1, lMax: 4 });

    const index = materializeAll(graph, rule);
    expect(index.liveCount()).toBe(0);

    const candidate = edge('c', 'a');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(produced.map((e) => e.nodes)).toEqual([
      ['c', 'a', 'b', 'c'],
      ['b', 'c', 'a', 'b'],
      ['a', 'b', 'c', 'a'],
    ]);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
    expect(index.liveCount()).toBe(3);
  });

  it('同端不同型：新边让保守失效的条目恢复为 live（不返回、但索引必须恢复）', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const rule = makeRule({ edgeTypes: new Set(['call', 'data']), lMin: 1, lMax: 1 });
    const original = edge('a', 'b', 'call');
    graph.addEdge(original);

    const index = materializeAll(graph, rule);
    const entry = [...index.hashIndex.values()][0]!;

    graph.removeEdge(original);
    expect(onEdgeRemoved(original, rule, index)).toBe(1);
    expect(entry.stale).toBe(true);

    const replacement = edge('a', 'b', 'data');
    graph.addEdge(replacement);
    const produced = onEdgeAdded(replacement, rule, graph, index);

    expect(produced).toEqual([]);
    expect(entry.stale).toBe(false);
    expect(index.counters.stale).toBe(0);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });
});

describe('onEdgeRemoved：O(k) 保守失效', () => {
  it('只置 stale 经过该边对的条目，返回新置条数且幂等', () => {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id, { label: id });
    graph.addEdge(edge('a', 'b'));
    graph.addEdge(edge('b', 'c'));
    graph.addEdge(edge('c', 'd'));
    const rule = makeRule({ lMin: 1, lMax: 4 });

    const index = materializeAll(graph, rule);
    expect(nodesOf(index, rule).length).toBe(6); // [ab],[bc],[cd],[abc],[bcd],[abcd]

    const removed = edge('b', 'c');
    graph.removeEdge(removed);

    expect(onEdgeRemoved(removed, rule, index)).toBe(4);
    const staleNodes = [...index.hashIndex.values()].filter((e) => e.stale).map((e) => e.nodes);
    expect(staleNodes.sort()).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
      ['b', 'c'],
      ['b', 'c', 'd'],
    ]);
    // 不经过 b->c 的条目完全不受影响
    const live = nodesOf(index, rule);
    expect(live).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // 幂等
    expect(onEdgeRemoved(removed, rule, index)).toBe(0);
  });

  it('类型不在 rule.edgeTypes 时不失效任何条目', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const rule = makeRule({ edgeTypes: new Set(['call']) });
    const dataEdge = edge('a', 'b', 'data');
    graph.addEdge(dataEdge);

    const index = materializeAll(graph, rule);
    expect(onEdgeRemoved(dataEdge, rule, index)).toBe(0);
    expect(index.counters.stale).toBe(0);
  });
});

describe('onEdgeAdded：工作量预算与降级（spec §5.4 / §7.3 路径数爆炸 → 回退）', () => {
  /** 四节点链 a→b→c→d：反向/正向展开都足够多，便于用小预算触发降级。 */
  function chainGraph(): GraphSpace {
    const graph = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id, { label: id });
    for (const [s, t] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ] as const) {
      graph.addEdge(edge(s, t));
    }
    return graph;
  }

  it('默认预算常量为 50_000', () => {
    expect(INCREMENTAL_WORK_BUDGET).toBe(50_000);
  });

  it('超预算时整索引降级为空、返回 []、不抛异常，且降级可观测', () => {
    const graph = chainGraph();
    const rule = makeRule({ lMin: 1, lMax: 4 });
    const index = materializeAll(graph, rule);
    expect(index.counters.total).toBeGreaterThan(0);

    const candidate = edge('d', 'a');
    graph.addEdge(candidate);

    let produced: PathEntry[] = [];
    expect(() => {
      produced = onEdgeAdded(candidate, rule, graph, index, { workBudget: 2 });
    }).not.toThrow();

    expect(produced).toEqual([]);
    expect(wasLastIncrementalDegraded()).toBe(true);
    // 降级 = 整索引为空（查询层随后的 fallback 走全量枚举）
    expect(index.hashIndex.size).toBe(0);
    expect(index.counters).toEqual({ total: 0, stale: 0 });
    expect(index.liveCount()).toBe(0);
    expect(index.startIndex.size).toBe(0);
    expect(index.endIndex.size).toBe(0);
    expect(index.edgeToPaths.size).toBe(0);
  });

  it('workBudget = 0 时第一次展开即降级（预算边界）', () => {
    const graph = chainGraph();
    const rule = makeRule({ lMin: 1, lMax: 4 });
    const index = materializeAll(graph, rule);
    const candidate = edge('d', 'a');
    graph.addEdge(candidate);

    expect(onEdgeAdded(candidate, rule, graph, index, { workBudget: 0 })).toEqual([]);
    expect(wasLastIncrementalDegraded()).toBe(true);
    expect(index.counters.total).toBe(0);
  });

  it('降级标记在每次调用开头重置：之后的小图正常增量不再置位', () => {
    const graph = chainGraph();
    const rule = makeRule({ lMin: 1, lMax: 4 });
    const degradedIndex = materializeAll(graph, rule);
    const overBudget = edge('d', 'a');
    graph.addEdge(overBudget);
    onEdgeAdded(overBudget, rule, graph, degradedIndex, { workBudget: 0 });
    expect(wasLastIncrementalDegraded()).toBe(true);

    // 另起一个不会超预算的小图
    const small = new GraphSpace();
    small.addNode('a', { label: 'a' });
    small.addNode('b', { label: 'b' });
    const smallRule = makeRule({ lMin: 0, lMax: 1 });
    const smallIndex = materializeAll(small, smallRule);
    const candidate = edge('a', 'b');
    small.addEdge(candidate);
    const produced = onEdgeAdded(candidate, smallRule, small, smallIndex);

    expect(produced.map((e) => e.nodes)).toEqual([['a', 'b']]);
    expect(wasLastIncrementalDegraded()).toBe(false);
    expect(smallIndex.liveCount()).toBe(liveHashes(materializeAll(small, smallRule)).length);
  });

  it('默认预算下小图不会降级，增量结果保持完整', () => {
    const graph = triangleGraphLike();
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = materializeAll(graph, rule);

    const candidate = edge('c', 'a');
    graph.addEdge(candidate);
    const produced = onEdgeAdded(candidate, rule, graph, index);

    expect(wasLastIncrementalDegraded()).toBe(false);
    expect(produced.length).toBeGreaterThan(0);
    expect(liveHashes(index)).toEqual(liveHashes(materializeAll(graph, rule)));
  });
});

/** a→b→c 三角基础图（无 c→a，留给用例自行追加）。 */
function triangleGraphLike(): GraphSpace {
  const graph = new GraphSpace();
  for (const id of ['a', 'b', 'c']) graph.addNode(id, { label: id });
  graph.addEdge(edge('a', 'b'));
  graph.addEdge(edge('b', 'c'));
  return graph;
}

/**
 * 直接播种 N 条**真实** PathEntry（索引只关心 nodes/hash/counters）。
 *
 * 阈值边界需要精确的分子分母（例如「10 条里 3 条失效」），从真实图上凑出恰好 0.3 太脆弱，
 * 因此这里用 makeEntry + index.add 构造可计数的条目；被删除的边对统一是 x→y。
 */
function seedIndexWithEdgePair(index: PathIndex, rule: PathRule, containing: number, total: number): void {
  for (let i = 0; i < containing; i++) {
    index.add(makeEntry(rule, ['n' + i, 'x', 'y'], 1));
  }
  for (let i = containing; i < total; i++) {
    index.add(makeEntry(rule, ['n' + i, 'p', 'q'], 1));
  }
}

describe('onEdgeRemovedDetailed：stale 阈值必须到达动作（XJ-04）', () => {
  it('默认阈值是 0.3，且旧入口 onEdgeRemoved 的 number 语义不变', () => {
    expect(DEFAULT_THETA_STALE).toBe(0.3);

    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = new PathIndex();
    seedIndexWithEdgePair(index, rule, 4, 10);

    const detailed = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);
    expect(detailed.newlyStale).toBe(4);
    expect(detailed.staleRatio).toBe(0.4);
    expect(detailed.needsRebuild).toBe(true);

    // 旧入口仍然返回 number，并且等于 detailed.newlyStale（幂等 ⇒ 第二次为 0）。
    const again = new PathIndex();
    seedIndexWithEdgePair(again, rule, 4, 10);
    expect(onEdgeRemoved(edge('x', 'y'), rule, again)).toBe(4);
    expect(onEdgeRemoved(edge('x', 'y'), rule, again)).toBe(0);
  });

  it('比例恰为 0.3 ⇒ needsRebuild === false（阈值是严格大于）', () => {
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = new PathIndex();
    seedIndexWithEdgePair(index, rule, 3, 10);

    const result = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);

    expect(index.counters).toEqual({ total: 10, stale: 3 });
    expect(result.staleRatio).toBe(0.3);
    expect(result.needsRebuild).toBe(false);
    expect(result.newlyStale).toBe(3);
  });

  it('略高于 0.3（3.1/10 不可构造，用 4/10 与 7/20=0.35）都要触发', () => {
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = new PathIndex();
    seedIndexWithEdgePair(index, rule, 7, 20);

    const result = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);

    expect(result.staleRatio).toBe(0.35);
    expect(result.needsRebuild).toBe(true);
  });

  it('total === 0 ⇒ staleRatio 0、needsRebuild false（不谎报 NaN）', () => {
    const rule = makeRule();
    const index = new PathIndex();
    expect(index.counters.total).toBe(0);

    const result = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);

    expect(result).toEqual({ newlyStale: 0, staleRatio: 0, needsRebuild: false });
    expect(Number.isNaN(result.staleRatio)).toBe(false);
  });

  it('分母是全量 counters（含已 stale），不是过滤后的 live 数', () => {
    const rule = makeRule({ lMin: 1, lMax: 2 });
    const index = new PathIndex();
    seedIndexWithEdgePair(index, rule, 10, 10);

    // 第一轮把 10/10 全部置 stale
    const first = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);
    expect(first.newlyStale).toBe(10);
    expect(first.staleRatio).toBe(1);
    expect(first.needsRebuild).toBe(true);

    // 第二轮幂等（不新增 stale）：如果分母误用 live 数（此时为 0），比例会变成 0/0 ⇒ 0，
    // 阈值立刻失效。这里必须仍然是 100%。
    const second = onEdgeRemovedDetailed(edge('x', 'y'), rule, index);
    expect(second.newlyStale).toBe(0);
    expect(second.staleRatio).toBe(1);
    expect(second.needsRebuild).toBe(true);
    expect(index.liveCount()).toBe(0);
  });

  it('thetaStale 可覆盖：同一比例在不同阈值下结论相反', () => {
    const rule = makeRule({ lMin: 1, lMax: 2 });

    const strictIndex = new PathIndex();
    seedIndexWithEdgePair(strictIndex, rule, 4, 10);
    const strict = onEdgeRemovedDetailed(edge('x', 'y'), rule, strictIndex, { thetaStale: 0.2 });
    expect(strict.staleRatio).toBe(0.4);
    expect(strict.needsRebuild).toBe(true);

    const looseIndex = new PathIndex();
    seedIndexWithEdgePair(looseIndex, rule, 4, 10);
    const loose = onEdgeRemovedDetailed(edge('x', 'y'), rule, looseIndex, { thetaStale: 0.5 });
    expect(loose.staleRatio).toBe(0.4);
    expect(loose.needsRebuild).toBe(false);

    // 非法阈值（NaN）回落到默认值，而不是让比较永远为 false。
    const fallbackIndex = new PathIndex();
    seedIndexWithEdgePair(fallbackIndex, rule, 4, 10);
    const fallback = onEdgeRemovedDetailed(edge('x', 'y'), rule, fallbackIndex, { thetaStale: Number.NaN });
    expect(fallback.needsRebuild).toBe(true);
  });

  it('边类型不在规则里时 newlyStale 为 0，但比例仍如实反映索引状态', () => {
    const rule = makeRule({ lMin: 1, lMax: 2, edgeTypes: new Set(['call']) });
    const index = new PathIndex();
    seedIndexWithEdgePair(index, rule, 4, 10);

    const other = onEdgeRemovedDetailed(edge('x', 'y', 'data'), rule, index);
    expect(other.newlyStale).toBe(0);
    expect(other.staleRatio).toBe(0);

    // 先把索引弄脏，再用无关类型的边问一次：比例照实报（调用方问的是「索引还能不能用」）。
    onEdgeRemovedDetailed(edge('x', 'y'), rule, index);
    const after = onEdgeRemovedDetailed(edge('x', 'y', 'data'), rule, index);
    expect(after.newlyStale).toBe(0);
    expect(after.staleRatio).toBe(0.4);
    expect(after.needsRebuild).toBe(true);
  });
});

