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
import { renderSubgraphText, selectSeeds, tokenizeQuery } from './xuanji/query/keyword-query.ts';
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
  /**
   * 原生代码图谱通道（cycle-127）：目录结构 + TreeSitter 符号 + AST 边。
   * `null` = 宿主未注入文件系统能力（headless/受限环境），auto 降级链跳过该级。
   */
  nativeAdapter: NativeGraphAdapter | null;
}

/**
 * 原生图适配的最小契约（cycle-127）。
 *
 * 刻意用结构类型而非直接 import FileSystemAdapter：依赖方向是 tools → 契约，
 * 具体实现（Node fs 注入版）由宿主组装方决定，测试也可注入内存 fs 桩。
 * `fetchDataWithSymbols` 一次产出「目录树 + 符号 + 边」的完整原生图。
 */
export interface NativeGraphAdapter {
  readonly source: 'tree-sitter';
  fetchDataWithSymbols(repoId: string): Promise<AdapterResult>;
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
    // cycle-131 · P0 第二层修复：原生适配器走**模块级单例**（ensureNativeAdapter），
    // 不再依赖 createGraphTools 工厂内的 options.nativeWorkspaceRoot 组装——
    // 生产主路径（watcher / /scan / service / /init）调 fetchMergedGraph 不传 deps，
    // 缺省 createGraphToolDeps() 此前永远得到 nativeAdapter: null，原生层在宿主面
    // 零可达（真机取证：registry 37 能力全注册但 scan 0 节点 empty）。Node 运行时
    // 检测失败（非 Node / fs 不可用）才诚实降级 null。
    nativeAdapter: await ensureNativeAdapter(),
  };
}

/**
 * 原生图适配器的模块级单例（cycle-131 · P0 第二层修复）。
 *
 * 组装一次全 host 复用（Node fs + TreeSitterAdapter 各自内部已单例化 wasm）；
 * 失败结果也缓存（null = 环境不支持，避免每次调用重试）。
 */
