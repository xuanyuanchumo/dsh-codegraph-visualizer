/**
 * RuleRegistry：注册校验、版本热替换、废弃与 GC、按名隔离的惰性索引。
 */
import { describe, it, expect } from 'vitest';
import { GraphSpace } from '../../../src/xuanji/core/graph-space.ts';
import type { PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { RuleRegistry } from '../../../src/xuanji/registry/rule-registry.ts';
import { enumerate } from '../../../src/xuanji/query/query-engine.ts';

const KNOWN = new Set(['r', 'x']);

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

function buildGraph(nodes: readonly string[], edges: ReadonlyArray<readonly [string, string, string]>): GraphSpace {
  const graph = new GraphSpace();
  for (const id of nodes) graph.addNode(id, { label: id });
  for (const [source, target, type] of edges) {
    graph.addEdge({ id: source + '->' + target + '->' + type, source, target, type });
  }
  return graph;
}

describe('RuleRegistry：注册与校验', () => {
  it('合法规则注册成功，get 返回同一对象', () => {
    const registry = new RuleRegistry(KNOWN);
    const rule = ruleOf();
    const validation = registry.register(rule);
    expect(validation.errors).toEqual([]);
    expect(registry.get('r')).toBe(rule);
    expect(registry.getVersion('r')).toBe(1);
  });

  it('未知边类型 → 校验失败且不注册', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(ruleOf({ edgeTypes: new Set(['nope']) }));
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(registry.get('r')).toBeUndefined();
  });

  it('非法版本号 → 不注册', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(ruleOf({ version: 0 }));
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(registry.get('r')).toBeUndefined();
  });

  it('lMax < lMin → 不注册', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(ruleOf({ lMin: 3, lMax: 2 }));
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(registry.get('r')).toBeUndefined();
  });

  it('无界 lMax 且非 simple → 不注册（路径集合无限）', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(
      ruleOf({ lMax: Number.POSITIVE_INFINITY, simple: false }),
    );
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(registry.get('r')).toBeUndefined();
  });

  it('闭合规则要求 lMin ≥ 1 → lMin=0 不注册', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(ruleOf({ closed: true, lMin: 0, lMax: 2 }));
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(registry.get('r')).toBeUndefined();
  });

  it('warnings 被记录：空 edgeTypes 告警随返回值并可通过 warningsFor 取回', () => {
    const registry = new RuleRegistry(KNOWN);
    const validation = registry.register(ruleOf({ edgeTypes: new Set() }));
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.length).toBeGreaterThan(0);
    expect(registry.warningsFor('r')).toEqual(validation.warnings);
    expect(registry.get('r')).toBeDefined();
  });

  it('warningsFor 对未注册名字返回空数组', () => {
    const registry = new RuleRegistry(KNOWN);
    expect(registry.warningsFor('missing')).toEqual([]);
  });
});

describe('RuleRegistry：版本热替换', () => {
  it('同名 register 视为热替换：get 只返回当前版本', () => {
    const registry = new RuleRegistry(KNOWN);
    const v1 = ruleOf({ version: 1 });
    const v2 = ruleOf({ version: 2 });
    registry.register(v1);
    const validation = registry.register(v2);
    expect(registry.get('r')).toBe(v2);
    expect(registry.getVersion('r')).toBe(2);
    expect(registry.list()).toEqual([v2]);
    expect(validation.warnings.some((warning) => warning.includes('deprecated'))).toBe(true);
  });

  it('replace 返回被顶替的旧版本', () => {
    const registry = new RuleRegistry(KNOWN);
    const v1 = ruleOf({ version: 1 });
    const v2 = ruleOf({ version: 2 });
    registry.register(v1);
    expect(registry.replace(v2)).toEqual({ previous: v1 });
    expect(registry.get('r')).toBe(v2);
  });

  it('replace 未知名字：previous 为 undefined 并完成注册', () => {
    const registry = new RuleRegistry(KNOWN);
    const rule = ruleOf({ name: 'fresh' });
    expect(registry.replace(rule)).toEqual({ previous: undefined });
    expect(registry.get('fresh')).toBe(rule);
  });

  it('list 按注册顺序返回当前版本，且不含已废弃名字', () => {
    const registry = new RuleRegistry(KNOWN);
    const a = ruleOf({ name: 'a' });
    const b = ruleOf({ name: 'b' });
    registry.register(a);
    registry.register(b);
    expect(registry.list()).toEqual([a, b]);
    registry.deprecate('a');
    expect(registry.list()).toEqual([b]);
  });
});

