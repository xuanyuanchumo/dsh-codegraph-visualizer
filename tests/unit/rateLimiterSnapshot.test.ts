/**
 * T146-3 契约：RateLimiter 白盒快照（cycle-146）。
 *
 * `snapshot()` 是限流器的只读投影——本套测试钉死三条不变式：
 * ① 快照**不得**改变限流行为（投影前后 check 结果一致——「观测者效应」零容忍）；
 * ② 过期桶不虚报（快照只反映未过期桶）；
 * ③ 输出确定性（按键排序 + resetInMs 单调不增）。
 *
 * 反自我反证：① 用「同一键连续打满配额」验证投影不重置计数——一个把 snapshot 实现
 * 成 reset 的回归在这里立刻红灯。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/host/RateLimiter.ts';
import { API } from '../../src/shared/constants.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimiter.snapshot (cycle-146 T146-3)', () => {
  it('RL-1 empty limiter → zero buckets with limit metadata present', () => {
    const rl = createRateLimiter();
    const s = rl.snapshot();
    expect(s.activeBuckets).toBe(0);
    expect(s.buckets).toEqual([]);
    expect(s.limits.windowMs).toBe(API.RATE_LIMIT_WINDOW_MS);
    expect(s.limits.heavy).toBe(API.RATE_LIMIT_HEAVY);
    expect(s.limits.regular).toBe(API.RATE_LIMIT_DEFAULT);
  });

  it('RL-2 snapshot does NOT mutate limiter state (zero observer effect)', () => {
    const rl = createRateLimiter();
    const path = '/api/v1/codegraph/scan'; // heavy endpoint
    // 打满 heavy 配额
    let allowed = 0;
    for (let i = 0; i < API.RATE_LIMIT_HEAVY; i++) if (rl.check('ip1', path)) allowed++;
    expect(allowed).toBe(API.RATE_LIMIT_HEAVY);
    // 第 heavy+1 次必须被拒
    expect(rl.check('ip1', path)).toBe(false);

    const before = rl.snapshot();
    // 快照后再 check：仍被拒（快照没有重置桶）
    expect(rl.check('ip1', path)).toBe(false);
    const after = rl.snapshot();
    expect(after.buckets[0]?.count).toBe(before.buckets[0]?.count);
    expect(before.buckets[0]?.limit).toBe(API.RATE_LIMIT_HEAVY);
  });

  it('RL-3 expired buckets are NOT reported (no stale inflation)', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter();
    expect(rl.check('ip1', '/api/v1/codegraph/status')).toBe(true);
    expect(rl.snapshot().activeBuckets).toBe(1);
    // 时间前进超过窗口
    vi.advanceTimersByTime(API.RATE_LIMIT_WINDOW_MS + 1000);
    const s = rl.snapshot();
    expect(s.activeBuckets).toBe(0);
    expect(s.buckets).toEqual([]);
  });

  it('RL-4 buckets sorted by key; resetInMs within window bounds', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter();
    rl.check('ip-b', '/api/v1/codegraph/status');
    rl.check('ip-a', '/api/v1/codegraph/scan');
    const s = rl.snapshot();
    expect(s.buckets.map((b) => b.key)).toEqual([...s.buckets.map((b) => b.key)].sort());
    for (const b of s.buckets) {
      expect(b.resetInMs).toBeGreaterThanOrEqual(0);
      expect(b.resetInMs).toBeLessThanOrEqual(API.RATE_LIMIT_WINDOW_MS);
    }
    // heavy 端点桶的 limit 是 heavy 配额
    const heavyBucket = s.buckets.find((b) => b.key.endsWith('/scan'));
    expect(heavyBucket?.limit).toBe(API.RATE_LIMIT_HEAVY);
  });
});
