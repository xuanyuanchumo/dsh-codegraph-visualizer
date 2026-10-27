/**
 * 长度维度 NFA 的单元测试。
 *
 * 覆盖：状态数公式、退化区间、无限/非整数长度的诚实拒绝、纯函数性。
 */
import { describe, it, expect } from 'vitest';
import { compileLengthNfa } from '../../../src/xuanji/core/nfa.ts';

describe('compileLengthNfa', () => {
  it('状态数 = lMax - lMin + 1（长度区间 [1,4] → 4 个状态）', () => {
    expect(compileLengthNfa({ lMin: 1, lMax: 4 })).toEqual({ states: 4, accepting: 4 });
  });

  it('单点区间 [2,2] 只编译出一个接受态', () => {
    expect(compileLengthNfa({ lMin: 2, lMax: 2 })).toEqual({ states: 1, accepting: 1 });
  });

  it('允许 lMin = 0（空路径也是长度维度上的合法收束）', () => {
    expect(compileLengthNfa({ lMin: 0, lMax: 3 })).toEqual({ states: 4, accepting: 4 });
  });

  it('区间 [0,0] 编译为单一接受态', () => {
    expect(compileLengthNfa({ lMin: 0, lMax: 0 })).toEqual({ states: 1, accepting: 1 });
  });

  it('链上每个状态都是接受态：accepting 恒等于 states', () => {
    for (const [lMin, lMax] of [
      [0, 1],
      [3, 9],
      [5, 5],
      [1, 100],
    ] as const) {
      const result = compileLengthNfa({ lMin, lMax });
      expect(result.accepting).toBe(result.states);
      expect(result.states).toBe(lMax - lMin + 1);
    }
  });

  it('lMax = Infinity 抛 RangeError（无限长度没有有穷状态编码）', () => {
    expect(() => compileLengthNfa({ lMin: 1, lMax: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('lMax = -Infinity 抛 RangeError', () => {
    expect(() => compileLengthNfa({ lMin: 1, lMax: Number.NEGATIVE_INFINITY })).toThrow(RangeError);
  });

  it('lMax = NaN 抛 RangeError', () => {
    expect(() => compileLengthNfa({ lMin: 1, lMax: Number.NaN })).toThrow(RangeError);
  });

  it('lMin = Infinity 抛 RangeError', () => {
    expect(() => compileLengthNfa({ lMin: Number.POSITIVE_INFINITY, lMax: 10 })).toThrow(RangeError);
  });

  it('lMin = NaN 抛 RangeError', () => {
    expect(() => compileLengthNfa({ lMin: Number.NaN, lMax: 10 })).toThrow(RangeError);
  });

  it('lMin 为负抛 RangeError', () => {
    expect(() => compileLengthNfa({ lMin: -1, lMax: 3 })).toThrow(RangeError);
  });

  it('lMax < lMin 抛 RangeError（空区间不是自动机）', () => {
    expect(() => compileLengthNfa({ lMin: 5, lMax: 4 })).toThrow(RangeError);
  });

  it('非整数 lMin/lMax 抛 RangeError（边数必须是整数）', () => {
    expect(() => compileLengthNfa({ lMin: 1.5, lMax: 4 })).toThrow(RangeError);
    expect(() => compileLengthNfa({ lMin: 1, lMax: 4.5 })).toThrow(RangeError);
  });

  it('纯函数：重复编译得到相同结果，且不修改入参', () => {
    const rule = { lMin: 2, lMax: 7 };
    const frozen = Object.freeze({ ...rule });
    expect(compileLengthNfa(frozen)).toEqual(compileLengthNfa(frozen));
    expect(frozen).toEqual({ lMin: 2, lMax: 7 });
  });

  it('大区间不分配状态数组（只返回计数，O(1)）', () => {
    expect(compileLengthNfa({ lMin: 0, lMax: 1_000_000 })).toEqual({
      states: 1_000_001,
      accepting: 1_000_001,
    });
  });
});
