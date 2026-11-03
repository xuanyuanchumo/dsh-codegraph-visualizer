/**
 * 图指标计算（cycle-141 原生代码图谱业务增强）。
 *
 * ## 设计原则
 *
 * 1. **纯函数**：无副作用、无 DOM/React 依赖，可在 Node 和浏览器两端运行。
 * 2. **O(V+E) 有界**：所有算法在稀疏图上（代码图谱的典型形态）接近线性复杂度。
 * 3. **流式友好**：输入是节点/边数组而非图对象，避免隐式图构建。
 *
 * ## 数学模型
 *
 * - **密度** (density)：实际边数 / 可能边数，衡量图的连通程度。
 * - **聚类系数** (clustering coefficient)：节点邻居间实际边数 / 可能边数，衡量「物以类聚」。
 * - **介数中心性** (betweenness centrality)：经过该节点的最短路径比例，衡量「咽喉要道」。
 * - **PageRank**：基于随机游走的节点重要性排名。
 * - **度数分布** (degree distribution)：幂律检验（代码图谱通常呈长尾分布）。
 *
 * ## 数据结构与算法
 *
 * - **邻接表** (AdjacencyList)：代码图谱的稀疏性决定了邻接表优于邻接矩阵。
 * - **BFS 最短路径**：无权图的最短路径（代码调用链的典型形态）。
 * - **Dijkstra 变体**：加权最短路径（预留，当前用于无权图）。
 * - **Louvain 社区检测**（简化版）：基于模块度的贪心合并。
 */

/** 最小节点类型——只含图指标需要的字段。定义在库内以满足自包含约束。 */
interface MetricNode {
  id: string;
  label?: string;
  type?: string;
  filePath?: string;
  lineNumber?: number;
  properties?: Record<string, unknown>;
}

/** 最小边类型——只含图指标需要的字段。 */
interface MetricEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  properties?: Record<string, unknown>;
}

/** 邻接表：节点 id → 邻居 id 集合。 */
interface AdjacencyList {
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
  all: Map<string, Set<string>>;
}

/** 构建邻接表——一次遍历即可。 */
function buildAdjacencyList(nodes: MetricNode[], edges: MetricEdge[]): AdjacencyList {
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

/** 图密度：实际边数 / 可能边数。完全图的密度为 1，空图为 0。 */
export function computeDensity(nodeCount: number, edgeCount: number): number {
  if (nodeCount < 2) return 0;
  const possible = nodeCount * (nodeCount - 1) / 2;
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
 * BFS 最短路径计数——用于介数中心性的近似计算。
 * 返回从 start 到所有可达节点的距离。
 */
function bfsDistances(adj: AdjacencyList, start: string): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(start, 0);
  const queue: string[] = [start];
  const visited = new Set<string>([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.out.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        distances.set(neighbor, distances.get(current)! + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

/**
 * 介数中心性（近似）：统计经过每个节点的最短路径比例。
 * 使用 Brandes 算法的简化版——只计算无向图的近似值。
 * 复杂度 O(V·(V+E))，对于大图可启用采样模式。
 */
export function computeBetweennessCentrality(
  adj: AdjacencyList,
  sampleRate = 1.0,
): Map<string, number> {
  const centrality = new Map<string, number>();
  for (const id of adj.all.keys()) centrality.set(id, 0);

  const allNodes = [...adj.all.keys()];
  // 采样：大图时只对部分节点做 BFS
  const sampleSize = Math.min(allNodes.length, Math.max(50, Math.floor(allNodes.length * sampleRate)));
  const indices = new Set<number>();
  for (let i = 0; i < sampleSize; i++) indices.add(Math.floor((i * 9301 + 49297) % 233280) % allNodes.length);

  for (const startIdx of indices) {
    const start = allNodes[startIdx];
    if (!start) continue;
    const distances = bfsDistances(adj, start);
    // 对每个可达节点，回溯路径累加介数
    const reachable = [...distances.keys()].filter((id) => id !== start);
    for (const target of reachable) {
      const dist = distances.get(target)!;
      if (dist === 1) {
        centrality.set(start, (centrality.get(start) ?? 0) + 0.5);
      }
      // 简化：只累加距离为 1 和 2 的路径
      if (dist <= 2) {
        const midNeighbors = adj.all.get(target);
        if (midNeighbors) {
          for (const mid of midNeighbors) {
            if (mid !== start && (distances.get(mid) ?? Infinity) === dist - 1) {
              centrality.set(mid, (centrality.get(mid) ?? 0) + 0.25);
            }
          }
        }
      }
    }
  }

  // 归一化
  const factor = 1 / Math.max(1, sampleSize);
  for (const [id, val] of centrality) {
    centrality.set(id, val * factor);
  }
  return centrality;
}

/**
 * PageRank：基于随机游走的节点重要性排名。
 * 迭代收敛，阻尼系数 0.85（标准值）。
 * 复杂度 O(iterations × E)。
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

    for (const id of nodeIds) {
      const outNeighbors = adj.out.get(id);
      if (!outNeighbors || outNeighbors.size === 0) continue;
      const share = damping * (rank.get(id)! ?? 0) / outNeighbors.size;
      for (const neighbor of outNeighbors) {
        next.set(neighbor, (next.get(neighbor) ?? 0) + share);
      }
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
  const maxDeg = Math.max(...degrees);
  const minDeg = Math.min(...degrees);
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
}

/** 计算完整的图指标。 */
export function computeGraphMetrics(nodes: MetricNode[], edges: MetricEdge[]): GraphMetrics {
  const adj = buildAdjacencyList(nodes, edges);
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  const density = computeDensity(nodeCount, edgeCount);
  const avgClustering = computeAverageClustering(adj);
  const betweenness = computeBetweennessCentrality(adj);
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
  };
}
