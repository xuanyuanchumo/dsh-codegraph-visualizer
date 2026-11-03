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

describe('computeDensity', () => {
  it('空图密度为 0', () => {
    expect(computeDensity(0, 0)).toBe(0);
  });

  it('单节点密度为 0', () => {
    expect(computeDensity(1, 0)).toBe(0);
  });

  it('完全图密度为 1', () => {
    // 3 节点完全图 = 3 条边
    expect(computeDensity(3, 3)).toBe(1);
  });

  it('空图（2节点0边）密度为 0', () => {
    expect(computeDensity(2, 0)).toBe(0);
  });

  it('单条边密度正确', () => {
    // 3 节点 1 条边：可能边数 = 3*2/2 = 3
    expect(computeDensity(3, 1)).toBeCloseTo(1 / 3, 5);
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

  it('单节点 PageRank 为 0.15（阻尼系数 0.85）', () => {
    // PageRank 公式：(1-damping)/n + damping * sum(...)。单节点无出边 ⇒ (1-0.85)/1 = 0.15
    const adj = buildAdj([makeNode('a')], []);
    const pr = computePageRank(adj);
    expect(pr.get('a')).toBeCloseTo(0.15, 5);
  });

  it('两个节点互相指向 PageRank 相等', () => {
    const adj = buildAdj(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b'), makeEdge('b', 'a')],
    );
    const pr = computePageRank(adj);
    expect(pr.get('a')).toBeCloseTo(pr.get('b'), 5);
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
