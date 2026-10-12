import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { PANEL, TRIGGERS, DROPDOWN_CONTENT, OPTION } from './selectors.ts';

export const TIMEOUTS = {
  ACTION: 10000,
  VISIBLE_SHORT: 5000,
  NAVIGATION: 60000,
  GRAPH_LOAD: 45000,
  RESOURCE: 30000,
  API_SKIP: 15000,
  API_MODAL: 20000,
} as const;

export async function setupPluginPage(page: Page, url = 'http://localhost:3080'): Promise<void> {
  await page.goto(url, { timeout: TIMEOUTS.NAVIGATION, waitUntil: 'domcontentloaded' });
  const skipBtn = page.locator('#api-skip-btn');
  await skipBtn.click({ timeout: TIMEOUTS.API_SKIP }).catch(() => {});
  await page.locator(PANEL.root).waitFor({ state: 'visible', timeout: TIMEOUTS.GRAPH_LOAD });
}

/**
 * 打开页面并直接切到行为层视图（默认 `callgraph`）。
 *
 * 需要它是因为 `getAvailablePanels(getViewLayer(viewMode))`
 * （`src/shared/viewModeUtils.ts:78-88`）按视图层过滤「工具」下拉条目：
 * 默认的 `code` 属于 structural 层，其 `STRUCTURAL_PANELS` 不含
 * 调用链/循环/影响/继承/热点/上帝模块/核心函数，这些开关在默认视图下
 * 根本不会渲染。凡是要操作上述面板的用例都应先用本函数进入行为层。
 */
export async function setupPluginPageInBehavioralLayer(
  page: Page,
  mode: 'callgraph' | 'dependencies' | 'inheritance' | 'package' | 'class' = 'callgraph',
  url = 'http://localhost:3080',
): Promise<void> {
  await setupPluginPage(page, url);
  await selectViewMode(page, mode);
}

/**
 * 打开一个工具栏下拉并等待其内容出现。
 *
 * 下拉内容经 `Portal` 挂到 `document.body`（见 `src/client/components/Dropdown.tsx:151-162`），
 * 因此内容查询**不能**加工具栏父级限定。窄面板（≤320px）时同一个下拉会退化成抽屉，
 * 但 `contentClassName` 不变，所以这里的选择器对两种形态都成立。
 */
export async function openDropdown(
  page: Page,
  triggerSelector: string,
  contentSelector: string = DROPDOWN_CONTENT.generic,
): Promise<Locator> {
  const trigger = page.locator(triggerSelector);
  await expect(trigger).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  const alreadyOpen = (await trigger.getAttribute('aria-expanded')) === 'true';
  if (!alreadyOpen) await trigger.click();
  const content = page.locator(contentSelector);
  await expect(content).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  return content;
}

/** 打开「工具」下拉并点击其中的分析/质量面板开关。 */
export async function clickToolItem(page: Page, itemSelector: string): Promise<void> {
  await openDropdown(page, TRIGGERS.tools);
  await page.locator(itemSelector).click({ timeout: TIMEOUTS.ACTION });
}

/**
 * 收起已展开的下拉——**不要用 Escape**。
 *
 * `useDismissable.ts:40-42` 让每个下拉都监听 Escape 收起自己，但
 * `usePanelKeyboard.ts:77-78` 的全局 Escape 同时会调 `panel.closeAll()`
 * （`GraphPanel.tsx:198-205`），把刚刚打开的分析面板一并关掉。用 Escape
 * "顺手收起下拉"会静默撤销上一步的 toggle，让 `not.toHaveClass(/cg-active/)`
 * 这类断言假失败（cycle-81 smoke 的第三根因）。
 */
export async function closeDropdown(page: Page, triggerSelector: string): Promise<void> {
  const trigger = page.locator(triggerSelector);
  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: TIMEOUTS.VISIBLE_SHORT });
  }
}

/**
 * 切到行为层视图模式后再点击「工具」下拉里的分析面板开关。
 *
 * 关键机制：`getAvailablePanels(getViewLayer(viewMode))`（`src/shared/viewModeUtils.ts:78-88`）
 * 会按当前视图层过滤「工具」下拉的条目——默认的 `code` 视图属于 structural 层，
 * 其 `STRUCTURAL_PANELS` **不含** showCallChain/showCycles/showImpact/showInheritance/
 * showHotspot/showGodModule/showCoreFunction。因此这些开关在默认视图下根本不会渲染，
 * 必须先切到任一 behavioral 视图（callgraph / dependencies / inheritance / package / class）。
 */
