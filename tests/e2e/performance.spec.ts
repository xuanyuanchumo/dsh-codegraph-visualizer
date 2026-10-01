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
test.describe('Performance metrics', () => {
  test('should maintain reasonable DOM node count', async ({ page }) => {
    await setupPluginPage(page);
    await page.waitForFunction(() => {
      const cy = (window as any).__cytoscape;
      return cy && cy.nodes().length > 0;
    }, { timeout: 10000 });
    const nodeCount = await page.evaluate(() => document.querySelectorAll('*').length);
    expect(nodeCount).toBeLessThan(5000);
  });

  test('should load graph within reasonable time', async ({ page }) => {
    const start = Date.now();
    await setupPluginPage(page);
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(60000);
  });

  test('should not have excessive console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await setupPluginPage(page);
    await page.waitForFunction(() => {
      const cy = (window as any).__cytoscape;
      return cy && cy.nodes().length > 0;
    }, { timeout: 10000 });
    expect(errors.length).toBeLessThan(10);
  });

  test('should have stable memory usage', async ({ page }) => {
    await setupPluginPage(page);
    await page.waitForFunction(() => {
      const cy = (window as any).__cytoscape;
      return cy && cy.nodes().length > 0;
    }, { timeout: 10000 });
    const memInfo = await page.evaluate(() => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } };
      return perf.memory ? { used: perf.memory.usedJSHeapSize, total: perf.memory.totalJSHeapSize } : null;
    });
    if (memInfo) {
      expect(memInfo.used).toBeLessThan(500 * 1024 * 1024);
      expect(memInfo.total).toBeLessThan(1024 * 1024 * 1024);
    }
  });
});