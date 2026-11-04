/**
 * graphMetrics 单元测试（cycle-141 原生代码图谱业务增强）。
 *
 * 覆盖：密度、聚类系数、介数中心性、PageRank、度数分布幂律检验。
 * 纯函数测试——无 DOM/React 依赖。
 */

import { describe, it, expect } from 'vitest';
import {
  computeDensity,
  computeClusteringCoefficient,
  computeAverageClustering,
  computeBetweennessCentrality,
  computePageRank,
  computeDegreeDistribution,
  analyzeDegreeDistribution,
  computeGraphMetrics,
} from '../../../src/xuanji/analysis/graphMetrics.ts';
import type { MetricNode, MetricEdge } from '../../../src/xuanji/analysis/graphMetrics.ts';

function makeNode(id: string): MetricNode {
  return { id, label: id, type: 'function' };
}

function makeEdge(source: string, target: string): MetricEdge {
  return { id: `${source}->${target}`, source, target, type: 'call' };
}

/** 模块级邻接表构造器（与 graphMetrics 内部 buildAdjacencyList 同形）。 */
function buildAdj(nodes: MetricNode[], edges: MetricEdge[]) {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const all = new Map<string, Set<string>>();
  for (const n of nodes) {
    out.set(n.id, new Set());
    inn.set(n.id, new Set());
    all.set(n.id, new Set());
  }
  for (const e of edges) {
    out.get(e.source)!.add(e.target);
    inn.get(e.target)!.add(e.source);
    all.get(e.source)!.add(e.target);
    all.get(e.target)!.add(e.source);
  }
  return { out, in: inn, all };
}

describe('computeDensity', () => {
  it('空图密度为 0', () => {
    expect(computeDensity(0, 0)).toBe(0);
  });

  it('单节点密度为 0', () => {
    expect(computeDensity(1, 0)).toBe(0);
  });

  it('有向完全图密度为 1（cycle-141 有向口径修复）', () => {
    // 3 节点有向完全图 = 6 条边（每个节点指向其余 2 个）
    expect(computeDensity(3, 6)).toBe(1);
  });

  it('空图（2节点0边）密度为 0', () => {
    expect(computeDensity(2, 0)).toBe(0);
  });

  it('单条有向边密度正确', () => {
    // 3 节点 1 条有向边：可能边数 = 3*2 = 6
    expect(computeDensity(3, 1)).toBeCloseTo(1 / 6, 5);
  });

  it('无向边数的一半在有向口径下密度减半（口径可区分）', () => {
    // 旧实现用 n(n-1)/2 = 3 作分母得 1/3；新实现用 n(n-1) = 6 得 1/6。
    // 两者相差 2 倍——这正是「口径未声明」缺陷的量化体现。
    expect(computeDensity(3, 3)).toBeCloseTo(0.5, 5);
  });
});

describe('computeClusteringCoefficient', () => {
  function buildAdj(nodes: MetricNode[], edges: MetricEdge[]) {
    const out = new Map<string, Set<string>>();
    const inn = new Map<string, Set<string>>();
    const all = new Map<string, Set<string>>();
    for (const n of nodes) {
      out.set(n.id, new Set());
      inn.set(n.id, new Set());
      all.set(n.id, new Set());
    }
    for (const e of edges) {
      out.get(e.source)!.add(e.target);
      inn.get(e.target)!.add(e.source);
      all.get(e.source)!.add(e.target);
      all.get(e.target)!.add(e.source);
    }
    return { out, in: inn, all };
  }

  it('孤立节点聚类系数为 0', () => {
    const adj = buildAdj([makeNode('a')], []);
    expect(computeClusteringCoefficient(adj, 'a')).toBe(0);
  });

  it('只有一条边的节点聚类系数为 0（邻居 < 2）', () => {
    const adj = buildAdj([makeNode('a'), makeNode('b')], [makeEdge('a', 'b')]);
    expect(computeClusteringCoefficient(adj, 'a')).toBe(0);
  });

  it('三角形聚类系数为 1', () => {
    // a→b, b→c, c→a（无向图）
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')],
    );
    expect(computeClusteringCoefficient(adj, 'a')).toBe(1);
    expect(computeClusteringCoefficient(adj, 'b')).toBe(1);
    expect(computeClusteringCoefficient(adj, 'c')).toBe(1);
  });

  it('平均聚类系数正确', () => {
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    const avg = computeAverageClustering(adj);
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(1);
  });
});

