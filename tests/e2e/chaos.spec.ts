// E2E tests for J12: 异常恢复与容错
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';
import { PANEL } from './selectors.ts';

test.describe('J12: 异常恢复与容错', () => {
  test('should handle network disconnect gracefully', async ({ page }) => {
    await setupPluginPage(page);
    await page.context().setOffline(true);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
    await page.context().setOffline(false);
  });

  test('should recover after refresh', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeAttached();
    await page.reload({ timeout: 60000 });
    await page.locator('#api-skip-btn').click({ timeout: 15000 }).catch(() => {});
    await expect(page.locator(PANEL.root)).toBeVisible({ timeout: 45000 });
  });

  test('should handle corrupted cache gracefully', async ({ page }) => {
    await setupPluginPage(page);
    await page.context().clearCookies();
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });

  test('should not show error state on normal load', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator(PANEL.overlay);
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should maintain panel visibility after navigation', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator(PANEL.root);
    await expect(panel).toBeVisible();
    await page.goto('http://localhost:3080', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.locator('#api-skip-btn').click({ timeout: 15000 }).catch(() => {});
    await expect(page.locator(PANEL.root)).toBeVisible({ timeout: 45000 });
  });

  test('should handle WASM instantiation failure gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      const origInstantiate = WebAssembly.instantiate;
      Object.defineProperty(WebAssembly, 'instantiate', {
        value: () => Promise.reject(new Error('WASM unavailable')),
        writable: true,
        configurable: true,
      });
      void origInstantiate;
    });
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });

  test('should handle WASM compile failure gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      const origCompile = WebAssembly.compile;
      Object.defineProperty(WebAssembly, 'compile', {
        value: () => Promise.reject(new Error('WASM compile failed')),
        writable: true,
        configurable: true,
      });
      void origCompile;
    });
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });
});
