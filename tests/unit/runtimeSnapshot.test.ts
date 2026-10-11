import { describe, it, expect } from 'vitest';
import {
  windowLogs,
  takeRecent,
  countByLevel,
  aggregateMetrics,
  buildRuntimeSnapshot,
} from '../../src/shared/runtimeSnapshot.ts';
import { RUNTIME } from '../../src/shared/constants.ts';
import type { LogEntry, LogLevel } from '../../src/shared/Logger.ts';
import type { PerfMeasurement } from '../../src/shared/PerformanceMonitor.ts';

/**
 * 运行时层快照的单元测试（cycle-88，P2-1）。
 *
 * 三条上限规则必须能**分别**被打穿，所以用例按 `windowLogs` / `takeRecent` /
 * `aggregateMetrics` 分开组织，而不是只测 `buildRuntimeSnapshot` 的组合结果：
 * 组合测试会让「窗口裁对了、条数没裁」与「条数裁对了、窗口没裁」看起来一样。
 */

const NOW = 1_700_000_000_000;

function makeEntry(ts: number, level: LogLevel = 'info', message = 'm', scope = 'test'): LogEntry {
  return { ts, level, scope, message };
}

function makeMeasurement(name: string, durationMs: number, timestamp: number): PerfMeasurement {
  return { name, durationMs, timestamp };
}

describe('windowLogs', () => {
  it('keeps entries at or after the cutoff', () => {
    const entries = [makeEntry(NOW - 1000), makeEntry(NOW), makeEntry(NOW + 1000)];
    expect(windowLogs(entries, NOW)).toHaveLength(2);
  });

  it('drops every entry older than the cutoff', () => {
    const entries = [makeEntry(NOW - 10_000), makeEntry(NOW - 5_000)];
    expect(windowLogs(entries, NOW)).toEqual([]);
  });

  it('includes an entry exactly on the boundary', () => {
    // 边界必须包含：否则「最近 5 分钟」会短一毫秒，且窗口与条数两条规则在
    // 边界上的行为不一致时很难解释。
    const entries = [makeEntry(NOW)];
    expect(windowLogs(entries, NOW)).toHaveLength(1);
  });

  it('projects only the fields the panel renders', () => {
    const entry: LogEntry = { ts: NOW, level: 'warn', scope: 'host', message: 'boom', data: { a: 1 } };
    expect(windowLogs([entry], NOW - 1)).toEqual([
      { ts: NOW, level: 'warn', scope: 'host', message: 'boom' },
    ]);
  });

  it('preserves input order and does not truncate', () => {
    // 窗口函数不做条数截断——截断是 takeRecent 的职责。混在一起会让
    // 「窗口裁对了、条数没裁」这一缺陷无法定位。
    const entries = [makeEntry(NOW - 3), makeEntry(NOW - 2), makeEntry(NOW - 1)];
    expect(windowLogs(entries, NOW - 10).map((r) => r.ts)).toEqual([NOW - 3, NOW - 2, NOW - 1]);
  });

  it('returns an empty array for empty input', () => {
    expect(windowLogs([], NOW)).toEqual([]);
  });
});

