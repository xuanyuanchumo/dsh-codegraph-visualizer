import { scoped } from '../../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge } from '../../types/index.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { coerceGraphData } from '../../shared/GraphValidator.ts';
import { isForeignRepo } from '../../shared/graphScope.ts';
import { API, BOOTSTRAP } from '../../shared/constants.ts';

const log = scoped('client');

const DEFAULT_TIMEOUT = API.DEFAULT_TIMEOUT_MS;

async function withAbortGuard<T>(
  name: string,
  run: () => Promise<T>,
  fallback: T,
  logContext?: Record<string, unknown>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return fallback;
    log.warn(`${name} failed`, { ...logContext, error: e instanceof Error ? e.message : String(e) });
    return fallback;
  }
}

export function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options?.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  });
}

export interface BootstrapData {
  rootNodes: GraphNode[];
  topLevelNodes: GraphNode[];
  topLevelTotal: number;
  edges: GraphEdge[];
  indexStatus: 'ready' | 'building' | 'empty';
  metadata: {
    repoId: string;
    timestamp: number;
    totalNodeCount: number;
    totalEdgeCount: number;
  };
}

export async function fetchBootstrap(signal?: AbortSignal, workspace?: string): Promise<BootstrapData | null> {
  return withAbortGuard('fetchBootstrap', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/bootstrap${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const data = await res.json() as BootstrapData;
    return {
      rootNodes: data.rootNodes ?? [],
      topLevelNodes: data.topLevelNodes ?? [],
      topLevelTotal: data.topLevelTotal ?? 0,
      edges: data.edges ?? [],
      indexStatus: data.indexStatus ?? 'empty',
      metadata: data.metadata ?? { repoId: '', timestamp: 0, totalNodeCount: 0, totalEdgeCount: 0 },
    };
  }, null);
}

export interface NodeChildrenData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cursor: string | null;
  total: number;
}

