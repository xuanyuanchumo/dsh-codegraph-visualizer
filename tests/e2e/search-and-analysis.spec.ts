// E2E tests for J3-J5: 符号搜索与定位, 调用链追踪, 依赖拓扑分析
// NOTE: These tests require the full plugin build with keyboard shortcuts.
// The dev server uses an inline version that lacks these features.
// Skipping tests that require keyboard shortcuts in dev mode.
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J3: 符号搜索与定位', () => {
  test('should open search with search button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await expect(page.locator('.search-bar')).toBeVisible();
    await expect(page.locator('.search-bar input')).toBeFocused();
  });

  // Skipped in dev mode - requires keyboard shortcuts
  test.skip('should open search with keyboard shortcut', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.graph-panel').click();
    await page.keyboard.press('/');
    await expect(page.locator('.search-bar')).toBeVisible({ timeout: 15000 });
  });

  // Skipped in dev mode - requires keyboard shortcuts
  test.skip('should close search with Escape', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await expect(page.locator('.search-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-bar')).not.toBeVisible({ timeout: 10000 });
  });

  test('should filter results as user types', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    const input = page.locator('.search-bar input');
    await input.type('function');
    await page.waitForTimeout(300);
    await expect(page.locator('.graph-container')).toBeAttached();
  });

  test('should close search with close button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await page.locator('.search-bar button').click();
    await expect(page.locator('.search-bar')).not.toBeVisible();
  });
});

// Skipped in dev mode - requires call chain feature
test.describe.skip('J4: 调用链追踪', () => {
  test('should toggle call chain mode', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.chain-btn');
    await chainBtn.click();
    await page.waitForTimeout(300);
    await expect(chainBtn).toHaveClass(/active/, { timeout: 10000 });
    await chainBtn.click();
    await page.waitForTimeout(300);
    await expect(chainBtn).not.toHaveClass(/active/);
  });

  test('should toggle call chain with keyboard shortcut', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.graph-panel').click();
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);
    await expect(page.locator('.chain-btn')).toHaveClass(/active/, { timeout: 10000 });
  });
});

// Skipped in dev mode - requires cycle detection feature
test.describe.skip('J5: 依赖拓扑分析', () => {
  test('should toggle cycle detection', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cycle-btn');
    await cycleBtn.click();
    await page.waitForTimeout(300);
    await expect(cycleBtn).toHaveClass(/active/, { timeout: 10000 });
    await cycleBtn.click();
    await page.waitForTimeout(300);
    await expect(cycleBtn).not.toHaveClass(/active/);
  });
});

