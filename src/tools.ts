// Graph tool definitions: adapters + merger wrapped as DSH `defineTool` tools.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';

import type { CodeGraphAdapter } from './adapters/CodeGraphAdapter.ts';
import type { LensAdapter } from './adapters/LensAdapter.ts';
import { GraphDataMerger } from './merger/GraphDataMerger.ts';
import { computeGraphDiff } from './merger/DiffEngine.ts';
import type { AdapterResult, GraphData, GraphUpdatedEvent, GraphDataEvent, HealthScore, RuleViolation } from './types/index.ts';
import { RepoId as makeRepoId, NodeId } from './types/index.ts';
import { HealthScorer } from './shared/analysis/HealthScorer.ts';
import { RuleEngine, type RuleDefinition } from './shared/analysis/RuleEngine.ts';
import { buildForwardAdjacency } from './shared/analysis/AdjacencyList.ts';
import { XuanjiAdapterPool, type AdapterEdgeType } from './shared/analysis/XuanjiAdapter.ts';
import { bfsShortestPath } from './shared/analysis/GraphBFS.ts';
import { scoped } from './shared/Logger.ts';
import type { ApiCompatLayer } from './host/compat/ApiCompatLayer.ts';
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

/** `graph_path_enumerate` 允许的边类型全集（Flow — 路径读法可选的 Σ_R）。 */
const PATH_EDGE_TYPE_DOMAIN: ReadonlySet<string> = new Set<AdapterEdgeType>([
  'call',
  'import',
  'extend',
  'implement',
  'dependency',
  'contains',
  'association',
  'aggregation',
  'composition',
]);

/**
 * 解析 `edgeTypes` 逗号列表：只保留域内类型；未提供或全部非法时返回 null（用默认读法）。
 * 空集规则匹配不到任何边（璇玑图 §八），所以「全部非法」不能静默变成空集过滤。
 */
function parseEdgeTypes(raw: string | undefined): readonly AdapterEdgeType[] | null {
  if (!raw) return null;
  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is AdapterEdgeType => PATH_EDGE_TYPE_DOMAIN.has(part));
  return parsed.length > 0 ? parsed : null;
}

