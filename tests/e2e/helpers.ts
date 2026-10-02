import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

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
  await page.locator('.cg-graph-panel').waitFor({ state: 'visible', timeout: TIMEOUTS.GRAPH_LOAD });
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

export async function getClusterNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cy = (window as any).__cytoscape;
    if (!cy) return [];
    return cy.nodes('[isCluster = "true"]').map((n: any) => n.id());
  });
}

export async function emitNodeEvent(page: Page, nodeId: string, event: string): Promise<void> {
  await page.evaluate(([id, ev]) => {
    const cy = (window as any).__cytoscape;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (node && node.length > 0) node.emit(ev);
  }, [nodeId, event] as const);
}

export async function selectNode(page: Page, nodeId: string): Promise<void> {
  await emitNodeEvent(page, nodeId, 'tap');
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

export async function fetchGraphApi<T = unknown>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p, i);
      return res.json();
    },
    [path, init] as const,
  );
  return response as T;
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

export async function enterMicroView(page: Page, mode: 'cfg' | 'flowchart' | 'sequence'): Promise<void> {
  const btn = page.locator(`.cg-view-mode-btn--micro[data-mode="${mode}"]`);
  await btn.click();
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