describe('computePageRank', () => {
  function buildAdj(nodes: MetricNode[], edges: MetricEdge[]) {
    const out = new Map<string, Set<string>>();
    const inn = new Map<string, Set<string>>();
    const all = new Map<string, Set<string>>();
    for (const n of nodes) {
      out.set(n.id, new Set());
      inn.set(n.id, new Set());
      all.set(n.id, new Set());
    }
    for (const e of edges) {
      out.get(e.source)!.add(e.target);
      inn.get(e.target)!.add(e.source);
      all.get(e.source)!.add(e.target);
      all.get(e.target)!.add(e.source);
    }
    return { out, in: inn, all };
  }

  it('空图 PageRank 为空', () => {
    const adj = buildAdj([], []);
    const pr = computePageRank(adj);
    expect(pr.size).toBe(0);
  });

  it('单节点 PageRank 为 1（悬挂质量守恒，cycle-141 修复）', () => {
    // 旧实现把出度 0 节点的 damping×rank 直接丢弃 ⇒ 单节点 rank = (1-damping)/n = 0.15。
    // 修复后悬挂质量平均重分配 ⇒ 单节点承载全部质量 = 1.0。
    const adj = buildAdj([makeNode('a')], []);
    const pr = computePageRank(adj);
    expect(pr.get('a')).toBeCloseTo(1, 5);
  });

  it('悬挂节点质量守恒：总质量 ≈ 1（含出度 0 节点）', () => {
    // a→b→c，d 孤立（出度 0）。旧实现每轮丢失 d 的 damping×rank，总质量衰减。
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    const pr = computePageRank(adj);
    let mass = 0;
    for (const v of pr.values()) mass += v;
    expect(mass).toBeCloseTo(1, 5);
  });

  it('两个节点互相指向 PageRank 相等', () => {
    const adj = buildAdj(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b'), makeEdge('b', 'a')],
    );
    const pr = computePageRank(adj);
    expect(pr.get('a')!).toBeCloseTo(pr.get('b')!, 5);
  });

  it('枢纽节点 PageRank 更高', () => {
    // a 指向所有节点，其他节点只指向 a
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [
        makeEdge('b', 'a'), makeEdge('c', 'a'), makeEdge('d', 'a'),
        makeEdge('a', 'b'),
      ],
    );
    const pr = computePageRank(adj);
    expect(pr.get('a')!).toBeGreaterThan(pr.get('b')!);
  });
});

describe('computeBetweennessCentrality（真实无向 Brandes）', () => {
  it('星形图：中心介数 = 1，叶子 = 0', () => {
    const adj = buildAdj(
      [makeNode('c'), makeNode('l1'), makeNode('l2'), makeNode('l3')],
      [makeEdge('c', 'l1'), makeEdge('c', 'l2'), makeEdge('c', 'l3')],
    );
    const { centrality, sampleSize, approximate } = computeBetweennessCentrality(adj);
    expect(centrality.get('c')).toBeCloseTo(1, 5);
    expect(centrality.get('l1')).toBeCloseTo(0, 5);
    expect(sampleSize).toBe(4);
    expect(approximate).toBe(false);
  });

  it('路径图 P4：内部节点介数 = 2/3，端点 = 0', () => {
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    const { centrality } = computeBetweennessCentrality(adj);
    expect(centrality.get('b')).toBeCloseTo(2 / 3, 5);
    expect(centrality.get('c')).toBeCloseTo(2 / 3, 5);
    expect(centrality.get('a')).toBeCloseTo(0, 5);
    expect(centrality.get('d')).toBeCloseTo(0, 5);
  });

  it('断开图：分量之间不产生介数', () => {
    const adj = buildAdj(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('c', 'd')],
    );
    const { centrality } = computeBetweennessCentrality(adj);
    for (const v of ['a', 'b', 'c', 'd']) expect(centrality.get(v)).toBeCloseTo(0, 5);
  });

  it('小图（<3 节点）介数恒为 0', () => {
    const adj = buildAdj([makeNode('a'), makeNode('b')], [makeEdge('a', 'b')]);
    const { centrality, approximate } = computeBetweennessCentrality(adj);
    expect(centrality.get('a')).toBe(0);
    expect(centrality.get('b')).toBe(0);
    expect(approximate).toBe(false);
  });

  it('采样：sampleRate < 1 时标记 approximate 且 sampleSize < n', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => makeNode(`n${i}`));
    const adj = buildAdj(nodes, [makeEdge('n0', 'n1'), makeEdge('n1', 'n2'), makeEdge('n2', 'n3')]);
    const { sampleSize, approximate } = computeBetweennessCentrality(adj, 0.5);
    expect(sampleSize).toBe(10);
    expect(approximate).toBe(true);
  });
});

