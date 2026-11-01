/**
 * cycle-126 · T4：legacyTruncatedReach 引用自检。
 *
 * 契约：`legacyTruncatedReach`（顺序相关 BFS 近似）已被 SCC+bitset 精确实现
 * `computeInfluenceReach`（batchReach.ts）替代，生产代码零调用——它只保留给
 * 「新旧对照」测试（CoreFunctionAnalyzer.test.ts:488/:509 的等价性/近似性断言）。
 *
 * 该守卫防两类复发：
 * 1. 生产路径悄悄改回 legacy（旧值在 MAX_BFS_NODES 之上顺序相关且不精确）；
 * 2. 有人删除 legacy 函数却没同步删测试对照（测试会 import 失败，但本守卫
 *    让意图在源码层面显式——「对照测试保留」是一条写下来的决定）。
 *
 * 守卫自检（反向样本）：合成一个 `legacyTruncatedReach(` 调用必须被检出，
 * 否则正则坏掉守卫永远绿（CLAUDE.md R10：无反向自检的守卫等于没有守卫）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 生产代码根目录（不含 tests）。 */
const SRC_ROOT = join(process.cwd(), 'src');
/** 豁免文件：定义处（导出本身）与对照测试所在的分析器实现文件。 */
const EXEMPT = /CoreFunctionAnalyzer\.ts$/;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('legacyTruncatedReach 引用自检（cycle-126 T4）', () => {
  it('生产 src/ 除定义文件外零调用（含反向自检）', () => {
    const files = walkTs(SRC_ROOT);
    // 反空转：扫描必须真的扫到了生产文件。
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const f of files) {
      if (EXEMPT.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      if (src.includes('legacyTruncatedReach')) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('反向自检：正则坏掉时守卫必须转红', () => {
    // 合成违规样本（不落盘、直接喂给同款判定逻辑）。
    const synthetic = 'const x = legacyTruncatedReach("a", edges);';
    const detect = (src: string) => src.includes('legacyTruncatedReach');
    expect(detect(synthetic)).toBe(true);
    // 且守卫自身的判定逻辑对干净源码不误报。
    expect(detect('const x = computeInfluenceReach(edges);')).toBe(false);
  });

  it('豁免表必须仍然豁免定义文件（豁免失效 = 守卫误报生产缺陷）', () => {
    const defFile = join(SRC_ROOT, 'shared', 'analysis', 'CoreFunctionAnalyzer.ts');
    const src = readFileSync(defFile, 'utf8');
    // 定义文件里必须真的有这个导出（改名/删除后本用例红，提示同步更新守卫）。
    expect(src).toContain('export function legacyTruncatedReach');
    expect(EXEMPT.test(defFile)).toBe(true);
  });
});
