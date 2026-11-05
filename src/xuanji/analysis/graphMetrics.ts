/**
 * 图指标计算（cycle-141 原生代码图谱业务增强；cycle-141 第二轮复杂度治理拆分）。
 *
 * ## 模块化拆分（cycle-141 第二轮）
 *
 * 原文件因新增 8 项图论指标后复杂度 score 132 > upperBand 115，成为全仓 #1
 * 复杂度热点。按「一域一文件、单文件 ≤~250 行」的纪律拆分为：
 *
 * | 模块 | 内容 |
 * |---|---|
 * | `types.ts` | MetricNode / MetricEdge / AdjacencyList（跨模块共享类型） |
 * | `brandes.ts` | 介数中心性（真实无向 Brandes + SPLIT 依赖累加） |
 * | `connectivity.ts` | WCC / SCC(Kosaraju) / 关节点(Tarjan) |
 * | `distance.ts` | 直径 / 平均最短路径（全源 BFS，大图采样） |
 * | `community.ts` | 模块度（单层贪心 Louvain）/ k-core |
 * | `graphMetrics.ts`（本文件） | 密度 / 聚类系数 / PageRank / 度数分布 + 编排 |
 *
 * 本文件**重新导出**全部子模块的公开 API，保持调用方（路由、测试、文档）零改动。
 *
 * ## 数学模型
 *
 * - **密度** (density)：实际边数 / 可能边数（**有向**口径，代码图边是 call/import）。
 * - **聚类系数** (clustering coefficient)：节点邻居间实际边数 / 可能边数。
 * - **介数中心性**：真实无向 Brandes（见 brandes.ts）。
 * - **PageRank**：随机游走排名，悬挂节点质量平均重分配（质量守恒）。
 * - **度数分布**：幂律检验（代码图谱通常呈长尾分布）。
 * - **连通性 / 关节点 / 直径 / 模块度 / 圈复杂度 / k-core**：见各子模块。
 *
 * ## 数据结构与算法
 *
 * - **邻接表** (AdjacencyList)：代码图谱的稀疏性决定了邻接表优于邻接矩阵。
 * - **BFS / Kosaraju / Tarjan**：线性时间图算法。
 * - **贪心模块度优化**：单层 Louvain 近似。
 *
 * 注：**不实现**加权最短路径（Dijkstra 变体）——代码图当前无边权，
 * 预留声明不提供任何功能，故不写进本文件（避免空头承诺）。
 *
 * 库边界自包含约束：所有 import 必须留在 `src/xuanji` 内。
 *
 * @module xuanji/analysis/graphMetrics
 */

import type { AdjacencyList, MetricNode, MetricEdge } from './types.ts';
import { computeBetweennessCentrality } from './brandes.ts';
import {
  countWeaklyConnectedComponents,
  countStronglyConnectedComponents,
  countArticulationPoints,
} from './connectivity.ts';
import { computeDistanceStats } from './distance.ts';
import { computeModularity, computeKCore } from './community.ts';

/**
 * BFS 采样源的统一预算（cycle-141 第四轮）。
 *
 * 真机量化（8393 节点仓库）：介数全量（8393 源 × 全图 BFS）实测 65.4s，
 * `manage/metrics` 路由从「即时」退化为「一分钟白屏」。200 源与
 * `computeDistanceStats.maxSample` 同量级——两条近似指标共享同一口径，
 * 采样是上界估计且响应里如实披露（`betweennessApproximate` / `sampled`）。
 *
 * 常量放在 xuanji 库内而不是宿主 `shared/constants.ts`：库边界契约
 * （libraryBoundary）要求 xuanji 零宿主依赖，预算是算法自身的成本特征，
 * 属于库的语义而非宿主配置。
 */
const BFS_SAMPLE_SOURCES = 200;

