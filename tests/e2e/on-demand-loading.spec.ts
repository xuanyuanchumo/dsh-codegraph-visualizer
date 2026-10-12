/**
 * 按需加载链路的定量契约（对齐报告 P3-1 / `docs/图谱按需加载.md:248-285`）。
 *
 * 为什么这个 spec 必须存在：`docs/图谱按需加载.md` 的验收指标里有 5 条是**计数**
 * 契约——「首屏 1 个 bootstrap」「展开某目录后同级其他目录的子节点请求数必须为 0」
 * 「展开某文件后其他文件的符号请求数必须为 0」「展开某符号后同文件其他函数体的
 * 请求数必须为 0」「URL 恢复兄弟节点 = 0」。这些契约**无法用 DOM 断言表达**：
 * 「节点没出现」和「压根没发请求」在画面上完全一样，只有请求记录能区分。
 * 在本 spec 之前，`tests/e2e/` 21 个 spec 里没有任何一个断言「请求了哪个 URL、几次」。
 *
 * 两条环境约束（决定了能断言什么、不能断言什么）：
 *
 * 1. dev-server 只调 `init(container, payload)`（`scripts/dev-server.mjs:398-423`），
 *    **从不调 `apply(ctx)`**，因此 `WorkspaceBootstrap` / `restoreFromUrl` 都不参与，
 *    bootstrap 请求数恒为 0。所以「首屏 1 个 bootstrap」与「URL 恢复兄弟节点 = 0」
 *    这两条只能在真机（`scripts/start-dsh-test.mjs`）断言，本 spec 不断言它们，
 *    而是在断言里明确写出「dev-server 下期望 0 次」——它反而比 1 次更强。
 * 2. 目录/文件簇是**客户端合成**节点（`progressiveCluster.ts` 的 `cluster__*` /
 *    `filecluster__*`），它们不在 `rawNodes` 里，所以 `expandNode` 找不到它们、
 *    不会发任何请求。本 spec 把这一点钉成契约：目录展开必须是纯客户端重算。
 *
 * 夹具真源 = `scripts/dev-server.mjs:38-96 MOCK_GRAPH`（21 节点 / 29 边）。
 * 用到的固定 id：`m2` = `src/tools.ts`（module，含 4 个符号 `n2`/`n9`/`n10`/`n11`）、
 * `n2` = `createGraphTools`（function，位于 `src/tools.ts`）。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  setupPluginPage,
  startApiRecording,
  expandNodeViaStore,
  waitForGraphReady,
  getClusterNodeIds,
  selectNodeStrict,
  TIMEOUTS,
} from './helpers.ts';

const OUTLINE_RE = /\/files\/[^/]+\/outline$/;
const AST_RE = /\/symbols\/[^/]+\/ast$/;

/** 夹具漂移守卫：断言 MOCK_GRAPH 里确实存在这个 id，否则后面的断言会变成假绿。 */
async function expectRawNode(page: Page, nodeId: string): Promise<void> {
  const exists = await page.evaluate((id) => {
    const store = (window as any).__graphStore;
    const raw: Array<{ id: string }> = store?.getState().rawNodes ?? [];
    return raw.some((n) => n.id === id);
  }, nodeId);
  expect(exists, `夹具漂移：MOCK_GRAPH（scripts/dev-server.mjs:38-96）里没有节点 ${nodeId}`).toBe(true);
}

/**
 * 让指定的原始节点在画布上可见。
 *
 * 首屏 `clusterDepth === 0`，所有符号都被收在目录簇里，`emitNodeEvent` 找不到节点
 * 就会静默 no-op。把聚类深度设成 2（文件级）会让目录簇与文件簇一起展开，
 * 这一步是纯客户端重算，不发任何请求。
 */
async function revealNodes(page: Page, nodeIds: string[]): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__graphStore;
    store.getState().setClusterDepth(2);
  });
  await page.waitForFunction((ids: string[]) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return false;
    const present = new Set<string>(cy.nodes().map((n: any) => n.id()));
    return ids.every((id) => present.has(id));
  }, nodeIds, { timeout: TIMEOUTS.ACTION });
}

