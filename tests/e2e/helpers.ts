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
  const activeClass = opts?.activeClass ?? PANEL.activeClass;
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
  return (cls ?? '').split(/\s+/).includes(PANEL.resizableClass);
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
  /**
   * 本次请求带上的 `if-none-match`（没带则为 `null`）。
   *
   * 条件请求契约**只能**靠它断言：「服务端回了 304」与「服务端回 200 但客户端丢弃了载荷」
   * 在画面上完全一样；而「客户端是否真的回传了校验值」更是只有请求头能看见。
   */
  ifNoneMatch: string | null;
}

/** 一条被记录下来的插件 API 响应（只记状态码与 path，够断言 304 了）。 */
export interface ApiResponseRecord {
  path: string;
  status: number;
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
  /** 响应记录（只含 path 与状态码）。条件请求契约需要它来确认服务端真的回了 304。 */
  readonly responses: ApiResponseRecord[];
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
  const responses: ApiResponseRecord[] = [];
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
      ifNoneMatch: request.headers()['if-none-match'] ?? null,
    });
  };
  // 响应侧只需要 path + status：304 是「服务端确认未变化」的唯一外部证据。
  const onResponse = (response: Response): void => {
    let parsed: URL;
    try {
      parsed = new URL(response.url());
    } catch {
      return;
    }
    if (!parsed.pathname.startsWith('/api/v1/codegraph/')) return;
    responses.push({ path: parsed.pathname, status: response.status() });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    requests,
    responses,
    stop: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
    reset: () => {
      requests.length = 0;
      responses.length = 0;
    },
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

// ---------------------------------------------------------------------------
// 确定性初始化：像素基线的前提（cycle-90）
// ---------------------------------------------------------------------------

/**
 * 页面初始化脚本：把「随机布局」与「实时时钟」这两个不确定性来源钉死。
 *
 * ## 为什么必须是这两件事（cycle-90 实测）
 *
 * 视觉基线落地前先做了两跑对照：`visual-screenshots.spec.ts` 的 13 张截图里
 * **12 张像素不同**（平均 19.38%、最高 35.75%，最大通道差 217-241 ⇒ 是结构性位移
 * 而不是抗锯齿噪声）。逐一定位后只剩两个来源：
 *
 *   1. **随机初始位置**：`src/client/renderer/LayoutController.ts:389`（cose）与 `:397`（fcose）
 *      都传 `randomize: true, tile: true`，随机数来自 `node_modules/cose-base@2.2.0`
 *      的 `CoSELayout.js:135 this.positionNodesRandomly()`。`grep Math.random src/` 是 0 命中
 *      ⇒ 页面内覆盖 `Math.random` 即可完全接管；cytoscape/cose 本身**不提供 randomSeed 选项**
 *      （`grep randomSeed node_modules/cytoscape/dist/cytoscape.cjs.js` 0 命中），所以只能从这里下手。
 *   2. **状态栏实时时钟**：`src/client/components/StatusBar.tsx:22-25 formatTime()` 把
 *      `lastUpdated` 渲染成 `HH:MM:SS`（`:85`），全页截图必然带上一秒一跳的文本。
 *
 * 实测：只钉 `Math.random` 时两次加载的 6 个节点坐标已逐位相同，但 sha 仍不同；
 * 再冻结 `Date` 后 dagre 与 circle 两跑 **sha 完全相同**（`6d0a7fe880728bdb` / `c90f546dc2ae9ad5`）。
 *
 * ## 用法
 *
 * `page.addInitScript` 必须在 `page.goto` **之前**生效，所以本函数要排在
 * `setupPluginPage()` / `setupPluginPageInBehavioralLayer()` 之前调用：
 *
 * ```ts
 * await installDeterminism(page);
 * await setupPluginPage(page);
 * ```
 */
const DETERMINISM_SCRIPT = `
(() => {
  // 1) 固定 Math.random：mulberry32，种子 0x9e3779b9
  let s = 0x9e3779b9 >>> 0;
  Math.random = function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // 2) 冻结无参 Date（状态栏「更新于 HH:MM:SS」）；带参构造保持原样，
  //    否则会把数据里真实的时间戳（lastUpdated / SSE 事件）一起改掉。
  const FROZEN = Date.parse('2026-01-01T00:00:00Z');
  const RealDate = Date;
  window.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) return new target(FROZEN);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      if (args.length === 0) return new RealDate(FROZEN).toString();
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => FROZEN;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
})();
`;

/** 安装确定性初始化脚本。**必须在首次 `page.goto` 之前调用**。 */
export async function installDeterminism(page: Page): Promise<void> {
  await page.addInitScript(DETERMINISM_SCRIPT);
}

/**
 * 面板几何（高度 + 文档高度 + 滚动位置）必须连续稳定这么久才算「可以截图」。
 *
 * 100 ms 不够：首屏会跑两次 cose 布局（实测 2594 ms 与 3017 ms），两次之间几何
 * 可能恰好一样。300 ms 足以跨过两次采样的间隔而不会让每个用例多等太久。
 */
const SETTLE_MS = 300;

/**
 * 等待画面「可以截图」：面板几何稳定 + 取景固定 + 布局坐标稳定 + 字体就绪。
 *
 * `waitForGraphReady()`（`:148-153`）只等 `cy.nodes().length > 0`，那是**节点存在**，
 * 不是**布局结束**，更不是**面板展开完成**。cycle-90 实测：
 *
 *   - 面板高度在 ~2714 ms 才从 240px 变成 720px（`layout.css:3-8` 的
 *     `min-height: var(--cg-panel-min-h, 240px)` 先撑住，随后 `height: 100%` 生效）；
 *     早于此刻截图拍到的就是 `e2e-01-default.png` 那张「只有 dev-server 外壳」的图。
 *   - 首屏会**跑两次 cose 布局**（实测 2594 ms 与 3017 ms），所以「等一次 layoutstop」不够。
 *   - `#plugin-root` 位于文档第二屏（`offsetTop = 720`，`documentHeight = 1440`），
 *     而 Playwright 点击工具栏按钮时**会自动滚动**；不显式固定取景，
 *     同一张截图在不同用例里落在不同的滚动位置上。
 */
export async function waitForVisualStable(page: Page, timeout = 15000): Promise<void> {
  // 1) 等取景固定 + 面板几何 + 图容器几何 + cytoscape 坐标**全部**持续稳定 SETTLE_MS。
  //
  // 判据分两类，缺一不可：
  //
  //   (a) 取景是**语义判据**而非计时：
  //       - 只要求「高度连续两次采样相同」是不够的（cycle-90 实测翻车）：首屏有一个
  //         240px 平台期（`layout.css:3-8` 的 `min-height` 先撑住），此时
  //         `documentHeight = 960`、`maxScroll = 240`，而面板的绝对 top 是 720，
  //         于是 `scrollTo(0, 720)` **被 clamp 到 240**，面板停在视口 y=480。
  //         实测三跑里两跑停在这个错误位置、一跑（面板已展开）停在 y=0 ⇒ 同一用例的
  //         截图在不同滚动位置上，J39 因此单条失败（218 万像素差异，bbox 覆盖全图）。
  //       - 所以这里显式要求 `scrollHeight - innerHeight >= panelTop`（文档够高）并且
  //         `scrollTo` 之后 `getBoundingClientRect().top` 真的接近 0（没被 clamp）。
  //         这个条件只有在面板完成 240px → 720px 展开之后才可能满足。
  //
  //   (b) 稳定性必须是**持续**的，不能是「采样到两次相同就放行」：
  //       cycle-90 第二处翻车正是这个——早先版本第 1 步只等面板几何、第 2 步只要
  //       「zoom/pan/节点坐标连续两次采样一致」就 return true（≈100ms），于是**一次
  //       短暂平台期就能骗过它**；而打开筛选面板/分析面板之后图容器还会再 resize 一次
  //       并触发 cytoscape 重新 fit，落在这个窗口之后 ⇒ 截图拍到的是重新 fit 后的画面。
  //       实测 J7/J39/J5/J23 轮流出错、差异 655-701 px 且集中在图区域（工具栏逐像素
  //       相同），量化后是整幅图约 10-15px 的平移，而不是子像素噪声。
  //       因此把「面板几何 + 图容器矩形 + zoom/pan/全部节点坐标」合成**一个签名**，
  //       要求它连续 SETTLE_MS 不变才放行；任何一次 resize/fit 都会重置计时。
  await page.waitForFunction(
    (settle, panelSel, containerSel) => {
      const panel = document.querySelector(panelSel);
      if (!panel) return false;

      const panelTop = panel.getBoundingClientRect().top + window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll < panelTop - 1) return false;

      window.scrollTo(0, panelTop);
      if (Math.abs(panel.getBoundingClientRect().top) > 1) return false;

      const cy = (window as any).__cytoscape;
      if (!cy || cy.nodes().length === 0) return false;

      const container = document.querySelector(containerSel);
      const cr = container ? container.getBoundingClientRect() : null;
      const pr = panel.getBoundingClientRect();
      const sig =
        `p${Math.round(pr.height)}#d${document.documentElement.scrollHeight}#s${Math.round(window.scrollY)}` +
        `#c${cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : 'none'}` +
        `#z${cy.zoom().toFixed(6)}#n${cy
          .nodes()
          .map((n: any) => `${n.id()}@${n.position('x').toFixed(2)},${n.position('y').toFixed(2)}`)
          .join('|')}`;

      const w = window as any;
      if (w.__cgVisSig !== sig) {
        w.__cgVisSig = sig;
        w.__cgVisSigSin = performance.now();
        return false;
      }
      return performance.now() - (w.__cgVisSigSin ?? 0) >= settle;
    },
    SETTLE_MS,
    { timeout, polling: 100 },
    PANEL.root,
    PANEL.graphContainer
  );

  // 2) 字体就绪：文字未落定时截图会拍到 fallback 字形。
  //    放在稳定性判据之后——字体加载本身可能触发一次重排。
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });

  // 3) 字体就绪后再确认一次签名未变（字体若触发了 resize/fit，上面那轮就白等了）
  await page.waitForFunction(
    (settle, containerSel) => {
      const cy = (window as any).__cytoscape;
      if (!cy) return false;
      const container = document.querySelector(containerSel);
      const cr = container ? container.getBoundingClientRect() : null;
      const sig =
        `c${cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : 'none'}` +
        `#z${cy.zoom().toFixed(6)}#n${cy
          .nodes()
          .map((n: any) => `${n.id()}@${n.position('x').toFixed(2)},${n.position('y').toFixed(2)}`)
          .join('|')}`;
      const w = window as any;
      if (w.__cgVisSigAfterFonts !== sig) {
        w.__cgVisSigAfterFonts = sig;
        w.__cgVisSigAfterFontsSin = performance.now();
        return false;
      }
      return performance.now() - (w.__cgVisSigAfterFontsSin ?? 0) >= settle;
    },
    SETTLE_MS,
    { timeout, polling: 100 },
    PANEL.graphContainer
  );
}

export { PANEL, TRIGGERS, DROPDOWN_CONTENT, OPTION };
