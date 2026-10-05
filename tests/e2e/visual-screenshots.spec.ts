// 视觉截图基线（`visual` project）。
//
// 截图路径统一在 `screenshots/`（`.gitignore` 已忽略，运行后可按需清理）。
// 所有交互都走 `helpers.ts` 的下拉辅助函数——工具栏模块化之后，
// 布局/视图/主题/搜索/筛选都不再是独立按钮。
import { test, expect } from '@playwright/test';
import {
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

test('visual screenshots with assertions', async ({ page }) => {
  await setupPluginPage(page);

  await waitForGraphReady(page);
  await expect(page.locator(PANEL.root)).toBeVisible();
  await expect(page.locator(PANEL.toolbar)).toBeVisible();
  await page.screenshot({ path: 'screenshots/e2e-01-default.png' });

  await selectLayout(page, 'dagre');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-dagre')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/e2e-02-dagre.png' });

  await selectLayout(page, 'circle');
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await expect(page.locator('.cg-layout-option-circle')).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/e2e-03-circle.png' });

  await clickMoreItem(page, 'theme');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/e2e-04-dark.png' });

  await clickSearchButton(page);
  await expect(page.locator(SEARCH.bar)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-05-search.png' });

  await page.keyboard.press('Escape');

  await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
  await expect(page.locator(DROPDOWN_CONTENT.exportMenu)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-06-export.png' });
});

test('J4 call chain screenshot', async ({ page }) => {
  // 调用链属 behavioral 层，默认 code 视图下「工具」下拉不渲染该开关。
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.chain);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/e2e-07-call-chain.png' });
});

test('J5 cycle detection screenshot', async ({ page }) => {
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.cycles);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/e2e-08-cycle.png' });
});

test('J15 path find screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.pathFind);
  await expect(page.locator(PANELS.pathBar)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-09-path-find.png' });
});

test('J23 impact analysis screenshot', async ({ page }) => {
  await setupPluginPageInBehavioralLayer(page);
  await waitForGraphReady(page);
  await clickToolItem(page, TOOL_ITEM.impact);
  await openDropdown(page, TRIGGERS.tools);
  await expect(page.locator(TOOL_ITEM.impact)).toHaveClass(/cg-active/, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/e2e-10-impact.png' });
});

test('J7 filter panel screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await clickDataItem(page, DATA_ITEM.filterPanel);
  await expect(page.locator(FILTER.panel)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-11-filter.png' });
});

// cycle-81 新增：把 J39 层级导航与「更多」下拉纳入视觉基线，
// 这两个入口是本次选择器收口的主要受益者。
test('J39 hierarchy dropdown screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
  await expect(page.locator('.cg-level-option-0')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-12-level-dropdown.png' });
});

test('more dropdown screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await waitForGraphReady(page);
  await openDropdown(page, TRIGGERS.more);
  await expect(page.locator('.cg-more-theme')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/e2e-13-more-dropdown.png' });
});
