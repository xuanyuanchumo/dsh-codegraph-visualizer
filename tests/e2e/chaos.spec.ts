// E2E tests for J12: 异常恢复与容错
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J12: 异常恢复与容错', () => {
  test('should handle network disconnect gracefully', async ({ page }) => {
    await setupPluginPage(page);
    await page.context().setOffline(true);
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
    await page.context().setOffline(false);
  });

  test('should recover after refresh', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeAttached();
    await page.reload({ timeout: 60000 });
    await page.locator('#api-skip-btn').click({ timeout: 15000 }).catch(() => {});
    await expect(page.locator('.graph-panel')).toBeVisible({ timeout: 45000 });
  });

  test('should handle corrupted cache gracefully', async ({ page }) => {
    await setupPluginPage(page);
    await page.context().clearCookies();
    const graphPanel = page.locator('.graph-panel');
    await expect(graphPanel).toBeVisible();
  });

  test('should not show error state on normal load', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator('.error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should maintain panel visibility after navigation', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.graph-panel');
    await expect(panel).toBeVisible();
    await page.goto('http://localhost:3080', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.locator('#api-skip-btn').click({ timeout: 15000 }).catch(() => {});
    await expect(page.locator('.graph-panel')).toBeVisible({ timeout: 45000 });
  });
});
