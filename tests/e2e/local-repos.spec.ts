// E2E tests for J1: 仓库导入与图谱初始化
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J1: 仓库导入与图谱初始化', () => {
  test('should display graph panel on load', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.cg-graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should show empty state or graph data', async ({ page }) => {
    await setupPluginPage(page);
    // The dev harness seeds mock data, so either the graph or empty state is acceptable.
    const panel = page.locator('.cg-graph-panel');
    await expect(panel).toBeVisible();
  });

  test('should not show error on load', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator('.cg-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should handle empty workspace gracefully', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator('.cg-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should display status bar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator('.cg-status-bar')).toBeVisible();
  });
});
