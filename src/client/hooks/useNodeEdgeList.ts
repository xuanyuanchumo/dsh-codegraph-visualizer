import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { GraphEdge } from '../../types/index.ts';
import { EDGE_DETAIL } from '../../shared/constants.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { useNodeEdges } from './useGraphSelectors.ts';

export interface NodeEdgeList {
  /** Edges loaded so far for this node (a prefix when `hasMore` is true). */
  edges: GraphEdge[];
  /** Server-reported neighbourhood size, or `null` when unknown. */
  total: number | null;
  /** True while a request for this node is in flight. */
  isLoading: boolean;
  /** True when the server collapsed a dense neighbourhood into file pairs. */
  isAggregated: boolean;
  /** True when the server holds more edges than have been loaded. */
  hasMore: boolean;
  /** Number of edges shown inline before the list is expanded. */
  previewLimit: number;
  /** Fetch the next page (or the first page when nothing is loaded yet). */
  loadMore: () => void;
  /** Drop the cached pages for this node and refetch from scratch. */
  refresh: () => void;
}

const EMPTY_EDGES: GraphEdge[] = [];

/**
 * Loads the authoritative edge neighbourhood for one node from
 * `GET /api/v1/codegraph/edges` on demand.
 *
 * The rendered graph only contains edges reachable from what has been expanded,
 * so the detail panel's adjacency count under-reports. This hook fills that gap
 * lazily: the first page is fetched when the node is selected, further pages
 * only when the user asks for them.
 */
export function useNodeEdgeList(nodeId: string | null, enabled = true): NodeEdgeList {
  const { nodeEdgesByNodeId, nodeEdgeTotals, loadingEdgeNodeIds } = useNodeEdges();
  const loadNodeEdges = useGraphStore((s) => s.loadNodeEdges);

  const edges = (nodeId !== null ? nodeEdgesByNodeId.get(nodeId) : undefined) ?? EMPTY_EDGES;
  const total = nodeId !== null ? nodeEdgeTotals.get(nodeId) ?? null : null;
  const isLoading = nodeId !== null && loadingEdgeNodeIds.has(nodeId);

  // `loadNodeEdges` early-returns once a complete page is in the store, so
  // re-running on unrelated store updates is cheap but pointless; the ref keeps
  // the request tied to the node identity instead.
  const requestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || nodeId === null) {
      requestedRef.current = null;
      return;
    }
    if (requestedRef.current === nodeId) return;
    requestedRef.current = nodeId;
    void loadNodeEdges(nodeId);
  }, [enabled, nodeId, loadNodeEdges]);

  const loadMore = useCallback(() => {
    if (nodeId === null) return;
    void loadNodeEdges(nodeId, { append: true });
  }, [nodeId, loadNodeEdges]);

  const refresh = useCallback(() => {
    if (nodeId === null) return;
    useGraphStore.setState((s) => {
      const edgesByNode = new Map(s.nodeEdgesByNodeId);
      edgesByNode.delete(nodeId);
      const totals = new Map(s.nodeEdgeTotals);
      totals.delete(nodeId);
      const cursors = new Map(s.nodeEdgeCursors);
      cursors.delete(nodeId);
      return { nodeEdgesByNodeId: edgesByNode, nodeEdgeTotals: totals, nodeEdgeCursors: cursors };
    });
    requestedRef.current = null;
    void loadNodeEdges(nodeId);
  }, [nodeId, loadNodeEdges]);

  const hasMore = total !== null && edges.length < total;

  return useMemo(() => ({
    edges,
    total,
    isLoading,
    isAggregated: edges.some((e) => e.properties?.aggregated === true),
    hasMore,
    previewLimit: EDGE_DETAIL.PREVIEW_LIMIT,
    loadMore,
    refresh,
  }), [edges, total, isLoading, hasMore, loadMore, refresh]);
}
