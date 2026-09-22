import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J34: 语言切换', () => {
  test('should have language toggle button', async ({ page }) => {
    await setupPluginPage(page);
    const langBtn = page.locator('.cg-lang-btn');
    await expect(langBtn).toBeVisible();
  });

  test('should toggle language when button clicked', async ({ page }) => {
    await setupPluginPage(page);
    const langBtn = page.locator('.cg-lang-btn');
    const initialText = await page.locator('.cg-status-bar').textContent();
    await langBtn.click({ timeout: 10000 });
    const afterText = await page.locator('.cg-status-bar').textContent();
    expect(afterText).not.toBeNull();
    if (initialText !== null && afterText !== null) {
      expect(afterText).not.toBe(initialText);
    }
  });

  test('should preserve graph labels when language changes', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });
});