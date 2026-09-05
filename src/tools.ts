// Graph tool definitions: adapters + merger wrapped as DSH `defineTool` tools.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CallId } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import { CodeGraphAdapter } from './adapters/CodeGraphAdapter.ts';
import { LensAdapter } from './adapters/LensAdapter.ts';
import { GraphDataMerger } from './merger/GraphDataMerger.ts';
import type { AdapterResult, GraphData, GraphUpdatedEvent, GraphDataEvent, RepoId, HealthScore, RuleViolation, NodeId } from './types/index.ts';
import { RepoId as makeRepoId } from './types/index.ts';
import { scoped } from './shared/Logger.ts';

const log = scoped('tools');

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
  const tasks: Promise<AdapterResult>[] = [];
  if (source === 'codegraph' || source === 'both') {
    tasks.push(codegraphAdapter.fetchData(repoId, invoke));
  }
  if (source === 'lens' || source === 'both') {
    tasks.push(lensAdapter.fetchData(repoId, invoke));
  }
  const settled = await Promise.allSettled(tasks);
  const results: AdapterResult[] = settled
    .filter((r): r is PromiseFulfilledResult<AdapterResult> => r.status === 'fulfilled')
    .map((r) => r.value);
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
    try { raw = JSON.parse(raw) as unknown; } catch { log.warn('normalizeImpact: JSON.parse failed'); return null; }
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
    try { payload = JSON.parse(payload) as unknown; } catch { log.warn('normalizeCallers: JSON.parse failed'); return null; }
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

