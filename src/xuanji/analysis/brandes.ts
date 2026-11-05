/**
 * 介数中心性——真实无向 Brandes 算法（cycle-141）。
 *
 * ## 旧实现为什么是错的
 *
 * 旧代码 BFS 沿有向出边走、回溯用无向邻接、只累加距离 ≤ 2 的路径、用固定
 * 0.5/0.25 系数——既不是无向 Brandes 也不是有向 Brandes，Top 榜数学上无意义。
 *
 * ## 新实现的口径
 *
 * - 在**无向投影**（`adj.all`）上做 Brandes：BFS 产出距离 / 最短路径数 σ /
 *   前驱 / 出栈顺序，再用 SPLIT 逆序做依赖累加 δ(s,v) = Σ (σ(s,v)/σ(s,w))·(1+δ(s,w))。
 * - 归一化：无向图每个无序对被算两次，故 `BC_norm(v) = BC_raw(v) / ((n-1)(n-2))`。
 * - 采样：大图时等距步长取源节点（无模偏差），`sampleSize` 不会超过节点数；
 *   采样时按 `n / sampleSize` 放大估计，并如实返回 `approximate: true`。
 *
 * 复杂度 O(sampleSize · (V + E))。从 graphMetrics.ts 拆出（cycle-141 复杂度治理）。
 */
import type { AdjacencyList } from './types.ts';

/** BFS 最短路径计数——Brandes 算法的第一步。 */
export interface BfsResult {
  dist: Map<string, number>;
  sigma: Map<string, number>;
  pred: Map<string, string[]>;
  stack: string[];
}

/**
 * BFS 从 start 出发，产出距离 / 最短路径数 σ / 前驱 / SPLIT 出栈顺序。
 * 四个量缺一不可——只有距离无法做依赖累加，只有 σ 无法做比例分摊。
 */
export function bfsShortestPaths(adj: AdjacencyList, start: string): BfsResult {
  const dist = new Map<string, number>();
  const sigma = new Map<string, number>();
  const pred = new Map<string, string[]>();
  const stack: string[] = [];
  dist.set(start, 0);
  sigma.set(start, 1);
  const queue: string[] = [start];

  while (queue.length > 0) {
    const v = queue.shift()!;
    stack.push(v);
    const neighbors = adj.all.get(v);
    if (!neighbors) continue;
    for (const w of neighbors) {
      // 首次到达：设置距离、初始化 σ 与前驱。
      if (!dist.has(w)) {
        dist.set(w, (dist.get(v) ?? 0) + 1);
        sigma.set(w, 0);
        pred.set(w, []);
        queue.push(w);
      }
      // 等距前驱：累加最短路径数并记录前驱。
      if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
        sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
        pred.get(w)!.push(v);
      }
    }
  }
  return { dist, sigma, pred, stack };
}

/** 介数中心性的返回值——附带采样信息以便调用方如实披露。 */
export interface BetweennessResult {
  centrality: Map<string, number>;
  /** 实际做 BFS 的源节点数（< 节点总数时表示近似）。 */
  sampleSize: number;
  /** true = 采样近似，结果不代表全图精确值。 */
  approximate: boolean;
}

/**
 * 介数中心性——真实的无向 Brandes 算法。
 *
 * 在无向投影上做 BFS + SPLIT 依赖累加，归一化 `2/((n-1)(n-2))`。
 * 大图采样时用等距步长（无偏），并如实返回 `approximate`。
 *
 * ## sampleRate 必须有预算，不能默认全量（cycle-141 第四轮）
 *
 * 本函数自拆出以来 `sampleRate` 默认 1.0，而**唯一生产调用点**（`graphMetrics.ts`
 * 的 `computeBetweennessCentrality(adj)`）从不传它——8393 节点的真实仓库上
 * 8393 源 × 全图 BFS 让 `manage/metrics` 路由实测 **65.4s**（真机 3085 沙箱
 * 2026-11-05）。`distance.ts` 的 `computeDistanceStats` 有 `maxSample=200`
 * 上界而这里没有，同一文件族两种纪律。采样基础设施（等距步长 / approximate
 * 披露）早已齐备，缺的只是调用点把预算接上。
 *
 * 归一化与放大估计已按「采样时乘 n/sampleSize」实现，样本数变化不影响正确性——
 * 只影响精度（上界估计，如实标注 approximate）。maxSample 的量级与
 * `computeDistanceStats.maxSample` 一致：两条指标共享同一批 BFS 成本特征，
 * 「近似披露」在 UI 上口径统一。
 */
export function computeBetweennessCentrality(
  adj: AdjacencyList,
  sampleRate = 1.0,
  maxSample: number | null = 200,
): BetweennessResult {
  const allNodes = [...adj.all.keys()];
  const n = allNodes.length;
  const centrality = new Map<string, number>();
  for (const id of allNodes) centrality.set(id, 0);

  if (n < 3) {
    // n < 3 时不存在「经过某节点的最短路径」，介数恒为 0。
    return { centrality, sampleSize: 0, approximate: false };
  }

  // 无偏确定性采样：等距步长取 index，避免旧实现的模 233280 偏差。
  // maxSample（显式 null = 不设上界，保持旧全量行为的逃生口）与 sampleRate
  // 取交集：先按比例、再封顶——两个旋钮各自语义不变。
  const byRate = Math.max(1, Math.floor(n * sampleRate));
  const sampleSize = maxSample === null ? Math.min(n, byRate) : Math.min(n, byRate, maxSample);
  const indices: number[] = [];
  if (sampleSize >= n) {
    for (let i = 0; i < n; i++) indices.push(i);
  } else {
    const stride = n / sampleSize;
    for (let i = 0; i < sampleSize; i++) indices.push(Math.floor(i * stride));
  }

  for (const startIdx of indices) {
    const start = allNodes[startIdx];
    if (!start) continue;
    const { sigma, pred, stack } = bfsShortestPaths(adj, start);

    // SPLIT：按 BFS 逆序累加依赖。
    const delta = new Map<string, number>();
    for (const id of allNodes) delta.set(id, 0);

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? []) {
        const sigmaW = sigma.get(w) ?? 0;
        if (sigmaW > 0) {
          delta.set(v, (delta.get(v) ?? 0) + ((sigma.get(v) ?? 0) / sigmaW) * (1 + (delta.get(w) ?? 0)));
        }
      }
      if (w !== start) {
        centrality.set(w, (centrality.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }

  // 归一化：BC_norm(v) = BC_raw(v) / ((n-1)(n-2))；采样时乘以 n/sampleSize 放大估计。
  const denom = (n - 1) * (n - 2);
  const scale = sampleSize > 0 ? n / sampleSize : 1;
  const factor = scale / denom;
  for (const [id, val] of centrality) {
    centrality.set(id, val * factor);
  }

  return { centrality, sampleSize, approximate: sampleSize < n };
}
