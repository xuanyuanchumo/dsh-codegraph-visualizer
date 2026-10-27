/**
 * InvariantChecker I1–I5：图空间与物化索引之间的一致性体检。
 *
 * 每个不变量至少覆盖：达标、不达标、退化输入（空索引 / 无角色 / 单一类型）。
 */
import { describe, it, expect } from 'vitest';
import { GraphSpace } from '../../../src/xuanji/core/graph-space.ts';
import type { NodeAttrs } from '../../../src/xuanji/core/graph-space.ts';
import type { PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { makeEntry } from '../../../src/xuanji/core/path-entry.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import { enumerate } from '../../../src/xuanji/query/query-engine.ts';
import { InvariantChecker } from '../../../src/xuanji/ops/invariants.ts';

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

function starGraph(count: number): GraphSpace {
  const nodes: string[] = ['a'];
  const edges: Array<readonly [string, string, string]> = [];
  for (let i = 0; i < count; i++) {
    nodes.push('x' + i);
    edges.push(['a', 'x' + i, 'r']);
  }
  return buildGraph(nodes, edges);
}

function healthyFixture(): { graph: GraphSpace; index: PathIndex; rule: PathRule } {
  const graph = buildGraph(
    [
      { id: 'a', role: 'entry' },
      { id: 'b', role: 'mid' },
      { id: 'c', role: 'end' },
    ],
    [
      ['a', 'b', 'r'],
      ['b', 'c', 'r'],
    ],
  );
  const rule = ruleOf({ lMin: 1, lMax: 2, simple: true });
  const index = new PathIndex();
  enumerate(graph, rule, ['a'], index);
  return { graph, index, rule };
}

describe('InvariantChecker：checkAll 与 I1', () => {
  it('健康图：五项不变量全部达标且按 I1→I5 顺序返回', () => {
    const { graph, index, rule } = healthyFixture();
    const results = new InvariantChecker().checkAll(index, rule, graph);
    expect(results.map((result) => result.id)).toEqual(['I1', 'I2', 'I3', 'I4', 'I5']);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.every((result) => result.violations === 0)).toBe(true);
  });

  it('I1：未被任何 live 路径覆盖的边类型被报告为违规', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ edgeTypes: new Set(['r', 'x']), lMin: 1, lMax: 1, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI1(index, rule, graph);
    expect(result.id).toBe('I1');
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.detail).toContain('x');
  });

  it('I1：多类型路径可同时覆盖多种边类型', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'x'],
    ]);
    const rule = ruleOf({ edgeTypes: new Set(['r', 'x']), lMin: 1, lMax: 2, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI1(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });

  it('I1：空索引时空 edgeTypes 不谎报失败；有类型但无路径则失败', () => {
    const graph = buildGraph(['a'], []);
    const index = new PathIndex();
    expect(new InvariantChecker().checkI1(index, ruleOf({ edgeTypes: new Set() }), graph).ok).toBe(true);
    const withType = new InvariantChecker().checkI1(index, ruleOf({ edgeTypes: new Set(['r']) }), graph);
    expect(withType.ok).toBe(false);
    expect(withType.violations).toBe(1);
  });
});

