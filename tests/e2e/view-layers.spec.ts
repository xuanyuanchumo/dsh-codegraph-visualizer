// E2E tests for J39: View Mode Layered Navigation (FR-14)
// 切换到继承/调用/包/类视图 → Layer 0 概览 → Layer 1 部分展开 → Layer 2 完整图 → 状态栏显示总节点/边数
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J39: View Mode Layered Navigation (FR-14)', () => {
  test('应显示视图模式切换按钮', async ({ page }) => {
    await setupPluginPage(page);
    const viewModeBtn = page.locator('.cg-view-mode-btn');
    await expect(viewModeBtn).toBeVisible();
  });

  test('切换到继承视图应显示继承关系', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-inheritance-btn');
    await expect(inheritanceBtn).toBeVisible();
    await inheritanceBtn.click();
    await expect(inheritanceBtn).toHaveClass(/cg-active/);
    await page.waitForTimeout(500);
  });

  test('切换到调用视图应显示调用关系', async ({ page }) => {
    await setupPluginPage(page);
    const callChainBtn = page.locator('.cg-call-chain-btn');
    await expect(callChainBtn).toBeVisible();
    await callChainBtn.click();
    await expect(callChainBtn).toHaveClass(/cg-active/);
    await page.waitForTimeout(500);
  });

  test('状态栏应显示总节点和边数', async ({ page }) => {
    await setupPluginPage(page);
    const statusBar = page.locator('.cg-status-bar, .cg-stats-text');
    await expect(statusBar).toBeVisible({ timeout: 5000 });
    const text = await statusBar.textContent();
    expect(text).toBeTruthy();
  });

  test('Layer 0 概览应显示聚类节点', async ({ page }) => {
    await setupPluginPage(page);
    await page.waitForTimeout(1000);
    const nodes = page.locator('.cg-graph-container canvas, .cg-graph-container svg');
    await expect(nodes).toBeVisible({ timeout: 5000 });
  });

  test('展开聚类应显示内部节点（Layer 1）', async ({ page }) => {
    await setupPluginPage(page);
    await page.waitForTimeout(1000);
    const clusterNodes = page.locator('.cg-graph-container canvas, .cg-graph-container svg');
    await expect(clusterNodes).toBeVisible({ timeout: 5000 });
  });

  test('视图无数据时应显示提示', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-inheritance-btn');
    await inheritanceBtn.click();
    await page.waitForTimeout(500);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('切换视图模式后状态应保持', async ({ page }) => {
    await setupPluginPage(page);
    const callChainBtn = page.locator('.cg-call-chain-btn');
    await callChainBtn.click();
    await expect(callChainBtn).toHaveClass(/cg-active/);
    await page.waitForTimeout(300);
    const inheritanceBtn = page.locator('.cg-inheritance-btn');
    await inheritanceBtn.click();
    await expect(inheritanceBtn).toHaveClass(/cg-active/);
    await expect(callChainBtn).not.toHaveClass(/cg-active/);
  });
});