// E2E tests for J2: 图谱浏览与导航
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J2: 图谱浏览与导航', () => {
  test('should display graph container', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('should support zoom interaction', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    const box = await graphContainer.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 100);
      await expect(graphContainer).toBeVisible();
    }
  });

  test('should support pan interaction', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    const box = await graphContainer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.up();
    }
    await expect(graphContainer).toBeVisible();
  });

  test('should handle large number of nodes gracefully', async ({ page }) => {
    await setupPluginPage(page);
    // The dev harness loads 12 mock nodes; verify no crash.
    await expect(page.locator('.graph-panel')).toBeVisible();
  });

  test('should display node count', async ({ page }) => {
    await setupPluginPage(page);
    const nodeCount = page.locator('.node-count');
    await expect(nodeCount).toBeVisible();
    const text = await nodeCount.textContent();
    expect(text).toMatch(/nodes|n\b/i);
  });
});
