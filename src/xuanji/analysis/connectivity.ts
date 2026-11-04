/**
 * 图连通性——WCC / SCC / 关节点（cycle-141 拆分）。
 *
 * 从 graphMetrics.ts 拆出（复杂度治理：单文件 ≤~250 行）。
 * 三个算法都是线性时间，代码图谱规模下可接受。
 */
import type { AdjacencyList } from './types.ts';

/**
 * 弱连通分量数（WCC）——在无向投影上做 BFS 计数。
 * 复杂度 O(V + E)。
 */
export function countWeaklyConnectedComponents(adj: AdjacencyList): number {
  const visited = new Set<string>();
  let count = 0;
  for (const start of adj.all.keys()) {
    if (visited.has(start)) continue;
    count++;
    const queue: string[] = [start];
    visited.add(start);
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (const w of adj.all.get(v) ?? []) {
        if (!visited.has(w)) { visited.add(w); queue.push(w); }
      }
    }
  }
  return count;
}

/**
 * 强连通分量数（SCC）——Kosaraju 算法（两趟 DFS）。
 * 复杂度 O(V + E)。
 */
export function countStronglyConnectedComponents(adj: AdjacencyList): number {
  const nodes = [...adj.all.keys()];
  const visited = new Set<string>();
  const order: string[] = [];
  const dfs1 = (v: string): void => {
    visited.add(v);
    for (const w of adj.out.get(v) ?? []) {
      if (!visited.has(w)) dfs1(w);
    }
    order.push(v);
  };
  for (const v of nodes) if (!visited.has(v)) dfs1(v);

  const visited2 = new Set<string>();
  let count = 0;
  const dfs2 = (v: string): void => {
    visited2.add(v);
    for (const w of adj.in.get(v) ?? []) {
      if (!visited2.has(w)) dfs2(w);
    }
  };
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i]!;
    if (!visited2.has(v)) { count++; dfs2(v); }
  }
  return count;
}

/**
 * 关节点（articulation point）计数——Tarjan 算法，在无向投影上。
 *
 * 关节点是「去掉后增加连通分量数」的节点——代码图里的「咽喉」。
 * 复杂度 O(V + E)。
 */
export function countArticulationPoints(adj: AdjacencyList): number {
  const nodes = [...adj.all.keys()];
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  let time = 0;
  let count = 0;

  const dfs = (v: string): void => {
    visited.add(v);
    disc.set(v, time);
    low.set(v, time);
    time++;
    let children = 0;
    for (const w of adj.all.get(v) ?? []) {
      if (!visited.has(w)) {
        children++;
        parent.set(w, v);
        dfs(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
        if (parent.get(v) === null && children > 1) count++;
        if (parent.get(v) !== null && (low.get(w) ?? 0) >= (disc.get(v) ?? 0)) count++;
      } else if (w !== parent.get(v)) {
        low.set(v, Math.min(low.get(v)!, disc.get(w)!));
      }
    }
  };

  for (const v of nodes) {
    if (!visited.has(v)) { parent.set(v, null); dfs(v); }
  }
  return count;
}
