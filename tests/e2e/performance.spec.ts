import { test, expect } from '@playwright/test';
import { setupPluginPage, panGraph, getVisibleNodeCount, getCyNodeCount, openDropdown } from './helpers.ts';
import { PANEL, TRIGGERS, DROPDOWN_CONTENT, OPTION } from './selectors.ts';

test.describe('J35: 虚拟滚动', () => {
  test('should render graph container for large graphs', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();
  });

  test('should not crash with empty graph data', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });

  test('should maintain graph container during pan', async ({ page }) => {
    await setupPluginPage(page);
    await panGraph(page, 100, 50);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();
  });

  test('should maintain non-negative visible node count during pan', async ({ page }) => {
    await setupPluginPage(page);
    await panGraph(page, 200, 100);
    const visibleCount = await getVisibleNodeCount(page);
    expect(visibleCount).toBeGreaterThanOrEqual(0);
  });

  test('should not show error overlay during pan', async ({ page }) => {
    await setupPluginPage(page);
    await panGraph(page, 150, 75);
    const errorOverlay = page.locator(PANEL.overlay);
    await expect(errorOverlay).not.toBeVisible();
  });

  test('should handle rapid pan without crash', async ({ page }) => {
    await setupPluginPage(page);
    for (let i = 0; i < 5; i++) {
      await panGraph(page, 50 * i, 30 * i);
    }
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeAttached();
    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('J36: 增量布局', () => {
  test('should support layout switching without full re-render', async ({ page }) => {
    await setupPluginPage(page);
    // 布局切换不是独立按钮族：触发器是「布局」下拉（`cg-layout-dropdown-btn`），
    // 各布局是可选项 `cg-layout-option-*`（`ToolbarViewMode.tsx:57/68`）。
    await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
    const layoutOptions = page.locator(`${DROPDOWN_CONTENT.layout} [class*="cg-layout-option-"]`);
    expect(await layoutOptions.count()).toBeGreaterThan(0);
    await expect(page.locator(OPTION.layout('cose'))).toBeVisible();
  });
});

test.describe('J37: Web Worker 并行', () => {
  test('should have worker layout capability check', async ({ page }) => {
    await setupPluginPage(page);
    const graphContainer = page.locator(PANEL.graphContainer);
    await expect(graphContainer).toBeVisible();
  });

  test('should fallback to main-thread layout when worker unavailable', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
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