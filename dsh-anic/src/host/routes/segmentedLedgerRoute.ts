/**
 * M2-b 分段账本路由
 */

import { join } from 'node:path';
import {
  initSegmentedLedger,
  appendToSegmented,
  loadSegmented,
  verifySegmented,
  isDuplicateSegmented,
  listSegmentFiles,
} from '../runtime/segmentedLedger.ts';

const LEDGER_SEG_DIR = 'gates'; // .cycles/gates/ 下放 head.json + seg-*.jsonl

type SendFn = (res: unknown, status: number, body: unknown, requestId?: string) => void;

function resolveLedgerDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.cycles', LEDGER_SEG_DIR);
}

function query(req: unknown, key: string): string | undefined {
  const r = req as { url?: string };
  if (!r.url) return undefined;
  const u = new URL(r.url, 'http://localhost');
  const v = u.searchParams.get(key);
  return v ?? undefined;
}

/** 注册分段账本路由（读取/追加/验证/初始化）。 */
export function registerSegmentedLedgerRoute(
  ctx: unknown,
  opts: { send: SendFn; getWorkspaceRoot: () => string | null },
): (() => void) | null {
  const c = ctx as { webServer?: { register: (...args: unknown[]) => unknown } };
  if (!c.webServer) return null;

  const disposers: (() => void)[] = [];

  // GET /anic/api/seg-ledger — 读取分段账本
  disposers.push(
    c.webServer.register({ kind: 'exact', path: '/anic/api/seg-ledger', handler: (_req: unknown, res: unknown) => {
      const root = opts.getWorkspaceRoot();
      if (!root) return opts.send(res, 404, { error: 'workspace not found' });
      const dir = resolveLedgerDir(root);
      const data = loadSegmented(dir);
      if (data === null) return opts.send(res, 404, { error: 'segmented ledger not initialized' });
      const segs = listSegmentFiles(dir);
      opts.send(res, 200, {
        head: data.head,
        entryCount: data.entries.length,
        entries: data.entries.slice(-100), // 最后 100 条
        segmentFiles: segs,
      });
    }}) as () => void,
  );

  // POST /anic/api/seg-ledger/append — 追加（幂等查重）
  disposers.push(
    c.webServer.register({ kind: 'exact', path: '/anic/api/seg-ledger/append', handler: (req: unknown, res: unknown) => {
      const root = opts.getWorkspaceRoot();
      if (!root) return opts.send(res, 404, { error: 'workspace not found' });
      const dir = resolveLedgerDir(root);

      // 初始化（幂等）
      initSegmentedLedger(dir);

      // 解析 body
      const r = req as { body?: unknown };
      const body = r.body as { gate?: string; gateName?: string; result?: string; detail?: string } | undefined;
      if (!body || !body.gate || !body.result) {
        return opts.send(res, 400, { error: 'missing gate or result' });
      }

      // 幂等查重
      if (
        isDuplicateSegmented(dir, {
          gate: body.gate,
          gateName: body.gateName ?? '',
          result: body.result,
          detail: body.detail ?? '',
        })
      ) {
        return opts.send(res, 409, { error: 'duplicate entry (idempotent reject)' });
      }

      const { entry, head } = appendToSegmented(dir, {
        gate: body.gate,
        gateName: body.gateName ?? '',
        result: body.result,
        detail: body.detail ?? '',
        timestamp: new Date().toISOString(),
      });

      opts.send(res, 201, { entry, head });
    }}) as () => void,
  );

  // GET /anic/api/seg-ledger/verify — 验证哈希链
  disposers.push(
    c.webServer.register({ kind: 'exact', path: '/anic/api/seg-ledger/verify', handler: (_req: unknown, res: unknown) => {
      const root = opts.getWorkspaceRoot();
      if (!root) return opts.send(res, 404, { error: 'workspace not found' });
      const dir = resolveLedgerDir(root);
      const result = verifySegmented(dir);
      opts.send(res, 200, result);
    }}) as () => void,
  );

  // GET /anic/api/seg-ledger/init — 初始化
  disposers.push(
    c.webServer.register({ kind: 'exact', path: '/anic/api/seg-ledger/init', handler: (_req: unknown, res: unknown) => {
      const root = opts.getWorkspaceRoot();
      if (!root) return opts.send(res, 404, { error: 'workspace not found' });
      const dir = resolveLedgerDir(root);
      const head = initSegmentedLedger(dir);
      opts.send(res, 201, { head });
    }}) as () => void,
  );

  return () => {
    for (const d of disposers) {
      if (typeof d === 'function') d();
    }
  };
}
