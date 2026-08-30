// Graph tool definitions: adapters + merger wrapped as DSH `defineTool` tools.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { CallId } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import { CodeGraphAdapter } from './adapters/CodeGraphAdapter.ts';
import { LensAdapter } from './adapters/LensAdapter.ts';
import { GraphDataMerger } from './merger/GraphDataMerger.ts';
import type { AdapterResult, GraphData, GraphUpdatedEvent, RepoId } from './types/index.ts';
import { RepoId as makeRepoId } from './types/index.ts';

export type UpstreamInvoker = (tool: string, args: Record<string, unknown>) => Promise<unknown | null>;

const codegraphAdapter = new CodeGraphAdapter();
const lensAdapter = new LensAdapter();
const merger = new GraphDataMerger();

// Per-repo graph cache for incremental heat-updates (applyDelta).
// Bounded LRU: re-insert on access evicts the least-recently-used entry,
// so long-lived sessions cannot grow the cache without limit (NFR-06).
const GRAPH_CACHE_LIMIT = 8;
const graphCache = new Map<string, GraphData>();

function cacheGraph(repoId: string, data: GraphData): void {
  graphCache.delete(repoId);
  graphCache.set(repoId, data);
  if (graphCache.size > GRAPH_CACHE_LIMIT) {
    const oldest = graphCache.keys().next().value;
    if (oldest !== undefined) graphCache.delete(oldest);
  }
}

async function fetchMergedGraph(
  invoke: UpstreamInvoker,
  repoId: string,
  source: 'codegraph' | 'lens' | 'both' = 'both',
): Promise<GraphData> {
  const results: AdapterResult[] = [];
  if (source === 'codegraph' || source === 'both') {
    results.push(await codegraphAdapter.fetchData(repoId, invoke));
  }
  if (source === 'lens' || source === 'both') {
    results.push(await lensAdapter.fetchData(repoId, invoke));
  }
  return merger.merge(results, repoId);
}

/** Build a human-readable summary of graph data for tool render output. */
function summarizeGraph(data: GraphData): string {
  const nodeByType = new Map<string, number>();
  const edgeByType = new Map<string, number>();
  for (const n of data.nodes) nodeByType.set(n.type, (nodeByType.get(n.type) ?? 0) + 1);
  for (const e of data.edges) edgeByType.set(e.type, (edgeByType.get(e.type) ?? 0) + 1);

  const nodeStats = [...nodeByType.entries()].map(([t, c]) => `${t}:${c}`).join(', ');
  const edgeStats = [...edgeByType.entries()].map(([t, c]) => `${t}:${c}`).join(', ');

  const topNodes = data.nodes.slice(0, 10)
    .map(n => `  • ${n.label} (${n.type}) @ ${n.filePath}:${n.lineNumber}`)
    .join('\n');

  const topEdges = data.edges.slice(0, 10)
    .map(e => `  ${e.source} →${e.type}→ ${e.target}`)
    .join('\n');

  return [
    `Graph: ${data.metadata.nodeCount} nodes [${nodeStats}], ${data.metadata.edgeCount} edges [${edgeStats}]`,
    topNodes ? `\nTop nodes:\n${topNodes}` : '',
    topEdges ? `\nTop edges:\n${topEdges}` : '',
  ].join('');
}

