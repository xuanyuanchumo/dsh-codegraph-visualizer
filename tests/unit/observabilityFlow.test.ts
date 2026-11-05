/**
 * 可观测性流动数据构建器测试（cycle-142 T4）。
 *
 * 钉死四类升维数学：管线占比归一、缓存命中率判零、ETag 分布、AST 用量。
 * 全部走纯函数，不挂载组件。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildObservabilityFlow } from '../../src/shared/observabilityFlow.ts';
import { reset as resetObs, startPipelineTiming, endPipelineTiming } from '../../src/shared/observability.ts';

/** 便捷构造计数表。 */
function counts(pairs: Record<string, number>): Record<string, number> {
  return { ...pairs };
}

describe('buildObservabilityFlow / pipeline segments', () => {
  beforeEach(() => resetObs());

  it('returns empty flow when there is no data at all', () => {
    const flow = buildObservabilityFlow({ counts: {}, timing: {} });
    expect(flow.empty).toBe(true);
    expect(flow.pipeline).toEqual([]);
    expect(flow.cache).toEqual([]);
    expect(flow.etag).toEqual([]);
    expect(flow.ast).toBeNull();
  });

  it('emits segments only for stages with samples, in PIPELINE_ORDER (data-flow direction)', () => {
    const flow = buildObservabilityFlow({
      counts: {},
      timing: {
        dbRead: { count: 2, avgMs: 30, maxMs: 40, minMs: 20, lastMs: 20 },
        scan: { count: 1, avgMs: 10, maxMs: 10, minMs: 10, lastMs: 10 },
        merge: { count: 0, avgMs: 0, maxMs: 0, minMs: 0, lastMs: 0 },
      },
    });
    expect(flow.pipeline.map((s) => s.stage)).toEqual(['scan', 'dbRead']);
  });

  it('widthPct sums to 100 and leftPct is cumulative', () => {
    const flow = buildObservabilityFlow({
      counts: {},
      timing: {
        scan: { count: 1, avgMs: 25, maxMs: 25, minMs: 25, lastMs: 25 },
        dbRead: { count: 1, avgMs: 75, maxMs: 75, minMs: 75, lastMs: 75 },
      },
    });
    const [scan, dbRead] = flow.pipeline;
    expect(scan!.widthPct).toBe(25);
    expect(dbRead!.widthPct).toBe(75);
    expect(scan!.leftPct).toBe(0);
    expect(dbRead!.leftPct).toBe(25);
    const total = flow.pipeline.reduce((a, s) => a + s.widthPct, 0);
    expect(Math.round(total)).toBe(100);
  });

  it('all stages zero avgMs → widthPct 0, not NaN', () => {
    const flow = buildObservabilityFlow({
      counts: {},
      timing: {
        scan: { count: 3, avgMs: 0, maxMs: 0, minMs: 0, lastMs: 0 },
      },
    });
    expect(flow.pipeline).toHaveLength(1);
    expect(flow.pipeline[0]!.widthPct).toBe(0);
    expect(Number.isNaN(flow.pipeline[0]!.widthPct)).toBe(false);
  });

  it('reads real samples produced by start/endPipelineTiming (round-trip through the counter module)', () => {
    const end = startPipelineTiming('scan');
    endPipelineTiming('scan'); // 直接结束拿样本（0-1ms）
    end();
    const timing = { scan: { count: 2, avgMs: 1, maxMs: 2, minMs: 0, lastMs: 1 } };
    const flow = buildObservabilityFlow({ counts: {}, timing });
    expect(flow.pipeline).toHaveLength(1);
    expect(flow.pipeline[0]!.count).toBe(2);
  });
});

