/**
 * ρ 路径模式在**适配层**上的端到端验证（不是库内单元测试）。
 *
 * 这一层存在的理由（本项目反复踩的坑）：
 * - `tests/unit/xuanji/path-pattern.test.ts` 证明「库的终判器语义正确」；
 * - 本文件证明「**宿主**真的能用它查出一张真图里的跨视图路径」。
 *
 * 两者不可互相替代。库内测试手搓 `GraphSpace`，永远不会暴露
 * 「适配层的 syncGraph 没把边送进图空间」「edgeTypes 在桥接处被裁掉」
 * 这类接线缺陷——本仓库的 XJ-02 / XJ-11 都是这种形态。
 *
 * 数据用**手写的真实形状**（文件 → 符号 → 导入 → 依赖），不用仓库存量索引：
 * 后者会让用例依赖外部状态，且 CI 与本地不同。形状选择依据是
 * `src/adapters/FileSystemAdapter.ts` 真实产出的节点/边种类
 * （`file:` 前缀的 module 节点、`symcontains:` 的 contains 边、`tsimport:` 的 import 边）。
 */
import { describe, it, expect } from 'vitest';
import {
  XuanjiAdapter,
  checkPatternSyntax,
  formatPatternError,
  inspectPathPattern,
  type PatternEnumerationResult,
} from '../../src/shared/analysis/XuanjiAdapter.ts';
import type { GraphData, GraphEdge, GraphNode } from '../../src/types/index.ts';

const node = (id: string, type: GraphNode['type'], filePath: string): GraphNode => ({
  id: id as GraphNode['id'],
  label: id.split(':').pop() ?? id,
  type,
  filePath,
  properties: {},
});

const edge = (source: string, target: string, type: GraphEdge['type']): GraphEdge => ({
  id: `${type}:${source}->${target}` as GraphEdge['id'],
  source: source as GraphEdge['source'],
  target: target as GraphEdge['target'],
  type,
  properties: {},
});

/**
 * 一张有**明确跨视图形状**的小图：
 *
 * ```
 *   file:main.ts ─contain──> sym:handler ─call──> sym:service
 *                                                 │
 *                                              import
 *                                                 ↓
 *   file:db.ts <──contain── sym:dbClient <──────┘
 *                                              dependency
 *                                                 ↓
 *                                            sym:driver
 * ```
 *
 * 即：handler --call--> service --import--> dbClient --dependency--> driver。
 * 三种不同的边类型串成一条链，正好是 ρ 才能表达、扁平 edgeTypes 表达不了的情形。
 */
function makeGraph(): GraphData {
  const nodes: GraphNode[] = [
    node('file:main.ts', 'module', 'main.ts'),
    node('file:service.ts', 'module', 'service.ts'),
    node('file:db.ts', 'module', 'db.ts'),
    node('sym:handler', 'function', 'main.ts'),
    node('sym:service', 'function', 'service.ts'),
    node('sym:dbClient', 'class', 'db.ts'),
    node('sym:driver', 'class', 'db.ts'),
  ];
  const edges: GraphEdge[] = [
    edge('file:main.ts', 'sym:handler', 'contains'),
    edge('file:service.ts', 'sym:service', 'contains'),
    edge('file:db.ts', 'sym:dbClient', 'contains'),
    edge('sym:handler', 'sym:service', 'call'),
    edge('sym:service', 'sym:dbClient', 'import'),
    edge('sym:dbClient', 'sym:driver', 'dependency'),
  ];
  return {
    nodes,
    edges,
    metadata: { repoId: 'test' as GraphData['metadata']['repoId'], timestamp: 1, nodeCount: nodes.length, edgeCount: edges.length },
  };
}

function makeAdapter(): XuanjiAdapter {
  const adapter = new XuanjiAdapter();
  adapter.loadGraph(makeGraph());
  return adapter;
}