let nativeAdapterSingleton: NativeGraphAdapter | null | undefined;
async function ensureNativeAdapter(): Promise<NativeGraphAdapter | null> {
  if (nativeAdapterSingleton !== undefined) return nativeAdapterSingleton;
  nativeAdapterSingleton = null; // 失败缺省
  try {
    const [{ FileSystemAdapter: FSA }, { TreeSitterAdapter: TSA }, nodeFs] = await Promise.all([
      import('./adapters/FileSystemAdapter.ts'),
      import('./adapters/TreeSitterAdapter.ts'),
      import('node:fs'),
    ]);
    const fsAdapter = new FSA();
    fsAdapter.setFileSystem({
      readdir: (p) => nodeFs.readdirSync(p, { encoding: 'utf-8' }),
      readFile: (p) => nodeFs.readFileSync(p, 'utf-8'),
      stat: (p) => ({ isDirectory: nodeFs.statSync(p).isDirectory() }),
    });
    fsAdapter.setTreeSitterAdapter(new TSA());
    nativeAdapterSingleton = fsAdapter;
    log.info('native graph layer adapter ready (module singleton)');
  } catch (e) {
    log.warn('native graph layer init failed — native fallback disabled', { error: String(e) });
  }
  return nativeAdapterSingleton;
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
  // cycle-127 · T3：图层来源声明——上游任一通道有产出即 'upstream'（原生通道
  // 不再启用）；否则进入降级链评估，最终标记见下方 native 分支与空态。
  (merged.metadata as GraphData['metadata']).graphLayer = merged.nodes.length > 0 ? 'upstream' : 'empty';
  // cycle-127 · T1：auto 降级链第三级——上游 DB 与 lens 双缺席时启用原生通道
  // （目录结构 + TreeSitter 符号 + AST 边）。此前该场景 merge 结果为空图，而
  // :134 的日志宣称「built-in analysis always available」——假承诺。原生通道
  // 只在**外部源双双缺席**时启用：上游在场时行为逐字节不变（兼容矩阵见规划 §3）。
  // cycle-128 · T2：第三级升级为「索引库优先」——原生 SQLite 索引（上游 schema
  // 兼容）可读时直接走既有 DB 分页读取（毫秒级），缺席才实时 batchScan 并回写。
  // cycle-131 · P0 修复：原生降级链的触发条件从 `source === 'auto'` 扩到
  // 「外部源双缺席」本身。此前生产主路径（watcher 槽填充 / /scan / service /
  // /init 共 7 处）硬编码 'both'，而降级链只认 'auto' —— 原生层在真实宿主里
  // 从未可达（真机取证：上游双缺席工作区 graphLayer='empty' 0 节点，registry
  // 37 能力全注册但原生四轮交付零消费）。'both' 语义升级为「上游两源 + 缺席
  // 补位」：上游在场行为逐字节不变；'auto' 保持查询面显式全降级语义（含
  // graphLayer 评估），两者共用同一条降级链实现。
  const allowNativeFallback = merged.nodes.length === 0 && d.nativeAdapter !== null
    && (source === 'auto' || source === 'both');
  if (allowNativeFallback) {
    try {
      const [{ readGraphFromDbPaged }, { mapRowsToGraphNodes, mapRowsToGraphEdges }, { resolveNativeIndexPath, readNativeIndexMeta, writeNativeIndex }] = await Promise.all([
        import('./adapters/codeGraphDb.ts'),
        import('./adapters/codeGraphRows.ts'),
        import('./adapters/nativeIndex.ts'),
      ]);
      // ① 索引库优先：库在场且有 meta ⇒ 既有读侧函数分页读取（零改动兼容）。
      try {
        const indexPath = resolveNativeIndexPath(repoId);
        const meta = readNativeIndexMeta(repoId);
        if (meta) {
          const dbNodes: unknown[] = [];
          const dbEdges: unknown[] = [];
          let cursor: import('./adapters/codeGraphDb.ts').GraphPageCursor | null = null;
          for (;;) {
            const page = readGraphFromDbPaged(indexPath, cursor, 500);
            if (!page) break;
            dbNodes.push(...page.nodes);
            dbEdges.push(...page.edges);
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
          }
          if (dbNodes.length > 0) {
            const validIds = new Set(dbNodes.map((n) => String((n as { id: unknown }).id)));
            const nodes = mapRowsToGraphNodes(dbNodes as Parameters<typeof mapRowsToGraphNodes>[0]);
            const edges = mapRowsToGraphEdges(dbEdges as Parameters<typeof mapRowsToGraphEdges>[0], validIds);
            const fromIndex = d.merger.merge([{ nodes, edges, source: 'tree-sitter', timestamp: meta.indexedAt }], makeRepoId(repoId));
            (fromIndex.metadata as GraphData['metadata']).graphLayer = 'native';
            (fromIndex.metadata as GraphData['metadata']).nativeIndex = { hit: true, indexedAt: meta.indexedAt, fingerprint: meta.fingerprint };
            log.info('fetchMergedGraph: native graph served from index', { nodes: fromIndex.nodes.length, edges: fromIndex.edges.length, indexedAt: meta.indexedAt });
            try {
              const { enhanceInheritanceDataCached } = await import('./host/inheritanceEnhancer.ts');
              await enhanceInheritanceDataCached(fromIndex, repoId);
            } catch (e) {
              log.warn('inheritance enhancement failed on native index graph', { error: String(e) });
            }
            return fromIndex;
          }
        }
      } catch (e) {
        log.warn('native index read failed — falling back to live scan', { error: String(e) });
      }
      // ② 实时扫描（库缺席/空库/读失败）。allowNativeFallback 已保证非 null，
      // 但 TS 无法跨块追踪——非空断言安全（块内无 await 前的置空路径）。
      const nativeAdapter = d.nativeAdapter as NativeGraphAdapter;
      const nativeResult = await nativeAdapter.fetchDataWithSymbols(repoId);
      if (nativeResult.nodes.length > 0) {
        // ③ 回写索引（写失败不阻塞图返回——索引是缓存层）。
        try {
          const { computeGraphFingerprint } = await import('./shared/graphFingerprint.ts');
          const fp = computeGraphFingerprint({ nodes: nativeResult.nodes, edges: nativeResult.edges, metadata: { repoId: makeRepoId(repoId), timestamp: 0, nodeCount: nativeResult.nodes.length, edgeCount: nativeResult.edges.length } } as GraphData);
          writeNativeIndex(repoId, fp, nativeResult.nodes, nativeResult.edges);
        } catch (e) {
          log.warn('native index write-back failed', { error: String(e) });
        }
        const nativeMerged = d.merger.merge([nativeResult], makeRepoId(repoId));
        log.info('fetchMergedGraph: auto fallback to native graph layer (live scan)', {
          nodes: nativeMerged.nodes.length,
          edges: nativeMerged.edges.length,
          source: nativeResult.source,
        });
        // 继承增强同样作用于原生图（AST 推断边是它的核心输入）。
        try {
          const { enhanceInheritanceDataCached } = await import('./host/inheritanceEnhancer.ts');
          await enhanceInheritanceDataCached(nativeMerged, repoId);
        } catch (e) {
          log.warn('inheritance enhancement failed on native graph', { error: String(e) });
        }
        (nativeMerged.metadata as GraphData['metadata']).graphLayer = 'native';
        return nativeMerged;
      }
    } catch (e) {
      log.warn('native graph layer failed in fetchMergedGraph', { error: String(e) });
    }
  }
  if (source === 'auto' && merged.nodes.length === 0) {
    log.info('fetchMergedGraph: auto mode — external sources returned empty and no native graph layer available');
  }
  // cycle-131 · P0 修复的另一半：'both' 双缺席且原生不可用时也标记 empty（诚实空态
  // 与 auto 一致——graphLayer 已在上方统一标记）。
  // 继承数据增强（cycle-125 下沉）：在此单一合并点注入，watcher（客户端 /data 槽
  // 填充）/ queryRoute / graph_data 工具三路自动受益——此前只接在 executeGraphData
  // （模型工具）里，客户端继承视图永远看不到增强边（cycle-122 贯通家族的客户端断环）。
  // 指纹键缓存：同指纹跳过 4.6s AST 扫描（enhanceInheritanceDataCached 内部管理）。
  try {
    const { enhanceInheritanceDataCached } = await import('./host/inheritanceEnhancer.ts');
    await enhanceInheritanceDataCached(merged, repoId);
  } catch (e) {
    log.warn('inheritance enhancement failed in fetchMergedGraph', { error: String(e) });
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
  // XJ-11 消费端收口（cycle-122）：增量引擎的降级/健康信号必须落到返回值里——
  // 「不可观测的降级等于没有降级」（incremental.ts 头注）。此前 pool.applyDelta
  // 的返回值在这里被整行丢弃，模型永远看不到引擎状态。
  let xuanjiSignal: GraphData['metadata']['xuanji'] | undefined;
  if (cached) {
    merged = deps.merger.applyDelta(cached, { nodes: fresh.nodes, edges: fresh.edges, source: source === 'both' ? 'codegraph' : source, timestamp: fresh.metadata.timestamp });
    // XJ-02：把 merger.applyDelta 产出的**真实**结构差（缓存基线 → 合并结果）转发给璇玑图适配层，
    // 让库里的增量引擎在生产上真的被调用；delta 不是这里手搓的，而是缓存与新结果的实际差异。
    if (xuanjiPool) {
      const delta = computeGraphDiff(cached.nodes, cached.edges, merged.nodes, merged.edges);
      const poolDelta = xuanjiPool.applyDelta(args.repoId, delta);
      xuanjiSignal = {
        applied: poolDelta.applied,
        // 仅 applied 时带数值：skipped 意味着引擎根本没跑，addedPaths=0 是假量化。
        ...(poolDelta.applied ? { addedPaths: poolDelta.addedPaths } : {}),
        ...(poolDelta.degradedRules.length > 0 ? { degradedRules: poolDelta.degradedRules } : {}),
        ...(poolDelta.invariants.violated.length > 0 ? { invariantViolations: poolDelta.invariants.violated } : {}),
      };
    }
  } else {
    // 没有缓存基线：适配层手里的可能是另一版修订，派生状态（图空间 + 增量索引）先丢掉。
    merged = fresh;
    xuanjiPool?.invalidate(args.repoId);
    // 全量重建：不带 xuanji 信号（undefined = 「这次没走增量」，与 skipped 显式区分）。
  }
  if (xuanjiSignal) merged = { ...merged, metadata: { ...merged.metadata, xuanji: xuanjiSignal } };

  // 继承增强已下沉到 fetchMergedGraph（cycle-125）：fresh 的 metadata.inheritance
  // 在此透传（缓存路径由 applyDelta 的 ...current.metadata 保留旧值，此处用 fresh
  // 的最新值覆盖——它描述当前全量图的真实增强状态）。
  if (fresh.metadata.inheritance) {
    merged = { ...merged, metadata: { ...merged.metadata, inheritance: fresh.metadata.inheritance } };
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
    // XJ-11 消费端收口：信号随 SSE 图数据事件直达客户端 StatusBar（三层贯通：
    // 增量引擎 → 工具返回值 → SSE 载荷 → store → UI）。
    ...(xuanjiSignal ? { xuanji: xuanjiSignal } : {}),
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

export const createGraphTools = async (ctx: Context, options: { requestTimeout?: number; apiCompat?: ApiCompatLayer; /** 原生图谱通道的工作区根（cycle-127）；缺省 = 不启用原生通道。 */ nativeWorkspaceRoot?: string } = {}) => {
  const invoke = createInvoke(ctx, options.requestTimeout, options.apiCompat);
  const graphCache = new Map<string, GraphData>();
  const deps = await createGraphToolDeps();
  // cycle-131：原生适配器已由 createGraphToolDeps 的模块级单例自动挂载
  // （ensureNativeAdapter）——本工厂不再需要 options.nativeWorkspaceRoot 组装
  // （保留参数向后兼容，仅记录日志）。
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
      cursor: {
        type: 'number',
        description: 'Pagination cursor: number of paths already returned. Use the previous call\'s nextCursor.',
      },
      pageSize: { type: 'number', description: 'Paths per page. Defaults to limit, capped at 50.' },
      edgeTypes: {
        type: 'string',
        description: 'Comma-separated edge types to traverse. Default: call,import,extend,implement,dependency.',
      },
      truncation: {
        type: 'string',
        description: "How to choose which paths to keep when capping the result. 'dfs-order' (default) stops at the cap in deterministic DFS order; 'top-k-weight' enumerates ALL candidates first and keeps the paths with the highest total edge weight — slower on large graphs.",
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as {
          paths?: string[][];
          truncated?: boolean;
          total?: number;
          nextCursor?: number | null;
          labels?: unknown[];
        } | null;
        if (!v || !v.paths || v.paths.length === 0) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_PATH_FOUND?.en ?? 'No path found' }];
        }
        const lines = v.paths.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.join(' → ')} (${p.length - 1} hops)`);
        const suffix = v.truncated ? ' (truncated)' : '';
        // XJ-03：分页游标必须出现在人读的摘要里，否则调用方无从翻页（"返回了字段但没人知道"）。
        const next = v.nextCursor === null || v.nextCursor === undefined ? '' : ` (nextCursor=${String(v.nextCursor)})`;
        return [{ type: 'text' as const, text: `${v.total ?? v.paths.length} path(s)${suffix}${next}\n${lines.join('\n')}` }];
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
        cursor?: number;
        pageSize?: number;
        edgeTypes?: string;
        truncation?: string;
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
      const limit = clampInt(a.limit, 1, 50, 10);
      const result = adapter.findPathsBetween(a.sourceSymbol, a.targetSymbol, {
        ...(parsedTypes ? { edgeTypes: parsedTypes } : {}),
        minHops: clampInt(a.minHops, 1, 10, 1),
        maxHops: clampInt(a.maxHops, 1, 10, 5),
        limit,
        ...(a.cursor === undefined ? {} : { cursor: clampInt(a.cursor, 0, Number.MAX_SAFE_INTEGER, 0) }),
        ...(a.pageSize === undefined ? {} : { pageSize: clampInt(a.pageSize, 1, 50, limit) }),
        // cycle-119 修复：schema 暴露了 truncation 但 execute 从未透传——「参数加了、
        // 没人传」家族（与 P3-R18-02 同形）。数据面（confidence→weight）贯通后这个参数
        // 才真正有行为差异：无 weight 数据时 top-k-weight 与 dfs-order 结果一致。
        ...(a.truncation === 'top-k-weight' || a.truncation === 'dfs-order'
          ? { truncation: a.truncation }
          : {}),
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
      cursor: {
        type: 'number',
        description: 'Pagination cursor: number of cycles already returned. Use the previous call\'s nextCursor.',
      },
      pageSize: { type: 'number', description: 'Cycles per page. Defaults to limit, capped at 500.' },
      edgeTypes: {
        type: 'string',
        description: 'Comma-separated edge types to traverse. Default: call,import,extend,implement,dependency.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as {
          paths?: string[][];
          truncated?: boolean;
          total?: number;
          nextCursor?: number | null;
        } | null;
        if (!v || !v.paths || v.paths.length === 0) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.NO_CYCLES?.en ?? 'No dependency cycles detected.' }];
        }
        const lines = v.paths.slice(0, 10).map((cycle, i) => `  ${i + 1}. ${cycle.join(' → ')}`);
        const suffix = v.truncated ? ' (truncated)' : '';
        const next = v.nextCursor === null || v.nextCursor === undefined ? '' : ` (nextCursor=${String(v.nextCursor)})`;
        return [{ type: 'text' as const, text: `${v.total ?? v.paths.length} cycle(s)${suffix}${next}\n${lines.join('\n')}` }];
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
      const a = args as {
        repoId: string;
        maxLength?: number;
        limit?: number;
        cursor?: number;
        pageSize?: number;
        edgeTypes?: string;
      };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;
      if (data.nodes.length > PATH_FINDER.MAX_NODES_FOR_BFS) {
        return toJsonValue({ paths: [], truncated: true, total: 0 });
      }

      const adapter = xuanjiPool.get(a.repoId);
      adapter.syncGraph(data);
      const parsedTypes = parseEdgeTypes(a.edgeTypes);
      const limit = clampInt(a.limit, 1, 500, 100);
      const result = adapter.cycles({
        ...(parsedTypes ? { edgeTypes: parsedTypes } : {}),
        maxLength: clampInt(a.maxLength, 1, 12, 6),
        limit,
        ...(a.cursor === undefined ? {} : { cursor: clampInt(a.cursor, 0, Number.MAX_SAFE_INTEGER, 0) }),
        ...(a.pageSize === undefined ? {} : { pageSize: clampInt(a.pageSize, 1, 500, limit) }),
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

  const graphQuery = defineTool({
    name: 'graph_query',
    description:
      'Keyword/symbol query over the code graph: match seeds (exact > prefix > substring > file path), expand a bounded subgraph around them and render it as a token-budgeted text summary. CJK keywords are supported (whole run + per-character tokens).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      query: {
        type: 'string',
        required: true,
        description: 'Keywords or symbol names (space separated for multiple terms; Chinese supported).',
      },
      depth: { type: 'number', description: 'Subgraph expansion hops from each seed. Default 1, capped at 3.' },
      tokenBudget: { type: 'number', description: 'Token budget for the rendered text. Default 1200, capped at 8000.' },
      maxSeeds: { type: 'number', description: 'Maximum seeds. Default 3, capped at 10. Each query term also guarantees one seed.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as
          | {
              text?: string;
              seeds?: Array<{ id: string; label: string; score: number }>;
              tokens?: number;
              truncated?: boolean;
              reason?: string;
            }
          | null;
        if (!v || !v.text) return [{ type: 'text' as const, text: 'No seed matched the query.' }];
        const seedLine =
          v.seeds && v.seeds.length > 0
            ? `seeds: ${v.seeds.map((seed) => `${seed.label}(${seed.score})`).join(', ')}\n`
            : '';
        const meta = `${v.tokens ?? 0} tokens${v.truncated ? ` / truncated (${v.reason})` : ''}`;
        return [{ type: 'text' as const, text: `${seedLine}${meta}\n${v.text}` }];
      },
    },
    presentCall: (args) => {
      const a = args as { repoId: string; query: string };
      return { card: 'generic' as const, title: 'Query graph', kind: 'search' as const, rawInput: { repoId: a.repoId, query: a.query } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Graph query failed' : 'Graph query result',
    }),
    execute: async (args) => {
      const a = args as {
        repoId: string;
        query: string;
        depth?: number;
        tokenBudget?: number;
        maxSeeds?: number;
      };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;

      const terms = tokenizeQuery(a.query);
      if (terms.length === 0) {
        return toJsonValue({
          query: a.query,
          terms,
          seeds: [],
          text: 'No searchable term in query (need at least one letter/digit or CJK character).',
          tokens: 0,
          truncated: false,
          reason: 'fits',
          nodeCount: 0,
          edgeCount: 0,
        });
      }

      const seeds = selectSeeds(
        data.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
        })),
        terms,
        { maxK: clampInt(a.maxSeeds, 1, 10, 3) },
      );
      const rendered = renderSubgraphText(
        {
          nodes: data.nodes.map((node) => ({
            id: node.id,
            label: node.label,
            ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
          })),
          edges: data.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
        },
        seeds,
        { depth: clampInt(a.depth, 0, 3, 1), tokenBudget: clampInt(a.tokenBudget, 50, 8000, 1200) },
      );

      return toJsonValue({
        query: a.query,
        terms,
        seeds: seeds.map((seed) => ({
          id: seed.id,
          label: seed.label,
          score: seed.score,
          matchedTerms: [...seed.matchedTerms],
        })),
        ...rendered,
      });
    },
  });

  return {
    graphStatus,
    graphData,
    graphSymbol,
    graphImpact,
    graphPathFind,
    graphPathEnumerate,
    graphCycles,
    graphHealth,
    graphRulesCheck,
    graphFocus,
    graphQuery,
    dispose: () => {
      xuanjiPool.dispose();
      graphCache.clear();
    },
  };
};


