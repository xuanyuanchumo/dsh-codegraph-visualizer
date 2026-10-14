/**
 * M5-a Governance 路由 — 归档/预算/清扫/孤儿检查。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { archiveOldCycles, type ArchiveOptions } from '../governance/archiver.ts';
import { checkBudget, type BudgetThresholds } from '../governance/budget.ts';
import { sweepCycles, type SweepOptions } from '../governance/sweep.ts';
import { pruneCheck } from '../governance/prune.ts';

type SendFn = (res: unknown, code: number, body: unknown, requestId?: string) => void;

interface ServerContext {
  webServer?: {
    register?: (method: string, path: string, handler: (req: unknown, res: unknown) => void) => (() => void) | void;
  };
  workspaceRegistry?: { list?: () => Array<{ path?: string }> };
  sessions?: { list?: () => Array<{ header?: { cwd?: string } }> };
}

function resolveRoot(ctx: ServerContext): string | null {
  const registry = ctx.workspaceRegistry?.list?.();
  if (registry && registry.length > 0 && registry[0]?.path) return registry[0].path;
  const sessions = ctx.sessions?.list?.();
  if (sessions && sessions.length > 0 && sessions[0]?.header?.cwd) return sessions[0].header.cwd;
  return null;
}

export function registerGovernanceRoute(ctx: ServerContext, send: SendFn): Array<(() => void) | null> {
  const disposers: Array<(() => void) | null> = [];
  const ws = ctx.webServer;
  if (!ws?.register) return disposers;

  const reg = (path: string, method: string, handler: (req: unknown, res: unknown) => void): void => {
    const d = ws.register!(method, path, handler);
    disposers.push(typeof d === 'function' ? d : null);
  };

  // POST /anic/governance/archive — 归档旧 cycle
  reg('/anic/governance/archive', 'POST', (req, res) => {
    const root = resolveRoot(ctx);
    if (!root) return send(res, 500, { error: 'ANIC_ROUTE_NO_WORKSPACE' });
    const cyclesDir = join(root, '.cycles');
    if (!existsSync(cyclesDir)) return send(res, 404, { error: 'ANIC_ROUTE_NO_CYCLES' });

    const body = (req as { body?: ArchiveOptions }).body ?? {};
    const result = archiveOldCycles(cyclesDir, body);
    send(res, 200, result);
  });

  // GET /anic/governance/budget — 预算检查
  reg('/anic/governance/budget', 'GET', (req, res) => {
    const root = resolveRoot(ctx);
    if (!root) return send(res, 500, { error: 'ANIC_ROUTE_NO_WORKSPACE' });
    const cyclesDir = join(root, '.cycles');
    if (!existsSync(cyclesDir)) return send(res, 404, { error: 'ANIC_ROUTE_NO_CYCLES' });

    const url = (req as { url?: string }).url ?? '';
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    const thresholds: BudgetThresholds = {};
    const w = params.get('warn');
    const a = params.get('alert');
    if (w) thresholds.warnBytes = parseInt(w, 10);
    if (a) thresholds.alertBytes = parseInt(a, 10);

    const report = checkBudget(cyclesDir, thresholds);
    send(res, 200, report);
  });

  // POST /anic/governance/sweep — 清扫空目录与过期 .tmp
  reg('/anic/governance/sweep', 'POST', (req, res) => {
    const root = resolveRoot(ctx);
    if (!root) return send(res, 500, { error: 'ANIC_ROUTE_NO_WORKSPACE' });
    const cyclesDir = join(root, '.cycles');
    if (!existsSync(cyclesDir)) return send(res, 404, { error: 'ANIC_ROUTE_NO_CYCLES' });

    const body = (req as { body?: SweepOptions }).body ?? {};
    const result = sweepCycles(cyclesDir, body);
    send(res, 200, result);
  });

  // GET /anic/governance/prune — 孤儿检查
  reg('/anic/governance/prune', 'GET', (_req, res) => {
    const root = resolveRoot(ctx);
    if (!root) return send(res, 500, { error: 'ANIC_ROUTE_NO_WORKSPACE' });
    const cyclesDir = join(root, '.cycles');
    if (!existsSync(cyclesDir)) return send(res, 404, { error: 'ANIC_ROUTE_NO_CYCLES' });

    const report = pruneCheck(cyclesDir);
    send(res, 200, report);
  });

  return disposers;
}