export async function clickToolItemInBehavioralLayer(
  page: Page,
  itemSelector: string,
  mode: 'callgraph' | 'dependencies' | 'inheritance' | 'package' | 'class' = 'callgraph',
): Promise<void> {
  await selectViewMode(page, mode);
  await clickToolItem(page, itemSelector);
}

/** 打开「数据」下拉并点击其中条目。 */
export async function clickDataItem(page: Page, itemSelector: string): Promise<void> {
  await openDropdown(page, TRIGGERS.data);
  await page.locator(itemSelector).click({ timeout: TIMEOUTS.ACTION });
}

/** 打开「历史」下拉并点击撤销/重做。 */
export async function clickHistoryItem(page: Page, itemSelector: string): Promise<void> {
  await openDropdown(page, TRIGGERS.history);
  await page.locator(itemSelector).click({ timeout: TIMEOUTS.ACTION });
}

/** 打开「更多」下拉并点击其中条目（主题/语言/缩略图/图例/导览）。 */
export async function clickMoreItem(page: Page, key: string): Promise<void> {
  await openDropdown(page, TRIGGERS.more);
  await page.locator(OPTION.more(key)).click({ timeout: TIMEOUTS.ACTION });
}

/** 通过「布局」下拉切换布局。 */
export async function selectLayout(page: Page, layout: string): Promise<void> {
  await openDropdown(page, TRIGGERS.layout, DROPDOWN_CONTENT.layout);
  await page.locator(OPTION.layout(layout)).click({ timeout: TIMEOUTS.ACTION });
}

/** 通过「视图模式」下拉切换视图模式（code/dependencies/inheritance/callgraph/package/class/cfg/flowchart/sequence）。 */
export async function selectViewMode(page: Page, mode: string): Promise<void> {
  await openDropdown(page, TRIGGERS.view, DROPDOWN_CONTENT.view);
  await page.locator(OPTION.viewMode(mode)).click({ timeout: TIMEOUTS.ACTION });
}

/** 通过「层级」下拉切换层级。 */
export async function selectHierarchyLevel(page: Page, level: number): Promise<void> {
  await openDropdown(page, TRIGGERS.level, DROPDOWN_CONTENT.level);
  await page.locator(OPTION.level(level)).click({ timeout: TIMEOUTS.ACTION });
}

/** 点击工具栏搜索按钮（窄面板时它会被移入「更多」下拉）。 */
export async function clickSearchButton(page: Page): Promise<void> {
  const standalone = page.locator(TRIGGERS.search);
  if (await standalone.count() > 0 && await standalone.first().isVisible()) {
    await standalone.first().click({ timeout: TIMEOUTS.ACTION });
    return;
  }
  await clickMoreItem(page, 'search');
}

export async function waitForGraphReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(() => {
    const cy = (window as any).__cytoscape;
    return cy && cy.nodes().length > 0;
  }, { timeout });
}

export async function getCyNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    return cy ? cy.nodes().length : 0;
  });
}

/**
 * 取当前图中所有聚类节点 id。
 *
 * cycle-89 修复：旧实现用 cytoscape 选择器 `[isCluster = "true"]`，但
 * `isCluster` 是**布尔**数据属性（`DataController.ts:260-265` 写入 `true`，
 * `:397` 读回时用 `=== true`），cytoscape 的选择器比较把 `"true"` 当字符串，
 * 布尔 `true` 永不匹配 ⇒ 该 helper 一直返回 `[]`。
 * 实测（`tmp-cy-selector-probe.mjs`，cytoscape 3.34.2 headless）：
 *   `[isCluster = "true"]` → `["strTrue"]`（只命中字符串 true）
 *   `[?isCluster]`         → `["boolTrue","strTrue"]`（真值判定）
 * 与源码 `data('isCluster') === true` 语义一致的只有显式布尔过滤。
 *
 * 下游 `view-modes.spec.ts:66/84/103` 用 `if (clusterIds.length === 0) return;`
 * 静默跳过，所以缺陷长期不可见（假绿）；而 `v020-features.spec.ts:227` 的
 * `expect(clusterNodeIds.length).toBeGreaterThan(0)` 是本 helper 唯一的强断言，
 * 它在 clean HEAD 上失败、在本次修复后通过（cycle-89 的回归证据）。
 *
 * 不要改回选择器写法；用 `node.data('isCluster') === true` 与源码语义一致。
 * 如需选择器写法，布尔属性必须写 `[?isCluster]`。
 */
