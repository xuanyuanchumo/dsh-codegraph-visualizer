/**
 * 账本路由（F2/F15，M2-a）。
 *
 * GET  /anic/api/ledger          账本条目列表（支持 ?limit & ?offset）
 * POST /anic/api/ledger/append   追加条目（单写者，哈希链）
 * GET  /anic/api/ledger/verify   验证整链
 */
import { resolveWorkspaceRoots, sendJson, type SnapshotCtx } from '../snapshotRoute.ts';
import { loadLedger, appendEntry, verifyLedger, isDuplicate } from '../runtime/ledger.ts';
import { join } from 'node:path';

type SendFn = (res: unknown, status: number, body: unknown, requestId?: string) => void;

interface RouteDeps {
  send: SendFn;
  getWorkspaceRoot: () => string | null;
}

function body<T = Record<string, unknown>>(req: unknown): T {
  return (req as { body?: T }).body ?? {} as T;
}

function query(req: unknown): Record<string, string> {
  const url = (req as { url?: string }).url ?? '';
  const q: Record<string, string> = {};
  const idx = url.indexOf('?');
  if (idx < 0) return q;
  for (const pair of url.slice(idx + 1).split('&')) {
    const [k, v] = pair.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return q;
}

export function registerLedgerRoute(ctx: unknown, deps: RouteDeps): (() => void) | null {
  const c = ctx as SnapshotCtx;
  if (!c.webServer || typeof c.webServer.register !== 'function') return null;
  const { send, getWorkspaceRoot } = deps;

  const d1 = c.webServer.register('GET', '/anic/api/ledger', (req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const entries = loadLedger(cyclesDir);
    const q = query(req);
    const off = q.offset ? parseInt(q.offset, 10) : 0;
    const lim = q.limit ? parseInt(q.limit, 10) : entries.length;
    send(res, 200, { total: entries.length, entries: entries.slice(off, off + lim) });
  });

  const d2 = c.webServer.register('POST', '/anic/api/ledger/append', (req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const { gate, gateName, result, detail } = body<{ gate: string; gateName?: string; result: 'PASS' | 'FAIL'; detail?: string }>(req);
    if (!gate || !result) { send(res, 400, { error: 'gate and result required' }); return; }
    if (result !== 'PASS' && result !== 'FAIL') { send(res, 400, { error: 'result must be PASS or FAIL' }); return; }
    // 幂等查重
    if (isDuplicate(cyclesDir, gate, result)) {
      send(res, 409, { error: 'duplicate', message: `last entry is already ${gate}/${result}` });
      return;
    }
    const entry = appendEntry(cyclesDir, { gate, gateName: gateName ?? gate, result, detail: detail ?? '' });
    send(res, 200, { ok: true, entry });
  });

  const d3 = c.webServer.register('GET', '/anic/api/ledger/verify', (_req: unknown, res: unknown) => {
    const root = getWorkspaceRoot();
    if (!root) { send(res, 404, { error: 'no workspace' }); return; }
    const cyclesDir = join(root, '.cycles');
    const result = verifyLedger(cyclesDir);
    send(res, 200, result);
  });

  const disposers = [d1, d2, d3].filter((d): d is () => void => typeof d === 'function');
  return disposers.length > 0 ? () => { for (const d of disposers) d(); } : null;
}
