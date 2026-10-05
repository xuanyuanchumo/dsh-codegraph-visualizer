// E2E tests for J7-J8: 过滤器使用, 图谱导出
//
// 筛选面板没有 `<select>`（`.cg-filter-select` 从未存在）：节点/边类型是 checkbox 网格。
// 导出下拉的按钮文案随 i18n 变化，所以断言锚 `cg-export-option-<value>` 类名而非文本。
import { test, expect } from '@playwright/test';
import { setupPluginPage, clickDataItem, clickMoreItem, openDropdown } from './helpers.ts';
import { FILTER, DATA_ITEM, TRIGGERS, DROPDOWN_CONTENT, EXPORT_ITEM, PANEL } from './selectors.ts';

test.describe('J7: 过滤器使用', () => {
  test('should filter by function type', async ({ page }) => {
    await setupPluginPage(page);
    await clickDataItem(page, DATA_ITEM.filterPanel);
    const fnCheckbox = page.locator(FILTER.nodeType('function'));
    await expect(fnCheckbox).toBeChecked();
    await fnCheckbox.click();
    await expect(fnCheckbox).not.toBeChecked();
  });

  test('should filter by class type', async ({ page }) => {
    await setupPluginPage(page);
    await clickDataItem(page, DATA_ITEM.filterPanel);
    const classCheckbox = page.locator(FILTER.nodeType('class'));
    await classCheckbox.click();
    await expect(classCheckbox).not.toBeChecked();
  });

  test('should reset filter to all types', async ({ page }) => {
    await setupPluginPage(page);
    await clickDataItem(page, DATA_ITEM.filterPanel);
    const fnCheckbox = page.locator(FILTER.nodeType('function'));
    await fnCheckbox.click();
    await expect(fnCheckbox).not.toBeChecked();

    await page.locator(FILTER.reset).click();
    await expect(fnCheckbox).toBeChecked();
  });

  test('should show all node type filter options', async ({ page }) => {
    await setupPluginPage(page);
    await clickDataItem(page, DATA_ITEM.filterPanel);
    // NODE_TYPES = function/class/variable/module/interface
    const nodeTypes = ['function', 'class', 'variable', 'module', 'interface'];
    for (const type of nodeTypes) {
      await expect(page.locator(FILTER.nodeType(type))).toBeVisible();
    }
  });
});

test.describe('J8: 图谱导出', () => {
  test('should show export dropdown on click', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator(TRIGGERS.export).click();
    await expect(page.locator(DROPDOWN_CONTENT.export)).toBeVisible();
  });

  test('should have PNG export option', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
    await expect(page.locator(EXPORT_ITEM.png)).toBeVisible();
  });

  test('should have SVG export option', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
    await expect(page.locator(EXPORT_ITEM.svg)).toBeVisible();
  });

  test('should have JSON export option', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.export, DROPDOWN_CONTENT.export);
    await expect(page.locator(EXPORT_ITEM.json)).toBeVisible();
  });
});

test.describe('J10: 主题与个性化', () => {
  test('should toggle theme', async ({ page }) => {
    await setupPluginPage(page);
    const themeBefore = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    await clickMoreItem(page, 'theme');
    await page.waitForTimeout(300);
    const themeAfter = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    expect(themeAfter).not.toBe(themeBefore);
    await expect(page.locator(PANEL.root)).toBeVisible();
  });

  test('should toggle theme twice and return to original', async ({ page }) => {
    await setupPluginPage(page);
    const themeBefore = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    await clickMoreItem(page, 'theme');
    await page.waitForTimeout(300);
    await clickMoreItem(page, 'theme');
    await page.waitForTimeout(300);
    const themeAfter = await page.evaluate(() => (window as any).__graphStore?.getState().theme ?? null);
    expect(themeAfter).toBe(themeBefore);
  });
});