// ── 重新导出：保持调用方零改动 ──────────────────────────────────────────
export type { MetricNode, MetricEdge, AdjacencyList } from './types.ts';
export {
  computeBetweennessCentrality,
  bfsShortestPaths,
  type BetweennessResult,
  type BfsResult,
} from './brandes.ts';
export {
  countWeaklyConnectedComponents,
  countStronglyConnectedComponents,
  countArticulationPoints,
} from './connectivity.ts';
export { computeDistanceStats, type DistanceStats } from './distance.ts';
export { computeModularity, computeKCore } from './community.ts';

/** 构建邻接表——一次遍历即可。 */
export function buildAdjacencyList(nodes: MetricNode[], edges: MetricEdge[]): AdjacencyList {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const all = new Map<string, Set<string>>();
  for (const n of nodes) {
    out.set(n.id, new Set());
    inn.set(n.id, new Set());
    all.set(n.id, new Set());
  }
  for (const e of edges) {
    if (!out.has(e.source) || !inn.has(e.target)) continue;
    out.get(e.source)!.add(e.target);
    inn.get(e.target)!.add(e.source);
    all.get(e.source)!.add(e.target);
    all.get(e.target)!.add(e.source);
  }
  return { out, in: inn, all };
}

/**
 * 图密度：实际边数 / 可能边数。完全图的密度为 1，空图为 0。
 *
 * ## 有向语义（cycle-141 P0 修复）
 *
 * 代码图谱的边是**有向**的（call / import / extend …），但旧实现用无向可能边数
 * `n(n-1)/2` 作分母——同一张图按有向算是无向的两倍，且没有任何声明说明用的是
 * 哪种口径。两种口径相差 2 倍，用户无法判断「密度 0.3」意味着什么。
 *
 * 修法：改用**有向**可能边数 `n(n-1)`。这是代码图的正确口径；若将来需要无向
 * 密度，应显式新增一个函数而不是悄悄改分母。
 */
export function computeDensity(nodeCount: number, edgeCount: number): number {
  if (nodeCount < 2) return 0;
  const possible = nodeCount * (nodeCount - 1);
  return Math.min(1, edgeCount / possible);
}

/**
 * 局部聚类系数：节点邻居间实际边数 / 可能边数。
 * 邻居数 < 2 时返回 0（无法形成三角形）。
 */
export function computeClusteringCoefficient(adj: AdjacencyList, nodeId: string): number {
  const neighbors = adj.all.get(nodeId);
  if (!neighbors || neighbors.size < 2) return 0;
  const neighborList = [...neighbors];
  let actualEdges = 0;
  for (let i = 0; i < neighborList.length; i++) {
    for (let j = i + 1; j < neighborList.length; j++) {
      if (adj.all.get(neighborList[i]!)!.has(neighborList[j]!)) actualEdges++;
    }
  }
  const possible = neighborList.length * (neighborList.length - 1) / 2;
  return possible > 0 ? actualEdges / possible : 0;
}

/** 全局平均聚类系数。 */
export function computeAverageClustering(adj: AdjacencyList): number {
  if (adj.all.size === 0) return 0;
  let sum = 0;
  for (const id of adj.all.keys()) {
    sum += computeClusteringCoefficient(adj, id);
  }
  return sum / adj.all.size;
}

/**
 * PageRank：基于随机游走的节点重要性排名。
 * 迭代收敛，阻尼系数 0.85（标准值）。复杂度 O(iterations × E)。
 *
 * ## 悬挂节点质量守恒（cycle-141 P0 修复）
 *
 * 旧实现对出度为 0 的节点直接 `continue`，其 `damping × rank` 质量**每轮丢失**，
 * 于是总质量逐轮衰减、排名整体失真——收敛判据以 n 缩放，恰好掩盖了不归一。
 *
 * 标准做法：悬挂节点不流出质量，而是把 `damping × rank` **平均重分配给所有节点**。
 * 这样每轮总质量恒为 1（(1-damping) 的 teleport + damping×1 的重分配），
 * 排名与「图是否连通」解耦。修复后 `pageRankMass ≈ 1` 是可断言的守恒见证。
 */
