// Graph tool definitions: adapters + merger wrapped as DSH `defineTool` tools.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CallId } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import { CodeGraphAdapter } from './adapters/CodeGraphAdapter.ts';
import { LensAdapter } from './adapters/LensAdapter.ts';
import { GraphDataMerger } from './merger/GraphDataMerger.ts';
import type { AdapterResult, GraphData, GraphUpdatedEvent, GraphDataEvent, RepoId } from './types/index.ts';
import { RepoId as makeRepoId } from './types/index.ts';

export type { UpstreamInvoker } from './adapters/CodeGraphAdapter.ts';
import type { UpstreamInvoker } from './adapters/CodeGraphAdapter.ts';

const codegraphAdapter = new CodeGraphAdapter();
const lensAdapter = new LensAdapter();
const merger = new GraphDataMerger();

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
  return merger.merge(results, makeRepoId(repoId));
}

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

export function normalizeImpact(raw: unknown): { affected: string[]; depth: number } | null {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) as unknown; } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const list = obj.affected ?? obj.affectedNodes ?? obj.nodes;
  if (!Array.isArray(list)) return null;
  return {
    affected: list.map((it) => {
      if (typeof it === 'string') return it;
      const rec = it as Record<string, unknown>;
      return String(rec.name ?? rec.id ?? '?');
    }),
    depth: typeof obj.depth === 'number' ? obj.depth : 2,
  };
}

export function pickBestMatch(raw: unknown, symbolId: string): Record<string, unknown> | null {
  let payload = raw;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) as unknown; } catch { return null; }
  }
  const items = Array.isArray(payload)
    ? payload
    : (payload as Record<string, unknown>)?.results ?? (payload as Record<string, unknown>)?.nodes;
  if (!Array.isArray(items) || items.length === 0) return null;
  const wanted = symbolId.toLowerCase();
  const best = items.find((it) => {
    const rec = it as Record<string, unknown>;
    return String(rec.name ?? '').toLowerCase() === wanted || rec.id === symbolId;
  }) as Record<string, unknown> | undefined;
  const chosen = best ?? (items[0] as Record<string, unknown>);
  return {
    symbolId,
    name: chosen.name ?? chosen.qualified_name ?? symbolId,
    category: chosen.kind ?? 'unknown',
    file: chosen.filePath ?? chosen.file_path ?? '?',
    line: chosen.startLine ?? chosen.start_line ?? 0,
    signature: chosen.signature ?? null,
  };
}

// ── Extracted execute/render functions for testability ──────────────────

export function createInvoke(ctx: Context): UpstreamInvoker {
  return async (tool, args) => {
    try {
      const result = await ctx.tools.execute({
        callId: CallId(`codegraph:${tool}`),
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
}

export function renderGraphStatus(_args: unknown, value: unknown) {
  const v = value as { status: string; nodeCount: number; edgeCount: number; sources?: Record<string, boolean> };
  const srcInfo = v.sources ? ` [codegraph:${v.sources.codegraph ? '✓' : '✗'} lens:${v.sources.lens ? '✓' : '✗'}]` : '';
  return [
    { type: 'text' as const, text: `Graph status: ${v.status} (${v.nodeCount} nodes, ${v.edgeCount} edges)${srcInfo}` },
  ];
}

export async function executeGraphStatus(args: { repoId: string }, invoke: UpstreamInvoker) {
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
}

export function renderGraphData(_args: unknown, value: unknown) {
  const data = value as unknown as GraphData;
  return [{ type: 'text' as const, text: summarizeGraph(data) }];
}

export async function executeGraphData(
  args: { repoId: string; source?: string },
  invoke: UpstreamInvoker,
  emitUpdate: (event: GraphUpdatedEvent) => void,
  emitData: (event: GraphDataEvent) => void,
) {
  const source = (args.source ?? 'both') as 'codegraph' | 'lens' | 'both';
  const fresh = await fetchMergedGraph(invoke, args.repoId, source);

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
  emitData({
    repoId: args.repoId,
    nodes: merged.nodes,
    edges: merged.edges,
    timestamp: merged.metadata.timestamp,
  });
  return merged as unknown as JsonValue;
}

export function renderGraphSymbol(_args: unknown, value: unknown) {
  const v = value as { name?: string; file?: string; line?: number; category?: string; symbolId?: string } | null;
  if (!v) return [{ type: 'text' as const, text: 'Symbol not found.' }];
  return [{ type: 'text' as const, text: `${v.name ?? v.symbolId ?? '?'} (${v.category ?? 'unknown'}) @ ${v.file ?? '?'}:${v.line ?? '?'}` }];
}

export async function executeGraphSymbol(args: { symbolId: string }, invoke: UpstreamInvoker) {
  const raw = await invoke('codegraph_query', { search: args.symbolId, limit: 1 });
  return pickBestMatch(raw, args.symbolId) as JsonValue;
}

export function renderGraphImpact(_args: unknown, value: unknown) {
  const v = value as { affected?: string[]; depth?: number };
  const count = v.affected?.length ?? 0;
  const list = v.affected?.slice(0, 10).join(', ') ?? '';
  return [{ type: 'text' as const, text: `Impact: ${count} symbols affected (depth ${v.depth ?? 0})${list ? `\n  ${list}` : ''}` }];
}

export async function executeGraphImpact(args: { symbolId: string }, invoke: UpstreamInvoker) {
  const raw = await invoke('codegraph_impact', { symbol: args.symbolId, depth: 2 });
  const normalized = normalizeImpact(raw);
  if (normalized) return normalized as JsonValue;
  const lens = await invoke('lens_impact', { symbolId: args.symbolId });
  return (lens ?? { affected: [], depth: 0 }) as JsonValue;
}

// ── Tool factory ────────────────────────────────────────────────────────

export const createGraphTools = (ctx: Context) => {
  const invoke = createInvoke(ctx);

  const emitUpdate = (event: GraphUpdatedEvent) => {
    ctx.emit('codegraph/graph/updated', event);
  };

  const emitData = (event: GraphDataEvent) => {
    ctx.emit('codegraph/graph/data', event);
  };

  const graphStatus = defineTool({
    name: 'graph_status',
    description: 'Check whether an interactive code graph is available for a repository.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
    },
    output: {
      schema: { type: 'json' },
      render: renderGraphStatus,
    },
    execute: (args) => executeGraphStatus(args as { repoId: string }, invoke),
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
      render: renderGraphData,
    },
    execute: (args) => executeGraphData(args as { repoId: string; source?: string }, invoke, emitUpdate, emitData),
  });

  const graphSymbol = defineTool({
    name: 'graph_symbol',
    description: 'Resolve the details (file path and line number) of one graph node by symbol id.',
    parameters: {
      symbolId: { type: 'string', required: true, description: 'Symbol id.' },
    },
    output: {
      schema: { type: 'json' },
      render: renderGraphSymbol,
    },
    execute: (args) => executeGraphSymbol(args as { symbolId: string }, invoke),
  });

  const graphImpact = defineTool({
    name: 'graph_impact',
    description: 'Analyze the impact of changing one symbol: which symbols are transitively affected.',
    parameters: {
      symbolId: { type: 'string', required: true, description: 'Symbol id to analyze.' },
    },
    output: {
      schema: { type: 'json' },
      render: renderGraphImpact,
    },
    execute: (args) => executeGraphImpact(args as { symbolId: string }, invoke),
  });

  return { graphStatus, graphData, graphSymbol, graphImpact };
};

export { fetchMergedGraph, summarizeGraph };
export const makeRepo = (id: string): RepoId => makeRepoId(id);
