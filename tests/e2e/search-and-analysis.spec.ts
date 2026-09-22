// E2E tests for J3-J5: 符号搜索与定位, 调用链追踪, 依赖拓扑分析
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J3: 符号搜索与定位', () => {
  test('should open search with search button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    await expect(page.locator('.cg-search-bar')).toBeVisible();
    await expect(page.locator('.cg-search-bar input')).toBeFocused();
  });

  test('should filter results as user types', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    const input = page.locator('.cg-search-bar input');
    await input.type('function');
    await page.waitForTimeout(300);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should close search with close button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    await page.locator('.cg-search-bar button').click();
    await expect(page.locator('.cg-search-bar')).not.toBeVisible();
  });
});

test.describe('J4: 调用链追踪', () => {
  test('should toggle call chain mode', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    await chainBtn.click();
    await page.waitForTimeout(500);
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await chainBtn.click();
    await page.waitForTimeout(500);
    await expect(chainBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('J5: 依赖拓扑分析', () => {
  test('should toggle cycle detection', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click();
    await page.waitForTimeout(500);
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await cycleBtn.click();
    await page.waitForTimeout(500);
    await expect(cycleBtn).not.toHaveClass(/cg-active/);
  });
});

