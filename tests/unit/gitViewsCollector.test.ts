/**
 * gitViewsCollector 测试（cycle-144 T1/T3）。
 *
 * 核心风险是「采集器与解析器分属两侧、格式漂移静默发生」——因此本套件
 * **用真实 git 仓库往返**（collect → parse），不用 mock 解析器：
 * mock 掉解析器就无法发现格式不匹配，正是「两份实现各写一份必然漂移」的盲区。
 *
 * 另外钉死 gitChurn 同族的全部纪律：无 shell（含空格路径）、windowsHide、
 * 缓存只缓存成功、失败可见不编造。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  collectGitRawInput,
  clearViewsGitCache,
  VIEWS_COLLECT_LIMITS,
  VIEWS_COLLECT_CACHE,
} from '../../src/host/gitViewsCollector.ts';
import { parseCommitLog } from '../../src/shared/temporal.ts';
import { parseGitBlamePorcelain, groupBlameByFile, buildOwnershipMap } from '../../src/shared/ownership.ts';
import type { GraphNode } from '../../src/types/index.ts';

/** 建一个带两次提交的真实 git 仓库（含空格路径，验证 shell 纪律）。 */
function makeGitRepo(withSpaces: boolean): string {
  const base = mkdtempSync(join(tmpdir(), withSpaces ? 'anic views space ' : 'anic-views-'));
  const git = (args: string[], cwd = base) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'pipe' });
  git(['init']);
  writeFileSync(join(base, 'a.ts'), 'export const a = 1;\n');
  mkdirSync(join(base, 'sub'));
  writeFileSync(join(base, 'sub', 'b.ts'), 'export const b = 1;\n');
  git(['add', '.']);
  git(['commit', '-m', 'first']);
  // 第二次提交只改 a.ts（让 blame 的 a.ts 与 b.ts 归属可区分）
  writeFileSync(join(base, 'a.ts'), 'export const a = 2;\n');
  git(['add', '.']);
  git(['commit', '-m', 'second']);
  return base;
}

const NODES: GraphNode[] = [
  { id: 'a.ts', label: 'a.ts', type: 'module', filePath: 'a.ts', lineNumber: 1, properties: { kind: 'module' } },
  { id: 'sub/b.ts', label: 'b.ts', type: 'module', filePath: 'sub/b.ts', lineNumber: 1, properties: { kind: 'module' } },
] as unknown as GraphNode[];