describe('InvariantChecker：I2 角色覆盖', () => {
  it('I2：图中每种角色都被 live 路径覆盖时达标', () => {
    const { graph, index, rule } = healthyFixture();
    const result = new InvariantChecker().checkI2(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
    expect(result.detail).toContain('3/3');
  });

  it('I2：无角色声明的图 vacuously 达标', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI2(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('vacuously');
  });

  it('I2：未被覆盖的角色被计为违规', () => {
    const graph = buildGraph(
      [
        { id: 'a', role: 'entry' },
        { id: 'b', role: 'inner' },
        { id: 'z', role: 'orphan' },
      ],
      [['a', 'b', 'r']],
    );
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI2(index, rule, graph);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.detail).toContain('orphan');
  });

  it('I2：无 role 时回退到 tags[0] 作为角色', () => {
    const graph = buildGraph(
      [
        { id: 'a', tags: ['entry'] },
        { id: 'b', tags: ['inner'] },
      ],
      [['a', 'b', 'r']],
    );
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI2(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('2/2');
  });
});

describe('InvariantChecker：I3 深度一致性', () => {
  function depthFixture(): { graph: GraphSpace; index: PathIndex; rule: PathRule } {
    const graph = buildGraph(['a', 'b', 'c', 'd', 'e', 'f'], [
      ['a', 'b', 'r'],
      ['c', 'd', 'x'],
      ['d', 'e', 'x'],
      ['e', 'f', 'x'],
    ]);
    const rule = ruleOf({ edgeTypes: new Set(['r', 'x']), lMin: 1, lMax: 3, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a', 'c'], index);
    return { graph, index, rule };
  }

  it('I3：默认阈值下不同类型平均长度极差达标', () => {
    const { graph, index, rule } = depthFixture();
    const result = new InvariantChecker().checkI3(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('r=1.00');
    expect(result.detail).toContain('x=2.00');
  });

  it('I3：thetaDepth 收紧到 0.5 后极差违规', () => {
    const { graph, index, rule } = depthFixture();
    const result = new InvariantChecker({ thetaDepth: 0.5 }).checkI3(index, rule, graph);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.detail).toContain('spread=1.00');
  });

  it('I3：少于两类边时极差为 0，达标', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    const result = new InvariantChecker().checkI3(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });
});

describe('InvariantChecker：I4 stale 比例', () => {
  it('I4：total=0 视为比率 0，达标', () => {
    const result = new InvariantChecker().checkI4(new PathIndex());
    expect(result.id).toBe('I4');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('0/0');
  });

  it('I4：无 stale 条目时达标', () => {
    const graph = starGraph(3);
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    expect(new InvariantChecker().checkI4(index).ok).toBe(true);
  });

  it('I4：比例超过 thetaStale 时违规，violations 为 stale 条数', () => {
    const graph = starGraph(10);
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    index.markStaleForNodes(['x0', 'x1', 'x2', 'x3']);
    const result = new InvariantChecker().checkI4(index);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(4);
  });

  it('I4：比例恰为 0.3 时达标（阈值是 ≤）', () => {
    const graph = starGraph(10);
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    index.markStaleForNodes(['x0', 'x1', 'x2']);
    expect(index.counters.stale / index.counters.total).toBeCloseTo(0.3);
    expect(new InvariantChecker().checkI4(index).ok).toBe(true);
  });

  it('I4：自定义 thetaStale=1 时即使比例 0.4 也达标', () => {
    const graph = starGraph(10);
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    index.markStaleForNodes(['x0', 'x1', 'x2', 'x3']);
    expect(new InvariantChecker({ thetaStale: 1 }).checkI4(index).ok).toBe(true);
  });
});

describe('InvariantChecker：I5 抽样一致性', () => {
  it('I5：健康索引抽样全部一致', () => {
    const { graph, index, rule } = healthyFixture();
    const result = new InvariantChecker().checkI5(index, rule, graph);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
    expect(result.detail).toContain('sampled');
  });

  it('I5：条目相邻边被删除后被检出（版本仍 ≤ 图版本）', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    graph.removeEdge({ id: 'a->b->r', source: 'a', target: 'b', type: 'r' });
    const result = new InvariantChecker().checkI5(index, rule, graph);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.detail).toContain('missing edge');
  });

  it('I5：条目版本高于图版本被检出', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    index.add(makeEntry(rule, ['a', 'b'], graph.version + 5));
    const result = new InvariantChecker().checkI5(index, rule, graph);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.detail).toContain('version');
  });

  it('I5：用 rule.edgeTypes 检查（换成其它类型后同端边不再算存在）', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const rule = ruleOf({ lMin: 1, lMax: 1 });
    const index = new PathIndex();
    enumerate(graph, rule, ['a'], index);
    graph.removeEdge({ id: 'a->b->r', source: 'a', target: 'b', type: 'r' });
    graph.addEdge({ id: 'a->b->x', source: 'a', target: 'b', type: 'x' });
    const result = new InvariantChecker().checkI5(index, rule, graph);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
  });
});
