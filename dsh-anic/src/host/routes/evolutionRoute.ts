/**
 * M5 进化引擎路由 — 信任度/自主级别/技术债务查询与操作。
 */

import type { SnapshotCtx } from '../snapshotRoute.ts';
import {
  buildTrustScores,
  recommendBand,
  type AutonomyBand,
  type LedgerEntryForTrust,
} from '../evolution/trustModel.ts';
import {
  checkBreakers,
  decideAction,
  downgradeBand,
  type BreakerInput,
} from '../evolution/autonomyGovernor.ts';
import { generateTechDebt, type EvalResult } from '../evolution/patchEngine.ts';

type SendFn = (res: any, code: number, body: unknown, requestId?: string) => void;

function query(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  return v ?? undefined;
}

export function registerEvolutionRoute(ctx: SnapshotCtx, send: SendFn): Array<(() => void) | null> {
  const ws = ctx.webServer;
  if (!ws) return [];

  const disposers: Array<(() => void) | null> = [];
  const reg = (path: string, method: string, handler: (req: unknown, res: unknown) => void): void => {
    const d = ws.register(method, path, handler);
    disposers.push(typeof d === 'function' ? d : null);
  };

  // GET /anic/api/trust — 信任分（从账本条目构建）
  reg('/anic/api/trust', 'GET', (req: any, res: any) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const entriesRaw = query(url, 'entries');
    let entries: LedgerEntryForTrust[] = [];
    if (entriesRaw) {
      try { entries = JSON.parse(entriesRaw) as LedgerEntryForTrust[]; } catch { /* empty */ }
    }
    const scores = buildTrustScores(entries);
    const result = [...scores.values()];
    send(res, 200, { trustScores: result, count: result.length });
  });

  // GET /anic/api/autonomy — 自主级别推荐
  reg('/anic/api/autonomy', 'GET', (req: any, res: any) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const band = (query(url, 'band') ?? 'L2') as AutonomyBand;
    const trustScore = parseInt(query(url, 'trust') ?? '50', 10);
    const recommended = recommendBand(band, trustScore);
    send(res, 200, { current: band, trustScore, recommended });
  });

  // POST /anic/api/breakers — 熔断检查
  reg('/anic/api/breakers', 'POST', (req: any, res: any) => {
    let body: BreakerInput;
    try {
      body = JSON.parse(req.body ?? '{}') as BreakerInput;
    } catch {
      send(res, 400, { error: 'ANIC_ROUTE_BAD_BODY', detail: 'Invalid JSON body' });
      return;
    }
    const breakers = checkBreakers(body);
    const band = (query(new URL(req.url ?? '', 'http://localhost'), 'band') ?? 'L2') as AutonomyBand;
    const action = decideAction(band, breakers);
    const downgraded = action === 'downgrade' ? downgradeBand(band) : band;
    send(res, 200, { breakers, action, downgradedBand: downgraded });
  });

  // POST /anic/api/tech-debt — 从评估结果生成技术债务
  reg('/anic/api/tech-debt', 'POST', (req: any, res: any) => {
    let results: EvalResult[];
    try {
      results = JSON.parse(req.body ?? '[]') as EvalResult[];
    } catch {
      send(res, 400, { error: 'ANIC_ROUTE_BAD_BODY', detail: 'Invalid JSON body' });
      return;
    }
    const entries = generateTechDebt(results);
    send(res, 200, { techDebt: entries, count: entries.length });
  });

  return disposers;
}
