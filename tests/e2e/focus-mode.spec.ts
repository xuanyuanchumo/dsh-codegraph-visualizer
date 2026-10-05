import { test, expect } from '@playwright/test';
import { setupPluginPage, setupPluginPageInBehavioralLayer, clickToolItem, TIMEOUTS } from './helpers.ts';
import { PANEL, PANELS, ANALYSIS_PANEL, TOOL_ITEM } from './selectors.ts';
test.describe('J16: 聚焦模式探索', () => {
  test('should enter focus mode on node double-click', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();
    const canvas = graphContainer.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('should show focus mode bar when focus node is set', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANELS.focusModeBar)).not.toBeVisible();
  });

  test('should exit focus mode and return to normal view', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.root)).toBeVisible();
  });
});

test.describe('J28: BFS 逐层扩展', () => {
  test('should have expand button in focus mode bar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANELS.focusExpand)).not.toBeVisible();
  });

  test('should show contract button when depth > 1', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANELS.focusContract)).not.toBeVisible();
  });
});

test.describe('J31: 波及半径分析', () => {
  test('should display impact stats when impact panel is shown', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(ANALYSIS_PANEL.impact)).not.toBeVisible();
  });

  test('should show D1/D2/D3 depth badges in impact panel', async ({ page }) => {
    // 影响分析属 behavioral 层：默认的 code 视图下该开关根本不会渲染
    // （`getAvailablePanels` 按 `getViewLayer(viewMode)` 过滤工具下拉）。
    await setupPluginPageInBehavioralLayer(page);
    // 影响分析开关位于「工具」下拉内（`cg-tools-dropdown-btn`），未展开时不在 DOM 中。
    await clickToolItem(page, TOOL_ITEM.impact);
    await expect(page.locator(ANALYSIS_PANEL.impact)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});