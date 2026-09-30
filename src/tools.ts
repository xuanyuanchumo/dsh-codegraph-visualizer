// Graph tool definitions: adapters + merger wrapped as DSH `defineTool` tools.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';

import type { CodeGraphAdapter } from './adapters/CodeGraphAdapter.ts';
import type { LensAdapter } from './adapters/LensAdapter.ts';
import { GraphDataMerger } from './merger/GraphDataMerger.ts';
import type { AdapterResult, GraphData, GraphUpdatedEvent, GraphDataEvent, HealthScore, RuleViolation } from './types/index.ts';
import { RepoId as makeRepoId, NodeId } from './types/index.ts';
import { HealthScorer } from './shared/analysis/HealthScorer.ts';
import { RuleEngine, type RuleDefinition } from './shared/analysis/RuleEngine.ts';
import { buildForwardAdjacency } from './shared/analysis/AdjacencyList.ts';
import { bfsShortestPath } from './shared/analysis/GraphBFS.ts';
import { scoped } from './shared/Logger.ts';
import type { ApiCompatLayer, ToolNameMapping } from './host/compat/ApiCompatLayer.ts';
import { CACHE, PATH_FINDER, TOOL_MESSAGES, API } from './shared/constants.ts';
import {
  summarizeGraph,
  normalizeImpact,
  pickBestMatch,
  renderGraphStatus,
  renderGraphData,
  renderGraphSymbol,
  renderGraphImpact,
} from './graphUtils.ts';

// Re-export pure functions for backward compatibility
export {
  summarizeGraph,
  normalizeImpact,
  pickBestMatch,
  renderGraphStatus,
  renderGraphData,
  renderGraphSymbol,
  renderGraphImpact,
};

const log = scoped('tools');

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export type { UpstreamInvoker } from './adapters/IAdapter.ts';
import type { UpstreamInvoker } from './adapters/IAdapter.ts';

const GRAPH_CACHE_LIMIT = CACHE.GRAPH_CACHE_LIMIT;

export interface GraphToolDeps {
  codegraphAdapter: CodeGraphAdapter;
  lensAdapter: LensAdapter;
  merger: GraphDataMerger;
}

export async function createGraphToolDeps(): Promise<GraphToolDeps> {
  const [{ CodeGraphAdapter: CGA }, { LensAdapter: LA }] = await Promise.all([
    import('./adapters/CodeGraphAdapter.ts'),
    import('./adapters/LensAdapter.ts'),
  ]);
  return {
    codegraphAdapter: new CGA(),
    lensAdapter: new LA(),
    merger: new GraphDataMerger(),
  };
}

