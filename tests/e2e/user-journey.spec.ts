// E2E user journey: API modal → plugin entry → feature verification
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  selectLayout,
  clickSearchButton,
  clickDataItem,
  clickMoreItem,
  openDropdown,
  BASE_URL,
} from './helpers.ts';
import { PANEL, TRIGGERS, SEARCH, FILTER, OPTION, DROPDOWN_CONTENT, DATA_ITEM } from './selectors.ts';

test.describe('Full user journey: API modal → plugin entry', () => {
  test('J0: should start dsh web, dismiss API modal, and load plugin', async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    const apiModal = page.locator('#api-modal');
    await expect(apiModal).toBeVisible({ timeout: 20000 });
    await page.locator('#api-skip-btn').click({ timeout: 15000 });
    await expect(apiModal).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('#api-status')).toContainText(/Skipped|configure later/i);
    await expect(page.locator(PANEL.root)).toBeVisible({ timeout: 45000 });
    await expect(page.locator(PANEL.toolbar)).toBeVisible();
    await expect(page.locator(PANEL.graphContainer)).toBeAttached();
  });

  test('J1: should display graph panel with toolbar and status bar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.root)).toBeVisible();
    await expect(page.locator(PANEL.toolbar)).toBeVisible();
    await expect(page.locator(PANEL.statusBar)).toBeVisible();
  });

  test('J6: should switch layouts via layout dropdown', async ({ page }) => {
    await setupPluginPage(page);
    await selectLayout(page, 'dagre');
    await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
    await expect(page.locator(OPTION.layout('dagre'))).toHaveClass(/cg-active/);
    await page.keyboard.press('Escape');

    await selectLayout(page, 'circle');
    await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
    await expect(page.locator(OPTION.layout('circle'))).toHaveClass(/cg-active/);
  });

  test('J10: should toggle theme via more dropdown', async ({ page }) => {
    await setupPluginPage(page);
    // 主题没有独立按钮，它只在「更多」下拉里（`cg-more-theme`）。
    // 断言读 store 的 `theme`：body 上的 `data-ds-dark-theme` 只是宿主同步用的镜像，
    // 首次切换不一定改变它（`GraphPanel.tsx:250-261` 只在切到 dark 时才 set）。
    const themeBefore = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    await clickMoreItem(page, 'theme');
    await page.waitForTimeout(300);
    const themeAfter = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    expect(themeAfter).not.toBe(themeBefore);
    expect(['dark', 'light']).toContain(themeAfter);
    await expect(page.locator(PANEL.root)).toBeVisible();
  });

  test('J3: should open search bar via search button', async ({ page }) => {
    await setupPluginPage(page);
    await clickSearchButton(page);
    await expect(page.locator(SEARCH.bar)).toBeVisible();
    await expect(page.locator(SEARCH.input)).toBeFocused();
  });

  test('J7: should change filter via filter panel checkboxes', async ({ page }) => {
    await setupPluginPage(page);
    // 筛选面板没有 `<select>`：节点类型是 checkbox 网格（`cg-filter-node-<type>`）。
    await clickDataItem(page, DATA_ITEM.filterPanel);
    await expect(page.locator(FILTER.panel)).toBeVisible();
    const fnCheckbox = page.locator(FILTER.nodeType('function'));
    await fnCheckbox.click();
    await expect(fnCheckbox).not.toBeChecked();
  });

  test('J8: should open export dropdown on click', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator(TRIGGERS.export).click();
    await expect(page.locator(DROPDOWN_CONTENT.export)).toBeVisible();
  });

  test('should collapse and expand panel', async ({ page }) => {
    await setupPluginPage(page);
    const collapseBtn = page.locator(TRIGGERS.collapse);
    const panel = page.locator(PANEL.root);
    await collapseBtn.click();
    await expect(panel).toHaveClass(/cg-collapsed/);
    await page.locator(PANEL.collapsedFab).click();
    await expect(panel).not.toHaveClass(/cg-collapsed/);
  });

  test('should show node count in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.nodeCount)).toBeVisible();
    const text = await page.locator(PANEL.nodeCount).textContent();
    expect(text).toMatch(/nodes|节点|n\b/i);
  });
});
