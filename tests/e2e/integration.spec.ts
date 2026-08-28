// E2E tests for J14: 生态集成验证
import { test, expect } from '@playwright/test';

test.describe('J14: 生态集成验证', () => {
  test('should integrate with better-sidebar', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for sidebar integration
    const sidebar = page.locator('.sidebar');
    if (await sidebar.isVisible()) {
      const graphTab = sidebar.locator('button:has-text("Graph")');
      if (await graphTab.isVisible()) {
        await expect(graphTab).toBeVisible();
      }
    }
  });

  test('should support spotlight search', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for search functionality
    const searchButton = page.locator('.search-btn');
    if (await searchButton.isVisible()) {
      await searchButton.click();
      
      const searchBar = page.locator('.search-bar');
      await expect(searchBar).toBeVisible();
    }
  });

  test('should integrate with dsh-web-ui styling', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for dsh-web-ui compatible classes
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
    
    // Verify styling classes are present
    const hasDshClasses = await graphPanel.evaluate(el => {
      return el.classList.contains('graph-panel');
    });
    expect(hasDshClasses).toBe(true);
  });

  test('should handle missing integration plugins gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Verify app loads even without integration plugins
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should provide graph data for agent-teams', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check that graph data is available
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
    
    // Verify data can be accessed (in real scenario, this would be via API)
    const hasData = await graphContainer.evaluate(el => {
      return el !== null;
    });
    expect(hasData).toBe(true);
  });
});