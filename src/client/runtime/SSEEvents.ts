import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { fetchGraphDataIncremental } from '../api/index.ts';
import { coerceGraphData, coerceGraphDelta } from '../../shared/GraphValidator.ts';
import { isForeignRepo } from './repoScope.ts';
import { useGraphStore } from '../store/graphStore.ts';

const log = scoped('client');

export function setupSSEEvents(ctx: Context): void {
  if (typeof window === 'undefined') return;

  ctx.effect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/v1/codegraph/events');

        eventSource.addEventListener('graph-updated', (e: MessageEvent) => {
          const data = JSON.parse(e.data) as { repoId?: string; nodeCount?: number; edgeCount?: number; timestamp?: number; incremental?: boolean };
          log.info('SSE: graph-updated', data);
          // P2-21: an incremental update is accompanied by a `graph/delta` that already carries the
          // changes. Re-fetching the whole graph here would throw away exactly the saving the delta
          // exists to provide, so this listener only handles the full-rebuild case.
          if (data.incremental) return;
          const store = useGraphStore.getState();
          if (!store.panelVisible) return;
          // P0: the host holds one graph slot for every workspace the client has visited. Ignore an
          // update that belongs to a workspace other than the one on screen; re-fetching here would
          // overwrite the visible graph with another workspace's nodes.
          if (isForeignRepo(data.repoId, store.repoId)) {
            log.info('SSE: graph-updated ignored for another workspace', { repoId: data.repoId, activeRepoId: store.repoId });
            return;
          }
          if (store.nodes.length === 0) {
            // The workspace was still being indexed when we bootstrapped. Now that the
            // server reports a graph update, re-run bootstrap so the real top-level
            // skeleton replaces the empty placeholder (the incremental path below cannot
            // bootstrap from nothing because it requires an already-rendered graph).
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap refresh failed', err));
            return;
          }
          fetchGraphDataIncremental(store.lastUpdated)
            .then((graphData) => {
              if (graphData && graphData.nodes && graphData.nodes.length > 0) {
                store.setGraphData(graphData.nodes, graphData.edges, graphData.metadata.repoId, graphData.metadata);
              }
            })
            .catch((err) => log.warn('SSE: incremental fetch failed', err));
        });

        eventSource.addEventListener('graph-data', (e: MessageEvent) => {
          const data = JSON.parse(e.data) as { repoId?: string; nodes?: unknown[]; edges?: unknown[]; timestamp?: number };
          log.info('SSE: graph-data', { nodeCount: data.nodes?.length, edgeCount: data.edges?.length });
          const store = useGraphStore.getState();
          if (store.panelVisible && data.nodes && data.nodes.length > 0) {
            // P0: never let another workspace's graph replace the one on screen.
            if (isForeignRepo(data.repoId, store.repoId)) {
              log.info('SSE: graph-data ignored for another workspace', { repoId: data.repoId, activeRepoId: store.repoId });
              return;
            }
            const graphData = coerceGraphData({ nodes: data.nodes, edges: data.edges, metadata: { repoId: data.repoId, timestamp: data.timestamp } });
            if (graphData) {
              store.setGraphData(graphData.nodes, graphData.edges, graphData.metadata.repoId, graphData.metadata);
            }
          }
        });

        // P2-21: the host sends only the entries that changed when the watcher drove the update.
        // Applying it avoids re-rendering the whole graph for a one-line edit. When the store's
        // revision does not match the delta (a reconnect skipped events, a full load landed
        // mid-flight) `applyGraphDelta` refuses and we re-bootstrap instead of rendering a
        // half-applied graph.
        eventSource.addEventListener('graph-delta', (e: MessageEvent) => {
          const data = JSON.parse(e.data) as {
            repoId?: string;
            delta?: { addedNodes?: unknown[]; removedNodes?: unknown[]; modifiedNodes?: unknown[]; addedEdges?: unknown[]; removedEdges?: unknown[]; modifiedEdges?: unknown[] };
            timestamp?: number;
          };
          log.info('SSE: graph-delta', {
            addedNodes: data.delta?.addedNodes?.length,
            removedNodes: data.delta?.removedNodes?.length,
            modifiedNodes: data.delta?.modifiedNodes?.length,
            addedEdges: data.delta?.addedEdges?.length,
            removedEdges: data.delta?.removedEdges?.length,
            modifiedEdges: data.delta?.modifiedEdges?.length,
          });
          const store = useGraphStore.getState();
          if (!store.panelVisible || !data.delta) return;
          // P0: a delta is only meaningful against the graph it was computed from. If it names a
          // different workspace, refuse it outright — falling back to bootstrap here would also be
          // wrong, because the foreign event carries no information about the visible workspace.
          if (isForeignRepo(data.repoId, store.repoId)) {
            log.info('SSE: graph-delta ignored for another workspace', { repoId: data.repoId, activeRepoId: store.repoId });
            return;
          }
          const delta = coerceGraphDelta(data.delta);
          if (!delta) {
            log.warn('SSE: graph-delta payload malformed, falling back to bootstrap');
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap after bad delta failed', err));
            return;
          }
          if (!store.applyGraphDelta(delta)) {
            log.warn('SSE: graph-delta did not apply, falling back to bootstrap');
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap after refused delta failed', err));
          }
        });

        eventSource.addEventListener('repo-imported', () => {
          log.info('SSE: repo-imported');
          const store = useGraphStore.getState();
          if (store.panelVisible) {
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap failed', err));
          }
        });

        eventSource.addEventListener('repo-scanned', () => {
          log.info('SSE: repo-scanned');
          const store = useGraphStore.getState();
          if (store.panelVisible) {
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap failed', err));
          }
        });

        eventSource.addEventListener('init-result', (e: MessageEvent) => {
          const data = JSON.parse(e.data) as { success?: boolean; path?: string; message?: string };
          log.info('SSE: init-result', data);
          const store = useGraphStore.getState();
          if (data.success) {
            store.setInitStatus('done');
            store.loadBootstrap().catch((err) => log.warn('SSE: bootstrap after init failed', err));
          } else {
            store.setInitStatus('error');
          }
        });

        eventSource.onerror = () => {
          log.warn('SSE: connection error, will retry');
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          reconnectTimer = setTimeout(connectSSE, 10000);
        };
      } catch (err) {
        log.warn('SSE: connect failed', err);
        reconnectTimer = setTimeout(connectSSE, 10000);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
  }, 'codegraph: SSE events');
}