export async function getClusterNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy
      .nodes()
      .filter((n: any) => n.data('isCluster') === true)
      .map((n: any) => n.id());
  });
}

/** 取全部节点 id（用于不依赖聚类的并发/健壮性用例）。 */
export async function getAllCyNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy.nodes().map((n: any) => n.id());
  });
}

/**
 * 向 cytoscape 节点派发事件。
 *
 * 返回**是否真的派发成功**。旧实现是 `void`，节点不存在时静默 no-op，
 * 调用方拿到「什么都没发生」却以为选中成功——cycle-81 的 J31 就是这样失败的：
 * 它选了调用视图里已被装配器过滤掉的 class 节点，`selectedNodeId` 始终为 null，
 * 报错却出现在 5 秒后的面板可见性断言上，根因被隐藏。
 * 需要严格语义时用 `selectNodeStrict`。
 */
export async function emitNodeEvent(page: Page, nodeId: string, event: string): Promise<boolean> {
  return page.evaluate(([id, ev]) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return false;
    const node = cy.getElementById(id);
    if (!node || node.length === 0) return false;
    node.emit(ev);
    return true;
  }, [nodeId, event] as const);
}

export async function selectNode(page: Page, nodeId: string): Promise<void> {
  await emitNodeEvent(page, nodeId, 'tap');
}

/**
 * 严格选中节点：节点不在**当前渲染图**里就立刻抛错并列出可用 id。
 *
 * 调用视图只保留 function 节点（`CallGraphAssembler.ts:5`），选中 class 节点
 * 不会报错也不会生效。E2E 里凡是「先选中再断言面板」的用例都应该用这个，
 * 让失败点落在选中这一步，而不是几秒后的可见性断言上。
 */
export async function selectNodeStrict(page: Page, nodeId: string): Promise<void> {
  const ok = await emitNodeEvent(page, nodeId, 'tap');
  if (!ok) {
    const available = await getAllCyNodeIds(page);
    throw new Error(
      `selectNodeStrict: node "${nodeId}" is not in the current rendered graph. ` +
        `Available ids: ${available.join(', ') || '(none)'}. ` +
        `Note: the callgraph view keeps only "function" nodes (CallGraphAssembler.ts:5).`,
    );
  }
}

export async function doubleTapNode(page: Page, nodeId: string): Promise<void> {
  await emitNodeEvent(page, nodeId, 'dbltap');
}

export async function getCyNodeIdsByClass(page: Page, cls: string): Promise<string[]> {
  return page.evaluate((className) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy.nodes(`.${className}`).map((n: any) => n.id());
  }, cls);
}

/**
 * 按节点类型取 id。
 *
 * 节点类型是 cytoscape **数据属性**而非类名（`DataController.ts:262` 把 `type` 写进 `data`，
 * `ThemeStylesheet.ts:163` 用 `node[type="function"]` 选择），所以
 * `getCyNodeIdsByClass(page, 'function')` 永远返回空数组——这是 cycle-81 发现的第三处
 * "选择器与实现脱节"。
 */
export async function getCyNodeIdsByType(page: Page, type: string): Promise<string[]> {
  return page.evaluate((t) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy.nodes(`[type="${t}"]`).map((n: any) => n.id());
  }, type);
}

export async function getCyEdgeIdsByClass(page: Page, cls: string): Promise<string[]> {
  return page.evaluate((className) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy.edges(`.${className}`).map((e: any) => e.id());
  }, cls);
}

export async function waitForCyClass(page: Page, cls: string, timeout = 5000): Promise<void> {
  await page.waitForFunction((className) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return false;
    return cy.nodes(`.${className}`).length > 0 || cy.edges(`.${className}`).length > 0;
  }, cls, { timeout });
}

export async function getVisibleNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    if (!cy) return 0;
    return cy.nodes().filter((n: any) => n.style('display') !== 'none').length;
  });
}

export async function panGraph(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(([x, y]) => {
    const cy = (window as any).__cytoscape;
    if (cy) cy.panBy({ x, y });
  }, [dx, dy] as const);
}

/** 读取当前画布缩放级别。工具栏没有缩放按钮，只能问渲染器。 */
export async function getZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    return cy ? cy.zoom() : 0;
  });
}

