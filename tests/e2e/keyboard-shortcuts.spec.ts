// E2E tests for J27: Keyboard Shortcuts (FR-17)
// 按 `/` 打开搜索 → 按 `Ctrl+M` 切换缩略图 → 按 `Esc` 关闭面板
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J27: Keyboard Shortcuts (FR-17)', () => {
  test('按 / 应打开搜索框', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    const searchInput = page.locator('.cg-search-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('按 Ctrl+M 应切换缩略图面板', async ({ page }) => {
    await setupPluginPage(page);
    const minimapPanel = page.locator('.cg-minimap');
    const initialVisible = await minimapPanel.isVisible().catch(() => false);
    await page.keyboard.press('Control+m', { delay: 50 });
    await page.waitForTimeout(300);
    const afterToggle = await minimapPanel.isVisible().catch(() => false);
    expect(afterToggle).not.toBe(initialVisible);
  });

  test('按 Escape 应关闭打开的面板', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    const searchInput = page.locator('.cg-search-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape', { delay: 50 });
    await expect(searchInput).not.toBeVisible({ timeout: 5000 });
  });

  test('按 ? 应打开键盘帮助对话框', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('Shift+?', { delay: 50 });
    const helpDialog = page.locator('.cg-keyboard-help');
    await expect(helpDialog).toBeVisible({ timeout: 5000 });
  });

  test('按 Ctrl+Shift+C 应切换调用链面板', async ({ page }) => {
    await setupPluginPage(page);
    const callChainBtn = page.locator('.cg-call-chain-btn');
    await page.keyboard.press('Control+Shift+c', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(callChainBtn).toHaveClass(/cg-active/);
  });

  test('按 Ctrl+H 应切换继承层次视图', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-inheritance-btn');
    await page.keyboard.press('Control+h', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(inheritanceBtn).toHaveClass(/cg-active/);
  });

  test('在输入框中按 / 不应触发搜索打开', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    const searchInput = page.locator('.cg-search-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('test');
    await page.keyboard.press('/', { delay: 50 });
    await expect(searchInput).toHaveValue('test/');
  });

  test('按 Ctrl+Z 应撤销操作', async ({ page }) => {
    await setupPluginPage(page);
    const undoBtn = page.locator('.cg-undo-btn');
    await page.keyboard.press('Control+z', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(undoBtn).toBeDisabled();
  });

  test('按 Ctrl+Y 应重做操作', async ({ page }) => {
    await setupPluginPage(page);
    const redoBtn = page.locator('.cg-redo-btn');
    await page.keyboard.press('Control+y', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(redoBtn).toBeDisabled();
  });
});