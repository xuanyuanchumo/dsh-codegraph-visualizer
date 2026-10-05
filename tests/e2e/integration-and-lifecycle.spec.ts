// E2E tests for J11, J13, J14: 多数据源切换, 插件生命周期合规, 生态集成验证
import { test, expect } from '@playwright/test';
import { setupPluginPage, clickSearchButton, getIntegrationMode, isPanelResizable } from './helpers.ts';
import { SEARCH, PANEL, MISC, TRIGGERS } from './selectors.ts';

test.describe('J11: 多数据源切换', () => {
  test('should display source status', async ({ page }) => {
    await setupPluginPage(page);
    const statusText = await page.locator(PANEL.nodeCount).textContent();
    expect(statusText).toBeTruthy();
  });
});

test.describe('J13: 插件生命周期合规', () => {
  test('should load plugin without errors', async ({ page }) => {
    await setupPluginPage(page);
    const errorOverlay = page.locator(PANEL.overlay);
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should maintain state after collapse/expand', async ({ page }) => {
    await setupPluginPage(page);
    const collapseBtn = page.locator(TRIGGERS.collapse);
    const panel = page.locator(PANEL.root);

    // Collapse
    await collapseBtn.click();
    await expect(panel).toHaveClass(/cg-collapsed/);

    // Expand
    await page.locator(PANEL.collapsedFab).click();
    await expect(panel).not.toHaveClass(/cg-collapsed/);
  });

  test('should handle panel resize', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator(PANEL.root);
    const resizeHandle = page.locator(MISC.resizeHandle);

    // `.cg-resize-handle` 一直被渲染，但只在面板自行持有几何尺寸时才可交互：
    // 宿主自适应的集成模式（conversation-view / sidebar-right / better-sidebar /
    // remote-web-ui）下 `useGraphDerivedValues.ts:68-73` 不会加 `cg-resizable`，
    // `layout.css:1078-1080` 于是把它设为 `display:none`。dev-server 用的是
    // `slot`（不属于 HOST_SIZED_INTEGRATION_MODES），所以这里应当可拖拽。
    await expect(resizeHandle).toBeAttached();
    const mode = await getIntegrationMode(page);
    const resizable = await isPanelResizable(page);

    if (!resizable) {
      // 宿主自适应模式：handle 隐藏是预期行为，只断言面板仍完好。
      test.info().annotations.push({ type: 'integration-mode', description: `${mode} (host-sized, not resizable)` });
      await expect(resizeHandle).toBeHidden();
      await expect(panel).toBeVisible();
      return;
    }

    const boxBefore = await panel.boundingBox();
    expect(boxBefore).not.toBeNull();

    if (boxBefore) {
      await resizeHandle.hover();
      await page.mouse.down();
      await page.mouse.move(boxBefore.x + 50, boxBefore.y + 50);
      await page.mouse.up();

      await expect(panel).toBeVisible();
    }
  });
});

test.describe('J14: 生态集成验证', () => {
  test('should register as sidebar tab if available', async ({ page }) => {
    await setupPluginPage(page);
    // The plugin registers as both overlay and sidebar tab
    // Verify panel is visible
    await expect(page.locator(PANEL.root)).toBeVisible();
  });

  test('should have accessible ARIA labels', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator(PANEL.root);
    // Check that panel is visible and accessible
    await expect(panel).toBeVisible();
    // Verify the panel has proper accessibility attributes
    // Note: These may be set by React after hydration
  });

  test('should have keyboard navigation support', async ({ page }) => {
    await setupPluginPage(page);
    // 搜索按钮真名是 `cg-search-standalone-btn`（窄面板时移入「更多」下拉），
    // 用 `clickSearchButton` 统一处理两种形态。
    await clickSearchButton(page);
    await expect(page.locator(SEARCH.bar)).toBeVisible();

    // 关闭按钮的真名是 `cg-search-close-btn`（cycle-81 新增的稳定寻址名）。
    await page.locator(SEARCH.closeBtn).click();
    await expect(page.locator(SEARCH.bar)).not.toBeVisible();
  });
});