// 视觉基线的源码级守卫。
//
// ## 为什么需要这个文件
//
// cycle-90 之前，`tests/e2e/visual-screenshots.spec.ts` 里有 13 处裸
// `page.screenshot({ path: 'screenshots/e2e-NN-*.png' })`：截图写进
// `.gitignore:33` 忽略的 `screenshots/`，**没有任何像素比对**，`visual` project
// 也不在 CI 里。也就是说文件名叫「visual regression」但零回归能力——两跑对照
// 实测 13 张里 12 张像素不同（平均 19.38%、最高 35.75%），却没有任何一条断言会失败。
//
// 这种缺陷**无法被任何行为测试发现**：截图照常产生、文件照常存在，只是没人比对。
// 所以守卫必须扫**源码形状**，而不是运行结果。
//
// ## 它守什么
//
//   1. `tests/e2e/` 下不得出现裸 `page.screenshot(`——必须走 `toHaveScreenshot`。
//   2. 每一处 `toHaveScreenshot` 之前必须调用过 `waitForVisualStable(`：
//      画面不确定时基线就是随机红，久而久之所有人都会去加 `--update-snapshots`，
//      基线退化成「记录当前样子」而不再报警。
//   3. 每一处 `toHaveScreenshot` 的用例必须调用过 `installDeterminism(`：
//      随机初始位置与实时时钟会让同一用例两跑像素不同（实测 19.38% 平均差异）。
//
// ## 反向自检
//
// 纯正则守卫最大的风险是「正则写错了、永远匹配不到、于是永远绿」。
// 因此每个断言都带一个**正向样本**：把一段确实违规的源码喂给同一个检测函数，
// 必须命中。没有这层自检，`visualBaselineContract.test.ts` 本身也会变成幽灵。
//
// ## 为什么必须先 stripComments
//
// 本文件第一版直接扫原文，于是它立刻被自己的**文档注释**绊倒：文件头注释里写着
// 「全部改为 `expect(page).toHaveScreenshot(...)`」，扫描器把这句话当成一处真实
// 截图调用，报 `visual-screenshots.spec.ts:12` 缺少 installDeterminism。
//
// 这是同一类缺陷的第二次出现（`tests/unit/e2eSelectorContract.test.ts:25-28` 与
// `tests/unit/a11yFormSemantics.test.ts:87-89` 都因为「注释里记录了旧写法」而加了
// stripComments）。**源码扫描器必须把注释与代码分开**，否则文档越详尽、守卫越误报，
// 最后的结果是所有人去删注释而不是改代码。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * 去掉注释，避免「注释里记录了写法」被当成真实调用。
 *
 * 与 `tests/unit/e2eSelectorContract.test.ts:26-28` 同一意图，但这里**保留换行**：
 * 本文件的报错信息带行号（`file:line`），若把块注释整体删掉，行号会整体上移，
 * 指到错误的位置。所以块注释替换成等量空白的保留换行版本，行注释直接删内容。
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const E2E_DIR = resolve(ROOT, 'tests/e2e');