describe('buildObservabilityFlow / cache hit rate', () => {
  beforeEach(() => resetObs());

  it('computes hit/(hit+miss) per cache and drops empty caches', () => {
    const flow = buildObservabilityFlow({
      counts: counts({
        'cache.scan.hit': 3,
        'cache.scan.miss': 1,
        'cache.diagram.hit': 0,
        'cache.diagram.miss': 2,
      }),
      timing: {},
    });
    expect(flow.cache.map((r) => r.cache)).toEqual(['scan', 'diagram']);
    expect(flow.cache[0]!.ratio).toBe(0.75);
    expect(flow.cache[1]!.ratio).toBe(0);
    // cluster 未出现 → 不在列表
    expect(flow.cache.some((r) => r.cache === 'cluster')).toBe(false);
  });

  it('hit and miss both zero → row dropped (no fabricated 100%)', () => {
    const flow = buildObservabilityFlow({ counts: { 'cache.cluster.hit': 0 }, timing: {} });
    expect(flow.cache).toEqual([]);
  });
});

describe('buildObservabilityFlow / etag decisions', () => {
  beforeEach(() => resetObs());

  it('distributes 200/304/rejected over the total', () => {
    const flow = buildObservabilityFlow({
      counts: counts({ 'etag.200': 6, 'etag.304': 3, 'etag.rejected': 1 }),
      timing: {},
    });
    expect(flow.etag.map((r) => r.decision)).toEqual(['200', '304', 'rejected']);
    expect(flow.etag[0]!.pct).toBe(60);
    expect(flow.etag[1]!.pct).toBe(30);
    expect(flow.etag[2]!.pct).toBe(10);
  });

  it('zero total → single zero-count rows carry pct null', () => {
    const flow = buildObservabilityFlow({ counts: { 'etag.304': 0 }, timing: {} });
    expect(flow.etag).toEqual([]);
  });

  it('partial decisions keep order (200 then 304)', () => {
    const flow = buildObservabilityFlow({ counts: counts({ 'etag.304': 2 }), timing: {} });
    expect(flow.etag).toHaveLength(1);
    expect(flow.etag[0]!.decision).toBe('304');
    expect(flow.etag[0]!.pct).toBe(100);
  });
});

describe('buildObservabilityFlow / ast budget', () => {
  beforeEach(() => resetObs());

  it('null when no AST activity', () => {
    expect(buildObservabilityFlow({ counts: {}, timing: {} }).ast).toBeNull();
  });

  it('usage = returned/requested with truncation counters', () => {
    const flow = buildObservabilityFlow({
      counts: counts({ 'ast.requested': 200, 'ast.returned': 150, 'ast.truncated': 2, 'ast.hasMore': 1 }),
      timing: {},
    });
    expect(flow.ast).not.toBeNull();
    expect(flow.ast!.usage).toBe(0.75);
    expect(flow.ast!.truncated).toBe(2);
  });

  it('requested 0 but truncated > 0 → still rendered, usage null (not 0)', () => {
    const flow = buildObservabilityFlow({ counts: counts({ 'ast.truncated': 1 }), timing: {} });
    expect(flow.ast).not.toBeNull();
    expect(flow.ast!.usage).toBeNull();
  });
});

describe('buildObservabilityFlow / determinism', () => {
  beforeEach(() => resetObs());

  it('same input → byte-identical snapshot (clampPct kills float tails)', () => {
    const input = {
      counts: counts({ 'etag.200': 1, 'etag.304': 1, 'etag.rejected': 1 }),
      timing: {
        scan: { count: 1, avgMs: 1 / 3, maxMs: 1, minMs: 0, lastMs: 1 },
        merge: { count: 1, avgMs: 1 / 3, maxMs: 1, minMs: 0, lastMs: 1 },
        dbRead: { count: 1, avgMs: 1 / 3, maxMs: 1, minMs: 0, lastMs: 1 },
      },
    };
    const a = JSON.stringify(buildObservabilityFlow(input));
    const b = JSON.stringify(buildObservabilityFlow(input));
    expect(a).toBe(b);
    // 三等分各 33.33 + 尾差 → 合计 100 或 99.99，绝无 NaN/Infinity
    expect(a).not.toContain('NaN');
    expect(a).not.toContain('Infinity');
  });
});
