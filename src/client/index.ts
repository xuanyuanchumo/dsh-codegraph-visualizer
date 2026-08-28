// Client entry point
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphPanel } from './GraphPanel';
import { useGraphStore } from './store/graphStore';
import type { CordisContext } from '@deepseek-cordis/plugin';

export interface ClientOptions {
  container: HTMLElement;
}

export const initClient = (ctx: CordisContext, options: ClientOptions) => {
  const { setGraphData, setLoading, setError } = useGraphStore();

  // Listen for graph updates from host
  const unsub = ctx.on('graph:update', (event) => {
    // Fetch full data
    ctx.tools.invoke('graph_data', { repoId: event.repoId, source: 'both' })
      .then((data: any) => {
        setGraphData(data.nodes, data.edges, data.repoId);
      })
      .catch((err) => setError(err.message));
  });

  // Auto-refresh on scan complete
  const unsubScan = ctx.on('codegraph/repo/scanned', (event) => {
    ctx.tools.invoke('graph_data', { repoId: event.repoId })
      .then((data: any) => {
        setGraphData(data.nodes, data.edges, data.repoId);
      });
  });

  // Render React app
  const root = createRoot(options.container);
  root.render(<GraphPanel />);

  // Return cleanup
  return () => {
    unsub();
    unsubScan();
    root.unmount();
  };
};

export { GraphPanel, useGraphStore };