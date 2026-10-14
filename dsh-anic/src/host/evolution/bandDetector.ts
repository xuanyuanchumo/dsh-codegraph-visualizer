/**
 * 性能带检测（原生实现，替代技能 band-detector.mjs）。
 * 分析评估分数序列，检测性能退化带（normal/warn/alarm）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type BandStatus = 'normal' | 'warn' | 'alarm';

export interface BandEntry {
  cycle: number;
  score: number;
  timestamp: string;
  band: BandStatus;
}

export interface BandResult {
  current: BandStatus;
  trend: 'improving' | 'stable' | 'degrading';
  entries: BandEntry[];
  threshold: { warn: number; alarm: number };
}

const DEFAULT_THRESHOLDS = { warn: 0.7, alarm: 0.5 };
const BAND_HISTORY_PATH = join('.cycles', 'band-history.json');

export function classifyBand(score: number, thresholds = DEFAULT_THRESHOLDS): BandStatus {
  if (score >= thresholds.warn) return 'normal';
  if (score >= thresholds.alarm) return 'warn';
  return 'alarm';
}

export function detectTrend(scores: number[]): 'improving' | 'stable' | 'degrading' {
  if (scores.length < 2) return 'stable';
  const recent = scores.slice(-3);
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgPrev = scores.slice(0, -1).slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, scores.length - 1);
  const delta = avgRecent - avgPrev;
  if (delta > 0.05) return 'improving';
  if (delta < -0.05) return 'degrading';
  return 'stable';
}

export function runBandDetection(workspaceRoot: string, currentScore: number): BandResult {
  const historyPath = join(workspaceRoot, BAND_HISTORY_PATH);
  let entries: BandEntry[] = [];
  if (existsSync(historyPath)) {
    try { entries = JSON.parse(readFileSync(historyPath, 'utf-8')); } catch { entries = []; }
  }
  const band = classifyBand(currentScore);
  const entry: BandEntry = {
    cycle: entries.length + 1,
    score: currentScore,
    timestamp: new Date().toISOString(),
    band,
  };
  entries.push(entry);
  // 持久化（原子写简化版）
  try { writeFileSync(historyPath, JSON.stringify(entries, null, 2)); } catch { /* best effort */ }
  return {
    current: band,
    trend: detectTrend(entries.map((e) => e.score)),
    entries: entries.slice(-20),
    threshold: DEFAULT_THRESHOLDS,
  };
}

export function loadBandHistory(workspaceRoot: string): BandEntry[] {
  const p = join(workspaceRoot, BAND_HISTORY_PATH);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return []; }
}
