import { scoped } from '../../shared/Logger.ts';
import type { GraphData } from '../../types/index.ts';
import { validateGraphData } from '../validators.ts';
import { API } from '../../shared/constants.ts';

const log = scoped('client');

const DEFAULT_TIMEOUT = API.DEFAULT_TIMEOUT_MS;

function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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