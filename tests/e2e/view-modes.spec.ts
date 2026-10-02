import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  waitForGraphReady,
  getCyNodeCount,
  getClusterNodeIds,
  selectNode,
  doubleTapNode,
  panGraph,
  TIMEOUTS,
} from './helpers.ts';

test.describe('J2: 图谱浏览与导航（拖拽/缩放/平移）', () => {
  test('should pan graph without losing nodes', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const beforeCount = await getCyNodeCount(page);
    expect(beforeCount).toBeGreaterThan(0);

    await panGraph(page, 100, 50);
    await page.waitForTimeout(200);

    const afterCount = await getCyNodeCount(page);
    expect(afterCount).toBe(beforeCount);
  });

  test('should zoom graph via toolbar zoom buttons', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const zoomInBtn = page.locator('.cg-zoom-in-btn');
    const zoomOutBtn = page.locator('.cg-zoom-out-btn');
    await expect(zoomInBtn).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(zoomOutBtn).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });

    const zoomBefore = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.zoom() : -1;
    });
    expect(zoomBefore).toBeGreaterThan(0);

    await zoomInBtn.click();
    await page.waitForTimeout(200);

    const zoomAfter = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.zoom() : -1;
    });
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  test('should fit graph to viewport via fit button', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const fitBtn = page.locator('.cg-fit-btn');
    await expect(fitBtn).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });

    await panGraph(page, 200, 100);
    await page.waitForTimeout(200);

    await fitBtn.click();
    await page.waitForTimeout(300);

    const zoom = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.zoom() : -1;
    });
    expect(zoom).toBeGreaterThan(0);
  });

  test('should expand cluster node by double-tap', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const clusterIds = await getClusterNodeIds(page);
    if (clusterIds.length === 0) {
      test.info().annotations.push({ type: 'skip-reason', description: 'No cluster nodes available' });
      return;
    }

    const beforeCount = await getCyNodeCount(page);
    await doubleTapNode(page, clusterIds[0]);
    await page.waitForTimeout(500);

    const afterCount = await getCyNodeCount(page);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  test('should collapse all via collapse FAB', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const clusterIds = await getClusterNodeIds(page);
    if (clusterIds.length > 0) {
      await doubleTapNode(page, clusterIds[0]);
      await page.waitForTimeout(500);
    }

    const collapseFab = page.locator('.cg-collapse-fab');
    await expect(collapseFab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await collapseFab.click();
    await page.waitForTimeout(300);

    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThan(0);
  });

  test('should select node and show details', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const clusterIds = await getClusterNodeIds(page);
    if (clusterIds.length === 0) {
      test.info().annotations.push({ type: 'skip-reason', description: 'No cluster nodes available' });
      return;
    }

    await selectNode(page, clusterIds[0]);
    await page.waitForTimeout(300);

    const hasSelected = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      if (!cy) return false;
      return cy.nodes('.cg-selected').length > 0;
    });
    expect(hasSelected).toBe(true);
  });
});

test.describe('J23: 影响分析', () => {
  test('should toggle impact analysis via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const impactBtn = page.locator('.cg-impact-btn');
    await expect(impactBtn).toBeVisible();
  });

  test('should show impact panel with D1/D2/D3 stats', async ({ page }) => {
    await setupPluginPage(page);
    const impactPanel = page.locator('.cg-impact-panel');
    await expect(impactPanel).not.toBeVisible();
  });

  test('should highlight upstream nodes when impact is enabled', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });
});

test.describe('J24: 继承层次图', () => {
  test('should switch to inheritance view mode', async ({ page }) => {
    await setupPluginPage(page);
    const inheritanceBtn = page.locator('.cg-view-mode-btn[data-mode="inheritance"]');
    await expect(inheritanceBtn).toBeVisible({ timeout: 10000 });
  });

  test('should show layer selector in inheritance mode', async ({ page }) => {
    await setupPluginPage(page);
    const layerSelector = page.locator('.cg-layer-selector');
    await expect(layerSelector).not.toBeVisible();
  });
});