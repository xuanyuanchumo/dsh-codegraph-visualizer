/**
 * observability 计数器单元测试（cycle-141 第二轮）。
 *
 * 覆盖：incr/decr/getCount/snapshot/reset + 各 record* 便捷函数。
 * 纯函数测试——无 DOM/React 依赖。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  incr, decr, getCount, snapshot, reset,
  recordCacheHit, recordCacheMiss,
  recordEtagDecision,
  recordAstBudget,
  recordPipelineStage,
  OBS_KEYS,
} from '../../src/shared/observability.ts';

describe('incr / decr / getCount', () => {
  beforeEach(() => reset());

  it('初始值为 0', () => {
    expect(getCount('test.key')).toBe(0);
  });

  it('incr 默认递增 1', () => {
    incr('test.key');
    expect(getCount('test.key')).toBe(1);
  });

  it('incr 可指定 delta', () => {
    incr('test.key', 5);
    expect(getCount('test.key')).toBe(5);
  });

  it('多次 incr 累加', () => {
    incr('test.key', 2);
    incr('test.key', 3);
    expect(getCount('test.key')).toBe(5);
  });

  it('decr 递减', () => {
    incr('test.key', 5);
    decr('test.key', 2);
    expect(getCount('test.key')).toBe(3);
  });

  it('decr 不会低于 0（负值删除条目）', () => {
    incr('test.key', 1);
    decr('test.key', 5);
    expect(getCount('test.key')).toBe(0);
  });

  it('decr 不存在的 key 是 no-op', () => {
    decr('nonexistent.key');
    expect(getCount('nonexistent.key')).toBe(0);
  });
});

describe('snapshot', () => {
  beforeEach(() => reset());

  it('空快照返回空对象', () => {
    expect(snapshot()).toEqual({});
  });

  it('包含所有计数器', () => {
    incr('a', 1);
    incr('b', 2);
    const snap = snapshot();
    expect(snap.a).toBe(1);
    expect(snap.b).toBe(2);
  });

  it('reset 后清空', () => {
    incr('a', 1);
    reset();
    expect(snapshot()).toEqual({});
  });
});

describe('recordCacheHit / recordCacheMiss', () => {
  beforeEach(() => reset());

  it('recordCacheHit 递增对应缓存的命中计数', () => {
    recordCacheHit('scan');
    expect(getCount(OBS_KEYS.cacheScanHit)).toBe(1);
    recordCacheHit('scan');
    expect(getCount(OBS_KEYS.cacheScanHit)).toBe(2);
  });

  it('recordCacheMiss 递增对应缓存的未命中计数', () => {
    recordCacheMiss('indexeddb');
    expect(getCount(OBS_KEYS.cacheIndexedDbMiss)).toBe(1);
  });

  it('命中与未命中是独立的计数器', () => {
    recordCacheHit('scan');
    recordCacheMiss('scan');
    expect(getCount(OBS_KEYS.cacheScanHit)).toBe(1);
    expect(getCount(OBS_KEYS.cacheScanMiss)).toBe(1);
  });
});

describe('recordEtagDecision', () => {
  beforeEach(() => reset());

  it('200 决策', () => {
    recordEtagDecision('200');
    expect(getCount(OBS_KEYS.etag200)).toBe(1);
  });

  it('304 决策', () => {
    recordEtagDecision('304');
    expect(getCount(OBS_KEYS.etag304)).toBe(1);
  });

  it('rejected 决策', () => {
    recordEtagDecision('rejected');
    expect(getCount(OBS_KEYS.etagRejected)).toBe(1);
  });
});

describe('recordAstBudget', () => {
  beforeEach(() => reset());

  it('记录请求/返回/截断/hasMore', () => {
    recordAstBudget({ requested: 100, returned: 80, truncated: true, hasMore: true });
    expect(getCount(OBS_KEYS.astRequested)).toBe(100);
    expect(getCount(OBS_KEYS.astReturned)).toBe(80);
    expect(getCount(OBS_KEYS.astTruncated)).toBe(1);
    expect(getCount(OBS_KEYS.astHasMore)).toBe(1);
  });

  it('未截断时不递增截断计数', () => {
    recordAstBudget({ requested: 50, returned: 50, truncated: false, hasMore: false });
    expect(getCount(OBS_KEYS.astTruncated)).toBe(0);
    expect(getCount(OBS_KEYS.astHasMore)).toBe(0);
  });
});

describe('recordPipelineStage', () => {
  beforeEach(() => reset());

  it('递增管线阶段计数', () => {
    recordPipelineStage('scan');
    recordPipelineStage('scan');
    recordPipelineStage('merge');
    expect(getCount(OBS_KEYS.pipelineScan)).toBe(2);
    expect(getCount(OBS_KEYS.pipelineMerge)).toBe(1);
  });

  it('xuanjiDelta 与 xuanjiDegraded 是独立的', () => {
    recordPipelineStage('xuanjiDelta');
    recordPipelineStage('xuanjiDegraded');
    expect(getCount(OBS_KEYS.pipelineXuanjiDelta)).toBe(1);
    expect(getCount(OBS_KEYS.pipelineXuanjiDegraded)).toBe(1);
  });
});