test.describe('按需加载链路（P3-1 定量契约）', () => {
  test('首屏不请求文件大纲 / 符号 AST / 关联边 / 子节点', async ({ page }) => {
    // 记录器必须在 goto 之前挂上，否则首屏自己的取数会落在窗口之外。
    const recorder = startApiRecording(page);
    await setupPluginPage(page);
    await waitForGraphReady(page);
    // 给「本该发生但被延迟到首屏之后」的请求留一个观察窗口。
    await page.waitForTimeout(500);

    expect(recorder.count((r) => OUTLINE_RE.test(r.path))).toBe(0);
    expect(recorder.count((r) => AST_RE.test(r.path))).toBe(0);
    expect(recorder.byPath('/api/v1/codegraph/edges')).toHaveLength(0);
    expect(recorder.byPath('/api/v1/codegraph/children')).toHaveLength(0);
    expect(recorder.byPath('/api/v1/codegraph/nodes/m2/children')).toHaveLength(0);

    // dev-server 走 `init()` 注入初始数据，不经 `apply(ctx)`，因此连 bootstrap
    // 都不该发——「首屏只请求 bootstrap」在这里的最强形式就是「首屏 0 个数据请求」。
    expect(recorder.byPath('/api/v1/codegraph/bootstrap')).toHaveLength(0);

    // 首屏唯一的合法请求是布局 worker 脚本本身（`LAYOUT_WORKER.ROUTE_PATH`
    // = `/api/v1/codegraph/worker/layoutWorker.js`）。它是**静态资源**，不是数据，
    // 且落在同一个 `/api/v1/codegraph/` 前缀下，所以必须显式排除，
    // 否则这条断言测的是「worker 有没有被加载」而不是「有没有按需取数」。
    // （实测同一 URL 会被请求多次，属 worker 初始化的重试行为，不在本契约范围内。）
    const nonWorker = recorder.requests.filter(
      (r) => r.path !== '/api/v1/codegraph/worker/layoutWorker.js',
    );
    expect(nonWorker, `首屏出现了非 worker 的请求：${JSON.stringify(nonWorker)}`).toHaveLength(0);

    recorder.stop();
  });

  test('展开文件节点只拉该文件的大纲，其他文件为 0', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    await expectRawNode(page, 'm2');

    const recorder = startApiRecording(page);
    await expandNodeViaStore(page, 'm2');

    await expect
      .poll(() => recorder.byPath('/api/v1/codegraph/files/m2/outline').length, { timeout: TIMEOUTS.ACTION })
      .toBe(1);
    // 让「其他文件也会被顺带拉一次」这种回归有时间暴露出来。
    await page.waitForTimeout(500);

    expect(recorder.count((r) => OUTLINE_RE.test(r.path)), '展开一个文件不得拉其他文件的大纲').toBe(1);
    for (const other of ['m1', 'm3', 'm4', 'm5']) {
      expect(recorder.byPath(`/api/v1/codegraph/files/${other}/outline`)).toHaveLength(0);
    }

    // `loadNodeChildren` 对每个展开目标都会打一次，但必须只打这一个目标。
    const childrenReqs = recorder.byPath('/api/v1/codegraph/children');
    expect(childrenReqs).toHaveLength(1);
    expect(childrenReqs[0]?.query.nodeId).toBe('m2');

    // `currentWorkspace` 默认 `'.'`，而 `fetchFileOutline` 在 workspace === '.' 时
    // 刻意省略该参数（`src/client/api/index.ts:227`），所以 URL 里不该出现 workspace。
    expect(recorder.byPath('/api/v1/codegraph/files/m2/outline')[0]?.query.workspace).toBeUndefined();

    recorder.stop();
  });

  test('展开函数节点只拉该符号的 AST，同文件其他函数体为 0', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    await expectRawNode(page, 'n2');

    const recorder = startApiRecording(page);
    await expandNodeViaStore(page, 'n2');

    await expect
      .poll(() => recorder.byPath('/api/v1/codegraph/symbols/n2/ast').length, { timeout: TIMEOUTS.ACTION })
      .toBe(1);
    await page.waitForTimeout(500);

    expect(recorder.count((r) => AST_RE.test(r.path)), '展开一个符号不得拉同文件其他函数体').toBe(1);
    for (const sibling of ['n9', 'n10', 'n11']) {
      expect(recorder.byPath(`/api/v1/codegraph/symbols/${sibling}/ast`)).toHaveLength(0);
    }
    // 文件级大纲与关联边都不该被符号展开牵出来。
    expect(recorder.count((r) => OUTLINE_RE.test(r.path))).toBe(0);
    expect(recorder.byPath('/api/v1/codegraph/edges')).toHaveLength(0);

    // dev-server 的 AST 桩返回完整 6 键（`scripts/dev-server.mjs:912-933`），
    // 客户端必须把它记成「本页即全部」，而不是降级成 `hasMore: true` 的假承诺。
    const astPage = await page.evaluate(() => {
      const store = (window as any).__graphStore;
      const p = store.getState().astPageByNodeId.get('n2');
      return p ? { ...p } : null;
    });
    expect(astPage).toEqual({ loaded: 1, total: 1, hasMore: false, cursor: 1 });

    recorder.stop();
  });

  test('展开目录簇是纯客户端重算，不产生任何 API 请求', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);

    const clusterIds = await getClusterNodeIds(page);
    expect(clusterIds.length, '首屏 clusterDepth=0，应当存在目录簇').toBeGreaterThan(0);
    const target = clusterIds[0]!;

    const recorder = startApiRecording(page);
    await expandNodeViaStore(page, target);
    await page.waitForTimeout(500);

    // `cluster__*` 是客户端合成 id，不在 `rawNodes` 里，`expandNode` 的
    // `rawNodes.find(...)` 因此返回 undefined，整个取数块被跳过。
    // 这条断言同时守住「目录展开退化成一次无意义 404」这类回归。
    // 同样排除 worker 静态资源（见首屏用例的说明）。
    const clusterNonWorker = recorder.requests.filter(
      (r) => r.path !== '/api/v1/codegraph/worker/layoutWorker.js',
    );
    expect(clusterNonWorker, `展开目录簇 ${target} 不应产生任何请求`).toHaveLength(0);

    const expanded = await page.evaluate(() => {
      const store = (window as any).__graphStore;
      return Array.from(store.getState().expandedNodeIds as Set<string>);
    });
    expect(expanded).toContain(target);

    recorder.stop();
  });

  test('关联边只在选中节点后按需拉取，limit 不超过 500 且不重复拉首页', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    await expectRawNode(page, 'n2');

    const recorder = startApiRecording(page);
    // 让 n2 在画布上可见（纯客户端重算），此时还没有任何选中。
    await revealNodes(page, ['n2']);
    expect(recorder.byPath('/api/v1/codegraph/edges'), '仅让节点可见不应触发关联边请求').toHaveLength(0);

    await selectNodeStrict(page, 'n2');
    await expect
      .poll(() => recorder.byPath('/api/v1/codegraph/edges').length, { timeout: TIMEOUTS.ACTION })
      .toBe(1);

    const edgeReq = recorder.byPath('/api/v1/codegraph/edges')[0]!;
    expect(edgeReq.query.from).toBe('n2');
    expect(edgeReq.query.scope).toBe('file');
    expect(edgeReq.query.cursor).toBe('0');
    // `docs/图谱按需加载.md:265`「行为层单次符号级边 ≤ 500」：客户端下发的
    // limit 必须已经在预算内，而不是靠服务端兜底截断。
    expect(Number(edgeReq.query.limit)).toBeLessThanOrEqual(500);

    // `useNodeEdgeList` 的 requestedRef 必须挡住重复挂载造成的二次首页拉取。
    await page.waitForTimeout(500);
    expect(recorder.byPath('/api/v1/codegraph/edges'), '同一次选中不得重复拉取第一页').toHaveLength(1);

    recorder.stop();
  });
});
