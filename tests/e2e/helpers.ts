import type { Page } from '@playwright/test';

export async function setupPluginPage(page: Page, url = 'http://localhost:3080'): Promise<void> {
  await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
  const skipBtn = page.locator('#api-skip-btn');
  await skipBtn.click({ timeout: 15000 }).catch(() => {});
  await page.locator('.graph-panel').waitFor({ state: 'visible', timeout: 45000 });
}