/** 程序化缩放（替代已不存在的工具栏缩放按钮）。 */
export async function zoomGraph(page: Page, factor: number): Promise<number> {
  return page.evaluate((f) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return 0;
    cy.zoom(cy.zoom() * f);
    return cy.zoom();
  }, factor);
}

/** 程序化适配视口（替代已不存在的工具栏 fit 按钮）。 */
export async function fitGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    if (cy) cy.fit(undefined, 20);
  });
}

export async function assertToggleBehavior(
  page: Page,
  btnSelector: string,
  opts?: { activeClass?: string; timeout?: number },
): Promise<void> {
  const activeClass = opts?.activeClass ?? 'cg-active';
  const timeout = opts?.timeout ?? 5000;
  const btn = page.locator(btnSelector);
  await btn.click();
  await expect(btn).toHaveClass(new RegExp(activeClass), { timeout });
  await btn.click();
  await expect(btn).not.toHaveClass(new RegExp(activeClass), { timeout });
}

/**
 * 调用插件 HTTP API。
 *
 * 旧实现在 `res.json()` 前不检查 `res.ok`，于是 dev-server 的 404 文本
 * （`Not found`）被当成 JSON 解析，抛出 `SyntaxError: Unexpected token 'N'`，
 * 把"接口不存在"伪装成"解析失败"——cycle-81 的第二根因。这里显式检查，
 * 并把状态码与响应体前 200 字符带进错误信息。
 */
export async function fetchGraphApi<T = unknown>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p, i);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`fetchGraphApi ${p} failed: ${res.status} ${text.slice(0, 200)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`fetchGraphApi ${p} returned non-JSON body: ${text.slice(0, 200)}`);
      }
    },
    [path, init] as const,
  ) as Promise<T>;
}

export async function getSseEvents(
  page: Page,
  url: string,
  durationMs: number,
): Promise<string[]> {
  return page.evaluate(
    async ([u, dur]) => {
      return new Promise<string[]>((resolve) => {
        const events: string[] = [];
        const es = new EventSource(u);
        es.onmessage = (e) => events.push(e.data);
        setTimeout(() => { es.close(); resolve(events); }, dur);
      });
    },
    [url, durationMs] as const,
  );
}

export async function triggerFileChange(page: Page, filePath: string): Promise<void> {
  await fetchGraphApi(page, '/api/v1/codegraph/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

export async function waitForGraphUpdate(page: Page, timeout = 10000): Promise<void> {
  const initialCount = await getCyNodeCount(page);
  await page.waitForFunction(
    (initial) => {
      const cy = (window as any).__cytoscape;
      if (!cy) return false;
      return cy.nodes().length !== initial;
    },
    initialCount,
    { timeout },
  );
}

/**
 * 进入微观视图。
 *
 * 旧实现直接点 `.cg-view-mode-btn--micro[data-mode="..."]`——那个类名从未存在。
 * 微观视图项现在位于「视图模式」下拉内，且**未选中函数时是 disabled 的**
 * （`ToolbarViewMode.tsx:125`），所以调用方必须先选函数。
 */
export async function enterMicroView(page: Page, mode: 'cfg' | 'flowchart' | 'sequence'): Promise<void> {
  await selectViewMode(page, mode);
}

export async function selectFunctionNode(page: Page, nodeId: string): Promise<void> {
  await selectNode(page, nodeId);
  await page.waitForFunction(() => {
    const store = (window as any).__graphStore;
    if (!store) return false;
    return store.getState().selectedFunction !== null;
  }, { timeout: 5000 });
}

export async function getAnalysisState<T = unknown>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const store = (window as any).__graphStore;
    if (!store) return null;
    return store.getState()[k] ?? null;
  }, key);
}

/**
 * 读取当前集成模式（`GraphPanel.tsx:341` 写在 `data-cg-integration` 上）。
 *
 * 用于判断 `.cg-resize-handle` 是否真的可拖拽：宿主自适应的集成模式
 * （conversation-view / sidebar-right / better-sidebar）
 * 下，面板不持有自己的几何尺寸，`useGraphDerivedValues.ts:68-73` 不会加
 * `cg-resizable`，`layout.css:1078-1080` 于是把 handle 设为 `display:none`。
 */
export async function getIntegrationMode(page: Page): Promise<string | null> {
  return page.locator(PANEL.root).getAttribute('data-cg-integration');
}

/** 面板是否处于「可自行调整尺寸」模式（即带 `cg-resizable`）。 */
export async function isPanelResizable(page: Page): Promise<boolean> {
  const cls = await page.locator(PANEL.root).getAttribute('class');
  return (cls ?? '').split(/\s+/).includes('cg-resizable');
}

// ---------------------------------------------------------------------------
// 网络层原语：按需加载的定量契约只能靠「请求了哪个 URL、几次」来断言
// ---------------------------------------------------------------------------

/** 一条被记录下来的插件 API 请求。 */
export interface ApiRequestRecord {
  url: string;
  /** 去掉 query 的 pathname，例如 `/api/v1/codegraph/files/m2/outline`。 */
  path: string;
  method: string;
  /** query 键值对；重复键只保留最后一个（本插件的参数名都是单值）。 */
  query: Record<string, string>;
}

/**
 * 插件 API 请求记录器。
 *
 * 为什么需要它：`docs/图谱按需加载.md:248-285` 的验收指标里有 5 条是**计数**契约
 * （首屏 1 个 bootstrap；展开某目录后同级其他目录 = 0；展开某文件后其他文件 = 0；
 * 展开某符号后同文件其他函数体 = 0；URL 恢复兄弟节点 = 0）。这些契约无法用
 * DOM 断言表达——「节点没出现」和「压根没请求」在画面上完全一样，
 * 只有请求记录能把两者区分开。
 *
 * 记录发生在 Playwright 进程侧（`page.on('request')`），不注入页面脚本，
 * 因此不会与被测代码争抢 `window.fetch`。
 */
export interface ApiRecorder {
  readonly requests: ApiRequestRecord[];
  /** 停止记录并摘掉监听器。 */
  stop(): void;
  /** 清空已记录条目（用于「某一步之后」的计数）。 */
  reset(): void;
  /** path 完全相等的请求。 */
  byPath(path: string): ApiRequestRecord[];
  /** 满足谓词的请求数。 */
  count(predicate: (record: ApiRequestRecord) => boolean): number;
}

/** 开始记录插件 API 请求（`/api/v1/codegraph/**`）。 */
export function startApiRecording(page: Page): ApiRecorder {
  const requests: ApiRequestRecord[] = [];
  const onRequest = (request: Request): void => {
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      return;
    }
    if (!parsed.pathname.startsWith('/api/v1/codegraph/')) return;
    requests.push({
      url: request.url(),
      path: parsed.pathname,
      method: request.method(),
      query: Object.fromEntries(parsed.searchParams.entries()),
    });
  };
  page.on('request', onRequest);
  return {
    requests,
    stop: () => { page.off('request', onRequest); },
    reset: () => { requests.length = 0; },
    byPath: (path) => requests.filter((r) => r.path === path),
    count: (predicate) => requests.filter(predicate).length,
  };
}

