/**
 * M5 TrustModel — 信任度累积模型。
 *
 * 从账本历史裁决累积信任分，驱动自主级别升级/降级。
 * 信任分 = round(approve / total * 100)；诚实：doubt 不算 approve。
 */

// ── 类型 ────────────────────────────────────────────────

export type AutonomyBand = 'L1' | 'L2' | 'L3' | 'L4';

export interface TrustScore {
  agentId: string;
  totalDecisions: number;
  approveCount: number;
  rejectCount: number;
  doubtCount: number;
  trustScore: number; // 0-100
  lastUpdated: string;
}

/** 账本条目（最小契约，从 ledger.ts 或 segmentedLedger.ts 转录） */
export interface LedgerEntryForTrust {
  gate: string;
  gateName?: string;
  result: string; // 'PASS' | 'FAIL' | 'doubt' | ...
  detail?: string;
  timestamp: string;
}

// ── 阈值 ────────────────────────────────────────────────

/** 自主级别升级阈值（信任分 ≥ threshold 才可升级） */
export const UPGRADE_THRESHOLDS: Record<string, number> = {
  L1_to_L2: 50,
  L2_to_L3: 70,
  L3_to_L4: 85,
};

/** 自主级别降级阈值（信任分 < threshold 触发降级） */
export const DOWNGRADE_THRESHOLDS: Record<string, number> = {
  L4_to_L3: 80,
  L3_to_L2: 60,
  L2_to_L1: 40,
};

// ── 核心逻辑 ────────────────────────────────────────────

/** 从账本条目构建信任分（按 gate 聚合） */
export function buildTrustScores(entries: LedgerEntryForTrust[]): Map<string, TrustScore> {
  const stats = new Map<string, { approve: number; reject: number; doubt: number; total: number; lastTs: string }>();

  for (const e of entries) {
    const key = e.gate;
    const s = stats.get(key) ?? { approve: 0, reject: 0, doubt: 0, total: 0, lastTs: '' };
    s.total += 1;
    const r = e.result.toLowerCase();
    if (r === 'pass' || r === 'approve') s.approve += 1;
    else if (r === 'fail' || r === 'reject') s.reject += 1;
    else s.doubt += 1;
    if (e.timestamp > s.lastTs) s.lastTs = e.timestamp;
    stats.set(key, s);
  }

  const result = new Map<string, TrustScore>();
  for (const [gate, s] of stats) {
    const trustScore = s.total > 0 ? Math.round((s.approve / s.total) * 100) : 0;
    result.set(gate, {
      agentId: gate,
      totalDecisions: s.total,
      approveCount: s.approve,
      rejectCount: s.reject,
      doubtCount: s.doubt,
      trustScore,
      lastUpdated: s.lastTs,
    });
  }
  return result;
}

/** 判断是否可升级自主级别 */
export function canUpgrade(current: AutonomyBand, trustScore: number): boolean {
  const key = `${current}_to_${nextBand(current)}`;
  const threshold = UPGRADE_THRESHOLDS[key];
  if (threshold === undefined) return false; // L4 已是最高
  return trustScore >= threshold;
}

/** 判断是否应降级自主级别 */
export function shouldDowngrade(current: AutonomyBand, trustScore: number): boolean {
  const prev = prevBand(current);
  if (prev === null) return false; // L1 已是最低
  const key = `${current}_to_${prev}`;
  const threshold = DOWNGRADE_THRESHOLDS[key];
  if (threshold === undefined) return false;
  return trustScore < threshold;
}

function nextBand(b: AutonomyBand): AutonomyBand {
  if (b === 'L1') return 'L2';
  if (b === 'L2') return 'L3';
  if (b === 'L3') return 'L4';
  return 'L4';
}

function prevBand(b: AutonomyBand): AutonomyBand | null {
  if (b === 'L2') return 'L1';
  if (b === 'L3') return 'L2';
  if (b === 'L4') return 'L3';
  return null;
}

/** 推荐自主级别（综合升级/降级） */
export function recommendBand(current: AutonomyBand, trustScore: number): AutonomyBand {
  if (shouldDowngrade(current, trustScore)) {
    const prev = prevBand(current);
    if (prev !== null) return prev;
  }
  if (canUpgrade(current, trustScore)) {
    return nextBand(current);
  }
  return current;
}
