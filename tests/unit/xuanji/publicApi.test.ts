/**
 * 公共 API 表面测试：src/xuanji/index.ts 必须逐个导出契约里列出的符号。
 *
 * 为什么逐符号断言：漏一个导出在运行时是 undefined，调用点报错一行，
 * 而类型检查只覆盖「import 了却没用」的文件——只有把符号表钉死才能防止漏导出。
 * 同时用「与源模块引用相等」证明聚合层是 re-export，不是复制实现。
 */
import { describe, it, expect } from 'vitest';
import * as api from '../../../src/xuanji/index.ts';
import { PathIndex as SourcePathIndex } from '../../../src/xuanji/index/path-index.ts';
import { enumerate as sourceEnumerate } from '../../../src/xuanji/query/query-engine.ts';
import { RuleRegistry as SourceRuleRegistry } from '../../../src/xuanji/registry/rule-registry.ts';
import type {
  ChangeEvent,
  EdgeId,
  EdgeType,
  EndPredicate,
  EnumerateOptions,
  HashPart,
  IndexCounters,
  InvariantResult,
  InvariantThresholds,
  NfaCompileResult,
  NodeAttrs,
  NodeId,
  NodePredicate,
  NormalizeStrategy,
  OutputMapper,
  PathEntry,
  PathPredicate,
  PathRule,
  RuleValidation,
  StartPredicate,
  XJEdge,
} from '../../../src/xuanji/index.ts';

/** 编译期表面：任一类型没从 index.ts 导出，本文件就无法通过类型检查。 */
type TypeSurface = [
  NodeId,
  EdgeId,
  EdgeType,
  NodeAttrs,
  XJEdge,
  ChangeEvent,
  StartPredicate,
  NodePredicate,
  EndPredicate,
  PathPredicate,
  OutputMapper,
  NormalizeStrategy,
  PathRule,
  RuleValidation,
  PathEntry,
  HashPart,
  IndexCounters,
  EnumerateOptions,
  InvariantThresholds,
  InvariantResult,
  NfaCompileResult,
];

const typeSurface: TypeSurface | null = null;

/** 契约里列出的运行时符号（值 + 类型类别）。 */
const runtimeExports: Array<{ name: string; kind: 'function' | 'object' }> = [
  // core/graph-space
  { name: 'GraphSpace', kind: 'function' },
  { name: 'edgeKey', kind: 'function' },
  // core/path-rule
  { name: 'validateRule', kind: 'function' },
  { name: 'unionRules', kind: 'function' },
  { name: 'intersectRules', kind: 'function' },
  { name: 'concatRules', kind: 'function' },
  { name: 'repeatRule', kind: 'function' },
  { name: 'differenceRules', kind: 'function' },
  { name: 'hasDuplicateNodes', kind: 'function' },
  { name: 'isLegalPath', kind: 'function' },
  { name: 'RuleCompositionError', kind: 'function' },
  // core/path-entry
  { name: 'compareNodeSequences', kind: 'function' },
  { name: 'canonicalNodes', kind: 'function' },
  { name: 'makeEntry', kind: 'function' },
  { name: 'entryLabels', kind: 'function' },
  { name: 'isLiveEntry', kind: 'function' },
  // core/nfa
  { name: 'compileLengthNfa', kind: 'function' },
  // ops/booth
  { name: 'minimalRotationIndex', kind: 'function' },
  { name: 'boothMinimalRotation', kind: 'function' },
  { name: 'isMinimalRotation', kind: 'function' },
  // ops/rolling-hash
  { name: 'hashNode', kind: 'function' },
  { name: 'EMPTY_HASH', kind: 'object' },
  { name: 'concatHash', kind: 'function' },
  { name: 'sequenceHashParts', kind: 'function' },
  { name: 'hashToHex', kind: 'function' },
  { name: 'RollingHash', kind: 'function' },
  // ops/cycle-existence（经 query-engine 汇总）
  { name: 'hasCycleInAdjacency', kind: 'function' },
  { name: 'hasDirectedCycle', kind: 'function' },
  // ops/invariants
  { name: 'InvariantChecker', kind: 'function' },
  // index
  { name: 'PathIndex', kind: 'function' },
  { name: 'edgePairKey', kind: 'function' },
  { name: 'reviveEntry', kind: 'function' },
  { name: 'onEdgeAdded', kind: 'function' },
  { name: 'onEdgeRemoved', kind: 'function' },
  { name: 'rebalance', kind: 'function' },
  // query
  { name: 'enumerate', kind: 'function' },
  { name: 'query', kind: 'function' },
  { name: 'existsWalk', kind: 'function' },
  { name: 'topK', kind: 'function' },
  // registry
  { name: 'RuleRegistry', kind: 'function' },
];

