/**
 * 条件请求（ETag / 304）端到端契约 —— cycle-91 / P3-R18-02。
 *
 * ## 这个 spec 守的是什么
 *
 * 原缺陷的形状是「校验器可达但校验值不可达」：四条按需路由能回 304，但 200 从不带
 * `etag`，客户端手里永远没有可回传的值。服务端补上之后，**真正会悄悄坏掉的是客户端
 * 那一半**，而它有三种失败方式在画面上完全一样：
 *
 *   1. 304 被当成失败（`res.ok` 对 304 是 `false`）⇒ 面板被 `null` 清空；
 *   2. 载荷因代际过期被丢弃却仍登记了校验值 ⇒ 下次请求命中 304，而客户端从未拥有
 *      那份数据 ⇒ 节点永久空白，且没有任何错误可见；
 *   3. 请求键少一个维度（节点 id / cursor / detail）⇒ 拿 A 的校验值问 B，B 也收到 304。
 *
 * 三种都无法用 DOM 断言区分（「节点没出现」与「压根没请求」在画面上完全一样），
 * 因此这里同时用**进程侧请求录制**（`if-none-match` 头）与**响应录制**（状态码）。
 *
 * ## 为什么必须落到 E2E
 *
 * 单测分别覆盖了 host 侧（`tests/unit/routes.test.ts` 的 200 带 etag / 304 / 跨资源
 * 不误命中）与 API 层（`tests/unit/api.test.ts` 的三分支）。但「A 写状态 / B 守状态」
 * 的接缝只有让**真实 store + 真实 fetch + 真实 dev-server 桩**一起跑才会暴露 ——
 * 两侧各自全绿而组合失效正是 cycle-84 两次缺陷的形状（`docs/测试体系.md` §2.aa）。
 *
 * ## 固定夹具
 *
 * dev-server 的 `MOCK_GRAPH`（`scripts/dev-server.mjs:38-96`）：
 *   - `m2` = `src/tools.ts`（module），含 4 个符号 `n2`/`n9`/`n10`/`n11`；
 *   - `m1` = `src/index.ts`（module），含 `n1`；
 *   - `m3` = `src/adapters/CodeGraphAdapter.ts`（module），含 `n3`。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  setupPluginPage,
  startApiRecording,
  expandNodeViaStore,
  waitForGraphReady,
  TIMEOUTS,
} from './helpers.ts';

const OUTLINE_M1 = '/api/v1/codegraph/files/m1/outline';
const OUTLINE_M2 = '/api/v1/codegraph/files/m2/outline';
const OUTLINE_M3 = '/api/v1/codegraph/files/m3/outline';

/** IndexedDB 库名 = `codegraph-cache-<repoId>`，dev-server 的 repoId 是 `dev-workspace`。 */
const DEV_CACHE_DB = 'codegraph-cache-dev-workspace';
const OUTLINE_STORE = 'outline-cache';

/**
 * 把某个缓存条目的时间戳压到 0，等价于「TTL 已过期」。
 *
 * 为什么需要这一步：`expandNode` 对 module 节点是**缓存优先**的
 * （`src/client/store/slices/expandSlice.ts:178-187` 读 `getOutline`），
 * 缓存命中就直接返回、根本不发请求，于是永远走不到 304 分支。
 * 而生产环境里「载荷缓存过期、但本次页面会话内的校验值缓存仍在」正是 304 的
 * 唯一真实触发场景（校验值住在模块内存里，IndexedDB 载荷按 TTL 过期）。
 * 这里精确复刻该场景，而不是删库（`deleteDatabase` 会被插件的常驻连接 block 住）。
 */
async function expireOutlineCache(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, storeName, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            const raw = getReq.result as { value?: unknown; timestamp?: number; ttlMs?: number } | undefined;
            if (raw && typeof raw === 'object' && 'value' in raw) {
              store.put({ ...raw, timestamp: 0 }, key);
            }
          };
          getReq.onerror = () => reject(getReq.error);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: DEV_CACHE_DB, storeName: OUTLINE_STORE, key: nodeId },
  );
}

