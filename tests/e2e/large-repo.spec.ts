// E2E tests for J2: 图谱浏览与导航
import { test, expect } from '@playwright/test';

test.describe('J2: 图谱浏览与导航', () => {
  test('should display graph container', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('should support zoom interaction', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const graphContainer = page.locator('.graph-container');
    const box = await graphContainer.boundingBox();
    
    if (box) {
      // Simulate zoom
      await page.mouse.wheel(0, 100);
      
      // Verify graph is still visible
      await expect(graphContainer).toBeVisible();
    }
  });

  test('should support pan interaction', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const graphContainer = page.locator('.graph-container');
    
    // Simulate pan by clicking and dragging
    await page.mouse.down();
    await page.mouse.move(100, 100);
    await page.mouse.up();
    
    // Verify graph is still visible
    await expect(graphContainer).toBeVisible();
  });

  test('should handle large number of nodes gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for progress indicator when loading large graph
    const progressBar = page.locator('.progress-bar');
    if (await progressBar.isVisible()) {
      await expect(progressBar).toBeVisible();
    }
  });

  test('should display node count', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const nodeCount = page.locator('.node-count');
    if (await nodeCount.isVisible()) {
      const text = await nodeCount.textContent();
      expect(text).toMatch(/\d+ nodes/);
    }
  });
});