export async function fetchNodeChildren(nodeId: string, cursor?: string, limit?: number, signal?: AbortSignal, workspace?: string): Promise<NodeChildrenData | null> {
  return withAbortGuard('fetchNodeChildren', async () => {
    const params = new URLSearchParams();
    params.set('nodeId', nodeId);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit ?? BOOTSTRAP.CHILDREN_PAGE_SIZE));
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/children?${params}`, options);
    if (!res.ok) return null;
    return await res.json() as NodeChildrenData;
  }, null, { nodeId });
}

export async function fetchStatus(): Promise<{ codegraph: boolean; lens: boolean; builtin: boolean }> {
  return withAbortGuard('fetchStatus', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/status');
    if (!res.ok) return { codegraph: false, lens: false, builtin: true };
    const data = await res.json();
    return { codegraph: !!data.codegraph, lens: !!data.lens, builtin: data.builtin ?? true };
  }, { codegraph: false, lens: false, builtin: true }, { url: '/api/v1/codegraph/status' });
}

export interface WorkspaceInfo {
  path: string;
  list: string[];
  /** Diagnostics (docs/需求分析.md §31.7): which host source produced the allowed roots. */
  rootSource?: string;
  allowedRoots?: string[];
  resolvedFrom?: string[];
}

export async function fetchWorkspace(): Promise<WorkspaceInfo> {
  return withAbortGuard('fetchWorkspace', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/workspace');
    if (!res.ok) return { path: '.', list: [] };
    const data = await res.json() as Partial<WorkspaceInfo>;
    const info: WorkspaceInfo = { path: data.path ?? '.', list: data.list ?? [] };
    // Diagnostics are optional: an older host does not send them.
    if (data.rootSource !== undefined) info.rootSource = data.rootSource;
    if (data.allowedRoots !== undefined) info.allowedRoots = data.allowedRoots;
    if (data.resolvedFrom !== undefined) info.resolvedFrom = data.resolvedFrom;
    return info;
  }, { path: '.', list: [] });
}

export async function requestScan(path: string, maxNodes?: number): Promise<{ success: boolean; nodes: unknown[]; edges: unknown[]; metadata?: Record<string, unknown> } | null> {
  return withAbortGuard('requestScan', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, maxNodes }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  }, null);
}

export async function requestInit(path: string): Promise<{ success: boolean; message: string } | null> {
  return withAbortGuard('requestInit', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  }, null);
}

/**
 * `fetchGraphDataIncremental` 的返回：图负载 + 服务端在这次 200 响应里给出的校验值。
 *
 * 校验值必须**原样**回传（`if-none-match`），不能由客户端自己按时间戳拼：host 的校验值是
 * `W/"<revision>-<hash64(资源 + 工作区)>"`（见 `computeGraphEtag`），含身份与资源维度，
 * 客户端无从推导。
 */
export interface IncrementalGraphResult {
  data: GraphData;
  etag: string | null;
}

/**
 * 读取 host 单槽里的图（`/api/v1/codegraph/data`，增量语义：带 `if-none-match` 走 304 短路）。
 *
 * P0 跨工作区污染防护的**唯一收口点**：该端点既不接受 `workspace` 参数、也不做任何过滤，返回的
 * 永远是 host `lastGraphData` 那一个槽里的内容。因此响应必须在这里就与调用方的作用域身份比对，
 * 外来工作区的负载直接丢弃，绝不交给调用方去 `setGraphData`。
 *
 * `scopeRepoId` 是**必填**参数而非可选：任何新增调用点都会被类型检查强制回答"我期望哪个工作区"，
 * 而不是默默继承一个不设防的默认值。这正是 Round 15 遗留 SSE `graph-updated` 漏网的成因——
 * 当时守卫只写在调用点，新增通道时被漏掉。
 *
 * `clientEtag` 同样必填，但**允许为 `null`**（首次取数、或刚切过工作区）。这里刻意不再复用
 * `store.lastUpdated`：那个字段是 `Date.now()`（客户端时钟）与 `metadata.timestamp`（服务端时钟）
 * 混写的展示字段，拿它当校验器会让 304 要么永不命中（每次都全量重取），要么**假命中并静默吞掉
 * 一次真实更新**。校验值域与展示时钟域必须分开。
 */
export async function fetchGraphDataIncremental(
  clientEtag: string | null | undefined,
  scopeRepoId: string | null | undefined,
): Promise<IncrementalGraphResult | null> {
  return withAbortGuard('fetchGraphDataIncremental', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/data', {
      headers: clientEtag ? { 'if-none-match': clientEtag } : {},
    });
    if (res.status === 304) return null;
    if (!res.ok) return null;
    const data = coerceGraphData(await res.json());
    if (!data) return null;
    // host 只保留一个槽：槽里可能装着别的工作区的图，按作用域身份丢弃。
    if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {
      log.info('incremental graph fetch ignored for another workspace', {
        repoId: data.metadata.repoId,
        activeRepoId: scopeRepoId,
      });
      return null;
    }
    // 校验值与负载一起返回，调用方必须**同一次** `_set` 落库：两者分开写会出现
    // "画布已是新版、校验值还是旧版"的窗口，下一次请求就会假 304。
    return { data, etag: res.headers?.get('etag') ?? null };
  }, null, { url: '/api/v1/codegraph/data' });
}

export async function requestWatch(enabled: boolean, path: string): Promise<boolean> {
  return withAbortGuard('requestWatch', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, path }),
    });
    return res.ok;
  }, false);
}
export interface FileOutlineData {
  symbols: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchFileOutline(nodeId: string, signal?: AbortSignal, workspace?: string): Promise<FileOutlineData | null> {
  return withAbortGuard('fetchFileOutline', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/files/${encodeURIComponent(nodeId)}/outline${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const data = await res.json() as FileOutlineData;
    return {
      symbols: data.symbols ?? [],
      edges: data.edges ?? [],
    };
  }, null, { nodeId });
}

export interface SymbolASTData {
  astNodes: GraphNode[];
  astEdges: GraphEdge[];
  sourceLines: string[];
  /** Total AST node count the server holds for this symbol, before the page cut. */
  total: number;
  /** Offset to send as `cursor` to fetch the next page. */
  cursor: number;
  /**
   * `true` when the server cut the AST at the single-symbol budget
   * (`SYMBOL_AST.MAX_NODES`) and more nodes remain. The caller must disclose
   * this and offer segmented loading, otherwise the folded part is lost
   * silently — see `docs/图谱按需加载.md` 「超限时显示…分段加载」.
   */
  hasMore: boolean;
}

export async function fetchSymbolAST(nodeId: string, signal?: AbortSignal, workspace?: string, cursor?: number): Promise<SymbolASTData | null> {
  return withAbortGuard('fetchSymbolAST', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    if (cursor !== undefined && cursor > 0) params.set('cursor', String(cursor));
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/symbols/${encodeURIComponent(nodeId)}/ast${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const data = await res.json() as SymbolASTData;
    const astNodes = data.astNodes ?? [];
    return {
      astNodes,
      astEdges: data.astEdges ?? [],
      sourceLines: data.sourceLines ?? [],
      total: typeof data.total === 'number' ? data.total : astNodes.length,
      cursor: typeof data.cursor === 'number' ? data.cursor : astNodes.length,
      hasMore: data.hasMore === true,
    };
  }, null, { nodeId });
}

/**
 * POST /api/v1/codegraph/ast, carrying the caller's selected workspace.
 *
 * The route resolves `filePath` against a workspace, and used to always pick whichever workspace the
 * host listed first (`findWorkspacePath`). Sending `?workspace=` makes the request address the
 * workspace the user is actually looking at, the same way `fetchBootstrap` / `fetchFileOutline` /
 * `fetchSymbolAST` / `fetchEdges` already do.
 */
export async function fetchAst(filePath: string, signal?: AbortSignal, workspace?: string): Promise<ASTNode | null> {
  return withAbortGuard('fetchAst', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const qs = params.toString();
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    };
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/ast${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    return await res.json() as ASTNode;
  }, null, { filePath });
}

export interface EdgesData {
  edges: GraphEdge[];
  total: number;
  cursor: number;
  hasMore: boolean;
  /**
   * Present and `true` when the server collapsed a dense neighbourhood into
   * one synthetic edge per file pair (`/edges` returns this instead of paging
   * when the unaggregated edge count exceeds `EDGES_AGGREGATION.THRESHOLD`).
   */
  aggregated?: boolean;
}

/**
 * 拉取某节点的邻接边。
 *
 * `detail` 为 `true` 时请求**未聚合**的原始边（服务端收到 `detail=1` 会跳过文件对聚合）。
 * 用于详情面板的「展开明细」：默认请求会被服务端折叠成每文件对一条合成边，
 * 用户要看真实连接就必须显式声明。
 */
export async function fetchEdges(fromId: string, scope: 'file' | 'symbol' = 'file', cursor?: number, limit?: number, signal?: AbortSignal, workspace?: string, detail?: boolean): Promise<EdgesData | null> {
  return withAbortGuard('fetchEdges', async () => {
    const params = new URLSearchParams();
    params.set('from', fromId);
    params.set('scope', scope);
    if (cursor !== undefined) params.set('cursor', String(cursor));
    params.set('limit', String(limit ?? 500));
    // 只在需要明细时才发参数：默认（聚合）请求保持原有 URL 形状不变。
    if (detail === true) params.set('detail', '1');
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/edges?${params}`, options);
    if (!res.ok) return null;
    return await res.json() as EdgesData;
  }, null, { fromId, scope });
}