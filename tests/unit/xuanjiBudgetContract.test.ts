/**
 * XJ-11 的两条「不可见契约」：
 * 1. `INCREMENTAL_WORK_BUDGET`（库）与宿主图上界（`PATH_FINDER.MAX_NODES_FOR_BFS` /
 *    `CLUSTER.MAX_VISIBLE_NODES`）必须**成对**标定。历史上它们独立演进过（虚拟滚动的
 *    2500 vs 1500 就是「阈值永远不触发」的现成教训），只看库内单测永远发现不了。
 * 2. 降级信号必须是实例态：两个 adapter（两个 repoId）并发增量时互相清标记，
 *    就等于降级不可观测。这里用**真实适配层**走一遍生产路径（registerRule + applyDelta），
 *    而不是直接调 `onEdgeAdded`——否则又回到「库内单测绿、生产链路上没人读」。
 */

import { describe, expect, it } from 'vitest';
import { XuanjiAdapter } from '../../src/shared/analysis/XuanjiAdapter.ts';
import {
  INCREMENTAL_WORK_BUDGET,
  wasLastIncrementalDegraded,
} from '../../src/xuanji/index/incremental.ts';
import type { PathRule } from '../../src/xuanji/core/path-rule.ts';
import { CLUSTER, PATH_FINDER } from '../../src/shared/constants.ts';
import { makeEdge, makeNode } from '../helpers.ts';

/** 全部边类型是 call 的规则（适配层两条内联读法同款形状）。 */
function denseRule(): PathRule {
  return {
    name: 'dense',
    version: 1,
    start: () => true,
    edgeTypes: new Set(['call']),
    lMin: 1,
    lMax: 8,
    simple: true,
    normalize: 'none',
  };
}

/**
 * 9 节点**几乎**完全的有向图（只缺 n0→n1）：
 * 补上那条边时，反向前缀的数量是 sum_{k=0}^{8} P(8,k) ≈ 109 601，必然在 50 000 次展开内超预算。
 * 这是「合法但足够稠密」的图，不是构造出来的非法输入。
 */
function denseGraphData() {
  const ids = Array.from({ length: 9 }, (_, i) => `n${i}`);
  const nodes = ids.map((id, i) => makeNode(id, id, 'function', `${id}.ts`, i + 1));
  const edges = [];
  let seq = 0;
  for (const source of ids) {
    for (const target of ids) {
      if (source === target) continue;
      if (source === 'n0' && target === 'n1') continue;
      edges.push(makeEdge(`e${seq++}`, source, target, 'call'));
    }
  }
  return { nodes, edges };
}

function smallGraphData() {
  return {
    nodes: [makeNode('a', 'a', 'function', 'a.ts', 1), makeNode('b', 'b', 'function', 'b.ts', 2)],
    edges: [makeEdge('e1', 'a', 'b', 'call')],
  };
}

describe('XJ-11 阈值与图上界成对校验', () => {
  it('增量预算不得低于宿主允许送入的最大图（否则大图一做增量就必然降级）', () => {
    // 预算单位是「展开次数」，线性链上至少 |V| 次；宿主把所有超过 MAX_NODES_FOR_BFS 的图
    // 直接拒绝（tools.ts），所以预算是这条门线的下界：低于它 = 合法输入必降级。
    expect(INCREMENTAL_WORK_BUDGET).toBeGreaterThanOrEqual(PATH_FINDER.MAX_NODES_FOR_BFS);
  });

  it('显示层上界远小于预算（用户看得见的图不会卡在降级边缘）', () => {
    expect(CLUSTER.MAX_VISIBLE_NODES).toBeLessThan(PATH_FINDER.MAX_NODES_FOR_BFS);
    expect(CLUSTER.MAX_VISIBLE_NODES * 10).toBeLessThan(INCREMENTAL_WORK_BUDGET);
  });

  it('预算是正整数（0 会让每次增量都降级，负值会让 spend 立即抛哨兵）', () => {
    expect(Number.isInteger(INCREMENTAL_WORK_BUDGET)).toBe(true);
    expect(INCREMENTAL_WORK_BUDGET).toBeGreaterThan(0);
  });
});

describe('XJ-11 适配层实测：A 降级不被 B 的正常增量清掉', () => {
  it('A（稠密图）降级 ⇒ degradedRules 含规则名；随后 B 正常增量，A 的信号仍为 true', () => {
    // A：稠密图 + 一条补边，触发预算降级
    const adapterA = new XuanjiAdapter();
    adapterA.loadGraph(denseGraphData());
    const registration = adapterA.registerRule(denseRule());
    expect(registration.validation.errors).toEqual([]);
    expect(registration.index).not.toBeNull();
    const indexA = adapterA.getIndex('dense')!;

    const resultA = adapterA.applyDelta({
      addedNodes: [],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [makeEdge('extra', 'n0', 'n1', 'call')],
      removedEdges: [],
      modifiedEdges: [],
    });
    expect(resultA.degradedRules).toContain('dense');
    expect(wasLastIncrementalDegraded(indexA)).toBe(true);

    // B：另一个仓库的小图，做一次正常的增量（不超预算）
    const adapterB = new XuanjiAdapter();
    adapterB.loadGraph(smallGraphData());
    adapterB.registerRule(denseRule());
    const indexB = adapterB.getIndex('dense')!;
    const resultB = adapterB.applyDelta({
      addedNodes: [],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [makeEdge('e2', 'b', 'a', 'call')],
      removedEdges: [],
      modifiedEdges: [],
    });
    expect(resultB.degradedRules).toEqual([]);
    expect(wasLastIncrementalDegraded(indexB)).toBe(false);

    // 关键断言：B 的调用**没有**清掉 A 的降级信号（旧实现是模块级 let，这里必红）。
    expect(wasLastIncrementalDegraded(indexA)).toBe(true);
  });
});
