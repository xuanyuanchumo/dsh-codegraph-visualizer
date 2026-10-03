import { useMemo } from 'react';
import type { GraphEdge } from '../../types/index.ts';

export function useAdjacencyMap(edges: GraphEdge[]): Map<string, { in: number; out: number }> {
  return useMemo(() => {
    const map = new Map<string, { in: number; out: number }>();
    for (const edge of edges) {
      const src = map.get(edge.source);
      if (src) src.out++;
      else map.set(edge.source, { in: 0, out: 1 });
      const tgt = map.get(edge.target);
      if (tgt) tgt.in++;
      else map.set(edge.target, { in: 1, out: 0 });
    }
    return map;
  }, [edges]);
}