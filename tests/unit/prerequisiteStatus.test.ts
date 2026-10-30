/**
 * 能力位的归一化与健康判定（cycle-111 / P0-N3）。
 *
 * 这两个函数是宿主 `/status` / `/health` 与客户端 `fetchStatus` / `EmptyState` 的**共用**
 * 实现。放一份共用的理由不是 DRY，而是缺陷可观测性：宿主和客户端各写一份「缺字段怎么办」
 * 时，两边的兜底方向会悄悄分叉 —— 一侧判 `false`、一侧判 `true`，于是「降级模式」在一半
 * 客户端上还在显示，而没有任何单一测试能看见这个分歧。
 *
 * 本文件钉三组契约：
 *   1. 归一化的**缺省方向**（新宿主原样采纳 / 缺字段、类型不对、旧宿主残缺载荷一律 `false`）；
 *   2. 健康判定只认「图数据通道」，`astSource` 单独存在时必须**不**健康；
 *   3. cycle-118 起 `builtin` 兼容别名已移除：线上载荷里的 `builtin` **被忽略**，
 *      归一化输出**不含**该键（旧宿主只发 `builtin` 的载荷按「不知道」处理 ⇒ `astSource: false`）。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePrerequisiteStatus,
  isGraphServiceHealthy,
  emptyPrerequisiteStatus,
} from '../../src/shared/prerequisiteStatus.ts';

describe('normalizePrerequisiteStatus', () => {
  it('adopts all four bits verbatim from a new host', () => {
    const status = normalizePrerequisiteStatus({
      codegraph: true, lens: false, astSource: true, graphSource: false,
    });
    expect(status).toEqual({
      codegraph: true, lens: false, astSource: true, graphSource: false,
    });
  });

  it('does NOT map a legacy builtin-only payload onto astSource (alias removed in cycle-118)', () => {
    // 旧宿主只发 `builtin`。cycle-118 起别名已移除：**不知道**不等于**有**，
    // 与 `graphSource` 缺省方向同一诚实原则——从 `builtin` 推导会让两个来源迟早分叉。
    const status = normalizePrerequisiteStatus({ codegraph: false, lens: false, builtin: true });
    expect(status.astSource).toBe(false);
  });

  it('never lets an old host claim a graph channel', () => {
    // 旧宿主不发 `graphSource`。缺省必须是 false：它无权声称存在一条它从未汇报过的通道，
    // 而 true 会让「降级模式」在那种宿主上重新出现（正是 §61.10 的假叙事）。
    const status = normalizePrerequisiteStatus({ codegraph: false, lens: false, builtin: true });
    expect(status.graphSource).toBe(false);
  });

  it('treats a totally unknown payload as "nothing available"', () => {
    // 空对象 / null / 非对象都必须落到同一个保守形状 —— 这三条覆盖
    // "代理截断响应"、"手写 stub"、"请求失败" 三种真实来源。
    for (const raw of [{}, null, undefined, 0, 'x', []]) {
      const status = normalizePrerequisiteStatus(raw);
      expect(status).toEqual({
        codegraph: false, lens: false, astSource: false, graphSource: false,
      });
    }
  });

  it('coerces non-boolean values to false instead of trusting truthiness', () => {
    // 字符串 "true" / 数字 1 / 对象都不算「有」。用 `!!value` 会让 "false" 变成 true，
    // 这是本仓记录过的 SQLite/selector 同类问题（字符串与布尔混用）。
    const status = normalizePrerequisiteStatus({
      codegraph: 'true', lens: 1, astSource: 'yes', graphSource: {}, builtin: 'true',
    });
    expect(status).toEqual({
      codegraph: false, lens: false, astSource: false, graphSource: false,
    });
  });

  it('ignores a wire builtin value that conflicts with astSource', () => {
    // 线上同时发 `astSource: false` 与 `builtin: true`（旧宿主形状）。
    // 别名已移除 ⇒ `astSource` 只认自己，`builtin` 是被忽略的多余键。
    const status = normalizePrerequisiteStatus({ astSource: false, builtin: true });
    expect(status.astSource).toBe(false);
  });

  it('emits no builtin key at all (cycle-118 removal contract)', () => {
    // 移除的语义是「输出不含这个键」，不是「输出这个键为 false」——
    // `toEqual` 对 `undefined` 与缺失是等价的，所以用 in 存在性断言。
    const status = normalizePrerequisiteStatus({ astSource: true });
    expect('builtin' in status).toBe(false);
  });
});

describe('isGraphServiceHealthy', () => {
  it('is healthy when codegraph is available', () => {
    expect(isGraphServiceHealthy({ codegraph: true, lens: false, graphSource: false })).toBe(true);
  });

  it('is healthy when lens is available', () => {
    expect(isGraphServiceHealthy({ codegraph: false, lens: true, graphSource: false })).toBe(true);
  });

  it('is healthy when only the built-in graph source is available', () => {
    expect(isGraphServiceHealthy({ codegraph: false, lens: false, graphSource: true })).toBe(true);
  });

  it('is NOT healthy when nothing is available', () => {
    expect(isGraphServiceHealthy({ codegraph: false, lens: false, graphSource: false })).toBe(false);
  });
});

describe('emptyPrerequisiteStatus', () => {
  it('returns a fresh all-false status each time', () => {
    const a = emptyPrerequisiteStatus();
    const b = emptyPrerequisiteStatus();
    expect(a).toEqual({
      codegraph: false, lens: false, astSource: false, graphSource: false,
    });
    // 必须是新对象：共享一个可变单例会让某处的写入污染所有调用点
    // （`FeatureFlags.ts` 就踩过「返回代际默认表本体」）。
    expect(a).not.toBe(b);
  });
});
