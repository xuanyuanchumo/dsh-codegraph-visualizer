// E2E tests for J2: 图谱浏览与导航
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';
import { PANEL } from './selectors.ts';

test.describe('J2: 图谱浏览与导航', () => {
  test('should display graph container', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeAttached();
  });

  test('should support zoom interaction', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    const box = await graphContainer.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 100);
      await expect(graphContainer).toBeAttached();
    }
  });

  test('should support pan interaction', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    const box = await graphContainer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.up();
    }
    await expect(graphContainer).toBeAttached();
  });

  test('should handle mock node set without crash', async ({ page }) => {
    await setupPluginPage(page);
    // The dev harness loads 12 mock nodes; verify no crash.
    await expect(page.locator(PANEL.root)).toBeVisible();
  });

  test('should display node count', async ({ page }) => {
    await setupPluginPage(page);
    const nodeCount = page.locator(PANEL.nodeCount);
    await expect(nodeCount).toBeVisible();
    const text = await nodeCount.textContent();
    // 断言必须与**实际渲染的语言**一致：dev-server 默认 zh，文案是「6 节点 · 6 边」。
    // 旧断言写的是 /nodes|n\b/i（英文），于是这条用例在任何语言下都红——
    // 而它属于 `regression` 集（不在 smoke），长期没人跑就没人发现（docs/测试体系.md §2.20 同族）。
    // 正确形状：只锚定「数字 + 节点」，中英都要能过；具体数字交给别处（桩图不是 6 的契约）。
    expect(text ?? '').toMatch(/\d+\s*(节点|nodes?)/i);
    expect(text ?? '').toMatch(/\d+\s*(边|edges?)/i);
  });
});
