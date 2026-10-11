import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startMeasure,
  endMeasure,
  measureSync,
  measureAsync,
  setThreshold,
  getMeasurements,
  getAverageDuration,
  clearMeasurements,
  shouldDegrade,
  setBaseline,
  getBaseline,
  isDegradedFromBaseline,
  getDegradationReport,
  type PerfThreshold,
} from '../../src/shared/PerformanceMonitor.ts';
import { logger } from '../../src/shared/Logger.ts';

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    clearMeasurements();
  });

  describe('startMeasure / endMeasure', () => {
    it('records a measurement between start and end', () => {
      startMeasure('test-op');
      const result = endMeasure('test-op');
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThanOrEqual(0);
      const measurements = getMeasurements('test-op');
      expect(measurements).toHaveLength(1);
      expect(measurements[0]!.name).toBe('test-op');
      expect(measurements[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns null when endMeasure is called without a matching start', () => {
      expect(endMeasure('nonexistent')).toBeNull();
    });

    it('records multiple measurements with the same name', () => {
      startMeasure('repeat-op');
      endMeasure('repeat-op');
      startMeasure('repeat-op');
      endMeasure('repeat-op');
      const measurements = getMeasurements('repeat-op');
      expect(measurements).toHaveLength(2);
    });
  });

  describe('measureSync', () => {
    it('measures a synchronous function execution time', () => {
      const result = measureSync('sync-op', () => 42);
      expect(result).toBe(42);
      const measurements = getMeasurements('sync-op');
      expect(measurements).toHaveLength(1);
      expect(measurements[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('propagates exceptions and cleans up pending mark', () => {
      expect(() => measureSync('failing-op', () => { throw new Error('boom'); })).toThrow('boom');
      expect(endMeasure('failing-op')).toBeNull();
    });
  });

  describe('measureAsync', () => {
    it('measures an asynchronous function execution time', async () => {
      const result = await measureAsync('async-op', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'done';
      });
      expect(result).toBe('done');
      const measurements = getMeasurements('async-op');
      expect(measurements).toHaveLength(1);
      expect(measurements[0]!.durationMs).toBeGreaterThanOrEqual(5);
    });

    it('propagates async exceptions and cleans up pending mark', async () => {
      await expect(measureAsync('failing-async', async () => { throw new Error('async boom'); })).rejects.toThrow('async boom');
      expect(endMeasure('failing-async')).toBeNull();
    });
  });

  describe('getMeasurements', () => {
    it('returns all measurements when no name filter is provided', () => {
      startMeasure('op-a');
      endMeasure('op-a');
      startMeasure('op-b');
      endMeasure('op-b');
      const all = getMeasurements();
      expect(all).toHaveLength(2);
    });

    it('returns filtered measurements when name is provided', () => {
      startMeasure('op-a');
      endMeasure('op-a');
      startMeasure('op-b');
      endMeasure('op-b');
      const filtered = getMeasurements('op-a');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('op-a');
    });

    it('returns empty array for unknown name', () => {
      expect(getMeasurements('unknown')).toHaveLength(0);
    });
  });

  describe('getAverageDuration', () => {
    it('returns 0 for measurements with no entries', () => {
      expect(getAverageDuration('nonexistent')).toBe(0);
    });

    it('returns average of multiple measurements', () => {
      startMeasure('avg-op');
      endMeasure('avg-op');
      startMeasure('avg-op');
      endMeasure('avg-op');
      const avg = getAverageDuration('avg-op');
      expect(avg).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clearMeasurements', () => {
    it('clears all recorded measurements', () => {
      startMeasure('op');
      endMeasure('op');
      expect(getMeasurements()).toHaveLength(1);
      clearMeasurements();
      expect(getMeasurements()).toHaveLength(0);
    });

    it('clears pending marks', () => {
      startMeasure('pending-op');
      clearMeasurements();
      expect(endMeasure('pending-op')).toBeNull();
    });
  });

  describe('setThreshold and shouldDegrade', () => {
    it('shouldDegrade returns false when no threshold is set', () => {
      expect(shouldDegrade('no-threshold')).toBe(false);
    });

    it('shouldDegrade returns false when average is below degrade threshold', () => {
      setThreshold('fast-op', { degradeMs: 1000 });
      startMeasure('fast-op');
      endMeasure('fast-op');
      expect(shouldDegrade('fast-op')).toBe(false);
    });

    it('shouldDegrade returns true when average exceeds degrade threshold', () => {
      setThreshold('slow-op', { degradeMs: 0 });
      startMeasure('slow-op');
      endMeasure('slow-op');
      expect(shouldDegrade('slow-op')).toBe(true);
    });

    it('shouldDegrade returns false when degradeMs is not set', () => {
      setThreshold('warn-only', { warnMs: 100 });
      startMeasure('warn-only');
      endMeasure('warn-only');
      expect(shouldDegrade('warn-only')).toBe(false);
    });
  });

  describe('default thresholds', () => {
    it('has default threshold for cluster operations', () => {
      expect(shouldDegrade('cluster')).toBe(false);
    });

    it('has default threshold for layout operations', () => {
      expect(shouldDegrade('layout')).toBe(false);
    });

    it('has default threshold for render operations', () => {
      expect(shouldDegrade('render')).toBe(false);
    });

    it('has default threshold for diagram operations', () => {
      expect(shouldDegrade('diagram')).toBe(false);
    });

    it('has default threshold for ast-fetch operations', () => {
      expect(shouldDegrade('ast-fetch')).toBe(false);
    });
  });

  describe('history limit', () => {
    it('keeps at most 100 measurements', () => {
      for (let i = 0; i < 150; i++) {
        startMeasure('bulk-op');
        endMeasure('bulk-op');
      }
      const all = getMeasurements();
      expect(all.length).toBeLessThanOrEqual(100);
    });
  });

  describe('baseline comparison', () => {
    it('setBaseline / getBaseline round-trip', () => {
      setBaseline('op', 50);
      expect(getBaseline('op')).toBe(50);
    });

    it('getBaseline returns undefined for unknown name', () => {
      expect(getBaseline('unknown')).toBeUndefined();
    });

    it('isDegradedFromBaseline returns false when no baseline set', () => {
      expect(isDegradedFromBaseline('no-baseline')).toBe(false);
    });

    it('isDegradedFromBaseline returns false when current is within ratio', () => {
      setBaseline('op', 100);
      measureSync('op', () => {});
      expect(isDegradedFromBaseline('op', 1.5)).toBe(false);
    });

    it('isDegradedFromBaseline returns true when current exceeds ratio', () => {
      setBaseline('op', 10);
      for (let i = 0; i < 5; i++) {
        startMeasure('op');
        endMeasure('op');
      }
      const avg = getAverageDuration('op');
      setBaseline('op', avg / 2);
      expect(isDegradedFromBaseline('op', 1.5)).toBe(true);
    });

    it('getDegradationReport returns empty array when no baselines', () => {
      expect(getDegradationReport()).toEqual([]);
    });

    it('getDegradationReport returns entries for baselines with measurements', () => {
      setBaseline('op', 50);
      measureSync('op', () => {});
      const report = getDegradationReport();
      expect(report.length).toBe(1);
      expect(report[0]!.name).toBe('op');
      expect(report[0]!.baseline).toBe(50);
    });
  });

  // recordMeasurement() logs only when a threshold is configured AND the recorded
  // duration reaches it. Durations are fed through the real timing path (a
  // synchronous busy-wait), never by stubbing performance.now(), so the
  // assertions bind to the source's actual threshold comparison.
  describe('threshold logging in recordMeasurement', () => {
    function busyWait(ms: number): void {
      const until = performance.now() + ms;
      while (performance.now() < until) { /* spin */ }
    }

    function clearLogBuffer(): void {
      logger.clear();
    }

    it('logs a warning when a measurement reaches the degrade threshold', () => {
      setThreshold('sa2-degrade', { warnMs: 1, degradeMs: 5, degradationKey: 'slow-sa2' });
      clearLogBuffer();
      measureSync('sa2-degrade', () => busyWait(10));

      const warnings = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'perf');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some((e) => e.message.includes('exceeded degrade threshold'))).toBe(true);
    });

    it('logs info when a measurement reaches only the warn threshold', () => {
      setThreshold('sa2-warn', { warnMs: 1, degradeMs: 60_000 });
      clearLogBuffer();
      measureSync('sa2-warn', () => busyWait(5));

      const infos = logger.entries().filter((e) => e.level === 'info' && e.scope === 'perf');
      expect(infos.length).toBeGreaterThanOrEqual(1);
      expect(infos.some((e) => e.message.includes('exceeded warn threshold'))).toBe(true);
      const warnings = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'perf');
      expect(warnings.some((e) => e.message.includes('exceeded degrade threshold'))).toBe(false);
    });

    it('logs nothing when a measurement stays below both thresholds', () => {
      setThreshold('sa2-quiet', { warnMs: 60_000, degradeMs: 120_000 });
      clearLogBuffer();
      measureSync('sa2-quiet', () => busyWait(1));

      const perf = logger.entries().filter((e) => e.scope === 'perf');
      expect(perf).toEqual([]);
    });

    it('does not log a degrade warning when the threshold has no degradationKey', () => {
      setThreshold('sa2-nokey', { warnMs: 1, degradeMs: 5 });
      clearLogBuffer();
      measureSync('sa2-nokey', () => busyWait(10));

      const warnings = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'perf');
      expect(warnings.some((e) => e.message.includes('exceeded degrade threshold'))).toBe(false);
      const infos = logger.entries().filter((e) => e.level === 'info' && e.scope === 'perf');
      expect(infos.some((e) => e.message.includes('exceeded warn threshold'))).toBe(true);
    });

    it('records the measurement regardless of whether logging triggers', () => {
      setThreshold('sa2-record', { warnMs: 60_000, degradeMs: 120_000 });
      measureSync('sa2-record', () => busyWait(1));
      expect(getMeasurements('sa2-record')).toHaveLength(1);
    });
  });
});