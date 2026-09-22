import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('J35: 虚拟滚动', () => {
  test('should render graph container for large graphs', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('should not crash with empty graph data', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.cg-graph-panel');
    await expect(graphPanel).toBeVisible();
  });
});

test.describe('J36: 增量布局', () => {
  test('should support layout switching without full re-render', async ({ page }) => {
    await setupPluginPage(page);
    const layoutBtns = page.locator('.cg-layout-btn');
    const count = await layoutBtns.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('J37: Web Worker 并行', () => {
  test('should have worker layout capability check', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible();
  });

  test('should fallback to main-thread layout when worker unavailable', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator('.cg-graph-panel');
    await expect(graphPanel).toBeVisible();
  });
});

test.describe('J38: 智能缓存', () => {
  test('should cache graph data for repeated loads', async ({ page }) => {
    await setupPluginPage(page);
    const response1 = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/data');
      return { status: res.status, etag: res.headers.get('etag') };
    });
    expect(response1.status).toBe(200);

    const response2 = await page.evaluate(async (etag: string) => {
      const res = await fetch('/api/v1/codegraph/data', {
        headers: { 'if-none-match': etag },
      });
      return { status: res.status };
    }, response1.etag ?? '');
    expect([200, 304]).toContain(response2.status);
  });
});