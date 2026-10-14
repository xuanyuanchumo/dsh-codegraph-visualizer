// 视觉回归基线（`visual` project）。
//
// ## 这个文件在 cycle-90 之前是什么
//
// 它曾经只有 13 处裸 `page.screenshot({ path: 'screenshots/e2e-NN-*.png' })`：
// 截图存进 `.gitignore:33` 忽略的 `screenshots/`，**零像素比对**，`visual` project
// 也不在 CI 里。也就是说「视觉回归」这个名字下面没有任何回归能力——两跑对照实测
// 13 张里 12 张像素不同（平均 19.38%、最高 35.75%），却没有任何一条断言会失败。
//
// ## 现在它断言什么
//
// 全部改为 `expect(page).toHaveScreenshot(name, { maxDiffPixels })`，基线落在
// `tests/e2e/__screenshots__/<project>/...`（该目录**不在** `.gitignore` 里，
// 已用 `git check-ignore` 验证，可纳入版本控制）。
//
// 像素比对的前提是画面确定，而画面之前并不确定。两个来源在
// `installDeterminism()` 里被钉死（随机初始位置 + 状态栏实时时钟），
// 第三个来源（面板展开时机 / 点击自动滚动 / 布局收敛）由 `waitForVisualStable()`
// 负责。三者的取证见 `tests/e2e/helpers.ts` 里两个函数的中文注释。
//
// ## 维护约定
//
// 任何一处新截图都必须同时调用 `waitForVisualStable()`；
// `tests/unit/visualBaselineContract.test.ts` 会按源码计数强制这一点，
// 并禁止本目录再次出现裸 `page.screenshot`。
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  installDeterminism,
  waitForVisualStable,
  setupPluginPage,
  setupPluginPageInBehavioralLayer,
  waitForGraphReady,
  selectLayout,
  clickMoreItem,
  clickSearchButton,
  clickToolItem,
  clickDataItem,
  openDropdown,
} from './helpers.ts';
import {
  PANEL,
  TRIGGERS,
  DROPDOWN_CONTENT,
  SEARCH,
  TOOL_ITEM,
  DATA_ITEM,
  FILTER,
  PANELS,
} from './selectors.ts';

/**
 * 每张截图的差异预算（P3-R26-03，cycle-92）。
 *
 * ## 为什么不能再是一个全局常量
 *
 * cycle-90 落地时只有 `const MAX_DIFF_PIXELS = 500`，13 张图共用一个值。那个 500 是为
 * **最差的那张**定的，于是对**逐位相同**的那些图它同时是「无谓余量」和「比真实改动小一个
 * 数量级的漏检窗口」——两者都是全局值的必然结果，不是某张图的属性。
 *
 * 更要紧的是**新截图没有预算决策**：往文件里加一处 `toHaveScreenshot('x.png')` 时，全局
 * 常量让作者什么都不用想，于是「这张图的画面稳定性证据在哪」永远不会被问一次。本表把这件事
 * 变成显式声明：**未登记的截图名会抛错**（见 `screenshotBudget`），无法静默回落到默认值。
 *
 * ## 值从哪来（实测，不是估计）
 *
 * 口径：把预算压到 `maxDiffPixels: 0` 跑 `visual` project，Playwright 对每张图报出
 * 「N pixels (ratio r) are different」——那就是该图相对**已提交基线**的真实噪声底。
 *
 * cycle-92 实测四轮（1 轮 cycle-90 + 3 轮本轮，每轮都是完整 13 张）：
 *
 *   - 每轮的**最大差异恒为 34 px**（ratio 0.00004），落在面板圆角/边缘的抗锯齿上；
 *   - 但**出问题的是哪张图每轮都不同**（第 1 轮 `e2e-10-impact`、第 2 轮 `e2e-07-call-chain`、
 *     第 3 轮 `e2e-07` 与 `e2e-08`）——其余图当轮是**逐位相同**（0 px）。
 *
 * 这个分布否掉了「逐图取不同阈值」的直觉做法：**噪声不是某张图的属性，而是每轮随机落在
 * 少数几张图上的抗锯齿抖动**。给每张图各写一个实测值等于把四轮的随机采样固化下来，下一轮
 * 换一张图抖就红了。所以 13 张取**同一个值**，而这个"同一个值"是有依据的同一个值，与
 * "懒得想所以全局一个数"不同——后者没有证据，前者有。
 *
 * 取值 **60**：噪声上界 34 的 1.76 倍（四轮观测到的最大值就是 34，60 留出 26 px 余量），
 * 同时比最小可检出的真实改动（726 px，cycle-90 实测的一处字面色值改动）低 12 倍。
 * 因此 60 相对 cycle-90 的 500 是**严格更严**的门：500 能拦的真实改动 60 全部能拦，
 * 而 60 多拦下了 60-500 px 这一整段此前的盲区。
 *
 * ## 这个门**看不见**什么（诚实披露，别把它当万能）
 *
 * cycle-90 还实测到一类**小于噪声底的真实改动**：改一个 CSS 变量能让画面差 25 px。
 * 25 < 34，意味着这类回归**在原理上不可能被像素门捕获**——把它压到噪声以下只会换来随机红。
 * 这类改动由 `tests/unit/tokensContract.test.ts`（令牌/主题契约）与
 * `tests/unit/styleSelectorContract.test.ts`（样式选择器契约）在源码层持有，
 * 不是本文件的职责。**像素门守"画面被整体改变"，源码门守"某个声明失效"。**
 *
 * 若某张图某轮实测明显大于 34，先查确定性（`installDeterminism` / `waitForVisualStable`），
 * 不要把预算调大——调大正是 cycle-90 差点做错的那件事。
 */
