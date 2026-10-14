/**
 * 共享路由上下文 — 把 makeSend / getWorkspaceRoot / loadFlows 提取到一处，
 * routes/index.ts 不再内联这些逻辑（M9 结构优化：单一职责）。
 */
import { join } from 'node:path';
import { resolveWorkspaceRoots, sendJson, type SnapshotCtx } from '../snapshotRoute.ts';
import { loadWorkspaceConfig } from '../config.ts';
import { resolveFlows } from '../../shared/flows.ts';

export type SendFn = (res: unknown, status: number, body: unknown, requestId?: string) => void;

export interface RouteContext {
  ctx: SnapshotCtx;
  send: SendFn;
  getWorkspaceRoot: () => string | null;
  loadFlows: () => { selfInit: boolean };
}

export function makeSend(): SendFn {
  return (res, status, body, requestId) => {
    sendJson(res, status, body, requestId ? { 'X-ANIC-Request-Id': requestId } : undefined);
  };
}

export function buildRouteContext(ctx: unknown): RouteContext {
  const c = ctx as SnapshotCtx;
  const send = makeSend();
  const getWorkspaceRoot = (): string | null => {
    try { return resolveWorkspaceRoots(c); } catch { return null; }
  };
  const loadFlows = (): { selfInit: boolean } => {
    try {
      const root = getWorkspaceRoot();
      if (!root) return { selfInit: true };
      const cfg = loadWorkspaceConfig(join(root, '.cycles'));
      const resolved = resolveFlows({ workspace: cfg.values.flowOverrides });
      return { selfInit: resolved.flows['flow.selfInit']?.enabled ?? true };
    } catch { return { selfInit: true }; }
  };
  return { ctx: c, send, getWorkspaceRoot, loadFlows };
}
