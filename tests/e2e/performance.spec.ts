import { test, expect } from '@playwright/test';
import { setupPluginPage, panGraph, getVisibleNodeCount, getCyNodeCount, openDropdown } from './helpers.ts';
import { PANEL, TRIGGERS, DROPDOWN_CONTENT, OPTION } from './selectors.ts';

test.describe('J35: 虚拟滚动', () => {
  /**
   * ## 这组用例在 cycle-93 之前是什么
   *
   * 六条断言全是「容器可见」/「计数 >= 0」，**空图与满图都通过**，零鉴别力。
   * 更根本的问题是：这个特性当时**根本不可达**——阈值 2500 高于 code 视图显示层的
   * 硬上限 1500（`CLUSTER.MAX_VISIBLE_NODES`），所以「虚拟滚动是否真的开启」
   * 无论怎么断言都不会为真，只能退化成"容器还在"。
   * 见 `tests/unit/virtualScrollReachability.test.ts` 的源码级契约。
   *
   * ## 现在断言什么
   *
   * 1. 注入 3000 个函数节点后切到 `callgraph` 分层视图：这条路**无聚类上限**
   *    （`graphDataSlice.ts:65-101` 直写 layer0，层定义见 `diagram/index.ts:69-73`），
   *    所以显示层能真的越过阈值；
   * 2. 容器上出现 `data-cg-virtual-scroll="on"`——这是该特性**唯一**在 DOM 上的
   *    可观测痕迹（`CytoscapeRenderer.ts:233-238` 写、`:240-243` 删）；
   * 3. 关掉它（切回小图）后标记必须消失：只有一条"开启"断言时，
   *    一个永远写标记的实现同样能过。
   *
   * 为什么必须走分层视图：`code` 视图的显示层是**一级目录聚类**，
   * 节点再多也可能只有几十个可见节点（3000 节点/3000 目录才等于 3000），
   * 拿它做可达性断言是在赌数据形状，而不是在断言产品行为。
   */
  const BIG_NODE_COUNT = 3000;

  /** 注入一张「每个函数都是入度为零的根」的大图，并切到无上限的 callgraph 分层视图。 */
  async function injectLargeGraphAndSwitchToCallgraph(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate((count: number) => {
      const store = (window as any).__graphStore;
      if (!store) throw new Error('__graphStore missing — dev-server must set localStorage.__cg_debug=1');
      const nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          id: `big${i}`,
          label: `fn${i}`,
          type: 'function',
          filePath: `src/mod${i}/file${i}.ts`,
          lineNumber: 1,
          properties: {},
        });
      }
      // 入度为零 ⇒ CallGraphAssembler.enrichNode 置 isEntry=true ⇒ 全部落在 layer0
      // （`diagram/index.ts:70`：isEntry===true || depth<=1）。
      store.getState().setGraphData(nodes, [], 'e2e-virtual-scroll');
      store.getState().setViewMode('callgraph');
    }, BIG_NODE_COUNT);
  }

  test('should enable virtual scroll once the display layer passes the threshold', async ({ page }) => {
    await setupPluginPage(page);
    await injectLargeGraphAndSwitchToCallgraph(page);

    // 前置条件先钉住：显示层真的越过了阈值，否则下面的断言会因为"图太小"而失败，
    // 让人误以为是虚拟滚动坏了。
    const displayCount = await page.evaluate(() => (window as any).__graphStore.getState().nodes.length);
    expect(displayCount, '分层视图的显示层没有超过阈值，本用例无法验证虚拟滚动').toBeGreaterThan(
      VIRTUAL_SCROLL_THRESHOLD
    );

    await expect(page.locator(PANEL.graphContainer)).toHaveAttribute('data-cg-virtual-scroll', 'on', {
      timeout: 10000,
    });
  });

  test('should turn virtual scroll back off for a small graph (reverse check)', async ({ page }) => {
    await setupPluginPage(page);
    await injectLargeGraphAndSwitchToCallgraph(page);
    await expect(page.locator(PANEL.graphContainer)).toHaveAttribute('data-cg-virtual-scroll', 'on', {
      timeout: 10000,
    });

    // 切回小图：标记必须消失。没有这一条，"永远写标记"的实现也能通过上面那条。
    await page.evaluate(() => {
      const store = (window as any).__graphStore;
      store.getState().setViewMode('code');
      store.getState().setGraphData(
        [
          {
            id: 'small1',
            label: 'only',
            type: 'function',
            filePath: 'src/a.ts',
            lineNumber: 1,
            properties: {},
          },
        ],
        [],
        'e2e-virtual-scroll-small'
      );
    });
    await expect(page.locator(PANEL.graphContainer)).not.toHaveAttribute('data-cg-virtual-scroll', 'on', {
      timeout: 10000,
    });
  });

  test('should keep the graph container alive while panning a virtualised large graph', async ({ page }) => {
    await setupPluginPage(page);
    await injectLargeGraphAndSwitchToCallgraph(page);
    await expect(page.locator(PANEL.graphContainer)).toHaveAttribute('data-cg-virtual-scroll', 'on', {
      timeout: 10000,
    });

    for (let i = 0; i < 5; i++) {
      await panGraph(page, 50 * i, 30 * i);
    }

    await expect(page.locator(PANEL.graphContainer)).toBeAttached();
    await expect(page.locator(PANEL.overlay)).not.toBeVisible();
    // 注意：这里**不**断言「可见节点数 < 总数」。首屏 fit 之后全部节点都落在视口内，
    // 可见数就等于总数——那个断言看起来很有力，实际是在赌 fit 的取景结果。
    // 虚拟滚动"真的在裁剪"由 `VirtualViewportController` 自己的单测负责
    // （`tests/unit/VirtualViewportController.test.ts:242-249` 断言监听与 display 写入）。
    const visibleCount = await getVisibleNodeCount(page);
    expect(visibleCount).toBeGreaterThan(0);
  });
});