describe('ρ 端到端：适配层能查出跨视图路径', () => {
  it('call . import . dependency 精确命中那条链', () => {
    const adapter = makeAdapter();
    const r = adapter.pathsByPattern('call . import . dependency', { maxHops: 6 });
    expect(r.paths).toEqual([['sym:handler', 'sym:service', 'sym:dbClient', 'sym:driver']]);
    expect(r.truncated).toBe(false);
  });

  it('call+ . import? . dependency（研究方案 §4 原文那条）同样命中', () => {
    const adapter = makeAdapter();
    const r = adapter.pathsByPattern('call+ . import? . dependency', { maxHops: 6 });
    expect(r.paths).toEqual([['sym:handler', 'sym:service', 'sym:dbClient', 'sym:driver']]);
  });

  it('扁平 edgeTypes 与 ρ 的差别被实证：call|import|dependency 的组合无法约束顺序', () => {
    const adapter = makeAdapter();
    // 扁平三类型：每一步任意一种 ⇒ 会出现「顺序不对」的路径
    const flat = adapter.pathsByPattern('(call|import|dependency){3}', { maxHops: 6 });
    // ρ 强制顺序
    const ordered = adapter.pathsByPattern('call . import . dependency', { maxHops: 6 });
    // 长度都可能是 3 跳，但只有 ρ 能保证「顺序恰好是 call→import→dependency」
    expect(ordered.paths).toEqual([['sym:handler', 'sym:service', 'sym:dbClient', 'sym:driver']]);
    // 扁平版本不应比 ρ 更精确（它的合法集是 ρ 的超集或相同）
    for (const path of ordered.paths) {
      expect(flat.paths).toContainEqual(path);
    }
  });

  it('ρ 的顺序约束真的在拒绝：import . call 在图上有相应节点但顺序相反', () => {
    const adapter = makeAdapter();
    // 图上存在 service --import--> dbClient，但不存在 import 之后再 call
    const r = adapter.pathsByPattern('import . call', { maxHops: 6 });
    expect(r.paths).toEqual([]);
  });

  it('startNode 缩小起点；endNode 约束终点', () => {
    const adapter = makeAdapter();
    const fromHandler = adapter.pathsByPattern('call+ . import . dependency', {
      startNode: 'sym:handler', maxHops: 6,
    });
    expect(fromHandler.paths).toHaveLength(1);
    const fromWrong = adapter.pathsByPattern('call+ . import . dependency', {
      startNode: 'sym:service', maxHops: 6,
    });
    // service 起点：service --import--> dbClient --dependency--> driver，缺 call 前缀
    expect(fromWrong.paths).toEqual([]);

    const toDriver = adapter.pathsByPattern('call . import . dependency', {
      endNode: 'sym:driver', maxHops: 6,
    });
    expect(toDriver.paths).toHaveLength(1);
    const toWrong = adapter.pathsByPattern('call . import . dependency', {
      endNode: 'sym:handler', maxHops: 6,
    });
    expect(toWrong.paths).toEqual([]);
  });

  it('ρ 的长度区间与 maxHops 取交集：call{1,2} + maxHops:10 不会返回 3 跳路径', () => {
    const adapter = makeAdapter();
    const r = adapter.pathsByPattern('call{1,2}', { maxHops: 10 });
    // 图上只有一条 call 边（handler→service），1 跳
    expect(r.paths).toEqual([['sym:handler', 'sym:service']]);
  });

  it('回显 ρ 元信息：pattern / patternEdgeTypes / stateCount', () => {
    const adapter = makeAdapter();
    const r = adapter.pathsByPattern('call+ . import?', { maxHops: 4 });
    expect(r.pattern).toBe('call+ . import?');
    expect(r.patternEdgeTypes).toEqual(['call', 'import']);
    expect(r.stateCount).toBeGreaterThan(0);
  });

  it('零结果是零结果，不是错误：paths 为空且没有 error 字段', () => {
    const adapter = makeAdapter();
    const r: PatternEnumerationResult = adapter.pathsByPattern('extend', { maxHops: 3 });
    expect(r.paths).toEqual([]);
    expect('error' in r).toBe(false);
  });

  it('ρ 语法错误**抛错**（不吞成零结果）', () => {
    const adapter = makeAdapter();
    expect(() => adapter.pathsByPattern('call|')).toThrow();
    expect(() => adapter.pathsByPattern('call{3,1}')).toThrow();
  });

  it('分页：pageSize 与 nextCursor 语义与 findPathsBetween 一致', () => {
    // 造两条可枚举的 call 链
    const data = makeGraph();
    data.edges.push(edge('sym:handler', 'sym:driver', 'call'));
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(data);
    const page1 = adapter.pathsByPattern('call', { maxHops: 2, pageSize: 1 });
    expect(page1.paths).toHaveLength(1);
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBe(1);
    const page2 = adapter.pathsByPattern('call', { maxHops: 2, pageSize: 1, cursor: 1 });
    expect(page2.paths).toHaveLength(1);
    expect(page2.paths[0]).not.toEqual(page1.paths[0]);
  });
});

