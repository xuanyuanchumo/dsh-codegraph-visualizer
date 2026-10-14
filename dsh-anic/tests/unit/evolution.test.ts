import { describe, it, expect } from 'vitest';
import {
  buildTrustScores,
  canUpgrade,
  shouldDowngrade,
  recommendBand,
  type LedgerEntryForTrust,
} from '../../src/host/evolution/trustModel.ts';
import {
  checkBreakers,
  decideAction,
  downgradeBand,
  type BreakerInput,
} from '../../src/host/evolution/autonomyGovernor.ts';
import { generateTechDebt, type EvalResult } from '../../src/host/evolution/patchEngine.ts';

// ── TrustModel ──────────────────────────────────────────

describe('TrustModel', () => {
  const entries: LedgerEntryForTrust[] = [
    { gate: 'G0', result: 'PASS', timestamp: '2024-01-01T00:00:00Z' },
    { gate: 'G0', result: 'PASS', timestamp: '2024-01-02T00:00:00Z' },
    { gate: 'G0', result: 'FAIL', timestamp: '2024-01-03T00:00:00Z' },
    { gate: 'G1', result: 'PASS', timestamp: '2024-01-01T00:00:00Z' },
    { gate: 'G1', result: 'doubt', timestamp: '2024-01-02T00:00:00Z' },
  ];

  it('buildTrustScores 按门聚合', () => {
    const scores = buildTrustScores(entries);
    expect(scores.size).toBe(2);
    const g0 = scores.get('G0');
    expect(g0).toBeDefined();
    expect(g0!.totalDecisions).toBe(3);
    expect(g0!.approveCount).toBe(2);
    expect(g0!.trustScore).toBe(67); // round(2/3*100)
  });

  it('doubt 不算 approve', () => {
    const scores = buildTrustScores(entries);
    const g1 = scores.get('G1');
    expect(g1!.approveCount).toBe(1);
    expect(g1!.doubtCount).toBe(1);
    expect(g1!.trustScore).toBe(50); // round(1/2*100)
  });

  it('空账本 → 空分', () => {
    expect(buildTrustScores([]).size).toBe(0);
  });

  it('canUpgrade L2→L3 需 ≥70', () => {
    expect(canUpgrade('L2', 69)).toBe(false);
    expect(canUpgrade('L2', 70)).toBe(true);
  });

  it('canUpgrade L4 已最高 → false', () => {
    expect(canUpgrade('L4', 100)).toBe(false);
  });

  it('shouldDowngrade L3→L2 需 <60', () => {
    expect(shouldDowngrade('L3', 60)).toBe(false);
    expect(shouldDowngrade('L3', 59)).toBe(true);
  });

  it('shouldDowngrade L1 已最低 → false', () => {
    expect(shouldDowngrade('L1', 0)).toBe(false);
  });

  it('recommendBand 升级优先于降级检查', () => {
    expect(recommendBand('L2', 75)).toBe('L3'); // ≥70 升级
    expect(recommendBand('L3', 50)).toBe('L2'); // <60 降级
    expect(recommendBand('L2', 55)).toBe('L2'); // 不动
  });
});

// ── AutonomyGovernor ───────────────────────────────────

describe('AutonomyGovernor', () => {
  const cleanInput: BreakerInput = {
    consecutiveFixFails: 0,
    hasDoubt: false,
    userDataUnisolated: false,
    destructiveNoRollback: false,
    perfUnrecovered: false,
    humanRequestsL3: false,
    unattendedHours: 1,
    contextUsagePercent: 30,
    totalRetries: 0,
    totalBreakerTrips: 0,
  };

  it('无熔断 → proceed', () => {
    const breakers = checkBreakers(cleanInput);
    expect(breakers.every((b) => !b.tripped)).toBe(true);
    expect(decideAction('L3', breakers)).toBe('proceed');
  });

  it('连续 3 次修复失败 → tripped', () => {
    const breakers = checkBreakers({ ...cleanInput, consecutiveFixFails: 3 });
    const fixFail = breakers.find((b) => b.id === 'consecutive_fix_fail');
    expect(fixFail!.tripped).toBe(true);
    expect(decideAction('L3', breakers)).toBe('pause');
  });

  it('用户数据无隔离 → downgrade', () => {
    const breakers = checkBreakers({ ...cleanInput, userDataUnisolated: true });
    expect(decideAction('L3', breakers)).toBe('downgrade');
  });

  it('破坏性不可回滚 → downgrade', () => {
    const breakers = checkBreakers({ ...cleanInput, destructiveNoRollback: true });
    expect(decideAction('L4', breakers)).toBe('downgrade');
  });

  it('上下文 >85% → tripped', () => {
    const breakers = checkBreakers({ ...cleanInput, contextUsagePercent: 86 });
    const ctx = breakers.find((b) => b.id === 'unattended_or_context');
    expect(ctx!.tripped).toBe(true);
  });

  it('重试 >10 → tripped', () => {
    const breakers = checkBreakers({ ...cleanInput, totalRetries: 11 });
    const retries = breakers.find((b) => b.id === 'retries_or_breakers');
    expect(retries!.tripped).toBe(true);
  });

  it('downgradeBand L4→L3→L2→L1', () => {
    expect(downgradeBand('L4')).toBe('L3');
    expect(downgradeBand('L3')).toBe('L2');
    expect(downgradeBand('L2')).toBe('L1');
    expect(downgradeBand('L1')).toBe('L1');
  });
});

// ── PatchEngine ────────────────────────────────────────

describe('PatchEngine', () => {
  it('通过的维度不产债务', () => {
    const results: EvalResult[] = [
      { dimension: 'E1', passed: true, detail: 'ok' },
      { dimension: 'E2', passed: true, detail: 'ok' },
    ];
    expect(generateTechDebt(results)).toHaveLength(0);
  });

  it('未通过维度产债务条目', () => {
    const results: EvalResult[] = [
      { dimension: 'E3', passed: false, detail: '测试覆盖不足' },
      { dimension: 'E7', passed: false, detail: '安全检查失败' },
    ];
    const debts = generateTechDebt(results);
    expect(debts).toHaveLength(2);
    expect(debts[0]!.dimension).toBe('E3');
    expect(debts[0]!.resolved).toBe(false);
    expect(debts[0]!.proposedAction).toContain('不自动改码');
  });

  it('E3/E7/Q2/Q4 → critical 严重度', () => {
    const results: EvalResult[] = [
      { dimension: 'E3', passed: false, detail: 'fail' },
      { dimension: 'Q4', passed: false, detail: 'fail' },
    ];
    const debts = generateTechDebt(results);
    expect(debts.every((d) => d.severity === 'critical')).toBe(true);
  });

  it('低分 → critical', () => {
    const results: EvalResult[] = [
      { dimension: 'E1', passed: false, score: 20, detail: 'low' },
    ];
    const debts = generateTechDebt(results);
    expect(debts[0]!.severity).toBe('critical');
  });
});
