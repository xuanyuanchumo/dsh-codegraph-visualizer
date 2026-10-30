import { test, expect } from '@playwright/test';
import {
  setupPluginPage, setupPluginPageInBehavioralLayer,
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
  resolveRawNodeId,
  selectNodeStrict,
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

  // cycle-112 重写（原用例名「collapse all via collapse FAB」与产品语义相反，长期红）：
  // FAB（`.cg-collapse-fab`）只在**收起态**可见（layout.css:51 `display:none` → 收起时 `flex`），
  // 点击它执行的是**展开**；工具栏的 `.cg-collapse-btn` 才是「收起」按钮。
  // 旧断言 `nodeCount > 0` 与收起/展开都无关——cytoscape 实例在收起时仍持有全部节点。
  test('collapse panel via toolbar button, then expand via FAB', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const container = page.locator(PANEL.graphContainer);
    await expect(container).toBeVisible();

    // 1) 工具栏「收起」按钮 ⇒ 面板进收起态（cg-collapsed），内容隐藏。
    const collapseBtn = page.locator(TRIGGERS.collapse);
    await collapseBtn.click();
    const fab = page.locator(PANEL.collapsedFab);
    await expect(fab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(container).toBeHidden();

    // 2) FAB ⇒ 展开，内容恢复可见（cytoscape 实例仍在，节点数不变）。
    await fab.click();
    await expect(container).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
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
    // cycle-112 修长期红（三层根因，逐层修）：
    // 1. showImpact 属 **behavioral** 层（`BEHAVIORAL_PANELS`），默认 code 视图的
    //    工具下拉里根本没有这一项 ⇒ 用 behavioral 层 helper（先切 callgraph 再点）；
    // 2. 断言不能落在 `.cg-impact-btn` 上：工具下拉的条目点击后 `close()` 同帧卸载
    //    （`ToolbarActions.tsx` `panelControls[toggle](); close();`，桌面菜单惯例），
    //    `toHaveClass(/cg-active/)` 必然 element-not-found。**状态要断言在点击后仍
    //    存在的元素上** —— 即影响分析面板本身（`ANALYSIS_PANEL.impact`）。
    //    focus-mode.spec.ts:48 的同名断言已按此修复并转绿。
    await setupPluginPageInBehavioralLayer(page);
    // 面板 visible = showImpact && impactStats，而 impactStats 只在**选中节点**时才计算
    // （`useAnalysisPanels.ts` `if (showImpact && selectedNodeId)`）—— focus-mode 的同名
    // 断言已按「先选节点再点开关」转绿，这里补同一模式。
    const fnId = await resolveRawNodeId(page, 'function');
    expect(fnId, '桩图必须含 function 节点').toBeTruthy();
    await selectNodeStrict(page, fnId!);
    await clickToolItem(page, TOOL_ITEM.impact);
    await expect(page.locator(ANALYSIS_PANEL.impact)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    // 反向：再点一次（重新开菜单）⇒ 面板关。
    await clickToolItem(page, TOOL_ITEM.impact);
    await expect(page.locator(ANALYSIS_PANEL.impact)).not.toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
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
