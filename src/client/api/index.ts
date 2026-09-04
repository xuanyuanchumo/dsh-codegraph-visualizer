import { scoped } from '../../shared/Logger.ts';
import type { GraphData } from '../../types/index.ts';
import { validateGraphData } from '../validators.ts';

const log = scoped('client');

export async function fetchStatus(): Promise<{ codegraph: boolean; lens: boolean }> {
  try {
    const res = await fetch('/api/codegraph/status');
    if (!res.ok) return { codegraph: false, lens: false };
    return await res.json();
  } catch (e) {
    log.warn('fetchStatus failed', e);
    return { codegraph: false, lens: false };
  }
}

export async function fetchGraphData(): Promise<GraphData | null> {
  try {
    const res = await fetch('/api/codegraph/data');
    if (!res.ok) return null;
    return validateGraphData(await res.json());
  } catch (e) {
    log.warn('fetchGraphData failed', e);
    return null;
  }
}

export async function fetchWorkspace(): Promise<{ path: string; list: string[] }> {
  try {
    const res = await fetch('/api/codegraph/workspace');
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
    const res = await fetch('/api/codegraph/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, maxNodes }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestScan failed', e);
    return null;
  }
}

export async function requestInit(path: string): Promise<{ success: boolean; message: string } | null> {
  try {
    const res = await fetch('/api/codegraph/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestInit failed', e);
    return null;
  }
}

export async function requestWatch(enabled: boolean, path: string): Promise<boolean> {
  try {
    const res = await fetch('/api/codegraph/watch', {
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