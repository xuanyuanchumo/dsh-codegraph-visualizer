import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test('visual screenshots with assertions', async ({ page }) => {
  await setupPluginPage(page);

  await page.waitForTimeout(3000);
  await expect(page.locator('.cg-graph-panel')).toBeVisible();
  await expect(page.locator('.cg-toolbar')).toBeVisible();
  await page.screenshot({ path: 'screenshots/e2e-01-default.png' });

  const dagreBtn = page.locator('.cg-layout-btn', { hasText: 'dagre' });
  await dagreBtn.click();
  await page.waitForTimeout(2000);
  await expect(dagreBtn).toHaveClass(/cg-active/);
  await page.screenshot({ path: 'screenshots/e2e-02-dagre.png' });

  const circleBtn = page.locator('.cg-layout-btn', { hasText: 'circle' });
  await circleBtn.click();
  await page.waitForTimeout(2000);
  await expect(circleBtn).toHaveClass(/cg-active/);
  await page.screenshot({ path: 'screenshots/e2e-03-circle.png' });

  const themeBtn = page.locator('.cg-theme-btn');
  await themeBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-04-dark.png' });

  const searchBtn = page.locator('.cg-search-btn');
  await searchBtn.click();
  await page.waitForTimeout(1000);
  await expect(page.locator('.cg-search-bar')).toBeVisible();
  await page.screenshot({ path: 'screenshots/e2e-05-search.png' });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const exportBtn = page.locator('.cg-export-btn');
  await exportBtn.click();
  await page.waitForTimeout(1000);
  await expect(page.locator('.cg-export-menu')).toBeVisible();
  await page.screenshot({ path: 'screenshots/e2e-06-export.png' });
});