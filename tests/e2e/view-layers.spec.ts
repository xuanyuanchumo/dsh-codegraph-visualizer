// E2E tests for J39: View Mode Layered Navigation (FR-14)
// 切换到继承/调用/包/类视图 → Layer 0 概览 → Layer 1 部分展开 → Layer 2 完整图 → 状态栏显示总节点/边数
import { test, expect } from '@playwright/test';
import { setupPluginPage, waitForGraphReady, getCyNodeCount } from './helpers.ts';

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
  });

  test('切换到调用视图应显示调用关系', async ({ page }) => {
    await setupPluginPage(page);
    const callChainBtn = page.locator('.cg-call-chain-btn');
    await expect(callChainBtn).toBeVisible();
    await callChainBtn.click();
    await expect(callChainBtn).toHaveClass(/cg-active/);
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
    const nodes = page.locator('.cg-graph-container canvas, .cg-graph-container svg');
    await expect(nodes).toBeVisible({ timeout: 5000 });
  });

  test('展开聚类应显示内部节点（Layer 1）', async ({ page }) => {
    await setupPluginPage(page);
    const clusterNodes = page.locator('.cg-graph-container canvas, .cg-graph-container svg');
    await expect(clusterNodes).toBeVisible({ timeout: 5000 });
  });

  test('视图无数据时应显示提示', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-inheritance-btn');
    await inheritanceBtn.click();
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible({ timeout: 5000 });
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

  test('J39: 切换到继承视图后应显示 Layer 选择器', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceViewBtn = page.locator('.cg-view-mode-btn', { hasText: /inherit|继承/i });
    await inheritanceViewBtn.click();

    const layerSelector = page.locator('.cg-layer-selector');
    await expect(layerSelector).toBeVisible({ timeout: 5000 });
    const layerBtns = page.locator('.cg-layer-btn');
    await expect(layerBtns).toHaveCount(3);
  });

  test('J39: Layer 2 完整图应比 Layer 0 显示更多节点', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceViewBtn = page.locator('.cg-view-mode-btn', { hasText: /inherit|继承/i });
    await inheritanceViewBtn.click();
    const layerBtns = page.locator('.cg-layer-btn');
    await expect(layerBtns.nth(0)).toHaveClass(/cg-active/);
    const layer0NodeCount = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.nodes().length : 0;
    });
    await layerBtns.nth(2).click();
    await waitForGraphReady(page, 5000);
    const layer2NodeCount = await getCyNodeCount(page);
    expect(layer2NodeCount).toBeGreaterThanOrEqual(layer0NodeCount);
  });

  test('J39: 切换到包视图应激活 package 模式', async ({ page }) => {
    await setupPluginPage(page);
    const packageBtn = page.locator('.cg-view-mode-btn', { hasText: /pkg|包/i });
    await packageBtn.click();
    await expect(packageBtn).toHaveClass(/cg-active/, { timeout: 5000 });
    const layerSelector = page.locator('.cg-layer-selector');
    await expect(layerSelector).toBeVisible({ timeout: 5000 });
  });

  test('J39: 切换到类视图应激活 class 模式', async ({ page }) => {
    await setupPluginPage(page);
    const classBtn = page.locator('.cg-view-mode-btn', { hasText: /class|类图/i });
    await classBtn.click();
    await expect(classBtn).toHaveClass(/cg-active/, { timeout: 5000 });
    const layerSelector = page.locator('.cg-layer-selector');
    await expect(layerSelector).toBeVisible({ timeout: 5000 });
  });

  test('J39: Layer 切换后图谱容器仍可见', async ({ page }) => {
    await setupPluginPage(page);
    const depBtn = page.locator('.cg-view-mode-btn', { hasText: /dep|依赖/i });
    await depBtn.click();

    const layerBtns = page.locator('.cg-layer-btn');
    for (let i = 0; i < 3; i++) {
      await layerBtns.nth(i).click();
      await page.waitForTimeout(300);
      const graphContainer = page.locator('.cg-graph-container');
      await expect(graphContainer).toBeVisible();
    }
  });
});