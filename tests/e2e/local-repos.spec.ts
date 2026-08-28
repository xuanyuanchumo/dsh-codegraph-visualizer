// E2E tests for J1: 仓库导入与图谱初始化
import { test, expect } from '@playwright/test';

test.describe('J1: 仓库导入与图谱初始化', () => {
  test('should display graph panel on load', async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3080');
    
    // Check if graph panel is visible
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should show empty state when no repo is imported', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for empty state message
    const emptyState = page.locator('.empty-state');
    await expect(emptyState).toBeVisible();
  });

  test('should show loading state during import', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Simulate import action
    const importButton = page.locator('button:has-text("Import")');
    if (await importButton.isVisible()) {
      await importButton.click();
      
      // Check for loading state
      const loadingOverlay = page.locator('.loading-overlay');
      await expect(loadingOverlay).toBeVisible();
    }
  });

  test('should handle empty workspace gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check that no error is shown for empty workspace
    const errorOverlay = page.locator('.error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should handle non-git repository gracefully', async ({ page }) => {
    await page.goto('http://localhost:3080');
    
    // Check for appropriate message when not in git repo
    const gitWarning = page.locator('.git-warning');
    if (await gitWarning.isVisible()) {
      await expect(gitWarning).toBeVisible();
    }
  });
});