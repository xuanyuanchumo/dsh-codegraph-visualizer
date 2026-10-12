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
 * 单张截图允许的差异像素数。
 *
 * 依据（cycle-90 实测，`maxDiffPixels: 0` 下的噪声底）：
 *
 *   - 钉死随机 + 时钟 + 取景之后，13 张里绝大多数是**逐位相同**；偶发的一张会有
 *     34 px 差异（ratio 0.00004），落在面板圆角/边缘的抗锯齿上，通道差 1-3。
 *   - 因此 500 相对噪声底有 ~14.7 倍余量，同时远小于「真实变化」的量级：
 *     一处字面色值改动（`--cg-success` → `#ff00ff`）实测 25-726 px，
 *     整幅图背景改动实测 77 万-79 万 px，节点位移上万 px。
 *   - 取值曾先定为 1500，但实测它会**吸收掉 726 px 的真实改动**（那正是本轮
 *     非空洞性探针发现的），所以收紧到 500。
 */
const MAX_DIFF_PIXELS = 500;

test('visual screenshots with assertions', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);

  await waitForGraphReady(page);
  await expect(page.locator(PANEL.root)).toBeVisible();
  await expect(page.locator(PANEL.toolbar)).toBeVisible();
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-01-default.png', { maxDiffPixels: MAX_DIFF_PIXELS });

  await selectLayout(page, 'dagre');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-dagre')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-02-dagre.png', { maxDiffPixels: MAX_DIFF_PIXELS });

  await selectLayout(page, 'circle');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-circle')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-03-circle.png', { maxDiffPixels: MAX_DIFF_PIXELS });

  await clickMoreItem(page, 'theme');
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-04-dark.png', { maxDiffPixels: MAX_DIFF_PIXELS });

  await clickSearchButton(page);
  await expect(page.locator(SEARCH.bar)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-05-search.png', { maxDiffPixels: MAX_DIFF_PIXELS });

  await page.keyboard.press('Escape');

  await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
  await expect(page.locator(DROPDOWN_CONTENT.exportMenu)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-06-export.png', { maxDiffPixels: MAX_DIFF_PIXELS });
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
  await expect(page).toHaveScreenshot('e2e-07-call-chain.png', { maxDiffPixels: MAX_DIFF_PIXELS });
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
  await expect(page).toHaveScreenshot('e2e-08-cycle.png', { maxDiffPixels: MAX_DIFF_PIXELS });
});

test('J15 path find screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.pathFind);
  await expect(page.locator(PANELS.pathBar)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-09-path-find.png', { maxDiffPixels: MAX_DIFF_PIXELS });
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
  await expect(page).toHaveScreenshot('e2e-10-impact.png', { maxDiffPixels: MAX_DIFF_PIXELS });
});

test('J7 filter panel screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickDataItem(page, DATA_ITEM.filterPanel);
  await expect(page.locator(FILTER.panel)).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-11-filter.png', { maxDiffPixels: MAX_DIFF_PIXELS });
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
  await expect(page).toHaveScreenshot('e2e-12-level-dropdown.png', { maxDiffPixels: MAX_DIFF_PIXELS });
});

test('more dropdown screenshot', async ({ page }) => {
  await installDeterminism(page);
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await openDropdown(page, TRIGGERS.more);
  await expect(page.locator('.cg-more-theme')).toBeVisible({ timeout: 10000 });
  await waitForVisualStable(page);
  await expect(page).toHaveScreenshot('e2e-13-more-dropdown.png', { maxDiffPixels: MAX_DIFF_PIXELS });
});