describe('takeRecent', () => {
  it('returns everything when under the limit', () => {
    const result = takeRecent([1, 2, 3], 5);
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it('keeps the newest entries (the tail) when over the limit', () => {
    // 保留尾部而不是头部：日志是时间升序，运行时排查看的是「刚刚发生了什么」。
    // 变异探针把 slice(-max) 改成 slice(0, max) 必须让这条变红。
    const result = takeRecent([1, 2, 3, 4, 5], 2);
    expect(result.rows).toEqual([4, 5]);
    expect(result.truncated).toBe(true);
  });

  it('treats exactly-at-limit as not truncated', () => {
    const result = takeRecent([1, 2, 3], 3);
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    takeRecent(input, 1);
    expect(input).toEqual([1, 2, 3]);
  });

  it('returns a copy even when nothing is truncated', () => {
    const input = [1, 2];
    const result = takeRecent(input, 5);
    expect(result.rows).not.toBe(input);
  });
});

describe('countByLevel', () => {
  it('counts each level independently', () => {
    const rows = windowLogs(
      [
        makeEntry(NOW, 'debug'),
        makeEntry(NOW, 'info'),
        makeEntry(NOW, 'info'),
        makeEntry(NOW, 'warn'),
        makeEntry(NOW, 'error'),
      ],
      NOW - 1,
    );
    expect(countByLevel(rows)).toEqual({ debug: 1, info: 2, warn: 1, error: 1 });
  });

  it('returns all four keys as zero for an empty set', () => {
    // 面板要渲染四个级别计数，缺键会渲染出 undefined。
    expect(countByLevel([])).toEqual({ debug: 0, info: 0, warn: 0, error: 0 });
  });
});

describe('aggregateMetrics', () => {
  it('groups samples by name', () => {
    const { metrics } = aggregateMetrics(
      [makeMeasurement('layout', 10, NOW), makeMeasurement('layout', 20, NOW), makeMeasurement('cluster', 5, NOW)],
      NOW - 1,
    );
    const layout = metrics.find((m) => m.name === 'layout');
    expect(layout?.count).toBe(2);
    expect(metrics.find((m) => m.name === 'cluster')?.count).toBe(1);
  });

  it('drops samples outside the window', () => {
    const { metrics, totalMeasurements } = aggregateMetrics(
      [makeMeasurement('layout', 10, NOW - 10_000), makeMeasurement('layout', 20, NOW)],
      NOW,
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.count).toBe(1);
    expect(totalMeasurements).toBe(1);
  });

  it('computes avg and max from the in-window samples only', () => {
    // 若用全量历史算平均，就会出现「窗口内平均 12ms 却标着降级」——
    // 老样本把平均值抬上去了。
    const { metrics } = aggregateMetrics(
      [
        makeMeasurement('layout', 1000, NOW - 10_000),
        makeMeasurement('layout', 10, NOW - 1),
        makeMeasurement('layout', 30, NOW),
      ],
      NOW - 100,
    );
    expect(metrics[0]!.avgMs).toBe(20);
    expect(metrics[0]!.maxMs).toBe(30);
  });

  it('takes lastMs from the largest timestamp, not the last array element', () => {
    // 时钟回拨或样本被重排时，数组顺序不等于时间顺序。
    const { metrics } = aggregateMetrics(
      [makeMeasurement('layout', 99, NOW), makeMeasurement('layout', 11, NOW - 5)],
      NOW - 100,
    );
    expect(metrics[0]!.lastMs).toBe(99);
  });

  it('marks degraded when the windowed average reaches the threshold', () => {
    const thresholds = new Map([['layout', { degradeMs: 20 }]]);
    const { metrics } = aggregateMetrics(
      [makeMeasurement('layout', 20, NOW), makeMeasurement('layout', 20, NOW)],
      NOW - 1,
      thresholds,
    );
    expect(metrics[0]!.degraded).toBe(true);
  });

  it('does not mark degraded below the threshold', () => {
    const thresholds = new Map([['layout', { degradeMs: 21 }]]);
    const { metrics } = aggregateMetrics([makeMeasurement('layout', 20, NOW)], NOW - 1, thresholds);
    expect(metrics[0]!.degraded).toBe(false);
  });

  it('never marks degraded when no threshold is registered for the name', () => {
    // 没有阈值的指标不能被标成降级：那是无依据的告警。
    const { metrics } = aggregateMetrics([makeMeasurement('unknown', 999_999, NOW)], NOW - 1);
    expect(metrics[0]!.degraded).toBe(false);
  });

  it('sorts by count desc then name asc', () => {
    // 行序不稳定会让每次渲染抖动，测试也无法断言顺序。
    const { metrics } = aggregateMetrics(
      [
        makeMeasurement('zeta', 1, NOW),
        makeMeasurement('alpha', 1, NOW),
        makeMeasurement('beta', 1, NOW),
        makeMeasurement('beta', 1, NOW),
      ],
      NOW - 1,
    );
    expect(metrics.map((m) => m.name)).toEqual(['beta', 'alpha', 'zeta']);
  });

  it('caps the number of metric rows at maxMetrics', () => {
    const samples = ['a', 'b', 'c', 'd'].map((name) => makeMeasurement(name, 1, NOW));
    const { metrics, totalMeasurements } = aggregateMetrics(samples, NOW - 1, new Map(), 2);
    expect(metrics).toHaveLength(2);
    // 被裁掉的指标仍要计入样本总数，否则「N 个样本」与列表行数对不上。
    expect(totalMeasurements).toBe(4);
  });

  it('returns an empty list for no measurements', () => {
    expect(aggregateMetrics([], NOW)).toEqual({ metrics: [], totalMeasurements: 0 });
  });
});

describe('buildRuntimeSnapshot', () => {
  it('applies the default window and entry limits from RUNTIME', () => {
    const snapshot = buildRuntimeSnapshot([], [], NOW);
    expect(snapshot.windowMs).toBe(RUNTIME.WINDOW_MS);
    expect(snapshot.cutoff).toBe(NOW - RUNTIME.WINDOW_MS);
    expect(snapshot.generatedAt).toBe(NOW);
  });

  it('cuts the window BEFORE truncating by count', () => {
    // 顺序是契约：反过来会先丢掉最老的日志、再发现它们本就在窗口外，
    // 于是 truncated 被错报为 true，用户看到「已折叠 N 条」却找不到那 N 条。
    const entries = [
      makeEntry(NOW - 10_000_000),
      makeEntry(NOW - 10_000_000),
      makeEntry(NOW - 1),
    ];
    const snapshot = buildRuntimeSnapshot(entries, [], NOW, { maxEntries: 1 });
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.totalLogs).toBe(1);
  });

  it('reports truncated with totalLogs counted before truncation', () => {
    const entries = [makeEntry(NOW - 3), makeEntry(NOW - 2), makeEntry(NOW - 1)];
    const snapshot = buildRuntimeSnapshot(entries, [], NOW, { maxEntries: 2 });
    expect(snapshot.truncated).toBe(true);
    // 「共 N 条，已折叠为最近 M 条」的两个数字必须分别来自截断前与截断后。
    expect(snapshot.totalLogs).toBe(3);
    expect(snapshot.logs).toHaveLength(2);
    expect(snapshot.logs.map((r) => r.ts)).toEqual([NOW - 2, NOW - 1]);
  });

  it('counts levels over the whole in-window set, not the truncated slice', () => {
    // 级别计数若基于截断后的集合，面板会出现「四个计数加起来 ≠ 共 N 条」。
    const entries = [
      makeEntry(NOW - 3, 'debug'),
      makeEntry(NOW - 2, 'error'),
      makeEntry(NOW - 1, 'error'),
    ];
    const snapshot = buildRuntimeSnapshot(entries, [], NOW, { maxEntries: 1 });
    expect(snapshot.levelCounts).toEqual({ debug: 1, info: 0, warn: 0, error: 2 });
  });

  it('excludes out-of-window logs from every derived number', () => {
    const entries = [makeEntry(NOW - RUNTIME.WINDOW_MS - 1), makeEntry(NOW)];
    const snapshot = buildRuntimeSnapshot(entries, [], NOW);
    expect(snapshot.totalLogs).toBe(1);
    expect(snapshot.levelCounts.info).toBe(1);
  });

  it('honours an explicit window override', () => {
    const entries = [makeEntry(NOW - 5000), makeEntry(NOW)];
    const snapshot = buildRuntimeSnapshot(entries, [], NOW, { windowMs: 1000 });
    expect(snapshot.windowMs).toBe(1000);
    expect(snapshot.logs).toHaveLength(1);
  });

  it('passes thresholds through to the metric aggregation', () => {
    const snapshot = buildRuntimeSnapshot(
      [],
      [makeMeasurement('layout', 100, NOW)],
      NOW,
      { thresholds: new Map([['layout', { degradeMs: 50 }]]) },
    );
    expect(snapshot.metrics[0]!.degraded).toBe(true);
  });

  it('reports an empty but well-formed snapshot when there is nothing to show', () => {
    // 面板在「窗口内没有数据」时必须仍能渲染四个级别计数与空列表，
    // 而不是崩溃或显示 undefined。
    const snapshot = buildRuntimeSnapshot([], [], NOW);
    expect(snapshot.logs).toEqual([]);
    expect(snapshot.metrics).toEqual([]);
    expect(snapshot.totalLogs).toBe(0);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.levelCounts).toEqual({ debug: 0, info: 0, warn: 0, error: 0 });
  });
});
