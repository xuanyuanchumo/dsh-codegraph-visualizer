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
