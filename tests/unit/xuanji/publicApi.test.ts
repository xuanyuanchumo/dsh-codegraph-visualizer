/**
 * 公共 API 表面测试：src/xuanji/index.ts 必须逐个导出契约里列出的符号。
 *
 * 为什么逐符号断言：漏一个导出在运行时是 undefined，调用点报错一行，
 * 而类型检查只覆盖「import 了却没用」的文件——只有把符号表钉死才能防止漏导出。
 * 同时用「与源模块引用相等」证明聚合层是 re-export，不是复制实现。
 *
 * ## XJ-08：本文件同时是「已删除模块」的墓碑
 *
 * `core/nfa.ts` 在 cycle-111 被删除（只有 `states = lMax - lMin + 1` 一个减法、
 * `compileLengthNfa` 全仓 0 生产调用点，而规范 §5.6 要的存在性判定已由 `existsWalk` 覆盖）。
 * 删除动作需要两条**互不替代**的守卫，缺一条就会留下一种「复活」：
 * - 负向导出断言：挡住「文件回来了，又加回 barrel 导出」；
 * - `core/` 目录清单断言：挡住「文件回来了，但没加导出」——那种状态下
 *   负向断言依然是绿的，而库里已经多了一个没人用、却看起来像算法的模块。
 *
 * 两条都是**清单相等**而不是 `not.toContain`：清单相等还能抓出「悄悄新增了别的模块」，
 * 而 `not.toContain('nfa.ts')` 对新增模块完全无感。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('纯函数工具可用：topK / Booth 旋转 / 哈希', () => {
    expect(api.topK([1, 4, 2], 2)).toEqual([4, 2]);
    expect(api.boothMinimalRotation(['b', 'a'])).toEqual(['a', 'b']);
    expect(api.isMinimalRotation(['a', 'b'])).toBe(true);
    expect(api.hashToHex(api.hashNode('a'))).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── XJ-08 墓碑：已删除的 core/nfa.ts 不得复活 ─────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
/** 被扫描的目录（真实仓库的 `src/xuanji/core`，不是样本）。 */
const CORE_DIR = resolve(HERE, '../../../src/xuanji/core');

describe('XJ-08 墓碑：core/nfa.ts 已移除，两条守卫分别挡两种复活方式', () => {
  it('负向导出断言：barrel 不得再导出 compileLengthNfa / NfaCompileResult', () => {
    // 用 `in` 而不是 `api.compileLengthNfa === undefined`：后者对「导出了但值是 undefined」
    // 也会绿，而那种状态下符号确实出现在了公共面上。
    expect('compileLengthNfa' in api).toBe(false);
    expect('NfaCompileResult' in api).toBe(false);
  });

  it('core/ 目录清单相等：nfa.ts 不得回来（连不带导出的版本也不许）', () => {
    // 这一条与上一条**不可互相替代**：文件复活但没加导出时，负向导出断言依然为绿。
    const files = readdirSync(CORE_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort();
    // `path-pattern.ts` 是 cycle-134 的有意新增（路径模式 ρ）。它与已删除的
    // `nfa.ts` 不是同一件事：那个模块只有 `states = lMax - lMin + 1` 一个减法且
    // 零生产调用点；本模块是 ρ 文本 → NFA → PathRule 的编译器，由 `graph_path_pattern`
    // 工具与 `XuanjiAdapter` 生产使用（可达性守卫另有专测）。
    // 清单必须逐字列出：清单相等是本测试存在的意义（`not.toContain` 抓不到新增）。
    expect(files).toEqual(['graph-space.ts', 'path-entry.ts', 'path-pattern.ts', 'path-rule.ts']);
  });

  it('反向自检：清单断言真的会因多一个文件而红（否则上面的清单相等是空转）', () => {
    // 不碰真实目录：把同一个比较逻辑喂给一个含 nfa.ts 的合成清单，必须先失败。
    const expected = ['graph-space.ts', 'path-entry.ts', 'path-pattern.ts', 'path-rule.ts'];
    const synthetic = ['graph-space.ts', 'nfa.ts', 'path-entry.ts', 'path-pattern.ts', 'path-rule.ts'];
    expect(synthetic).not.toEqual(expected);
    // 第二个方向：少了 path-pattern.ts 也必须红（防止有人把它从清单里删掉而清单「相等」）
    expect(['graph-space.ts', 'path-entry.ts', 'path-rule.ts']).not.toEqual(expected);
  });
});
