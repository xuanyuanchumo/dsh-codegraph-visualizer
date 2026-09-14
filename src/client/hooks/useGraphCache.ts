import { useRef, useCallback, useEffect } from 'react';
import { GraphCache } from '../cache/GraphCache.ts';

import type { GraphNode, GraphEdge } from '../../types/index.ts';

export function useGraphCache() {
  const cacheRef = useRef<GraphCache>(new GraphCache());

  useEffect(() => {
    return () => {
      cacheRef.current.clear();
    };
  }, []);

  const getCachedData = useCallback((repoId: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null => {
    const entry = cacheRef.current.get(repoId);
    if (!entry) return null;
    return { nodes: entry.nodes, edges: entry.edges };
  }, []);

  const cacheData = useCallback((repoId: string, nodes: GraphNode[], edges: GraphEdge[]) => {
    cacheRef.current.set(repoId, nodes, edges);
  }, []);

  return { getCachedData, cacheData };
}