export function computePageRank(
  adj: AdjacencyList,
  damping = 0.85,
  iterations = 20,
  epsilon = 1e-6,
): Map<string, number> {
  const nodeIds = [...adj.all.keys()];
  const n = nodeIds.length;
  if (n === 0) return new Map();

  const rank = new Map<string, number>();
  for (const id of nodeIds) rank.set(id, 1 / n);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    let diff = 0;
    for (const id of nodeIds) next.set(id, (1 - damping) / n);

    // 收集悬挂节点（出度 0）的质量，稍后平均重分配。
    let danglingMass = 0;
    for (const id of nodeIds) {
      const outNeighbors = adj.out.get(id);
      if (!outNeighbors || outNeighbors.size === 0) {
        // 悬挂节点：质量不流出，收集后平均重分配（cycle-141 质量守恒修复）。
        danglingMass += damping * (rank.get(id) ?? 0);
        continue;
      }
      const share = damping * (rank.get(id)! ?? 0) / outNeighbors.size;
      for (const neighbor of outNeighbors) {
        next.set(neighbor, (next.get(neighbor) ?? 0) + share);
      }
    }

    // 悬挂质量平均重分配给所有节点——每轮总质量恒为 1。
    if (danglingMass > 0) {
      const danglingShare = danglingMass / n;
      for (const id of nodeIds) next.set(id, (next.get(id) ?? 0) + danglingShare);
    }

    for (const id of nodeIds) {
      diff += Math.abs((next.get(id) ?? 0) - (rank.get(id) ?? 0));
      rank.set(id, next.get(id) ?? 0);
    }
    if (diff < epsilon * n) break;
  }

  return rank;
}

/** 度数分布：返回每个节点的出度和入度。 */
export function computeDegreeDistribution(adj: AdjacencyList): {
  outDegrees: Map<string, number>;
  inDegrees: Map<string, number>;
} {
  const outDegrees = new Map<string, number>();
  const inDegrees = new Map<string, number>();
  for (const [id, neighbors] of adj.out) outDegrees.set(id, neighbors.size);
  for (const [id, neighbors] of adj.in) inDegrees.set(id, neighbors.size);
  return { outDegrees, inDegrees };
}

/**
 * 度数分布的幂律检验（简化版）。
 * 返回 { alpha, isPowerLaw, maxDegree, minDegree }。
 * alpha 越接近 1 越接近幂律分布（代码图谱通常 alpha ≈ 2-3）。
 */
export function analyzeDegreeDistribution(outDegrees: Map<string, number>): {
  alpha: number;
  isPowerLaw: boolean;
  maxDegree: number;
  minDegree: number;
  meanDegree: number;
} {
  const degrees = [...outDegrees.values()].filter((d) => d > 0);
  if (degrees.length < 10) {
    return { alpha: 0, isPowerLaw: false, maxDegree: 0, minDegree: 0, meanDegree: 0 };
  }
  // 用 reduce 而非 Math.max(...degrees)：后者在超大数组上有栈风险。
  const maxDeg = degrees.reduce((a, b) => (b > a ? b : a), 0);
  const minDeg = degrees.reduce((a, b) => (b < a ? b : a), degrees[0]!);
  const meanDeg = degrees.reduce((a, b) => a + b, 0) / degrees.length;

  // 简化幂律拟合：对 log(degree) vs log(rank) 做线性回归
  const sorted = [...degrees].sort((a, b) => b - a);
  const logDeg: number[] = [];
  const logRank: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]! > 0) {
      logDeg.push(Math.log(sorted[i]!));
      logRank.push(Math.log(i + 1));
    }
  }
  const n = logDeg.length;
  if (n < 5) return { alpha: 0, isPowerLaw: false, maxDegree: maxDeg, minDegree: minDeg, meanDegree: meanDeg };

  const meanX = logRank.reduce((a, b) => a + b, 0) / n;
  const meanY = logDeg.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (logRank[i]! - meanX) * (logDeg[i]! - meanY);
    den += (logRank[i]! - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const alpha = -slope;
  return { alpha, isPowerLaw: alpha > 1 && alpha < 4, maxDegree: maxDeg, minDegree: minDeg, meanDegree: meanDeg };
}