export const createGraphTools = (ctx: Context) => {
  // Best-effort call to an upstream tool (dsh-codegraph / dsh-tool-lens). Those
  // data sources are optional; a missing tool degrades to null instead of throwing.
  const invoke: UpstreamInvoker = async (tool, args) => {
    try {
      const result = await ctx.tools.execute({
        callId: `codegraph:${tool}` as CallId,
        name: tool,
        arguments: args,
        signal: AbortSignal.timeout(5000),
      });
      if (result.isError) return null;
      return result.value ?? null;
    } catch {
      return null;
    }
  };

  const emitUpdate = (event: GraphUpdatedEvent) => {
    ctx.emit('codegraph/graph/updated', event);
  };

  const graphStatus = defineTool({
    name: 'graph_status',
    description: 'Check whether an interactive code graph is available for a repository.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const v = value as { status: string; nodeCount: number; edgeCount: number; sources?: Record<string, boolean> };
        const srcInfo = v.sources ? ` [codegraph:${v.sources.codegraph ? '✓' : '✗'} lens:${v.sources.lens ? '✓' : '✗'}]` : '';
        return [
          { type: 'text', text: `Graph status: ${v.status} (${v.nodeCount} nodes, ${v.edgeCount} edges)${srcInfo}` },
        ];
      },
    },
    async execute(args) {
      const [cgResult, lensResult] = await Promise.allSettled([
        codegraphAdapter.fetchData(args.repoId, invoke),
        lensAdapter.fetchData(args.repoId, invoke),
      ]);
      const cgNodes = cgResult.status === 'fulfilled' ? cgResult.value.nodes.length : 0;
      const lensNodes = lensResult.status === 'fulfilled' ? lensResult.value.nodes.length : 0;
      const data = await fetchMergedGraph(invoke, args.repoId);
      return {
        status: data.nodes.length > 0 ? 'ready' : 'unavailable',
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        sources: {
          codegraph: cgNodes > 0,
          lens: lensNodes > 0,
        },
      };
    },
  });

  const graphData = defineTool({
    name: 'graph_data',
    description: 'Fetch the merged code relationship graph for a repository (calls + dependencies). Uses incremental delta merge on repeat calls.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      source: {
        type: 'string',
        enum: ['codegraph', 'lens', 'both'],
        description: 'Data source; defaults to both.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const data = value as unknown as GraphData;
        return [{ type: 'text', text: summarizeGraph(data) }];
      },
    },
    async execute(args) {
      const source = args.source ?? 'both';
      const fresh = await fetchMergedGraph(invoke, args.repoId, source);

      // Incremental heat-update: merge fresh data into cached graph via applyDelta.
      const cached = graphCache.get(args.repoId);
      const deltaSource: AdapterResult['source'] = source === 'lens' ? 'lens' : 'codegraph';
      const merged = cached
        ? merger.applyDelta(cached, { nodes: fresh.nodes, edges: fresh.edges, source: deltaSource, timestamp: fresh.metadata.timestamp })
        : fresh;
      cacheGraph(args.repoId, merged);

      emitUpdate({
        repoId: args.repoId,
        nodeCount: merged.metadata.nodeCount,
        edgeCount: merged.metadata.edgeCount,
        timestamp: merged.metadata.timestamp,
      });
      return merged as unknown as JsonValue;
    },
  });

  const graphSymbol = defineTool({
    name: 'graph_symbol',
    description: 'Resolve the details (file path and line number) of one graph node by symbol id.',
    parameters: {
      symbolId: { type: 'string', required: true, description: 'Symbol id.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const v = value as { name?: string; file?: string; line?: number; category?: string; symbolId?: string } | null;
        if (!v) return [{ type: 'text', text: 'Symbol not found.' }];
        return [{ type: 'text', text: `${v.name ?? v.symbolId ?? '?'} (${v.category ?? 'unknown'}) @ ${v.file ?? '?'}:${v.line ?? '?'}` }];
      },
    },
    async execute(args) {
      const raw = await invoke('codegraph_symbol', { symbolId: args.symbolId });
      return (raw ?? null) as JsonValue;
    },
  });

  const graphImpact = defineTool({
    name: 'graph_impact',
    description: 'Analyze the impact of changing one symbol: which symbols are transitively affected.',
    parameters: {
      symbolId: { type: 'string', required: true, description: 'Symbol id to analyze.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const v = value as { affected?: string[]; depth?: number };
        const count = v.affected?.length ?? 0;
        const list = v.affected?.slice(0, 10).join(', ') ?? '';
        return [{ type: 'text', text: `Impact: ${count} symbols affected (depth ${v.depth ?? 0})${list ? `\n  ${list}` : ''}` }];
      },
    },
    async execute(args) {
      const raw = await invoke('lens_impact', { symbolId: args.symbolId });
      return (raw ?? { affected: [], depth: 0 }) as JsonValue;
    },
  });

  return { graphStatus, graphData, graphSymbol, graphImpact };
};

export { fetchMergedGraph, summarizeGraph };
export const makeRepo = (id: string): RepoId => makeRepoId(id);
