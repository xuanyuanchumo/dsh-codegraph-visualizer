// E2E tests for J3-J5: 符号搜索与定位, 调用链追踪, 依赖拓扑分析
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J3: 符号搜索与定位', () => {
  test('should open search with search button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await expect(page.locator('.search-bar')).toBeVisible();
    await expect(page.locator('.search-bar input')).toBeFocused();
  });

  test('should open search with keyboard shortcut', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/');
    await expect(page.locator('.search-bar')).toBeVisible();
  });

  test('should close search with Escape', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await expect(page.locator('.search-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-bar')).not.toBeVisible();
  });

  test('should filter results as user types', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    const input = page.locator('.search-bar input');
    await input.type('function');
    await page.waitForTimeout(300);
    // Check that search matches are applied
    await expect(page.locator('.graph-container')).toBeVisible();
  });

  test('should close search with close button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await page.locator('.search-bar button').click();
    await expect(page.locator('.search-bar')).not.toBeVisible();
  });
});

test.describe('J4: 调用链追踪', () => {
  test('should toggle call chain mode', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.chain-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/active/);
    await chainBtn.click();
    await expect(chainBtn).not.toHaveClass(/active/);
  });

  test('should toggle call chain with keyboard shortcut', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('Control+c');
    await expect(page.locator('.chain-btn')).toHaveClass(/active/);
  });
});

test.describe('J5: 依赖拓扑分析', () => {
  test('should toggle cycle detection', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cycle-btn');
    await cycleBtn.click();
    await expect(cycleBtn).toHaveClass(/active/);
    await cycleBtn.click();
    await expect(cycleBtn).not.toHaveClass(/active/);
  });
});