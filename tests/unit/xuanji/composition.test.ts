/**
 * 规则组合代数（spec §2.4）的独立 oracle 测试。
 *
 * 组合的语义是**集合运算**：
 *   legal(R1 ∪ R2) = legal(R1) ∪ legal(R2)
 *   legal(R1 ∩ R2) = legal(R1) ∩ legal(R2)
 *   legal(R1 · R2) = { p1 与 p2 在共享端点拼接 | p1 ∈ legal(R1), p2 ∈ legal(R2) }
 *   legal(R1 \ R2) = legal(R1) \ legal(R2)
 *
 * oracle 在文件内**独立**枚举（全部 walk 上界 lMax，逐条 isLegalPath 判定），
 * 不使用被测的 enumerate——否则「组合实现」与「组合 oracle」共享同一个 bug。
 *
 * 组合最容易出的两类错误：
 * 1) 剪枝谓词过严 ⇒ 组合结果**漏掉**成员（完备性破坏）；
 * 2) 终判缺失 ⇒ 组合结果**多出**成员（可靠性破坏）。
 * 两者都表现为集合不等，所以断言用集合相等而不是数量相等。
 */
import { describe, expect, it } from 'vitest';
import { GraphSpace, type NodeId, type XJEdge } from '../../../src/xuanji/core/graph-space.ts';
import {
  concatRules,
  differenceRules,
  intersectRules,
  isLegalPath,
  repeatRule,
  unionRules,
  type PathRule,
} from '../../../src/xuanji/core/path-rule.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import { enumerate } from '../../../src/xuanji/query/query-engine.ts';

const NODES = ['a', 'b', 'c', 'd'] as const;

function buildGraph(edgeSpecs: Array<[string, string, string]>): GraphSpace {
  const graph = new GraphSpace();
  for (const id of NODES) graph.addNode(id, { label: id, role: id === 'a' ? 'entry' : 'mid' });
  for (const [source, target, type] of edgeSpecs) {
    graph.addEdge({ id: `${source}->${target}->${type}`, source, target, type } as XJEdge);
  }
  return graph;
}

/** 独立 oracle：枚举所有节点序列（walk），用 isLegalPath 精确筛选。 */
function bruteLegalPaths(graph: GraphSpace, rule: PathRule): string[] {
  const maxEdges = Number.isFinite(rule.lMax) ? rule.lMax : graph.nodeCount;
  const ids = [...graph.nodeIds()];
  const found = new Set<string>();
  const path: NodeId[] = [];

  const walk = (edges: number): void => {
    if (edges >= rule.lMin && isLegalPath(rule, path, graph)) found.add(path.join('>'));
    if (edges >= maxEdges) return;
    const last = path[path.length - 1]!;
    for (const next of graph.outNeighbors(last, rule.edgeTypes)) {
      path.push(next);
      walk(edges + 1);
      path.pop();
    }
  };

  for (const start of ids) {
    path.length = 0;
    path.push(start);
    walk(0);
  }
  return [...found].sort();
}

function enginePaths(graph: GraphSpace, rule: PathRule): string[] {
  const index = new PathIndex();
  const entries = enumerate(graph, rule, [...graph.nodeIds()], index, { maxPaths: 100_000 });
  return entries
    .map((e) => e.nodes.join('>'))
    .sort();
}

