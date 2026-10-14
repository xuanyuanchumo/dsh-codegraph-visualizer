/**
 * M5 AutonomyGovernor — 自主级别治理 + 8 熔断条件。
 *
 * 先修复后降级：熔断触发 → 尝试修复 → 修复失败才降级。
 */

import type { AutonomyBand } from './trustModel.ts';

// ── 熔断条件 ────────────────────────────────────────────

export type BreakerId =
  | 'consecutive_fix_fail'    // 连续 3 次修复失败
  | 'gate_doubt'              // 门禁存疑
  | 'user_data_unisolated'    // 真实用户数据无隔离
  | 'destructive_no_rollback' // 破坏性不可回滚
  | 'perf_unrecovered'        // 性能 1 轮未恢复
  | 'human_requests_l3'       // 人类要求 L3
  | 'unattended_or_context'   // 单会话 >24h 或上下文 >85%
  | 'retries_or_breakers'     // 重试 >10 或熔断 >3
  ;

export interface BreakerInput {
  consecutiveFixFails: number;
  hasDoubt: boolean;
  userDataUnisolated: boolean;
  destructiveNoRollback: boolean;
  perfUnrecovered: boolean;
  humanRequestsL3: boolean;
  unattendedHours: number;
  contextUsagePercent: number;
  totalRetries: number;
  totalBreakerTrips: number;
}

export interface BreakerResult {
  id: BreakerId;
  tripped: boolean;
  detail: string;
}

/** 评估 8 熔断条件 */
export function checkBreakers(input: BreakerInput): BreakerResult[] {
  return [
    {
      id: 'consecutive_fix_fail',
      tripped: input.consecutiveFixFails >= 3,
      detail: `连续修复失败 ${String(input.consecutiveFixFails)} 次（阈值 3）`,
    },
    {
      id: 'gate_doubt',
      tripped: input.hasDoubt,
      detail: input.hasDoubt ? '门禁裁决为 doubt（存疑）' : '门禁无 doubt',
    },
    {
      id: 'user_data_unisolated',
      tripped: input.userDataUnisolated,
      detail: input.userDataUnisolated ? '检测到真实用户数据且无隔离' : '无未隔离用户数据',
    },
    {
      id: 'destructive_no_rollback',
      tripped: input.destructiveNoRollback,
      detail: input.destructiveNoRollback ? '破坏性操作且不可回滚' : '无非回滚破坏性操作',
    },
    {
      id: 'perf_unrecovered',
      tripped: input.perfUnrecovered,
      detail: input.perfUnrecovered ? '性能阈值 1 轮未恢复' : '性能在阈值内',
    },
    {
      id: 'human_requests_l3',
      tripped: input.humanRequestsL3,
      detail: input.humanRequestsL3 ? '人类要求 L3（显式降级）' : '无人类降级请求',
    },
    {
      id: 'unattended_or_context',
      tripped: input.unattendedHours > 24 || input.contextUsagePercent > 85,
      detail: `单会话 ${String(input.unattendedHours)}h / 上下文 ${String(input.contextUsagePercent)}%（阈值 24h / 85%）`,
    },
    {
      id: 'retries_or_breakers',
      tripped: input.totalRetries > 10 || input.totalBreakerTrips > 3,
      detail: `重试 ${String(input.totalRetries)} / 熔断 ${String(input.totalBreakerTrips)}（阈值 10 / 3）`,
    },
  ];
}

// ── 决策 ────────────────────────────────────────────────

export type ActionDecision = 'proceed' | 'pause' | 'downgrade';

/** 根据当前级别 + 熔断状态决策 */
export function decideAction(band: AutonomyBand, breakers: BreakerResult[]): ActionDecision {
  const tripped = breakers.filter((b) => b.tripped);

  // 任何熔断 → 至少 pause
  if (tripped.length > 0) {
    // 严重熔断（用户数据/破坏性/人类要求）→ downgrade
    const severe = tripped.some((b) =>
      b.id === 'user_data_unisolated' ||
      b.id === 'destructive_no_rollback' ||
      b.id === 'human_requests_l3',
    );
    if (severe || band === 'L4') return 'downgrade';
    return 'pause';
  }

  return 'proceed';
}

/** 降级后的级别 */
export function downgradeBand(band: AutonomyBand): AutonomyBand {
  if (band === 'L4') return 'L3';
  if (band === 'L3') return 'L2';
  if (band === 'L2') return 'L1';
  return 'L1';
}
