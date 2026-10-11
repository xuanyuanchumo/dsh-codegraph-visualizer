import { RUNTIME } from './constants.ts';
import type { LogEntry, LogLevel } from './Logger.ts';
import type { PerfMeasurement } from './PerformanceMonitor.ts';

/**
 * 运行时层快照（cycle-88，P2-1 三层独立面板）。
 *
 * ## 为什么是「快照纯函数」而不是组件里直接读单例
 *
 * 运行时层的数据源是两个**模块级单例**：`logger`（`src/shared/Logger.ts` 的
 * 环形缓冲，容量 `LOGGER.RING_SIZE = 200`）与 `performanceMonitor`
 * （`src/shared/PerformanceMonitor.ts` 的 `measurements` 数组，容量
 * `MAX_HISTORY = 100`）。两者都是「进程内可观测数据」，本身**没有时间窗口
 * 概念、也没有任何查询参数**——`getMeasurements(name?)` 只能按名字过滤。
 *
 * 验收原文要求的是「按时间窗口加载」且「单次时间窗口 ≤ 5 分钟或 1000 条」
 * （`docs/图谱按需加载.md:196-200`、`:265`）。这两个上限必须落在**某个**地方，
 * 而唯一能同时保证「可测」「不依赖 React 渲染时机」「不修改单例语义」的落点
 * 就是这里的纯函数：输入两个只读数组 + 当前时间，输出裁剪后的快照。
 *
 * ## 为什么窗口与条数是「交集」而不是「或」
 *
 * `docs/图谱按需加载.md:265` 写的是「≤ 5 分钟**或** 1000 条」，但实现上必须是
 * 先按窗口裁、再按条数截断（交集）。理由是风险 9（`:243-246`）：高频日志场景下
 * 只按时间窗口裁仍可能一次拿到几十万条，只按条数截又可能展示一小时前的陈数据。
 * 两个上限各自堵住一种爆炸路径，缺一个都不成立。因此本模块提供
 * `windowLogs()`（只裁窗口）与 `takeRecent()`（只截条数）两个可独立验证的
 * 步骤，再在 `buildRuntimeSnapshot()` 里组合——这样变异探针才能分别打穿它们。
 */

/** 运行时层单条日志的展示形态：只保留面板真正渲染的字段。 */
export interface RuntimeLogRow {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
}

/** 运行时层单个性能指标的聚合结果。 */
export interface RuntimeMetricRow {
  name: string;
  /** 窗口内的样本数 */
  count: number;
  /** 窗口内最近一次的耗时 */
  lastMs: number;
  /** 窗口内的平均耗时 */
  avgMs: number;
  /** 窗口内的最大耗时 */
  maxMs: number;
  /** 是否被判定为降级（`shouldDegrade` 的同义判定，基于阈值而非单例） */
  degraded: boolean;
}

/** 运行时层快照：面板渲染所需的全部数据。 */
export interface RuntimeSnapshot {
  /** 生成时刻（`now`），面板用它显示「截至 …」 */
  generatedAt: number;
  /** 生效的时间窗口长度（ms） */
  windowMs: number;
  /** 窗口左边界 = generatedAt - windowMs */
  cutoff: number;
  /** 窗口内、截断后的日志（时间升序，最新的在最后） */
  logs: RuntimeLogRow[];
  /** 窗口内的日志总数（截断前），用于显示「已折叠 N 条」 */
  totalLogs: number;
  /** 是否因 `MAX_ENTRIES` 发生截断 */
  truncated: boolean;
  /** 按级别统计（窗口内、截断前） */
  levelCounts: Record<LogLevel, number>;
  /** 窗口内的性能指标聚合，按样本数降序、同数按名字升序 */
  metrics: RuntimeMetricRow[];
  /** 窗口内的测量样本总数（截断前） */
  totalMeasurements: number;
}

/** 降级判定的阈值表：与 `PerformanceMonitor.DEFAULT_THRESHOLDS` 同形但由调用方注入。 */
export type RuntimeThresholds = ReadonlyMap<string, { degradeMs?: number }>;

const EMPTY_LEVEL_COUNTS = (): Record<LogLevel, number> => ({ debug: 0, info: 0, warn: 0, error: 0 });

/**
 * 只保留窗口内的日志（`ts >= cutoff`）。
 *
 * 刻意**不做条数截断**，也不排序：调用方给进来的 `logger.entries()` 已经是
 * 时间升序（环形缓冲按 push 顺序），这里保持顺序不变，只做过滤。分离出来是
 * 为了让「窗口」这条规则能被单独变异探针打穿（把 `>=` 改成 `true` 必须让
 * 某条用例变红）。
 */
export function windowLogs(entries: readonly LogEntry[], cutoff: number): RuntimeLogRow[] {
  const rows: RuntimeLogRow[] = [];
  for (const entry of entries) {
    if (entry.ts < cutoff) continue;
    rows.push({ ts: entry.ts, level: entry.level, scope: entry.scope, message: entry.message });
  }
  return rows;
}

/**
 * 保留最近的 `max` 条（取尾部），并报告是否发生截断。
 *
 * 保留**尾部**而不是头部：运行时排查看的是「刚刚发生了什么」，且日志本身是
 * 时间升序，尾部即最新。分离出来是为了让「条数上限」这条规则能被单独打穿
 * （把 `max` 改成 `Number.MAX_SAFE_INTEGER` 必须让某条用例变红）。
 */
