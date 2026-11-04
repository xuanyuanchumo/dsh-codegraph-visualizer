import { memo, useEffect, useMemo, useState } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import { logger } from '../../shared/Logger.ts';
import type { LogEntry, LogLevel } from '../../shared/Logger.ts';
import { getMeasurements, getThresholds } from '../../shared/PerformanceMonitor.ts';
import { snapshot as obsSnapshot, getAllPipelineTiming, PIPELINE_ORDER, PIPELINE_STAGE_LABELS } from '../../shared/observability.ts';
import { buildRuntimeSnapshot } from '../../shared/runtimeSnapshot.ts';
import type { RuntimeLogRow, RuntimeSnapshot } from '../../shared/runtimeSnapshot.ts';
import { RUNTIME } from '../../shared/constants.ts';

/**
 * 运行时层面板（cycle-88，P2-1 三层独立面板）。
 *
 * ## 这一层为什么存在
 *
 * `docs/图谱按需加载.md:196-200` 把图谱分成三层，第三层是
 * 「运行时层 | Trace、日志、性能排查 | 独立面板，按时间窗口、请求 ID、Trace ID 加载
 * | 单次时间窗口 ≤ 5 分钟或 1000 条」。`:202` 进一步规定「三层不要同时叠加到一张图。
 * 切换层时替换子图，而不是追加节点」。
 *
 * 本轮实现的是**该层在本仓库里能做到的部分**：数据源是插件进程内已有的可观测
 * 数据（`logger` 的环形缓冲 + `PerformanceMonitor` 的测量样本），预算由
 * `RUNTIME` 常量与 `buildRuntimeSnapshot()` 共同实施。**没有**实现 Trace ID /
 * 请求 ID 维度——全仓 `grep requestId|traceId` 只有 `requestIdleCallback`
 * 的命中，上游 `dsh-codegraph` 也没有任何 Trace 数据面，凭空造一个假的
 * TraceID 字段只会让「按 Trace ID 加载」变成永不执行的死分支。
 * 这一点在面板底部以 `runtime.noTraceId` 明示，不假装能力已完整。
 *
 * ## 为什么订阅 + 定时器都要有
 *
 * `logger.subscribe()` 只在**有新日志写入时**触发（`src/shared/Logger.ts` 的
 * `emit()`），所以纯订阅的面板在「安静期」不会重绘；而运行时层要展示的还有
 * 「随着时间流逝，窗口内的老数据被裁掉」这件事——它不产生任何日志。因此这里
 * 额外挂一个 `RUNTIME.REFRESH_MS` 定时器，让窗口边界持续前进。两者缺一都会
 * 出现「面板显示的数据已经不是窗口内应显示的数据」。
 *
 * `getMeasurements()` 无参返回全量副本、`getThresholds()` 返回只读内部 Map，
 * 两者都不触发 React 更新，所以定时器是它们唯一的刷新来源。
 */
interface RuntimePanelProps {
  onClose: () => void;
  label: string;
}

