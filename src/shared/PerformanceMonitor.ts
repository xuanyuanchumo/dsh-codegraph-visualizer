import { scoped } from './Logger.ts';
import { PERF } from './constants.ts';

const log = scoped('perf');

export interface PerfMeasurement {
  name: string;
  durationMs: number;
  timestamp: number;
}

export interface PerfThreshold {
  warnMs?: number;
  degradeMs?: number;
  degradationKey?: string;
}

const MAX_HISTORY = 100;
const measurements: PerfMeasurement[] = [];
const thresholds: Map<string, PerfThreshold> = new Map();
const pendingMarks: Map<string, number> = new Map();

const DEFAULT_THRESHOLDS: Record<string, PerfThreshold> = {
  'cluster': { warnMs: PERF.CLUSTER_WARN_MS, degradeMs: PERF.CLUSTER_DEGRADE_MS, degradationKey: 'slow-clustering' },
  'layout': { warnMs: PERF.LAYOUT_WARN_MS, degradeMs: PERF.LAYOUT_DEGRADE_MS, degradationKey: 'slow-layout' },
  'render': { warnMs: PERF.RENDER_WARN_MS, degradeMs: PERF.RENDER_DEGRADE_MS, degradationKey: 'slow-render' },
  'diagram': { warnMs: PERF.DIAGRAM_WARN_MS, degradeMs: PERF.DIAGRAM_DEGRADE_MS, degradationKey: 'slow-diagram' },
  'ast-fetch': { warnMs: PERF.AST_FETCH_WARN_MS, degradeMs: PERF.AST_FETCH_DEGRADE_MS, degradationKey: 'slow-ast-fetch' },
};

for (const [name, threshold] of Object.entries(DEFAULT_THRESHOLDS)) {
  thresholds.set(name, threshold);
}

export function setThreshold(name: string, threshold: PerfThreshold): void {
  thresholds.set(name, threshold);
}

export function startMeasure(name: string): void {
  pendingMarks.set(name, performance.now());
}

export function endMeasure(name: string): number | null {
  const start = pendingMarks.get(name);
  if (start === undefined) return null;
  pendingMarks.delete(name);
  const durationMs = performance.now() - start;
  recordMeasurement(name, durationMs);
  return durationMs;
}

export function measureSync<T>(name: string, fn: () => T): T {
  startMeasure(name);
  try {
    const result = fn();
    endMeasure(name);
    return result;
  } catch (e) {
    pendingMarks.delete(name);
    throw e;
  }
}

export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  startMeasure(name);
  try {
    const result = await fn();
    endMeasure(name);
    return result;
  } catch (e) {
    pendingMarks.delete(name);
    throw e;
  }
}

function recordMeasurement(name: string, durationMs: number): void {
  const measurement: PerfMeasurement = { name, durationMs, timestamp: Date.now() };
  measurements.push(measurement);
  if (measurements.length > MAX_HISTORY) measurements.shift();

  const threshold = thresholds.get(name);
  if (threshold) {
    if (threshold.degradeMs !== undefined && durationMs >= threshold.degradeMs && threshold.degradationKey) {
      log.warn(`${name} exceeded degrade threshold: ${durationMs.toFixed(1)}ms >= ${threshold.degradeMs}ms`);
    } else if (threshold.warnMs !== undefined && durationMs >= threshold.warnMs) {
      log.info(`${name} exceeded warn threshold: ${durationMs.toFixed(1)}ms >= ${threshold.warnMs}ms`);
    }
  }
}

export function getMeasurements(name?: string): PerfMeasurement[] {
  if (name) return measurements.filter((m) => m.name === name);
  return [...measurements];
}

export function getAverageDuration(name: string): number {
  const filtered = measurements.filter((m) => m.name === name);
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, m) => sum + m.durationMs, 0) / filtered.length;
}

export function clearMeasurements(): void {
  measurements.length = 0;
  pendingMarks.clear();
}

export function shouldDegrade(name: string): boolean {
  const threshold = thresholds.get(name);
  if (!threshold || threshold.degradeMs === undefined) return false;
  const avg = getAverageDuration(name);
  return avg >= threshold.degradeMs;
}
const baselines: Map<string, number> = new Map();

export function setBaseline(name: string, durationMs: number): void {
  baselines.set(name, durationMs);
}

export function getBaseline(name: string): number | undefined {
  return baselines.get(name);
}

export function isDegradedFromBaseline(name: string, ratio: number = 1.5): boolean {
  const baseline = baselines.get(name);
  if (baseline === undefined) return false;
  const avg = getAverageDuration(name);
  return avg > baseline * ratio;
}

export function getDegradationReport(): Array<{ name: string; baseline: number; current: number; ratio: number }> {
  const report: Array<{ name: string; baseline: number; current: number; ratio: number }> = [];
  for (const [name, baseline] of baselines) {
    const current = getAverageDuration(name);
    if (current > 0) {
      report.push({ name, baseline, current, ratio: current / baseline });
    }
  }
  return report;
}