export function takeRecent<T>(rows: readonly T[], max: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= max) return { rows: [...rows], truncated: false };
  return { rows: rows.slice(rows.length - max), truncated: true };
}

/** 按级别统计（对传入的完整集合计数，不是对截断后的集合）。 */
export function countByLevel(rows: readonly RuntimeLogRow[]): Record<LogLevel, number> {
  const counts = EMPTY_LEVEL_COUNTS();
  for (const row of rows) counts[row.level] += 1;
  return counts;
}

/**
 * 把测量样本聚合成按名字分组的指标行。
 *
 * 窗口裁剪在此处完成（`timestamp >= cutoff`），因为 `PerfMeasurement` 自带
 * `timestamp` 而 `getMeasurements()` 只能按名字过滤。聚合口径：
 * - `lastMs` 取窗口内时间戳最大的那条（不是数组最后一条——样本数组虽然按 push
 *   顺序，但窗口裁剪后「最后一个」与「最新」在时钟回拨时会分叉）；
 * - `avgMs` / `maxMs` 基于窗口内全部样本；
 * - `degraded` 只在调用方提供了该名字的 `degradeMs` 时才可能为 true，且用
 *   `avg >= degradeMs`（与 `shouldDegrade` 同口径，`src/shared/PerformanceMonitor.ts:107-112`）。
 *
 * 结果按 `count` 降序、同数按 `name` 升序，保证渲染稳定（无序会让每次渲染
 * 的行序抖动，测试也无法断言顺序）。
 */
export function aggregateMetrics(
  measurements: readonly PerfMeasurement[],
  cutoff: number,
  thresholds: RuntimeThresholds = new Map(),
  maxMetrics: number = RUNTIME.MAX_METRICS,
): { metrics: RuntimeMetricRow[]; totalMeasurements: number } {
  const inWindow = measurements.filter((m) => m.timestamp >= cutoff);
  const byName = new Map<string, PerfMeasurement[]>();
  for (const m of inWindow) {
    const list = byName.get(m.name);
    if (list) list.push(m);
    else byName.set(m.name, [m]);
  }
  const rows: RuntimeMetricRow[] = [];
  for (const [name, samples] of byName) {
    let sum = 0;
    let max = Number.NEGATIVE_INFINITY;
    let last = samples[0]!;
    for (const s of samples) {
      sum += s.durationMs;
      if (s.durationMs > max) max = s.durationMs;
      if (s.timestamp > last.timestamp) last = s;
    }
    const avgMs = sum / samples.length;
    const degradeMs = thresholds.get(name)?.degradeMs;
    rows.push({
      name,
      count: samples.length,
      lastMs: last.durationMs,
      avgMs,
      maxMs: max,
      degraded: degradeMs !== undefined && avgMs >= degradeMs,
    });
  }
  rows.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  return {
    metrics: rows.slice(0, maxMetrics),
    totalMeasurements: inWindow.length,
  };
}

/** `buildRuntimeSnapshot` 的可选参数。 */
export interface BuildRuntimeSnapshotOptions {
  /** 时间窗口长度（ms），默认 `RUNTIME.WINDOW_MS` */
  windowMs?: number;
  /** 单次日志条数上限，默认 `RUNTIME.MAX_ENTRIES` */
  maxEntries?: number;
  /** 单次指标条数上限，默认 `RUNTIME.MAX_METRICS` */
  maxMetrics?: number;
  /** 降级阈值表（按指标名） */
  thresholds?: RuntimeThresholds;
}

/**
 * 组合出运行时层快照。
 *
 * 顺序是契约的一部分：**先窗口、后条数**。反过来会先丢掉最老的日志、再发现
 * 它们本来就在窗口外，于是 `truncated` 会被错报为 true（用户看到「已折叠 N 条」
 * 却找不到那 N 条——它们本就不该出现）。`levelCounts` / `totalLogs` 刻意基于
 * **窗口内、截断前**的集合，这样「共 N 条，已折叠 M 条」两个数字能对上。
 */
export function buildRuntimeSnapshot(
  entries: readonly LogEntry[],
  measurements: readonly PerfMeasurement[],
  now: number,
  options: BuildRuntimeSnapshotOptions = {},
): RuntimeSnapshot {
  const windowMs = options.windowMs ?? RUNTIME.WINDOW_MS;
  const maxEntries = options.maxEntries ?? RUNTIME.MAX_ENTRIES;
  const maxMetrics = options.maxMetrics ?? RUNTIME.MAX_METRICS;
  const cutoff = now - windowMs;

  const inWindow = windowLogs(entries, cutoff);
  const { rows: logs, truncated } = takeRecent(inWindow, maxEntries);
  const { metrics, totalMeasurements } = aggregateMetrics(
    measurements,
    cutoff,
    options.thresholds,
    maxMetrics,
  );

  return {
    generatedAt: now,
    windowMs,
    cutoff,
    logs,
    totalLogs: inWindow.length,
    truncated,
    levelCounts: countByLevel(inWindow),
    metrics,
    totalMeasurements,
  };
}
