import { scoped } from '../../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge } from '../../types/index.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { coerceGraphData } from '../../shared/GraphValidator.ts';
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

export async function fetchGraphData(): Promise<GraphData | null> {
  return withAbortGuard('fetchGraphData', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/data');
    if (!res.ok) return null;
    return coerceGraphData(await res.json());
  }, null, { url: '/api/v1/codegraph/data' });
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

export async function fetchGraphDataIncremental(lastUpdated: number): Promise<GraphData | null> {
  return withAbortGuard('fetchGraphDataIncremental', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/data', {
      headers: { 'if-none-match': String(lastUpdated) },
    });
    if (res.status === 304) return null;
    if (!res.ok) return null;
    return coerceGraphData(await res.json());
  }, null);
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
}

export async function fetchSymbolAST(nodeId: string, signal?: AbortSignal, workspace?: string): Promise<SymbolASTData | null> {
  return withAbortGuard('fetchSymbolAST', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/symbols/${encodeURIComponent(nodeId)}/ast${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const data = await res.json() as SymbolASTData;
    return {
      astNodes: data.astNodes ?? [],
      astEdges: data.astEdges ?? [],
      sourceLines: data.sourceLines ?? [],
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

export async function fetchEdges(fromId: string, scope: 'file' | 'symbol' = 'file', cursor?: number, limit?: number, signal?: AbortSignal, workspace?: string): Promise<EdgesData | null> {
  return withAbortGuard('fetchEdges', async () => {
    const params = new URLSearchParams();
    params.set('from', fromId);
    params.set('scope', scope);
    if (cursor !== undefined) params.set('cursor', String(cursor));
    params.set('limit', String(limit ?? 500));
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/edges?${params}`, options);
    if (!res.ok) return null;
    return await res.json() as EdgesData;
  }, null, { fromId, scope });
}