describe('index.ts：逐符号导出断言', () => {
  it.each(runtimeExports)('$name 已导出且类型为 $kind', ({ name, kind }) => {
    const table = api as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(table, name)).toBe(true);
    expect(table[name]).toBeDefined();
    expect(typeof table[name]).toBe(kind);
  });

  it('类型也从 index.ts 导出（编译期断言）', () => {
    expect(typeSurface).toBeNull();
  });

  it('EMPTY_HASH 是 concat 的单位元值（不是空对象占位）', () => {
    expect(api.EMPTY_HASH).toEqual({ hash: 0n, len: 0 });
  });
});

describe('index.ts：聚合层是 re-export 而非复制', () => {
  it('PathIndex 与源模块是同一个类（引用相等）', () => {
    expect(api.PathIndex).toBe(SourcePathIndex);
  });

  it('enumerate 与源模块是同一个函数（引用相等）', () => {
    expect(api.enumerate).toBe(sourceEnumerate);
  });

  it('RuleRegistry 与源模块是同一个类（引用相等）', () => {
    expect(api.RuleRegistry).toBe(SourceRuleRegistry);
  });

  it('hasDirectedCycle 与 ops/cycle-existence 的实现一致（环存在性同一结果）', () => {
    const graph = new api.GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge({ id: 'a->b->r', source: 'a', target: 'b', type: 'r' });
    graph.addEdge({ id: 'b->a->r', source: 'b', target: 'a', type: 'r' });
    expect(api.hasDirectedCycle(graph, new Set(['r']))).toBe(true);
  });
});

describe('index.ts：仅通过公共入口即可完成一次完整查询', () => {
  function buildGraph(): InstanceType<typeof api.GraphSpace> {
    const graph = new api.GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge({ id: 'a->b->r', source: 'a', target: 'b', type: 'r' });
    return graph;
  }

  function buildRule(): PathRule {
    return {
      name: 'call',
      version: 1,
      start: () => true,
      edgeTypes: new Set(['r']),
      lMin: 1,
      lMax: 1,
      normalize: 'none',
    };
  }

  it('enumerate → query → 不变量检查全链路可用', () => {
    const graph = buildGraph();
    const rule = buildRule();
    const index = new api.PathIndex();
    const entries = api.enumerate(graph, rule, ['a'], index);
    expect(entries).toHaveLength(1);
    const queried = api.query(rule, 'a', index, graph);
    expect(queried).toHaveLength(1);
    const results = new api.InvariantChecker().checkAll(index, rule, graph);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('注册表 + 校验 + 惰性索引可用', () => {
    const registry = new api.RuleRegistry(new Set(['r']));
    const rule = buildRule();
    expect(registry.register(rule).errors).toEqual([]);
    expect(registry.get('call')).toBe(rule);
    expect(registry.index('call')).toBeInstanceOf(api.PathIndex);
  });

  it('纯函数工具可用：topK / Booth 旋转 / NFA 编译', () => {
    expect(api.topK([1, 4, 2], 2)).toEqual([4, 2]);
    expect(api.boothMinimalRotation(['b', 'a'])).toEqual(['a', 'b']);
    expect(api.isMinimalRotation(['a', 'b'])).toBe(true);
    expect(api.compileLengthNfa({ lMin: 1, lMax: 2 })).toEqual({ states: 2, accepting: 2 });
    expect(api.hashToHex(api.hashNode('a'))).toMatch(/^[0-9a-f]{16}$/);
  });
});
