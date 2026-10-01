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
test('J4 call chain screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await page.waitForTimeout(2000);
  const chainBtn = page.locator('.cg-chain-btn');
  await chainBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-07-call-chain.png' });
});

test('J5 cycle detection screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await page.waitForTimeout(2000);
  const cycleBtn = page.locator('.cg-cycle-btn');
  await cycleBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-08-cycle.png' });
});

test('J15 path find screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await page.waitForTimeout(2000);
  const pathfindBtn = page.locator('.cg-pathfind-btn');
  await pathfindBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('.cg-path-bar')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/e2e-09-path-find.png' });
});

test('J23 impact analysis screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await page.waitForTimeout(2000);
  const impactBtn = page.locator('.cg-impact-btn');
  await impactBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-10-impact.png' });
});

test('J7 filter panel screenshot', async ({ page }) => {
  await setupPluginPage(page);
  await page.waitForTimeout(2000);
  const filterBtn = page.locator('.cg-filter-btn');
  await filterBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/e2e-11-filter.png' });
});