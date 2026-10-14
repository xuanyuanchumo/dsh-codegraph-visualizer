/**
 * M5-a Archiver — 归档旧 cycle（移动不删除）。
 *
 * 纪律：只移动目录到 .cycles/archive/，永不删除（INV: 账本不可变）。
 */

import { existsSync, renameSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ArchiveOptions {
  /** 归档 N 轮以前的 cycle（默认 30） */
  olderThanRounds?: number;
  /** 当前 cycle 号（不归档当前及之后） */
  currentCycleNumber?: number;
}

export interface ArchiveResult {
  archived: string[]; // 归档的 cycle 目录名
  skipped: string[];  // 跳过的（当前/未来/不存在）
  archiveDir: string;
}

/** 归档旧 cycle 目录到 .cycles/archive/ */
export function archiveOldCycles(cyclesDir: string, opts: ArchiveOptions = {}): ArchiveResult {
  const olderThan = opts.olderThanRounds ?? 30;
  const current = opts.currentCycleNumber ?? Infinity;
  const archiveDir = join(cyclesDir, 'archive');
  const result: ArchiveResult = { archived: [], skipped: [], archiveDir };

  if (!existsSync(cyclesDir)) return result;

  // 列出所有 cycle-N 目录
  const entries = readdirSync(cyclesDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const match = e.name.match(/^cycle-(\d+)$/);
    if (!match?.[1]) continue;
    const num = parseInt(match[1], 10);
    // 不归档当前及未来 cycle
    if (num >= current) {
      result.skipped.push(e.name);
      continue;
    }
    // 不归档最近 N 轮
    if (current !== Infinity && num > current - olderThan) {
      result.skipped.push(e.name);
      continue;
    }
    // 绝对阈值：cycle 号 < olderThan 且无 current 参照
    if (current === Infinity && num >= olderThan) {
      result.skipped.push(e.name);
      continue;
    }

    // 移动到 archive/
    const src = join(cyclesDir, e.name);
    const dst = join(archiveDir, e.name);
    try {
      if (!existsSync(archiveDir)) {
        const { mkdirSync } = require('node:fs');
        mkdirSync(archiveDir, { recursive: true });
      }
      if (!existsSync(dst)) {
        renameSync(src, dst);
        result.archived.push(e.name);
      } else {
        result.skipped.push(e.name); // 已归档
      }
    } catch {
      result.skipped.push(e.name); // 移动失败
    }
  }

  return result;
}
