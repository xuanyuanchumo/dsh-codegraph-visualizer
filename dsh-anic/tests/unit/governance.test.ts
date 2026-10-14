import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveOldCycles } from '../../src/host/governance/archiver.ts';
import { checkBudget } from '../../src/host/governance/budget.ts';
import { sweepCycles } from '../../src/host/governance/sweep.ts';
import { pruneCheck } from '../../src/host/governance/prune.ts';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'anic-gov-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('archiver', () => {
  it('归档旧 cycle（移动不删除）', () => {
    mkdirSync(join(workDir, 'cycle-1'), { recursive: true });
    mkdirSync(join(workDir, 'cycle-2'), { recursive: true });
    mkdirSync(join(workDir, 'cycle-3'), { recursive: true });
    writeFileSync(join(workDir, 'cycle-1', 'meta.json'), '{}');

    const result = archiveOldCycles(workDir, { olderThanRounds: 1, currentCycleNumber: 3 });
    expect(result.archived).toContain('cycle-1');
    expect(result.archived).toContain('cycle-2');
    expect(result.skipped).toContain('cycle-3');
    expect(readdirSync(join(workDir, 'archive'))).toContain('cycle-1');
  });

  it('不归档当前及未来 cycle', () => {
    mkdirSync(join(workDir, 'cycle-5'), { recursive: true });
    const result = archiveOldCycles(workDir, { olderThanRounds: 10, currentCycleNumber: 5 });
    expect(result.archived).toEqual([]);
    expect(result.skipped).toContain('cycle-5');
  });

  it('无 cycle 目录时返回空', () => {
    const result = archiveOldCycles(workDir);
    expect(result.archived).toEqual([]);
  });
});

describe('budget', () => {
  it('正常大小 → normal', () => {
    writeFileSync(join(workDir, 'small.txt'), 'hello');
    const report = checkBudget(workDir);
    expect(report.status).toBe('normal');
    expect(report.fileCount).toBe(1);
  });

  it('超告警阈值 → warn', () => {
    writeFileSync(join(workDir, 'data.txt'), 'x'.repeat(200));
    const report = checkBudget(workDir, { warnBytes: 100, alertBytes: 1000 });
    expect(report.status).toBe('warn');
  });

  it('超严重阈值 → alert', () => {
    writeFileSync(join(workDir, 'big.txt'), 'x'.repeat(2000));
    const report = checkBudget(workDir, { warnBytes: 100, alertBytes: 1000 });
    expect(report.status).toBe('alert');
  });

  it('largestFiles 排序', () => {
    writeFileSync(join(workDir, 'a.txt'), 'x'.repeat(2 * 1024 * 1024));
    writeFileSync(join(workDir, 'b.txt'), 'x'.repeat(3 * 1024 * 1024));
    const report = checkBudget(workDir);
    expect(report.largestFiles[0]?.bytes).toBeGreaterThan(report.largestFiles[1]?.bytes ?? 0);
  });
});

describe('sweep', () => {
  it('删空目录', () => {
    mkdirSync(join(workDir, 'empty-dir'), { recursive: true });
    const result = sweepCycles(workDir);
    expect(result.removedDirs.length).toBeGreaterThan(0);
  });

  it('删过期 .tmp 文件', () => {
    writeFileSync(join(workDir, 'stale.tmp'), 'old');
    const result = sweepCycles(workDir, { tmpMaxAgeMs: -1 }); // 立即过期
    expect(result.removedTmpFiles.length).toBe(1);
  });

  it('不删非 .tmpG文件', () => {
    writeFileSync(join(workDir, 'keep.json'), '{}');
    const result = sweepCycles(workDir, { tmpMaxAgeMs: -1 });
    expect(result.removedTmpFiles).toEqual([]);
  });
});

describe('prune', () => {
  it('识别孤儿账本条目', () => {
    mkdirSync(join(workDir, 'cycle-1'), { recursive: true });
    mkdirSync(join(workDir, 'gates'), { recursive: true });
    writeFileSync(join(workDir, 'gates', 'ledger.json'), JSON.stringify({
      entries: [{ detail: 'cycle-1 passed' }, { detail: 'cycle-999 missing' }],
    }));
    const report = pruneCheck(workDir);
    expect(report.orphanedLedgerEntries.length).toBeGreaterThan(0);
  });

  it('识别无账本引用的 cycle 目录', () => {
    mkdirSync(join(workDir, 'cycle-1'), { recursive: true });
    mkdirSync(join(workDir, 'cycle-2'), { recursive: true });
    mkdirSync(join(workDir, 'gates'), { recursive: true });
    writeFileSync(join(workDir, 'gates', 'ledger.json'), JSON.stringify({
      entries: [{ detail: 'cycle-1 ok-2' }],
    }));
    const report = pruneCheck(workDir);
    expect(report.orphanedCycleDirs).toContain('cycle-2');
  });

  it('识别空目录', () => {
    mkdirSync(join(workDir, 'empty-cycle'), { recursive: true });
    const report = pruneCheck(workDir);
    expect(report.emptyDirs).toContain('empty-cycle');
  });
});
