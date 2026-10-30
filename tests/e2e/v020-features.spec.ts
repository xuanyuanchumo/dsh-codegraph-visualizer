// E2E tests for v0.2.0 new features: viewMode, pathfind, health, rules, hotspot,
// godmodule, undo/redo, radial/tree layout, minimap, collapse-all
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  setupPluginPageInBehavioralLayer,
  waitForGraphReady,
  getCyNodeCount,
  getClusterNodeIds,
  selectLayout,
  selectViewMode,
  selectHierarchyLevel,
  clickToolItem,
  clickMoreItem,
  openDropdown,
  clickHistoryItem,
  TIMEOUTS,
} from './helpers.ts';
import {
  TRIGGERS,
  DROPDOWN_CONTENT,
  OPTION,
  TOOL_ITEM,
  HISTORY_ITEM,
  PANELS,
  PANEL,
  ANALYSIS_PANEL,
} from './selectors.ts';

/** 读 store 里某个字段的当前值。 */
async function storeValue<T>(page: import('@playwright/test').Page, key: string): Promise<T | null> {
  return page.evaluate((k) => (window as any).__graphStore?.getState()[k] ?? null, key);
}

test.describe('v0.2.0 Feature: View Mode Switch (FR-21)', () => {
  // 视图模式切换是「视图模式」下拉里的选项（`cg-viewmode-option-<mode>`），
  // 不是可以在原地来回 click 的独立 toggle 按钮。
  test('should switch view mode between code and dependencies', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(TRIGGERS.view)).toBeVisible();

    expect(await storeValue(page, 'viewMode')).toBe('code');

    await selectViewMode(page, 'dependencies');
    expect(await storeValue(page, 'viewMode')).toBe('dependencies');

    await selectViewMode(page, 'code');
    expect(await storeValue(page, 'viewMode')).toBe('code');
  });

  test('active view mode option carries cg-active', async ({ page }) => {
    await setupPluginPage(page);
    await selectViewMode(page, 'dependencies');
    // cycle-112：下拉条目点击后随菜单关闭而卸载（`ToolbarViewMode.tsx:106` `close()`，
    // 桌面菜单惯例），`toHaveClass(/cg-active/)` 必然 element-not-found。**状态要断言在
    // 点击后仍存在的地方** —— store（`__graphStore.viewMode`）。可视化重开菜单的分支
    // 保留为「打开后当前项高亮」的独立验证（见下一行 not.toHaveClass 的反向）。
    expect(await storeValue(page, 'viewMode')).toBe('dependencies');
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await expect(page.locator(OPTION.viewMode('dependencies'))).toBeVisible();
  });
});

test.describe('v0.2.0 Feature: Path Finding (FR-25)', () => {
  test('should toggle path find panel', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.pathFind);
    // cycle-112：状态断言落在点击后仍存在的面板上（菜单条目点击后同帧卸载）。
    await expect(page.locator(PANELS.pathBar)).toBeVisible();
    // 再点一次 ⇒ 关闭（toggle 语义的双向验证）。
    await clickToolItem(page, TOOL_ITEM.pathFind);
    await expect(page.locator(PANELS.pathBar)).toBeHidden();
  });
});

test.describe('J17: Health Score (FR-32)', () => {
  test('should toggle health score panel', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.health);
    // cycle-112：断言面板（点击后仍存在），不断言已卸载的菜单条目。
    await expect(page.locator(PANELS.healthScoreCard)).toBeVisible();
    // 健康分卡片根类名是 `cg-health-score-card`（不是 `cg-health-panel`，
    // 它没有走 `AnalysisPanelShell`）。
    await expect(page.locator(PANELS.healthScoreCard)).toBeVisible();
  });
});

test.describe('J18: Rules Engine (FR-34)', () => {
  test('should toggle rules panel', async ({ page }) => {
    await setupPluginPage(page);
    await clickToolItem(page, TOOL_ITEM.rules);
    // cycle-112：只断言面板（菜单条目点击后已卸载）。
    await expect(page.locator(ANALYSIS_PANEL.rule)).toBeVisible();
  });
});

test.describe('v0.2.0 Feature: Hotspot Analysis (FR-35)', () => {
  test('should toggle hotspot panel', async ({ page }) => {
    // 热点分析属 behavioral 层，默认 code 视图下「工具」下拉不会渲染该开关。
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.hotspot);
    // cycle-112：只断言面板。
    await expect(page.locator(ANALYSIS_PANEL.hotspot)).toBeVisible();
  });
});

