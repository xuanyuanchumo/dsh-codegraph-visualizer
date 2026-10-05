// E2E tests for J27: Keyboard Shortcuts (FR-17)
// 按 `/` 打开搜索 → 按 `Ctrl+M` 切换缩略图 → 按 `Esc` 关闭面板
//
// 重要：键盘快捷键只切换 React 内部的面板可见性状态（`usePanelState`），
// 它**不会自动展开工具栏下拉**。而所有面板开关按钮都位于「工具」下拉内，
// 未展开时根本不在 DOM 中。所以断言按钮 `cg-active` 之前必须先展开对应下拉。
//
// 另一个前提：`getAvailablePanels(getViewLayer(viewMode))`（`src/shared/viewModeUtils.ts:78-88`）
// 按视图层过滤「工具」下拉条目——调用链/继承属于 behavioral 层，默认的 `code`
// 视图下它们根本不会渲染，所以涉及这两项的用例必须先切视图模式。
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  setupPluginPageInBehavioralLayer,
  openDropdown,
  TIMEOUTS,
} from './helpers.ts';
import { SEARCH, PANELS, TRIGGERS, TOOL_ITEM, HISTORY_ITEM } from './selectors.ts';

test.describe('J27: Keyboard Shortcuts (FR-17)', () => {
  test('按 / 应打开搜索框', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    // 搜索输入框没有 `cg-search-input` 类，它的稳定标识是 `id="graph-search"`。
    await expect(page.locator(SEARCH.input)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('按 Ctrl+M 应切换缩略图面板', async ({ page }) => {
    await setupPluginPage(page);
    // 缩略图面板根类名是 `cg-mini-map`（不是 `cg-minimap`）。
    const minimapPanel = page.locator(PANELS.miniMap);
    const initialVisible = await minimapPanel.isVisible().catch(() => false);
    await page.keyboard.press('Control+m', { delay: 50 });
    await page.waitForTimeout(300);
    const afterToggle = await minimapPanel.isVisible().catch(() => false);
    expect(afterToggle).not.toBe(initialVisible);
  });

  test('按 Escape 应关闭打开的面板', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    const searchInput = page.locator(SEARCH.input);
    await expect(searchInput).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await page.keyboard.press('Escape', { delay: 50 });
    await expect(searchInput).not.toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('按 ? 应打开键盘帮助对话框', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('Shift+?', { delay: 50 });
    // 帮助浮层没有 `cg-keyboard-help` 类；面板根是 `cg-keyboard-help-panel`。
    await expect(page.locator(PANELS.keyboardHelpPanel)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('按 Ctrl+Shift+C 应切换调用链面板', async ({ page }) => {
    // 调用链开关只在 behavioral 层渲染，先切视图模式再按键。
    await setupPluginPageInBehavioralLayer(page);
    await page.keyboard.press('Control+Shift+c', { delay: 50 });
    await page.waitForTimeout(300);
    // 真名是 `cg-chain-btn`（不是 `cg-call-chain-btn`），且只在「工具」下拉内。
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/);
  });

  test('按 Ctrl+H 应切换继承层次视图', async ({ page }) => {
    // 继承开关同属 behavioral 层。
    await setupPluginPageInBehavioralLayer(page);
    await page.keyboard.press('Control+h', { delay: 50 });
    await page.waitForTimeout(300);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.inheritance)).toHaveClass(/cg-active/);
  });

  test('在输入框中按 / 不应触发搜索打开', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('/', { delay: 50 });
    const searchInput = page.locator(SEARCH.input);
    await expect(searchInput).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await searchInput.fill('test');
    await page.keyboard.press('/', { delay: 50 });
    await expect(searchInput).toHaveValue('test/');
  });

  test('按 Ctrl+Z 应撤销操作', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('Control+z', { delay: 50 });
    await page.waitForTimeout(300);
    // 撤销按钮在「历史」下拉内，初始 disabled。
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.undo)).toBeDisabled();
  });

  test('按 Ctrl+Y 应重做操作', async ({ page }) => {
    await setupPluginPage(page);
    await page.keyboard.press('Control+y', { delay: 50 });
    await page.waitForTimeout(300);
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.redo)).toBeDisabled();
  });
});