/** 从 store 的 `rawNodes` 里解析一个指定类型的节点 id（不依赖聚类后是否可见）。 */
export async function resolveRawNodeId(page: Page, type: string): Promise<string | null> {
  return page.evaluate((nodeType) => {
    const store = (window as any).__graphStore;
    if (!store) throw new Error('__graphStore missing — dev-server must set localStorage.__cg_debug=1');
    const raw: Array<{ id: string; type: string }> = store.getState().rawNodes ?? [];
    return raw.find((n) => n.type === nodeType)?.id ?? null;
  }, type);
}

/**
 * 通过 store 直接展开一个节点。
 *
 * 不能改用双击：`useNodeInteraction.ts:122-148` 的双击只对**聚类节点**展开，
 * 对 `function` 节点是「选中」、对其它类型是「聚焦」，因此双击永远触发不了
 * 文件大纲 / 单符号 AST 这两条按需链路。
 */
export async function expandNodeViaStore(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const store = (window as any).__graphStore;
    if (!store) throw new Error('__graphStore missing — dev-server must set localStorage.__cg_debug=1');
    await store.getState().expandNode(id);
  }, nodeId);
}

/** 等待所有在飞的按需请求结束（`pendingRequests` 是展开链路的统一账本）。 */
export async function waitForNoPendingRequests(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(() => {
    const store = (window as any).__graphStore;
    if (!store) return false;
    const pending = store.getState().pendingRequests;
    return !pending || pending.size === 0;
  }, { timeout });
}

export { PANEL, TRIGGERS, DROPDOWN_CONTENT, OPTION };
