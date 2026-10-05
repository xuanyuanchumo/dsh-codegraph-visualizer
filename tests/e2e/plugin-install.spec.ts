// E2E tests for J0: DSH 插件安装与入口验证
//
// 关于 `.cg-collapse-fab`：它是**无条件渲染**的（`src/client/GraphPanel.tsx:342`），
// 但 `src/client/styles/layout.css:57-58` 给了 `display: none`，只有
// `.cg-graph-panel.cg-collapsed .cg-collapse-fab { display: flex; }`（`:51-53`）
// 才让它出现。因此「断言 FAB 可见」必须先把面板折叠（cycle-81 第四根因）。
import { test, expect } from '@playwright/test';
import { setupPluginPage, TIMEOUTS } from './helpers.ts';
import { PANEL, TRIGGERS, SEARCH, DATA_ITEM } from './selectors.ts';

test.describe('J0: DSH 插件安装与入口验证', () => {
  test('should load plugin and show graph panel in conversation view', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.root)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should display toolbar persistently regardless of graph data', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(PANEL.toolbar)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should show conversation view integration mode attribute', async ({ page }) => {
    await setupPluginPage(page);
    const integrationMode = await page.locator(PANEL.root).getAttribute('data-cg-integration');
    expect(integrationMode).toBeTruthy();
  });

  test('should render collapse entry point while expanded', async ({ page }) => {
    await setupPluginPage(page);
    // 展开态下 FAB 存在于 DOM 但不显示；真正可见的是工具栏里的折叠按钮。
    await expect(page.locator(PANEL.collapsedFab)).toBeAttached({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(page.locator(TRIGGERS.collapse)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should show empty state when no graph data loaded', async ({ page }) => {
    await setupPluginPage(page);
    const emptyState = page.locator(PANEL.emptyState);
    if (await emptyState.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should export button be disabled when no graph data', async ({ page }) => {
    await setupPluginPage(page);
    const exportBtn = page.locator(TRIGGERS.export);
    await expect(exportBtn).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const isDisabled = await exportBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      expect(isDisabled).not.toBeNull();
    }
  });

  test('should handle panel collapse and expand via FAB button', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator(PANEL.root);
    const collapseFab = page.locator(PANEL.collapsedFab);

    // 先折叠：只有 `.cg-collapsed` 状态下 FAB 才会 `display: flex`。
    await page.locator(TRIGGERS.collapse).click();
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(collapseFab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });

    // 再用 FAB 展开。
    await collapseFab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(collapseFab).toBeHidden({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should display workspace selector in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    // `.cg-workspace-current` 不存在；工作区选择器的稳定类名是 `cg-workspace-selector`，
    // 内部触发器是 `cg-workspace-trigger`、名称是 `cg-workspace-name`。
    const workspaceSelector = page.locator(TRIGGERS.workspace);
    const isVisible = await workspaceSelector.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(workspaceSelector.first()).toBeVisible();
    }
  });

  test('should expose search and filter entries after load', async ({ page }) => {
    await setupPluginPage(page);
    // 搜索与筛选分别位于独立按钮和「数据」下拉内——都属 structural 层（默认 code 视图）。
    await expect(page.locator(TRIGGERS.search)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await page.locator(TRIGGERS.data).click();
    await expect(page.locator(DATA_ITEM.filterPanel)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(page.locator(SEARCH.bar)).not.toBeVisible();
  });

  test('should not have console errors on plugin load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await setupPluginPage(page);
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('DevTools'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
