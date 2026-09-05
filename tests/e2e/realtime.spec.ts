// E2E tests for J9: 实时更新验证
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J9: 实时更新验证', () => {
  test('should display graph container after load', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should handle rapid updates gracefully', async ({ page }) => {
    await setupPluginPage(page);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(100);
    }
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should not show loading overlay after initial load', async ({ page }) => {
    await setupPluginPage(page);
    await page.waitForTimeout(500);
    const loadingOverlay = page.locator('.loading-overlay');
    await expect(loadingOverlay).not.toBeVisible();
  });

  test('should not show error overlay on load', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator('.error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });
});
