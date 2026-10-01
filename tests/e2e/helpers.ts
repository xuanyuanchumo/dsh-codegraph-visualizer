import type { Page } from '@playwright/test';

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
