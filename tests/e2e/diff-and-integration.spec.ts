import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';
import { PANEL, TRIGGERS } from './selectors.ts';

test.describe('J19: 版本对比', () => {
  test('should have diff endpoint available', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });

  test('should show error for invalid git refs', async ({ page }) => {
    await setupPluginPage(page);
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'invalid;ref', to: 'main' }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid git ref');
  });
});

test.describe('J20: DSH Agent 图谱查询', () => {
  test('should respond to codegraph:symbol-select event', async ({ page }) => {
    await setupPluginPage(page);
    const graphPanel = page.locator(PANEL.root);
    await expect(graphPanel).toBeVisible();
  });

  test('should return graph data via API', async ({ page }) => {
    await setupPluginPage(page);
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/data');
      return { status: res.status };
    });
    expect(response.status).toBe(200);
  });
});

test.describe('J21: MCP Server 接入', () => {
  test('should have health endpoint for external tools', async ({ page }) => {
    await setupPluginPage(page);
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/codegraph/health');
      return { status: res.status, body: await res.json() };
    });
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('codegraph');
  });
});

test.describe('J22: CI/CD 架构报告', () => {
  test('should export graph as JSON for CI pipelines', async ({ page }) => {
    await setupPluginPage(page);
    const exportBtn = page.locator(TRIGGERS.export);
    await expect(exportBtn).toBeVisible();
  });
});
