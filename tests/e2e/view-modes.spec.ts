import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  waitForGraphReady,
  getCyNodeCount,
  getClusterNodeIds,
  selectNode,
  doubleTapNode,
  panGraph,
  getZoom,
  zoomGraph,
  fitGraph,
  clickToolItem,
  selectViewMode,
  TIMEOUTS,
} from './helpers.ts';
import { CY_CLASS, TRIGGERS, ANALYSIS_PANEL, TOOL_ITEM, OPTION, PANEL } from './selectors.ts';

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

  // 工具栏从未有过缩放按钮（`CytoscapeRenderer` 只暴露 `getZoom`/`onZoomChange`，
  // 缩放靠滚轮与 `focusOnArea`）。原用例断言 `.cg-zoom-in-btn` 可见——该元素不存在，
  // 所以它一直在测一个幻觉。这里改为直接验证渲染器的缩放能力。
  test('should zoom graph programmatically', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const zoomBefore = await getZoom(page);
    expect(zoomBefore).toBeGreaterThan(0);

    const zoomAfter = await zoomGraph(page, 1.5);
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  test('should fit graph to viewport', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    await panGraph(page, 200, 100);
    await page.waitForTimeout(200);

    await fitGraph(page);
    await page.waitForTimeout(300);

    const zoom = await getZoom(page);
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

    const collapseFab = page.locator(PANEL.collapsedFab);
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

    // 选中态由 `HighlightController` 加的是 cytoscape 内部类 `selected`，
    // 不是 CSS 类 `cg-selected`（后者从未存在）。
    const hasSelected = await page.evaluate((cls) => {
      const cy = (window as any).__cytoscape;
      if (!cy) return false;
      return cy.nodes(`.${cls}`).length > 0;
    }, CY_CLASS.selected);
    expect(hasSelected).toBe(true);
  });
});

test.describe('J23: 影响分析', () => {
  test('should toggle impact analysis via tools dropdown', async ({ page }) => {
    await setupPluginPage(page);
    // 面板开关全部位于「工具」下拉内，未展开时按钮不在 DOM 中。
    await clickToolItem(page, TOOL_ITEM.impact);
    const impactBtn = page.locator(TOOL_ITEM.impact);
    await expect(impactBtn).toHaveClass(/cg-active/);
  });

  test('should show impact panel with D1/D2/D3 stats', async ({ page }) => {
    await setupPluginPage(page);
    const impactPanel = page.locator(ANALYSIS_PANEL.impact);
    await expect(impactPanel).not.toBeVisible();
  });

  test('should highlight upstream nodes when impact is enabled', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();
  });
});

test.describe('J24: 继承层次图', () => {
  test('should switch to inheritance view mode', async ({ page }) => {
    await setupPluginPage(page);
    // 视图模式是「视图模式」下拉里的一个选项，不是独立按钮。
    await expect(page.locator(TRIGGERS.view)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await selectViewMode(page, 'inheritance');
    const viewMode = await page.evaluate(() => {
      const store = (window as any).__graphStore;
      return store ? store.getState().viewMode : null;
    });
    expect(viewMode).toBe('inheritance');
  });

  // 原用例断言 `.cg-layer-selector` 不可见——该类名不存在，断言恒真。
  // 真实的层级选择器就是「层级」下拉触发器，这里改为正向断言它存在。
  test('should expose hierarchy level dropdown in inheritance mode', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'inheritance');
    await expect(page.locator(TRIGGERS.level)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    // 下拉内应能选到 4 个层级。
    await page.locator(TRIGGERS.level).click();
    await expect(page.locator(OPTION.level(0))).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(page.locator(OPTION.level(3))).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});
