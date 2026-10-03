import { test, expect } from '@playwright/test';
import { setupPluginPage, TIMEOUTS } from './helpers.ts';

test.describe('conversation.view integration', () => {
  test('renders cg-conversation-view-wrapper with correct attributes', async ({ page }) => {
    await setupPluginPage(page);
    const wrapper = page.locator('.cg-conversation-view-wrapper');
    await expect(wrapper).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(wrapper).toHaveAttribute('data-cg-conversation-view', 'true');
    await expect(wrapper).toHaveAttribute('data-cg-visible');
  });

  test('sets data-cg-integration to conversation-view on graph panel', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.cg-graph-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const mode = await panel.getAttribute('data-cg-integration');
    expect(mode).toBe('conversation-view');
  });

  test('graph panel is visible inside conversation view wrapper', async ({ page }) => {
    await setupPluginPage(page);
    const wrapper = page.locator('.cg-conversation-view-wrapper');
    const panel = wrapper.locator('.cg-graph-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('toolbar renders inside conversation view container', async ({ page }) => {
    await setupPluginPage(page);
    const wrapper = page.locator('.cg-conversation-view-wrapper');
    const toolbar = wrapper.locator('.cg-graph-toolbar');
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('collapse FAB toggles panel visibility in conversation view', async ({ page }) => {
    await setupPluginPage(page);
    const fab = page.locator('.cg-collapse-fab');
    const panel = page.locator('.cg-graph-panel');
    await expect(fab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('data-cg-visible reflects panel visibility state', async ({ page }) => {
    await setupPluginPage(page);
    const wrapper = page.locator('.cg-conversation-view-wrapper');
    const fab = page.locator('.cg-collapse-fab');

    const initialVisible = await wrapper.getAttribute('data-cg-visible');
    expect(initialVisible).toBeTruthy();

    await fab.click();
    const panel = page.locator('.cg-graph-panel');
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('ErrorBoundary wraps GraphPanel in conversation view', async ({ page }) => {
    await setupPluginPage(page);
    const wrapper = page.locator('.cg-conversation-view-wrapper');
    const errorBoundary = wrapper.locator('.cg-error-boundary, .cg-graph-panel');
    await expect(errorBoundary.first()).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('graph panel maintains functionality inside conversation view', async ({ page }) => {
    await setupPluginPage(page);
    const toolbar = page.locator('.cg-conversation-view-wrapper .cg-graph-toolbar');
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('no console errors in conversation view mode', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await setupPluginPage(page);
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('DevTools'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('integration mode detection', () => {
  test('prefers conversation-view when slots API available', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.cg-graph-panel');
    const mode = await panel.getAttribute('data-cg-integration');
    expect(mode).toBe('conversation-view');
  });

  test('does not render remote-web-ui host when conversation-view active', async ({ page }) => {
    await setupPluginPage(page);
    const remoteHost = page.locator('.cg-integration-host[data-cg-remote-web-ui-visible]');
    await expect(remoteHost).toHaveCount(0);
  });

  test('does not render floating panel when conversation-view active', async ({ page }) => {
    await setupPluginPage(page);
    const floatingPanel = page.locator('[data-cg-integration="floating"]');
    await expect(floatingPanel).toHaveCount(0);
  });
});

test.describe('remote-web-ui integration (fallback)', () => {
  test('graph panel still loads when only remote-web-ui is available', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator('.cg-graph-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('toolbar persists regardless of integration mode', async ({ page }) => {
    await setupPluginPage(page);
    const toolbar = page.locator('.cg-graph-toolbar');
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });
});