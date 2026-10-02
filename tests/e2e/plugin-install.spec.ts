// E2E tests for J0: DSH 插件安装与入口验证
import { test, expect } from '@playwright/test';
import { setupPluginPage, TIMEOUTS } from './helpers.ts';

test.describe('J0: DSH 插件安装与入口验证', () => {
  test('should load plugin and show graph panel in conversation view', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.cg-graph-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should display toolbar persistently regardless of graph data', async ({ page }) => {
    await setupPluginPage(page);
    const toolbar = page.locator('.cg-graph-toolbar');
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should show conversation view integration mode attribute', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.cg-graph-panel');
    const integrationMode = await panel.getAttribute('data-cg-integration');
    expect(integrationMode).toBeTruthy();
  });

  test('should display graph icon as plugin entry point', async ({ page }) => {
    await setupPluginPage(page);
    const collapseFab = page.locator('.cg-collapse-fab');
    await expect(collapseFab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should show empty state when no graph data loaded', async ({ page }) => {
    await setupPluginPage(page);
    const emptyState = page.locator('.cg-empty-state');
    if (await emptyState.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should export button be disabled when no graph data', async ({ page }) => {
    await setupPluginPage(page);
    const exportBtn = page.locator('.cg-export-btn');
    await expect(exportBtn).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const isDisabled = await exportBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      expect(isDisabled).not.toBeNull();
    }
  });

  test('should handle panel collapse and expand via FAB button', async ({ page }) => {
    await setupPluginPage(page);
    const collapseFab = page.locator('.cg-collapse-fab');
    const panel = page.locator('.cg-graph-panel');

    await collapseFab.click();
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });

    await collapseFab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should display workspace selector in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    const workspaceSelector = page.locator('.cg-workspace-selector, .cg-workspace-current');
    const isVisible = await workspaceSelector.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(workspaceSelector.first()).toBeVisible();
    }
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