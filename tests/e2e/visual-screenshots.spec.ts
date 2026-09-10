import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test('visual screenshots', async ({ page }) => {
  await setupPluginPage(page);
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/e2e-01-default.png' });
  
  const dagreBtn = page.locator('.layout-btn', { hasText: 'dagre' });
  await dagreBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/e2e-02-dagre.png' });
  
  const circleBtn = page.locator('.layout-btn', { hasText: 'circle' });
  await circleBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/e2e-03-circle.png' });
  
  const themeBtn = page.locator('.theme-btn');
  await themeBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-04-dark.png' });
  
  const searchBtn = page.locator('.search-btn');
  await searchBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-05-search.png' });
  
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  
  const exportBtn = page.locator('.export-btn');
  await exportBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-06-export.png' });
});