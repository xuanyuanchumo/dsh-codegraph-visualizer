import { useRef, useCallback } from 'react';
import { GraphCache } from '../cache/GraphCache.ts';

import type { GraphNode, GraphEdge } from '../../types/index.ts';

export function useGraphCache() {
  const cacheRef = useRef<GraphCache>(new GraphCache());

  const getCachedData = useCallback((repoId: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null => {
    const entry = cacheRef.current.get(repoId);
    if (!entry) return null;
    return { nodes: entry.nodes, edges: entry.edges };
  }, []);

  const cacheData = useCallback((repoId: string, nodes: GraphNode[], edges: GraphEdge[]) => {
    cacheRef.current.set(repoId, nodes, edges);
  }, []);

  const getCachedLayout = useCallback((repoId: string): Map<string, { x: number; y: number }> | null => {
    return cacheRef.current.getLayoutPositions(repoId);
  }, []);

  const cacheLayout = useCallback((repoId: string, positions: Map<string, { x: number; y: number }>, layoutType: string) => {
    cacheRef.current.setLayoutPositions(repoId, positions, layoutType as any);
  }, []);

  const hasCache = useCallback((repoId: string): boolean => {
    return cacheRef.current.has(repoId);
  }, []);

  return { getCachedData, cacheData, getCachedLayout, cacheLayout, hasCache };
}