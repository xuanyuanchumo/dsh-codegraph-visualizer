// E2E tests for J1: 仓库导入与图谱初始化
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';
import { PANEL } from './selectors.ts';

test.describe('J1: 仓库导入与图谱初始化', () => {
  test('should display graph panel with data or empty state', async ({ page }) => {
    await setupPluginPage(page);
    // The dev harness seeds mock data, so either the graph or empty state is acceptable.
    const panel = page.locator(PANEL.root);
    await expect(panel).toBeVisible();
    // No error overlay should appear on initial load
    const errorOverlay = page.locator(PANEL.overlay);
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should display status bar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.statusBar)).toBeVisible();
  });
});
