import { test, expect, type Page } from '@playwright/test';

test.describe('Resource exhaustion & concurrency chaos', () => {

  test('concurrent expand requests do not corrupt graph state', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="graph-panel"]', { timeout: 30000 });

    const nodes = await page.$$eval('[data-testid="graph-node"]', (els) =>
      els.slice(0, 5).map((el) => el.getAttribute('data-node-id')).filter(Boolean)
    );

    if (nodes.length < 2) {
      test.skip();
      return;
    }

    const results = await page.evaluate(async (nodeIds) => {
      const errors: string[] = [];
      const promises = nodeIds.map((id) =>
        window.fetch(`/api/v1/codegraph/nodes/${id}/children`).then(
          (r) => ({ ok: r.ok, status: r.status }),
          (e) => ({ error: String(e) })
        )
      );
      const responses = await Promise.allSettled(promises);
      for (const r of responses) {
        if (r.status === 'rejected') errors.push(String(r.reason));
        if (r.status === 'fulfilled' && r.value && 'error' in r.value) errors.push(r.value.error!);
      }
      return { errors, total: responses.length };
    }, nodes);

    expect(results.errors.length).toBe(0);
    expect(results.total).toBe(nodes.length);
  });

  test('rapid expand/collapse cycles maintain consistency', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="graph-panel"]', { timeout: 30000 });

    const firstNode = await page.$('[data-testid="graph-node"]');
    if (!firstNode) {
      test.skip();
      return;
    }

    const nodeId = await firstNode.getAttribute('data-node-id');
    if (!nodeId) {
      test.skip();
      return;
    }

    for (let i = 0; i < 5; i++) {
      await firstNode.click();
      await page.waitForTimeout(100);
      const collapseBtn = await page.$('[data-testid="collapse-all-btn"]');
      if (collapseBtn) {
        await collapseBtn.click();
        await page.waitForTimeout(100);
      }
    }

    const nodeCount = await page.$$eval('[data-testid="graph-node"]', (els) => els.length);
    expect(nodeCount).toBeGreaterThan(0);
  });

  test('large node count does not crash renderer', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="graph-panel"]', { timeout: 30000 });

    const metrics = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-testid="graph-node"]');
      const edges = document.querySelectorAll('[data-testid="graph-edge"]');
      return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        memoryMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1024 / 1024)
          : -1,
      };
    });

    expect(metrics.nodeCount).toBeGreaterThan(0);
    if (metrics.memoryMB > 0) {
      expect(metrics.memoryMB).toBeLessThan(500);
    }
  });

  test('abort in-flight requests on rapid navigation', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="graph-panel"]', { timeout: 30000 });

    const nodes = await page.$$eval('[data-testid="graph-node"]', (els) =>
      els.slice(0, 3).map((el) => el.getAttribute('data-node-id')).filter(Boolean)
    );

    if (nodes.length === 0) {
      test.skip();
      return;
    }

    const abortResult = await page.evaluate(async (nodeIds) => {
      const controllers = nodeIds.map(() => new AbortController());
      const promises = nodeIds.map((id, i) =>
        window.fetch(`/api/v1/codegraph/nodes/${id}/children`, { signal: controllers[i].signal }).then(
          (r) => ({ ok: r.ok }),
          (e) => ({ aborted: e instanceof DOMException && e.name === 'AbortError' })
        )
      );
      controllers.forEach((c) => c.abort());
      const results = await Promise.allSettled(promises);
      const aborted = results.filter(
        (r) => r.status === 'fulfilled' && r.value && 'aborted' in r.value && r.value.aborted
      ).length;
      return { aborted, total: results.length };
    }, nodes);

    expect(abortResult.aborted).toBeGreaterThan(0);
  });
});