/** 图指标汇总。 */
export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  avgClustering: number;
  betweenness: Map<string, number>;
  pageRank: Map<string, number>;
  degreeDistribution: {
    alpha: number;
    isPowerLaw: boolean;
    maxDegree: number;
    minDegree: number;
    meanDegree: number;
  };
  topBetweenness: Array<{ id: string; value: number }>;
  topPageRank: Array<{ id: string; value: number }>;
  /** cycle-141 附加：介数采样的源节点数（< 节点总数 = 近似）。 */
  betweennessSampleSize: number;
  betweennessApproximate: boolean;
  /** PageRank 总质量——应 ≈ 1，是悬挂质量守恒的见证。 */
  pageRankMass: number;
  /** 弱/强连通分量数。 */
  components: { weaklyConnected: number; stronglyConnected: number };
  /** 关节点（咽喉）数。 */
  articulationPoints: number;
  /** 直径（断开图 null）。 */
  diameter: number | null;
  /** 平均最短路径（断开图 null）。 */
  avgShortestPath: number | null;
  /** 模块度 Q ∈ [-0.5, 1]（单层贪心 Louvain 近似）。 */
  modularity: number;
  /** 圈复杂度 = E − N + P（P = 弱连通分量数）。 */
  cyclomaticNumber: number;
  /** k-core 的最大 k。 */
  kCore: number;
}

/** 计算完整的图指标。 */
export function computeGraphMetrics(nodes: MetricNode[], edges: MetricEdge[]): GraphMetrics {
  const adj = buildAdjacencyList(nodes, edges);
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  const density = computeDensity(nodeCount, edgeCount);
  const avgClustering = computeAverageClustering(adj);
  // 采样预算（cycle-141 第四轮）：maxSample: null 表示「调用方明确不封顶」，
  // 这里必须封顶——真机 8393 节点全量 Brandes 实测 65.4s。近似结果经由
  // betweennessSampleSize/betweennessApproximate 如实披露，预算语义见 BFS_SAMPLE_SOURCES。
  const betweennessResult = computeBetweennessCentrality(adj, 1.0, BFS_SAMPLE_SOURCES);
  const betweenness = betweennessResult.centrality;
  const pageRank = computePageRank(adj);
  const { outDegrees } = computeDegreeDistribution(adj);
  const degreeStats = analyzeDegreeDistribution(outDegrees);

  const topBetweenness = [...betweenness.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, value]) => ({ id, value }));

  const topPageRank = [...pageRank.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, value]) => ({ id, value }));

  // cycle-141 附加图论指标（全部纯函数、库内自包含）。
  const components = {
    weaklyConnected: countWeaklyConnectedComponents(adj),
    stronglyConnected: countStronglyConnectedComponents(adj),
  };
  const articulationPoints = countArticulationPoints(adj);
  const distStats = computeDistanceStats(adj);
  const modularity = computeModularity(adj);
  const cyclomaticNumber = edgeCount - nodeCount + components.weaklyConnected;
  const kCore = computeKCore(adj);

  // PageRank 总质量——悬挂质量守恒的见证（应 ≈ 1）。
  let pageRankMass = 0;
  for (const v of pageRank.values()) pageRankMass += v;

  return {
    nodeCount,
    edgeCount,
    density,
    avgClustering,
    betweenness,
    pageRank,
    degreeDistribution: degreeStats,
    topBetweenness,
    topPageRank,
    betweennessSampleSize: betweennessResult.sampleSize,
    betweennessApproximate: betweennessResult.approximate,
    pageRankMass,
    components,
    articulationPoints,
    diameter: distStats.diameter,
    avgShortestPath: distStats.avgShortestPath,
    modularity,
    cyclomaticNumber,
    kCore,
  };
}
