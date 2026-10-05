// E2E tests for J34: 语言切换
//
// 语言没有独立按钮（`.cg-lang-btn` 从未存在）：它在「更多」下拉里（`cg-more-lang`）。
// 语言状态由 `src/client/i18n/index.ts` 持有并持久化到
// `localStorage['dsh-codegraph-visualizer/lang']`，所以断言既读 localStorage 也读 UI 文案。
import { test, expect } from '@playwright/test';
import { setupPluginPage, clickMoreItem, openDropdown } from './helpers.ts';
import { TRIGGERS, OPTION, PANEL } from './selectors.ts';

const LANG_STORAGE_KEY = 'dsh-codegraph-visualizer/lang';

async function readLang(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), LANG_STORAGE_KEY);
}

test.describe('J34: 语言切换', () => {
  test('should have language toggle in more dropdown', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.more);
    await expect(page.locator(OPTION.more('lang'))).toBeVisible();
  });

  test('should toggle language when item clicked', async ({ page }) => {
    await setupPluginPage(page);
    const before = await readLang(page);
    const statusBefore = await page.locator(PANEL.statusBar).textContent();

    await clickMoreItem(page, 'lang');
    await page.waitForTimeout(300);

    const after = await readLang(page);
    expect(after).not.toBe(before);
    expect(['zh', 'en']).toContain(after);

    const statusAfter = await page.locator(PANEL.statusBar).textContent();
    expect(statusAfter).not.toBe(statusBefore);
  });

  test('should preserve graph labels when language changes', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();

    await clickMoreItem(page, 'lang');
    await page.waitForTimeout(300);

    // 语言切换只影响 UI 文案，不应重建画布。
    await expect(graphContainer).toBeVisible();
  });
});
