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
import { XuanjiAdapterPool, formatPatternError, type AdapterEdgeType } from './shared/analysis/XuanjiAdapter.ts';
import { sliceGraphForTemporal, temporalXuanjiPool } from './shared/analysis/temporalEnumeration.ts';
// ρ 语法错误的**类型判定**用 instanceof，不用 `e.name === 'PathPatternError'`：
// name 是运行期字符串，重命名/minify/子类化都会让它静默失效；class 身份是编译期绑定的。
import { PathPatternError } from './xuanji/core/path-pattern.ts';
import { renderSubgraphText, selectSeeds, tokenizeQuery } from './xuanji/query/keyword-query.ts';
import { bfsShortestPath } from './shared/analysis/GraphBFS.ts';
import { scoped } from './shared/Logger.ts';
import {
  graphSlice as sliceGraph,
  focusNeighborhood,
  computeDomainLabels,
  GRAPH_SLICE_VIEWS,
  GRAPH_SLICE_GRANULARITIES,
  DEFAULT_MAX_NEIGHBORS,
  type GraphSliceView,
  type GraphSliceGranularity,
  type GraphSliceResult,
} from './shared/domain.ts';
import { parseCommitLog, filterSlices, type CommitRange } from './shared/temporal.ts';
import { parseGitBlamePorcelain, groupBlameByFile, buildOwnershipMap } from './shared/ownership.ts';
import { partitionByView, serializeViewPartition } from './shared/views.ts';
import { filterEdgesByTemporalPredicate } from './shared/analysis/temporalEnumeration.ts';
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

/**
 * `graph_slice` 的执行体（cycle-135：多维视图切片）。
 *
 * 四个视图共用一条链路：先 `fetchMergedGraph` 取合并图，再交给 `graphSlice` 统一切片。
 * 时序/所有权视图的**外部事实**（commit 历史、blame）通过两个可选字符串参数注入：
 * - `commitLog`：`git log --name-only --format=%x1e%H%x1f%ct` 的原始输出；
 * - `blameLog`：`git blame --porcelain <file>` 的原始输出。
 *
 * 为什么让模型/调用方注入原始文本而不是在工具里直接跑 git：本工具是**读图**工具，
 * 与其余 `graph_*` 一样只依赖 `invoke` 上游通道；git 子进程属于宿主 `/churn`、
 * `/blame` 一类的分析路由职责（`gitChurn.ts` 已有实现）。这样切片逻辑保持纯函数、
 * 可单测，也避免在工具层再引入一条 git 依赖。缺这两个参数时，对应视图走**显式降级**
 * （`viewDataAvailable: false` + `reason`），而不是编造一份缺维度的图。
 */
