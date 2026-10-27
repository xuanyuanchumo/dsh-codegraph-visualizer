/**
 * 有向环存在性判定（早终止变体，spec §5.6 的轻量替代）。
 *
 * 璇玑图原型：只想确认「这方锦缎里有没有回文」，不必把所有诗都读一遍。
 * O(V+E)，遇到第一个 back edge 立即返回 true，不枚举环列表。
 *
 * @module xuanji/ops/cycle-existence
 */

import type { EdgeType, GraphSpace } from '../core/graph-space.ts';

/**
 * 邻接表上的环存在性判定。
 * adjacency 允许邻居数组有重复（不要求去重）。
 */
export function hasCycleInAdjacency(
  adjacency: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const frames: Array<{ id: string; neighbors: readonly string[]; next: number }> = [
      { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
    ];
    visited.add(start);
    inStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.next >= frame.neighbors.length) {
        inStack.delete(frame.id);
        frames.pop();
        continue;
      }
      const target = frame.neighbors[frame.next++]!;
      if (inStack.has(target)) return true;
      if (!visited.has(target)) {
        visited.add(target);
        inStack.add(target);
        frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
      }
    }
  }
  return false;
}

/** 图空间上的环存在性判定（按边类型过滤）。 */
export function hasDirectedCycle(
  graph: GraphSpace,
  types: ReadonlySet<EdgeType>,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const id of graph.nodeIds()) adjacency.set(id, graph.outNeighbors(id, types));
  return hasCycleInAdjacency(adjacency);
}
