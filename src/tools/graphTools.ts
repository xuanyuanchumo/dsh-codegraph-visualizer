// DSH Tools for graph visualization
import type { GraphData, RepoId, NodeId } from '../types';
import { RepoId } from '../types';
import { CodeGraphAdapter } from '../adapters/CodeGraphAdapter';
import { LensAdapter } from '../adapters/LensAdapter';
import { GraphDataMerger } from '../merger/GraphDataMerger';

export const createGraphTools = (ctx: {
  tools: { invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown> };
  broadcast: (event: string, data: unknown) => void;
}) => {
  const codegraphAdapter = new CodeGraphAdapter();
  const lensAdapter = new LensAdapter();
  const merger = new GraphDataMerger();

  // graph_status: Check if graph data is available
  const graph_status = async (args: { repoId: string }): Promise<{ status: string; nodeCount: number; edgeCount: number }> => {
    try {
      const result = await ctx.tools.invoke('codegraph_status', { repoId: args.repoId });
      return result as { status: string; nodeCount: number; edgeCount: number };
    } catch {
      return { status: 'unavailable', nodeCount: 0, edgeCount: 0 };
    }
  };

  // graph_data: Fetch and merge graph data from all sources
  const graph_data = async (args: { repoId: string; source?: 'codegraph' | 'lens' | 'both' }): Promise<GraphData> => {
    const repoId = RepoId(args.repoId);
    const source = args.source ?? 'both';
    
    const results: Array<{ nodes: any[]; edges: any[]; source: string; timestamp: number }> = [];
    
    if (source === 'codegraph' || source === 'both') {
      results.push(await codegraphAdapter.fetchData(repoId, ctx));
    }
    if (source === 'lens' || source === 'both') {
      results.push(await lensAdapter.fetchData(repoId, ctx));
    }

    const merged = merger.merge(results, args.repoId);
    
    // Broadcast update to client
    ctx.broadcast('graph:update', {
      repoId: args.repoId,
      nodeCount: merged.metadata.nodeCount,
      edgeCount: merged.metadata.edgeCount,
      timestamp: merged.metadata.timestamp,
    });

    return merged;
  };

  // graph_symbol: Get symbol details
  const graph_symbol = async (args: { symbolId: string }): Promise<{ id: string; label: string; filePath: string; lineNumber: number } | null> => {
    try {
      const result = await ctx.tools.invoke('codegraph_symbol', { symbolId: args.symbolId });
      return result as { id: string; label: string; filePath: string; lineNumber: number };
    } catch {
      return null;
    }
  };

  // graph_impact: Get impact analysis
  const graph_impact = async (args: { symbolId: string }): Promise<{ affected: string[]; depth: number }> => {
    try {
      const result = await ctx.tools.invoke('lens_impact', { symbolId: args.symbolId });
      return result as { affected: string[]; depth: number };
    } catch {
      return { affected: [], depth: 0 };
    }
  };

  return {
    graph_status,
    graph_data,
    graph_symbol,
    graph_impact,
  };
};