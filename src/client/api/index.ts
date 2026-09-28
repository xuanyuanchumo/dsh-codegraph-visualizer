import { scoped } from '../../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge } from '../../types/index.ts';
import { validateGraphData } from '../validators.ts';
import { API, BOOTSTRAP } from '../../shared/constants.ts';

const log = scoped('client');

const DEFAULT_TIMEOUT = API.DEFAULT_TIMEOUT_MS;

export function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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

export async function fetchBootstrap(): Promise<BootstrapData | null> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/bootstrap');
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
  } catch (e) {
    log.warn('fetchBootstrap failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export interface NodeChildrenData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cursor: string | null;
  total: number;
}

export async function fetchNodeChildren(nodeId: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<NodeChildrenData | null> {
  try {
    const params = new URLSearchParams();
    params.set('nodeId', nodeId);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit ?? BOOTSTRAP.CHILDREN_PAGE_SIZE));
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/children?${params}`, options);
    if (!res.ok) return null;
    return await res.json() as NodeChildrenData;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    log.warn('fetchNodeChildren failed', { nodeId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function fetchStatus(): Promise<{ codegraph: boolean; lens: boolean }> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/status');
    if (!res.ok) return { codegraph: false, lens: false };
    return await res.json();
  } catch (e) {
    log.warn('fetchStatus failed', { url: '/api/v1/codegraph/status', error: e instanceof Error ? e.message : String(e) });
    return { codegraph: false, lens: false };
  }
}

export async function fetchGraphData(): Promise<GraphData | null> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/data');
    if (!res.ok) return null;
    return validateGraphData(await res.json());
  } catch (e) {
    log.warn('fetchGraphData failed', { url: '/api/v1/codegraph/data', error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function fetchWorkspace(): Promise<{ path: string; list: string[] }> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/workspace');
    if (!res.ok) return { path: '.', list: [] };
    const data = await res.json() as { path?: string; list?: string[] };
    return { path: data.path ?? '.', list: data.list ?? [] };
  } catch (e) {
    log.warn('fetchWorkspace failed', e);
    return { path: '.', list: [] };
  }
}

export async function requestScan(path: string, maxNodes?: number): Promise<{ success: boolean; nodes: unknown[]; edges: unknown[]; metadata?: Record<string, unknown> } | null> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, maxNodes }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestScan failed', e);
    return null;
  }
}

export async function requestInit(path: string): Promise<{ success: boolean; message: string } | null> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestInit failed', e);
    return null;
  }
}

export async function fetchGraphDataIncremental(lastUpdated: number): Promise<GraphData | null> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/data', {
      headers: { 'if-none-match': String(lastUpdated) },
    });
    if (res.status === 304) return null;
    if (!res.ok) return null;
    return validateGraphData(await res.json());
  } catch (e) {
    log.warn('fetchGraphDataIncremental failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function requestWatch(enabled: boolean, path: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('/api/v1/codegraph/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, path }),
    });
    return res.ok;
  } catch (e) {
    log.warn('requestWatch failed', e);
    return false;
  }
}
export interface FileOutlineData {
  symbols: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchFileOutline(nodeId: string): Promise<FileOutlineData | null> {
  try {
    const res = await fetchWithTimeout(`/api/v1/codegraph/files/${encodeURIComponent(nodeId)}/outline`);
    if (!res.ok) return null;
    const data = await res.json() as FileOutlineData;
    return {
      symbols: data.symbols ?? [],
      edges: data.edges ?? [],
    };
  } catch (e) {
    log.warn('fetchFileOutline failed', { nodeId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export interface SymbolASTData {
  astNodes: GraphNode[];
  astEdges: GraphEdge[];
  sourceLines: string[];
}

export async function fetchSymbolAST(nodeId: string): Promise<SymbolASTData | null> {
  try {
    const res = await fetchWithTimeout(`/api/v1/codegraph/symbols/${encodeURIComponent(nodeId)}/ast`);
    if (!res.ok) return null;
    const data = await res.json() as SymbolASTData;
    return {
      astNodes: data.astNodes ?? [],
      astEdges: data.astEdges ?? [],
      sourceLines: data.sourceLines ?? [],
    };
  } catch (e) {
    log.warn('fetchSymbolAST failed', { nodeId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
export interface EdgesData {
  edges: GraphEdge[];
  total: number;
  cursor: number;
  hasMore: boolean;
}

export async function fetchEdges(fromId: string, scope: 'file' | 'symbol' = 'file', cursor?: number, limit?: number): Promise<EdgesData | null> {
  try {
    const params = new URLSearchParams();
    params.set('from', fromId);
    params.set('scope', scope);
    if (cursor !== undefined) params.set('cursor', String(cursor));
    params.set('limit', String(limit ?? 500));
    const res = await fetchWithTimeout(`/api/v1/codegraph/edges?${params}`);
    if (!res.ok) return null;
    return await res.json() as EdgesData;
  } catch (e) {
    log.warn('fetchEdges failed', { fromId, scope, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}