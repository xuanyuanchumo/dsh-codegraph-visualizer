/**
 * 旅程覆盖：J50「关键词检索定位」的 E2E 断言（cycle-111 / N-5）。
 *
 * ## 为什么这条 spec 必须存在
 *
 * `tests/unit/queryRoute.test.ts`（34 例）证明宿主路由的**契约**正确，
 * `tests/component/KeywordQueryPanel.test.tsx`（20 例）证明面板的**渲染**正确。
 * 但两者都用一个替身跨过了中间那层：**面板真的会为一次回车发出一次 `/query` 请求吗？**
 * 这是在画面上无法证伪的问题——「请求发了但结果没渲染」与「根本没发请求」在 DOM 上
 * 完全一样（本仓在 `on-demand-loading.spec.ts` 的头部记录过同一形态）。只有进程侧的
 * 请求录制能回答它。
 *
 * ## 三条环境纪律
 *
 * 1. 录制用 `page.on('request')`（进程侧），**不用** `page.route()`：后者会桩掉响应，
 *    于是测的就不再是真实取数路径（`docs/需求分析.md` 的记录）。
 * 2. 静态资源必须从断言里排除：本 spec 只关心 `/api/v1/codegraph/query`，
 *    用 `pathname` 精确匹配而不是正则模糊匹配，`layoutWorker.js` 之类自然不进统计。
 * 3. E2E 读的是**构建产物**（`dist/client/index.esm.js`），不是 `src/`。改动 `src/` 之后
 *    必须先 `pnpm run build:client`，否则测的是上一版代码（本仓踩过：`dist/client.js`
 *    陈旧让两个 M 系列探针都报 ALL PASS）。
 *
 * ## 断言的三条，各自能独立失败
 *
 * - **恰好一次**：多一次（重复提交）与零次（没接线）是两种不同的缺陷；
 * - **参数正确**：`q` / `depth` / `tokenBudget` 必须等于面板发出的值——只断言"发了请求"
 *   的话，参数写错（例如把 `tokenBudget` 拼成 `budget`）会静默通过；
 * - **ETag 回写可读**：200 响应必须带 `etag`，且第二次同样查询带 `if-none-match`；
 *   否则「304 分支」在这条链路上是死代码（P3-R18-02 的原始形态）。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupPluginPage, TIMEOUTS } from './helpers.ts';
// 选择器**必须**来自 `selectors.ts`：那里是单一事实源，且 `e2eSelectorContract.test.ts`
// 会反向扫描「代码里是否真有这个类名」。spec 里裸写字面量的代价是「改一个类名 ⇒
// 全部 E2E 静默等超时」，而超时是症状不是诊断（本仓为此误诊过 8 轮）。
import { TRIGGERS, TOOL_ITEM, KEYWORD_QUERY } from './selectors.ts';

const QUERY_PATH = '/api/v1/codegraph/query';

/** 本 spec 用到的选择器，全部取自登记表。 */
const SEL = {
  toolsTrigger: TRIGGERS.tools,
  keywordToolItem: TOOL_ITEM.keywordQuery,
  panel: KEYWORD_QUERY.panel,
  input: KEYWORD_QUERY.input,
  submit: KEYWORD_QUERY.submit,
  seed: KEYWORD_QUERY.seed,
  summary: KEYWORD_QUERY.summary,
  idle: KEYWORD_QUERY.idle,
  truncated: KEYWORD_QUERY.truncated,
} as const;

interface QueryRecord {
  url: string;
  q: string | null;
  depth: string | null;
  tokenBudget: string | null;
  ifNoneMatch: string | null;
}

/**
 * 只在**进程侧**记录对 `/query` 的请求。
 *
 * 用 `pathname === QUERY_PATH` 精确匹配：正则模糊匹配会把所有 `/api/v1/codegraph/*`
 * 都收进来，于是"恰好一次"这条断言随时会被别的面板的请求打乱，而失败信息与关键词毫无关系。
 */