export async function executeGraphSlice(
  args: {
    repoId: string;
    view: GraphSliceView;
    granularity?: GraphSliceGranularity;
    focus?: string;
    commitLog?: string;
    blameLog?: string;
  },
  invoke: UpstreamInvoker,
): Promise<GraphSliceResult> {
  const data = await fetchMergedGraph(invoke, args.repoId);
  const commitHistory = args.commitLog
    ? { slices: parseCommitLog(args.commitLog), head: null, available: true, error: null }
    : null;
  const blameByFile = args.blameLog ? groupBlameByFile(parseGitBlamePorcelain(args.blameLog)) : null;

  return sliceGraph(data, {
    view: args.view,
    granularity: args.granularity,
    focus: args.focus,
    commitHistory,
    blameByFile,
  });
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


  /**
   * 路径模式 ρ（cycle-134）：`graph_path_enumerate` 的**序列约束**版本。
   *
   * 与 `graph_path_enumerate` 的差别只在表达能力：
   * - 后者 `edgeTypes` 是扁平集合（「每步走这些之一」）；
   * - 本工具 `pattern` 是边类型**序列正则**，能表达「先 call 再 import 再 dependency」
   *   这类跨视图路径（研究方案 §4 的 `P = (v_s, ρ, v_t)`）。
   *
   * 为什么仍是独立工具而不合并进 `graph_path_enumerate`：两者的**参数语义不同**
   * （`edgeTypes` 是集合语义、`pattern` 是序列语义），合并成一个可选参数会让模型
   * 无法从参数名判断该传哪个，且两者同时给出时的优先级无自然定义。模型侧的选择表
   * 写在 `src/host/skills.ts` 的 SKILL_CONTENT 第 8 条。
   */
  const graphPathPattern = defineTool({
    name: 'graph_path_pattern',
    description:
      'Enumerate code paths matching a SEQUENCE pattern of edge types (Xuanji 璇玑图 path-pattern reader). Use this when the ORDER of relations matters — "call then import then dependency" — which graph_path_enumerate\'s flat edgeTypes cannot express. Pattern syntax: edge type names (call/import/extend/implement/dependency/contains/association/aggregation/composition), concatenation by space or ".", alternation "|", grouping "(...)", quantifiers "?" "*" "+" and "{n,m}". Examples: "call+" (transitive call closure), "call* . import" (any calls then a cross-file import), "(import|dependency)+" (any dependency closure), "call{2,4}" (2-4 hop call chains).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      pattern: {
        type: 'string',
        required: true,
        description: 'Edge-type sequence pattern (ρ). e.g. "call+ . import? . dependency".',
      },
      startNode: { type: 'string', description: 'Restrict the START to this node id (narrows the search, does not filter results).' },
      endNode: { type: 'string', description: 'Require the last node to be this node id.' },
      minHops: { type: 'number', description: 'Minimum edges; intersected with the pattern\'s own lower bound. Default: 0.' },
      maxHops: { type: 'number', description: 'Maximum edges; intersected with the pattern\'s own upper bound. Default: 8, capped at 12.' },
      limit: { type: 'number', description: 'Maximum paths returned. Default: 20, capped at 50.' },
      cursor: {
        type: 'number',
        description: 'Pagination cursor: number of paths already returned. Use the previous call\'s nextCursor.',
      },
      pageSize: { type: 'number', description: 'Paths per page. Defaults to limit, capped at 50.' },
      truncation: {
        type: 'string',
        description: "'dfs-order' (default) stops at the cap in deterministic DFS order; 'top-k-weight' enumerates ALL candidates first and keeps the highest total edge weight — slower on large graphs.",
      },
      /**
       * ρ 的 commit 切片（cycle-137 / 研究方案 §4 的 $\\mathcal{T}$ 维）。
       *
       * 语义：「在给定 commit 切片 `t` 下枚举」——先按区间切片，再在切片上跑 ρ。
       * 三者互斥地组合：`days` 取时间窗、`from`/`to` 取 hash 区间。
       *
       * 为什么用 raw git 输出而不是让宿主自己跑 git：ρ 是**模型工具**，模型手里
       * 通常已经有 `git log` 的输出（或能跑）；把解析放在库侧（`parseCommitLog`）
       * 让「切片」成为可单测的纯函数，而不是藏在宿主子进程里。
       *
       * 与 `graph_slice` 的 `commitLog` **同一份解析器**（`src/shared/temporal.ts`
       * 的 `parseCommitLog`），不是两份。
       */
      commitLog: {
        type: 'string',
        description: 'Raw `git log --name-only --format=%x1e%H%x1f%ct` output. When provided, ρ is enumerated on the commit-sliced graph (研究方案 §4 的 T 维).',
      },
      days: {
        type: 'number',
        description: 'Temporal slice: only commits within the last N days. Combined with commitLog.',
      },
      from: {
        type: 'string',
        description: 'Temporal slice: keep commits from this hash onward (inclusive). Combined with commitLog.',
      },
      to: {
        type: 'string',
        description: 'Temporal slice: keep commits up to this hash (inclusive). Combined with commitLog.',
      },
      /**
       * 边级时序谓词（cycle-138 / 研究方案 §4 的边级时序事实）。
       *
       * 与 `days`/`from`/`to`（**图级** commit 切片：决定哪些文件存在）正交：
       * `since` 是**边级**过滤（决定哪些关系够新）——只保留「首次有提交同时触及
       * 两端文件」的时刻 ≥ since 的边。该时刻是边引入时间的**下界**（引入提交必然
       * 同时触及两端文件），因此保留的边保证真正新；无事实的边一律不返回
       * （不知道 ≠ 符合）。
       */
      since: {
        type: 'number',
        description: 'Edge-level temporal predicate (unix ms): keep only edges whose first co-touched commit time (lower bound of the introduction time) is >= since. Requires commitLog. Edges without a temporal fact are excluded.',
      },
      /**
       * 挥发度谓词（研究方案 §4 的 vol(u,v)）。**当前被显式拒绝**：挥发度需要
       * 边级事实（每个 commit 切片里这条边是否真的存在），raw `--name-only`
       * 只有文件级事实 ⇒ 请求即返回 `paths: []` + `edgeTemporal.available: false`
       * + reason。参数仍声明的原因：把「这个维度现在拿不到」变成**可达且可测**
       * 的诚实降级，而不是让模型静默忽略一个无效参数（拼错 ≠ 缺失纪律）。
       * 边级采集渠道到位后此参数直接生效，工具面零改动。
       */
      minVolatility: {
        type: 'number',
        description: 'Minimum edge volatility (0-1). Currently EXPLICITLY REJECTED: volatility requires per-commit edge-existence facts that the --name-only log does not carry; the response reports edgeTemporal.available=false with a reason instead of pretending.',
      },
      maxVolatility: {
        type: 'number',
        description: 'Maximum edge volatility (0-1). Same explicit-rejection contract as minVolatility.',
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
          pattern?: string;
          patternEdgeTypes?: readonly string[];
          stateCount?: number;
          unknownEdgeTypes?: readonly string[];
          error?: string;
          diagnostic?: string;
        } | null;
        // ρ 语法错误必须与「零条路径」在返回面上可区分：把编译错误渲染成
        // 带 ^ 指示的诊断，而不是伪装成「这个模式在该仓库没有匹配」。
        if (v?.error) {
          return [{ type: 'text' as const, text: `${v.error}${v.diagnostic ? `\n${v.diagnostic}` : ''}` }];
        }
        if (!v || !v.paths) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.PATH_PATTERN_FAILED?.en ?? 'Path pattern evaluation failed' }];
        }
        const head = `pattern "${v.pattern ?? ''}" (types: ${(v.patternEdgeTypes ?? []).join('|') || 'none'}, ${v.stateCount ?? 0} NFA states)`;
        // cycle-135：空结果要区分「拼错类型名」与「图上确实没有这种边」。
        // 两者在返回面上同形（`paths: []`），不区分会让模型把「我写错了」误读成
        // 「这个仓库没有 call 边」而放弃。
        const unknown = v.unknownEdgeTypes ?? [];
        if (unknown.length > 0) {
          return [{ type: 'text' as const, text: `${head}\nUnknown edge type(s): ${unknown.join(', ')}. Valid types: call/import/extend/implement/dependency/contains/association/aggregation/composition.` }];
        }
        if (v.paths.length === 0) {
          return [{ type: 'text' as const, text: `${head}\n${TOOL_MESSAGES.NO_PATH_FOUND?.en ?? 'No path found'}` }];
        }
        const lines = v.paths.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.join(' → ')} (${p.length - 1} hops)`);
        const suffix = v.truncated ? ' (truncated)' : '';
        const next = v.nextCursor === null || v.nextCursor === undefined ? '' : ` (nextCursor=${String(v.nextCursor)})`;
        return [{ type: 'text' as const, text: `${head}\n${v.total ?? v.paths.length} path(s)${suffix}${next}\n${lines.join('\n')}` }];
      },
    },
    presentCall: (args) => {
      const a = args as { pattern: string; startNode?: string; endNode?: string };
      return {
        card: 'generic' as const,
        title: 'Enumerate paths by pattern',
        kind: 'search' as const,
        rawInput: { pattern: a.pattern, ...(a.startNode === undefined ? {} : { from: a.startNode }), ...(a.endNode === undefined ? {} : { to: a.endNode }) },
      };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Path pattern failed' : 'Pattern paths',
    }),
    execute: async (args) => {
      const a = args as {
        repoId: string;
        pattern: string;
        startNode?: string;
        endNode?: string;
        minHops?: number;
        maxHops?: number;
        limit?: number;
        cursor?: number;
        pageSize?: number;
        truncation?: string;
        commitLog?: string;
        days?: number;
        from?: string;
        to?: string;
        since?: number;
        minVolatility?: number;
        maxVolatility?: number;
      };
      const merged = await fetchMergedGraph(invoke, a.repoId);
      if (merged.nodes.length === 0) return null;

      // cycle-137：ρ 的 commit 切片（研究方案 §4 的 𝒯 维）。
      // 未提供 commitLog ⇒ temporal === null，行为与既有调用逐字节一致。
      const sliced = sliceGraphForTemporal(merged, {
        ...(a.commitLog !== undefined ? { commitLog: a.commitLog } : {}),
        ...(a.days !== undefined ? { days: a.days } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
      });

      // 时序请求但切片不可用 ⇒ 诚实降级，不拿原图冒充切片（研究方案 §4：没有 𝒯
      // 就没有时序切片，把它渲染成「整个仓库」比渲染成「空图」更远离事实）。
      if (sliced.temporal?.requested && !sliced.temporal.available) {
        return toJsonValue({
          pattern: a.pattern,
          paths: [] as string[][],
          truncated: false,
          total: 0,
          temporal: sliced.temporal,
          reason: sliced.temporal.reason ?? 'commit 切片不可用',
        });
      }

      // 边级时序谓词（cycle-138）：在图级切片**之后**对切片数据做边级过滤。
      // 请求了但不可用（含挥发度被显式拒绝）⇒ 与图级降级同一形态的诚实空结果。
      let data = sliced.data;
      const edgeFilter = filterEdgesByTemporalPredicate(data, {
        ...(a.commitLog !== undefined ? { commitLog: a.commitLog } : {}),
        ...(a.since !== undefined ? { since: a.since } : {}),
        ...(a.minVolatility !== undefined ? { minVolatility: a.minVolatility } : {}),
        ...(a.maxVolatility !== undefined ? { maxVolatility: a.maxVolatility } : {}),
      });
      let temporal = sliced.temporal;
      let edgeTemporal: ReturnType<typeof filterEdgesByTemporalPredicate>['meta'] = null;
      if (edgeFilter.meta) {
        if (!edgeFilter.meta.available) {
          return toJsonValue({
            pattern: a.pattern,
            paths: [] as string[][],
            truncated: false,
            total: 0,
            temporal,
            edgeTemporal: edgeFilter.meta,
            reason: edgeFilter.meta.reason ?? '边级时序谓词不可用',
          });
        }
        data = edgeFilter.data;
        edgeTemporal = edgeFilter.meta;
      }

      // 切片图是原图的子集；把它 sync 进主池会让下一次不带 commitLog 的 ρ 调用静默少查。
      // 因此时序路径用**独立**的时序池（temporalXuanjiPool，见 temporalEnumeration.ts）。
      // 边级过滤产生了（可能更小的）子集 ⇒ 同样走时序池，绝不污染主池。
      const adapter = temporal || edgeTemporal ? temporalXuanjiPool.get(a.repoId) : xuanjiPool.get(a.repoId);
      adapter.syncGraph(data);

      const limit = clampInt(a.limit, 1, 50, 20);
      try {
        const result = adapter.pathsByPattern(a.pattern, {
          ...(a.startNode === undefined ? {} : { startNode: a.startNode }),
          ...(a.endNode === undefined ? {} : { endNode: a.endNode }),
          minHops: clampInt(a.minHops, 0, 12, 0),
          maxHops: clampInt(a.maxHops, 0, 12, 8),
          limit,
          ...(a.cursor === undefined ? {} : { cursor: clampInt(a.cursor, 0, Number.MAX_SAFE_INTEGER, 0) }),
          ...(a.pageSize === undefined ? {} : { pageSize: clampInt(a.pageSize, 1, 50, limit) }),
          ...(a.truncation === 'top-k-weight' || a.truncation === 'dfs-order'
            ? { truncation: a.truncation }
            : {}),
        });
        return toJsonValue({ ...result, temporal: temporal ?? null, ...(edgeTemporal ? { edgeTemporal } : {}) });
      } catch (e) {
        // 只有 ρ 语法错误走这里（其余异常照常上抛，保持响亮失败）。
        const diagnostic = formatPatternError(a.pattern, e);
        if (!(e instanceof PathPatternError)) throw e;
        return toJsonValue({
          pattern: a.pattern,
          paths: [] as string[][],
          truncated: false,
          total: 0,
          temporal: temporal ?? null,
          ...(edgeTemporal ? { edgeTemporal } : {}),
          error: `Invalid path pattern: ${e instanceof Error ? e.message : String(e)}`,
          diagnostic,
        });
      }
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

  // cycle-132 / D-06 + D-10 剩余半边：璇玑图白盒可观测工具。语义契约见
  // GraphIntegrityReport 头注三条设计决定（只读水位优先 / 不跑覆盖型不变量 /
  // 休眠态显式披露）。未装载时返回诚实空态而不是编造零值健康。
  const graphIntegrity = defineTool({
    name: 'graph_integrity',
    description: 'White-box integrity report of the Xuanji graph layer: change-log watermark (pending/dropped, with optional explicit drain), per-rule index health counters, and whether the incremental pipeline is dormant (loaded but zero registered rules).',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      drainChanges: {
        type: 'boolean',
        description: "Explicitly drain the change log in this call (events are consumed, not just counted). Default: false — read-only watermark, because a report that silently empties the log trades a memory issue for a data-loss issue.",
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as
          | { loaded?: boolean; graph?: { nodes: number; edges: number; version: number }; changeLog?: { pending: number; dropped: number; drained: number | null }; rules?: ReadonlyArray<{ name: string; counters: { total: number; stale: number } }>; incrementalIdle?: boolean }
          | null;
        if (!v || v.loaded !== true) {
          return [{ type: 'text' as const, text: TOOL_MESSAGES.INSUFFICIENT_DATA?.en ?? 'Graph layer not loaded for this repo yet' }];
        }
        const g = v.graph ?? { nodes: 0, edges: 0, version: 0 };
        const c = v.changeLog ?? { pending: 0, dropped: 0, drained: null };
        const drainNote = c.drained === null ? '' : ` drained=${String(c.drained)}`;
        const ruleLines = (v.rules ?? []).map((r) => `    ${r.name}: total=${String(r.counters.total)} stale=${String(r.counters.stale)}`);
        const lines = [
          `Graph integrity: nodes=${String(g.nodes)} edges=${String(g.edges)} version=${String(g.version)}`,
          `  changeLog: pending=${String(c.pending)} dropped=${String(c.dropped)}${drainNote}`,
          ...(v.incrementalIdle ? ['  incremental pipeline: dormant (loaded, zero registered rules — enumerations use one-shot inline indexes)'] : []),
          ...(ruleLines.length > 0 ? ['  rules:'] : []),
          ...ruleLines,
        ];
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    presentCall: (args) => {
      const a = args as { repoId: string };
      return { card: 'generic' as const, title: 'Check graph integrity', kind: 'other' as const, rawInput: { repoId: a.repoId } };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Integrity check failed' : 'Graph integrity',
    }),
    execute: async (args) => {
      const a = args as { repoId: string; drainChanges?: boolean };
      // 与其余读法工具同链路：先同步到该仓库的最新图状态（syncGraph 内部按结构等价
      // 判定 'none'/'delta'/'full'），再报白盒水位——否则报告的是陈旧图上的健康度。
      // 同步失败（上游不可达）不抛错：integrity 报告的是适配层当前状态，loaded 字段
      // 会如实反映「从未装载」。
      try {
        const data = await fetchMergedGraph(invoke, a.repoId);
        xuanjiPool.get(a.repoId).syncGraph(data);
      } catch (err) {
        log.warn('graph_integrity: graph sync failed, reporting last known state', { repoId: a.repoId, error: err });
      }
      const adapter = xuanjiPool.get(a.repoId);
      return toJsonValue(adapter.integrity(a.drainChanges === true ? { drainChanges: true } : {}));
    },
  });

  // cycle-135：多维视图切片（研究方案 §4 的 $\mathcal{T}$ 与 $\Pi$ 维 + §7.1 的统一接口）。
  // 四个视图（structural / temporal / ownership / domain）共用一条链路，差别只在
  // 「标注什么」与「外部事实从哪来」。详见 `src/shared/domain.ts` 的 `graphSlice`。
  const graphSlice = defineTool({
    name: 'graph_slice',
    description:
      'Slice the code graph by view and granularity: structural (AST symbols), temporal (commit slices + edge volatility), ownership (git blame authors + bus factor) or domain (Louvain communities → domain labels). Use when you need a bounded subgraph along one orthogonal dimension instead of the whole hairball. `focus` takes a node id/label (1-hop neighborhood) or a file path (whole file). Temporal/ownership views accept raw git output via `commitLog` (git log --name-only --format=%x1e%H%x1f%ct) and `blameLog` (git blame --porcelain); without them the view degrades explicitly (viewDataAvailable: false + reason) rather than returning a graph missing that dimension.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      view: {
        type: 'string',
        enum: [...GRAPH_SLICE_VIEWS],
        required: true,
        description: 'Which orthogonal dimension to slice and label.',
      },
      granularity: {
        type: 'string',
        enum: [...GRAPH_SLICE_GRANULARITIES],
        description: 'Aggregation level: repo (as-is), file (collapse to file nodes), symbol (default).',
      },
      focus: {
        type: 'string',
        description: 'Node id/label (1-hop neighborhood) or file path (whole file). Omit to slice the whole graph.',
      },
      commitLog: {
        type: 'string',
        description: 'Raw `git log --name-only --format=%x1e%H%x1f%ct` output (temporal view).',
      },
      blameLog: {
        type: 'string',
        description: 'Raw `git blame --porcelain` output (ownership view).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as GraphSliceResult | null;
        if (!v || !v.available) {
          return [{ type: 'text' as const, text: `Slice unavailable: ${v?.reason ?? 'unknown reason'}` }];
        }
        const labelSamples = Object.entries(v.labels).slice(0, 10).map(([id, label]) => `  ${id} → ${label}`);
        const lines = [
          `${v.view} @ ${v.granularity}: ${v.nodes.length} nodes, ${v.edges.length} edges`,
          ...(labelSamples.length > 0 ? [`labels:\n${labelSamples.join('\n')}`] : []),
          ...(v.reason ? [`note: ${v.reason}`] : []),
        ];
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    presentCall: (args) => {
      const a = args as { repoId: string; view: string; granularity?: string; focus?: string };
      return {
        card: 'generic' as const,
        title: 'Slice graph view',
        kind: 'other' as const,
        rawInput: { repoId: a.repoId, view: a.view, granularity: a.granularity ?? 'symbol' },
      };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'Graph slice failed' : 'Graph slice',
    }),
    execute: async (args) => {
      const slice = await executeGraphSlice(args as {
        repoId: string;
        view: GraphSliceView;
        granularity?: GraphSliceGranularity;
        focus?: string;
        commitLog?: string;
        blameLog?: string;
      }, invoke);
      return toJsonValue(slice);
    },
  });

  // cycle-138：Π 视图划分函数（研究方案 §4 的 Π 维）。
  //
  // 与 `graph_slice` 的区别：`graph_slice` 回答「按某个视图切出子图」，本工具回答
  // 「每个节点/边属于**哪些**视图」。后者是 §4 的 Π: V ∪ E → 2^{V_view} 的正式实现，
  // 前者只是它的一个投影。
  //
  // 四个视图的事实来源（缺哪个就缺哪个视图，绝不静默补全）：
  // - structural：恒属所有节点/边（基图）；
  // - temporal：`commitLog` 里被触及的文件；
  // - ownership：`blameLog` 里有记录的节点；
  // - domain：Louvain 社区检测分配到的节点。
  const graphViews = defineTool({
    name: 'graph_views',
    description:
      'Report the view partition Π (研究方案 §4): which orthogonal views each node and edge belongs to. The four views are structural (base graph, always), temporal (files touched by a commit slice), ownership (nodes with a git blame record) and domain (Louvain community assignment). Use this when you need to know "which views does this symbol belong to" rather than "give me the subgraph of one view" (that is graph_slice). Temporal/ownership views degrade explicitly when their raw git input (commitLog / blameLog) is absent.',
    parameters: {
      repoId: { type: 'string', required: true, description: 'Repository id.' },
      focus: {
        type: 'string',
        description: 'Node id/label (1-hop neighborhood) or file path (whole file). Omit to partition the whole graph.',
      },
      commitLog: {
        type: 'string',
        description: 'Raw `git log --name-only --format=%x1e%H%x1f%ct` output (temporal view).',
      },
      blameLog: {
        type: 'string',
        description: 'Raw `git blame --porcelain` output (ownership view).',
      },
      days: { type: 'number', description: 'Temporal slice: only commits within the last N days.' },
      from: { type: 'string', description: 'Temporal slice: keep commits from this hash onward (inclusive).' },
      to: { type: 'string', description: 'Temporal slice: keep commits up to this hash (inclusive).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as {
          nodes?: Array<{ id: string; views: string[] }>;
          edges?: Array<{ id: string; views: string[] }>;
          viewCounts?: Record<string, number>;
          edgeViewCounts?: Record<string, number>;
          domain?: { domainCount: number; domainNames: string[] };
        } | null;
        if (!v) return [{ type: 'text' as const, text: 'View partition unavailable' }];
        const lines = [
          `Π view partition: ${v.nodes?.length ?? 0} nodes, ${v.edges?.length ?? 0} edges`,
          `view counts: ${Object.entries(v.viewCounts ?? {}).map(([k, n]) => `${k}=${n}`).join(', ')}`,
        ];
        if (v.domain) lines.push(`domain: ${v.domain.domainCount} communities (${v.domain.domainNames.join(', ') || 'none'})`);
        const samples = (v.nodes ?? []).slice(0, 8).map((n) => `  ${n.id} → [${n.views.join(', ')}]`);
        if (samples.length > 0) lines.push(`samples:\n${samples.join('\n')}`);
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    presentCall: (args) => {
      const a = args as { repoId: string; focus?: string; commitLog?: string; blameLog?: string };
      return {
        card: 'generic' as const,
        title: 'Report view partition Π',
        kind: 'other' as const,
        rawInput: { repoId: a.repoId, ...(a.focus === undefined ? {} : { focus: a.focus }) },
      };
    },
    presentResult: (_args, result) => ({
      card: 'generic' as const,
      title: result.isError ? 'View partition failed' : 'View partition Π',
    }),
    execute: async (args) => {
      const a = args as {
        repoId: string;
        focus?: string;
        commitLog?: string;
        blameLog?: string;
        days?: number;
        from?: string;
        to?: string;
      };
      const data = await fetchMergedGraph(invoke, a.repoId);
      if (data.nodes.length === 0) return null;

      // focus 邻域（与 graph_slice 同一函数、同一口径）
      const base = a.focus
        ? focusNeighborhood(data.nodes, data.edges, a.focus, DEFAULT_MAX_NEIGHBORS)
        : { nodes: data.nodes, edges: data.edges };

      // 时序事实：被 commit 切片触及的文件（归一化路径）
      let temporalFiles: Set<string> | undefined;
      if (a.commitLog && a.commitLog.trim() !== '') {
        const history = { slices: parseCommitLog(a.commitLog), head: null, available: true };
        const range: CommitRange = {
          ...(a.days !== undefined ? { days: a.days } : {}),
          ...(a.from ? { from: a.from } : {}),
          ...(a.to ? { to: a.to } : {}),
        };
        const { slices } = filterSlices(history, range);
        temporalFiles = new Set<string>();
        for (const slice of slices) for (const file of slice.files) temporalFiles.add(file);
      }

      // 所有权事实：有 blame 记录的节点
      let attributedNodeIds: ReadonlySet<string> | undefined;
      if (a.blameLog && a.blameLog.trim() !== '') {
        const ownership = buildOwnershipMap(base.nodes, groupBlameByFile(parseGitBlamePorcelain(a.blameLog)));
        attributedNodeIds = new Set(Object.keys(ownership.nodeLabels));
      }

      // 领域事实：Louvain 社区
      const domain = await computeDomainLabels(base.nodes, base.edges);
      const domainByNodeId = new Map<string, string>();
      for (const [id, label] of Object.entries(domain.labels)) {
        if (label) domainByNodeId.set(id, label);
      }

      const partition = partitionByView({
        data: base,
        temporalFiles,
        attributedNodeIds,
        domainByNodeId,
      });

      return toJsonValue({
        ...serializeViewPartition(partition),
        domain: { domainCount: domain.domainCount, domainNames: domain.domainNames },
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
    graphPathPattern,
    graphCycles,
    graphHealth,
    graphRulesCheck,
    graphFocus,
    graphQuery,
    graphIntegrity,
    graphSlice,
    graphViews,
    dispose: () => {
      xuanjiPool.dispose();
      graphCache.clear();
    },
  };
};