/** 面板自身的刷新周期：窗口裁剪需要随时间推进，而日志订阅不会因时间流逝而触发。 */
const REFRESH_MS = 5000;

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** 把时间戳格式化为 `HH:MM:SS`（本地时区，面板只关心时刻，不关心日期）。 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 耗时格式化：<1ms 显示小数，>=1s 显示秒，其余显示整数毫秒。 */
function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export const RuntimePanel = memo(function RuntimePanel({ onClose, label }: RuntimePanelProps) {
  const t = useT();
  // 用日志数组本身作为 state：`subscribe` 的回调参数就是当前 entries 快照，
  // 直接存它即可，不需要额外的时间戳计数器来触发重渲染。
  const [entries, setEntries] = useState<readonly LogEntry[]>(() => logger.entries());
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [tick, setTick] = useState(0);

  useEffect(() => logger.subscribe((next) => setEntries(next)), []);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // `tick` 刻意在依赖里：它不参与计算，但它代表「时间推进了」，必须让快照重算。
  const snapshot: RuntimeSnapshot = useMemo(
    () => buildRuntimeSnapshot(logger.entries(), getMeasurements(), Date.now(), {
      thresholds: getThresholds(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, tick],
  );

  const visibleLogs: RuntimeLogRow[] = levelFilter === 'all'
    ? snapshot.logs
    : snapshot.logs.filter((row) => row.level === levelFilter);

  const preview = visibleLogs.slice(-RUNTIME.PREVIEW_ENTRIES);
  const windowMinutes = Math.round(snapshot.windowMs / 60000);
  const hasData = snapshot.logs.length > 0 || snapshot.metrics.length > 0;

  return (
    <AnalysisPanelShell
      variant="runtime"
      label={label}
      onClose={onClose}
      badge={<span className="cg-runtime-count-badge">{snapshot.totalLogs}</span>}
    >
      <div className="cg-runtime-window" role="status">
        <span className="cg-runtime-window-label">{t('runtime.window')}</span>
        <span className="cg-runtime-window-value">{t('runtime.windowValue', { minutes: windowMinutes })}</span>
      </div>

      {!hasData ? (
        <div className="cg-runtime-empty">
          <div className="cg-runtime-empty-title">{t('runtime.empty')}</div>
          <div className="cg-runtime-empty-hint">{t('runtime.emptyHint')}</div>
        </div>
      ) : (
        <>
          <div className="cg-runtime-section-header">
            <span className="cg-runtime-section-title">{t('runtime.logsTitle')}</span>
            <span className="cg-runtime-level-counts">
              {LEVELS.map((level) => (
                <span key={level} className={`cg-runtime-level-count cg-${level}`}>
                  {t(`runtime.level.${level}`)} {snapshot.levelCounts[level]}
                </span>
              ))}
            </span>
          </div>

          <select
            className="cg-runtime-level-filter"
            id="cg-runtime-level"
            name="cg-runtime-level"
            value={levelFilter}
            aria-label={t('runtime.levelAll')}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
          >
            <option value="all">{t('runtime.levelAll')}</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>{t(`runtime.level.${level}`)}</option>
            ))}
          </select>

          {snapshot.truncated && (
            <div className="cg-runtime-truncated" role="status">
              {t('runtime.truncated', { total: snapshot.totalLogs, shown: snapshot.logs.length })}
            </div>
          )}

          {preview.length === 0 ? (
            <div className="cg-runtime-empty-line">{t('runtime.logsEmpty')}</div>
          ) : (
            <div className="cg-runtime-log-list">
              {preview.map((row, idx) => (
                <div key={`${row.ts}-${idx}`} className={`cg-runtime-log-row cg-${row.level}`}>
                  <span className="cg-runtime-log-time">{formatTime(row.ts)}</span>
                  <span className={`cg-runtime-log-level cg-${row.level}`}>{row.level}</span>
                  <span className="cg-runtime-log-scope">{row.scope}</span>
                  <span className="cg-runtime-log-message">{row.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cg-runtime-section-header">
            <span className="cg-runtime-section-title">{t('runtime.metricsTitle')}</span>
            <span className="cg-runtime-section-meta">
              {t('runtime.measurements', { n: snapshot.totalMeasurements })}
            </span>
          </div>

          {snapshot.metrics.length === 0 ? (
            <div className="cg-runtime-empty-line">{t('runtime.metricsEmpty')}</div>
          ) : (
            <div className="cg-runtime-metric-list">
              {snapshot.metrics.map((m) => (
                <div key={m.name} className="cg-runtime-metric-row">
                  <span className="cg-runtime-metric-name">{m.name}</span>
                  {m.degraded && <span className="cg-runtime-metric-degraded">{t('runtime.degraded')}</span>}
                  <span className="cg-runtime-metric-values">
                    <span title={t('runtime.metricAvg')}>{t('runtime.metricAvg')} {formatMs(m.avgMs)}</span>
                    <span title={t('runtime.metricMax')}>{t('runtime.metricMax')} {formatMs(m.maxMs)}</span>
                    <span title={t('runtime.metricLast')}>{t('runtime.metricLast')} {formatMs(m.lastMs)}</span>
                  </span>
                  <span className="cg-runtime-metric-count">{t('runtime.metricCount', { n: m.count })}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cg-runtime-footnote">{t('runtime.noTraceId')}</div>

          <ObservabilitySection obs={obsSnapshot()} timing={getAllPipelineTiming()} t={t} />
        </>
      )}
    </AnalysisPanelShell>
  );
});

/**
 * 白盒可观测性计数区（cycle-141 第二轮）。
 *
 * 展示缓存命中率、ETag 决策分布、AST 预算用量、管线阶段计数与耗时——
 * 这些是 PerformanceMonitor 度量不了的**计数**维度 + 管线**耗时**维度。
 */
function ObservabilitySection({ obs, timing, t }: { obs: Record<string, number>; timing: Record<string, { count: number; avgMs: number; maxMs: number; minMs: number; lastMs: number }>; t: (k: string, p?: Record<string, string | number>) => string }) {
  const entries = Object.entries(obs);
  const timingEntries = Object.entries(timing);
  if (entries.length === 0 && timingEntries.length === 0) return null;

  // 按分组组织：cache / etag / ast / pipeline
  const groups: Array<{ prefix: string; label: string; items: Array<[string, number]> }> = [
    { prefix: 'cache.', label: t('runtime.obsCache'), items: [] },
    { prefix: 'etag.', label: t('runtime.obsEtag'), items: [] },
    { prefix: 'ast.', label: t('runtime.obsAst'), items: [] },
    { prefix: 'pipeline.', label: t('runtime.obsPipeline'), items: [] },
  ];
  for (const [key, value] of entries) {
    for (const g of groups) {
      if (key.startsWith(g.prefix)) {
        g.items.push([key, value]);
        break;
      }
    }
  }
  const visibleGroups = groups.filter((g) => g.items.length > 0);

  // 管线耗时区：按 PIPELINE_ORDER 排列
  const visibleTiming = PIPELINE_ORDER
    .map((stage) => ({ stage, timing: timing[stage] }))
    .filter((e): e is { stage: (typeof PIPELINE_ORDER)[number]; timing: { count: number; avgMs: number; maxMs: number; minMs: number; lastMs: number } } => e.timing !== undefined && e.timing.count > 0);

  return (
    <div className="cg-runtime-obs-section">
      <div className="cg-runtime-section-header">
        <span className="cg-runtime-section-title">{t('runtime.obsTitle')}</span>
      </div>
      {visibleGroups.map((g) => (
        <div key={g.prefix} className="cg-runtime-obs-group">
          <div className="cg-runtime-obs-group-label">{g.label}</div>
          <div className="cg-runtime-obs-items">
            {g.items.map(([key, value]) => (
              <div key={key} className="cg-runtime-obs-item">
                <span className="cg-runtime-obs-key">{key}</span>
                <span className="cg-runtime-obs-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {visibleTiming.length > 0 && (
        <div className="cg-runtime-obs-group">
          <div className="cg-runtime-obs-group-label">{t('runtime.obsPipelineTiming')}</div>
          <div className="cg-runtime-obs-items">
            {visibleTiming.map(({ stage, timing: tm }) => (
              <div key={stage} className="cg-runtime-obs-item">
                <span className="cg-runtime-obs-key">{PIPELINE_STAGE_LABELS[stage] ?? stage}</span>
                <span className="cg-runtime-obs-value">
                  {tm.count}× avg {tm.avgMs.toFixed(0)}ms max {tm.maxMs.toFixed(0)}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
