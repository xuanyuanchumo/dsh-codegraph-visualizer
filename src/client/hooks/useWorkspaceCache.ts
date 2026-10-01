import { useEffect, useRef } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';

interface GraphCacheApi {
  getCachedData(workspace: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  cacheData(workspace: string, nodes: GraphNode[], edges: GraphEdge[]): void;
}

interface UseWorkspaceCacheOpts {
  currentWorkspace: string;
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  graphCache: GraphCacheApi;
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string) => void;
}

export function useWorkspaceCache(opts: UseWorkspaceCacheOpts): void {
  const prevWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!opts.currentWorkspace) return;
    if (prevWorkspaceRef.current && prevWorkspaceRef.current !== opts.currentWorkspace) {
      const cached = opts.graphCache.getCachedData(opts.currentWorkspace);
      if (cached) opts.setGraphData(cached.nodes, cached.edges, opts.currentWorkspace);
    }
    prevWorkspaceRef.current = opts.currentWorkspace;
  }, [opts.currentWorkspace, opts.graphCache, opts.setGraphData]);

  useEffect(() => {
    if (opts.currentWorkspace && opts.rawNodes.length > 0) {
      opts.graphCache.cacheData(opts.currentWorkspace, opts.rawNodes, opts.rawEdges);
    }
  }, [opts.currentWorkspace, opts.rawNodes, opts.rawEdges, opts.graphCache]);
}