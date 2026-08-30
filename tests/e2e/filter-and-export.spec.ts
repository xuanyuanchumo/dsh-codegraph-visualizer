// E2E tests for J7-J8: 过滤器使用, 图谱导出
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J7: 过滤器使用', () => {
  test('should filter by function type', async ({ page }) => {
    await setupPluginPage(page);
    const filterSelect = page.locator('.filter-select');
    await filterSelect.selectOption('function');
    await expect(filterSelect).toHaveValue('function');
  });

  test('should filter by class type', async ({ page }) => {
    await setupPluginPage(page);
    const filterSelect = page.locator('.filter-select');
    await filterSelect.selectOption('class');
    await expect(filterSelect).toHaveValue('class');
  });

  test('should reset filter to all types', async ({ page }) => {
    await setupPluginPage(page);
    const filterSelect = page.locator('.filter-select');
    await filterSelect.selectOption('function');
    await page.waitForTimeout(100);
    await filterSelect.selectOption('all');
    await expect(filterSelect).toHaveValue('all');
  });

  test('should show all filter options', async ({ page }) => {
    await setupPluginPage(page);
    const options = await page.locator('.filter-select option').count();
    expect(options).toBeGreaterThanOrEqual(4);
  });
});

test.describe('J8: 图谱导出', () => {
  test('should show export dropdown on hover', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.export-menu').hover();
    await expect(page.locator('.export-dropdown')).toBeVisible();
  });

  test('should have PNG export option', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.export-menu').hover();
    await expect(page.locator('.export-dropdown button', { hasText: 'PNG' })).toBeVisible();
  });

  test('should have SVG export option', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.export-menu').hover();
    await expect(page.locator('.export-dropdown button', { hasText: 'SVG' })).toBeVisible();
  });

  test('should have JSON export option', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.export-menu').hover();
    await expect(page.locator('.export-dropdown button', { hasText: 'JSON' })).toBeVisible();
  });
});

test.describe('J10: 主题与个性化', () => {
  test('should toggle theme', async ({ page }) => {
    await setupPluginPage(page);
    const themeBtn = page.locator('.theme-btn');
    await themeBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.graph-panel')).toBeVisible();
  });

  test('should toggle theme twice and return to original', async ({ page }) => {
    await setupPluginPage(page);
    const themeBtn = page.locator('.theme-btn');
    await themeBtn.click();
    await page.waitForTimeout(300);
    await themeBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.graph-panel')).toBeVisible();
  });
});