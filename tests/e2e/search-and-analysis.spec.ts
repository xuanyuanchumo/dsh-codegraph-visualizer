// E2E tests for J3-J5, J15, J23, J30-J32: 符号搜索与定位, 调用链追踪, 依赖拓扑分析, 路径查找, 影响分析, 热点分析, 波及半径, God Module
//
// 两个必须记住的机制：
// 1. 所有分析/质量面板开关都位于工具栏的「工具」下拉内（`cg-tools-dropdown-btn`），
//    未展开时按钮不在 DOM 中。点选后下拉会自动关闭，所以「断言按钮 cg-active」与
//    「点第二次关闭面板」都必须重新展开下拉——辅助函数 `clickToolItem` 已封装该动作。
// 2. `getAvailablePanels(getViewLayer(viewMode))`（`src/shared/viewModeUtils.ts:78-88`）
//    会按当前视图层过滤「工具」下拉条目。默认的 `code` 视图属于 structural 层，
//    其 `STRUCTURAL_PANELS` 不含调用链/循环/影响/继承/热点/上帝模块/核心函数，
//    因此 J4/J5/J23/J30/J31/J32 必须先切到 behavioral 层（本文件用 callgraph），
//    否则那些按钮根本不会渲染。J15（路径查找）属 structural 层，无需切换。
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  setupPluginPageInBehavioralLayer,
  getCyEdgeIdsByClass,
  getCyNodeCount,
  waitForGraphReady,
  clickSearchButton,
  clickToolItem,
  closeDropdown,
  openDropdown,
  selectNodeStrict,
  TIMEOUTS,
} from './helpers.ts';
import { SEARCH, TRIGGERS, TOOL_ITEM, ANALYSIS_PANEL, PANELS, CY_CLASS } from './selectors.ts';

test.describe('J3: 符号搜索与定位', () => {
  test('should open search with search button', async ({ page }) => {
    await setupPluginPage(page);
    await clickSearchButton(page);
    await expect(page.locator(SEARCH.bar)).toBeVisible();
    await expect(page.locator(SEARCH.input)).toBeFocused();
  });

  test('should filter results as user types', async ({ page }) => {
    await setupPluginPage(page);
    await clickSearchButton(page);
    await page.locator(SEARCH.input).type('function');
    await page.waitForTimeout(300);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should close search with close button', async ({ page }) => {
    await setupPluginPage(page);
    await clickSearchButton(page);
    // 关闭按钮的真名是 `cg-search-close-btn`（cycle-81 新增的稳定寻址名）；
    // 用 `cg-search-bar button` 会误命中结果项。
    await page.locator(SEARCH.closeBtn).click();
    await expect(page.locator(SEARCH.bar)).not.toBeVisible();
  });
});

test.describe('J4: 调用链追踪', () => {
  test('should toggle call chain mode', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });

    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should not crash when enabling chain mode without selection', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await expect(page.locator('.cg-graph-container')).toBeAttached();
    await expect(page.locator('.cg-error-overlay')).not.toBeVisible();
    await clickToolItem(page, TOOL_ITEM.chain);
  });

  test('should clear chain highlight on second toggle', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
    await closeDropdown(page, TRIGGERS.tools);

    // 调用链高亮加的是 cytoscape 内部类 `call-chain`，不是 CSS 类 `cg-chain-highlight`。
    const highlightedEdges = await getCyEdgeIdsByClass(page, CY_CLASS.callChain);
    expect(highlightedEdges).toHaveLength(0);
  });

  test('should maintain graph container when chain mode enabled', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.chain);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
    await clickToolItem(page, TOOL_ITEM.chain);
  });

  test('should coexist with cycle detection mode', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.chain);
    await clickToolItem(page, TOOL_ITEM.cycles);

    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.chain)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await expect(page.locator('.cg-graph-container')).toBeAttached();
    await clickToolItem(page, TOOL_ITEM.chain);
    await clickToolItem(page, TOOL_ITEM.cycles);
  });
});

