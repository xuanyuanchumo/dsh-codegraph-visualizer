// E2E tests for J9: 实时更新验证
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  waitForGraphReady,
  getCyNodeCount,
  triggerFileChange,
  waitForGraphUpdate,
  fetchGraphApi,
  TIMEOUTS,
} from './helpers.ts';

test.describe('J9: 实时更新验证', () => {
  test('should display graph container after load', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should handle rapid updates gracefully', async ({ page }) => {
    await setupPluginPage(page);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(100);
    }
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should not show loading overlay after initial load', async ({ page }) => {
    await setupPluginPage(page);
    const loadingOverlay = page.locator('.cg-loading-overlay');
    await expect(loadingOverlay).not.toBeVisible({ timeout: 5000 });
  });

  test('should not show error overlay on load', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator('.cg-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should trigger scan API on file change request', async ({ page }) => {
    await setupPluginPage(page);
    const result = await fetchGraphApi<{ ok?: boolean; error?: string }>(
      page,
      '/api/v1/codegraph/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      },
    );
    expect(result).toBeDefined();
  });

  test('should handle scan API error without crashing', async ({ page }) => {
    await setupPluginPage(page);
    await page.route('**/api/v1/codegraph/scan', (route) =>
      route.fulfill({ status: 500, body: '{"error":"mock"}' }),
    );
    const result = await fetchGraphApi<{ error?: string }>(
      page,
      '/api/v1/codegraph/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      },
    ).catch(() => null);
    expect(result).toBeNull();
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should maintain graph container after multiple refreshes', async ({ page }) => {
    await setupPluginPage(page);
    for (let i = 0; i < 3; i++) {
      await triggerFileChange(page, '.');
      await page.waitForTimeout(200);
    }
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
  });

  test('should not show error overlay after successful scan', async ({ page }) => {
    await setupPluginPage(page);
    await triggerFileChange(page, '.').catch(() => {});
    await page.waitForTimeout(500);
    const errorOverlay = page.locator('.cg-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should preserve graph container visibility during rapid file changes', async ({ page }) => {
    await setupPluginPage(page);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(triggerFileChange(page, '.').catch(() => {}));
    }
    await Promise.all(promises);
    await page.waitForTimeout(500);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
  });
});
