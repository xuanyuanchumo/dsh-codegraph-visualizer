import type { GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import { EDGE_DETAIL } from '../../../shared/constants.ts';
import { fetchEdges, createEtagSink, commitEtag } from '../../api/index.ts';
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
 * The empty per-node pagination state. Spread into any `_set` that replaces the
 * graph so stale per-node edge pages — and stale segmented-AST progress — from
 * the previous workspace cannot survive.
 */
export function emptyEdgeState(): Pick<GraphState,
  'nodeEdgesByNodeId' | 'nodeEdgeTotals' | 'nodeEdgeCursors' | 'loadingEdgeNodeIds'
  | 'detailEdgeNodeIds' | 'astPageByNodeId'> {
  return {
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
    detailEdgeNodeIds: new Set(),
    astPageByNodeId: new Map(),
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
    detailEdgeNodeIds: new Set(),
    loadNodeEdges: async (
      nodeId: string,
      options?: { append?: boolean; scope?: 'file' | 'symbol'; detail?: boolean },
    ) => {
      const append = options?.append === true;
      const scope = options?.scope ?? 'file';
      const state = _get();
      // Once the user asks for the unaggregated detail view, every later page for
      // this node must keep asking for it: the server re-collapses a dense
      // neighbourhood, so a plain follow-up page would silently drop the edges
      // the user just asked to see.
      const detail = options?.detail === true || state.detailEdgeNodeIds.has(nodeId);

      if (!append) {
        const loaded = state.nodeEdgesByNodeId.get(nodeId);
        const knownTotal = state.nodeEdgeTotals.get(nodeId);
        // A complete page is already in the store (the server reported hasMore=false).
        // An aggregated page reports the very same thing while hiding the raw edges,
        // so an explicit detail request must be allowed to replace it.
        const replacingAggregate = detail
          && (loaded ?? []).some((e) => e.properties?.aggregated === true);
        if (!replacingAggregate && loaded && knownTotal !== undefined && loaded.length >= knownTotal) return;
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
      if (detail && !_get().detailEdgeNodeIds.has(nodeId)) {
        const nextDetail = new Set(_get().detailEdgeNodeIds);
        nextDetail.add(nodeId);
        _set({ loadingEdgeNodeIds: newLoading, detailEdgeNodeIds: nextDetail });
      } else {
        _set({ loadingEdgeNodeIds: newLoading });
      }

      const controller = replaceController(internals.expandAbortControllers, `edges:${nodeId}`);
      try {
        // Cache-first, first page only: later pages are appended to whatever is in
        // the store. The detail view never touches the cache — the cached payload is
        // the aggregated page, which is exactly what the user asked to leave.
        if (!append && !detail && internals.persistentCache) {
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

        const sink = createEtagSink();
        const data = await fetchEdges(
          nodeId, scope, cursor, EDGE_DETAIL.PAGE_SIZE,
          controller.signal, _get().currentWorkspace, detail, sink,
        );
        if (!isCurrent() || gen !== internals.expandGeneration) return;
        if (sink.notModified) {
          // 服务端确认这一页没变，且客户端此前应用过 ⇒ 保留已合并的边，不要用 null 清空面板。
          log.info('node edges not modified (304)', { nodeId, scope, cursor, detail });
          return;
        }
        if (!data) {
          log.warn('loadNodeEdges: no response', { nodeId, scope, cursor, detail });
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

        // Only persist a complete result: a partial page would poison the cache with
        // hasMore state, and a detail page would poison it with unaggregated edges.
        if (!data.hasMore && !detail && internals.persistentCache) {
          await internals.persistentCache.setEdges(cacheKey, { edges: merged, total: data.total } satisfies CachedEdgePage);
        }
        log.info('node edges loaded', {
          nodeId, scope, detail, edges: incoming.length, total: data.total,
          hasMore: data.hasMore, aggregated: data.aggregated === true,
        });
        // 载荷已并入 store，此刻才登记校验值（见 `commitEtag` 的注释）。
        commitEtag(sink);
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