describe('cycle-141 附加图论指标', () => {
  it('WCC/SCC 在已知图上正确', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'a'), makeEdge('c', 'd'), makeEdge('d', 'c')],
    );
    expect(m.components.weaklyConnected).toBe(2);
    expect(m.components.stronglyConnected).toBe(2);
  });

  it('关节点：路径的内部节点都是关节点', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    expect(m.articulationPoints).toBe(2); // b, c
  });

  it('圈复杂度 = E − N + P', () => {
    // 树：E=3, N=4, P=1 ⇒ 0
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    expect(m.cyclomaticNumber).toBe(0);
    // 环：E=3, N=3, P=1 ⇒ 1
    const m2 = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')],
    );
    expect(m2.cyclomaticNumber).toBe(1);
  });

  it('k-core：路径的 k-core = 1', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    expect(m.kCore).toBe(1);
  });

  it('pageRankMass ≈ 1（悬挂质量守恒见证）', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    expect(m.pageRankMass).toBeCloseTo(1, 5);
  });

  it('断开图的直径与平均最短路径为 null', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('c', 'd')],
    );
    expect(m.diameter).toBeNull();
    expect(m.avgShortestPath).toBeNull();
  });

  it('模块度在 [-0.5, 1] 区间内', () => {
    const m = computeGraphMetrics(
      [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd')],
    );
    expect(m.modularity).toBeGreaterThanOrEqual(-0.5);
    expect(m.modularity).toBeLessThanOrEqual(1);
  });

  it('介数字段携带采样信息', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`));
    const m = computeGraphMetrics(nodes, [makeEdge('n0', 'n1'), makeEdge('n1', 'n2'), makeEdge('n2', 'n3')]);
    expect(m.betweennessSampleSize).toBe(10);
    expect(m.betweennessApproximate).toBe(false);
  });
});

describe('analyzeDegreeDistribution', () => {
  it('空度数分布返回非幂律', () => {
    const result = analyzeDegreeDistribution(new Map());
    expect(result.isPowerLaw).toBe(false);
    expect(result.alpha).toBe(0);
  });

  it('少量节点返回非幂律', () => {
    const degrees = new Map<string, number>();
    for (let i = 0; i < 5; i++) degrees.set(`n${i}`, i + 1);
    const result = analyzeDegreeDistribution(degrees);
    expect(result.isPowerLaw).toBe(false);
  });

  it('计算最大/最小/平均度（≥10节点）', () => {
    const degrees = new Map<string, number>([
      ['a', 5], ['b', 3], ['c', 1], ['d', 8], ['e', 2], ['f', 4], ['g', 6], ['h', 2], ['i', 3], ['j', 7], ['k', 5],
    ]);
    const result = analyzeDegreeDistribution(degrees);
    expect(result.maxDegree).toBe(8);
    expect(result.minDegree).toBe(1);
    expect(result.meanDegree).toBeCloseTo(4.1818, 4);
  });
});

describe('computeGraphMetrics', () => {
  it('空图返回零指标', () => {
    const metrics = computeGraphMetrics([], []);
    expect(metrics.nodeCount).toBe(0);
    expect(metrics.edgeCount).toBe(0);
    expect(metrics.density).toBe(0);
    expect(metrics.avgClustering).toBe(0);
  });

  it('小图返回完整指标', () => {
    const nodes = [
      makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d'),
    ];
    const edges = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a'), makeEdge('c', 'd'), makeEdge('d', 'a'),
    ];
    const metrics = computeGraphMetrics(nodes, edges);
    expect(metrics.nodeCount).toBe(4);
    expect(metrics.edgeCount).toBe(5);
    expect(metrics.density).toBeGreaterThan(0);
    expect(metrics.avgClustering).toBeGreaterThan(0);
    expect(metrics.topBetweenness.length).toBeGreaterThan(0);
    expect(metrics.topPageRank.length).toBe(4);
  });

  it('度数分布幂律检验在代码图谱上合理', () => {
    // 模拟代码图谱的长尾度数分布
    const nodes: MetricNode[] = [];
    const edges: MetricEdge[] = [];
    const hubId = 'hub';
    nodes.push(makeNode(hubId));
    for (let i = 0; i < 50; i++) {
      const leaf = `leaf${i}`;
      nodes.push(makeNode(leaf));
      edges.push(makeEdge(hubId, leaf));
      if (i % 3 === 0) edges.push(makeEdge(leaf, hubId));
    }
    const metrics = computeGraphMetrics(nodes, edges);
    expect(metrics.nodeCount).toBe(51);
    expect(metrics.edgeCount).toBeGreaterThan(50);
    expect(metrics.topPageRank[0]!.id).toBe(hubId);
  });
});
