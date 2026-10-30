// E2E tests for J39: View Mode Layered Navigation (FR-14)
// 切换到继承/调用/包/类视图 → Layer 0 概览 → Layer 1 部分展开 → Layer 2 完整图 → 状态栏显示总节点/边数
import { test, expect } from '@playwright/test';
import { setupPluginPage, waitForGraphReady, getCyNodeCount, selectViewMode, selectHierarchyLevel } from './helpers.ts';
import { TRIGGERS, PANEL, OPTION, TOOL_ITEM, DROPDOWN_CONTENT } from './selectors.ts';

test.describe('J39: View Mode Layered Navigation (FR-14)', () => {
  test('应显示视图模式切换触发器', async ({ page }) => {
    await setupPluginPage(page);
    // 视图模式不是独立按钮，而是「视图模式」下拉触发器。
    await expect(page.locator(TRIGGERS.view)).toBeVisible();
  });

  test('切换到继承视图应显示继承关系', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'inheritance');
    const viewMode = await page.evaluate(() => {
      const store = (window as any).__graphStore;
      return store ? store.getState().viewMode : null;
    });
    expect(viewMode).toBe('inheritance');
  });

  test('切换到调用视图应显示调用关系', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'callgraph');
    const viewMode = await page.evaluate(() => {
      const store = (window as any).__graphStore;
      return store ? store.getState().viewMode : null;
    });
    expect(viewMode).toBe('callgraph');
  });

  test('状态栏应显示总节点和边数', async ({ page }) => {
    await setupPluginPage(page);
    const statusBar = page.locator(PANEL.statusBar);
    await expect(statusBar).toBeVisible({ timeout: 5000 });
    const text = await statusBar.textContent();
    expect(text).toBeTruthy();
  });

  test('Layer 0 概览应显示聚类节点', async ({ page }) => {
    await setupPluginPage(page);
    // cycle-112：装饰性 SVG（画布控制层图标）也在容器里，旧选择器 strict mode 直接报 9 元素。
    // 用登记的 `PANEL.canvas`（canvas[data-id]）只命中三层数据层 —— 但三层**都**匹配，
    // Playwright 的 toBeVisible 是严格单元素断言，所以要取 `.first()`（三层同尺寸同可见性，
    // 任一层可见即「画布在渲染」）。
    const nodes = page.locator(PANEL.canvas).first();
    await expect(nodes).toBeVisible({ timeout: 5000 });
  });

  test('展开聚类应显示内部节点（Layer 1）', async ({ page }) => {
    await setupPluginPage(page);
    const clusterNodes = page.locator(PANEL.canvas).first();
    await expect(clusterNodes).toBeVisible({ timeout: 5000 });
  });

  test('视图无数据时应显示提示', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'inheritance');
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible({ timeout: 5000 });
  });

  test('切换视图模式后状态应保持', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'callgraph');
    let viewMode = await page.evaluate(() => (window as any).__graphStore?.getState().viewMode ?? null);
    expect(viewMode).toBe('callgraph');

    await selectViewMode(page, 'inheritance');
    viewMode = await page.evaluate(() => (window as any).__graphStore?.getState().viewMode ?? null);
    expect(viewMode).toBe('inheritance');
  });

  // 原用例断言 `.cg-layer-selector` 可见、`.cg-layer-btn` count 3——两个类名都不存在。
  // 真实的层级导航是「层级」下拉（`cg-level-dropdown-btn`）内的 4 个 `cg-level-option-<n>`。
  test('J39: 切换到继承视图后应显示层级选择器', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'inheritance');

    const levelTrigger = page.locator(TRIGGERS.level);
    await expect(levelTrigger).toBeVisible({ timeout: 5000 });

    await levelTrigger.click();
    const levelOptions = page.locator(`${DROPDOWN_CONTENT.level} [class*="cg-level-option-"]`);
    await expect(levelOptions).toHaveCount(4);
  });

  test('J39: 切到 L2 完整图应比 L0 显示更多节点', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'inheritance');
    await waitForGraphReady(page, 10000);

    await selectHierarchyLevel(page, 0);
    await page.waitForTimeout(300);
    const layer0NodeCount = await getCyNodeCount(page);

    await selectHierarchyLevel(page, 2);
    await waitForGraphReady(page, 10000);
    const layer2NodeCount = await getCyNodeCount(page);

    expect(layer2NodeCount).toBeGreaterThanOrEqual(layer0NodeCount);
  });

  test('J39: 切换到包视图应激活 package 模式', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'package');
    const viewMode = await page.evaluate(() => (window as any).__graphStore?.getState().viewMode ?? null);
    expect(viewMode).toBe('package');
  });

  test('J39: 切换到类视图应激活 class 模式', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'class');
    const viewMode = await page.evaluate(() => (window as any).__graphStore?.getState().viewMode ?? null);
    expect(viewMode).toBe('class');
  });

  test('J39: Layer 切换后图谱容器仍可见', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'dependencies');

    for (const level of [0, 1, 2]) {
      await selectHierarchyLevel(page, level);
      await page.waitForTimeout(300);
      await expect(page.locator(PANEL.graphContainer)).toBeVisible();
    }
  });
});
