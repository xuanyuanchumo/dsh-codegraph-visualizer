/**
 * 能力位的归一化与健康判定（cycle-111 / P0-N3）。
 *
 * 这两个函数是宿主 `/status` / `/health` 与客户端 `fetchStatus` / `EmptyState` 的**共用**
 * 实现。放一份共用的理由不是 DRY，而是缺陷可观测性：宿主和客户端各写一份「缺字段怎么办」
 * 时，两边的兜底方向会悄悄分叉 —— 一侧判 `false`、一侧判 `true`，于是「降级模式」在一半
 * 客户端上还在显示，而没有任何单一测试能看见这个分歧。
 *
 * 本文件钉三组契约：
 *   1. 归一化的**三个方向**（新宿主 / 旧宿主 / 缺字段），每个方向的缺省值都写死；
 *   2. 健康判定只认「图数据通道」，`astSource` 单独存在时必须**不**健康；
 *   3. 别名 `builtin` 恒等于 `astSource`，不接受线上独立声明。
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
      codegraph: true, lens: false, astSource: true, graphSource: false, builtin: true,
    });
    expect(status).toEqual({
      codegraph: true, lens: false, astSource: true, graphSource: false, builtin: true,
    });
  });

  it('maps builtin to astSource when talking to an old host', () => {
    // 旧宿主只发 `builtin`。它当初描述的就是 AST 那一层（那是它能诚实对应的唯一解释）。
    const status = normalizePrerequisiteStatus({ codegraph: false, lens: false, builtin: true });
    expect(status.astSource).toBe(true);
    expect(status.builtin).toBe(true);
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
        codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
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
      codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
    });
  });

  it('derives the builtin alias from astSource and ignores a conflicting wire value', () => {
    // 线上同时发 `astSource: false` 与 `builtin: true`（不该发生，但一旦发生必须有确定答案）。
    // 别名由 astSource 派生，两个来源不分叉。
    const status = normalizePrerequisiteStatus({ astSource: false, builtin: true });
    expect(status.astSource).toBe(false);
    expect(status.builtin).toBe(false);
  });

  it('prefers astSource over builtin when both are present and disagree', () => {
    const status = normalizePrerequisiteStatus({ astSource: true, builtin: false });
    expect(status.astSource).toBe(true);
    expect(status.builtin).toBe(true);
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
      codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
    });
    // 必须是新对象：共享一个可变单例会让某处的写入污染所有调用点
    // （`FeatureFlags.ts` 就踩过「返回代际默认表本体」）。
    expect(a).not.toBe(b);
  });
});