function expectSameSet(actual: string[], expected: string[], label: string): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((p) => !actualSet.has(p));
  const extra = [...actualSet].filter((p) => !expectedSet.has(p));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${label}: set mismatch\nmissing=${missing.join(',')}\nextra=${extra.join(',')}`);
  }
}

function baseRule(name: string, overrides: Partial<PathRule> = {}): PathRule {
  return {
    name,
    version: 1,
    start: () => true,
    edgeTypes: new Set(['call']),
    lMin: 1,
    lMax: 3,
    normalize: 'none',
    ...overrides,
  };
}

const GRAPH = buildGraph([
  ['a', 'b', 'call'],
  ['b', 'c', 'call'],
  ['a', 'c', 'call'],
  ['c', 'a', 'call'],
  ['c', 'd', 'ref'],
]);

describe('规则组合代数：并 ∪', () => {
  it('两条同图规则：legal(R1∪R2) = legal(R1) ∪ legal(R2)', () => {
    const r1 = baseRule('r1', { edgeTypes: new Set(['call']), lMax: 2 });
    const r2 = baseRule('r2', { edgeTypes: new Set(['ref']), lMax: 2 });
    const union = unionRules(r1, r2);
    const expected = [...new Set([...bruteLegalPaths(GRAPH, r1), ...bruteLegalPaths(GRAPH, r2)])].sort();
    expectSameSet(enginePaths(GRAPH, union), expected, 'union');
  });

  it('起点谓词析取：只从 entry 起的规则与全起点规则并集', () => {
    const fromEntry = baseRule('entry', { start: (_n, attrs) => attrs.role === 'entry', lMax: 2 });
    const all = baseRule('all', { lMax: 1 });
    const union = unionRules(fromEntry, all);
    const expected = [...new Set([...bruteLegalPaths(GRAPH, fromEntry), ...bruteLegalPaths(GRAPH, all)])].sort();
    expectSameSet(enginePaths(GRAPH, union), expected, 'union start');
  });

  it('两条 simple 规则、其中一条闭合：并集必须仍能走完闭环', () => {
    const closedSimple = baseRule('closed-simple', {
      closed: true,
      simple: true,
      lMin: 1,
      lMax: 3,
      edgeTypes: new Set(['call']),
    });
    const openSimple = baseRule('open-simple', { simple: true, lMin: 1, lMax: 1 });
    const union = unionRules(closedSimple, openSimple);
    const expected = [
      ...new Set([...bruteLegalPaths(GRAPH, closedSimple), ...bruteLegalPaths(GRAPH, openSimple)]),
    ].sort();
    expectSameSet(enginePaths(GRAPH, union), expected, 'union simple+closed');
  });

  it('闭合规则与开放规则并集：闭环路径不能被剪枝吞掉', () => {
    const closed = baseRule('closed', {
      closed: true,
      simple: true,
      lMin: 1,
      lMax: 3,
      edgeTypes: new Set(['call']),
    });
    const open = baseRule('open', { lMin: 0, lMax: 1, edgeTypes: new Set(['call']) });
    const union = unionRules(closed, open);
    const expected = [...new Set([...bruteLegalPaths(GRAPH, closed), ...bruteLegalPaths(GRAPH, open)])].sort();
    expectSameSet(enginePaths(GRAPH, union), expected, 'union closed+open');
  });
});

describe('规则组合代数：交 ∩', () => {
  it('legal(R1∩R2) = legal(R1) ∩ legal(R2)', () => {
    const r1 = baseRule('r1', { lMax: 3 });
    const r2 = baseRule('r2', { start: (_n, attrs) => attrs.role !== 'entry', lMax: 3 });
    const intersect = intersectRules(r1, r2);
    const set1 = new Set(bruteLegalPaths(GRAPH, r1));
    const expected = bruteLegalPaths(GRAPH, r2).filter((p) => set1.has(p));
    expectSameSet(enginePaths(GRAPH, intersect), expected, 'intersect');
  });

  it('长度区间取交：lMax 取较小者', () => {
    const r1 = baseRule('r1', { lMax: 3 });
    const r2 = baseRule('r2', { lMax: 2 });
    const intersect = intersectRules(r1, r2);
    expect(intersect.lMin).toBe(1);
    expect(intersect.lMax).toBe(2);
    const expected = bruteLegalPaths(GRAPH, r1).filter((p) => p.split('>').length - 1 <= 2);
    expectSameSet(enginePaths(GRAPH, intersect), expected, 'intersect length');
  });

  it('长度区间不相交时拒绝组合', () => {
    const r1 = baseRule('r1', { lMin: 3, lMax: 3 });
    const r2 = baseRule('r2', { lMin: 1, lMax: 2 });
    expect(() => intersectRules(r1, r2)).toThrow(/length intervals are disjoint/);
  });
});

describe('规则组合代数：拼接 ·', () => {
  it('legal(R1·R2) = 在共享端点拼接的路径集合', () => {
    const r1 = baseRule('r1', { edgeTypes: new Set(['call']), lMin: 1, lMax: 1 });
    const r2 = baseRule('r2', { edgeTypes: new Set(['call', 'ref']), lMin: 1, lMax: 1 });
    const concat = concatRules(r1, r2);

    const heads = bruteLegalPaths(GRAPH, r1);
    const tails = new Set(bruteLegalPaths(GRAPH, r2));
    const expected = new Set<string>();
    for (const head of heads) {
      const headNodes = head.split('>');
      const joint = headNodes[headNodes.length - 1]!;
      const headPrefixed = headNodes.slice(0, -1).join('>');
      for (const tail of tails) {
        const tailNodes = tail.split('>');
        if (tailNodes[0] !== joint) continue;
        const joined = [...headNodes.slice(0, -1), ...tailNodes].join('>');
        // 与实现同源的精确定义：两段各自合法即可拼接
        expect(headPrefixed.length).toBeGreaterThanOrEqual(0);
        expected.add(joined);
      }
    }
    expectSameSet(enginePaths(GRAPH, concat), [...expected].sort(), 'concat');
  });

  it('拼接允许跨越边界的节点重复（简单性按段判定）', () => {
    // a→b、b→a：两段各自是简单路径，拼起来 a>b>a 在边界重复 a。
    const graph = buildGraph([
      ['a', 'b', 'call'],
      ['b', 'a', 'call'],
    ]);
    const r1 = baseRule('r1', { simple: true, lMin: 1, lMax: 1 });
    const r2 = baseRule('r2', { simple: true, lMin: 1, lMax: 1 });
    const concat = concatRules(r1, r2);
    const paths = enginePaths(graph, concat);
    expect(paths).toContain('a>b>a');
    expect(paths).toContain('b>a>b');
  });

  it('拼接后的长度区间是两段相加', () => {
    const r1 = baseRule('r1', { lMin: 1, lMax: 1 });
    const r2 = baseRule('r2', { lMin: 1, lMax: 2 });
    const concat = concatRules(r1, r2);
    expect(concat.lMin).toBe(2);
    expect(concat.lMax).toBe(3);
  });

  it('拼接不会因为逐节点谓词取交而漏掉只在前段/后段合法的路径', () => {
    // 桥接图：a(entry) → b(bridge) → c(mid)。b 同时满足两侧谓词，a 只满足 r1，c 只满足 r2。
    // 若 concat 把两个 nodeConstraint 取交，a 会被 r2 剪掉、c 会被 r1 剪掉，结果为空（错误）。
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a', role: 'entry' });
    graph.addNode('b', { label: 'b', role: 'bridge' });
    graph.addNode('c', { label: 'c', role: 'mid' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', type: 'call' });
    graph.addEdge({ id: 'e2', source: 'b', target: 'c', type: 'call' });

    const r1 = baseRule('r1', {
      nodeConstraint: (_n, attrs) => attrs.role === 'entry' || attrs.role === 'bridge',
      lMin: 1,
      lMax: 2,
    });
    const r2 = baseRule('r2', {
      nodeConstraint: (_n, attrs) => attrs.role === 'mid' || attrs.role === 'bridge',
      lMin: 1,
      lMax: 2,
    });
    const concat = concatRules(r1, r2);
    const paths = enginePaths(graph, concat);
    expect(paths).toContain('a>b>c');
  });
});

describe('规则组合代数：迭代与差集', () => {
  it('重复两次等于两次拼接', () => {
    const step = baseRule('step', { lMin: 1, lMax: 1 });
    const twice = repeatRule(step, 2);
    const manual = concatRules(step, step);
    expect(twice.lMin).toBe(manual.lMin);
    expect(twice.lMax).toBe(manual.lMax);
    expectSameSet(enginePaths(GRAPH, twice), enginePaths(GRAPH, manual), 'repeat vs concat');
  });

  it('差集 = legal(R1) 中不属于 legal(R2) 的路径', () => {
    const r1 = baseRule('r1', { lMin: 1, lMax: 2 });
    const r2 = baseRule('r2', { edgeTypes: new Set(['ref']), lMin: 1, lMax: 2 });
    const diff = differenceRules(r1, r2);
    const set2 = new Set(bruteLegalPaths(GRAPH, r2));
    const expected = bruteLegalPaths(GRAPH, r1).filter((p) => !set2.has(p));
    expectSameSet(enginePaths(GRAPH, diff), expected, 'difference');
  });
});

/** 固定种子 LCG：组合代数的随机属性测试必须可复现。 */
class Lcg {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 4294967296; }
  int(bound: number): number { return Math.floor(this.next() * bound); }
  pick<T>(items: readonly T[]): T { return items[this.int(items.length)]!; }
  bool(p = 0.5): boolean { return this.next() < p; }
}

function randomGraph(rng: Lcg): GraphSpace {
  const graph = new GraphSpace();
  const ids = ['a', 'b', 'c', 'd'].slice(0, 3 + rng.int(2));
  for (const id of ids) {
    graph.addNode(id, { label: id, role: rng.bool(0.4) ? 'entry' : 'mid', tags: rng.bool(0.5) ? ['ok'] : [] });
  }
  const types = rng.bool(0.4) ? ['call', 'ref'] : ['call'];
  const edgeCount = rng.int(ids.length + 3);
  for (let i = 0; i < edgeCount; i++) {
    const s = rng.pick(ids);
    const t = rng.pick(ids);
    const type = rng.pick(types);
    graph.addEdge({ id: `${s}->${t}->${type}`, source: s, target: t, type });
  }
  return graph;
}

function randomRule(rng: Lcg, name: string): PathRule {
  const rawLMin = rng.int(3);
  const lMax = rawLMin + rng.int(3);
  const simple = rng.bool(0.5);
  const closed = rng.bool(0.3);
  return {
    name,
    version: 1,
    start: rng.bool(0.5) ? () => true : (_n, attrs) => attrs.role === 'entry',
    edgeTypes: new Set(rng.bool(0.5) ? ['call'] : ['call', 'ref']),
    lMin: closed ? Math.max(1, rawLMin) : rawLMin,
    lMax,
    ...(closed ? { closed: true } : {}),
    ...(simple ? { simple: true } : {}),
    ...(rng.bool(0.3)
      ? { nodeConstraint: (_n: NodeId, attrs: { tags?: readonly string[] }) => (attrs.tags ?? []).includes('ok') }
      : {}),
    normalize: 'none',
  };
}

function splitProduct(graph: GraphSpace, r1: PathRule, r2: PathRule): string[] {
  const heads = bruteLegalPaths(graph, r1);
  const tails = bruteLegalPaths(graph, r2);
  const tailsByHead = new Map<string, string[]>();
  for (const tail of tails) {
    const first = tail.split('>')[0]!;
    const list = tailsByHead.get(first) ?? [];
    list.push(tail);
    tailsByHead.set(first, list);
  }
  const result = new Set<string>();
  for (const head of heads) {
    const nodes = head.split('>');
    const joint = nodes[nodes.length - 1]!;
    for (const tail of tailsByHead.get(joint) ?? []) {
      result.add([...nodes.slice(0, -1), ...tail.split('>')].join('>'));
    }
  }
  return [...result].sort();
}

describe('组合代数随机属性测试（200 组）', () => {
  it('并/交/差/拼接与独立 oracle 的集合运算一致', () => {
    const rng = new Lcg(0xc0ffee);
    let compared = 0;
    let nonEmpty = 0;

    for (let attempt = 0; attempt < 4000 && compared < 200; attempt++) {
      const graph = randomGraph(rng);
      const r1 = randomRule(rng, 'r1');
      const r2 = randomRule(rng, 'r2');

      const union = unionRules(r1, r2);
      const unionExpected = [...new Set([...bruteLegalPaths(graph, r1), ...bruteLegalPaths(graph, r2)])].sort();
      expectSameSet(enginePaths(graph, union), unionExpected, `random union #${compared}`);

      const lMin = Math.max(r1.lMin, r2.lMin);
      const lMax = Math.min(r1.lMax, r2.lMax);
      if (lMin <= lMax) {
        const intersect = intersectRules(r1, r2);
        const set1 = new Set(bruteLegalPaths(graph, r1));
        const expected = bruteLegalPaths(graph, r2).filter((p) => set1.has(p));
        expectSameSet(enginePaths(graph, intersect), expected, `random intersect #${compared}`);
      }

      const difference = differenceRules(r1, r2);
      const excluded = new Set(bruteLegalPaths(graph, r2));
      const diffExpected = bruteLegalPaths(graph, r1).filter((p) => !excluded.has(p));
      expectSameSet(enginePaths(graph, difference), diffExpected, `random difference #${compared}`);

      const concat = concatRules(r1, r2);
      expectSameSet(enginePaths(graph, concat), splitProduct(graph, r1, r2), `random concat #${compared}`);

      if (unionExpected.length > 0) nonEmpty++;
      compared++;
    }

    expect(compared).toBe(200);
    expect(nonEmpty).toBeGreaterThan(60);
  });
});
