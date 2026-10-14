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
 * `expectSnapshot` 辅助函数在源码里的字符区间——**唯一合法的间接截图点**（P3-R26-03）。
 *
 * 为什么需要它：本文件的两条守卫按「调用位置相对 test( 与 installDeterminism( 的位置」判定，
 * 而 `expectSnapshot` 定义在**所有 test() 之前**，它内部那一处 `toHaveScreenshot` 必然被判为
 * 「所在用例没有 installDeterminism」——守卫自己制造了一个假阳性。
 *
 * 正确处理不是放宽守卫，而是**显式承认一个间接点并把它排除**：`expectSnapshot` 保证预算经由
 * `screenshotBudget(name)` 取出（见本文件后半的 budget 契约组），13 个调用点则继续受位置守卫约束。
 * 若哪天有人把 `expectSnapshot` 改名或删掉，本函数返回 null，那一处 `toHaveScreenshot` 会立刻
 * 重新落回位置守卫——不会因为"跳过了某个区间"而永久豁免。
 */
export function sanctionedHelperSpan(source: string): [number, number] | null {
  const m = /async function expectSnapshot\([\s\S]*?\n\}/.exec(source);
  return m ? [m.index, m.index + m[0].length] : null;
}

/**
 * 位置守卫在 `expectSnapshot` 重构后的**必要补位**。
 *
 * 背景（cycle-92 实测到的自身缺陷）：把 13 处 `expect(page).toHaveScreenshot(...)` 改为
 * `expectSnapshot(page, name)` 之后，文件里 `toHaveScreenshot` 只剩 helper 里那一处，
 * 而它被 `sanctionedHelperSpan` 合法豁免——于是上面两条位置守卫（"每处截图前必须
 * waitForVisualStable" / "每个截图所在用例必须 installDeterminism"）**全部变成空转**：
 * 把某个用例的 `installDeterminism(page)` 删掉，13 个用例仍然全绿。这正是本仓库反复
 * 出现的"守卫形状与实现形状脱节"家族。
 *
 * 补位方式：对 `expectSnapshot(` 调用点重做同一套位置判定。判定逻辑与上面两个函数
 * **刻意重复而不抽取公共函数**：两者守的是不同的语法形态（`toHaveScreenshot` vs
 * `expectSnapshot`），共用实现会让"只改一处"变成静默半失效。
 */
export function findSnapshotCallWithoutStable(source: string): number[] {
  const offenders: number[] = [];
  const span = sanctionedHelperSpan(source);
  const callRe = /\bexpectSnapshot\s*\(/g;
  const stableRe = /\bwaitForVisualStable\s*\(/g;
  const stableAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = stableRe.exec(source)) !== null) stableAt.push(m.index);
  while ((m = callRe.exec(source)) !== null) {
    const callAt = m.index;
    if (span && callAt > span[0] && callAt < span[1]) continue;
    const lastTest = source.lastIndexOf('test(', callAt);
    const lastStable = stableAt.filter((i) => i < callAt).pop() ?? -1;
    if (lastStable < lastTest) offenders.push(callAt);
  }
  return offenders;
}

/** 同上，但要求 `installDeterminism` 出现在同一用例内（见上）。 */
export function findSnapshotCallWithoutDeterminism(source: string): number[] {
  const offenders: number[] = [];
  const span = sanctionedHelperSpan(source);
  const callRe = /\bexpectSnapshot\s*\(/g;
  const detRe = /\binstallDeterminism\s*\(/g;
  const detAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = detRe.exec(source)) !== null) detAt.push(m.index);
  while ((m = callRe.exec(source)) !== null) {
    const callAt = m.index;
    if (span && callAt > span[0] && callAt < span[1]) continue;
    const lastTest = source.lastIndexOf('test(', callAt);
    const lastDet = detAt.filter((i) => i < callAt && i > lastTest).pop();
    if (lastDet === undefined) offenders.push(callAt);
  }
  return offenders;
}


/**
 * 判断一份源码里 `toHaveScreenshot` 的每一处是否都在 `waitForVisualStable` 之后。
 *
 * 判据按**调用顺序**而非全文包含：同一文件里 `waitForVisualStable()` 出现在
 * 第一个用例、但第二个用例没有，全文包含会误判为合规。因此这里按位置逐对检查
 * ——每个 `toHaveScreenshot` 的索引都必须大于它之前最近一次 `waitForVisualStable`。
 */
export function findScreenshotWithoutStable(source: string): number[] {
  const offenders: number[] = [];
  const span = sanctionedHelperSpan(source);
  const shotRe = /\btoHaveScreenshot\s*\(/g;
  const stableRe = /\bwaitForVisualStable\s*\(/g;
  const stableAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = stableRe.exec(source)) !== null) stableAt.push(m.index);
  while ((m = shotRe.exec(source)) !== null) {
    const shotAt = m.index;
    if (span && shotAt > span[0] && shotAt < span[1]) continue;
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
  const span = sanctionedHelperSpan(source);
  const shotRe = /\btoHaveScreenshot\s*\(/g;
  const detRe = /\binstallDeterminism\s*\(/g;
  const detAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = detRe.exec(source)) !== null) detAt.push(m.index);
  while ((m = shotRe.exec(source)) !== null) {
    const shotAt = m.index;
    if (span && shotAt > span[0] && shotAt < span[1]) continue;
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

// ---------------------------------------------------------------------------
// P3-R26-03（cycle-92）：差异预算必须逐图显式声明，且不得再出现裸 toHaveScreenshot
// ---------------------------------------------------------------------------
//
// ## 它守的那个缺陷
//
// cycle-90 把 13 处裸 `page.screenshot` 换成了 `toHaveScreenshot`，但 13 张图共用
// 一个文件级常量 `const MAX_DIFF_PIXELS = 500`。于是"新增一张截图"这个动作**不需要
// 任何预算决策**：作者复制一行、写个新名字、收工。而"画面为什么是稳的"这个问题
// （`installDeterminism` / `waitForVisualStable` 是否真的覆盖了这张图）永远不会被问一次。
//
// 更实际的风险在下一次变红时：既然预算是全局的、随手可改的，最小阻力路径就是"把 500 调大"。
// 本组断言把"调预算"变成必须同时改三处的显式决定（表、上限、本文件）。
//
// ## 为什么是源码扫描而不是行为断言
//
// 一张图的预算是多少，运行时**看不出来**：`toHaveScreenshot` 无论传 0 还是 500 都通过
// （只要差异小于它）。所以只能扫形状：13 处调用必须全部经过 `screenshotBudget(name)`。

/** 从 `visual-screenshots.spec.ts` 解析 `SCREENSHOT_BUDGETS` 表。 */
export function parseScreenshotBudgets(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const block = source.match(/SCREENSHOT_BUDGETS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!block) return out;
  for (const m of (block[1] ?? '').matchAll(/'([^']+)'\s*:\s*(\d+)/g)) {
    out.set(m[1] as string, Number(m[2]));
  }
  return out;
}

/** 解析 `SCREENSHOT_BUDGET_CEILING`。 */
export function parseBudgetCeiling(source: string): number | null {
  const m = source.match(/SCREENSHOT_BUDGET_CEILING\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 找出所有 `expectSnapshot(page, 'x.png')` 引用的快照名。 */
export function parseSnapshotNames(source: string): string[] {
  return [...source.matchAll(/expectSnapshot\(\s*page\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1] as string);
}

/**
 * 找出"预算表里没有登记"的快照名。
 *
 * 必须传**已 stripComments 的源码**：表与调用都是代码，注释里的示例会污染统计。
 */
export function unregisteredSnapshots(source: string): string[] {
  const budgets = parseScreenshotBudgets(source);
  return parseSnapshotNames(source).filter((n) => !budgets.has(n));
}

describe('screenshot budget contract (P3-R26-03)', () => {
  const VISUAL_SPEC = resolve(E2E_DIR, 'visual-screenshots.spec.ts');
  const SPEC_CODE = stripComments(readFileSync(VISUAL_SPEC, 'utf-8'));

  it('spec 里不得再出现裸 expect(page).toHaveScreenshot（必须经 expectSnapshot）', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(E2E_DIR)) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      // 唯一合法的间接点：expectSnapshot 定义体（它自己必须调用 toHaveScreenshot，
      // 且预算由 screenshotBudget(name) 取出）。豁免区间由 sanctionedHelperSpan 计算，
      // 改名/删除即失效——不会留下永久豁免。
      const span = sanctionedHelperSpan(code);
      let cursor = 0;
      code.split('\n').forEach((line, i) => {
        const lineStart = cursor;
        cursor += line.length + 1;
        if (!/expect\(\s*page\s*\)\s*\.\s*toHaveScreenshot\s*\(/.test(line)) return;
        if (span && lineStart > span[0] && lineStart < span[1]) return;
        offenders.push(`${relative(ROOT, file)}:${i + 1} >> ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `裸 toHaveScreenshot 没有预算决策，必须改为 expectSnapshot(page, name)：\n${offenders.join('\n')}`,
    ).toEqual([]);
    // 正样本存在性：若 expectSnapshot 一处都没有，上面那条断言会因"全都没写"而假绿。
    expect(SPEC_CODE).toContain('expectSnapshot(page,');
  });

  it('反向自检：裸 toHaveScreenshot 检测器必须能命中真实违规样本', () => {
    const BARE = /expect\(\s*page\s*\)\s*\.\s*toHaveScreenshot\s*\(/;
    // 用字符串拼接构造，避免本文件自己成为 offenders（与 BARE_SCREENSHOT_RE 同一纪律）
    const sample = 'await expect(page)' + ".toHaveScreenshot('x.png', { maxDiffPixels: 500 });";
    expect(BARE.test(sample)).toBe(true);
    expect(BARE.test("await expectSnapshot(page, 'x.png');")).toBe(false);
  });

  it('13 处截图全部登记且预算都在 (0, 上限] 内', () => {
    const budgets = parseScreenshotBudgets(SPEC_CODE);
    const ceiling = parseBudgetCeiling(SPEC_CODE);
    // 先证明解析器真的读到了东西：解析失败时下面全是空循环，会静默通过。
    expect(budgets.size, 'SCREENSHOT_BUDGETS 解析为空——表被改名或改形状了').toBeGreaterThanOrEqual(13);
    expect(ceiling, 'SCREENSHOT_BUDGET_CEILING 解析失败').not.toBeNull();

    const bad: string[] = [];
    for (const [name, value] of budgets) {
      if (!Number.isInteger(value) || value <= 0) bad.push(`${name}=${value}（必须为正整数）`);
      else if (value > (ceiling as number)) bad.push(`${name}=${value}（超过上限 ${ceiling}）`);
    }
    expect(bad, `预算必须是 (0, ${ceiling}] 内的正整数：\n${bad.join('\n')}`).toEqual([]);
  });

  it('每处 expectSnapshot 的名字都已登记，且表里没有无人引用的死条目', () => {
    const budgets = parseScreenshotBudgets(SPEC_CODE);
    const used = parseSnapshotNames(SPEC_CODE);
    expect(used.length).toBeGreaterThanOrEqual(13);
    expect(unregisteredSnapshots(SPEC_CODE)).toEqual([]);
    const unused = [...budgets.keys()].filter((n) => !used.includes(n));
    expect(unused, `以下预算条目没有任何截图引用（改名后忘了删）：\n${unused.join('\n')}`).toEqual([]);
  });

  it('反向自检：sanctionedHelperSpan 必须只圈住 expectSnapshot 定义体', () => {
    const real = readFileSync(VISUAL_SPEC, 'utf-8');
    const span = sanctionedHelperSpan(real);
    expect(span, 'expectSnapshot 定义体没被识别——位置守卫会重新把它判成违规').not.toBeNull();
    const body = real.slice(span![0], span![1]);
    expect(body).toContain('toHaveScreenshot');
    expect(body).toContain('screenshotBudget(name)');
    // 不得把 test() 用例圈进来：圈进来就等于豁免了全部截图的位置守卫。
    expect(body).not.toContain("test('");
    // 两份样本：改名后必须返回 null（豁免随之消失），而不是继续匹配到别的东西。
    expect(sanctionedHelperSpan("async function otherHelper(page: Page) {\n  await page.waitForTimeout(1);\n}")).toBeNull();
  });

  it('反向自检：未登记检测器必须能命中表外名字', () => {
    const sample = [
      'const SCREENSHOT_BUDGETS = Object.freeze({',
      "  'a.png': 60,",
      '});',
      "await expectSnapshot(page, 'a.png');",
      "await expectSnapshot(page, 'ghost.png');",
    ].join('\n');
    expect(unregisteredSnapshots(sample)).toEqual(['ghost.png']);
    expect(parseScreenshotBudgets(sample).size).toBe(1);
    expect(parseBudgetCeiling(sample)).toBeNull();
  });
});

describe('call-site position contract (P3-R26-03 补位)', () => {
  const VISUAL_SPEC_PATH = resolve(E2E_DIR, 'visual-screenshots.spec.ts');
  const VISUAL_CODE = stripComments(readFileSync(VISUAL_SPEC_PATH, 'utf-8'));

  it('每处 expectSnapshot 调用前必须调用 waitForVisualStable', () => {
    const offenders = findSnapshotCallWithoutStable(VISUAL_CODE).map(
      (i) => `${relative(ROOT, VISUAL_SPEC_PATH)}:${VISUAL_CODE.slice(0, i).split('\n').length}`,
    );
    expect(
      offenders,
      `expectSnapshot 让 toHaveScreenshot 只剩 helper 一处，位置守卫必须补到调用点：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('每处 expectSnapshot 所在用例必须调用 installDeterminism', () => {
    const offenders = findSnapshotCallWithoutDeterminism(VISUAL_CODE).map(
      (i) => `${relative(ROOT, VISUAL_SPEC_PATH)}:${VISUAL_CODE.slice(0, i).split('\n').length}`,
    );
    expect(
      offenders,
      `expectSnapshot 让 toHaveScreenshot 只剩 helper 一处，位置守卫必须补到调用点：\n${offenders.join('\n')}`,
    ).toEqual([]);
    // 防空转：把 helper 声明排除后必须仍有 ≥13 个真实调用点，否则说明正则与实现脱节了。
    const span = sanctionedHelperSpan(VISUAL_CODE);
    const callSites = [...VISUAL_CODE.matchAll(/expectSnapshot\s*\(/g)]
      .map((m) => m.index!)
      .filter((i) => !(span && i > span[0] && i < span[1]));
    expect(callSites.length).toBeGreaterThanOrEqual(13);
  });

  it('反向自检：调用点守卫必须能命中缺稳定 / 缺确定性的样本', () => {
    const bad = [
      "test('a', async ({ page }) => {",
      '  await installDeterminism(page);',
      "  await expectSnapshot(page, 'a.png');",
      '});',
    ].join('\n');
    expect(findSnapshotCallWithoutStable(bad).length).toBe(1);
    expect(findSnapshotCallWithoutDeterminism(bad)).toEqual([]);

    const bad2 = [
      "test('a', async ({ page }) => {",
      '  await waitForVisualStable(page);',
      "  await expectSnapshot(page, 'a.png');",
      '});',
    ].join('\n');
    expect(findSnapshotCallWithoutDeterminism(bad2).length).toBe(1);
    expect(findSnapshotCallWithoutStable(bad2)).toEqual([]);

    const good = [
      "test('a', async ({ page }) => {",
      '  await installDeterminism(page);',
      '  await waitForVisualStable(page);',
      "  await expectSnapshot(page, 'a.png');",
      '});',
    ].join('\n');
    expect(findSnapshotCallWithoutStable(good)).toEqual([]);
    expect(findSnapshotCallWithoutDeterminism(good)).toEqual([]);
  });
});