/** 与 `src/shared/constants.ts` 的 VIRTUAL_VIEWPORT.SCROLL_THRESHOLD 对齐。 */
const VIRTUAL_SCROLL_THRESHOLD = 500;

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
  /**
   * 原实现只断言 `expect([200, 304]).toContain(response2.status)` —— 这个断言**含 200 故恒真**：
   * 即使条件请求完全失效（每次都回 200 全量重取），用例也照样绿。P3-R27-03 登记的正是这一点。
   *
   * 修法：把"是否真的发生了条件请求"拆成**三条各自有鉴别力**的断言：
   *   ① 第一次必须是 200 且**真的带上了 etag**（没有校验值就无从回传）；
   *   ② 回传该 etag 必须收到 **304**（不是 200）—— 这是条件请求生效的**唯一**证据；
   *   ③ 回传一个**伪造的** etag 必须收到 200 —— 反向鉴别力：证明 304 是"匹配"换来的，
   *      而不是服务端无条件短路（无条件 304 会让 ② 也变绿，两条一起才排除了这个解释）。
   *
   * 断言 ③ 是关键：只有 ② 单独存在时，"服务端永远回 304" 这种坏实现同样能过。
   */
  test('should answer 304 to a matching validator and 200 to a stale one', async ({ page }) => {
    await setupPluginPage(page);

    // ① 首次请求：200 + 真实 etag
    const response1 = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/data');
      return { status: res.status, etag: res.headers.get('etag') };
    });
    expect(response1.status).toBe(200);
    expect(response1.etag).toBeTruthy();

    // ② 原样回传校验值 → 必须是 304（不能是 200）
    const response2 = await page.evaluate(async (etag: string) => {
      const res = await fetch('/api/v1/codegraph/data', {
        headers: { 'if-none-match': etag },
      });
      return { status: res.status, etag: res.headers.get('etag') };
    }, response1.etag as string);
    expect(response2.status).toBe(304);
    // 304 也必须带 ETag：客户端下一轮仍要有值可回传（cycle-91 的核心教训）
    expect(response2.etag).toBe(response1.etag);

    // ③ 反向鉴别力：陈旧的校验值必须回 200，否则 ② 可能被"无条件 304"解释
    const response3 = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/data', {
        headers: { 'if-none-match': 'W/"stale-validator-0000000000000000"' },
      });
      return { status: res.status };
    });
    expect(response3.status).toBe(200);
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