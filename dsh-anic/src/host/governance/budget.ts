/**
 * M5-a Budget — .cycles/ 目录大小预算与告警。
 *
 * 三级阈值：normal < warn < alert。
 * 只读不写，不自动清理（清理由 sweep/prune 显式调用）。
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BudgetThresholds {
  /** 告警阈值（字节），默认 500MB */
  warnBytes?: number;
  /** 严重阈值（字节），默认 2GB */
  alertBytes?: number;
}

export interface BudgetReport {
  totalBytes: number;
  fileCount: number;
  dirCount: number;
  status: 'normal' | 'warn' | 'alert';
  warnBytes: number;
  alertBytes: number;
  /** 大文件 Top 5（>1MB） */
  largestFiles: Array<{ path: string; bytes: number }>;
}

const DEFAULT_WARN = 500 * 1024 * 1024;
const DEFAULT_ALERT = 2 * 1024 * 1024 * 1024;

/** 递归计算目录大小 */
function dirSize(dir: string): { bytes: number; files: number; dirs: number; largest: Array<{ path: string; bytes: number }> } {
  let bytes = 0;
  let files = 0;
  let dirs = 0;
  const largest: Array<{ path: string; bytes: number }> = [];

  if (!existsSync(dir)) return { bytes, files, dirs, largest };

  const walk = (d: string): void => {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        dirs++;
        walk(full);
      } else if (e.isFile()) {
        const s = statSync(full);
        bytes += s.size;
        files++;
        if (s.size > 1024 * 1024) {
          largest.push({ path: full, bytes: s.size });
        }
      }
    }
  };

  walk(dir);
  largest.sort((a, b) => b.bytes - a.bytes);
  return { bytes, files, dirs, largest: largest.slice(0, 5) };
}

/** 检查 .cycles/ 预算 */
export function checkBudget(cyclesDir: string, thresholds: BudgetThresholds = {}): BudgetReport {
  const warnBytes = thresholds.warnBytes ?? DEFAULT_WARN;
  const alertBytes = thresholds.alertBytes ?? DEFAULT_ALERT;
  const { bytes, files, dirs, largest } = dirSize(cyclesDir);

  let status: BudgetReport['status'] = 'normal';
  if (bytes >= alertBytes) status = 'alert';
  else if (bytes >= warnBytes) status = 'warn';

  return {
    totalBytes: bytes,
    fileCount: files,
    dirCount: dirs,
    status,
    warnBytes,
    alertBytes,
    largestFiles: largest,
  };
}
