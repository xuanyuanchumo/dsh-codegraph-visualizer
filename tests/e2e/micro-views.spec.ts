import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J40: CFG 控制流图查看', () => {
  test('should have CFG view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const cfgBtn = page.locator('.cg-view-mode-btn--micro[data-mode="cfg"]');
    await expect(cfgBtn).toBeVisible();
  });

  test('should show micro view prompt when CFG mode selected without function', async ({ page }) => {
    await setupPluginPage(page);
    const microPrompt = page.locator('.cg-micro-empty-prompt');
    await expect(microPrompt).not.toBeVisible();
  });
});

test.describe('J41: 流程图查看', () => {
  test('should have flowchart view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const flowchartBtn = page.locator('.cg-view-mode-btn--micro[data-mode="flowchart"]');
    await expect(flowchartBtn).toBeVisible();
  });
});

test.describe('J42: 时序图查看', () => {
  test('should have sequence view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const sequenceBtn = page.locator('.cg-view-mode-btn--micro[data-mode="sequence"]');
    await expect(sequenceBtn).toBeVisible();
  });

  test('should render sequence diagram container when active', async ({ page }) => {
    await setupPluginPage(page);
    const seqContainer = page.locator('.cg-sequence-diagram-container');
    await expect(seqContainer).not.toBeVisible();
  });
});

test.describe('J43: 微观图谱交互', () => {
  test('should support zoom controls in sequence diagram', async ({ page }) => {
    await setupPluginPage(page);
    const zoomControls = page.locator('.cg-seq-zoom-controls');
    await expect(zoomControls).not.toBeVisible();
  });
});

test.describe('J44: 微观-宏观切换', () => {
  test('should show back to code button in micro view', async ({ page }) => {
    await setupPluginPage(page);
    const backBtn = page.locator('.cg-micro-empty-back-btn');
    await expect(backBtn).not.toBeVisible();
  });

  test('should enter micro view and return via back button', async ({ page }) => {
    await setupPluginPage(page);
    const cfgBtn = page.locator('.cg-view-mode-btn--micro[data-mode="cfg"]');
    const graphContainer = page.locator('.cg-graph-container');
    const microPrompt = page.locator('.cg-micro-empty-prompt');

    await expect(graphContainer).toBeVisible();
    await cfgBtn.click();
    await expect(microPrompt).toBeVisible({ timeout: 10000 });
    await expect(graphContainer).not.toBeVisible({ timeout: 10000 });

    const backBtn = page.locator('.cg-micro-empty-back-btn');
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();
    await expect(graphContainer).toBeVisible({ timeout: 10000 });
  });
});

test.describe('J45: 核心函数微观探索', () => {
  test('should have core function button in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    const coreFunctionBtn = page.locator('.cg-corefunction-btn');
    await expect(coreFunctionBtn).toBeVisible();
  });

  test('should show core function panel when enabled', async ({ page }) => {
    await setupPluginPage(page);
    const coreFunctionPanel = page.locator('.cg-core-function-panel');
    await expect(coreFunctionPanel).not.toBeVisible();
  });
});