function recordQueryRequests(page: Page): QueryRecord[] {
  const records: QueryRecord[] = [];
  page.on('request', (request) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      return;
    }
    if (parsed.pathname !== QUERY_PATH) return;
    records.push({
      url: request.url(),
      q: parsed.searchParams.get('q'),
      depth: parsed.searchParams.get('depth'),
      tokenBudget: parsed.searchParams.get('tokenBudget'),
      ifNoneMatch: request.headers()['if-none-match'] ?? null,
    });
  });
  return records;
}

/** 从「工具」下拉打开关键词检索面板。 */
async function openKeywordPanel(page: Page): Promise<void> {
  const trigger = page.locator(SEL.toolsTrigger);
  await expect(trigger).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const item = page.locator(SEL.keywordToolItem);
  await expect(item).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  await item.click({ timeout: TIMEOUTS.ACTION });
  await expect(page.locator(SEL.panel)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
}

test.describe('关键词图检索（J50）', () => {
  test('一次回车恰好发出一个 /query 请求，且参数与输入一致', async ({ page }) => {
    const queries = recordQueryRequests(page);
    await setupPluginPage(page);
    await openKeywordPanel(page);

    // 桩图（`scripts/dev-server.mjs:38-96 MOCK_GRAPH`）里有 `createGraphTools` / `graphData`
    // / `fetchMergedGraph` / `apply` 等 function 节点；用 `graph` 这个词能命中多个。
    // 这个词**必须真实存在于桩图 label 里**，否则下面的 `seeds` 断言会变成"无结果"。
    const keyword = 'graph';
    const input = page.locator(SEL.input);
    await input.fill(keyword);
    await input.press('Enter');

    // 面板进入终态（seed 列表或空态），再断言请求。
    await expect(page.locator(`${SEL.panel} ${SEL.seed}`).first())
      .toBeVisible({ timeout: TIMEOUTS.RESOURCE });

    expect(queries, `对 ${QUERY_PATH} 的请求记录应为 1 条，实际：${JSON.stringify(queries)}`).toHaveLength(1);
    const [record] = queries;
    expect(record!.q).toBe(keyword);
    // 面板显式发送 depth=2 / tokenBudget=800（与宿主缺省一致）。参数**发出去**是契约的一部分：
    // 只在客户端"用缺省值算一遍"而不发送，会让宿主将来的缺省变更静默改变语义。
    expect(record!.depth).toBe('2');
    expect(record!.tokenBudget).toBe('800');
  });

  test('结果渲染出种子与子图概要（不是只有文本）', async ({ page }) => {
    await setupPluginPage(page);
    await openKeywordPanel(page);
    const input = page.locator(SEL.input);
    await input.fill('graph');
    await input.press('Enter');

    const seeds = page.locator(`${SEL.panel} ${SEL.seed}`);
    await expect(seeds.first()).toBeVisible({ timeout: TIMEOUTS.RESOURCE });
    // 至少一个种子，且每个种子带得分。
    expect(await seeds.count()).toBeGreaterThan(0);
    // 子图概要必须显示节点/边计数——这是"画高亮"与"只有文本"的分水岭。
    const summary = page.locator(SEL.summary);
    await expect(summary).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(summary).toContainText('节点');
    await expect(summary).toContainText('边');
  });

  test('点击种子会选中画布上的该节点', async ({ page }) => {
    await setupPluginPage(page);
    await openKeywordPanel(page);
    const input = page.locator(SEL.input);
    await input.fill('graph');
    await input.press('Enter');
    const seed = page.locator(`${SEL.seed}`).first();
    await expect(seed).toBeVisible({ timeout: TIMEOUTS.RESOURCE });
    await seed.click({ timeout: TIMEOUTS.ACTION });

    // 断言 store 的 selectedNodeId 真的变成了某个种子 id（而不是"点了没反应"）。
    const selected = await page.evaluate(() => {
      const store = (window as unknown as { __graphStore?: { getState: () => { selectedNodeId: string | null } } }).__graphStore;
      return store?.getState().selectedNodeId ?? null;
    });
    expect(selected, '点击种子后 store.selectedNodeId 必须变成该节点，否则画布上没有任何反馈').not.toBeNull();
    // 反向：它必须是种子列表里的 id（不能是别的节点）。
    const seedIds = await page.evaluate(() => {
      const store = (window as unknown as { __graphStore?: { getState: () => { keywordQueryResult: { seeds: Array<{ id: string }> } | null } } }).__graphStore;
      return (store?.getState().keywordQueryResult?.seeds ?? []).map((s) => s.id);
    });
    expect(seedIds).toContain(selected);
  });

  test('同一关键词的第二次提交带上 if-none-match（校验值真的在回传）', async ({ page }) => {
    const queries = recordQueryRequests(page);
    await setupPluginPage(page);
    await openKeywordPanel(page);
    const input = page.locator(SEL.input);
    await input.fill('graph');
    await input.press('Enter');
    await expect(page.locator(`${SEL.panel} ${SEL.seed}`).first())
      .toBeVisible({ timeout: TIMEOUTS.RESOURCE });

    // 第一次必须**不带** if-none-match（首次取数），第二次必须带。
    expect(queries).toHaveLength(1);
    expect(queries[0]!.ifNoneMatch, '首次请求不应带校验值').toBeNull();

    await input.press('Enter');
    // 等第二次请求落地（面板会重渲染；用网络条件而不是固定 sleep）。
    await expect.poll(() => queries.length, { timeout: TIMEOUTS.RESOURCE }).toBe(2);
    expect(
      queries[1]!.ifNoneMatch,
      '第二次同键请求必须带 if-none-match：不带就说明 200 从未回写 etag，304 分支是死代码',
    ).not.toBeNull();
  });

  test('空查询不会发出 /query 请求', async ({ page }) => {
    const queries = recordQueryRequests(page);
    await setupPluginPage(page);
    await openKeywordPanel(page);
    const input = page.locator(SEL.input);
    await input.fill('   ');
    await input.press('Enter');
    // 给请求一个可发生的窗口（否则"没发"可能只是因为还没到发的时候）。
    await page.waitForTimeout(500);
    expect(queries, '空查询必须被面板拦住（宿主会回 400，而用户只会看到"点了没反应"）').toHaveLength(0);
    // 并且要回到空态提示，而不是停在 loading。
    await expect(page.locator(`${SEL.panel} ${SEL.idle}`)).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('截断时显示显式提示（graphify 原则）', async ({ page }) => {
    await setupPluginPage(page);
    await openKeywordPanel(page);
    const input = page.locator(SEL.input);
    await input.fill('graph');
    await input.press('Enter');
    await expect(page.locator(`${SEL.panel} ${SEL.seed}`).first())
      .toBeVisible({ timeout: TIMEOUTS.RESOURCE });

    // 面板默认预算 800；桩的截断条件是 `nodes.length * 8 > tokenBudget`。
    // 用面板的**最小**预算（50，宿主下限）触发截断，并把请求走 UI 之外的方式发一遍
    // 不现实——所以这里直接对 store 发一次带小预算的查询（面板的 depth/budget 是缺省，
    // 需要 UI 之外的一个入口来覆盖这条分支）。
    await page.evaluate(async () => {
      const store = (window as unknown as {
        __graphStore?: { getState: () => { runKeywordQuery: (q: string, o?: { depth?: number; tokenBudget?: number }) => Promise<boolean> } };
      }).__graphStore;
      await store?.getState().runKeywordQuery('graph', { depth: 3, tokenBudget: 50 });
    });
    const notice = page.locator(`${SEL.panel} ${SEL.truncated}`);
    await expect(notice).toBeVisible({ timeout: TIMEOUTS.RESOURCE });
    await expect(notice).toContainText('已按 token 预算截断');
  });
});
