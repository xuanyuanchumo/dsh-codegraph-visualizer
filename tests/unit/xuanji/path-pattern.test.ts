/**
 * 路径模式 ρ（边类型序列正则）的独立 oracle。
 *
 * 三层证据：
 * 1. **解析/编译**：语法接受与拒绝（响亮失败，不静默降级）；
 * 2. **NFA 语义**：手动挑选的类型序列逐条对照——这些是真值来源，不是「跑一遍看结果」；
 * 3. **顺序无关性 + 多重边**：本文件最重要的一节。曾经的实现按 `Set` 迭代序取
 *    「第一条命中的边类型」，于是同一条 ρ 在同一张图上有两种答案。这里用
 *    **同一张图的两种候选集构造顺序** 断言结果相同——只有并集语义才过。
 *
 * 零宿主依赖：只 import src/xuanji 内部模块（库边界守卫另有专测）。
 */
import { describe, it, expect } from 'vitest';
import {
  compilePathPattern,
  compilePathRule,
  parsePathPattern,
  describePatternError,
  edgeTypesBetween,
  PathPatternError,
} from '../../../src/xuanji/core/path-pattern.ts';
import { GraphSpace, type XJEdge, type EdgeType } from '../../../src/xuanji/core/graph-space.ts';
import { isLegalPath } from '../../../src/xuanji/core/path-rule.ts';
import { PathIndex } from '../../../src/xuanji/index/path-index.ts';
import { enumerate } from '../../../src/xuanji/query/query-engine.ts';

// ── 1. 解析与编译 ───────────────────────────────────────────────────────

describe('ρ 解析：接受合法语法', () => {
  it('单个边类型', () => {
    const p = compilePathPattern('call');
    expect(p.edgeTypes).toEqual(new Set(['call']));
    expect(p.minEdges).toBe(1);
    expect(p.maxEdges).toBe(1);
  });

  it('拼接（显式点与隐式空格等价）', () => {
    const withDot = compilePathPattern('call.import');
    const withSpace = compilePathPattern('call import');
    expect(withDot.edgeTypes).toEqual(new Set(['call', 'import']));
    expect(withDot.minEdges).toBe(2);
    expect(withDot.maxEdges).toBe(2);
    expect(withSpace.minEdges).toBe(withDot.minEdges);
    expect(withSpace.maxEdges).toBe(withDot.maxEdges);
    // 语义也必须相同（不只是区间相同）
    for (const seq of [['call', 'import'], ['import', 'call'], ['call', 'call']]) {
      expect(withSpace.matchesEdgeSequence(seq)).toBe(withDot.matchesEdgeSequence(seq));
    }
  });

  it('并 union', () => {
    const p = compilePathPattern('call|import');
    expect(p.edgeTypes).toEqual(new Set(['call', 'import']));
    expect(p.minEdges).toBe(1);
    expect(p.maxEdges).toBe(1);
    expect(p.matchesEdgeSequence(['call'])).toBe(true);
    expect(p.matchesEdgeSequence(['import'])).toBe(true);
    expect(p.matchesEdgeSequence(['extend'])).toBe(false);
  });

  it('量词 ? * + 的长度区间', () => {
    expect(compilePathPattern('call?').minEdges).toBe(0);
    expect(compilePathPattern('call?').maxEdges).toBe(1);
    expect(compilePathPattern('call*').minEdges).toBe(0);
    expect(compilePathPattern('call*').maxEdges).toBe(Number.POSITIVE_INFINITY);
    expect(compilePathPattern('call+').minEdges).toBe(1);
    expect(compilePathPattern('call+').maxEdges).toBe(Number.POSITIVE_INFINITY);
  });

  it('{n,m} 显式区间', () => {
    const p = compilePathPattern('call{2,4}');
    expect(p.minEdges).toBe(2);
    expect(p.maxEdges).toBe(4);
  });

  it('{n} 精确次数', () => {
    const p = compilePathPattern('call{3}');
    expect(p.minEdges).toBe(3);
    expect(p.maxEdges).toBe(3);
  });

  it('{n,} 无上界', () => {
    const p = compilePathPattern('call{2,}');
    expect(p.minEdges).toBe(2);
    expect(p.maxEdges).toBe(Number.POSITIVE_INFINITY);
  });

  it('分组', () => {
    const p = compilePathPattern('(call|import)+');
    expect(p.edgeTypes).toEqual(new Set(['call', 'import']));
    expect(p.minEdges).toBe(1);
  });

  it('空模式 ε 匹配零条边的空序列', () => {
    const p = compilePathPattern('');
    expect(p.edgeTypes.size).toBe(0);
    expect(p.minEdges).toBe(0);
    expect(p.maxEdges).toBe(0);
    expect(p.matchesEdgeSequence([])).toBe(true);
    expect(p.matchesEdgeSequence(['call'])).toBe(false);
  });
});

