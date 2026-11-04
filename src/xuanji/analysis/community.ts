/**
 * 图社区结构——模块度 / k-core（cycle-141 拆分）。
 *
 * 从 graphMetrics.ts 拆出（复杂度治理）。
 * - 模块度：单层贪心 Louvain 近似，Q ∈ [-0.5, 1]。
 * - k-core：反复移除最小度节点，记录过程中的最大「最小度」。
 */
import type { AdjacencyList } from './types.ts';

/**
 * k-core：最大的 k，使得存在一个子图其中每个节点度数 ≥ k。
 *
 * 反复移除最小度节点并更新度数，记录过程中的最大「最小度」。
 * 复杂度 O(V + E)（用优先队列可优化，此处用线性扫描，代码图谱规模可接受）。
 */
export function computeKCore(adj: AdjacencyList): number {
  const deg = new Map<string, number>();
  const alive = new Set<string>();
  for (const [id, neighbors] of adj.all) { deg.set(id, neighbors.size); alive.add(id); }

  let k = 0;
  while (alive.size > 0) {
    let minDeg = Infinity;
    for (const d of deg.values()) if (d < minDeg) minDeg = d;
    if (minDeg > k) k = minDeg;

    let removed = false;
    for (const id of alive) {
      if ((deg.get(id) ?? 0) <= k) {
        alive.delete(id);
        for (const nb of adj.all.get(id) ?? []) {
          if (alive.has(nb)) deg.set(nb, (deg.get(nb) ?? 0) - 1);
        }
        removed = true;
      }
    }
    if (!removed) break;
  }
  return k;
}

/**
 * 模块度（modularity）——单层贪心 Louvain 近似。
 *
 * 从每个节点自成社区开始，迭代地把节点移到能最大化模块度增益的邻居社区，
 * 最后计算最终划分的模块度 Q ∈ [-0.5, 1]。Q 越接近 1 社区结构越明显，
 * 无结构的图 Q ≈ 0。这是**近似**——不是完整 Louvain（多层 + 分辨率参数），
 * 但对代码图的模块度估计足够，且复杂度 O(iterations × V × avgDeg)。
 */
export function computeModularity(adj: AdjacencyList): number {
  const nodes = [...adj.all.keys()];
  const n = nodes.length;
  if (n === 0) return 0;

  // 无向边总数（每条边在 adj.all 里被两端各记一次）。
  let m = 0;
  for (const [, neighbors] of adj.all) m += neighbors.size;
  m /= 2;
  if (m === 0) return 0;

  const k = new Map<string, number>();
  for (const [id, neighbors] of adj.all) k.set(id, neighbors.size);

  // 初始划分：每个节点独立社区。
  const community = new Map<string, number>();
  nodes.forEach((id, i) => community.set(id, i));

  // 贪心合并：最多 10 轮，每轮把每个节点移到邻居中边数最多的社区。
  for (let round = 0; round < 10; round++) {
    let improved = false;
    for (const v of nodes) {
      const cv = community.get(v)!;
      const toComm = new Map<number, number>();
      for (const w of adj.all.get(v) ?? []) {
        const cw = community.get(w)!;
        toComm.set(cw, (toComm.get(cw) ?? 0) + 1);
      }
      let bestComm = -1;
      let bestCount = 0;
      for (const [c, count] of toComm) {
        if (c !== cv && count > bestCount) { bestComm = c; bestCount = count; }
      }
      if (bestComm >= 0) { community.set(v, bestComm); improved = true; }
    }
    if (!improved) break;
  }

  // Q = (1/2m) Σ_ij [A_ij - k_i·k_j/(2m)] δ(c_i, c_j)
  let q = 0;
  for (const v of nodes) {
    const cv = community.get(v)!;
    for (const w of adj.all.get(v) ?? []) {
      if (community.get(w) === cv) {
        q += 1 - ((k.get(v) ?? 0) * (k.get(w) ?? 0)) / (2 * m);
      }
    }
  }
  return q / (2 * m);
}
