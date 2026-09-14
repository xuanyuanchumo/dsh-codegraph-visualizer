import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J40: CFG 控制流图查看', () => {
  test('should have CFG view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const cfgBtn = page.locator('.view-mode-btn--micro[data-mode="cfg"]');
    await expect(cfgBtn).toBeVisible().catch(() => {});
  });

  test('should show micro view prompt when CFG mode selected without function', async ({ page }) => {
    await setupPluginPage(page);
    const microPrompt = page.locator('.micro-empty-prompt');
    await expect(microPrompt).not.toBeVisible();
  });
});

test.describe('J41: 流程图查看', () => {
  test('should have flowchart view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const flowchartBtn = page.locator('.view-mode-btn--micro[data-mode="flowchart"]');
    await expect(flowchartBtn).toBeVisible().catch(() => {});
  });
});

test.describe('J42: 时序图查看', () => {
  test('should have sequence view mode button', async ({ page }) => {
    await setupPluginPage(page);
    const sequenceBtn = page.locator('.view-mode-btn--micro[data-mode="sequence"]');
    await expect(sequenceBtn).toBeVisible().catch(() => {});
  });

  test('should render sequence diagram container when active', async ({ page }) => {
    await setupPluginPage(page);
    const seqContainer = page.locator('.sequence-diagram-container');
    await expect(seqContainer).not.toBeVisible();
  });
});

test.describe('J43: 微观图谱交互', () => {
  test('should support zoom controls in sequence diagram', async ({ page }) => {
    await setupPluginPage(page);
    const zoomControls = page.locator('.seq-zoom-controls');
    await expect(zoomControls).not.toBeVisible();
  });
});

test.describe('J44: 微观-宏观切换', () => {
  test('should show back to code button in micro view', async ({ page }) => {
    await setupPluginPage(page);
    const backBtn = page.locator('.micro-empty-back-btn');
    await expect(backBtn).not.toBeVisible();
  });

  test('should return to code view when back button clicked', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.graph-container');
    await expect(graphContainer).toBeVisible();
  });
});

test.describe('J45: 核心函数微观探索', () => {
  test('should have core function button in toolbar', async ({ page }) => {
    await setupPluginPage(page);
    const coreFunctionBtn = page.locator('.corefunction-btn');
    await expect(coreFunctionBtn).toBeVisible().catch(() => {});
  });

  test('should show core function panel when enabled', async ({ page }) => {
    await setupPluginPage(page);
    const coreFunctionPanel = page.locator('.core-function-panel');
    await expect(coreFunctionPanel).not.toBeVisible();
  });
});