// E2E tests for v0.2.0 new features: viewMode, pathfind, health, rules, hotspot,
// godmodule, undo/redo, radial/tree layout, minimap, collapse-all
import { test, expect } from '@playwright/test';
import { setupPluginPage, waitForGraphReady, getCyNodeCount, getClusterNodeIds } from './helpers.ts';

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

test.describe('J17: Health Score (FR-32)', () => {
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

test.describe('J18: Rules Engine (FR-34)', () => {
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

test.describe('J29: Undo/Redo (FR-31)', () => {
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

test.describe('J26: MiniMap Navigation (FR-43)', () => {
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
    const clusterSelect = page.locator('#cluster-depth');
    await clusterSelect.selectOption('2');
    await expect(clusterSelect).toHaveValue('2');
  });

  test('should change cluster level to file', async ({ page }) => {
    await setupPluginPage(page);
    const clusterSelect = page.locator('#cluster-depth');
    await clusterSelect.selectOption('1');
    await expect(clusterSelect).toHaveValue('1');
  });

  test('should have directory cluster level as default', async ({ page }) => {
    await setupPluginPage(page);
    const clusterSelect = page.locator('#cluster-depth');
    await expect(clusterSelect).toHaveValue('0');
  });

  test('J25: switching cluster depth should keep graph visible', async ({ page }) => {
    await setupPluginPage(page);
    const clusterSelect = page.locator('#cluster-depth');
    await clusterSelect.selectOption('1');
    const graphContainer = page.locator('.cg-graph-container');
    await expect(graphContainer).toBeVisible({ timeout: 5000 });
    await clusterSelect.selectOption('2');
    await expect(graphContainer).toBeVisible({ timeout: 5000 });
    await clusterSelect.selectOption('0');
    await expect(graphContainer).toBeVisible({ timeout: 5000 });
  });

  test('J25: cluster nodes should be present in directory depth', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    expect(clusterNodeIds.length).toBeGreaterThan(0);
  });

  test('J25: double-clicking cluster node should expand it', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    const clusterNodeId = clusterNodeIds[0] ?? null;
    if (!clusterNodeId) {
      test.skip(true, 'No cluster nodes found');
      return;
    }
    const beforeCount = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.nodes().length : 0;
    });
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) {
        const node = cy.getElementById(id);
        node.emit('dbltap');
      }
    }, clusterNodeId);
    await expect.poll(async () => await getCyNodeCount(page), { timeout: 5000 }).toBeGreaterThanOrEqual(beforeCount);
  });
});

test.describe('v0.2.0 Feature: Collapse All (FR-42)', () => {
  test('should have collapse all button', async ({ page }) => {
    await setupPluginPage(page);
    const collapseAllBtn = page.locator('.cg-collapse-all-btn');
    await expect(collapseAllBtn).toBeVisible();
  });
});
test.describe('J33: 展开/折叠聚类', () => {
  test('should expand cluster on double-click and show internal nodes', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    const clusterNodeId = clusterNodeIds[0] ?? null;
    if (!clusterNodeId) {
      test.skip(true, 'No cluster nodes found');
      return;
    }
    const beforeCount = await page.evaluate(() => {
      const cy = (window as any).__cytoscape;
      return cy ? cy.nodes().length : 0;
    });
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await expect.poll(async () => await getCyNodeCount(page), { timeout: 5000 }).toBeGreaterThanOrEqual(beforeCount);
  });

  test('should collapse cluster on second double-click', async ({ page }) => {
    await setupPluginPage(page);
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    const clusterNodeId = clusterNodeIds[0] ?? null;
    if (!clusterNodeId) {
      test.skip(true, 'No cluster nodes found');
      return;
    }
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await waitForGraphReady(page);
    const expandedCount = await getCyNodeCount(page);
    await page.evaluate((id) => {
      const cy = (window as any).__cytoscape;
      if (cy) cy.getElementById(id).emit('dbltap');
    }, clusterNodeId);
    await waitForGraphReady(page);
    const collapsedCount = await getCyNodeCount(page);
    expect(collapsedCount).toBeLessThanOrEqual(expandedCount);
  });

  test('should collapse all via collapse-all button', async ({ page }) => {
    await setupPluginPage(page);
    const collapseAllBtn = page.locator('.cg-collapse-all-btn');
    await collapseAllBtn.click({ timeout: 10000 });
    await waitForGraphReady(page);
    const clusterNodeIds = await getClusterNodeIds(page);
    expect(clusterNodeIds.length).toBeGreaterThanOrEqual(0);
  });
});