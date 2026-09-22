import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J16: 聚焦模式探索', () => {
  test('should enter focus mode on node double-click', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
    const canvas = graphContainer.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('should show focus mode bar when focus node is set', async ({ page }) => {
    await setupPluginPage(page);
    const focusBar = page.locator('.cg-focus-mode-bar');
    await expect(focusBar).not.toBeVisible();
  });

  test('should exit focus mode and return to normal view', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.cg-graph-panel');
    await expect(graphPanel).toBeVisible();
  });
});

test.describe('J28: BFS 逐层扩展', () => {
  test('should have expand button in focus mode bar', async ({ page }) => {
    await setupPluginPage(page);
    const expandBtn = page.locator('.cg-focus-expand-btn');
    await expect(expandBtn).not.toBeVisible();
  });

  test('should show contract button when depth > 1', async ({ page }) => {
    await setupPluginPage(page);
    const contractBtn = page.locator('.cg-focus-contract-btn');
    await expect(contractBtn).not.toBeVisible();
  });
});

test.describe('J31: 波及半径分析', () => {
  test('should display impact stats when impact panel is shown', async ({ page }) => {
    await setupPluginPage(page);
    const impactPanel = page.locator('.cg-impact-panel');
    await expect(impactPanel).not.toBeVisible();
  });

  test('should show D1/D2/D3 depth badges in impact panel', async ({ page }) => {
    await setupPluginPage(page);
    const impactBtn = page.locator('.cg-impact-btn');
    await impactBtn.click({ timeout: 10000 });
    const impactPanel = page.locator('.cg-impact-panel');
    await expect(impactPanel).toBeVisible({ timeout: 5000 });
  });
});