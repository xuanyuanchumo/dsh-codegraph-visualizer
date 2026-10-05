// E2E tests for J40-J45: 微观视图（CFG / 流程图 / 时序图）与核心函数探索
//
// 微观视图不是独立按钮，而是「视图模式」下拉（`cg-view-dropdown-btn`）里的
// `cg-viewmode-option-cfg|flowchart|sequence` 选项，且它们带 `disabled={!hasSelectedFunction}`
// ——必须先选中一个函数节点才能进入。进入后画布被 `MicroViewBar` 的
// `cg-micro-empty-prompt` 替换（`src/client/components/MicroViewBar.tsx:19`）。
import { test, expect } from '@playwright/test';
import {
  setupPluginPage,
  waitForGraphReady,
  getCyNodeIdsByType,
  selectFunctionNode,
  selectViewMode,
  openDropdown,
  TIMEOUTS,
} from './helpers.ts';
import { TRIGGERS, DROPDOWN_CONTENT, OPTION, MICRO, PANEL } from './selectors.ts';

/**
 * 选中一个函数节点；失败则返回 null（用于 `test.skip`）。
 *
 * 注意用 `getCyNodeIdsByType` 而不是 `getCyNodeIdsByClass`：节点类型是 cytoscape
 * 数据属性（`DataController.ts:262`），不是类名，`.function` 选择器选不到任何节点。
 */
async function pickFunctionNode(page: import('@playwright/test').Page): Promise<string | null> {
  await waitForGraphReady(page);
  const ids = await getCyNodeIdsByType(page, 'function');
  return ids[0] ?? null;
}

test.describe('J40: CFG 控制流图查看', () => {
  test('视图模式下拉应提供 CFG 选项', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await expect(page.locator(OPTION.viewMode('cfg'))).toBeVisible();
  });

  test('未选中函数时 CFG 选项应禁用', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    // `ToolbarViewMode.tsx` 的微观视图项 `disabled={!hasSelectedFunction}`。
    await expect(page.locator(OPTION.viewMode('cfg'))).toBeDisabled();
  });

  test('选中函数后进入 CFG 视图应显示空态提示', async ({ page }) => {
    await setupPluginPage(page);
    const nodeId = await pickFunctionNode(page);
    if (!nodeId) {
      test.skip(true, 'No function nodes available');
      return;
    }
    await selectFunctionNode(page, nodeId);
    await selectViewMode(page, 'cfg');
    await expect(page.locator(MICRO.emptyPrompt)).toBeVisible({ timeout: TIMEOUTS.ACTION });
  });
});

test.describe('J41: 流程图查看', () => {
  test('视图模式下拉应提供流程图选项', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await expect(page.locator(OPTION.viewMode('flowchart'))).toBeVisible();
  });

  test('未选中函数时流程图选项应禁用', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await expect(page.locator(OPTION.viewMode('flowchart'))).toBeDisabled();
  });
});

test.describe('J42: 时序图查看', () => {
  test('视图模式下拉应提供时序图选项', async ({ page }) => {
    await setupPluginPage(page);
    await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
    await expect(page.locator(OPTION.viewMode('sequence'))).toBeVisible();
  });

  test('未进入时序图时不应渲染时序图容器', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(MICRO.sequenceContainer)).not.toBeVisible();
  });
});

test.describe('J43: 微观图谱交互', () => {
  test('未进入时序图时不应渲染缩放控件', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(MICRO.seqZoomControls)).not.toBeVisible();
  });
});

test.describe('J44: 微观-宏观切换', () => {
  test('宏观视图下不应显示返回按钮', async ({ page }) => {
    await setupPluginPage(page);
    await expect(page.locator(MICRO.emptyBackBtn)).not.toBeVisible();
  });

  test('进入 CFG 后应能通过返回按钮回到宏观视图', async ({ page }) => {
    await setupPluginPage(page);
    const nodeId = await pickFunctionNode(page);
    if (!nodeId) {
      test.skip(true, 'No function nodes available');
      return;
    }
    await selectFunctionNode(page, nodeId);

    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();

    await selectViewMode(page, 'cfg');
    await expect(page.locator(MICRO.emptyPrompt)).toBeVisible({ timeout: TIMEOUTS.ACTION });
    await expect(graphContainer).not.toBeVisible({ timeout: TIMEOUTS.ACTION });

    await expect(page.locator(MICRO.emptyBackBtn)).toBeVisible({ timeout: TIMEOUTS.ACTION });
    await page.locator(MICRO.emptyBackBtn).click();
    await expect(graphContainer).toBeVisible({ timeout: TIMEOUTS.ACTION });
  });
});

test.describe('J45: 核心函数微观探索', () => {
  test('「工具」下拉应提供核心函数开关', async ({ page }) => {
    await setupPluginPage(page);
    // 面板开关在「工具」下拉内，未展开时不在 DOM 中。
    await openDropdown(page, TRIGGERS.tools);
    await expect(page.locator('.cg-corefunction-btn')).toBeVisible();
  });

  test('核心函数面板默认不应显示', async ({ page }) => {
    await setupPluginPage(page);
    // 面板根类名由 `AnalysisPanelShell` 动态拼出：`cg-${variant}-panel`，
    // `CoreFunctionPanel.tsx:26` 传的 variant 是 `core-function`。
    await expect(page.locator(MICRO.coreFunctionPanel)).not.toBeVisible();
  });
});
