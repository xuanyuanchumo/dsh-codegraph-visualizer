import { describe, it, expect } from 'vitest';
import { assertNever } from '../../src/shared/assertNever.ts';

describe('assertNever', () => {
  it('应抛出默认错误信息', () => {
    expect(() => assertNever(undefined as never)).toThrow('Unreachable: unexpected value undefined');
  });

  it('应抛出自定义错误信息', () => {
    expect(() => assertNever(undefined as never, '自定义消息')).toThrow('自定义消息');
  });

  it('应处理 null 值', () => {
    expect(() => assertNever(null as never)).toThrow('Unreachable: unexpected value null');
  });

  it('应处理字符串值', () => {
    expect(() => assertNever('test' as never)).toThrow('Unreachable: unexpected value "test"');
  });

  it('应处理数值', () => {
    expect(() => assertNever(42 as never)).toThrow('Unreachable: unexpected value 42');
  });
});