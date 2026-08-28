// DSH Plugin Entry Point - Host Side
import type { CordisContext } from '@deepseek-cordis/plugin';
import { createGraphTools } from './tools/graphTools.js';
import { GraphPushService } from './push/GraphPushService.js';
import type { IGraphVisualizerService, GraphData, GraphNode, RepoId, SymbolId } from './types/index.js';

export interface PluginOptions {
  pollInterval?: number;
}

export const apply = (ctx: CordisContext, options: PluginOptions = {}) => {
  const { graph_status, graph_data, graph_symbol, graph_impact } = createGraphTools(ctx);
  const pushService = new GraphPushService({ pollInterval: options.pollInterval });

  // Register tools (DSH effect pattern)
  const disposer = ctx.effect(() => {
    // Register graph tools
    ctx.registerTool('graph_status', graph_status as unknown as Record<string, unknown>);
    ctx.registerTool('graph_data', graph_data as unknown as Record<string, unknown>);
    ctx.registerTool('graph_symbol', graph_symbol as unknown as Record<string, unknown>);
    ctx.registerTool('graph_impact', graph_impact as unknown as Record<string, unknown>);

    // Listen for upstream codegraph events
    const unsubRepoImported = ctx.on('codegraph/repo/imported', (data: unknown) => {
      const event = data as { repoId: string };
      pushService.startPolling(event.repoId as RepoId, ctx);
    });

    const unsubRepoScanned = ctx.on('codegraph/repo/scanned', (data: unknown) => {
      const event = data as { repoId: string; fileCount: number };
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
    getGraphData: async (repoId: RepoId) => graph_data({ repoId: repoId }),
    subscribeGraphUpdate: (repoId: RepoId, callback: (data: GraphData) => void) => {
      const unsub = ctx.on('graph:update', (data: unknown) => {
        const event = data as { repoId: string };
        if (event.repoId === repoId) {
          // Fetch full data on update
          graph_data({ repoId }).then(callback);
        }
      });
      return unsub;
    },
    searchSymbol: async (repoId: RepoId, query: string): Promise<GraphNode[]> => {
      const result = await ctx.tools.invoke('codegraph_search', { repoId, query });
      return (result as { nodes: GraphNode[] }).nodes ?? [];
    },
    getSymbolDetails: async (symbolId: SymbolId): Promise<GraphNode | null> => {
      const result = await graph_symbol({ symbolId });
      if (!result) return null;
      return {
        id: symbolId as any,
        label: result.label,
        filePath: result.filePath,
        lineNumber: result.lineNumber,
        type: 'module' as const,
        properties: {},
      };
    },
    exportGraph: async (repoId: RepoId, format: 'png' | 'svg' | 'json'): Promise<Blob> => {
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

export default apply;