const SCREENSHOT_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  'e2e-01-default.png': 60,
  'e2e-02-dagre.png': 60,
  'e2e-03-circle.png': 60,
  'e2e-04-dark.png': 60,
  'e2e-05-search.png': 60,
  'e2e-06-export.png': 60,
  'e2e-07-call-chain.png': 60,
  'e2e-08-cycle.png': 60,
  'e2e-09-path-find.png': 60,
  'e2e-10-impact.png': 60,
  'e2e-11-filter.png': 60,
  'e2e-12-level-dropdown.png': 60,
  'e2e-13-more-dropdown.png': 60,
});

/**
 * 单张截图预算的**硬上限**。
 *
 * 存在的理由：P3-R26-03 的原始缺陷是"一个全局常量管 13 张图"。若改成逐图可配但**没有上限**，
 * 那么下一次红的时候最小阻力路径仍然是"把这一个数字调大"——缺陷只是换了个更精细的外形。
 * 上限把"调预算"从随手动作变成必须先改契约测试的显式决定。
 *
 * 600 的由来：必须不低于 cycle-90 的 500（那是当时实测能拦住 726 px 真实改动的经验上界），
 * 又必须明显低于真实改动的量级。当前 13 张实际用 60，离上限有 10 倍余量。
 */
export const SCREENSHOT_BUDGET_CEILING = 600;

/**
 * 取该张截图的差异预算。
 *
 * **未知截图名必须响亮失败**，不能回落成某个默认值：回落会让「新加一张图、忘了想预算」
 * 与「这张图就该用默认值」变成同一种可观察行为，而前者正是 P3-R26-03 要拦的东西。
 * 报错信息直接给出可粘贴的表行。
 */
export function screenshotBudget(name: string): number {
  const budget = SCREENSHOT_BUDGETS[name];
  if (budget === undefined) {
    throw new Error(
      `screenshotBudget: "${name}" 未登记差异预算。新增截图必须在本文件的 ` +
        'SCREENSHOT_BUDGETS 里显式登记：先按 maxDiffPixels: 0 跑一遍 visual project ' +
        '读出该图的实测噪声底（Playwright 报 "N pixels (ratio r) are different"），' +
        '再对照文件头的实测分布说明决定取值——不要直接把预算调大来让红变绿。'
    );
  }
  if (budget > SCREENSHOT_BUDGET_CEILING) {
    throw new Error(
      `screenshotBudget: "${name}" 的预算 ${budget} 超过硬上限 ${SCREENSHOT_BUDGET_CEILING}。` +
        '调大预算不是修回归：先查 installDeterminism / waitForVisualStable 是否失效，' +
        '确认画面确实更抖之后，再显式抬高 SCREENSHOT_BUDGET_CEILING 并在契约测试里说明理由。'
    );
  }
  return budget;
}

/** 按快照名取预算并断言该图确实渲染出来了。 */
async function expectSnapshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name, { maxDiffPixels: screenshotBudget(name) });
}

test('visual screenshots with assertions', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);

  await waitForGraphReady(page);
  await expect(page.locator(PANEL.root)).toBeVisible();
  await expect(page.locator(PANEL.toolbar)).toBeVisible();
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-01-default.png');

  await selectLayout(page, 'dagre');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-dagre')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-02-dagre.png');

  await selectLayout(page, 'circle');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-circle')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-03-circle.png');

  await clickMoreItem(page, 'theme');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-04-dark.png');

  await clickSearchButton(page);
  await expect(page.locator(SEARCH.bar)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-05-search.png');

  await page.keyboard.press('Escape');

  await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
  await expect(page.locator(DROPDOWN_CONTENT.exportMenu)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-06-export.png');
});

test('J4 call chain screenshot', async ({ page }) => {
  await installDeterminism(page);
  // 调用链属 behavioral 层，默认 code 视图下「工具」下拉不渲染该开关。
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.chain);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-07-call-chain.png');
});

test('J5 cycle detection screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.cycles);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-08-cycle.png');
});

test('J15 path find screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.pathFind);
  await expect(page.locator(PANELS.pathBar)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-09-path-find.png');
});

test('J23 impact analysis screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.impact);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.impact)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-10-impact.png');
});

test('J7 filter panel screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickDataItem(page, DATA_ITEM.filterPanel);
  await expect(page.locator(FILTER.panel)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-11-filter.png');
});

// cycle-81 新增：把 J39 层级导航与「更多」下拉纳入视觉基线，
// 这两个入口是本次选择器收口的主要受益者。
test('J39 hierarchy dropdown screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
  await expect(page.locator('.cg-level-option-0')).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-12-level-dropdown.png');
});

test('more dropdown screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await openDropdown(page, TRIGGERS.more);
  await expect(page.locator('.cg-more-theme')).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expectSnapshot(page, 'e2e-13-more-dropdown.png');
});