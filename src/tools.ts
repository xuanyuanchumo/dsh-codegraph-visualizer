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
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          nodeCount: { type: 'integer' },
          edgeCount: { type: 'integer' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [
        { type: 'text', text: `Graph status: ${String(value.status)} (${value.nodeCount} nodes, ${value.edgeCount} edges)` },
      ],
    },
    async execute(args) {
      const data = await fetchMergedGraph(invoke, args.repoId);
      return {
        status: data.nodes.length > 0 ? 'ready' : 'unavailable',
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
      };
    },
  });

  const graphData = defineTool({
    name: 'graph_data',
    description: 'Fetch the merged code relationship graph for a repository (calls + dependencies).',
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
      render: (_args, value) => [
        {
          type: 'text',
          text: `Graph loaded: ${(value as { metadata?: { nodeCount?: number; edgeCount?: number } }).metadata?.nodeCount ?? 0} nodes, ${
            (value as { metadata?: { nodeCount?: number; edgeCount?: number } }).metadata?.edgeCount ?? 0
          } edges`,
        },
      ],
    },
    async execute(args) {
      const source = args.source ?? 'both';
      const data = await fetchMergedGraph(invoke, args.repoId, source);
      emitUpdate({
        repoId: args.repoId,
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        timestamp: data.metadata.timestamp,
      });
      return data as unknown as JsonValue;
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
      render: (_args, value) => [{ type: 'text', text: `Symbol: ${JSON.stringify(value)}` }],
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
      render: (_args, value) => [{ type: 'text', text: `Impact: ${JSON.stringify(value)}` }],
    },
    async execute(args) {
      const raw = await invoke('lens_impact', { symbolId: args.symbolId });
      return (raw ?? { affected: [], depth: 0 }) as JsonValue;
    },
  });

  return { graphStatus, graphData, graphSymbol, graphImpact };
};

export { fetchMergedGraph };
export const makeRepo = (id: string): RepoId => makeRepoId(id);