describe('闭合 ρ 的规范化：与 cycles() 同语义（cycle-134 实测缺陷回归）', () => {
  /**
   * 缺陷现场（修复前实测）：
   * ```
   * PATTERN_CLOSED=3 [["a","b","c","a"],["b","c","a","b"],["c","a","b","c"]]
   * CYCLES=1         [["a","b","c","a"]]
   * ```
   * 同一个环从三个起点各报一次 —— 而 `cycles()` 报一条。**同一个库，两种答案。**
   *
   * 根因：`pathsByPattern` 传 `closed: true` 但没传 `normalize`，
   * 于是在 `compilePathRule` 里落到缺省 `'none'`；`cycles()` 传的是 `'canonical'`
   * （Booth 最小旋转）。「同一首诗从不同字起读仍是同一首」这条璇玑图语义
   * 只在 `cycles()` 一侧成立过。
   */
  const buildCycle = (): GraphData => ({
    nodes: [node('a', 'function', 'a.ts'), node('b', 'function', 'a.ts'), node('c', 'function', 'a.ts')],
    edges: [edge('a', 'b', 'call'), edge('b', 'c', 'call'), edge('c', 'a', 'call')],
    metadata: { repoId: 'r' as GraphData['metadata']['repoId'], timestamp: 1, nodeCount: 3, edgeCount: 3 },
  });

  it('三节点环：闭合 ρ 报 1 条（不是 3 条），与 cycles() 一致', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(buildCycle());
    const viaPattern = adapter.pathsByPattern('call+', { closed: true, maxHops: 5 });
    const viaCycles = adapter.cycles({ maxLength: 5 });
    expect(viaPattern.paths).toHaveLength(1);
    expect(viaPattern.paths.length).toBe(viaCycles.paths.length);
    expect(viaPattern.paths).toEqual(viaCycles.paths);
  });

  it('开放 ρ 仍是 normalize:none —— 起点有语义，不做旋转规范化', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(buildCycle());
    // 环上每条 1 跳的 call 边都是独立的开放路径（起点不同 = 不同路径）
    const open = adapter.pathsByPattern('call', { maxHops: 1 });
    expect(open.paths).toHaveLength(3);
    const starts = open.paths.map((p) => p[0]).sort();
    expect(starts).toEqual(['a', 'b', 'c']);
  });

  it('反向自检：closed:true 真的改变了结果集（不是「传了参数没人读」）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(buildCycle());
    // `simple: true`（缺省）下，开放模式的 DFS 不允许重复访问节点，
    // 而 a→b→c→a 的终点 a 已访问 ⇒ 被剪掉。所以 `call{3}` 开放模式报 0 条，
    // 闭合模式（`pruneClosed` 放行「末=首」那一步）报 1 条。
    //
    // 这正是「closed 是承重参数」的证据：同一 ρ、同一图，只翻一个布尔值，
    // 结果从 0 条变 1 条。第一版测试把它写成 `open > closed`（方向反了），
    // 实测 open=0 才纠正过来——「照着语义猜」在这里是错的。
    const closed = adapter.pathsByPattern('call{3}', { closed: true, maxHops: 6 });
    const open = adapter.pathsByPattern('call{3}', { maxHops: 6 });
    expect(closed.paths).toHaveLength(1);
    expect(open.paths).toHaveLength(0);
  });
});

describe('ρ 的语法预检入口（供界面/工具层用）', () => {
  it('checkPatternSyntax 对合法模式返回 ok:true', () => {
    expect(checkPatternSyntax('call+')).toEqual({ ok: true });
    expect(checkPatternSyntax('(import|dependency)+')).toEqual({ ok: true });
    expect(checkPatternSyntax('')).toEqual({ ok: true });
  });

  it('checkPatternSyntax 对非法模式返回 ok:false 且带 error（不抛）', () => {
    const r = checkPatternSyntax('call|');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(Error);
  });

  it('checkPatternSyntax 不做编译（{1,50} 也瞬间返回）', () => {
    const start = Date.now();
    expect(checkPatternSyntax('call{1,50}')).toEqual({ ok: true });
    // 只解析、不建 NFA：50 份拷贝的编译成本不应出现
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('inspectPathPattern 给出编译后的静态分析', () => {
    const p = inspectPathPattern('call{2,4} . import?');
    expect([...p.edgeTypes].sort()).toEqual(['call', 'import']);
    expect(p.minEdges).toBe(2);
    expect(p.maxEdges).toBe(5);
  });

  it('formatPatternError 把语法错误渲染成可读诊断', () => {
    let caught: unknown;
    try { inspectPathPattern('call|'); } catch (e) { caught = e; }
    const text = formatPatternError('call|', caught);
    expect(text).toContain('call|');
    expect(text).toContain('^');
  });
});
