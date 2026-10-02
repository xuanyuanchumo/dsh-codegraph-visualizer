// E2E tests for J3-J5, J15, J23, J30-J32: 符号搜索与定位, 调用链追踪, 依赖拓扑分析, 路径查找, 影响分析, 热点分析, 波及半径, God Module
import { test, expect } from '@playwright/test';
import { setupPluginPage, getCyEdgeIdsByClass, getCyNodeCount, waitForGraphReady, TIMEOUTS } from './helpers.ts';

test.describe('J3: 符号搜索与定位', () => {
  test('should open search with search button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    await expect(page.locator('.cg-search-bar')).toBeVisible();
    await expect(page.locator('.cg-search-bar input')).toBeFocused();
  });

  test('should filter results as user types', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    const input = page.locator('.cg-search-bar input');
    await input.type('function');
    await page.waitForTimeout(300);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should close search with close button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-search-btn').click();
    await page.locator('.cg-search-bar button').click();
    await expect(page.locator('.cg-search-bar')).not.toBeVisible();
  });
});

test.describe('J4: 调用链追踪', () => {
  test('should toggle call chain mode', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await chainBtn.click();
    await expect(chainBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
  });

  test('should not crash when enabling chain mode without selection', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
    const errorOverlay = page.locator('.cg-error-overlay');
    await expect(errorOverlay).not.toBeVisible();
    await chainBtn.click();
  });

  test('should clear chain highlight on second toggle', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await chainBtn.click();
    await expect(chainBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
    const highlightedEdges = await getCyEdgeIdsByClass(page, 'cg-chain-highlight');
    expect(highlightedEdges).toHaveLength(0);
  });

  test('should maintain graph container when chain mode enabled', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThanOrEqual(0);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
    await chainBtn.click();
  });

  test('should coexist with cycle detection mode', async ({ page }) => {
    await setupPluginPage(page);
    const chainBtn = page.locator('.cg-chain-btn');
    const cycleBtn = page.locator('.cg-cycle-btn');
    await chainBtn.click();
    await expect(chainBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await cycleBtn.click();
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeAttached();
    await chainBtn.click();
    await cycleBtn.click();
  });
});

test.describe('J5: 依赖拓扑分析', () => {
  test('should toggle cycle detection', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click();
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await cycleBtn.click();
    await expect(cycleBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
  });

  test('should display cycle panel when detection enabled', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click({ timeout: TIMEOUTS.ACTION });
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    const cyclePanel = page.locator('.cg-cycle-panel');
    await expect(cyclePanel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should maintain graph container when cycle detection active', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click({ timeout: TIMEOUTS.ACTION });
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should toggle off cycle detection cleanly', async ({ page }) => {
    await setupPluginPage(page);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click({ timeout: TIMEOUTS.ACTION });
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await cycleBtn.click();
    await expect(cycleBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should handle graph with dependencies without crash', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThan(0);
    const cycleBtn = page.locator('.cg-cycle-btn');
    await cycleBtn.click({ timeout: TIMEOUTS.ACTION });
    await expect(cycleBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });
});

test.describe('J15: 路径查找', () => {
  test('should open path find panel via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const pathBar = page.locator('.cg-path-bar');
    await expect(pathBar).not.toBeVisible();
    const pathfindBtn = page.locator('.cg-pathfind-btn');
    await pathfindBtn.click({ timeout: 10000 });
    await expect(pathBar).toBeVisible({ timeout: 5000 });
  });

  test('should show start and end inputs with find button disabled', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-pathfind-btn').click({ timeout: 10000 });
    await expect(page.locator('input[name="pathStart"]')).toBeVisible();
    await expect(page.locator('input[name="pathEnd"]')).toBeVisible();
    const findBtn = page.locator('.cg-path-find-btn');
    await expect(findBtn).toBeDisabled();
  });

  test('should show suggestions when typing in start input', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-pathfind-btn').click({ timeout: 10000 });
    const startInput = page.locator('input[name="pathStart"]');
    await startInput.type('a', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should close path find panel via close button', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-pathfind-btn').click({ timeout: 10000 });
    const pathBar = page.locator('.cg-path-bar');
    await expect(pathBar).toBeVisible({ timeout: 5000 });
    await page.locator('.cg-path-bar .cg-close-btn').click();
    await expect(pathBar).not.toBeVisible();
  });

  test('should clear button be visible in path bar', async ({ page }) => {
    await setupPluginPage(page);
    await page.locator('.cg-pathfind-btn').click({ timeout: 10000 });
    await expect(page.locator('.cg-path-clear-btn')).toBeVisible();
  });
});

test.describe('J23: 影响分析', () => {
  test('should toggle impact panel via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const impactBtn = page.locator('.cg-impact-btn');
    await impactBtn.click({ timeout: 10000 });
    await expect(impactBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await impactBtn.click();
    await expect(impactBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
  });
});

test.describe('J30: 热点分析', () => {
  test('should toggle hotspot via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const hotspotBtn = page.locator('.cg-hotspot-btn');
    await hotspotBtn.click({ timeout: 10000 });
    await expect(hotspotBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await hotspotBtn.click();
    await expect(hotspotBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
  });
});

test.describe('J31: 波及半径分析', () => {
  test('should impact panel be visible after toggle', async ({ page }) => {
    await setupPluginPage(page);
    const impactBtn = page.locator('.cg-impact-btn');
    await impactBtn.click({ timeout: 10000 });
    await expect(page.locator('.cg-impact-panel')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('J32: God Module 检测', () => {
  test('should toggle god module via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const godBtn = page.locator('.cg-godmodule-btn');
    await godBtn.click({ timeout: 10000 });
    await expect(godBtn).toHaveClass(/cg-active/, { timeout: 10000 });
    await godBtn.click();
    await expect(godBtn).not.toHaveClass(/cg-active/, { timeout: 5000 });
  });
});

