// E2E user journey: API modal → plugin entry → feature verification
import { test, expect, type Page } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('Full user journey: API modal → plugin entry', () => {
  test('J0: should start dsh web, dismiss API modal, and load plugin', async ({ page }) => {
    await page.goto('http://localhost:3080');
    const apiModal = page.locator('#api-modal');
    await expect(apiModal).toBeVisible({ timeout: 10000 });
    await page.locator('#api-skip-btn').click();
    await expect(apiModal).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('#api-status')).toContainText(/Skipped|configure later/i);
    await expect(page.locator('.graph-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.graph-toolbar')).toBeVisible();
    await expect(page.locator('.graph-container')).toBeVisible();
  });

  test('J1: should display graph panel with toolbar and status bar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator('.graph-panel')).toBeVisible();
    await expect(page.locator('.graph-toolbar')).toBeVisible();
    await expect(page.locator('.status-bar')).toBeVisible();
  });

  test('J6: should switch layouts via toolbar buttons', async ({ page }) => {
    await setupPluginPage(page);
    const dagreBtn = page.locator('.layout-btn', { hasText: 'dagre' });
    await dagreBtn.click();
    await expect(dagreBtn).toHaveClass(/active/);
    const circleBtn = page.locator('.layout-btn', { hasText: 'circle' });
    await circleBtn.click();
    await expect(circleBtn).toHaveClass(/active/);
  });

  test('J10: should toggle theme via theme button', async ({ page }) => {
    await setupPluginPage(page);
    const themeBtn = page.locator('.theme-btn');
    await themeBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.graph-panel')).toBeVisible();
  });

  test('J3: should open search bar via search button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.search-btn').click();
    await expect(page.locator('.search-bar')).toBeVisible();
    await expect(page.locator('.search-bar input')).toBeFocused();
  });

  test('J7: should change filter via filter select', async ({ page }) => {
    await setupPluginPage(page);
    const filterSelect = page.locator('.filter-select');
    await filterSelect.selectOption('function');
    await expect(filterSelect).toHaveValue('function');
  });

  test('J8: should open export dropdown on click', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.export-btn').click();
    await expect(page.locator('.export-dropdown')).toBeVisible();
  });

  test('should collapse and expand panel', async ({ page }) => {
    await setupPluginPage(page);
    const collapseBtn = page.locator('.collapse-btn');
    const panel = page.locator('.graph-panel');
    await collapseBtn.click();
    await expect(panel).toHaveClass(/collapsed/);
    await page.locator('.collapse-fab').click();
    await expect(panel).not.toHaveClass(/collapsed/);
  });

  test('should show node count in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator('.node-count')).toBeVisible();
    const text = await page.locator('.node-count').textContent();
    expect(text).toMatch(/nodes|n\b/i);
  });
});
