/**
 * M5-a Prune — 识别孤儿工件（账本条目引用不存在的 cycle 目录）。
 *
 * 只识别不删除（删除由 Archiver 显式执行）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PruneReport {
  /** 账本条目引用的 cycle 不存在 */
  orphanedLedgerEntries: Array<{ index: number; detail: string }>;
  /** cycle 目录无对应账本条目 */
  orphanedCycleDirs: string[];
  /** 空目录 */
  emptyDirs: string[];
}

/** 识别孤儿工件 */
export function pruneCheck(cyclesDir: string): PruneReport {
  const report: PruneReport = {
    orphanedLedgerEntries: [],
    orphanedCycleDirs: [],
    emptyDirs: [],
  };

  if (!existsSync(cyclesDir)) return report;

  // 收集所有 cycle-N 目录
  const cycleDirs = new Set<string>();
  const allDirs: string[] = [];
  const entries = readdirSync(cyclesDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      allDirs.push(e.name);
      if (e.name.match(/^cycle-\d+$/)) {
        cycleDirs.add(e.name);
      }
      // 检查空目录
      const subEntries = readdirSync(join(cyclesDir, e.name));
      if (subEntries.length === 0) {
        report.emptyDirs.push(e.name);
      }
    }
  }

  // 读账本，检查孤儿引用
  const ledgerPath = join(cyclesDir, 'gates', 'ledger.json');
  if (existsSync(ledgerPath)) {
    try {
      const raw = readFileSync(ledgerPath, 'utf-8');
      const ledger = JSON.parse(raw) as { entries?: Array<{ detail?: string }> };
      const entries = ledger.entries ?? [];
      for (let i = 0; i < entries.length; i++) {
        const detail = entries[i]?.detail ?? '';
        // detail 中引用 cycle-N
        const match = detail.match(/cycle-(\d+)/);
        if (match?.[1]) {
          const cycleName = `cycle-${match[1]}`;
          if (!cycleDirs.has(cycleName)) {
            report.orphanedLedgerEntries.push({ index: i, detail });
          }
        }
      }
    } catch {
      // 账本解析失败，跳过
    }
  }

  // 检查无账本条目的 cycle 目录
  const ledgerCycleRefs = new Set<string>();
  if (existsSync(ledgerPath)) {
    try {
      const raw = readFileSync(ledgerPath, 'utf-8');
      const ledger = JSON.parse(raw) as { entries?: Array<{ detail?: string }> };
      for (const entry of ledger.entries ?? []) {
        const match = (entry?.detail ?? '').match(/cycle-(\d+)/);
        if (match?.[1]) {
          ledgerCycleRefs.add(`cycle-${match[1]}`);
        }
      }
    } catch {
      // 忽略
    }
  }
  for (const dir of cycleDirs) {
    if (!ledgerCycleRefs.has(dir)) {
      report.orphanedCycleDirs.push(dir);
    }
  }

  return report;
}
