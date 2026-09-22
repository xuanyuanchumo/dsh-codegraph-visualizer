// E2E tests for v0.2.0 new features: viewMode, pathfind, health, rules, hotspot,
// godmodule, undo/redo, radial/tree layout, minimap, collapse-all
import { test, expect } from '@playwright/test';
import { setupPluginPage } from './helpers.ts';

test.describe('v0.2.0 Feature: View Mode Switch (FR-21)', () => {
  test('should toggle view mode between code and dependencies', async ({ page }) => {
    await setupPluginPage(page);
    const viewModeBtn = page.locator('.cg-view-mode-btn');
    await expect(viewModeBtn).toBeVisible();
    await expect(viewModeBtn).toContainText('Deps');
    await viewModeBtn.click();
    await expect(viewModeBtn).toContainText('Code');
    await expect(viewModeBtn).toHaveClass(/cg-active/);
    await viewModeBtn.click();
    await expect(viewModeBtn).toContainText('Deps');
    await expect(viewModeBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Path Finding (FR-25)', () => {
  test('should toggle path find panel', async ({ page }) => {
    await setupPluginPage(page);
    const pathfindBtn = page.locator('.cg-pathfind-btn');
    await expect(pathfindBtn).toBeVisible();
    await pathfindBtn.click();
    await expect(pathfindBtn).toHaveClass(/cg-active/);
    await pathfindBtn.click();
    await expect(pathfindBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Health Score (FR-32)', () => {
  test('should toggle health score panel', async ({ page }) => {
    await setupPluginPage(page);
    const healthBtn = page.locator('.cg-health-btn');
    await expect(healthBtn).toBeVisible();
    await healthBtn.click();
    await expect(healthBtn).toHaveClass(/cg-active/);
    await healthBtn.click();
    await expect(healthBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Rules Engine (FR-34)', () => {
  test('should toggle rules panel', async ({ page }) => {
    await setupPluginPage(page);
    const rulesBtn = page.locator('.cg-rules-btn');
    await expect(rulesBtn).toBeVisible();
    await rulesBtn.click();
    await expect(rulesBtn).toHaveClass(/cg-active/);
    await rulesBtn.click();
    await expect(rulesBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Hotspot Analysis (FR-35)', () => {
  test('should toggle hotspot panel', async ({ page }) => {
    await setupPluginPage(page);
    const hotspotBtn = page.locator('.cg-hotspot-btn');
    await expect(hotspotBtn).toBeVisible();
    await hotspotBtn.click();
    await expect(hotspotBtn).toHaveClass(/cg-active/);
    await hotspotBtn.click();
    await expect(hotspotBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: God Module (FR-36)', () => {
  test('should toggle god module panel', async ({ page }) => {
    await setupPluginPage(page);
    const godModuleBtn = page.locator('.cg-godmodule-btn');
    await expect(godModuleBtn).toBeVisible();
    await godModuleBtn.click();
    await expect(godModuleBtn).toHaveClass(/cg-active/);
    await godModuleBtn.click();
    await expect(godModuleBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Undo/Redo (FR-31)', () => {
  test('should have undo and redo buttons', async ({ page }) => {
    await setupPluginPage(page);
    const undoBtn = page.locator('.cg-undo-btn');
    const redoBtn = page.locator('.cg-redo-btn');
    await expect(undoBtn).toBeVisible();
    await expect(redoBtn).toBeVisible();
  });

  test('undo should be disabled initially', async ({ page }) => {
    await setupPluginPage(page);
    const undoBtn = page.locator('.cg-undo-btn');
    await expect(undoBtn).toBeDisabled();
  });

  test('redo should be disabled initially', async ({ page }) => {
    await setupPluginPage(page);
    const redoBtn = page.locator('.cg-redo-btn');
    await expect(redoBtn).toBeDisabled();
  });

  test('should enable undo after layout change', async ({ page }) => {
    await setupPluginPage(page);
    const dagreBtn = page.locator('.cg-layout-btn', { hasText: 'dagre' });
    await dagreBtn.click();
    const undoBtn = page.locator('.cg-undo-btn');
    await expect(undoBtn).toBeEnabled({ timeout: 5000 });
    await undoBtn.click();
    await expect(undoBtn).toBeDisabled();
    const redoBtn = page.locator('.cg-redo-btn');
    await expect(redoBtn).toBeEnabled();
  });
});

test.describe('v0.2.0 Feature: Radial Layout (FR-40)', () => {
  test('should switch to radial layout', async ({ page }) => {
    await setupPluginPage(page);
    const radialBtn = page.locator('.cg-layout-btn', { hasText: 'radial' });
    await radialBtn.click();
    await expect(radialBtn).toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Tree Layout (FR-40)', () => {
  test('should switch to tree layout', async ({ page }) => {
    await setupPluginPage(page);
    const treeBtn = page.locator('.cg-layout-btn', { hasText: 'tree' });
    await treeBtn.click();
    await expect(treeBtn).toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: MiniMap Navigation (FR-43)', () => {
  test('should toggle minimap', async ({ page }) => {
    await setupPluginPage(page);
    const minimapBtn = page.locator('.cg-minimap-btn');
    await expect(minimapBtn).toBeVisible();
    await minimapBtn.click();
    await expect(minimapBtn).toHaveClass(/cg-active/);
    await minimapBtn.click();
    await expect(minimapBtn).not.toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Graph Type Switch (FR-21)', () => {
  test('should switch graph type to call', async ({ page }) => {
    await setupPluginPage(page);
    const callBtn = page.locator('.cg-graph-type-btn', { hasText: /call/i });
    await callBtn.click();
    await expect(callBtn).toHaveClass(/cg-active/);
  });

  test('should switch graph type to dependency', async ({ page }) => {
    await setupPluginPage(page);
    const depBtn = page.locator('.cg-graph-type-btn', { hasText: /depend/i });
    await depBtn.click();
    await expect(depBtn).toHaveClass(/cg-active/);
  });
});

test.describe('v0.2.0 Feature: Cluster Level (FR-42)', () => {
  test('should change cluster level to function', async ({ page }) => {
    await setupPluginPage(page);
    const clusterSelect = page.locator('#cluster-level');
    await clusterSelect.selectOption('function');
    await expect(clusterSelect).toHaveValue('function');
  });

  test('should change cluster level to smart', async ({ page }) => {
    await setupPluginPage(page);
    const clusterSelect = page.locator('#cluster-level');
    await clusterSelect.selectOption('smart');
    await expect(clusterSelect).toHaveValue('smart');
  });
});

test.describe('v0.2.0 Feature: Collapse All (FR-42)', () => {
  test('should have collapse all button', async ({ page }) => {
    await setupPluginPage(page);
    const collapseAllBtn = page.locator('.cg-collapse-all-btn');
    await expect(collapseAllBtn).toBeVisible();
  });
});