test.describe('条件请求链路（ETag / 304 端到端）', () => {
  test('载荷缓存过期后重新展开：第二次请求回传校验值并收到 304，且面板不被清空', async ({ page }) => {
    const recorder = startApiRecording(page);
    await setupPluginPage(page);
    await waitForGraphReady(page);

    // --- 第一次展开：没有校验值可回传，服务端必须在 200 里给出 etag ---
    await expandNodeViaStore(page, 'm2');
    await expect.poll(() => recorder.byPath(OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION }).toBe(1);
    const first = recorder.byPath(OUTLINE_M2)[0]!;
    expect(first.ifNoneMatch, '首次请求不得携带校验值（客户端还没有）').toBeNull();
    await expect
      .poll(() => recorder.responses.filter((r) => r.path === OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION })
      .toBe(1);
    expect(recorder.responses.find((r) => r.path === OUTLINE_M2)!.status).toBe(200);

    // 等 `setOutline` 真正落库：没落库就没法过期，第二步会变成假绿。
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ dbName, storeName, key }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              try {
                return await new Promise<boolean>((resolve, reject) => {
                  const tx = db.transaction(storeName, 'readonly');
                  const getReq = tx.objectStore(storeName).get(key);
                  getReq.onsuccess = () => resolve(getReq.result !== undefined);
                  getReq.onerror = () => reject(getReq.error);
                });
              } finally {
                db.close();
              }
            },
            { dbName: DEV_CACHE_DB, storeName: OUTLINE_STORE, key: 'm2' },
          ),
        { timeout: TIMEOUTS.ACTION },
      )
      .toBe(true);

    await expireOutlineCache(page, 'm2');

    // --- 第二次展开：缓存已过期 ⇒ 必须发请求，且必须带上第一次拿到的校验值 ---
    await expandNodeViaStore(page, 'm2');
    await expect.poll(() => recorder.byPath(OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION }).toBe(2);
    const second = recorder.byPath(OUTLINE_M2)[1]!;
    expect(second.ifNoneMatch, '第二次请求必须原样回传服务端给出的校验值').not.toBeNull();

    // dev-server 只在 `if-none-match` **逐字节相等**时才回 304
    // （`scripts/dev-server.mjs:807-815` 的 `conditionalJson`），因此「收到 304」
    // 本身就是「客户端回传的值与 200 里给出的完全一致」的证明。
    await expect
      .poll(() => recorder.responses.filter((r) => r.path === OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION })
      .toBe(2);
    expect(
      recorder.responses.filter((r) => r.path === OUTLINE_M2)[1]!.status,
      '校验值匹配 ⇒ 服务端必须回 304',
    ).toBe(304);

    // 304 必须被当作「保留现状」，绝不能走 `if (!data) return` 把面板清空。
    const ids: string[] = await page.evaluate(() =>
      ((window as any).__graphStore.getState().rawNodes as Array<{ id: string }>).map((n) => n.id),
    );
    expect(ids, '304 之后第一次加载的符号必须仍在图里').toEqual(
      expect.arrayContaining(['n2', 'n9', 'n10', 'n11']),
    );

    recorder.stop();
  });

  test('不同文件的校验值互不通用：展开第二个文件不得带第一个文件的校验值', async ({ page }) => {
    const recorder = startApiRecording(page);
    await setupPluginPage(page);
    await waitForGraphReady(page);

    await expandNodeViaStore(page, 'm2');
    await expect.poll(() => recorder.byPath(OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION }).toBe(1);

    await expandNodeViaStore(page, 'm3');
    await expect.poll(() => recorder.byPath(OUTLINE_M3).length, { timeout: TIMEOUTS.ACTION }).toBe(1);

    // 请求键是 `outline:<nodeId>`（`etagKeyForOutline`）：m2 的校验值落在另一个键下，
    // m3 必须查不到值 ⇒ 不带 `if-none-match`，且服务端回 200 而不是 304。
    // 若请求键少了节点维度，这里会收到 304，而客户端手上没有 m3 的大纲。
    expect(recorder.byPath(OUTLINE_M3)[0]!.ifNoneMatch, 'm3 不得复用 m2 的校验值').toBeNull();
    await expect
      .poll(() => recorder.responses.filter((r) => r.path === OUTLINE_M3).length, { timeout: TIMEOUTS.ACTION })
      .toBe(1);
    expect(recorder.responses.find((r) => r.path === OUTLINE_M3)!.status).toBe(200);

    recorder.stop();
  });

  test('载荷被代际丢弃时不登记校验值：下次请求仍不带 if-none-match', async ({ page }) => {
    const recorder = startApiRecording(page);
    await setupPluginPage(page);
    await waitForGraphReady(page);

    // 背靠背两次展开：第二次 `expandNode` 会把 `expandGeneration` 推进，
    // 于是 m2 的大纲响应回来时代际已过期 ⇒ 载荷被丢弃、且**不得**登记校验值。
    // 两次调用必须在同一个 evaluate 内同步发出，中间不能有 await（否则响应可能先到）。
    await page.evaluate(() => {
      const store = (window as any).__graphStore;
      store.getState().expandNode('m2');
      store.getState().expandNode('m1');
    });

    await expect.poll(() => recorder.byPath(OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION }).toBe(1);
    await expect.poll(() => recorder.byPath(OUTLINE_M1).length, { timeout: TIMEOUTS.ACTION }).toBe(1);
    // 让两个响应都落地（m2 的会被丢弃，m1 的会被应用）。
    await expect
      .poll(
        () =>
          recorder.responses.filter((r) => r.path === OUTLINE_M2 || r.path === OUTLINE_M1).length,
        { timeout: TIMEOUTS.ACTION },
      )
      .toBe(2);

    // 再展开一次 m2：若代际丢弃的载荷也登记了校验值，这里就会带 if-none-match 并收到 304，
    // 而 store 里从未有过那份大纲 ⇒ 文件永远展开不出符号，且无错误可见。
    await expandNodeViaStore(page, 'm2');
    await expect.poll(() => recorder.byPath(OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION }).toBe(2);
    expect(
      recorder.byPath(OUTLINE_M2)[1]!.ifNoneMatch,
      '载荷被丢弃时不得登记校验值，否则会产生「客户端没有数据却收到 304」的永久空白',
    ).toBeNull();

    await expect
      .poll(() => recorder.responses.filter((r) => r.path === OUTLINE_M2).length, { timeout: TIMEOUTS.ACTION })
      .toBe(2);
    expect(recorder.responses.filter((r) => r.path === OUTLINE_M2)[1]!.status).toBe(200);

    recorder.stop();
  });
});
