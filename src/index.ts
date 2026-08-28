// DSH Plugin Entry Point - Host Side
import type { CordisContext } from '@deepseek-cordis/plugin';
import { createGraphTools } from './tools/graphTools';
import { GraphPushService } from './push/GraphPushService';
import type { IGraphVisualizerService } from './types';

export interface PluginOptions {
  pollInterval?: number;
}

export const apply = (ctx: CordisContext, options: PluginOptions = {}) => {
  const { graph_status, graph_data, graph_symbol, graph_impact } = createGraphTools(ctx);
  const pushService = new GraphPushService({ pollInterval: options.pollInterval });

  // Register tools (DSH effect pattern)
  const disposer = ctx.effect(() => {
    // Register graph tools
    ctx.registerTool('graph_status', graph_status);
    ctx.registerTool('graph_data', graph_data);
    ctx.registerTool('graph_symbol', graph_symbol);
    ctx.registerTool('graph_impact', graph_impact);

    // Listen for upstream codegraph events
    const unsubRepoImported = ctx.on('codegraph/repo/imported', (event) => {
      pushService.startPolling(RepoId(event.repoId), ctx);
    });

    const unsubRepoScanned = ctx.on('codegraph/repo/scanned', (event) => {
      ctx.broadcast('graph:scanned', { repoId: event.repoId, fileCount: event.fileCount });
    });

    // Return cleanup function (register即effect)
    return () => {
      unsubRepoImported();
      unsubRepoScanned();
      pushService.dispose();
    };
  });

  // Service Provider for capability seam
  const service: IGraphVisualizerService = {
    getGraphData: async (repoId) => graph_data({ repoId: repoId }),
    subscribeGraphUpdate: (repoId, callback) => {
      const unsub = ctx.on('graph:update', (event) => {
        if (event.repoId === repoId) {
          // Fetch full data on update
          graph_data({ repoId }).then(callback);
        }
      });
      return unsub;
    },
    searchSymbol: async (repoId, query) => {
      const result = await ctx.tools.invoke('codegraph_search', { repoId, query });
      return (result as { nodes: unknown[] }).nodes ?? [];
    },
    getSymbolDetails: async (symbolId) => graph_symbol({ symbolId }),
    exportGraph: async (repoId, format) => {
      const data = await graph_data({ repoId });
      const json = JSON.stringify(data, null, 2);
      return new Blob([json], { type: 'application/json' });
    },
  };

  // Register service
  const serviceDisposer = ctx.registerService('IGraphVisualizerService', service);

  // Return disposer for manual cleanup
  return () => {
    disposer();
    serviceDisposer();
  };
};

// Branded ID helper
const RepoId = (id: string) => id as any;

export default apply;