describe('RuleRegistry：废弃与 GC', () => {
  it('deprecate 后 get 为 undefined、isDeprecated 为 true', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf());
    expect(registry.deprecate('r')).toBe(true);
    expect(registry.get('r')).toBeUndefined();
    expect(registry.isDeprecated('r')).toBe(true);
  });

  it('deprecate 幂等：重复调用与未知名字都返回 false', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf());
    expect(registry.deprecate('r')).toBe(true);
    expect(registry.deprecate('r')).toBe(false);
    expect(registry.deprecate('missing')).toBe(false);
  });

  it('废弃后重新 register 同名规则会复活（不再是 deprecated）', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf({ version: 1 }));
    registry.deprecate('r');
    const revived = ruleOf({ version: 3 });
    registry.register(revived);
    expect(registry.isDeprecated('r')).toBe(false);
    expect(registry.get('r')).toBe(revived);
  });

  it('gc 回收无 live 物化条目的已废弃规则名', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf());
    registry.deprecate('r');
    expect(registry.gc()).toEqual(['r']);
    expect(registry.get('r')).toBeUndefined();
    expect(registry.isDeprecated('r')).toBe(false);
    expect(registry.index('r')).toBeUndefined();
  });

  it('gc 保留仍有 live 物化条目的已废弃规则，索引清空后才回收', () => {
    const graph = buildGraph(['a', 'b'], [['a', 'b', 'r']]);
    const registry = new RuleRegistry(KNOWN);
    const rule = ruleOf({ lMin: 1, lMax: 1, simple: true });
    registry.register(rule);
    const index = registry.index('r')!;
    enumerate(graph, rule, ['a'], index);
    expect(index.liveCount()).toBe(1);

    registry.deprecate('r');
    expect(registry.gc()).toEqual([]);

    index.markStaleForNodes(['a']);
    expect(index.liveCount()).toBe(0);
    expect(registry.gc()).toEqual(['r']);
  });

  it('没有已废弃规则时 gc 返回空数组', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf());
    expect(registry.gc()).toEqual([]);
  });
});

describe('RuleRegistry：按名隔离的惰性索引', () => {
  it('index(name) 惰性创建且重复调用返回同一实例', () => {
    const registry = new RuleRegistry(KNOWN);
    registry.register(ruleOf());
    const first = registry.index('r');
    expect(first).toBeInstanceOf(Object);
    expect(registry.index('r')).toBe(first);
  });

  it('index(未注册名字) 返回 undefined', () => {
    const registry = new RuleRegistry(KNOWN);
    expect(registry.index('missing')).toBeUndefined();
  });

  it('indexes 按名隔离：一条规则的条目不出现在另一条规则的索引里', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'x'],
    ]);
    const registry = new RuleRegistry(KNOWN);
    const ruleR = ruleOf({ name: 'r', edgeTypes: new Set(['r']), lMin: 1, lMax: 2, simple: true });
    const ruleX = ruleOf({ name: 'x', edgeTypes: new Set(['x']), lMin: 1, lMax: 1, simple: true });
    registry.register(ruleR);
    registry.register(ruleX);
    const indexR = registry.index('r')!;
    const indexX = registry.index('x')!;
    expect(indexR).not.toBe(indexX);

    enumerate(graph, ruleR, ['a'], indexR);
    expect(indexR.liveCount()).toBeGreaterThan(0);
    expect(indexX.liveCount()).toBe(0);
  });

  it('替换一条规则只丢弃它自己的索引，其它规则索引保持完好', () => {
    const graph = buildGraph(['a', 'b', 'c'], [
      ['a', 'b', 'r'],
      ['b', 'c', 'x'],
    ]);
    const registry = new RuleRegistry(KNOWN);
    const ruleR = ruleOf({ name: 'r', edgeTypes: new Set(['r']), version: 1, lMin: 1, lMax: 2, simple: true });
    const ruleX = ruleOf({ name: 'x', edgeTypes: new Set(['x']), lMin: 1, lMax: 1, simple: true });
    registry.register(ruleR);
    registry.register(ruleX);
    const indexX = registry.index('x')!;
    enumerate(graph, ruleR, ['a'], registry.index('r')!);
    enumerate(graph, ruleX, ['b'], indexX);
    const liveX = indexX.liveCount();

    registry.replace(ruleOf({ ...ruleR, version: 2 }));
    expect(registry.index('r')!.liveCount()).toBe(0);
    expect(registry.index('x')!.liveCount()).toBe(liveX);
  });
});
