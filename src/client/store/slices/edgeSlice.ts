import type { GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import { EDGE_DETAIL } from '../../../shared/constants.ts';
import { fetchEdges } from '../../api/index.ts';
import { internals, log, replaceController } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

/** Cached payload shape for the `edges-cache` IndexedDB store. */
interface CachedEdgePage {
  edges: GraphEdge[];
  total: number;
}

function edgeCacheKey(nodeId: string, scope: 'file' | 'symbol'): string {
  return `edges:${scope}:${nodeId}`;
}

/**
 * The empty edge-list state. Spread into any `_set` that replaces the graph so
 * stale per-node edge pages from the previous workspace cannot survive.
 */
export function emptyEdgeState(): Pick<GraphState,
  'nodeEdgesByNodeId' | 'nodeEdgeTotals' | 'nodeEdgeCursors' | 'loadingEdgeNodeIds'> {
  return {
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
  };
}

/**
 * Lazy per-node edge loading for the detail panel.
 *
 * The graph the client renders only carries the edges reachable from what has
 * been expanded so far, so the adjacency count in the detail panel is a lower
 * bound. `GET /api/v1/codegraph/edges` is the authoritative source: it serves
 * the complete neighbourhood from SQLite when available, falls back to the
 * in-memory graph, and collapses dense neighbourhoods into one synthetic edge
 * per file pair (`properties.aggregated === true`).
 */
export function createEdgeSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
    loadNodeEdges: async (nodeId: string, options?: { append?: boolean; scope?: 'file' | 'symbol' }) => {
      const append = options?.append === true;
      const scope = options?.scope ?? 'file';
      const state = _get();

      if (!append) {
        const loaded = state.nodeEdgesByNodeId.get(nodeId);
        const knownTotal = state.nodeEdgeTotals.get(nodeId);
        // A complete page is already in the store (the server reported hasMore=false).
        if (loaded && knownTotal !== undefined && loaded.length >= knownTotal) return;
        // Coalesce repeated clicks into the in-flight request.
        if (state.loadingEdgeNodeIds.has(nodeId)) return;
      }

      const gen = internals.expandGeneration;
      const cursor = append ? (state.nodeEdgeCursors.get(nodeId) ?? 0) : 0;
      const cacheKey = edgeCacheKey(nodeId, scope);

      // Own request token: `expandGeneration` advances on ordinary expand/collapse
      // too, so it cannot decide when to clear this node's loading flag.
      const seq = (internals.edgeRequestSeq.get(nodeId) ?? 0) + 1;
      internals.edgeRequestSeq.set(nodeId, seq);
      const isCurrent = () => internals.edgeRequestSeq.get(nodeId) === seq;

      const newLoading = new Set(_get().loadingEdgeNodeIds);
      newLoading.add(nodeId);
      _set({ loadingEdgeNodeIds: newLoading });

      const controller = replaceController(internals.expandAbortControllers, `edges:${nodeId}`);
      try {
        // Cache-first, first page only: later pages are appended to whatever is in the store.
        if (!append && internals.persistentCache) {
          const cached = await internals.persistentCache.getEdges(cacheKey);
          // A superseded request or a graph reload makes this whole lookup stale.
          if (!isCurrent() || gen !== internals.expandGeneration) return;
          if (cached) {
            const data = cached as CachedEdgePage;
            if (Array.isArray(data.edges) && data.edges.length > 0) {
              const edgesByNode = new Map(_get().nodeEdgesByNodeId);
              edgesByNode.set(nodeId, data.edges);
              const totals = new Map(_get().nodeEdgeTotals);
              totals.set(nodeId, data.total);
              const cursors = new Map(_get().nodeEdgeCursors);
              cursors.set(nodeId, data.edges.length);
              _set({ nodeEdgesByNodeId: edgesByNode, nodeEdgeTotals: totals, nodeEdgeCursors: cursors });
              log.info('node edges loaded (cache)', { nodeId, scope, edges: data.edges.length });
              return;
            }
          }
        }

        const data = await fetchEdges(
          nodeId, scope, cursor, EDGE_DETAIL.PAGE_SIZE,
          controller.signal, _get().currentWorkspace,
        );
        if (!isCurrent() || gen !== internals.expandGeneration) return;
        if (!data) {
          log.warn('loadNodeEdges: no response', { nodeId, scope, cursor });
          return;
        }

        const incoming = Array.isArray(data.edges) ? data.edges : [];
        const edgesByNode = new Map(_get().nodeEdgesByNodeId);
        const previous = append ? (edgesByNode.get(nodeId) ?? []) : [];
        const seen = new Set(previous.map((e) => e.id));
        const merged = [...previous, ...incoming.filter((e) => !seen.has(e.id))];
        edgesByNode.set(nodeId, merged);
        const totals = new Map(_get().nodeEdgeTotals);
        totals.set(nodeId, data.total);
        const cursors = new Map(_get().nodeEdgeCursors);
        cursors.set(nodeId, typeof data.cursor === 'number' ? data.cursor : merged.length);
        _set({ nodeEdgesByNodeId: edgesByNode, nodeEdgeTotals: totals, nodeEdgeCursors: cursors });

        // Only persist a complete result: a partial page would poison the cache with hasMore state.
        if (!data.hasMore && internals.persistentCache) {
          await internals.persistentCache.setEdges(cacheKey, { edges: merged, total: data.total } satisfies CachedEdgePage);
        }
        log.info('node edges loaded', {
          nodeId, scope, edges: incoming.length, total: data.total,
          hasMore: data.hasMore, aggregated: data.aggregated === true,
        });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          log.warn('loadNodeEdges failed', { nodeId, scope, err });
        }
      } finally {
        // Always release this request's own token; a newer request for the same node
        // owns the flag from here on, so only the current token may clear it.
        if (isCurrent()) {
          const cleared = new Set(_get().loadingEdgeNodeIds);
          cleared.delete(nodeId);
          _set({ loadingEdgeNodeIds: cleared });
        }
        internals.expandAbortControllers.delete(`edges:${nodeId}`);
      }
    },
  };
}