describe('ρ 解析：拒绝非法语法（响亮失败）', () => {
  const cases: Array<[string, string]> = [
    ['call|', '悬空的并运算符'],
    ['(', '未闭合分组'],
    ['call)', '多余的右括号'],
    ['call{3,1}', '上界小于下界'],
    ['call{}', '{} 内无数字'],
    ['call{2', '未闭合的重复'],
    ['*', '量词无原子'],
    ['call@import', '非法字符'],
  ];

  for (const [pattern, why] of cases) {
    it(`拒绝 ${JSON.stringify(pattern)}（${why}）`, () => {
      expect(() => compilePathPattern(pattern)).toThrow(PathPatternError);
    });
  }

  it('非字符串输入被拒绝', () => {
    expect(() => compilePathPattern(undefined as unknown as string)).toThrow(PathPatternError);
  });

  it('describePatternError 给出带 ^ 指示的双行片段', () => {
    try {
      compilePathPattern('call|');
      expect.unreachable('should have thrown');
    } catch (e) {
      const text = describePatternError('call|', e);
      expect(text).toContain('call|');
      expect(text).toContain('^');
    }
  });
});

// ── 2. NFA 语义：手工挑选的真值 ─────────────────────────────────────────

describe('ρ 匹配语义：逐条手算对照', () => {
  it('call+ 接受任意长度 ≥1 的 call 序列，拒绝含非 call 的序列', () => {
    const p = compilePathPattern('call+');
    expect(p.matchesEdgeSequence(['call'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence([])).toBe(false);
    expect(p.matchesEdgeSequence(['import'])).toBe(false);
    expect(p.matchesEdgeSequence(['call', 'import'])).toBe(false);
  });

  it('call* 接受零条边（与 call+ 的唯一差别）', () => {
    const p = compilePathPattern('call*');
    expect(p.matchesEdgeSequence([])).toBe(true);
    expect(p.matchesEdgeSequence(['call'])).toBe(true);
    expect(p.matchesEdgeSequence(['import'])).toBe(false);
  });

  it('call.import 要求严格顺序', () => {
    const p = compilePathPattern('call.import');
    expect(p.matchesEdgeSequence(['call', 'import'])).toBe(true);
    expect(p.matchesEdgeSequence(['import', 'call'])).toBe(false);
    expect(p.matchesEdgeSequence(['call'])).toBe(false);
    expect(p.matchesEdgeSequence(['call', 'call'])).toBe(false);
  });

  it('call*.import：先任意次 call 再一次 import', () => {
    const p = compilePathPattern('call* . import');
    expect(p.matchesEdgeSequence(['import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call', 'import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'import', 'call'])).toBe(false);
    expect(p.matchesEdgeSequence(['call'])).toBe(false);
  });

  it('研究方案 §4 原文那条跨视图路径：call+ . import? . dependency', () => {
    const p = compilePathPattern('call+ . import? . dependency');
    expect(p.matchesEdgeSequence(['call', 'dependency'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'import', 'dependency'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call', 'import', 'dependency'])).toBe(true);
    // 少了 dependency 收尾
    expect(p.matchesEdgeSequence(['call', 'call'])).toBe(false);
    // import 出现两次
    expect(p.matchesEdgeSequence(['call', 'import', 'import', 'dependency'])).toBe(false);
  });

  it('call{2,4} 精确长度窗口', () => {
    const p = compilePathPattern('call{2,4}');
    expect(p.matchesEdgeSequence(['call'])).toBe(false);
    expect(p.matchesEdgeSequence(['call', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call', 'call', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'call', 'call', 'call', 'call'])).toBe(false);
  });

  it('(call|import)+ 接受混合序列', () => {
    const p = compilePathPattern('(call|import)+');
    expect(p.matchesEdgeSequence(['call', 'import', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'extend'])).toBe(false);
  });

  it('(call.import)+ 要求成对出现', () => {
    const p = compilePathPattern('(call.import)+');
    expect(p.matchesEdgeSequence(['call', 'import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'import', 'call', 'import'])).toBe(true);
    expect(p.matchesEdgeSequence(['call', 'import', 'call'])).toBe(false);
  });

  it('extend? . call+ 可选的继承一步', () => {
    const p = compilePathPattern('extend? . call+');
    expect(p.matchesEdgeSequence(['call'])).toBe(true);
    expect(p.matchesEdgeSequence(['extend', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['extend', 'call', 'call'])).toBe(true);
    expect(p.matchesEdgeSequence(['extend', 'extend', 'call'])).toBe(false);
  });
});

// ── 3. 多重边：迭代序无关性（本文件最重要的一节） ─────────────────────

describe('多重边并列标签：结果不得依赖候选集迭代序', () => {
  /** 构造一对节点 u→v，同时挂 call 与 import 两条边。 */
  function makeMultiEdgeGraph(order: readonly EdgeType[]): GraphSpace {
    const g = new GraphSpace();
    g.addNode('u', { label: 'u' });
    g.addNode('v', { label: 'v' });
    for (const type of order) {
      g.addEdge({ id: `${type}-uv`, source: 'u', target: 'v', type } as XJEdge);
    }
    return g;
  }

  it('edgeTypesBetween 返回全部并列标签（不是第一条）', () => {
    const g = makeMultiEdgeGraph(['call', 'import']);
    const labels = edgeTypesBetween(g, 'u', 'v', new Set(['call', 'import']));
    expect([...labels].sort()).toEqual(['call', 'import']);
  });

  it('edgeTypesBetween 对不存在的边对返回空数组', () => {
    const g = makeMultiEdgeGraph(['call']);
    expect(edgeTypesBetween(g, 'u', 'v', new Set(['import']))).toEqual([]);
    expect(edgeTypesBetween(g, 'v', 'u', new Set(['call']))).toEqual([]);
  });

  it('ρ = import 在 call+import 的多重边上匹配（旧实现会因迭代序漏掉）', () => {
    const p = compilePathPattern('import');
    // 两种构造顺序：call 在前 / import 在前
    for (const order of [['call', 'import'], ['import', 'call']] as const) {
      const g = makeMultiEdgeGraph(order);
      const labels = edgeTypesBetween(g, 'u', 'v', p.edgeTypes);
      expect(p.matchesLabelSequence([labels])).toBe(true);
    }
  });

  it('ρ = import.call 需要两步；单步多重边不满足', () => {
    const p = compilePathPattern('import . call');
    const g = makeMultiEdgeGraph(['call', 'import']);
    const labels = edgeTypesBetween(g, 'u', 'v', p.edgeTypes);
    // 只有一步 → 长度不匹配
    expect(p.matchesLabelSequence([labels])).toBe(false);
    // 两步（u→v→v 在语义上不成立，但 NFA 只看标签序列）
    expect(p.matchesLabelSequence([labels, labels])).toBe(true);
  });

  it('ρ = call.import 在「两跳都是多重边」时仍能匹配（旧实现必漏）', () => {
    const p = compilePathPattern('call . import');
    const g = makeMultiEdgeGraph(['call', 'import']);
    // u→v 有 call+import，v→v 也有 call+import（自环，仅用于构造标签序列）
    g.addEdge({ id: 'call-vv', source: 'v', target: 'v', type: 'call' } as XJEdge);
    g.addEdge({ id: 'import-vv', source: 'v', target: 'v', type: 'import' } as XJEdge);
    const step1 = edgeTypesBetween(g, 'u', 'v', p.edgeTypes);
    const step2 = edgeTypesBetween(g, 'v', 'v', p.edgeTypes);
    // 存在指派（call 然后 import）⇒ 必须匹配
    expect(p.matchesLabelSequence([step1, step2])).toBe(true);
  });

  it('决定性断言：ρ=call.import 在两跳多重边图上，两种候选集序都返回同一结论', () => {
    // 这是唯一能区分「并集语义」与「取第一条」的形态：
    // ρ 的类型集含 call 与 import，且每一跳上两个标签都存在。
    // 取第一条 ⇒ [call, call]（或 [import, import]）⇒ 不匹配；
    // 取并集 ⇒ 存在 [call, import] 指派 ⇒ 匹配。
    const rule = compilePathRule('call . import');
    const build = (order: readonly EdgeType[]): GraphSpace => {
      const g = new GraphSpace();
      g.addNode('u', { label: 'u' });
      g.addNode('v', { label: 'v' });
      g.addNode('w', { label: 'w' });
      for (const type of order) {
        g.addEdge({ id: `${type}-uv`, source: 'u', target: 'v', type } as XJEdge);
        g.addEdge({ id: `${type}-vw`, source: 'v', target: 'w', type } as XJEdge);
      }
      return g;
    };
    const verdicts = ([['call', 'import'], ['import', 'call']] as const).map((order) =>
      isLegalPath(rule, ['u', 'v', 'w'], build(order)));
    expect(verdicts).toEqual([true, true]);
  });

  it('反例守卫：单类型候选集（无多重边）时语义不变', () => {
    const rule = compilePathRule('call');
    const g = makeMultiEdgeGraph(['call']);
    expect(isLegalPath(rule, ['u', 'v'], g)).toBe(true);
    const g2 = makeMultiEdgeGraph(['import']);
    expect(isLegalPath(rule, ['u', 'v'], g2)).toBe(false);
  });
});

// ── 4. compilePathRule：与枚举引擎的桥接 ────────────────────────────────

describe('compilePathRule 桥接：剪枝超集 + 精确终判', () => {
  /** a --call--> b --import--> c --dependency--> d */
  function makeChainGraph(): GraphSpace {
    const g = new GraphSpace();
    for (const id of ['a', 'b', 'c', 'd']) g.addNode(id, { label: id });
    const edges: XJEdge[] = [
      { id: '1', source: 'a', target: 'b', type: 'call' },
      { id: '2', source: 'b', target: 'c', type: 'import' },
      { id: '3', source: 'c', target: 'd', type: 'dependency' },
    ];
    for (const e of edges) g.addEdge(e);
    return g;
  }

  it('edgeTypes 是 ρ 中出现过的类型的并集（超集剪枝）', () => {
    const rule = compilePathRule('call . import');
    expect(rule.edgeTypes).toEqual(new Set(['call', 'import']));
  });

  it('长度区间取 ρ 与显式跳数区间的交集（不是替换）', () => {
    // ρ 要求 2..2；调用方的 maxHops=10 不得放宽成 10
    const rule = compilePathRule('call . import', { maxHops: 10 });
    expect(rule.lMin).toBe(2);
    expect(rule.lMax).toBe(2);
    // ρ 要求 2..2；minHops=1 不得放宽成 1
    const rule2 = compilePathRule('call . import', { minHops: 1 });
    expect(rule2.lMin).toBe(2);
  });

  it('无界 ρ + 缺省 simple 时为合法规则（不抛错）', () => {
    const rule = compilePathRule('call+');
    expect(rule.simple).toBe(true);
    expect(rule.lMax).toBe(Number.POSITIVE_INFINITY);
  });

  it('无界 + 显式 simple:false 被强制为 simple:true（不静默近似）', () => {
    const rule = compilePathRule('call+', { simple: false });
    expect(rule.simple).toBe(true);
  });

  it('有界 + simple:false 保留调用方的选择', () => {
    const rule = compilePathRule('call{1,3}', { simple: false });
    expect(rule.simple).toBe(false);
  });

  it('精确终判：2 步 call.import 只有 a→b→c 合法', () => {
    const g = makeChainGraph();
    const rule = compilePathRule('call . import');
    expect(isLegalPath(rule, ['a', 'b', 'c'], g)).toBe(true);
    // 顺序反了
    expect(isLegalPath(rule, ['a', 'b'], g)).toBe(false); // 长度不符
    expect(isLegalPath(rule, ['b', 'c', 'd'], g)).toBe(false); // import.dependency ≠ call.import
  });

  it('端到端枚举：enumerate 只物化合法于 ρ 的路径', () => {
    const g = makeChainGraph();
    const rule = compilePathRule('call* . import? . dependency', { maxHops: 5 });
    const index = new PathIndex();
    const entries = enumerate(g, rule, ['a'], index, { maxPaths: 50 });
    const paths = entries.map((e) => [...e.nodes]);
    // 合法路径只有 a→b→c→d（call, import, dependency）
    expect(paths).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('端到端枚举：ρ 拒绝的路径一条都不物化', () => {
    const g = makeChainGraph();
    // 要求 dependency 开头：链上没有从 a 出发的 dependency 边
    const rule = compilePathRule('dependency . call+', { maxHops: 5 });
    const index = new PathIndex();
    const entries = enumerate(g, rule, ['a'], index, { maxPaths: 50 });
    expect(entries).toHaveLength(0);
  });

  /**
   * **只有 ρ 能拒绝的形态**（承重性核心用例）。
   *
   * `isLegalPath` 在调 `pathConstraint` 之前会先查 `hasEdgeOfType` ——
   * 因此「边类型不在 rule.edgeTypes 里」的路径由引擎自己挡掉，`pathConstraint`
   * 恒真也看不出来。要证明 ρ 的终判真的在承重，必须构造**所有边的类型都在
   * `rule.edgeTypes` 里、但顺序不对**的路径：此时唯一的拒绝理由是序列不匹配。
   */
  it('顺序错误的路径由 pathConstraint 拒绝（边类型全在 rule.edgeTypes 内）', () => {
    // a --import--> b --call--> c：长度 2、两种类型都在 ρ=call.import 的 edgeTypes 里
    const g = new GraphSpace();
    for (const id of ['a', 'b', 'c']) g.addNode(id, { label: id });
    g.addEdge({ id: '1', source: 'a', target: 'b', type: 'import' } as XJEdge);
    g.addEdge({ id: '2', source: 'b', target: 'c', type: 'call' } as XJEdge);

    const rule = compilePathRule('call . import');
    // 前提自检：两种类型都在剪枝集内，且长度区间也放行 —— 若无 ρ 终判，这条路径会非法通过
    expect(rule.edgeTypes).toEqual(new Set(['call', 'import']));
    expect(rule.lMin).toBe(2);
    expect(rule.lMax).toBe(2);

    expect(isLegalPath(rule, ['a', 'b', 'c'], g)).toBe(false);

    const index = new PathIndex();
    const entries = enumerate(g, rule, ['a'], index, { maxPaths: 50 });
    expect(entries).toHaveLength(0);
  });

  it('同一张图：只交换边类型顺序，ρ 从拒绝翻转为接受', () => {
    const rule = compilePathRule('call . import');
    const build = (first: EdgeType, second: EdgeType): GraphSpace => {
      const g = new GraphSpace();
      for (const id of ['a', 'b', 'c']) g.addNode(id, { label: id });
      g.addEdge({ id: '1', source: 'a', target: 'b', type: first } as XJEdge);
      g.addEdge({ id: '2', source: 'b', target: 'c', type: second } as XJEdge);
      return g;
    };
    expect(isLegalPath(rule, ['a', 'b', 'c'], build('import', 'call'))).toBe(false);
    expect(isLegalPath(rule, ['a', 'b', 'c'], build('call', 'import'))).toBe(true);
  });

  it('空 ρ（ε）只能物化 lMin=0 的单节点路径', () => {
    const g = makeChainGraph();
    const rule = compilePathRule('');
    expect(rule.edgeTypes.size).toBe(0);
    const index = new PathIndex();
    const entries = enumerate(g, rule, ['a'], index, { maxPaths: 10 });
    // 单节点路径（0 边）合法；有边的路径因 edgeTypes 为空而无法展开
    expect(entries.map((e) => [...e.nodes])).toEqual([['a']]);
  });

  it('start / end / nodeConstraint 透传', () => {
    const g = makeChainGraph();
    const rule = compilePathRule('call+', {
      start: (id) => id === 'a',
      end: (id) => id === 'd',
      maxHops: 5,
    });
    const index = new PathIndex();
    const entries = enumerate(g, rule, ['a', 'b'], index, { maxPaths: 10 });
    // b 不满足 start ⇒ 只剩从 a 出发、且以 d 结束的路径；
    // 但 a 到 d 的边序列是 call,import,dependency，不匹配 call+
    expect(entries).toHaveLength(0);
  });

  it('规则名缺省为 pattern:<ρ>，可显式覆盖', () => {
    expect(compilePathRule('call+').name).toBe('pattern:call+');
    expect(compilePathRule('call+', { name: 'my-rule' }).name).toBe('my-rule');
  });
});

// ── 5. 复杂度与预算 ────────────────────────────────────────────────────

describe('编译产物的规模是显式代价', () => {
  it('状态数与正则规模同阶（不随 {n,m} 的 m 爆炸就说明展开有界）', () => {
    const small = compilePathPattern('call{1,2}');
    const big = compilePathPattern('call{1,8}');
    expect(big.stateCount).toBeGreaterThan(small.stateCount);
    // 每份拷贝约 3 个状态（entry/type/accept），8 份不应超过 4 倍于 2 份
    expect(big.stateCount).toBeLessThan(small.stateCount * 4);
  });

  it('parsePathPattern 与 compilePathPattern 对同一输入的语法树判断一致', () => {
    expect(() => parsePathPattern('call+')).not.toThrow();
    expect(() => parsePathPattern('call+[')).toThrow(PathPatternError);
  });
});
