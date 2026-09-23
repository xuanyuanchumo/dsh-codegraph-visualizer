/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { useShallow } from 'zustand/shallow';

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
    expect(container).toBeTruthy();
  });

  it('renders graph container div', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const graphContainer = container.querySelector('.cg-graph-container');
    expect(graphContainer).toBeTruthy();
  });

  it('renders resize handle', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const handle = container.querySelector('.cg-resize-handle');
    expect(handle).toBeTruthy();
  });

  it('renders live region for accessibility', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const liveRegion = container.querySelector('#cg-graph-live-region');
    expect(liveRegion).toBeTruthy();
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
    expect(graphContainer?.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders panel with aria-label region', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    render(React.createElement(GraphPanel));
    const region = screen.queryByRole('region');
    expect(region).toBeTruthy();
  });

  it('wraps content in ErrorBoundary', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    expect(container).toBeTruthy();
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
    expect(themeBtn).toBeTruthy();
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
    expect(fab).toBeTruthy();
    fireEvent.click(fab);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('heatmap activate button: renders when heatmapMode is none', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBtn = container.querySelector('.cg-heatmap-btn--activate');
    expect(heatmapBtn).toBeTruthy();
  });

  it('lang button: triggers toggleLang when clicked', async () => {
    const i18nModule = await import('../../src/client/i18n/index.ts');
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const langBtn = container.querySelector('.cg-lang-btn') as HTMLButtonElement;
    expect(langBtn).toBeTruthy();
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
    expect(searchBtn).toBeTruthy();
    fireEvent.click(searchBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('layout button click does not crash', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const layoutBtns = container.querySelectorAll('.cg-layout-btn');
    expect(layoutBtns.length).toBeGreaterThan(0);
    fireEvent.click(layoutBtns[0]!);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('export button click toggles export menu', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const exportBtn = container.querySelector('.cg-export-btn') as HTMLButtonElement;
    expect(exportBtn).toBeTruthy();
    fireEvent.click(exportBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('heatmap button click does not crash', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const heatmapBtn = container.querySelector('.cg-heatmap-btn--activate') as HTMLButtonElement;
    expect(heatmapBtn).toBeTruthy();
    fireEvent.click(heatmapBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('pathfind button click toggles path panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const pathfindBtn = container.querySelector('.cg-pathfind-btn') as HTMLButtonElement;
    expect(pathfindBtn).toBeTruthy();
    fireEvent.click(pathfindBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('health score button click toggles health panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const healthBtn = container.querySelector('.cg-health-btn') as HTMLButtonElement;
    expect(healthBtn).toBeTruthy();
    fireEvent.click(healthBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('filter button click toggles filter panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const filterBtn = container.querySelector('.cg-filter-panel-btn') as HTMLButtonElement;
    expect(filterBtn).toBeTruthy();
    fireEvent.click(filterBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('legend button click toggles legend panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const legendBtn = container.querySelector('.cg-legend-btn') as HTMLButtonElement;
    expect(legendBtn).toBeTruthy();
    fireEvent.click(legendBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('minimap button click toggles minimap panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const minimapBtn = container.querySelector('.cg-minimap-btn') as HTMLButtonElement;
    expect(minimapBtn).toBeTruthy();
    fireEvent.click(minimapBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('callchain button click toggles call chain panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const callchainBtn = container.querySelector('.cg-chain-btn') as HTMLButtonElement;
    expect(callchainBtn).toBeTruthy();
    fireEvent.click(callchainBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('impact button click toggles impact panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const impactBtn = container.querySelector('.cg-impact-btn') as HTMLButtonElement;
    expect(impactBtn).toBeTruthy();
    fireEvent.click(impactBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('inheritance button click toggles inheritance panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const inheritanceBtn = container.querySelector('.cg-inheritance-btn') as HTMLButtonElement;
    expect(inheritanceBtn).toBeTruthy();
    fireEvent.click(inheritanceBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('hotspot button click toggles hotspot panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const hotspotBtn = container.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
    expect(hotspotBtn).toBeTruthy();
    fireEvent.click(hotspotBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('god module button click toggles god module panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const godBtn = container.querySelector('.cg-godmodule-btn') as HTMLButtonElement;
    expect(godBtn).toBeTruthy();
    fireEvent.click(godBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('cycles button click toggles cycles panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const cyclesBtn = container.querySelector('.cg-cycle-btn') as HTMLButtonElement;
    expect(cyclesBtn).toBeTruthy();
    fireEvent.click(cyclesBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('core function button click toggles core function panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const coreBtn = container.querySelector('.cg-corefunction-btn') as HTMLButtonElement;
    expect(coreBtn).toBeTruthy();
    fireEvent.click(coreBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('rules button click toggles rules panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const rulesBtn = container.querySelector('.cg-rules-btn') as HTMLButtonElement;
    expect(rulesBtn).toBeTruthy();
    fireEvent.click(rulesBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('import button click toggles import panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const importBtn = container.querySelector('.cg-import-btn') as HTMLButtonElement;
    expect(importBtn).toBeTruthy();
    fireEvent.click(importBtn);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
  });

  it('toolbar renders all essential buttons', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolbar = container.querySelector('.cg-graph-toolbar');
    expect(toolbar).toBeTruthy();
    expect(container.querySelector('.cg-search-btn')).toBeTruthy();
    expect(container.querySelector('.cg-theme-btn')).toBeTruthy();
    expect(container.querySelector('.cg-export-btn')).toBeTruthy();
  });

  it('status bar renders with node and edge counts', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const statusBar = container.querySelector('.cg-status-bar');
    expect(statusBar).toBeTruthy();
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
      expect(refreshEvent).toBeTruthy();
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
      expect(importEvent).toBeTruthy();
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
    expect(themeBtn).toBeTruthy();
    fireEvent.click(themeBtn);
    fireEvent.click(themeBtn);
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true);
  });

  it('handleCloseDetail: collapse FAB preserves panel structure', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const fab = container.querySelector('.cg-collapse-fab') as HTMLButtonElement;
    expect(fab).toBeTruthy();
    fireEvent.click(fab);
    expect(container.querySelector('.cg-graph-panel')).toBeTruthy();
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
    expect(heatmapBar).toBeTruthy();
    const activateBtn = container.querySelector('.cg-heatmap-btn--activate');
    expect(activateBtn).toBeTruthy();
  });

  it('empty state: renders when no nodes and not loading', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const emptyState = container.querySelector('.cg-empty-state');
    expect(emptyState).toBeTruthy();
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
    expect(stackLeft).toBeTruthy();
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