function cacheGraph(cache: Map<string, GraphData>, repoId: string, data: GraphData): void {
  cache.delete(repoId);
  cache.set(repoId, data);
  if (cache.size > GRAPH_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function fetchMergedGraph(
  invoke: UpstreamInvoker,
  repoId: string,
  source: 'codegraph' | 'lens' | 'both' | 'auto' = 'both',
  deps?: GraphToolDeps,
): Promise<GraphData> {
  const d = deps ?? await createGraphToolDeps();
  const tasks: Promise<AdapterResult>[] = [];
  if (source === 'codegraph' || source === 'both' || source === 'auto') {
    tasks.push(d.codegraphAdapter.fetchData(repoId, invoke));
  }
  if (source === 'lens' || source === 'both' || source === 'auto') {
    tasks.push(d.lensAdapter.fetchData(repoId, invoke));
  }
  const settled = await Promise.allSettled(tasks);
  const results: AdapterResult[] = settled
    .filter((r): r is PromiseFulfilledResult<AdapterResult> => r.status === 'fulfilled')
    .map((r) => r.value);
  const merged = d.merger.merge(results, makeRepoId(repoId));
  if (source === 'auto' && merged.nodes.length === 0) {
    log.info('fetchMergedGraph: auto mode — external sources returned empty, built-in analysis always available');
  }
  return merged;
}


// ── Extracted execute/render functions for testability ──────────────────

export function createInvoke(ctx: Context, requestTimeout: number = API.INVOKE_DEFAULT_TIMEOUT_MS, apiCompat?: ApiCompatLayer): UpstreamInvoker {
  return async (tool, args) => {
    let resolvedName = tool;
    if (apiCompat) {
      const mapped = apiCompat.getAvailableToolName(ctx, tool as keyof ToolNameMapping);
      if (mapped) resolvedName = mapped;
    }
    try {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`codegraph:${resolvedName}`),
        name: resolvedName,
        arguments: args,
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (result.isError) return null;
      return result.value ?? null;
    } catch (e) {
      log.warn('createInvoke: tool execution failed', { tool: resolvedName, error: e });
      return null;
    }
  };
}


export async function executeGraphStatus(args: { repoId: string }, invoke: UpstreamInvoker, deps: GraphToolDeps) {
  const [cgResult, lensResult] = await Promise.allSettled([
    deps.codegraphAdapter.fetchData(args.repoId, invoke),
    deps.lensAdapter.fetchData(args.repoId, invoke),
  ]);
  const results: AdapterResult[] = [cgResult, lensResult]
    .filter((r): r is PromiseFulfilledResult<AdapterResult> => r.status === 'fulfilled')
    .map((r) => r.value);
  const data = deps.merger.merge(results, makeRepoId(args.repoId));
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


export async function executeGraphData(
  args: { repoId: string; source?: string },
  invoke: UpstreamInvoker,
  emitUpdate: (event: GraphUpdatedEvent) => void,
  emitData: (event: GraphDataEvent) => void,
  graphCache: Map<string, GraphData>,
  deps: GraphToolDeps,
) {
  const source = (args.source ?? 'both') as 'codegraph' | 'lens' | 'both';
  const fresh = await fetchMergedGraph(invoke, args.repoId, source, deps);

  const cached = graphCache.get(args.repoId);
  const merged = cached
    ? deps.merger.applyDelta(cached, { nodes: fresh.nodes, edges: fresh.edges, source: source === 'both' ? 'codegraph' : source, timestamp: fresh.metadata.timestamp })
    : fresh;
  cacheGraph(graphCache, args.repoId, merged);

  emitUpdate({
    repoId: makeRepoId(args.repoId),
    nodeCount: merged.metadata.nodeCount,
    edgeCount: merged.metadata.edgeCount,
    timestamp: merged.metadata.timestamp,
  });
  emitData({
    repoId: makeRepoId(args.repoId),
    nodes: merged.nodes,
    edges: merged.edges,
    timestamp: merged.metadata.timestamp,
  });
  return toJsonValue(merged);
}


export async function executeGraphSymbol(args: { symbolId: string }, invoke: UpstreamInvoker) {
  const raw = await invoke('codegraph_query', { search: args.symbolId, limit: 1 });
  return toJsonValue(pickBestMatch(raw, args.symbolId));
}


export async function executeGraphImpact(args: { symbolId: string }, invoke: UpstreamInvoker) {
  const raw = await invoke('codegraph_impact', { symbol: args.symbolId, depth: 2 });
  const normalized = normalizeImpact(raw);
  if (normalized) return toJsonValue(normalized);
  const lens = await invoke('lens_impact', { symbolId: args.symbolId });
  return toJsonValue(lens ?? { affected: [], depth: 0 });
}

// ── Tool factory ────────────────────────────────────────────────────────

export const createGraphTools = async (ctx: Context, options: { requestTimeout?: number } = {}) => {
  const invoke = createInvoke(ctx, options.requestTimeout);
  const graphCache = new Map<string, GraphData>();
  const deps = await createGraphToolDeps();

  const emitUpdate = (event: GraphUpdatedEvent) => {
    ctx.emit('codegraph-visualizer/graph/updated', event);
  };

  const emitData = (event: GraphDataEvent) => {
    ctx.emit('codegraph-visualizer/graph/data', event);
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
    execute: (args) => executeGraphStatus(args as { repoId: string }, invoke, deps),
  });

  const graphData = defineTool({
    name: 'graph_data',
    description: 'Fetch the merged code relationship graph for a repository (calls + dependencies). Uses incremental delta merge on repeat calls.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      source: {
        type: 'string',
        enum: ['codegraph', 'lens', 'both', 'auto'],
        description: 'Data source; defaults to both. Use auto for graceful degradation to built-in analysis.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: renderGraphData,
    },
    execute: (args) => executeGraphData(args as { repoId: string; source?: string }, invoke, emitUpdate, emitData, graphCache, deps),
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
        const v = value as { path?: string[]; length?: number; truncated?: boolean } | null;
        if (!v || !v.path || v.path.length === 0) {
          if (v?.truncated) return [{ type: 'text' as const, text: TOOL_MESSAGES.GRAPH_TOO_LARGE_FOR_PATH?.en ?? 'Graph too large' }];
          return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_PATH_FOUND?.en ?? 'No path found' }];
        }
        return [{ type: 'text' as const, text: `${TOOL_MESSAGES.PATH_FOUND?.en ?? 'Path found'} (${v.length} ${TOOL_MESSAGES.HOPS?.en ?? 'hops'}): ${v.path.join(' → ')}` }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string; sourceSymbol: string; targetSymbol: string };
      const data = await fetchMergedGraph(invoke, a.repoId);
      const nodeIds = new Set(data.nodes.map((n) => n.id));
      if (!nodeIds.has(NodeId(a.sourceSymbol)) || !nodeIds.has(NodeId(a.targetSymbol))) {
        return null;
      }
      if (data.nodes.length > PATH_FINDER.MAX_NODES_FOR_BFS) return toJsonValue({ path: [], length: 0, truncated: true });
      const adjacency = buildForwardAdjacency(data.edges);
      const result = bfsShortestPath(adjacency, a.sourceSymbol, a.targetSymbol, data.nodes.length);
      if (!result) return null;
      return toJsonValue({ path: result.path, length: result.length });
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
        if (!v) return [{ type: 'text' as const, text: TOOL_MESSAGES.INSUFFICIENT_DATA?.en ?? 'Insufficient data' }];
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

      const scorer = new HealthScorer();
      const score = scorer.calculate(data.nodes, data.edges);
      return toJsonValue(score);
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
        if (!v || v.length === 0) return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_VIOLATIONS?.en ?? 'No violations' }];
        const lines = v.slice(0, 20).map((r) => `  [${r.severity}] ${r.message}`);
        return [{ type: 'text' as const, text: `${v.length} ${TOOL_MESSAGES.RULE_VIOLATIONS?.en ?? 'rule violations:'}\n${lines.join('\n')}` }];
      },
    },
    execute: async (args) => {
      const a = args as { repoId: string; maxIndegree?: number; maxOutdegree?: number };
      const data = await fetchMergedGraph(invoke, a.repoId, 'both', deps);
      if (data.nodes.length === 0) return null;

      const maxIn = a.maxIndegree ?? 10;
      const maxOut = a.maxOutdegree ?? 15;

      const rules: RuleDefinition[] = [
        { id: 'max-indegree', name: 'Max Indegree', type: 'max-indegree', params: { threshold: maxIn }, severity: 'warning', enabled: true },
        { id: 'max-outdegree', name: 'Max Outdegree', type: 'max-outdegree', params: { threshold: maxOut }, severity: 'warning', enabled: true },
      ];

      const engine = new RuleEngine();
      const violations = engine.check(rules, data.nodes, data.edges);

      return toJsonValue(violations);
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
      if (!nodeIds.has(NodeId(a.symbolId))) return null;

      const neighbors = new Set<string>();
      for (const edge of data.edges) {
        if (edge.source === a.symbolId) neighbors.add(edge.target);
        if (edge.target === a.symbolId) neighbors.add(edge.source);
      }
      return toJsonValue({ symbolId: a.symbolId, neighbors: [...neighbors] });
    },
  });

  return { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphHealth, graphRulesCheck, graphFocus, dispose: () => graphCache.clear() };
};