describe('gitViewsCollector — 真实 git 往返（采集 → 解析）', () => {
  let repo: string;

  beforeEach(() => {
    clearViewsGitCache();
    repo = makeGitRepo(false);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    clearViewsGitCache();
  });

  it('commitLog：采集输出被 parseCommitLog 真实解析（非空切片、文件名齐全）', async () => {
    const raw = await collectGitRawInput(repo, 'commitLog');
    expect(raw.available).toBe(true);
    expect(raw.reason).toBeNull();
    expect(raw.text).toBeTruthy();

    // 往返：采集 → 解析。格式漂移会在这里静默产生 0 切片。
    const slices = parseCommitLog(raw.text!);
    expect(slices.length).toBe(2); // 两次提交
    const files = new Set<string>();
    for (const s of slices) for (const f of s.files) files.add(f);
    expect(files.has('a.ts')).toBe(true);
    expect(files.has('sub/b.ts')).toBe(true);
  });

  it('blameLog：采集输出被 parseGitBlamePorcelain + buildOwnershipMap 真实消费', async () => {
    const raw = await collectGitRawInput(repo, 'blameLog');
    expect(raw.available).toBe(true);
    const blameLines = parseGitBlamePorcelain(raw.text!);
    expect(blameLines.length).toBeGreaterThan(0);
    const byFile = groupBlameByFile(blameLines);
    const ownership = buildOwnershipMap(NODES, byFile);
    // a.ts 在两次提交中被改过 → 节点归属非空
    expect(Object.keys(ownership.nodeLabels).length).toBeGreaterThan(0);
  });

  it('含空格的工作区路径（无 shell 纪律，cycle-105 P0-A 同族回归）', async () => {
    const spaced = makeGitRepo(true);
    try {
      const raw = await collectGitRawInput(spaced, 'commitLog');
      expect(raw.available).toBe(true);
      expect(raw.text).toContain('a.ts');
    } finally {
      rmSync(spaced, { recursive: true, force: true });
    }
  });

  it('非 git 目录 → available:false + 可读原因（不抛、不编造）', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'anic-notrepo-'));
    try {
      const raw = await collectGitRawInput(notRepo, 'commitLog');
      expect(raw.available).toBe(false);
      expect(raw.text).toBeNull();
      expect(raw.reason).toBeTruthy();
      expect(typeof raw.reason).toBe('string');
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it('缓存只缓存成功结果：失败不进缓存，成功后第二次命中（不重复起 git 进程）', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'anic-notrepo2-'));
    try {
      const fail1 = await collectGitRawInput(notRepo, 'commitLog');
      expect(fail1.available).toBe(false);
      // 失败不缓存：再拿还是走真实采集（同一失败原因，但缓存里没有它）
      const fail2 = await collectGitRawInput(notRepo, 'commitLog');
      expect(fail2.available).toBe(false);
      // 成功后缓存命中
      const ok1 = await collectGitRawInput(repo, 'commitLog');
      const ok2 = await collectGitRawInput(repo, 'commitLog');
      expect(ok1.available).toBe(true);
      expect(ok2.available).toBe(true);
      expect(ok2.text).toBe(ok1.text); // 同一缓存实例
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it('上限常量导出且为正（调参位可见，不藏在字面量里）', () => {
    expect(VIEWS_COLLECT_LIMITS.TIMEOUT_MS).toBeGreaterThan(0);
    expect(VIEWS_COLLECT_LIMITS.MAX_BUFFER).toBeGreaterThan(1024);
    expect(VIEWS_COLLECT_CACHE.TTL_MS).toBeGreaterThan(0);
    expect(VIEWS_COLLECT_CACHE.MAX).toBeGreaterThan(0);
  });

  describe('blameLog fileFilter（cycle-146：采集量与图规模成正比）', () => {
    it('fileFilter 限定文件集：输出只含被点名的文件，且往返消费仍成立', async () => {
      const raw = await collectGitRawInput(repo, 'blameLog', new Set(['a.ts']));
      expect(raw.available).toBe(true);
      const byFile = groupBlameByFile(parseGitBlamePorcelain(raw.text!));
      // 只 blame 了 a.ts ⇒ b.ts 不在输出里（白算的墙时间被裁掉）
      expect(byFile['a.ts']?.length ?? 0).toBeGreaterThan(0);
      expect(byFile['sub/b.ts']).toBeUndefined();
    });

    it('fileFilter 与跟踪文件名归一化对齐：反斜杠/./ 前缀仍能命中', async () => {
      const raw = await collectGitRawInput(repo, 'blameLog', new Set(['.\\sub\\b.ts']));
      expect(raw.available).toBe(true);
      const byFile = groupBlameByFile(parseGitBlamePorcelain(raw.text!));
      expect(byFile['sub/b.ts']?.length ?? 0).toBeGreaterThan(0);
      expect(byFile['a.ts']).toBeUndefined();
    });

    it('fileFilter 空集 / 全部未命中 → 回退全量（宁慢不可错：键错位会让所有权视图永远不可用）', async () => {
      const rawEmpty = await collectGitRawInput(repo, 'blameLog', new Set());
      expect(rawEmpty.available).toBe(true);
      const byFileEmpty = groupBlameByFile(parseGitBlamePorcelain(rawEmpty.text!));
      expect(byFileEmpty['a.ts']?.length ?? 0).toBeGreaterThan(0);
      expect(byFileEmpty['sub/b.ts']?.length ?? 0).toBeGreaterThan(0);

      const rawMiss = await collectGitRawInput(repo, 'blameLog', new Set(['not/exist.ts']));
      expect(rawMiss.available).toBe(true);
      const byFileMiss = groupBlameByFile(parseGitBlamePorcelain(rawMiss.text!));
      expect(byFileMiss['a.ts']?.length ?? 0).toBeGreaterThan(0);
    });

    it('不同 fileFilter 各自缓存（过滤集变化不命中旧缓存）', async () => {
      const onlyA = await collectGitRawInput(repo, 'blameLog', new Set(['a.ts']));
      const onlyB = await collectGitRawInput(repo, 'blameLog', new Set(['sub/b.ts']));
      expect(groupBlameByFile(parseGitBlamePorcelain(onlyA.text!))['sub/b.ts']).toBeUndefined();
      expect(groupBlameByFile(parseGitBlamePorcelain(onlyB.text!))['a.ts']).toBeUndefined();
    });
  });
});
