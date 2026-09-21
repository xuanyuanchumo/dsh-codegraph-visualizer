import type { AdjacencyMap } from './AdjacencyList.ts';

export interface BFSResult {
  path: string[];
  length: number;
  truncated: boolean;
}

export function bfsShortestPath(
  adjacency: AdjacencyMap,
  source: string,
  target: string,
  maxNodes: number,
): BFSResult | null {
  if (source === target) return { path: [source], length: 0, truncated: false };

  const visited = new Set<string>([source]);
  const predecessor = new Map<string, string>();
  const queue: string[] = [source];
  let head = 0;

  while (head < queue.length) {
    if (visited.size > maxNodes) return { path: [], length: 0, truncated: true };
    const id = queue[head++]!;
    if (id === target) {
      const path: string[] = [];
      let cur: string | undefined = id;
      while (cur !== undefined) {
        path.unshift(cur);
        cur = predecessor.get(cur);
      }
      return { path, length: path.length - 1, truncated: false };
    }
    const neighbors = adjacency.get(id) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        predecessor.set(next, id);
        queue.push(next);
      }
    }
  }
  return null;
}

export function bfsFrontierExpansion(
  reverseAdjacency: AdjacencyMap,
  startNode: string,
  depth: number,
  maxResults: number,
): { impacted: string[]; count: number; truncated: boolean } {
  const impacted = new Set<string>();
  let frontier = new Set<string>([startNode]);

  for (let d = 0; d < depth && impacted.size < maxResults; d++) {
    const nextFrontier = new Set<string>();
    for (const id of frontier) {
      if (impacted.size >= maxResults) break;
      const sources = reverseAdjacency.get(id) ?? [];
      for (const src of sources) {
        if (impacted.size >= maxResults) break;
        if (!impacted.has(src)) {
          impacted.add(src);
          nextFrontier.add(src);
        }
      }
    }
    frontier = nextFrontier;
  }
  return {
    impacted: Array.from(impacted),
    count: impacted.size,
    truncated: impacted.size >= maxResults,
  };
}