/** 递归收集目录下所有 .ts 文件（不含 .d.ts）。 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 裸 `page.screenshot(` 调用（`toHaveScreenshot` 不含 `page.screenshot(`，故不误报）。 */
const BARE_SCREENSHOT_RE = /\bpage\s*\.\s*screenshot\s*\(/;

/**
 * 判断一份源码里 `toHaveScreenshot` 的每一处是否都在 `waitForVisualStable` 之后。
 *
 * 判据按**调用顺序**而非全文包含：同一文件里 `waitForVisualStable()` 出现在
 * 第一个用例、但第二个用例没有，全文包含会误判为合规。因此这里按位置逐对检查
 * ——每个 `toHaveScreenshot` 的索引都必须大于它之前最近一次 `waitForVisualStable`。
 */
export function findScreenshotWithoutStable(source: string): number[] {
  const offenders: number[] = [];
  const shotRe = /\btoHaveScreenshot\s*\(/g;
  const stableRe = /\bwaitForVisualStable\s*\(/g;
  const stableAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = stableRe.exec(source)) !== null) stableAt.push(m.index);
  while ((m = shotRe.exec(source)) !== null) {
    const shotAt = m.index;
    // 要求：本处截图之前存在一次 waitForVisualStable，且中间没有出现新的用例边界。
    // 用例边界用 `test(` 近似——同一用例内的稳定调用必然在 `test(` 之后。
    const lastTest = source.lastIndexOf('test(', shotAt);
    const lastStable = stableAt.filter((i) => i < shotAt).pop() ?? -1;
    if (lastStable < lastTest) offenders.push(shotAt);
  }
  return offenders;
}

/** 判断一份源码里是否有 `toHaveScreenshot` 用例缺少 `installDeterminism`。 */
export function findScreenshotWithoutDeterminism(source: string): number[] {
  const offenders: number[] = [];
  const shotRe = /\btoHaveScreenshot\s*\(/g;
  const detRe = /\binstallDeterminism\s*\(/g;
  const detAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = detRe.exec(source)) !== null) detAt.push(m.index);
  while ((m = shotRe.exec(source)) !== null) {
    const shotAt = m.index;
    const lastTest = source.lastIndexOf('test(', shotAt);
    const lastDet = detAt.filter((i) => i < shotAt && i > lastTest).pop();
    if (lastDet === undefined) offenders.push(shotAt);
  }
  return offenders;
}

describe('visual baseline contract', () => {
  const files = collectTsFiles(E2E_DIR);

  it('tests/e2e 下不应存在裸 page.screenshot（必须走 toHaveScreenshot）', () => {
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, i) => {
        if (BARE_SCREENSHOT_RE.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1} >> ${line.trim()}`);
        }
      });
    }
    expect(offenders, `裸截图必须改为 toHaveScreenshot：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('反向自检：BARE_SCREENSHOT_RE 必须能命中真实违规样本', () => {
    // 正向样本用字符串拼接构造，避免本文件自己成为 offenders
    const sample = "await page" + ".screenshot({ path: 'x.png' });";
    expect(BARE_SCREENSHOT_RE.test(sample)).toBe(true);
    // 而合规写法不得命中
    expect(BARE_SCREENSHOT_RE.test("await expect(page).toHaveScreenshot('x.png');")).toBe(false);
  });

  it('每处 toHaveScreenshot 之前必须调用 waitForVisualStable', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf-8'));
      for (const idx of findScreenshotWithoutStable(source)) {
        const line = source.slice(0, idx).split('\n').length;
        offenders.push(`${relative(ROOT, file)}:${line}`);
      }
    }
    expect(
      offenders,
      `画面不确定时基线会随机变红，久而久之基线退化成「记录当前样子」。` +
        `每处截图前必须 await waitForVisualStable(page)：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('反向自检：findScreenshotWithoutStable 必须能命中缺失稳定的样本', () => {
    const bad = [
      "test('a', async ({ page }) => {",
      "  await expect(page).toHaveScreenshot('a.png');",
      '});',
    ].join('\n');
    expect(findScreenshotWithoutStable(bad).length).toBe(1);

    const good = [
      "test('a', async ({ page }) => {",
      '  await waitForVisualStable(page);',
      "  await expect(page).toHaveScreenshot('a.png');",
      '});',
    ].join('\n');
    expect(findScreenshotWithoutStable(good)).toEqual([]);

    // 第二个用例缺少稳定调用——全文包含式守卫会漏掉这个
    const mixed = [
      "test('a', async ({ page }) => {",
      '  await waitForVisualStable(page);',
      "  await expect(page).toHaveScreenshot('a.png');",
      '});',
      "test('b', async ({ page }) => {",
      "  await expect(page).toHaveScreenshot('b.png');",
      '});',
    ].join('\n');
    expect(findScreenshotWithoutStable(mixed).length).toBe(1);
  });

  it('每处 toHaveScreenshot 所在用例必须调用 installDeterminism', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf-8'));
      for (const idx of findScreenshotWithoutDeterminism(source)) {
        const line = source.slice(0, idx).split('\n').length;
        offenders.push(`${relative(ROOT, file)}:${line}`);
      }
    }
    expect(
      offenders,
      `随机初始位置 + 实时时钟会让两跑像素不同，必须 await installDeterminism(page)：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('反向自检：findScreenshotWithoutDeterminism 必须能命中缺失确定性的样本', () => {
    const bad = [
      "test('a', async ({ page }) => {",
      '  await waitForVisualStable(page);',
      "  await expect(page).toHaveScreenshot('a.png');",
      '});',
    ].join('\n');
    expect(findScreenshotWithoutDeterminism(bad).length).toBe(1);

    const good = [
      "test('a', async ({ page }) => {",
      '  await installDeterminism(page);',
      '  await waitForVisualStable(page);',
      "  await expect(page).toHaveScreenshot('a.png');",
      '});',
    ].join('\n');
    expect(findScreenshotWithoutDeterminism(good)).toEqual([]);
  });

  it('视觉基线目录不得被 gitignore 忽略（否则基线无法随代码走）', () => {
    const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8');
    const lines = gitignore
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    const ignored = lines.filter((l) => {
      const clean = l.replace(/\/+$/, '');
      return clean === '__screenshots__' || clean.endsWith('/__screenshots__') || clean === 'tests/e2e';
    });
    expect(ignored, `快照目录被忽略会让基线不进版本库：\n${ignored.join('\n')}`).toEqual([]);
  });
});
