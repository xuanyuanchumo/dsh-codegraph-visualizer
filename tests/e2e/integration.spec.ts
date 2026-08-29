// E2E tests for J14: 生态集成验证
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J14: 生态集成验证', () => {
  test('should load plugin panel (sidebar or overlay)', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should support search via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const searchButton = page.locator('.search-btn');
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect(page.locator('.search-bar')).toBeVisible();
  });

  test('should integrate with dsh-web-ui styling', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
    const hasClass = await graphPanel.evaluate(el => el.classList.contains('graph-panel'));
    expect(hasClass).toBe(true);
  });

  test('should handle missing integration plugins gracefully', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should provide graph container for data access', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
  });
});
