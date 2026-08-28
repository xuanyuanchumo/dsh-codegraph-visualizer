// Client entry point
import type { CordisContext } from '@deepseek-cordis/plugin';

export interface ClientOptions {
  container: HTMLElement;
}

export const initClient = (ctx: CordisContext, options: ClientOptions) => {
  // Listen for graph updates from host
  const unsub = ctx.on('graph:update', (_event: unknown) => {
    // Fetch full data
    ctx.tools.invoke('graph_data', { repoId: 'default', source: 'both' }).catch(() => {});
  });

  // Auto-refresh on scan complete
  const unsubScan = ctx.on('codegraph/repo/scanned', (_event: unknown) => {
    ctx.tools.invoke('graph_data', { repoId: 'default' }).catch(() => {});
  });

  // Return cleanup
  return () => {
    unsub();
    unsubScan();
  };
};
