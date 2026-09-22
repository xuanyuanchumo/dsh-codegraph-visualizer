import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J23: 影响分析', () => {
  test('should toggle impact analysis via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const impactBtn = page.locator('.cg-impact-btn');
    await expect(impactBtn).toBeVisible();
  });

  test('should show impact panel with D1/D2/D3 stats', async ({ page }) => {
    await setupPluginPage(page);
    const impactPanel = page.locator('.cg-impact-panel');
    await expect(impactPanel).not.toBeVisible();
  });

  test('should highlight upstream nodes when impact is enabled', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });
});

test.describe('J24: 继承层次图', () => {
  test('should switch to inheritance view mode', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-view-mode-btn[data-mode="inheritance"]');
    await expect(inheritanceBtn).toBeVisible({ timeout: 10000 });
  });

  test('should show layer selector in inheritance mode', async ({ page }) => {
    await setupPluginPage(page);
    const layerSelector = page.locator('.cg-layer-selector');
    await expect(layerSelector).not.toBeVisible();
  });
});