/**
 * 图距离统计——直径 / 平均最短路径（cycle-141 拆分）。
 *
 * 从 graphMetrics.ts 拆出（复杂度治理）。全源 BFS，大图时采样源节点。
 * 断开的图返回 `null`（直径在非连通图上无定义）。
 */
import type { AdjacencyList } from './types.ts';
import { bfsShortestPaths } from './brandes.ts';

export interface DistanceStats {
  diameter: number | null;
  avgShortestPath: number | null;
  /** true = 大图采样源，直径是上界估计而非精确值。 */
  sampled: boolean;
}

/**
 * 图的直径与平均最短路径——BFS 全源（大图时采样源节点）。
 *
 * 断开的图返回 `null`（直径在非连通图上无定义）。大图时只从部分源做 BFS，
 * 直径是**上界估计**——如实标注，不假装精确。
 */
export function computeDistanceStats(
  adj: AdjacencyList,
  maxSample = 200,
): DistanceStats {
  const nodes = [...adj.all.keys()];
  const n = nodes.length;
  if (n === 0) return { diameter: null, avgShortestPath: null, sampled: false };

  const sources = n <= maxSample
    ? nodes
    : nodes.filter((_, i) => i % Math.ceil(n / maxSample) === 0).slice(0, maxSample);

  let maxDist = 0;
  let totalDist = 0;
  let pairs = 0;
  let disconnected = false;

  for (const s of sources) {
    const dist = bfsShortestPaths(adj, s).dist;
    for (const t of nodes) {
      if (t === s) continue;
      if (!dist.has(t)) { disconnected = true; continue; }
      const d = dist.get(t)!;
      if (d > maxDist) maxDist = d;
      totalDist += d;
      pairs++;
    }
  }

  if (disconnected || pairs === 0) return { diameter: null, avgShortestPath: null, sampled: sources.length < n };
  return { diameter: maxDist, avgShortestPath: totalDist / pairs, sampled: sources.length < n };
}
