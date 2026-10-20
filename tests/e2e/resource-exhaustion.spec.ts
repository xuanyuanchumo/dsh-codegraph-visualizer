// 旅程覆盖：J12（FR-54 异常恢复与容错——资源耗尽/并发混沌下的降级与恢复）。
// 资源耗尽与并发混沌测试。
//
// cycle-81 修正：原用例用 `getCyNodeIdsByClass(page, 'cluster')` 取聚类节点，
// 但聚类标记是 cytoscape **数据属性** `isCluster`（`DataController.ts:265`、
// `ThemeStylesheet.ts:575` 用 `node[?isCluster]` 选择），不是类名——
// 原选择器恒返回空数组，三条 `expect(nodeIds.length).toBeGreaterThan(0)` 必然失败。
// 这里改用 `getClusterNodeIds`（按 `data('isCluster') === true` 显式布尔过滤）。
// cycle-89 补充：`[isCluster="true"]` 本身也是错的——`isCluster` 写入的是 JS 布尔，
// 而 cytoscape 的 `[prop="true"]` 只匹配**字符串** "true"，该选择器命中 0 个元素
// （详见 `tests/unit/styleSelectorContract.test.ts`）。若当前图谱未触发聚类
// （dev-server 只有 21 个节点，远低于 `CLUSTER.MIN_NODES_FOR_SUBGROUP = 50`），
// 则退回全量节点 id，保证并发路径本身仍被覆盖。
import { test, expect, type Page } from '@playwright/test';
import {
  setupPluginPage,
  waitForGraphReady,
  getCyNodeCount,
  getClusterNodeIds,
  getAllCyNodeIds,
  selectNode,
  TIMEOUTS,
} from './helpers.ts';
import { PANEL } from './selectors.ts';

/** 取并发目标 id：优先聚类节点，无聚类时退回全量节点。 */
async function concurrencyTargetIds(page: Page): Promise<string[]> {
  const clusters = await getClusterNodeIds(page);
  if (clusters.length > 0) return clusters;
  return getAllCyNodeIds(page);
}

test.describe('Resource exhaustion & concurrency chaos', () => {

  test('concurrent expand requests do not corrupt graph state', async ({ page }: { page: Page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const nodeIds = await concurrencyTargetIds(page);
    expect(nodeIds.length).toBeGreaterThan(0);

    const results = await page.evaluate(async (ids) => {
      const errors: string[] = [];
      const promises = ids.slice(0, 5).map((id) =>
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
    }, nodeIds);

    expect(results.errors.length).toBe(0);
    expect(results.total).toBe(Math.min(nodeIds.length, 5));
  });

  test('rapid expand/collapse cycles maintain consistency', async ({ page }: { page: Page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const nodeIds = await concurrencyTargetIds(page);
    expect(nodeIds.length).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      await selectNode(page, nodeIds[0]);
      await page.waitForTimeout(100);
      const collapseBtn = page.locator(PANEL.collapsedFab);
      if (await collapseBtn.isVisible()) {
        await collapseBtn.click();
        await page.waitForTimeout(100);
      }
    }

    const nodeCount = await getCyNodeCount(page);
    expect(nodeCount).toBeGreaterThan(0);
  });

  test('large node count does not crash renderer', async ({ page }: { page: Page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const metrics = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      const nodeCount = cy ? cy.nodes().length : 0;
      const edgeCount = cy ? cy.edges().length : 0;
      const memoryMB = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1024 / 1024)
        : -1;
      return { nodeCount, edgeCount, memoryMB };
    });

    expect(metrics.nodeCount).toBeGreaterThan(0);
    if (metrics.memoryMB > 0) {
      expect(metrics.memoryMB).toBeLessThan(500);
    }
  });

  test('abort in-flight requests on rapid navigation', async ({ page }: { page: Page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page, TIMEOUTS.ACTION);

    const nodeIds = await concurrencyTargetIds(page);
    expect(nodeIds.length).toBeGreaterThan(0);

    const abortResult = await page.evaluate(async (ids) => {
      const targets = ids.slice(0, 3);
      const controllers = targets.map(() => new AbortController());
      const promises = targets.map((id, i) =>
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
    }, nodeIds);

    expect(abortResult.aborted).toBeGreaterThan(0);
  });
});
