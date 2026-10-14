/**
 * M5-a Sweep — 清理空目录与过期临时文件。
 *
 * 只删空目录和 .tmp 文件，永不删有内容的工件。
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SweepOptions {
  /** 是否删除 .tmp 文件（默认 true） */
  removeTmpFiles?: boolean;
  /** .tmp 文件过期毫秒（默认 1h） */
  tmpMaxAgeMs?: number;
}

export interface SweepResult {
  removedDirs: string[];
  removedTmpFiles: string[];
  skipped: string[];
}

/** 递归清理空目录 */
function removeEmptyDirs(dir: string, removed: string[]): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const full = join(dir, e.name);
      removeEmptyDirs(full, removed);
    }
  }
  // 再检查自身是否已空
  const remaining = readdirSync(dir);
  if (remaining.length === 0) {
    try {
      rmdirSync(dir);
      removed.push(dir);
    } catch {
      // 非空或权限不足，跳过
    }
  }
}

/** 清理 .cycles/ 下的空目录与过期 .tmp 文件 */
export function sweepCycles(cyclesDir: string, opts: SweepOptions = {}): SweepResult {
  const removeTmp = opts.removeTmpFiles ?? true;
  const tmpMaxAge = opts.tmpMaxAgeMs ?? 3600_000;
  const result: SweepResult = { removedDirs: [], removedTmpFiles: [], skipped: [] };

  if (!existsSync(cyclesDir)) return result;

  // 删过期 .tmp 文件
  if (removeTmp) {
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (e.isFile() && e.name.endsWith('.tmp')) {
          try {
            const s = statSync(full);
            if (Date.now() - s.mtimeMs > tmpMaxAge) {
              unlinkSync(full);
              result.removedTmpFiles.push(full);
            }
          } catch {
            result.skipped.push(full);
          }
        }
      }
    };
    walk(cyclesDir);
  }

  // 删空目录（不删 cyclesDir 自身）
  const entries = readdirSync(cyclesDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      removeEmptyDirs(join(cyclesDir, e.name), result.removedDirs);
    }
  }

  return result;
}
