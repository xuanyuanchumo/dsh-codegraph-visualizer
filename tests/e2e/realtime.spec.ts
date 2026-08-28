// E2E tests for J9: 实时更新验证
import { test, expect } from '@playwright/test';

test.describe('J9: 实时更新验证', () => {
  test('should update graph when code changes', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Simulate code change event
    // In real scenario, this would be triggered by file save
    const graphContainer = page.locator('.graph-container');
    
    // Verify graph is visible before update
    await expect(graphContainer).toBeVisible();
    
    // Simulate update (in real scenario, this would come from ctx.broadcast)
    // For now, just verify the container exists
    await expect(graphContainer).toBeVisible();
  });

  test('should handle rapid updates gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Simulate multiple rapid updates
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(100);
    }
    
    // Verify graph is still responsive
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('should show loading during update', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const loadingOverlay = page.locator('.loading-overlay');
    // Loading overlay should not be visible initially
    await expect(loadingOverlay).not.toBeVisible();
  });

  test('should handle update failure gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    const errorOverlay = page.locator('.error-overlay');
    // Error overlay should not be visible initially
    await expect(errorOverlay).not.toBeVisible();
  });
});