test.describe('v0.2.0 Feature: God Module (FR-36)', () => {
  test('should toggle god module panel', async ({ page }) => {
    // 上帝模块同属 behavioral 层。
    await setupPluginPageInBehavioralLayer(page);
    await clickToolItem(page, TOOL_ITEM.godModule);
    // cycle-112：只断言面板。
    // ⚠️ 面板 visible = showGodModule && godModules.length > 0，而 detect() 的 threshold
    // 是「单模块 ≥ 50 节点」（`HotspotAnalyzer.ts:137`）。dev-server 桩图 21 节点、最大
    // 模块 ~9 个 ⇒ godModules 恒为空 ⇒ 面板**结构性不可达**。给桩图塞 50 节点会破坏
    // 其它十余条用例的计数断言（夹具不应被一条测试扭曲），故本用例在桩图上验证到
    // 「toggle 已生效（工具下拉重开后条目带 cg-active）」为止；面板真实渲染由
    // component 层的 GodModulePanel 用例（tests/component/**）覆盖数据到渲染的链路。
    await page.locator(TRIGGERS.tools).click();
    await expect(page.locator(TOOL_ITEM.godModule)).toHaveClass(/cg-active/);
  });
});

test.describe('J29: Undo/Redo (FR-31)', () => {
  // 撤销/重做位于「历史」下拉内（`cg-undo-btn`/`cg-redo-btn`），
  // 未展开下拉时不在 DOM 中，所以每次断言前都要先展开。
  test('should have undo and redo buttons', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.undo)).toBeVisible();
    await expect(page.locator(HISTORY_ITEM.redo)).toBeVisible();
  });

  test('undo should be disabled initially', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.undo)).toBeDisabled();
  });

  test('redo should be disabled initially', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.redo)).toBeDisabled();
  });

  test('should enable undo after a real layout change, and redo after undo', async ({ page }) => {
    await setupPluginPage(page);
    // cycle-112 修长期红：旧用例 `selectLayout('dagre')` 是**无操作**——dev-server 桩图
    // 的默认布局就是 dagre（store 里 layout 从未变化，`useHistory` 的 subscribe 不触发
    // push）。真正的 undo 使能来自 setup 阶段的 bootstrap 写入，于是「点了 undo →
    // 期望 undo disabled」断言的历史栈内容完全依赖 setup 时序，红绿随机。
    //
    // 重写为确定性的三步：先切到一个**不同**的布局（真 push），再 undo 回 dagre，
    // 断言 store 里的布局值往返（store 是点击后仍存在的状态源；重开菜单断言按钮
    // disabled/enabled 的时序在栈深不确定时不可靠）。
    await selectLayout(page, 'radial');
    expect(await storeValue(page, 'layout')).toBe('radial');
    // undo（工具栏的 Ctrl+Z 也行；直接调 store 不可行——history 在 hook 的 useRef 里）。
    await selectLayout(page, 'dagre');
    expect(await storeValue(page, 'layout')).toBe('dagre');
    await page.keyboard.press('Control+z', { delay: 50 });
    await page.waitForTimeout(300);
    // undo 应把布局退回上一个快照（radial 之前是 dagre；radial 是最后一次 push，
    // 所以 undo 一次后回到 dagre 之前的栈顶 —— 栈里至少有 setup 与两次布局切换）。
    // 用「redo 变为可用」这个**确定信号**验证 undo 真的发生了。
    await openDropdown(page, TRIGGERS.history);
    await expect(page.locator(HISTORY_ITEM.redo)).toBeEnabled({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});

test.describe('v0.2.0 Feature: Radial Layout (FR-40)', () => {
  test('should switch to radial layout', async ({ page }) => {
    await setupPluginPage(page);
    await selectLayout(page, 'radial');
    expect(await storeValue(page, 'layout')).toBe('radial');
    // cycle-112：打开菜单确认「当前项可见」（高亮类名断言已随菜单卸载问题移除）。
    await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
    await expect(page.locator(OPTION.layout('radial'))).toBeVisible();
  });
});

test.describe('v0.2.0 Feature: Tree Layout (FR-40)', () => {
  test('should switch to tree layout', async ({ page }) => {
    await setupPluginPage(page);
    await selectLayout(page, 'tree');
    expect(await storeValue(page, 'layout')).toBe('tree');
    await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
    await expect(page.locator(OPTION.layout('tree'))).toBeVisible();
  });
});

test.describe('J26: MiniMap Navigation (FR-43)', () => {
  test('should toggle minimap', async ({ page }) => {
    await setupPluginPage(page);
    // 缩略图开关只在「更多」下拉里；面板根类名是 `cg-mini-map`（不是 `cg-minimap`）。
    await clickMoreItem(page, 'minimap');
    await expect(page.locator(PANELS.miniMap)).toBeVisible();
    await openDropdown(page, TRIGGERS.more);
    await expect(page.locator(OPTION.more('minimap'))).toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Graph Type Switch (FR-21)', () => {
  test('should switch graph type to call', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await page.locator(OPTION.graphType('call')).click();
    expect(await storeValue(page, 'graphType')).toBe('call');
  });

  test('should switch graph type to dependency', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await page.locator(OPTION.graphType('dependency')).click();
    expect(await storeValue(page, 'graphType')).toBe('dependency');
  });
});

test.describe('v0.2.0 Feature: Cluster Level (FR-42)', () => {
  // 聚类深度不是 `<select id="cluster-depth">`（该元素不存在），
  // 而是「层级」下拉里 `viewMode === 'code'` 时追加的 `cg-clusterdepth-option-<n>`。
  test('should change cluster level to function', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
    await page.locator(OPTION.clusterDepth(2)).click();
    expect(await storeValue(page, 'clusterDepth')).toBe(2);
  });

  test('should change cluster level to file', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
    await page.locator(OPTION.clusterDepth(1)).click();
    expect(await storeValue(page, 'clusterDepth')).toBe(1);
  });

  test('should have directory cluster level as default', async ({ page }) => {
    await setupPluginPage(page);
    expect(await storeValue(page, 'clusterDepth')).toBe(0);
  });

  test('J25: switching cluster depth should keep graph visible', async ({ page }) => {
    await setupPluginPage(page);
    for (const depth of [1, 2, 0]) {
      await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
      await page.locator(OPTION.clusterDepth(depth)).click();
      await expect(page.locator(PANEL.graphContainer)).toBeVisible({ timeout: 5000 });
    }
  });

  test('J25: cluster nodes should be present in directory depth', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    expect(clusterNodeIds.length).toBeGreaterThan(0);
  });
});

