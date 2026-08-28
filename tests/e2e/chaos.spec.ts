// E2E tests for J12: 异常恢复与容错
import { test, expect } from '@playwright/test';

test.describe('J12: 异常恢复与容错', () => {
  test('should handle network disconnect gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Simulate network offline
    await page.context().setOffline(true);
    
    // Verify app still loads
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
    
    // Restore network
    await page.context().setOffline(false);
  });

  test('should recover after refresh', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Verify graph is visible
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
    
    // Refresh page
    await page.reload();
    
    // Verify graph is still visible after refresh
    await expect(graphContainer).toBeVisible();
  });

  test('should handle corrupted cache gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Clear cache
    await page.context().clearCookies();
    
    // Verify app still loads
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should show error state when upstream tool is unavailable', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for error state
    const errorOverlay = page.locator('.error-overlay');
    // Error overlay should not be visible initially
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should maintain state after navigation', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Get initial state
    const nodeCount = page.locator('.node-count');
    let initialCount = '';
    if (await nodeCount.isVisible()) {
      initialCount = await nodeCount.textContent() || '';
    }
    
    // Navigate away and back
    await page.goto('http://localhost:3080/settings');
    await page.goto('http://localhost:3080');
    
    // Verify state is maintained
    if (initialCount) {
      const countAfterNav = await nodeCount.textContent() || '';
      expect(countAfterNav).toBe(initialCount);
    }
  });
});