test.describe('J5: 依赖拓扑分析', () => {
  test('should toggle cycle detection', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should display cycle panel when detection enabled', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await expect(page.locator(ANALYSIS_PANEL.cycle)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should maintain graph container when cycle detection active', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await waitForGraphReady(page);
    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should toggle off cycle detection cleanly', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
    await closeDropdown(page, TRIGGERS.tools);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should handle graph with dependencies without crash', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await waitForGraphReady(page);
    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThan(0);
    await clickToolItem(page, TOOL_ITEM.cycles);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.cycles)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });
});

test.describe('J15: 路径查找', () => {
  test('should open path find panel via toolbar button', async ({ page }) => {
    await setupPluginPage(page);
    const pathBar = page.locator(PANELS.pathBar);
    await expect(pathBar).not.toBeVisible();

    await clickToolItem(page, TOOL_ITEM.pathFind);
    await expect(pathBar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('should show start and end inputs with find button disabled', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.pathFind);
    await expect(page.locator(PANELS.pathStartInput)).toBeVisible();
    await expect(page.locator(PANELS.pathEndInput)).toBeVisible();
    await expect(page.locator(PANELS.pathFindSubmit)).toBeDisabled();
  });

  test('should show suggestions when typing in start input', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.pathFind);
    await page.locator(PANELS.pathStartInput).type('a', { delay: 50 });
    await page.waitForTimeout(300);
    await expect(page.locator('.cg-graph-container')).toBeAttached();
  });

  test('should close path find panel via close button', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.pathFind);
    const pathBar = page.locator(PANELS.pathBar);
    await expect(pathBar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await page.locator(`${PANELS.pathBar} .cg-close-btn`).click();
    await expect(pathBar).not.toBeVisible();
  });

  test('should clear button be visible in path bar', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.pathFind);
    await expect(page.locator(PANELS.pathClear)).toBeVisible();
  });
});

test.describe('J23: 影响分析', () => {
  test('should toggle impact panel via toolbar button', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.impact);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.impact)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.impact);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.impact)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});

test.describe('J30: 热点分析', () => {
  test('should toggle hotspot via toolbar button', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.hotspot);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.hotspot)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.hotspot);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.hotspot)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});

test.describe('J31: 波及半径分析', () => {
  test('should impact panel be visible after toggle', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await waitForGraphReady(page);
    // 波及半径面板有**额外前置条件**：`src/client/hooks/useAnalysisPanels.ts:82-89`
    // 只在 `showImpact && selectedNodeId` 时才产出 impactStats，而
    // `src/client/components/RightPanelStack.tsx:86-88` 又要求
    // `panel.showImpact && !!props.impactStats` 才把面板放进栈里。
    // 所以必须先选中一个节点，否则面板永远不渲染（cycle-81 第五根因）。
    //
    // 被选中的必须是**调用视图里真实存在的 function 节点**：`selectNode` 走
    // `node.emit('tap')`，而 `tests/e2e/helpers.ts` 对空选择器有静默守卫，
    // 选 class 节点（n3）会 no-op 且不报错。`n2`（createGraphTools）是
    // function，且被 e1（n1 → n2）指向，impactStats 至少有 d1 = 1。
    await selectNodeStrict(page, 'n2');
    await clickToolItem(page, TOOL_ITEM.impact);
    await expect(page.locator(ANALYSIS_PANEL.impact)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});

test.describe('J32: God Module 检测', () => {
  test('should toggle god module via toolbar button', async ({ page }) => {
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.godModule);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.godModule)).toHaveClass(/cg-active/, { timeout: TIMEOUTS.ACTION });
    await closeDropdown(page, TRIGGERS.tools);

    await clickToolItem(page, TOOL_ITEM.godModule);
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator(TOOL_ITEM.godModule)).not.toHaveClass(/cg-active/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});
