/**
 * 真实性审计路由：自举四目标（真实/准确/结构/逻辑）的 HTTP 查询面。
 *
 * GET /anic/api/truth-audit — 运行四维审计，返回逐项结果。
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTruthAudit } from '../evolution/truthAudit.ts';

const PLUGIN_DIR = resolve(fileURLToPath(import.meta.url), '../../../');

/** 注册真实性审计路由（GET /anic/api/truth-audit）。 */
export function registerTruthAuditRoute(
  c: { webServer?: { register(opts: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void }): (() => void) | void } },
  send: (res: unknown, code: number, body: unknown, requestId?: string) => void,
): Array<(() => void) | null> {
  const disposers: Array<(() => void) | null> = [];
  if (!c.webServer) return disposers;

  const d1 = c.webServer.register({ kind: 'exact', path: '/anic/api/truth-audit', handler: (_req, res) => {
    const summary = runTruthAudit(PLUGIN_DIR);
    send(res, 200, summary);
  }});
  if (typeof d1 === 'function') disposers.push(d1);

  return disposers;
}
