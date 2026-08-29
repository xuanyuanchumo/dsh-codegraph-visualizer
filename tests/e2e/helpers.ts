// Shared E2E helper: dismiss the API config modal and wait for the plugin to load.
import type { Page } from '@playwright/test';

export async function setupPluginPage(page: Page, url = 'http://localhost:3080'): Promise<void> {
  await page.goto(url);
  // Dismiss the API config modal if present (click "Configure Later").
  const skipBtn = page.locator('#api-skip-btn');
  await skipBtn.click({ timeout: 10000 }).catch(() => {});
  // Wait for the plugin panel to mount.
  await page.locator('.graph-panel').waitFor({ state: 'visible', timeout: 20000 });
}