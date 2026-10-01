import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { fetchGraphDataIncremental } from '../api/index.ts';
import { coerceGraphData } from '../../shared/GraphValidator.ts';
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
          const data = JSON.parse(e.data) as { repoId?: string; nodeCount?: number; edgeCount?: number; timestamp?: number };
          log.info('SSE: graph-updated', data);
          const store = useGraphStore.getState();
          if (store.nodes.length > 0 && store.panelVisible) {
            fetchGraphDataIncremental(store.lastUpdated)
              .then((graphData) => {
                if (graphData && graphData.nodes && graphData.nodes.length > 0) {
                  store.setGraphData(graphData.nodes, graphData.edges, graphData.metadata.repoId, graphData.metadata);
                }
              })
              .catch((err) => log.warn('SSE: incremental fetch failed', err));
          }
        });

        eventSource.addEventListener('graph-data', (e: MessageEvent) => {
          const data = JSON.parse(e.data) as { repoId?: string; nodes?: unknown[]; edges?: unknown[]; timestamp?: number };
          log.info('SSE: graph-data', { nodeCount: data.nodes?.length, edgeCount: data.edges?.length });
          const store = useGraphStore.getState();
          if (store.panelVisible && data.nodes && data.nodes.length > 0) {
            const graphData = coerceGraphData({ nodes: data.nodes, edges: data.edges, metadata: { repoId: data.repoId, timestamp: data.timestamp } });
            if (graphData) {
              store.setGraphData(graphData.nodes, graphData.edges, graphData.metadata.repoId, graphData.metadata);
            }
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