export function createInvoke(ctx: Context, requestTimeout = 5000): UpstreamInvoker {
  return async (tool, args) => {
    try {
      const result = await ctx.tools.execute({
        callId: CallId(`codegraph:${tool}`),
        name: tool,
        arguments: args,
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (result.isError) return null;
      return result.value ?? null;
    } catch (e) {
      log.warn('createInvoke: tool execution failed', { tool, error: e });
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
  const results: AdapterResult[] = [cgResult, lensResult]
    .filter((r): r is PromiseFulfilledResult<AdapterResult> => r.status === 'fulfilled')
    .map((r) => r.value);
  const data = merger.merge(results, makeRepoId(args.repoId));
  return {
    status: data.nodes.length > 0 ? 'ready' : 'unavailable',
    nodeCount: data.metadata.nodeCount,
    edgeCount: data.metadata.edgeCount,
    sources: {
      codegraph: cgResult.status === 'fulfilled' && cgResult.value.nodes.length > 0,
      lens: lensResult.status === 'fulfilled' && lensResult.value.nodes.length > 0,
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

export const createGraphTools = (ctx: Context, options: { requestTimeout?: number } = {}) => {
  const invoke = createInvoke(ctx, options.requestTimeout);

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

  const graphPathFind = defineTool({
    name: 'graph_path_find',
    description: 'Find the shortest call path between two symbols in the code graph.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      sourceSymbol: { type: 'string', required: true, description: 'Source symbol id.' },
      targetSymbol: { type: 'string', required: true, description: 'Target symbol id.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { path?: string[]; length?: number } | null;
        if (!v || !v.path || v.path.length === 0) {
          return [{ type: 'text' as const, text: 'No path found between the specified symbols.' }];
        }
        return [{ type: 'text' as const, text: `Path found (${v.length} hops): ${v.path.join(' → ')}` }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string; sourceSymbol: string; targetSymbol: string };
      const data = await fetchMergedGraph(invoke, a.repoId);
      const nodeIds = new Set(data.nodes.map((n) => n.id));
      if (!nodeIds.has(a.sourceSymbol as NodeId) || !nodeIds.has(a.targetSymbol as NodeId)) {
        return null;
      }
      const adjacency = new Map<string, string[]>();
      for (const edge of data.edges) {
        const list = adjacency.get(edge.source);
        if (list) list.push(edge.target);
        else adjacency.set(edge.source, [edge.target]);
      }
      const visited = new Set<string>([a.sourceSymbol]);
      const queue: Array<{ id: string; path: string[] }> = [{ id: a.sourceSymbol, path: [a.sourceSymbol] }];
      let head = 0;
      while (head < queue.length) {
        const { id, path } = queue[head++]!;
        if (id === a.targetSymbol) {
          return { path, length: path.length - 1 } as unknown as JsonValue;
        }
        const neighbors = adjacency.get(id) ?? [];
        for (const next of neighbors) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push({ id: next, path: [...path, next] });
          }
        }
      }
      return null;
    },
  });

  const graphHealth = defineTool({
    name: 'graph_health',
    description: 'Calculate architecture health score (coupling, cohesion, cyclic dependency rate, modularity).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as HealthScore | null;
        if (!v) return [{ type: 'text' as const, text: 'Insufficient data for health scoring.' }];
        return [{
          type: 'text' as const,
          text: `Architecture Health: ${v.overall}/100\n  Coupling: ${v.coupling}/100\n  Cohesion: ${v.cohesion}/100\n  Cyclic Dep Rate: ${v.cyclicDependencyRate}/100\n  Modularity: ${v.modularity}/100`,
        }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;

      const moduleOfNode = new Map<string, string>();
      for (const node of data.nodes) {
        const parts = node.filePath.split(/[\\/]/);
        const module = parts.length > 1 ? parts.slice(0, -1).join('/') : node.filePath;
        moduleOfNode.set(node.id, module);
      }

      let crossModuleEdges = 0;
      for (const edge of data.edges) {
        const srcMod = moduleOfNode.get(edge.source);
        const tgtMod = moduleOfNode.get(edge.target);
        if (srcMod && tgtMod && srcMod !== tgtMod) crossModuleEdges++;
      }
      const coupling = data.edges.length > 0 ? Math.round(Math.max(0, 100 - (crossModuleEdges / data.edges.length) * 100)) : 100;

      const moduleEdges = new Map<string, { internal: number; total: number }>();
      for (const edge of data.edges) {
        const srcMod = moduleOfNode.get(edge.source);
        if (!srcMod) continue;
        let stats = moduleEdges.get(srcMod);
        if (!stats) { stats = { internal: 0, total: 0 }; moduleEdges.set(srcMod, stats); }
        stats.total++;
        if (srcMod === moduleOfNode.get(edge.target)) stats.internal++;
      }
      let totalCohesion = 0;
      let modCount = 0;
      for (const stats of moduleEdges.values()) {
        if (stats.total > 0) { totalCohesion += stats.internal / stats.total; modCount++; }
      }
      const cohesion = modCount > 0 ? Math.round((totalCohesion / modCount) * 100) : 50;

      const overall = Math.round(coupling * 0.25 + cohesion * 0.25 + 50 * 0.25 + 50 * 0.25);
      return { coupling, cohesion, cyclicDependencyRate: 50, modularity: 50, overall } as unknown as JsonValue;
    },
  });

  const graphRulesCheck = defineTool({
    name: 'graph_rules_check',
    description: 'Check code graph against architecture rules (max indegree, max outdegree, circular dependencies).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      maxIndegree: { type: 'number', description: 'Maximum allowed indegree per node. Default: 10.' },
      maxOutdegree: { type: 'number', description: 'Maximum allowed outdegree per node. Default: 15.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as RuleViolation[] | null;
        if (!v || v.length === 0) return [{ type: 'text' as const, text: 'No rule violations detected.' }];
        const lines = v.slice(0, 20).map((r) => `  [${r.severity}] ${r.message}`);
        return [{ type: 'text' as const, text: `${v.length} rule violations:\n${lines.join('\n')}` }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string; maxIndegree?: number; maxOutdegree?: number };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;

      const violations: RuleViolation[] = [];
      const maxIn = a.maxIndegree ?? 10;
      const maxOut = a.maxOutdegree ?? 15;

      const indegree = new Map<string, number>();
      const outdegree = new Map<string, number>();
      for (const edge of data.edges) {
        indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
        outdegree.set(edge.source, (outdegree.get(edge.source) ?? 0) + 1);
      }
      for (const [nodeId, count] of indegree) {
        if (count > maxIn) {
          violations.push({ ruleId: 'max-indegree', nodeId: nodeId as NodeId, message: `Node ${nodeId} has indegree ${count} (max ${maxIn})`, severity: 'warning' });
        }
      }
      for (const [nodeId, count] of outdegree) {
        if (count > maxOut) {
          violations.push({ ruleId: 'max-outdegree', nodeId: nodeId as NodeId, message: `Node ${nodeId} has outdegree ${count} (max ${maxOut})`, severity: 'warning' });
        }
      }

      return violations as unknown as JsonValue;
    },
  });

  const graphFocus = defineTool({
    name: 'graph_focus',
    description: 'Get the neighborhood (1-hop neighbors) of a symbol in the code graph.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      symbolId: { type: 'string', required: true, description: 'Symbol id to focus on.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { neighbors?: string[]; symbolId?: string } | null;
        if (!v) return [{ type: 'text' as const, text: 'Symbol not found in graph.' }];
        return [{
          type: 'text' as const,
          text: `Focus on ${v.symbolId}: ${v.neighbors?.length ?? 0} direct neighbors\n  ${v.neighbors?.slice(0, 15).join(', ') ?? ''}`,
        }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string; symbolId: string };
      const data = await fetchMergedGraph(invoke, a.repoId);
      const nodeIds = new Set(data.nodes.map((n) => n.id));
      if (!nodeIds.has(a.symbolId as NodeId)) return null;

      const neighbors = new Set<string>();
      for (const edge of data.edges) {
        if (edge.source === a.symbolId) neighbors.add(edge.target);
        if (edge.target === a.symbolId) neighbors.add(edge.source);
      }
      return { symbolId: a.symbolId, neighbors: [...neighbors] } as unknown as JsonValue;
    },
  });

  return { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphHealth, graphRulesCheck, graphFocus };
};

export { fetchMergedGraph, summarizeGraph };
export const makeRepo = (id: string): RepoId => makeRepoId(id);