/** 把可选的数字参数夹紧到 [min, max]；缺失/NaN 时用 fallback。 */
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
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
      const mapped = apiCompat.getAvailableToolNameFor(ctx, tool);
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
  xuanjiPool?: XuanjiAdapterPool,
) {
  const source = (args.source ?? 'both') as 'codegraph' | 'lens' | 'both';
  const fresh = await fetchMergedGraph(invoke, args.repoId, source, deps);

  const cached = graphCache.get(args.repoId);
  let merged: GraphData;
  if (cached) {
    merged = deps.merger.applyDelta(cached, { nodes: fresh.nodes, edges: fresh.edges, source: source === 'both' ? 'codegraph' : source, timestamp: fresh.metadata.timestamp });
    // XJ-02：把 merger.applyDelta 产出的**真实**结构差（缓存基线 → 合并结果）转发给璇玑图适配层，
    // 让库里的增量引擎在生产上真的被调用；delta 不是这里手搓的，而是缓存与新结果的实际差异。
    if (xuanjiPool) {
      const delta = computeGraphDiff(cached.nodes, cached.edges, merged.nodes, merged.edges);
      xuanjiPool.applyDelta(args.repoId, delta);
    }
  } else {
    // 没有缓存基线：适配层手里的可能是另一版修订，派生状态（图空间 + 增量索引）先丢掉。
    merged = fresh;
    xuanjiPool?.invalidate(args.repoId);
  }
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

export const createGraphTools = async (ctx: Context, options: { requestTimeout?: number; apiCompat?: ApiCompatLayer } = {}) => {
  const invoke = createInvoke(ctx, options.requestTimeout, options.apiCompat);
  const graphCache = new Map<string, GraphData>();
  const deps = await createGraphToolDeps();
  // XJ-02：按 repoId 缓存璇玑图适配层，让增量引擎有真正的宿主入口；
  // 生命周期挂在返回的 dispose 上（src/index.ts 的 ctx.effect 清理会调用它）。
  const xuanjiPool = new XuanjiAdapterPool();

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
    presentCall: (args) => {
      const a = args as { repoId: string };
      return { card: 'generic' as const, title: 'Check graph status', kind: 'other' as const, rawInput: { repoId: a.repoId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Graph status failed' : 'Graph status',
    }),
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
    presentCall: (args) => {
      const a = args as { repoId: string; source?: string };
      return { card: 'generic' as const, title: 'Fetch code graph', kind: 'fetch' as const, rawInput: { repoId: a.repoId, source: a.source ?? 'both' } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Graph fetch failed' : 'Code graph fetched',
    }),
    execute: (args) => executeGraphData(args as { repoId: string; source?: string }, invoke, emitUpdate, emitData, graphCache, deps, xuanjiPool),
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
    presentCall: (args) => {
      const a = args as { symbolId: string };
      return { card: 'generic' as const, title: 'Resolve symbol', kind: 'search' as const, rawInput: { symbolId: a.symbolId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Symbol resolution failed' : 'Symbol resolved',
    }),
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
    presentCall: (args) => {
      const a = args as { symbolId: string };
      return { card: 'generic' as const, title: 'Analyze impact', kind: 'search' as const, rawInput: { symbolId: a.symbolId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Impact analysis failed' : 'Impact analyzed',
    }),
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
    presentCall: (args) => {
      const a = args as { sourceSymbol: string; targetSymbol: string };
      return { card: 'generic' as const, title: 'Find call path', kind: 'search' as const, rawInput: { from: a.sourceSymbol, to: a.targetSymbol } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Path search failed' : 'Call path',
    }),
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

  const graphPathEnumerate = defineTool({
    name: 'graph_path_enumerate',
    description: 'Enumerate simple call/dependency paths between two symbols with a hop range and edge-type filter (Xuanji path-rule reader: one graph space, many reading rules).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      sourceSymbol: { type: 'string', required: true, description: 'Source symbol id.' },
      targetSymbol: { type: 'string', required: true, description: 'Target symbol id.' },
      minHops: { type: 'number', description: 'Minimum path length in edges. Default: 1.' },
      maxHops: { type: 'number', description: 'Maximum path length in edges. Default: 5, capped at 10.' },
      limit: { type: 'number', description: 'Maximum number of paths returned. Default: 10, capped at 50.' },
      edgeTypes: {
        type: 'string',
        description: 'Comma-separated edge types to traverse. Default: call,import,extend,implement,dependency.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { paths?: string[][]; truncated?: boolean; total?: number } | null;
        if (!v || !v.paths || v.paths.length === 0) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_PATH_FOUND?.en ?? 'No path found' }];
        }
        const lines = v.paths.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.join(' → ')} (${p.length - 1} hops)`);
        const suffix = v.truncated ? ' (truncated)' : '';
        return [{ type: 'text' as const, text: `${v.total ?? v.paths.length} path(s)${suffix}\n${lines.join('\n')}` }];
      },
    },
    presentCall: (args) => {
      const a = args as { sourceSymbol: string; targetSymbol: string };
      return { card: 'generic' as const, title: 'Enumerate paths', kind: 'search' as const, rawInput: { from: a.sourceSymbol, to: a.targetSymbol } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Path enumeration failed' : 'Paths enumerated',
    }),
    execute: async (args) => {
      const a = args as {
        repoId: string;
        sourceSymbol: string;
        targetSymbol: string;
        minHops?: number;
        maxHops?: number;
        limit?: number;
        edgeTypes?: string;
      };
      const data = await fetchMergedGraph(invoke, a.repoId);
      const nodeIds = new Set(data.nodes.map((n) => n.id));
      if (!nodeIds.has(NodeId(a.sourceSymbol)) || !nodeIds.has(NodeId(a.targetSymbol))) return null;
      if (data.nodes.length > PATH_FINDER.MAX_NODES_FOR_BFS) {
        return toJsonValue({ paths: [], truncated: true, total: 0 });
      }

      const adapter = xuanjiPool.get(a.repoId);
      adapter.syncGraph(data);
      const parsedTypes = parseEdgeTypes(a.edgeTypes);
      const result = adapter.findPathsBetween(a.sourceSymbol, a.targetSymbol, {
        ...(parsedTypes ? { edgeTypes: parsedTypes } : {}),
        minHops: clampInt(a.minHops, 1, 10, 1),
        maxHops: clampInt(a.maxHops, 1, 10, 5),
        limit: clampInt(a.limit, 1, 50, 10),
      });
      return toJsonValue(result);
    },
  });


  const graphCycles = defineTool({
    name: 'graph_cycles',
    description: 'Enumerate simple dependency cycles (closed paths) in the code graph with a length bound. Each cycle is canonicalised (Booth minimal rotation) so it is reported once regardless of its starting symbol (Xuanji closed-path reader).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      maxLength: { type: 'number', description: 'Maximum cycle length in edges. Default: 6, capped at 12.' },
      limit: { type: 'number', description: 'Maximum number of cycles returned. Default: 100, capped at 500.' },
      edgeTypes: {
        type: 'string',
        description: 'Comma-separated edge types to traverse. Default: call,import,extend,implement,dependency.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as { paths?: string[][]; truncated?: boolean; total?: number } | null;
        if (!v || !v.paths || v.paths.length === 0) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_CYCLES?.en ?? 'No dependency cycles detected.' }];
        }
        const lines = v.paths.slice(0, 10).map((cycle, i) => `  ${i + 1}. ${cycle.join(' → ')}`);
        const suffix = v.truncated ? ' (truncated)' : '';
        return [{ type: 'text' as const, text: `${v.total ?? v.paths.length} cycle(s)${suffix}\n${lines.join('\n')}` }];
      },
    },
    presentCall: (args) => {
      const a = args as { repoId: string };
      return { card: 'generic' as const, title: 'Enumerate dependency cycles', kind: 'search' as const, rawInput: { repoId: a.repoId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Cycle enumeration failed' : 'Dependency cycles',
    }),
    execute: async (args) => {
      const a = args as { repoId: string; maxLength?: number; limit?: number; edgeTypes?: string };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;
      if (data.nodes.length > PATH_FINDER.MAX_NODES_FOR_BFS) {
        return toJsonValue({ paths: [], truncated: true, total: 0 });
      }

      const adapter = xuanjiPool.get(a.repoId);
      adapter.syncGraph(data);
      const parsedTypes = parseEdgeTypes(a.edgeTypes);
      const result = adapter.cycles({
        ...(parsedTypes ? { edgeTypes: parsedTypes } : {}),
        maxLength: clampInt(a.maxLength, 1, 12, 6),
        limit: clampInt(a.limit, 1, 500, 100),
      });
      return toJsonValue(result);
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
    presentCall: (args) => {
      const a = args as { repoId: string };
      return { card: 'generic' as const, title: 'Calculate health score', kind: 'other' as const, rawInput: { repoId: a.repoId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Health scoring failed' : 'Health score',
    }),
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
    presentCall: (args) => {
      const a = args as { repoId: string; maxIndegree?: number; maxOutdegree?: number };
      return { card: 'generic' as const, title: 'Check architecture rules', kind: 'other' as const, rawInput: { repoId: a.repoId, maxIndegree: a.maxIndegree ?? 10, maxOutdegree: a.maxOutdegree ?? 15 } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Rules check failed' : 'Rules checked',
    }),
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
    presentCall: (args) => {
      const a = args as { symbolId: string };
      return { card: 'generic' as const, title: 'Focus on symbol', kind: 'search' as const, rawInput: { symbolId: a.symbolId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Focus failed' : 'Symbol neighborhood',
    }),
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

  return { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphPathEnumerate, graphCycles, graphHealth, graphRulesCheck, graphFocus, dispose: () => { xuanjiPool.dispose(); graphCache.clear(); } };
};


