/**
 * 组织状态聚合（原生实现，替代技能 org-status.mjs）。
 * 汇总 trust + autonomy + breakers + cycles + band → 全景状态。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadLedger } from '../runtime/ledger.ts';
import { buildTrustScores, recommendBand, type AutonomyBand, type LedgerEntryForTrust } from './trustModel.ts';
import { checkBreakers, decideAction, type BreakerInput } from './autonomyGovernor.ts';
import { loadBandHistory } from './bandDetector.ts';

export interface OrgStatus {
  cycles: { total: number; latest: string | null; converged: number; failed: number };
  ledger: { entries: number; valid: boolean };
  trust: { scores: Record<string, { score: number; approve: number; total: number }>; recommendedBand: string };
  autonomy: { currentBand: string; breakers: string[]; action: string };
  band: { current: string; trend: string };
  flows: { selfInit: boolean; agentsOrchestration: boolean };
  timestamp: string;
}

const DEFAULT_BREAKER_INPUT: BreakerInput = {
  consecutiveFixFails: 0,
  hasDoubt: false,
  userDataUnisolated: false,
  destructiveNoRollback: false,
  perfUnrecovered: false,
  humanRequestsL3: false,
  unattendedHours: 0,
  contextUsagePercent: 0,
  totalRetries: 0,
  totalBreakerTrips: 0,
};

export function runOrgStatus(workspaceRoot: string, options: {
  currentBand?: string;
  breakersInput?: Partial<BreakerInput>;
  currentScore?: number;
  flows?: { selfInit: boolean; agentsOrchestration: boolean };
}): OrgStatus {
  const cyclesDir = join(workspaceRoot, '.cycles');

  // Cycles
  const cyclesDir2 = join(cyclesDir, 'cycles');
  let cycleDirs: string[] = [];
  if (existsSync(cyclesDir2)) {
    cycleDirs = readdirSync(cyclesDir2).filter((d) => /^cycle-\d+$/.test(d));
  }
  const converged = cycleDirs.filter((d) => existsSync(join(cyclesDir2, d, '交付清单.md'))).length;
  const failed = cycleDirs.filter((d) => existsSync(join(cyclesDir2, d, '审计日志.md')) &&
    readFileSync(join(cyclesDir2, d, '审计日志.md'), 'utf-8').includes('FAIL')).length;
  const latestCycle = cycleDirs.length > 0 ? (cycleDirs[cycleDirs.length - 1] ?? null) : null;

  // Ledger
  let ledgerEntries = 0;
  let ledgerValid = true;
  const ledgerPath = join(cyclesDir, 'gates', 'ledger.json');
  const ledger: LedgerEntryForTrust[] = existsSync(ledgerPath) ? loadLedger(cyclesDir) : [];
  ledgerEntries = ledger.length;
  ledgerValid = ledger.every((e, i) => i === 0 || e.gate !== '');

  // Trust
  const trustScoresMap = buildTrustScores(ledger);
  const trustScores: Record<string, { score: number; approve: number; total: number }> = {};
  for (const [gate, ts] of trustScoresMap) {
    trustScores[gate] = { score: ts.trustScore, approve: ts.approveCount, total: ts.totalDecisions };
  }
  const avgTrust = ledger.length > 0
    ? Math.round(ledger.filter((e) => e.result.toLowerCase() === 'pass' || e.result.toLowerCase() === 'approve').length / ledger.length * 100)
    : 0;
  const band = (options.currentBand ?? 'L2') as AutonomyBand;
  const recommendedBand = recommendBand(band, avgTrust);

  // Autonomy
  const breakerInput: BreakerInput = { ...DEFAULT_BREAKER_INPUT, ...options.breakersInput };
  const breakerResults = checkBreakers(breakerInput);
  const action = decideAction(band, breakerResults);

  // Band
  const bandHistory = loadBandHistory(workspaceRoot);
  const bandCurrent = bandHistory.length > 0 ? (bandHistory[bandHistory.length - 1]?.band ?? 'normal') : 'normal';
  const bandTrend = 'stable';

  return {
    cycles: { total: cycleDirs.length, latest: latestCycle, converged, failed },
    ledger: { entries: ledgerEntries, valid: ledgerValid },
    trust: { scores: trustScores, recommendedBand },
    autonomy: { currentBand: band, breakers: breakerResults.filter((b) => b.tripped).map((b) => b.id), action },
    band: { current: bandCurrent, trend: bandTrend },
    flows: options.flows ?? { selfInit: true, agentsOrchestration: true },
    timestamp: new Date().toISOString(),
  };
}