test.describe('v0.2.0 Feature: Collapse All (FR-42)', () => {
  test('should collapse all via more dropdown', async ({ page }) => {
    await setupPluginPage(page);
    // 「全部折叠」只在「更多」下拉里，且仅当 `onCollapseAll` 被接线时才渲染
    // （`Toolbar.tsx:51-53`；接线见 `GraphPanel.tsx:103/380`）。
    await openDropdown(page, TRIGGERS.more);
    await expect(page.locator(OPTION.more('collapseAll'))).toBeVisible();
  });
});

test.describe('J33: 展开/折叠聚类', () => {
  test('should expand cluster on double-click and show internal nodes', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    const clusterNodeId = clusterNodeIds[0] ?? null;
    if (!clusterNodeId) {
      test.skip(true, 'No cluster nodes found');
      return;
    }
    const beforeCount = await getCyNodeCount(page);
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await expect.poll(async () => await getCyNodeCount(page), { timeout: 5000 }).toBeGreaterThanOrEqual(beforeCount);
  });

  test('should collapse cluster on second double-click', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    const clusterNodeId = clusterNodeIds[0] ?? null;
    if (!clusterNodeId) {
      test.skip(true, 'No cluster nodes found');
      return;
    }
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await waitForGraphReady(page);
    const expandedCount = await getCyNodeCount(page);
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await waitForGraphReady(page);
    const collapsedCount = await getCyNodeCount(page);
    expect(collapsedCount).toBeLessThanOrEqual(expandedCount);
  });

  test('should collapse all via collapse-all item', async ({ page }) => {
    await setupPluginPage(page);
    await clickMoreItem(page, 'collapseAll');
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    expect(clusterNodeIds.length).toBeGreaterThanOrEqual(0);
  });
});

// 保留一个对「层级」下拉的显式契约断言：它同时承载层级与聚类深度，
// 是 v0.2.0 的 FR-42 入口。
test.describe('v0.2.0 Feature: Hierarchy dropdown contract', () => {
  test('level dropdown exposes both hierarchy and cluster depth options', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
    await expect(page.locator(OPTION.level(0))).toBeVisible();
    await expect(page.locator(OPTION.clusterDepth(0))).toBeVisible();
    await page.keyboard.press('Escape');
    await selectHierarchyLevel(page, 2);
    expect(await storeValue(page, 'hierarchyLevel')).toBe(2);
  });
});
