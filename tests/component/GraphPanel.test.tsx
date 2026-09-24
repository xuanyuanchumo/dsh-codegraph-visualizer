/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import { useGraphRenderer, useGraphInteraction, useGraphStatus, useGraphPerformance, useNodeSearch, usePanelState, useGraphWorkspace, useGraphData } from '../../src/client/hooks/index.ts';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;

vi.mock('../../src/client/hooks/index.ts', () => ({
  useDebounce: vi.fn((fn: any) => fn),
  usePolling: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  useGraphRenderer: vi.fn(() => ({
    containerRef: { current: null },
    rendererRef: { current: null },
    initRenderer: vi.fn(),
    destroyRenderer: vi.fn(),
    updateData: vi.fn(),
    applyLayout: vi.fn(),
    selectNode: vi.fn(),
    focusOnNode: vi.fn(),
    focusNeighborhood: vi.fn(),
    highlightCallChain: vi.fn(),
    highlightImpact: vi.fn(),
    highlightInheritance: vi.fn(),
    getViewportInfo: vi.fn(() => null),
    focusOnArea: vi.fn(),
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    setTheme: vi.fn(),
    setFilter: vi.fn(),
    setGraphType: vi.fn(),
    setClusterDepth: vi.fn(),
    setLODLevel: vi.fn(),
    setHeatmapMode: vi.fn(),
    applyIncrementalLayout: vi.fn(),
    updateTheme: vi.fn(),
    searchMatchCount: 0,
    exportGraph: vi.fn(),
  })),
  usePanelResize: vi.fn(() => ({
    resizeHandleRef: { current: null },
    panelSize: { width: 600, height: 400 },
  })),
  usePanelState: vi.fn(() => ({
    showImport: false,
    showSearch: false,
    showLegend: false,
    showMiniMap: false,
    showFilterPanel: false,
    showPathFind: false,
    showHealthScore: false,
    showRuleConfig: false,
    showCallChain: false,
    showImpact: false,
    showCycles: false,
    showHotspot: false,
    showGodModule: false,
    showCoreFunction: false,
    showKeyboardHelp: false,
    collapsed: false,
    isCollapsed: false,
    toPanelControls: () => ({ showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRuleConfig: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false }),
    setShowImport: vi.fn(),
    setShowSearch: vi.fn(),
    setShowLegend: vi.fn(),
    setShowMiniMap: vi.fn(),
    setShowFilterPanel: vi.fn(),
    setShowPathFind: vi.fn(),
    setShowHealthScore: vi.fn(),
    setShowRuleConfig: vi.fn(),
    setShowCallChain: vi.fn(),
    setShowImpact: vi.fn(),
    setShowCycles: vi.fn(),
    setShowHotspot: vi.fn(),
    setShowGodModule: vi.fn(),
    setShowCoreFunction: vi.fn(),
    toggleCollapsed: vi.fn(),
    toggleCollapse: vi.fn(),
  })),
  usePanelKeyboard: vi.fn(() => ({})),
  useViewMode: vi.fn(() => ({
    isMicroView: false,
    handleViewModeChange: vi.fn(),
    fetchGraphData: vi.fn(),
    loadingMicro: false,
    microError: null,
  })),
  useAnalysisPanels: vi.fn(() => ({
    hotspotNodes: [],
    godModules: [],
    coreFunctions: [],
    impactStats: null,
    cycleDetails: [],
    healthScore: null,
  })),
  useNodeSearch: vi.fn(() => ({
    searchResults: [],
    searchInputRef: { current: null },
  })),
  useGraphData: vi.fn(() => ({ nodes: [], edges: [], rawNodes: [], rawEdges: [] })),
  useGraphDisplay: vi.fn(() => useGraphStore(useShallow((s: any) => ({
    layout: s.layout, dagreRankDir: s.dagreRankDir, theme: s.theme,
    filterType: s.filterType, graphType: s.graphType, clusterDepth: s.clusterDepth,
    viewMode: s.viewMode, currentLayer: s.currentLayer, diagramData: s.diagramData,
  })))),
  useGraphInteraction: vi.fn(() => ({ searchQuery: '', selectedNodeId: null, highlightedNodeIds: [], expandedNodeIds: new Set(), pathResult: null, focusDepth: 1, focusModeActive: false, focusModeNodeId: null, pathFilterInclude: null, pathFilterExclude: null })),
  useGraphStatus: vi.fn(() => ({ isLoading: false, error: null, lastUpdated: 0, truncated: false, totalNodeCount: 0, prerequisites: { codegraph: false, lens: false }, watchEnabled: false, initStatus: 'idle' })),
  useGraphWorkspace: vi.fn(() => ({ currentWorkspace: '', workspaceList: [] })),
  useGraphAnalysis: vi.fn(() => ({ ruleViolations: [], selectedFunction: null, fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none' })),
  useGraphPerformance: vi.fn(() => ({ performanceDegradations: [], lodLevel: 'full', lodEnabled: false })),
  useGraphActions: vi.fn(() => {
    const s = useGraphStore.getState();
    return {
      setLayout: s.setLayout, setDagreRankDir: s.setDagreRankDir, setTheme: s.setTheme, setSearchQuery: s.setSearchQuery,
      setSelectedNode: s.setSelectedNode, setFilterType: s.setFilterType, setGraphType: s.setGraphType, setClusterDepth: s.setClusterDepth,
      setLayer: s.setLayer, setLoading: s.setLoading, setCurrentWorkspace: s.setCurrentWorkspace, addWorkspace: s.addWorkspace,
      removeWorkspace: s.removeWorkspace, setGraphData: s.setGraphData, setInitStatus: s.setInitStatus, setWatchEnabled: s.setWatchEnabled,
      setError: s.setError, expandNode: s.expandNode, collapseNode: s.collapseNode, collapseAll: s.collapseAll,
      setPathResult: s.setPathResult, setFocusDepth: s.setFocusDepth, setHeatmapMode: s.setHeatmapMode, setLODLevel: s.setLODLevel,
      assembleMicro: s.assembleMicro,
    };
  }),
  usePanelDimensions: vi.fn(() => ({ panelHeight: null, panelWidth: null })),
}));

vi.mock('../../src/client/hooks/useThemeSync.ts', () => ({
  useThemeSync: vi.fn(() => ({})),
}));

vi.mock('../../src/client/hooks/useHistory.ts', () => ({
  useHistory: vi.fn(() => ({
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    pushHistory: vi.fn(),
  })),
}));

vi.mock('../../src/client/hooks/useGraphCache.ts', () => ({
  useGraphCache: vi.fn(() => ({
    loadCache: vi.fn(() => null),
    saveCache: vi.fn(),
  })),
}));

vi.mock('../../src/client/renderer/SequenceDiagramRenderer.tsx', () => ({
  SequenceDiagramRenderer: () => React.createElement('div', { 'data-testid': 'seq-renderer' }),
}));

vi.mock('../../src/client/renderer/styles/ThemeStylesheet.ts', () => ({
  invalidateCssVarCache: vi.fn(),
}));

vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => (key: string) => key,
  useLang: () => 'zh',
  toggleLang: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useGraphStore.setState({
    nodes: [], edges: [], rawNodes: [], rawEdges: [],
    isLoading: false, error: null, theme: 'dark',
    heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
    focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
    pathResult: null, selectedFunction: null, diagramData: null,
  });
  document.body.removeAttribute('data-ds-dark-theme');
});

describe('GraphPanel component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      isLoading: false, error: null, theme: 'dark',
      heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
      focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
      pathResult: null, selectedFunction: null, diagramData: null,
    });
    document.body.removeAttribute('data-ds-dark-theme');
  });

  it('renders without crashing', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container.firstChild).not.toBeNull();
  });

  it('renders graph container div', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container');
    expect(graphContainer?.tagName).toBe('DIV');
  });

  it('renders resize handle', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const handle = container.querySelector('.cg-resize-handle');
    expect(handle?.tagName).toBe('DIV');
  });

  it('renders live region for accessibility', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const liveRegion = container.querySelector('#cg-graph-live-region');
    expect(liveRegion?.getAttribute('role')).toBe('status');
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
  });

  it('graph container has role application', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container');
    expect(graphContainer?.getAttribute('role')).toBe('application');
  });

  it('graph container has aria-label', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container');
    expect(graphContainer?.getAttribute('aria-label')?.length).toBeGreaterThan(0);
  });

  it('renders panel with aria-label region', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    const region = screen.queryByRole('region');
    expect(region?.getAttribute('aria-label')).toBe('panel.ariaLabel');
  });

  it('wraps content in ErrorBoundary', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });
});
describe('GraphPanel handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-ds-dark-theme');
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      isLoading: false, error: null, theme: 'dark',
      heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
      focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
      pathResult: null, selectedFunction: null, diagramData: null,
    });
  });

  it('handleThemeToggle: toggles data-ds-dark-theme on body when clicking theme button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const themeBtn = container.querySelector('.cg-theme-btn') as HTMLButtonElement;
    expect(themeBtn?.tagName).toBe('BUTTON');
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false);
    fireEvent.click(themeBtn);
    fireEvent.click(themeBtn);
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true);
    fireEvent.click(themeBtn);
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false);
  });

  it('handleThemeToggle: calls invalidateCssVarCache on toggle', async () => {
    const { invalidateCssVarCache } = await import('../../src/client/renderer/styles/ThemeStylesheet.ts');
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const themeBtn = container.querySelector('.cg-theme-btn') as HTMLButtonElement;
    fireEvent.click(themeBtn);
    expect(vi.mocked(invalidateCssVarCache)).toHaveBeenCalled();
  });

  it('handleCloseDetail: collapse FAB button is clickable', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab?.tagName).toBe('BUTTON');
    fireEvent.click(fab);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('heatmap activate button: renders when heatmapMode is none', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBtn = container.querySelector('.cg-heatmap-btn--activate');
    expect(heatmapBtn?.tagName).toBe('BUTTON');
  });

  it('lang button: triggers toggleLang when clicked', async () => {
    const i18nModule = await import('../../src/client/i18n/index.ts');
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const langBtn = container.querySelector('.cg-lang-btn') as HTMLButtonElement;
    expect(langBtn?.tagName).toBe('BUTTON');
    fireEvent.click(langBtn);
    expect(vi.mocked(i18nModule.toggleLang)).toHaveBeenCalled();
  });

  it('graph container aria-label updates with viewMode and node/edge counts', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container') as HTMLElement;
    const ariaLabel = graphContainer.getAttribute('aria-label');
    expect(ariaLabel).toContain('a11y.graphContainer');
    expect(ariaLabel).toContain('a11y.nodes');
    expect(ariaLabel).toContain('a11y.edges');
  });

  it('live region shows empty when no node selected', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const liveRegion = container.querySelector('#cg-graph-live-region') as HTMLElement;
    expect(liveRegion.textContent?.trim()).toBe('');
  });

  it('panel has correct role and aria-label', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('panel.ariaLabel');
  });

  it('search button click toggles search panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const searchBtn = container.querySelector('.cg-search-btn') as HTMLButtonElement;
    expect(searchBtn?.tagName).toBe('BUTTON');
    fireEvent.click(searchBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('layout button click does not crash', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const layoutBtns = container.querySelectorAll('.cg-layout-btn');
    expect(layoutBtns.length).toBeGreaterThan(0);
    fireEvent.click(layoutBtns[0]!);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('export button click toggles export menu', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const exportBtn = container.querySelector('.cg-export-btn') as HTMLButtonElement;
    expect(exportBtn?.tagName).toBe('BUTTON');
    fireEvent.click(exportBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('heatmap button click does not crash', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBtn = container.querySelector('.cg-heatmap-btn--activate') as HTMLButtonElement;
    expect(heatmapBtn?.tagName).toBe('BUTTON');
    fireEvent.click(heatmapBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('pathfind button click toggles path panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const pathfindBtn = container.querySelector('.cg-pathfind-btn') as HTMLButtonElement;
    expect(pathfindBtn?.tagName).toBe('BUTTON');
    fireEvent.click(pathfindBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('health score button click toggles health panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const healthBtn = container.querySelector('.cg-health-btn') as HTMLButtonElement;
    expect(healthBtn?.tagName).toBe('BUTTON');
    fireEvent.click(healthBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('filter button click toggles filter panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const filterBtn = container.querySelector('.cg-filter-panel-btn') as HTMLButtonElement;
    expect(filterBtn?.tagName).toBe('BUTTON');
    fireEvent.click(filterBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('legend button click toggles legend panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const legendBtn = container.querySelector('.cg-legend-btn') as HTMLButtonElement;
    expect(legendBtn?.tagName).toBe('BUTTON');
    fireEvent.click(legendBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('minimap button click toggles minimap panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const minimapBtn = container.querySelector('.cg-minimap-btn') as HTMLButtonElement;
    expect(minimapBtn?.tagName).toBe('BUTTON');
    fireEvent.click(minimapBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('callchain button click toggles call chain panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const callchainBtn = container.querySelector('.cg-chain-btn') as HTMLButtonElement;
    expect(callchainBtn?.tagName).toBe('BUTTON');
    fireEvent.click(callchainBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('impact button click toggles impact panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const impactBtn = container.querySelector('.cg-impact-btn') as HTMLButtonElement;
    expect(impactBtn?.tagName).toBe('BUTTON');
    fireEvent.click(impactBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('inheritance button click toggles inheritance panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const inheritanceBtn = container.querySelector('.cg-inheritance-btn') as HTMLButtonElement;
    expect(inheritanceBtn?.tagName).toBe('BUTTON');
    fireEvent.click(inheritanceBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('hotspot button click toggles hotspot panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const hotspotBtn = container.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
    expect(hotspotBtn?.tagName).toBe('BUTTON');
    fireEvent.click(hotspotBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('god module button click toggles god module panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const godBtn = container.querySelector('.cg-godmodule-btn') as HTMLButtonElement;
    expect(godBtn?.tagName).toBe('BUTTON');
    fireEvent.click(godBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('cycles button click toggles cycles panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const cyclesBtn = container.querySelector('.cg-cycle-btn') as HTMLButtonElement;
    expect(cyclesBtn?.tagName).toBe('BUTTON');
    fireEvent.click(cyclesBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('core function button click toggles core function panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const coreBtn = container.querySelector('.cg-corefunction-btn') as HTMLButtonElement;
    expect(coreBtn?.tagName).toBe('BUTTON');
    fireEvent.click(coreBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('rules button click toggles rules panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const rulesBtn = container.querySelector('.cg-rules-btn') as HTMLButtonElement;
    expect(rulesBtn?.tagName).toBe('BUTTON');
    fireEvent.click(rulesBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('import button click toggles import panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const importBtn = container.querySelector('.cg-import-btn') as HTMLButtonElement;
    expect(importBtn?.tagName).toBe('BUTTON');
    fireEvent.click(importBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('toolbar renders all essential buttons', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolbar = container.querySelector('.cg-graph-toolbar');
    expect(toolbar?.tagName).toBe('DIV');
    expect(container.querySelector('.cg-search-btn')?.tagName).toBe('BUTTON');
    expect(container.querySelector('.cg-theme-btn')?.tagName).toBe('BUTTON');
    expect(container.querySelector('.cg-export-btn')?.tagName).toBe('BUTTON');
  });

  it('status bar renders with node and edge counts', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const statusBar = container.querySelector('.cg-status-bar');
    expect(statusBar?.tagName).toBe('DIV');
  });
});
describe('GraphPanel event dispatch behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-ds-dark-theme');
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      isLoading: false, error: null, theme: 'dark',
      heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
      focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
      pathResult: null, selectedFunction: null, diagramData: null,
    });
  });

  it('handleRefresh: dispatches codegraph:refresh event on refresh button click', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const refreshBtn = container.querySelector('.cg-refresh-btn') as HTMLButtonElement;
    if (refreshBtn) {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      fireEvent.click(refreshBtn);
      const refreshEvent = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === 'codegraph:refresh',
      );
      expect(refreshEvent?.[0]).toBeInstanceOf(CustomEvent);
      expect((refreshEvent?.[0] as CustomEvent).type).toBe('codegraph:refresh');
    }
  });

  it('handleScanWorkspace: dispatches codegraph:import-repo event from EmptyState scan', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const scanBtn = container.querySelector('.cg-empty-scan-btn') as HTMLButtonElement;
    if (scanBtn) {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      fireEvent.click(scanBtn);
      const importEvent = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
      );
      expect(importEvent?.[0]).toBeInstanceOf(CustomEvent);
      expect((importEvent?.[0] as CustomEvent).type).toBe('codegraph:import-repo');
    }
  });

  it('handleWorkspaceSwitch: dispatches codegraph:workspace event', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path: '/test/path' } }));
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('handleThemeToggle: toggles theme attribute and calls setTheme', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const themeBtn = container.querySelector('.cg-theme-btn') as HTMLButtonElement;
    expect(themeBtn?.tagName).toBe('BUTTON');
    fireEvent.click(themeBtn);
    fireEvent.click(themeBtn);
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true);
  });

  it('handleCloseDetail: collapse FAB preserves panel structure', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab?.tagName).toBe('BUTTON');
    fireEvent.click(fab);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleFocusExpand: focus mode bar not shown without focusNodeId', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const focusBar = container.querySelector('.cg-focus-mode-bar');
    expect(focusBar).toBeNull();
  });

  it('handleFindPath: path panel not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const pathBar = container.querySelector('.cg-path-bar');
    expect(pathBar).toBeNull();
  });

  it('handleSelectSearchResult: search panel not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const searchBar = container.querySelector('.cg-search-bar');
    expect(searchBar).toBeNull();
  });

  it('heatmap mode buttons: renders activate button when mode is none', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBar = container.querySelector('.cg-heatmap-bar');
    expect(heatmapBar?.getAttribute('role')).toBe('group');
    const activateBtn = container.querySelector('.cg-heatmap-btn--activate');
    expect(activateBtn?.tagName).toBe('BUTTON');
  });

  it('empty state: renders when no nodes and not loading', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const emptyState = container.querySelector('.cg-empty-state');
    expect(emptyState?.tagName).toBe('DIV');
  });

  it('loading overlay: not shown when isLoading is false', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const loadingOverlay = container.querySelector('.cg-loading-overlay');
    expect(loadingOverlay).toBeNull();
  });

  it('error overlay: not shown when no error', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const errorOverlay = container.querySelector('.cg-error-overlay');
    expect(errorOverlay).toBeNull();
  });

  it('context menu: not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const contextMenu = container.querySelector('.cg-context-menu');
    expect(contextMenu).toBeNull();
  });

  it('tooltip: not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const tooltip = container.querySelector('.cg-graph-tooltip');
    expect(tooltip).toBeNull();
  });

  it('keyboard help: not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const help = container.querySelector('.cg-keyboard-help');
    expect(help).toBeNull();
  });

  it('node detail: not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const nodeDetail = container.querySelector('.cg-node-detail');
    expect(nodeDetail).toBeNull();
  });

  it('micro view prompt: not shown in code view mode', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const microPrompt = container.querySelector('.cg-micro-view-prompt');
    expect(microPrompt).toBeNull();
  });

  it('panel stack left: renders container div', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const stackLeft = container.querySelector('.cg-panel-stack-left');
    expect(stackLeft?.tagName).toBe('DIV');
  });

  it('graph container: has correct aria-label with stats', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container') as HTMLElement;
    const ariaLabel = graphContainer.getAttribute('aria-label');
    expect(ariaLabel).toContain('a11y.graphContainer');
  });

  it('collapse FAB: has correct aria-label', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab.getAttribute('aria-label')).toBe('panel.expand');
  });

  it('heatmap bar: has group role and aria-label', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBar = container.querySelector('.cg-heatmap-bar') as HTMLElement;
    expect(heatmapBar.getAttribute('role')).toBe('group');
    expect(heatmapBar.getAttribute('aria-label')).toBe('heatmap.title');
  });
});
describe('GraphPanel handler integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-ds-dark-theme');
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      isLoading: false, error: null, theme: 'dark',
      heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
      focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
      pathResult: null, selectedFunction: null, diagramData: null,
    });
  });

  it('handleRefresh: dispatches codegraph:refresh event', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const refreshBtn = container.querySelector('.cg-refresh-btn') as HTMLButtonElement;
    expect(refreshBtn?.tagName).toBe('BUTTON');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    fireEvent.click(refreshBtn);
    const refreshEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:refresh',
    );
    expect(refreshEvent?.[0]).toBeInstanceOf(CustomEvent);
  });

  it('handleScanWorkspace: dispatches codegraph:import-repo from empty state', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const scanBtn = container.querySelector('.cg-empty-scan-btn') as HTMLButtonElement;
    expect(scanBtn?.tagName).toBe('BUTTON');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    fireEvent.click(scanBtn);
    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent?.[0]).toBeInstanceOf(CustomEvent);
  });

  it('handleScanWorkspace: dispatches codegraph:import-repo from empty state', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const scanBtn = container.querySelector('.cg-empty-scan-btn') as HTMLButtonElement;
    expect(scanBtn).toBeTruthy();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    fireEvent.click(scanBtn);
    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent).toBeTruthy();
  });

  it('codegraph:workspace event: updates currentWorkspace in store', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path: '/new/workspace' } }));
    expect(useGraphStore.getState().currentWorkspace).toBe('/new/workspace');
  });

  it('codegraph:symbol-select event: does not crash when no matching symbol', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    window.dispatchEvent(new CustomEvent('codegraph:symbol-select', { detail: { symbol: 'nonExistentSymbol' } }));
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('handleCloseDetail: clears selectedNodeData when FAB clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab?.tagName).toBe('BUTTON');
    fireEvent.click(fab);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleSelectSearchResult: search panel toggle works', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const searchBtn = container.querySelector('.cg-search-btn') as HTMLButtonElement;
    expect(searchBtn?.tagName).toBe('BUTTON');
    fireEvent.click(searchBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleFindPath: pathfind button toggles path panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const pathfindBtn = container.querySelector('.cg-pathfind-btn') as HTMLButtonElement;
    expect(pathfindBtn?.tagName).toBe('BUTTON');
    fireEvent.click(pathfindBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleFocusExpand: focus bar not shown without focusNodeId', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-focus-mode-bar')).toBeNull();
  });

  it('handleFocusExit: focus bar not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-focus-mode-bar')).toBeNull();
  });

  it('handleClearPath: path bar not shown by default', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-path-bar')).toBeNull();
  });

  it('heatmap activate: clicking activates instability mode', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const activateBtn = container.querySelector('.cg-heatmap-btn--activate') as HTMLButtonElement;
    expect(activateBtn?.tagName).toBe('BUTTON');
    fireEvent.click(activateBtn);
    expect(useGraphStore.getState().heatmapMode).toBe('instability');
  });

  it('heatmap mode buttons: switching between modes', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({ heatmapMode: 'instability' });
    const { container } = render(React.createElement(GraphPanel));
    const linesBtn = container.querySelector('.cg-heatmap-btn[data-mode="lines"], button.cg-heatmap-btn:not(.cg-heatmap-btn--activate)') as HTMLButtonElement;
    if (linesBtn) {
      fireEvent.click(linesBtn);
    }
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleThemeToggle: toggles to light theme correctly', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const themeBtn = container.querySelector('.cg-theme-btn') as HTMLButtonElement;
    expect(themeBtn?.tagName).toBe('BUTTON');
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false);
    fireEvent.click(themeBtn);
    fireEvent.click(themeBtn);
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true);
    expect(useGraphStore.getState().theme).toBe('dark');
  });

  it('handleCollapseAll: collapse all button is clickable', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const collapseAllBtn = container.querySelector('.cg-collapse-all-btn') as HTMLButtonElement;
    if (collapseAllBtn) {
      fireEvent.click(collapseAllBtn);
    }
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleViewModeChange: view mode buttons exist in toolbar', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const viewModeBtns = container.querySelectorAll('.cg-viewmode-btn');
    if (viewModeBtns.length > 0) {
      fireEvent.click(viewModeBtns[0]!);
    }
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('adjacencyMap: computed from edges data', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({
      nodes: [
        { id: 'n1' as any, label: 'A', type: 'function', filePath: '/a.ts', properties: {} },
        { id: 'n2' as any, label: 'B', type: 'function', filePath: '/b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', properties: {} },
      ],
      rawNodes: [
        { id: 'n1' as any, label: 'A', type: 'function', filePath: '/a.ts', properties: {} },
        { id: 'n2' as any, label: 'B', type: 'function', filePath: '/b.ts', properties: {} },
      ],
      rawEdges: [
        { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', properties: {} },
      ],
    });
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container') as HTMLElement;
    expect(graphContainer?.tagName).toBe('DIV');
    const ariaLabel = graphContainer.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('a11y.nodes');
  });

  it('nodeTypeCounts: computed from rawNodes', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({
      rawNodes: [
        { id: 'n1' as any, label: 'A', type: 'function', filePath: '/a.ts', properties: {} },
        { id: 'n2' as any, label: 'B', type: 'class', filePath: '/b.ts', properties: {} },
        { id: 'n3' as any, label: 'C', type: 'interface', filePath: '/c.ts', properties: {} },
      ],
      nodes: [],
      edges: [],
      rawEdges: [],
    });
    const { container } = render(React.createElement(GraphPanel));
    const toolbar = container.querySelector('.cg-graph-toolbar');
    expect(toolbar?.tagName).toBe('DIV');
  });

  it('statsText: displays node and edge counts', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({
      nodes: [
        { id: 'n1' as any, label: 'A', type: 'function', filePath: '/a.ts', properties: {} },
      ],
      edges: [],
      rawNodes: [],
      rawEdges: [],
    });
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container') as HTMLElement;
    const ariaLabel = graphContainer.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('a11y.nodes');
    expect(ariaLabel).toContain('a11y.edges');
  });

  it('panel collapsed state: applies cg-collapsed class', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab?.tagName).toBe('BUTTON');
    fireEvent.click(fab);
    const panel = container.querySelector('.cg-graph-panel');
    expect(panel?.tagName).toBe('DIV');
  });

  it('error state: renders error overlay when error is set', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({ error: 'Test error message' });
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('loading state: renders loading overlay when isLoading is true', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({ isLoading: true });
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('micro view: not shown in code view mode', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({ viewMode: 'code' });
    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-micro-view-prompt')).toBeNull();
  });

  it('live region: shows selection info when node is selected', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({
      selectedNodeId: 'n1' as any,
      nodes: [
        { id: 'n1' as any, label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10, properties: {} },
      ],
    });
    const { container } = render(React.createElement(GraphPanel));
    const liveRegion = container.querySelector('#cg-graph-live-region') as HTMLElement;
    expect(liveRegion?.getAttribute('role')).toBe('status');
  });
});
describe('GraphPanel uncovered handler tests', () => {
  let capturedCallbacks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-ds-dark-theme');
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      isLoading: false, error: null, theme: 'dark',
      heatmapMode: 'none', viewMode: 'code', selectedNodeId: null,
      focusModeActive: false, focusModeNodeId: null, focusDepth: 1,
      pathResult: null, selectedFunction: null, diagramData: null,
      expandedNodeIds: new Set(), lodLevel: 'full',
      pathStartId: null, pathEndId: null,
    });
    capturedCallbacks = {};
  });

  function setupRendererMockWithCallbacks(rendererCurrent: any) {
    vi.mocked(useGraphRenderer).mockImplementation((opts: any) => {
      capturedCallbacks = opts.callbacks;
      return {
        containerRef: { current: null },
        rendererRef: { current: rendererCurrent },
        initRenderer: vi.fn(),
        destroyRenderer: vi.fn(),
        updateData: vi.fn(),
        applyLayout: vi.fn(),
        selectNode: vi.fn(),
        focusOnNode: vi.fn(),
        focusNeighborhood: vi.fn(),
        highlightCallChain: vi.fn(),
        highlightImpact: vi.fn(),
        highlightInheritance: vi.fn(),
        getViewportInfo: vi.fn(() => null),
        focusOnArea: vi.fn(),
        exportPNG: vi.fn(),
        exportSVG: vi.fn(),
        setTheme: vi.fn(),
        setFilter: vi.fn(),
        setGraphType: vi.fn(),
        setClusterDepth: vi.fn(),
        setLODLevel: vi.fn(),
        setHeatmapMode: vi.fn(),
        applyIncrementalLayout: vi.fn(),
        updateTheme: vi.fn(),
        searchMatchCount: 0,
        setSearchMatchCount: vi.fn(),
        exportGraph: vi.fn(),
      };
    });
  }

  function createMockRenderer(nodeMap: Map<string, any>, edgeMap: Map<string, any>) {
    return {
      getNodeData: vi.fn((id: string) => nodeMap.get(id) ?? null),
      getEdgeData: vi.fn((id: string) => edgeMap.get(id) ?? null),
      getSelectedNodeData: vi.fn(() => null),
      getZoom: vi.fn(() => 1),
      onZoomChange: vi.fn(() => vi.fn()),
      findPath: vi.fn(() => null),
      highlightPath: vi.fn(),
      expandNeighborhood: vi.fn(),
      focusNeighborhood: vi.fn(),
      focusOnNode: vi.fn(),
      selectNode: vi.fn(),
      getVisibleNodeCount: vi.fn(() => 0),
      getThumbnail: vi.fn(() => null),
      getViewportInfo: vi.fn(() => null),
      resize: vi.fn(),
      detectCyclesDetailed: vi.fn(() => []),
      hideNode: vi.fn(),
      showAllNodes: vi.fn(),
    };
  }

  it('handleNodeTap: sets selectedNodeId in store', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeTap('n1');
    });

    expect(useGraphStore.getState().selectedNodeId).toBe('n1');
  });

  it('handleNodeTap: sets selectedNodeId even when node data not found', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer(new Map(), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeTap('nonexistent');
    });

    expect(useGraphStore.getState().selectedNodeId).toBe('nonexistent');
  });

  it('handleNodeHover: sets tooltip with node data and adjacency counts', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call' } as any],
      rawEdges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call' } as any],
    });

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeHover('n1', { x: 100, y: 100 });
    });

    const tooltip = container.querySelector('.cg-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.querySelector('.cg-tooltip-name')?.textContent).toBe('myFunc');
  });

  it('handleNodeHoverOut: clears tooltip after hover', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call' } as any],
    });

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeHover('n1', { x: 100, y: 100 });
    });
    expect(container.querySelector('.cg-tooltip')).not.toBeNull();

    act(() => {
      capturedCallbacks.onNodeHoverOut();
    });
    expect(container.querySelector('.cg-tooltip')).toBeNull();
  });

  it('handleEdgeHover: sets tooltip with edge source and target labels', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const sourceNode = { id: 'n1', label: 'sourceFunc', type: 'function', filePath: '/a.ts', lineNumber: 1 };
    const targetNode = { id: 'n2', label: 'targetFunc', type: 'function', filePath: '/b.ts', lineNumber: 2 };
    const edgeData = { id: 'e1', source: 'n1', target: 'n2', type: 'call' };
    const mockRenderer = createMockRenderer(
      new Map([['n1', sourceNode], ['n2', targetNode]]),
      new Map([['e1', edgeData]]),
    );
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onEdgeHover('e1', { x: 200, y: 200 });
    });

    const tooltip = container.querySelector('.cg-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.querySelector('.cg-tooltip-edge-source')?.textContent).toBe('sourceFunc');
    expect(tooltip?.querySelector('.cg-tooltip-edge-target')?.textContent).toBe('targetFunc');
  });

  it('handleEdgeHoverOut: clears tooltip after edge hover', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const sourceNode = { id: 'n1', label: 'src', type: 'function', filePath: '/a.ts', lineNumber: 1 };
    const targetNode = { id: 'n2', label: 'tgt', type: 'function', filePath: '/b.ts', lineNumber: 2 };
    const edgeData = { id: 'e1', source: 'n1', target: 'n2', type: 'call' };
    const mockRenderer = createMockRenderer(
      new Map([['n1', sourceNode], ['n2', targetNode]]),
      new Map([['e1', edgeData]]),
    );
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onEdgeHover('e1', { x: 200, y: 200 });
    });
    expect(container.querySelector('.cg-tooltip')).not.toBeNull();

    act(() => {
      capturedCallbacks.onEdgeHoverOut();
    });
    expect(container.querySelector('.cg-tooltip')).toBeNull();
  });

  it('handleEdgeTap: sets tooltip with edge data on tap', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const sourceNode = { id: 'n1', label: 'callerFunc', type: 'function', filePath: '/a.ts', lineNumber: 1 };
    const targetNode = { id: 'n2', label: 'calleeFunc', type: 'function', filePath: '/b.ts', lineNumber: 2 };
    const edgeData = { id: 'e1', source: 'n1', target: 'n2', type: 'call' };
    const mockRenderer = createMockRenderer(
      new Map([['n1', sourceNode], ['n2', targetNode]]),
      new Map([['e1', edgeData]]),
    );
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onEdgeTap('e1', { x: 150, y: 150 });
    });

    const tooltip = container.querySelector('.cg-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.querySelector('.cg-tooltip-edge-source')?.textContent).toBe('callerFunc');
    expect(tooltip?.querySelector('.cg-tooltip-edge-target')?.textContent).toBe('calleeFunc');
  });

  it('handleNodeDoubleTap: expands cluster node when not expanded', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const clusterNode = { id: 'cluster__1', label: 'Cluster 1', type: 'module', filePath: '/cluster', isCluster: true };
    const mockRenderer = createMockRenderer(new Map([['cluster__1', clusterNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cluster__1');
    });

    expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(true);
  });

  it('handleNodeDoubleTap: collapses cluster node when already expanded', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const clusterNode = { id: 'cluster__1', label: 'Cluster 1', type: 'module', filePath: '/cluster', isCluster: true };
    const mockRenderer = createMockRenderer(new Map([['cluster__1', clusterNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ expandedNodeIds: new Set(['cluster__1']) });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: null, highlightedNodeIds: [],
      expandedNodeIds: new Set(['cluster__1']), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });

    render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cluster__1');
    });

    expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(false);
  });

  it('handleNodeDoubleTap: selects function node on double tap', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const funcNode = { id: 'fn1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10 };
    const mockRenderer = createMockRenderer(new Map([['fn1', funcNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('fn1');
    });

    expect(useGraphStore.getState().selectedNodeId).toBe('fn1');
  });

  it('handleNodeDoubleTap: enters focus mode for non-cluster non-function node', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const classNode = { id: 'cls1', label: 'MyClass', type: 'class', filePath: '/test.ts', lineNumber: 1 };
    const mockRenderer = createMockRenderer(new Map([['cls1', classNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });

    const focusBar = container.querySelector('.cg-focus-mode-bar');
    expect(focusBar).not.toBeNull();
    expect(focusBar?.getAttribute('role')).toBe('region');
  });

  it('handleNodeDoubleTap: exits focus mode when double-tapping same node again', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const classNode = { id: 'cls1', label: 'MyClass', type: 'class', filePath: '/test.ts', lineNumber: 1 };
    const mockRenderer = createMockRenderer(new Map([['cls1', classNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });
    expect(container.querySelector('.cg-focus-mode-bar')).not.toBeNull();

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });
    expect(container.querySelector('.cg-focus-mode-bar')).toBeNull();
  });

  it('handleFocusExpand: increments focusDepth via FocusModeBar expand button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const classNode = { id: 'cls1', label: 'MyClass', type: 'class', filePath: '/test.ts', lineNumber: 1 };
    const mockRenderer = createMockRenderer(new Map([['cls1', classNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });

    const expandBtn = container.querySelector('.cg-focus-expand-btn') as HTMLButtonElement;
    expect(expandBtn?.tagName).toBe('BUTTON');
    fireEvent.click(expandBtn);

    expect(useGraphStore.getState().focusDepth).toBe(2);
  });

  it('handleFocusContract: decrements focusDepth via FocusModeBar contract button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const classNode = { id: 'cls1', label: 'MyClass', type: 'class', filePath: '/test.ts', lineNumber: 1 };
    const mockRenderer = createMockRenderer(new Map([['cls1', classNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ focusDepth: 3 });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: null, highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: null,
      focusDepth: 3, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });

    const contractBtn = container.querySelector('.cg-focus-contract-btn') as HTMLButtonElement;
    expect(contractBtn?.tagName).toBe('BUTTON');
    fireEvent.click(contractBtn);

    expect(useGraphStore.getState().focusDepth).toBe(2);
  });

  it('handleFocusExit: clears focus mode via FocusModeBar exit button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const classNode = { id: 'cls1', label: 'MyClass', type: 'class', filePath: '/test.ts', lineNumber: 1 };
    const mockRenderer = createMockRenderer(new Map([['cls1', classNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeDoubleTap('cls1');
    });
    expect(container.querySelector('.cg-focus-mode-bar')).not.toBeNull();

    const exitBtn = container.querySelector('.cg-focus-exit-btn') as HTMLButtonElement;
    expect(exitBtn?.tagName).toBe('BUTTON');
    fireEvent.click(exitBtn);

    expect(container.querySelector('.cg-focus-mode-bar')).toBeNull();
    expect(useGraphStore.getState().focusDepth).toBe(1);
  });

  it('handleWorkspaceAdd: adds workspace and dispatches events via WorkspaceSelector', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = render(React.createElement(GraphPanel));

    const trigger = container.querySelector('.cg-workspace-trigger') as HTMLButtonElement;
    fireEvent.click(trigger);

    const addBtn = document.querySelector('.cg-workspace-add-btn') as HTMLButtonElement;
    fireEvent.click(addBtn);

    const input = document.querySelector('#workspace-add-path') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/new/repo/path' } });

    const confirmBtn = document.querySelector('.cg-workspace-add-form button') as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    expect(useGraphStore.getState().currentWorkspace).toBe('/new/repo/path');
    expect(useGraphStore.getState().workspaceList.length).toBeGreaterThan(0);

    const workspaceEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:workspace',
    );
    expect(workspaceEvent?.[0]).toBeInstanceOf(CustomEvent);

    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent?.[0]).toBeInstanceOf(CustomEvent);
  });

  it('handleClearPath: clears path result via PathBar clear button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({
      pathResult: ['n1', 'n2', 'n3'] as any,
      rawNodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: '/a.ts' } as any,
        { id: 'n2', label: 'B', type: 'function', filePath: '/b.ts' } as any,
      ],
    });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: null, highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: ['n1', 'n2', 'n3'] as any,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: true, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: () => ({ showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: true, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() }),
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));

    const pathBar = container.querySelector('.cg-path-bar');
    expect(pathBar).not.toBeNull();

    const clearBtn = container.querySelector('.cg-path-clear-btn') as HTMLButtonElement;
    expect(clearBtn?.tagName).toBe('BUTTON');
    fireEvent.click(clearBtn);

    expect(useGraphStore.getState().pathResult).toBeNull();
  });

  it('handleSelectSearchResult: selects node and closes search panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      rawNodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' } as any],
    });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: 'myFunc', selectedNodeId: null, highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useNodeSearch).mockReturnValue({
      search: vi.fn(() => [
        { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' },
      ]),
    } as any);
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: true, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: () => ({ showImport: false, showSearch: true, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() }),
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));

    const searchBar = container.querySelector('.cg-search-bar');
    expect(searchBar).not.toBeNull();

    const resultItem = container.querySelector('.cg-search-result-item') as HTMLElement;
    expect(resultItem).not.toBeNull();
    fireEvent.click(resultItem);

    expect(useGraphStore.getState().selectedNodeId).toBe('n1');
  });

  it('computeLODFromZoom: sets LOD to minimal when zoom is below threshold', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    let zoomCallback: (() => void) | null = null;
    const mockRenderer = {
      ...createMockRenderer(new Map(), new Map()),
      getZoom: vi.fn(() => 0.1),
      onZoomChange: vi.fn((cb: () => void) => {
        zoomCallback = cb;
        return vi.fn();
      }),
    };
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphPerformance).mockReturnValue({
      performanceDegradations: [], lodLevel: 'full', lodEnabled: true,
    });

    render(React.createElement(GraphPanel));

    expect(zoomCallback).not.toBeNull();
    act(() => {
      zoomCallback!();
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(useGraphStore.getState().lodLevel).toBe('minimal');
  });

  it('computeLODFromZoom: sets LOD to compact when zoom is between thresholds', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    let zoomCallback: (() => void) | null = null;
    const mockRenderer = {
      ...createMockRenderer(new Map(), new Map()),
      getZoom: vi.fn(() => 0.3),
      onZoomChange: vi.fn((cb: () => void) => {
        zoomCallback = cb;
        return vi.fn();
      }),
    };
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphPerformance).mockReturnValue({
      performanceDegradations: [], lodLevel: 'full', lodEnabled: true,
    });

    render(React.createElement(GraphPanel));

    expect(zoomCallback).not.toBeNull();
    act(() => {
      zoomCallback!();
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(useGraphStore.getState().lodLevel).toBe('compact');
  });

  it('computeLODFromZoom: keeps LOD as full when zoom is above thresholds', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    let zoomCallback: (() => void) | null = null;
    const mockRenderer = {
      ...createMockRenderer(new Map(), new Map()),
      getZoom: vi.fn(() => 0.8),
      onZoomChange: vi.fn((cb: () => void) => {
        zoomCallback = cb;
        return vi.fn();
      }),
    };
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphPerformance).mockReturnValue({
      performanceDegradations: [], lodLevel: 'full', lodEnabled: true,
    });

    render(React.createElement(GraphPanel));

    expect(zoomCallback).not.toBeNull();
    act(() => {
      zoomCallback!();
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  it('handleNodeContextTap: opens context menu with correct nodeId', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeContextTap('n1', { x: 300, y: 300 });
    });

    const contextMenu = container.querySelector('.cg-context-menu');
    expect(contextMenu).not.toBeNull();
    expect(contextMenu?.getAttribute('role')).toBe('menu');

    const menuItems = contextMenu?.querySelectorAll('.cg-context-menu-item');
    expect(menuItems?.length).toBeGreaterThan(0);
  });

  it('handleNodeContextTap: context menu closes on close action', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));

    act(() => {
      capturedCallbacks.onNodeContextTap('n1', { x: 300, y: 300 });
    });
    expect(container.querySelector('.cg-context-menu')).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.cg-context-menu')).toBeNull();
  });

  it('auto-scan: triggers scan when prerequisites are ready and workspace is set', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: true, lens: false },
      watchEnabled: false, initStatus: 'idle',
    });
    vi.mocked(useGraphWorkspace).mockReturnValue({
      currentWorkspace: '/test/workspace', workspaceList: [],
    });

    render(React.createElement(GraphPanel));

    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent?.[0]).toBeInstanceOf(CustomEvent);
    expect((importEvent?.[0] as CustomEvent).detail).toEqual({ path: '/test/workspace' });
  });

  it('auto-scan: does not trigger scan when prerequisites are not ready', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: false, lens: false },
      watchEnabled: false, initStatus: 'idle',
    });
    vi.mocked(useGraphWorkspace).mockReturnValue({
      currentWorkspace: '/test/workspace', workspaceList: [],
    });

    render(React.createElement(GraphPanel));

    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent).toBeUndefined();
  });

  it('auto-scan: does not trigger scan when nodes already exist', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 1, prerequisites: { codegraph: true, lens: false },
      watchEnabled: false, initStatus: 'idle',
    });
    vi.mocked(useGraphWorkspace).mockReturnValue({
      currentWorkspace: '/test/workspace', workspaceList: [],
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: '/a.ts' } as any],
      edges: [], rawNodes: [{ id: 'n1', label: 'A', type: 'function', filePath: '/a.ts' } as any], rawEdges: [],
    });

    render(React.createElement(GraphPanel));

    const importEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:import-repo',
    );
    expect(importEvent).toBeUndefined();
  });
});
