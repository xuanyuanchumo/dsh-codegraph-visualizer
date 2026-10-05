import { test, expect } from '@playwright/test';
import { setupPluginPage, TIMEOUTS } from './helpers.ts';
import { PANEL, MISC } from './selectors.ts';

/**
 * DSH 环境检测：检查是否在 DSH 真实环境中运行（而非纯开发服务器）。
 * 在 DSH 环境中，页面会包含 conversation.view 插槽或 remote-web-ui 容器。
 */
async function isDshEnvironment(page: import('@playwright/test').Page): Promise<boolean> {
  const hasConversationView = await page.locator(MISC.conversationViewWrapper).count();
  const hasRemoteWebUiHost = await page.locator('[data-cg-remote-web-ui-visible]').count();
  const hasIntegrationAttr = await page.locator(`${PANEL.root}[data-cg-integration]`).count();
  return hasConversationView > 0 || hasRemoteWebUiHost > 0 || hasIntegrationAttr > 0;
}

test.describe('conversation.view integration (requires DSH environment)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPluginPage(page);
  });

  test('renders cg-conversation-view-wrapper with correct attributes', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const wrapper = page.locator(MISC.conversationViewWrapper);
    await expect(wrapper).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    await expect(wrapper).toHaveAttribute('data-cg-conversation-view', 'true');
    await expect(wrapper).toHaveAttribute('data-cg-visible');
  });

  test('sets data-cg-integration to conversation-view on graph panel', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const panel = page.locator(PANEL.root);
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const mode = await panel.getAttribute('data-cg-integration');
    expect(mode).toBe('conversation-view');
  });

  test('graph panel is visible inside conversation view wrapper', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const wrapper = page.locator(MISC.conversationViewWrapper);
    const panel = wrapper.locator(PANEL.root);
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('toolbar renders inside conversation view container', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const wrapper = page.locator(MISC.conversationViewWrapper);
    const toolbar = wrapper.locator(PANEL.toolbar);
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('collapse FAB toggles panel visibility in conversation view', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const fab = page.locator(PANEL.collapsedFab);
    const panel = page.locator(PANEL.root);
    await expect(fab).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('data-cg-visible reflects panel visibility state', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const wrapper = page.locator(MISC.conversationViewWrapper);
    const fab = page.locator(PANEL.collapsedFab);

    const initialVisible = await wrapper.getAttribute('data-cg-visible');
    expect(initialVisible).toBeTruthy();

    await fab.click();
    const panel = page.locator(PANEL.root);
    await expect(panel).toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });

    await fab.click();
    await expect(panel).not.toHaveClass(/cg-collapsed/, { timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('ErrorBoundary wraps GraphPanel in conversation view', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const wrapper = page.locator(MISC.conversationViewWrapper);
    // 错误边界的回退节点是 `cg-error-boundary-fallback`（没有 `cg-error-boundary` 这个类名）。
    const errorBoundary = wrapper.locator(`${MISC.errorBoundaryFallback}, ${PANEL.root}`);
    await expect(errorBoundary.first()).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('graph panel maintains functionality inside conversation view', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const toolbar = page.locator(`${MISC.conversationViewWrapper} ${PANEL.toolbar}`);
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('integration mode detection (requires DSH environment)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPluginPage(page);
  });

  test('prefers conversation-view when slots API available', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const panel = page.locator(PANEL.root);
    const mode = await panel.getAttribute('data-cg-integration');
    expect(mode).toBe('conversation-view');
  });

  test('does not render remote-web-ui host when conversation-view active', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const remoteHost = page.locator(`${MISC.integrationHost}[data-cg-remote-web-ui-visible]`);
    await expect(remoteHost).toHaveCount(0);
  });

  test('does not render floating panel when conversation-view active', async ({ page }) => {
    test.skip(!await isDshEnvironment(page), 'DSH environment not available');
    const floatingPanel = page.locator('[data-cg-integration="floating"]');
    await expect(floatingPanel).toHaveCount(0);
  });
});

test.describe('basic graph panel rendering (dev server)', () => {
  test('graph panel renders and is visible', async ({ page }) => {
    await setupPluginPage(page);
    const panel = page.locator(PANEL.root);
    await expect(panel).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
  });

  test('toolbar renders with interactive buttons', async ({ page }) => {
    await setupPluginPage(page);
    const toolbar = page.locator(PANEL.toolbar);
    await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.VISIBLE_SHORT });
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('no critical console errors on page load', async ({ page }) => {
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