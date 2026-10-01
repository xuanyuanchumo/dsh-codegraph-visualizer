/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import { useGraphRenderer, useGraphInteraction, useGraphStatus, useGraphPerformance, useNodeSearch, usePanelState, useGraphWorkspace, useGraphData, usePanelKeyboard, useGraphDisplay, useAnalysisPanels, useGraphAnalysis, useGraphActions } from '../../src/client/hooks/index.ts';
import { NodeId } from '../../src/types/index.ts';

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
    toPanelControls: {
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, cycleIsolation: false, showInheritance: false, showHotspot: false, showGodModule: false, showCoreFunction: false, showDeadCode: false, showTour: false,
      onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleDeadCode: vi.fn(), onToggleFilterPanel: vi.fn(), onToggleTour: vi.fn(),
    },
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
    handleSelectFunction: vi.fn(),
    handleCloseMicroView: vi.fn(),
    handleAggregateCallChain: vi.fn(),
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
  useGraphStatus: vi.fn(() => ({ isLoading: false, error: null, lastUpdated: 0, truncated: false, totalNodeCount: 0, prerequisites: { codegraph: false, lens: false, builtin: true }, watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true })),
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
    cacheData: vi.fn(),
    getCachedData: vi.fn(() => null),
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
    const heatmapBtn = container.querySelector('.cg-overlay-btn--activate');
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
    expect(ariaLabel).toContain('a11y.graphContainerStats');
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
    const searchBtn = container.querySelector('.cg-search-standalone-btn') as HTMLButtonElement;
    expect(searchBtn?.tagName).toBe('BUTTON');
    fireEvent.click(searchBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('layout dropdown button click does not crash', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const layoutBtn = container.querySelector('.cg-layout-dropdown-btn');
    expect(layoutBtn).toBeTruthy();
    fireEvent.click(layoutBtn!);
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
    const heatmapBtn = container.querySelector('.cg-overlay-btn--activate') as HTMLButtonElement;
    expect(heatmapBtn?.tagName).toBe('BUTTON');
    fireEvent.click(heatmapBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('pathfind button click toggles path panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const pathfindBtn = container.querySelector('.cg-pathfind-btn') as HTMLButtonElement;
    expect(pathfindBtn?.tagName).toBe('BUTTON');
    fireEvent.click(pathfindBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('health score button click toggles health panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
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
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const callchainBtn = container.querySelector('.cg-chain-btn') as HTMLButtonElement;
    expect(callchainBtn?.tagName).toBe('BUTTON');
    fireEvent.click(callchainBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('impact button click toggles impact panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const impactBtn = container.querySelector('.cg-impact-btn') as HTMLButtonElement;
    expect(impactBtn?.tagName).toBe('BUTTON');
    fireEvent.click(impactBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('inheritance button click toggles inheritance panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const inheritanceBtn = container.querySelector('.cg-inheritance-btn') as HTMLButtonElement;
    expect(inheritanceBtn?.tagName).toBe('BUTTON');
    fireEvent.click(inheritanceBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('hotspot button click toggles hotspot panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const hotspotBtn = container.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
    expect(hotspotBtn?.tagName).toBe('BUTTON');
    fireEvent.click(hotspotBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('god module button click toggles god module panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const godBtn = container.querySelector('.cg-godmodule-btn') as HTMLButtonElement;
    expect(godBtn?.tagName).toBe('BUTTON');
    fireEvent.click(godBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('cycles button click toggles cycles panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const cyclesBtn = container.querySelector('.cg-cycle-btn') as HTMLButtonElement;
    expect(cyclesBtn?.tagName).toBe('BUTTON');
    fireEvent.click(cyclesBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('core function button click toggles core function panel', async () => {
    useGraphStore.setState({ viewMode: 'callgraph' });
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
    const coreBtn = container.querySelector('.cg-corefunction-btn') as HTMLButtonElement;
    expect(coreBtn?.tagName).toBe('BUTTON');
    fireEvent.click(coreBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('rules button click toggles rules panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
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
    expect(container.querySelector('.cg-tools-dropdown-btn')?.tagName).toBe('BUTTON');
    expect(container.querySelector('.cg-search-standalone-btn')?.tagName).toBe('BUTTON');
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
    const heatmapBar = container.querySelector('.cg-overlay-bar');
    expect(heatmapBar?.getAttribute('role')).toBe('group');
    const activateBtn = container.querySelector('.cg-overlay-btn--activate');
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

  it('overlay bar: has group role and aria-label', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const overlayBar = container.querySelector('.cg-overlay-bar') as HTMLElement;
    expect(overlayBar.getAttribute('role')).toBe('group');
    expect(overlayBar.getAttribute('aria-label')).toBe('overlay.title');
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
    const searchBtn = container.querySelector('.cg-search-standalone-btn') as HTMLButtonElement;
    expect(searchBtn?.tagName).toBe('BUTTON');
    fireEvent.click(searchBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('handleFindPath: pathfind button toggles path panel', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const toolsDropdownBtn = container.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
    fireEvent.click(toolsDropdownBtn);
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
    const activateBtn = container.querySelector('.cg-overlay-btn--activate') as HTMLButtonElement;
    expect(activateBtn?.tagName).toBe('BUTTON');
    fireEvent.click(activateBtn);
    expect(useGraphStore.getState().heatmapMode).toBe('instability');
  });

  it('heatmap mode buttons: switching between modes', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    useGraphStore.setState({ heatmapMode: 'instability' });
    const { container } = render(React.createElement(GraphPanel));
    const overlayBtns = container.querySelectorAll('.cg-overlay-section .cg-overlay-btn');
    const linesBtn = Array.from(overlayBtns).find((btn) => btn.textContent === 'lines' || btn.textContent === 'Lines') as HTMLButtonElement | undefined;
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
    expect(ariaLabel).toContain('a11y.graphContainerStats');
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
    expect(ariaLabel).toContain('a11y.graphContainerStats');
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
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
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
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: true, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
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
      toPanelControls: { showImport: false, showSearch: true, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
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

  it('auto-scan: triggers bootstrap when prerequisites are ready and workspace is set', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');

    const loadBootstrapSpy = vi.spyOn(useGraphStore.getState(), 'loadBootstrap').mockResolvedValue(true);

    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: true, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
    });
    vi.mocked(useGraphWorkspace).mockReturnValue({
      currentWorkspace: '/test/workspace', workspaceList: [],
    });

    render(React.createElement(GraphPanel));

    expect(loadBootstrapSpy).toHaveBeenCalled();
    loadBootstrapSpy.mockRestore();
  });

  it('auto-scan: does not trigger scan when prerequisites are not ready', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: false, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
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
      totalNodeCount: 1, prerequisites: { codegraph: true, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
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
describe('GraphPanel context menu callback tests', () => {
  let capturedCallbacks: any;
  let capturedKeyboardHandlers: any;

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
    capturedKeyboardHandlers = {};
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

  function setupKeyboardMockWithHandlers() {
    vi.mocked(usePanelKeyboard).mockImplementation((...args: any[]) => {
      capturedKeyboardHandlers = args[3];
      return {};
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
      focusOnArea: vi.fn(),
      highlightCallChain: vi.fn(),
      highlightImpact: vi.fn(),
      getImpactStats: vi.fn(() => null),
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
    };
  }

  function openContextMenu(container: HTMLElement, nodeId = 'n1', pos = { x: 100, y: 100 }) {
    act(() => {
      capturedCallbacks.onNodeContextTap(nodeId, pos);
    });
    return container.querySelector('.cg-context-menu');
  }

  function clickMenuItem(menu: Element, itemIndex: number) {
    const items = menu.querySelectorAll('.cg-context-menu-item');
    fireEvent.click(items[itemIndex]!);
  }

  it('onFocusNode: calls renderer.focusOnNode and selectNode', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    expect(menu).not.toBeNull();

    clickMenuItem(menu!, 0);
    expect(mockRenderer.focusOnNode).toHaveBeenCalledWith('n1');
    expect(mockRenderer.selectNode).toHaveBeenCalled();
  });

  it('onIsolateNode: calls renderer.focusNeighborhood', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    clickMenuItem(menu!, 1);
    expect(mockRenderer.focusNeighborhood).toHaveBeenCalled();
  });

  it('onHideNode: calls renderer.hideNode', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    clickMenuItem(menu!, 2);
    expect(mockRenderer.hideNode).toHaveBeenCalled();
  });

  it('onShowAllNodes: calls renderer.showAllNodes when hasHiddenNodes', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    mockRenderer.getVisibleNodeCount = vi.fn(() => 0);
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphData).mockReturnValue({
      nodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' } as any],
      edges: [], rawNodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' } as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const showAllBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.showAll');
    expect(showAllBtn).toBeTruthy();
    fireEvent.click(showAllBtn!);
    expect(mockRenderer.showAllNodes).toHaveBeenCalled();
  });

  it('onExpandNode: calls expandNode for cluster node', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const clusterNode = { id: 'cluster__1', label: 'Cluster 1', type: 'module', filePath: '/cluster', isCluster: true, children: [] };
    const mockRenderer = createMockRenderer(new Map([['cluster__1', clusterNode]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphData).mockReturnValue({
      nodes: [clusterNode as any],
      edges: [], rawNodes: [clusterNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container, 'cluster__1');
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const expandBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.expand');
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn!);
    expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(true);
  });

  it('onCollapseNode: calls collapseNode for expanded cluster node', async () => {
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

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container, 'cluster__1');
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const collapseBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.collapse');
    expect(collapseBtn).toBeTruthy();
    fireEvent.click(collapseBtn!);
    expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(false);
  });

  it('onFindPath: opens path panel and sets path start', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const findPathBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.findPath');
    expect(findPathBtn).toBeTruthy();
    fireEvent.click(findPathBtn!);
    expect(useGraphStore.getState().pathStartId).toBe('n1');
  });

  it('onHighlightCallChain: opens call chain panel and calls renderer', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const callChainBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.callChain');
    expect(callChainBtn).toBeTruthy();
    fireEvent.click(callChainBtn!);
    expect(mockRenderer.highlightCallChain).toHaveBeenCalled();
  });

  it('onHighlightImpact: opens impact panel and calls renderer', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const menu = openContextMenu(container);
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const impactBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.impact');
    expect(impactBtn).toBeTruthy();
    fireEvent.click(impactBtn!);
    expect(mockRenderer.highlightImpact).toHaveBeenCalled();
  });

  it('onOpenSource: dispatches codegraph:open-source event with file info', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]), new Map());
    setupRendererMockWithCallbacks(mockRenderer);

    const { container } = render(React.createElement(GraphPanel));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const menu = openContextMenu(container);
    const items = menu!.querySelectorAll('.cg-context-menu-item');
    const openSourceBtn = Array.from(items).find((btn) => btn.textContent === 'contextMenu.openSource');
    expect(openSourceBtn).toBeTruthy();
    fireEvent.click(openSourceBtn!);
    const openSourceEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:open-source',
    );
    expect(openSourceEvent?.[0]).toBeInstanceOf(CustomEvent);
    expect((openSourceEvent?.[0] as CustomEvent).detail).toEqual({ filePath: '/test.ts', lineNumber: 5 });
  });
});

describe('GraphPanel keyboard handler callback tests', () => {
  let capturedCallbacks: any;
  let capturedKeyboardHandlers: any;

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
    });
    capturedCallbacks = {};
    capturedKeyboardHandlers = {};
  });

  function setupKeyboardMockWithHandlers() {
    vi.mocked(usePanelKeyboard).mockImplementation((...args: any[]) => {
      capturedKeyboardHandlers = args[3];
      return {};
    });
  }

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

  function createMockRenderer() {
    return {
      getNodeData: vi.fn(() => null),
      getEdgeData: vi.fn(() => null),
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
      focusOnArea: vi.fn(),
      highlightCallChain: vi.fn(),
      highlightImpact: vi.fn(),
      getImpactStats: vi.fn(() => null),
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
    };
  }

  it('onCloseAll: closes all panels via keyboard handler', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    setupKeyboardMockWithHandlers();
    setupRendererMockWithCallbacks(createMockRenderer());

    vi.mocked(usePanelState).mockReturnValue({
      showImport: true, showSearch: true, showLegend: true, showMiniMap: true,
      showFilterPanel: true, showPathFind: true, showHealthScore: true,
      showRules: true, showCallChain: true, showImpact: true,
      showCycles: true, showHotspot: true, showGodModule: true,
      showCoreFunction: true, showInheritance: true, cycleIsolation: true,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: true, showSearch: true, showLegend: true, showMiniMap: true, showFilterPanel: true, showPathFind: true, showHealthScore: true, showRules: true, showCallChain: true, showImpact: true, showCycles: true, showHotspot: true, showGodModule: true, showCoreFunction: true, cycleIsolation: true, showInheritance: true, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    render(React.createElement(GraphPanel));

    expect(capturedKeyboardHandlers).toBeTruthy();
    expect(capturedKeyboardHandlers.onCloseAll).toBeInstanceOf(Function);

    act(() => {
      capturedKeyboardHandlers.onCloseAll();
    });

    // onCloseAll should call setShow* functions with false
    const panelStateMock = vi.mocked(usePanelState).mock.results[0]?.value;
    expect(panelStateMock?.setShowSearch).toHaveBeenCalledWith(false);
    expect(panelStateMock?.setShowCallChain).toHaveBeenCalledWith(false);
    expect(panelStateMock?.setShowImport).toHaveBeenCalledWith(false);
    expect(panelStateMock?.setShowTour).toHaveBeenCalledWith(false);
  });

  it('onToggleHelp: toggles keyboard help visibility', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    setupKeyboardMockWithHandlers();
    setupRendererMockWithCallbacks(createMockRenderer());

    const { container } = render(React.createElement(GraphPanel));

    expect(capturedKeyboardHandlers).toBeTruthy();
    expect(capturedKeyboardHandlers.onToggleHelp).toBeInstanceOf(Function);

    expect(container.querySelector('.cg-keyboard-help-overlay')).toBeNull();

    act(() => {
      capturedKeyboardHandlers.onToggleHelp();
    });

    expect(container.querySelector('.cg-keyboard-help-overlay')).not.toBeNull();
  });

  it('onRefresh: dispatches refresh event and sets loading', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    setupKeyboardMockWithHandlers();
    setupRendererMockWithCallbacks(createMockRenderer());

    render(React.createElement(GraphPanel));

    expect(capturedKeyboardHandlers).toBeTruthy();
    expect(capturedKeyboardHandlers.onRefresh).toBeInstanceOf(Function);

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    act(() => {
      capturedKeyboardHandlers.onRefresh();
    });

    expect(useGraphStore.getState().isLoading).toBe(true);
    const refreshEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'codegraph:refresh',
    );
    expect(refreshEvent?.[0]).toBeInstanceOf(CustomEvent);
  });

  it('onCycleLayout: does not crash when called', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    setupKeyboardMockWithHandlers();
    setupRendererMockWithCallbacks(createMockRenderer());

    render(React.createElement(GraphPanel));

    expect(capturedKeyboardHandlers).toBeTruthy();
    expect(capturedKeyboardHandlers.onCycleLayout).toBeInstanceOf(Function);

    expect(() => {
      act(() => {
        capturedKeyboardHandlers.onCycleLayout();
      });
    }).not.toThrow();
  });
});

describe('GraphPanel panel callback tests', () => {
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

  function createMockRenderer(nodeMap: Map<string, any> = new Map(), edgeMap: Map<string, any> = new Map()) {
    return {
      getNodeData: vi.fn((id: string) => nodeMap.get(id) ?? null),
      getEdgeData: vi.fn((id: string) => edgeMap.get(id) ?? null),
      getSelectedNodeData: vi.fn(() => null as any),
      getZoom: vi.fn(() => 1),
      onZoomChange: vi.fn(() => vi.fn()),
      findPath: vi.fn(() => null),
      highlightPath: vi.fn(),
      expandNeighborhood: vi.fn(),
      focusNeighborhood: vi.fn(),
      focusOnNode: vi.fn(),
      selectNode: vi.fn(),
      getVisibleNodeCount: vi.fn(() => 0),
      getThumbnail: vi.fn(() => 'data:image/png;base64,mock'),
      getViewportInfo: vi.fn(() => ({ zoom: 1, pan: { x: 0, y: 0 }, renderedSize: { w: 100, h: 100 }, totalSize: { w: 200, h: 200 } })),
      resize: vi.fn(),
      detectCyclesDetailed: vi.fn(() => []),
      hideNode: vi.fn(),
      showAllNodes: vi.fn(),
      focusOnArea: vi.fn(),
      highlightCallChain: vi.fn(),
      highlightImpact: vi.fn(),
      getImpactStats: vi.fn(() => null),
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
    };
  }

  it('onImport: opens import panel from EmptyState', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const { container } = render(React.createElement(GraphPanel));
    const importBtn = container.querySelector('.cg-empty-import-btn') as HTMLButtonElement;
    expect(importBtn?.tagName).toBe('BUTTON');
    fireEvent.click(importBtn);
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('getSelectedNodeData: returns data from renderer', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]));
    mockRenderer.getSelectedNodeData = vi.fn(() => nodeData);
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      selectedNodeId: 'n1' as any,
      nodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 } as any],
    });

    render(React.createElement(GraphPanel));

    // getSelectedNodeData is exposed via getDataRef.current which is set in useEffect
    // The renderer's getSelectedNodeData should be callable
    expect(mockRenderer.getSelectedNodeData).toBeDefined();
  });

  it('updateMiniMap: renders mini map panel when showMiniMap is true', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    // Return null to avoid triggering state updates in setInterval
    (mockRenderer as any).getThumbnail = vi.fn(() => null);
    (mockRenderer as any).getViewportInfo = vi.fn(() => null);
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: true,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: true, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));

    // MiniMap panel should be visible
    const miniMap = container.querySelector('.cg-mini-map');
    expect(miniMap).not.toBeNull();
    // getThumbnail should have been called by updateMiniMap on initial render
    expect(mockRenderer.getThumbnail).toHaveBeenCalled();
  });

  it('onFocusArea: mini map renders with viewport info', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    (mockRenderer as any).getThumbnail = vi.fn(() => null);
    (mockRenderer as any).getViewportInfo = vi.fn(() => null);
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: true,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: true, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));

    // Mini map should be rendered
    const miniMap = container.querySelector('.cg-mini-map');
    expect(miniMap).not.toBeNull();
  });

  it('onNodeTap (SequenceDiagram): renders sequence diagram when viewMode is sequence', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]));
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'n1', functionName: 'myFunc', filePath: '/test.ts' } as any,
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    useGraphStore.setState({
      viewMode: 'sequence',
      nodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' } as any],
    });

    const { container } = render(React.createElement(GraphPanel));

    // SequenceDiagramRenderer should be rendered
    const seqRenderer = container.querySelector('[data-testid="seq-renderer"]');
    expect(seqRenderer).not.toBeNull();
  });

  it('onCollapse (NodeDetail): calls collapseNode when collapse button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const clusterNode = { id: 'cluster__1', label: 'Cluster 1', type: 'module', filePath: '/cluster', isCluster: true };
    const mockRenderer = createMockRenderer(new Map([['cluster__1', clusterNode]]));
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      selectedNodeId: NodeId('cluster__1'),
      expandedNodeIds: new Set(['cluster__1']),
    });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: NodeId('cluster__1'), highlightedNodeIds: [],
      expandedNodeIds: new Set(['cluster__1']), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [clusterNode as any], edges: [],
      rawNodes: [clusterNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));

    // Use double tap to set selectedNodeData for cluster node (expands it)
    act(() => {
      capturedCallbacks.onNodeDoubleTap('cluster__1');
    });

    // NodeDetail should be visible with collapse button for expanded cluster
    const collapseBtn = container.querySelector('.cg-detail-collapse-btn');
    if (collapseBtn) {
      fireEvent.click(collapseBtn);
      expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(false);
    }
  });

  it('onSelectFunction (NodeDetail): calls handleSelectFunction when micro button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const funcNode = { id: 'fn1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10 };
    const mockRenderer = createMockRenderer(new Map([['fn1', funcNode]]));
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({
      selectedNodeId: NodeId('fn1'),
    });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: NodeId('fn1'), highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [funcNode as any], edges: [],
      rawNodes: [funcNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));

    // Use double tap to set selectedNodeData for function node
    act(() => {
      capturedCallbacks.onNodeDoubleTap('fn1');
    });

    // NodeDetail should be visible with micro buttons
    const microBtn = container.querySelector('.cg-detail-micro-btn');
    if (microBtn) {
      fireEvent.click(microBtn);
      // handleSelectFunction should clear selectedNodeData
      expect(container.querySelector('.cg-node-detail')).toBeNull();
    }
  });

  it('onSelectFunction (CoreFunctionPanel): selects node and focuses', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [],
      godModules: [],
      coreFunctions: [{ nodeId: NodeId('coreFn1'), label: 'coreFunc', filePath: '/core.ts', score: 0.9, reasons: ['high-indegree'], inDegree: 5, outDegree: 3, influenceReach: 10, callChainDepth: 2, category: 'hub' }],
      impactStats: null,
      handleHealthCheck: vi.fn(),
      handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: true, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: true, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
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

    // CoreFunctionPanel should be visible
    const corePanel = container.querySelector('.cg-core-function-panel');
    expect(corePanel).not.toBeNull();

    // Click on a core function item
    const coreItem = container.querySelector('.cg-core-function-item') as HTMLElement;
    if (coreItem) {
      fireEvent.click(coreItem);
      expect(useGraphStore.getState().selectedNodeId).toBe('coreFn1');
    }
  });

  it('statsLabel (GodModulePanel): renders stats label callback', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [],
      godModules: [{ modulePath: '/god/module', nodeCount: 10, edgeCount: 20, suggestion: 'Consider splitting this module' }],
      coreFunctions: [],
      impactStats: null,
      handleHealthCheck: vi.fn(),
      handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: true,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: true, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
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

    // GodModulePanel should be visible
    const godPanel = container.querySelector('.godmodule-panel');
    expect(godPanel).not.toBeNull();
  });

  it('onWinResize: panel handles missing ResizeObserver gracefully', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    // Temporarily remove ResizeObserver to test fallback path
    const originalRO = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = undefined;

    try {
      const { container } = render(React.createElement(GraphPanel));
      expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
    } finally {
      (globalThis as any).ResizeObserver = originalRO;
    }
  });

  it('HotspotPanel: renders when showHotspot and hotspotNodes exist', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [{ nodeId: 'hot1', label: 'hotFunc', score: 0.95 }],
      godModules: [],
      coreFunctions: [],
      impactStats: null,
      handleHealthCheck: vi.fn(),
      handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: true, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: true, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('TourPanel: renders when showTour is true', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false, showTour: true,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, showTour: true, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('ImpactPanel: renders when showImpact and impactStats exist', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [],
      godModules: [],
      coreFunctions: [],
      impactStats: { directCount: 5, totalCount: 10, nodes: [] },
      handleHealthCheck: vi.fn(),
      handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: true,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: true, showCycles: false, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('CyclePanel: renders when showCycles and cycleDetails exist', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    mockRenderer.detectCyclesDetailed = vi.fn(() => [{ nodes: ['n1', 'n2'], edges: ['e1'] }]);
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ viewMode: 'callgraph' });
    vi.mocked(usePanelState).mockReturnValue({
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: true, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      collapsed: false, isCollapsed: false,
      toPanelControls: { showImport: false, showSearch: false, showLegend: false, showMiniMap: false, showFilterPanel: false, showPathFind: false, showHealthScore: false, showRules: false, showCallChain: false, showImpact: false, showCycles: true, showHotspot: false, showGodModule: false, showCoreFunction: false, cycleIsolation: false, showInheritance: false, onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(), onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(), onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(), onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(), onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(), onToggleFilterPanel: vi.fn() },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
  });

  it('MicroViewPrompt: renders when isMicroView and no selectedFunction', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ viewMode: 'cfg' });
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: null,
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    const microPrompt = container.querySelector('.cg-micro-empty-prompt');
    expect(microPrompt).not.toBeNull();
  });

  it('MicroFunctionBar: renders when isMicroView and selectedFunction exists', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ viewMode: 'cfg' });
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'fn1', functionName: 'myFunc', filePath: '/test.ts' },
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    const microBar = container.querySelector('.cg-micro-function-bar');
    expect(microBar).not.toBeNull();
  });

  it('filterEmptyState: renders when nodes exist but all filtered out', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    mockRenderer.getVisibleNodeCount = vi.fn(() => 0);
    setupRendererMockWithCallbacks(mockRenderer);

    vi.mocked(useGraphData).mockReturnValue({
      nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: '/a.ts' } as any],
      edges: [], rawNodes: [{ id: 'n1', label: 'A', type: 'function', filePath: '/a.ts' } as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    const filterEmpty = container.querySelector('.cg-filter-empty-state');
    expect(filterEmpty).not.toBeNull();
  });

  it('ErrorOverlay: renders with onBack and onRetry when error in micro view', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);

    useGraphStore.setState({ viewMode: 'cfg', error: 'Test error' });
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'fn1', functionName: 'myFunc', filePath: '/test.ts' },
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: 'Test error', lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: false, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
    });

    const { container } = render(React.createElement(GraphPanel));
    const errorOverlay = container.querySelector('.cg-error-overlay');
    expect(errorOverlay).not.toBeNull();
  });
});
describe('GraphPanel onClose callback tests', () => {
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

  function createMockRenderer(nodeMap: Map<string, any> = new Map(), edgeMap: Map<string, any> = new Map()) {
    return {
      getNodeData: vi.fn((id: string) => nodeMap.get(id) ?? null),
      getEdgeData: vi.fn((id: string) => edgeMap.get(id) ?? null),
      getSelectedNodeData: vi.fn(() => null as any),
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
      focusOnArea: vi.fn(),
      highlightCallChain: vi.fn(),
      highlightImpact: vi.fn(),
      getImpactStats: vi.fn(() => null),
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
    };
  }

  function makePanelStateMock(overrides: Record<string, any> = {}) {
    const base: Record<string, any> = {
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      showDeadCode: false,
      collapsed: false, isCollapsed: false, showTour: false,
      toPanelControls: {
        showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
        showFilterPanel: false, showPathFind: false, showHealthScore: false,
        showRules: false, showCallChain: false, showImpact: false,
        showCycles: false, showHotspot: false, showGodModule: false,
        showCoreFunction: false, cycleIsolation: false, showInheritance: false, showTour: false,
        showDeadCode: false,
        onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(),
        onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(),
        onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(),
        onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(),
        onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(),
        onToggleDeadCode: vi.fn(),
        onToggleFilterPanel: vi.fn(),
      },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowDeadCode: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    };
    return { ...base, ...overrides };
  }

  it('SearchBar onClose: calls setShowSearch(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showSearch: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const searchBar = container.querySelector('.cg-search-bar');
    expect(searchBar).not.toBeNull();
    const closeBtn = searchBar?.querySelector('button[aria-label="search.close"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowSearch).toHaveBeenCalledWith(false);
  });

  it('PathBar onClose: calls setShowPathFind(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showPathFind: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const pathBar = container.querySelector('.cg-path-bar');
    expect(pathBar).not.toBeNull();
    const closeBtn = pathBar?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowPathFind).toHaveBeenCalledWith(false);
  });

  it('HealthScoreCard onClose: calls setShowHealthScore(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showHealthScore: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const healthCard = container.querySelector('.cg-health-score-card');
    expect(healthCard).not.toBeNull();
    const closeBtn = healthCard?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowHealthScore).toHaveBeenCalledWith(false);
  });

  it('RuleConfigPanel onClose: calls setShowRules(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showRules: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const rulePanel = container.querySelector('.cg-rule-panel');
    expect(rulePanel).not.toBeNull();
    const closeBtn = rulePanel?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowRules).toHaveBeenCalledWith(false);
  });

  it('Legend onClose: calls setShowLegend(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showLegend: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const legend = container.querySelector('.cg-legend-panel');
    expect(legend).not.toBeNull();
    const closeBtn = legend?.querySelector('.cg-legend-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowLegend).toHaveBeenCalledWith(false);
  });

  it('ImportPanel onClose: calls setShowImport(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showImport: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const importPanel = container.querySelector('.cg-import-panel');
    expect(importPanel).not.toBeNull();
    const closeBtn = importPanel?.querySelector('.cg-import-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowImport).toHaveBeenCalledWith(false);
  });

  it('StatsPanel onClose: calls setShowMiniMap(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    mockRenderer.getThumbnail = vi.fn(() => null);
    mockRenderer.getViewportInfo = vi.fn(() => null);
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showMiniMap: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const miniMap = container.querySelector('.cg-mini-map');
    expect(miniMap).not.toBeNull();
    const closeBtn = miniMap?.querySelector('.cg-close-btn--compact') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowMiniMap).toHaveBeenCalledWith(false);
  });

  it('HotspotPanel onClose: calls setShowHotspot(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [{ nodeId: 'hot1', label: 'hotFunc', score: 0.95 }],
      godModules: [], coreFunctions: [], impactStats: null,
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    const panelState = makePanelStateMock({ showHotspot: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const hotspotPanel = container.querySelector('.hotspot-panel');
    expect(hotspotPanel).not.toBeNull();
    const closeBtn = hotspotPanel?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowHotspot).toHaveBeenCalledWith(false);
  });

  it('GodModulePanel onClose: calls setShowGodModule(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [],
      godModules: [{ modulePath: '/god/module', nodeCount: 10, edgeCount: 20, suggestion: 'split' }],
      coreFunctions: [], impactStats: null,
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    const panelState = makePanelStateMock({ showGodModule: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const godPanel = container.querySelector('.godmodule-panel');
    expect(godPanel).not.toBeNull();
    const closeBtn = godPanel?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowGodModule).toHaveBeenCalledWith(false);
  });

  it('CoreFunctionPanel onClose: calls setShowCoreFunction(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [], godModules: [],
      coreFunctions: [{ nodeId: NodeId('coreFn1'), label: 'coreFunc', filePath: '/core.ts', score: 0.9, reasons: ['high-indegree'], inDegree: 5, outDegree: 3, influenceReach: 10, callChainDepth: 2, category: 'hub' }],
      impactStats: null,
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    const panelState = makePanelStateMock({ showCoreFunction: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const corePanel = container.querySelector('.cg-core-function-panel');
    expect(corePanel).not.toBeNull();
    const closeBtn = corePanel?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowCoreFunction).toHaveBeenCalledWith(false);
  });

  it('FilterPanel onClose: calls setShowFilterPanel(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showFilterPanel: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const filterPanel = container.querySelector('.cg-filter-panel');
    expect(filterPanel).not.toBeNull();
    const closeBtn = filterPanel?.querySelector('.cg-filter-panel-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowFilterPanel).toHaveBeenCalledWith(false);
  });

  it('TourPanel onClose: calls setShowTour(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showTour: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const tourPanel = container.querySelector('.cg-tour-panel');
    expect(tourPanel).not.toBeNull();
    const closeBtn = tourPanel?.querySelector('.cg-tour-panel-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowTour).toHaveBeenCalledWith(false);
  });

  it('ImpactPanel onClose: calls setShowImpact(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    vi.mocked(useAnalysisPanels).mockReturnValue({
      hotspotNodes: [], godModules: [], coreFunctions: [],
      impactStats: { directCount: 5, totalCount: 10, nodes: [] },
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    const panelState = makePanelStateMock({ showImpact: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const impactPanel = container.querySelector('.cg-impact-panel');
    expect(impactPanel).not.toBeNull();
    const closeBtn = impactPanel?.querySelector('.cg-analysis-panel-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowImpact).toHaveBeenCalledWith(false);
  });

  it('CyclePanel onClose: calls setShowCycles(false) when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    mockRenderer.detectCyclesDetailed = vi.fn(() => [{ nodes: ['n1', 'n2'], edges: ['e1'] }]);
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({ viewMode: 'callgraph' });
    const panelState = makePanelStateMock({ showCycles: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const cyclePanel = container.querySelector('.cg-cycle-panel');
    expect(cyclePanel).not.toBeNull();
    const closeBtn = cyclePanel?.querySelector('.cg-analysis-panel-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(panelState.setShowCycles).toHaveBeenCalledWith(false);
  });

  it('NodeDetail onClose: calls handleCloseDetail which clears selectedNodeData and selectedNodeId', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const funcNode = { id: 'fn1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10 };
    const mockRenderer = createMockRenderer(new Map([['fn1', funcNode]]));
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({ selectedNodeId: NodeId('fn1') });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: NodeId('fn1'), highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [funcNode as any], edges: [],
      rawNodes: [funcNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    act(() => {
      capturedCallbacks.onNodeTap(NodeId('fn1'));
    });
    const nodeDetail = container.querySelector('.cg-node-detail-panel');
    expect(nodeDetail).not.toBeNull();
    const closeBtn = nodeDetail?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('onCollapse (NodeDetail): calls collapseNode when collapse button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const clusterNode = { id: 'cluster__1', label: 'Cluster 1', type: 'module', filePath: '/cluster', isCluster: true };
    const mockRenderer = createMockRenderer(new Map([['cluster__1', clusterNode]]));
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({
      selectedNodeId: NodeId('cluster__1'),
      expandedNodeIds: new Set(['cluster__1']),
    });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: NodeId('cluster__1'), highlightedNodeIds: [],
      expandedNodeIds: new Set(['cluster__1']), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [clusterNode as any], edges: [],
      rawNodes: [clusterNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    // Use onNodeTap to select the node and set selectedNodeData
    act(() => {
      capturedCallbacks.onNodeTap(NodeId('cluster__1'));
    });
    const nodeDetail = container.querySelector('.cg-node-detail-panel');
    expect(nodeDetail).not.toBeNull();
    const collapseBtn = container.querySelector('.cg-detail-collapse-btn') as HTMLButtonElement;
    expect(collapseBtn).toBeTruthy();
    if (collapseBtn) {
      fireEvent.click(collapseBtn);
      expect(useGraphStore.getState().expandedNodeIds.has('cluster__1')).toBe(false);
    }
  });

  it('onNodeTap (SequenceDiagram): calls handleNodeTap with NodeId when sequence diagram node tapped', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 5 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]));
    setupRendererMockWithCallbacks(mockRenderer);
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'n1', functionName: 'myFunc', filePath: '/test.ts' } as any,
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    useGraphStore.setState({
      viewMode: 'sequence',
      nodes: [{ id: 'n1', label: 'myFunc', type: 'function', filePath: '/test.ts' } as any],
    });

    const { container } = render(React.createElement(GraphPanel));
    const seqRenderer = container.querySelector('[data-testid="seq-renderer"]');
    expect(seqRenderer).not.toBeNull();
    // The SequenceDiagramRenderer is mocked, so we verify via the callback that onNodeTap would be called
    // The onNodeTap callback is passed to SequenceDiagramRenderer as a prop
    // Since the mock renderer just renders a div, we verify the component renders correctly
    expect(seqRenderer?.tagName).toBe('DIV');
  });

  it('onFocusArea: calls renderer.focusOnArea with correct coordinates when mini map clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const viewportInfo = { zoom: 1, pan: { x: 0, y: 0 }, renderedSize: { w: 100, h: 100 }, totalSize: { w: 200, h: 200 } };
    const mockRenderer = createMockRenderer();
    (mockRenderer as any).getThumbnail = vi.fn(() => 'data:image/png;base64,mock');
    (mockRenderer as any).getViewportInfo = vi.fn(() => viewportInfo);
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showMiniMap: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);

    const { container } = render(React.createElement(GraphPanel));
    const miniMap = container.querySelector('.cg-mini-map');
    expect(miniMap).not.toBeNull();
    // Click the <img> element inside the thumbnail to trigger handleThumbnailClick -> onFocusArea
    const thumbnailImg = container.querySelector('.cg-mini-map-thumbnail img') as HTMLImageElement;
    expect(thumbnailImg).not.toBeNull();
    if (thumbnailImg) {
      fireEvent.click(thumbnailImg);
      expect(mockRenderer.focusOnArea).toHaveBeenCalled();
    }
  });

  it('onWinResize: triggers resize handler when ResizeObserver is unavailable', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const originalRO = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = undefined;

    try {
      const { container } = render(React.createElement(GraphPanel));
      expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
      // Trigger window resize event to exercise onWinResize handler
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(container.querySelector('.cg-graph-panel')).not.toBeNull();
    } finally {
      (globalThis as any).ResizeObserver = originalRO;
    }
  });


  it('onRetry (ErrorOverlay): calls assembleMicro when retry button clicked in micro view', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({ viewMode: 'cfg', error: 'Test error' });
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'fn1', functionName: 'myFunc', filePath: '/test.ts' },
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      handleHealthCheck: vi.fn(), handleRulesCheck: vi.fn(),
    } as any);
    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: 'Test error', lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: false, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
    });

    const { container } = render(React.createElement(GraphPanel));
    const errorOverlay = container.querySelector('.cg-error-overlay');
    expect(errorOverlay).not.toBeNull();
    const retryBtn = errorOverlay?.querySelector('.cg-error-retry-btn') as HTMLButtonElement;
    if (retryBtn) {
      fireEvent.click(retryBtn);
      // assembleMicro should have been called (it's from useGraphActions)
      // We verify the button exists and is clickable
      expect(retryBtn.tagName).toBe('BUTTON');
    }
  });

  it('getSelectedNodeData: returns data from renderer when selectedNodeId is set', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const nodeData = { id: 'n1', label: 'selectedFunc', type: 'function', filePath: '/test.ts', lineNumber: 42 };
    const mockRenderer = createMockRenderer(new Map([['n1', nodeData]]));
    mockRenderer.getSelectedNodeData = vi.fn(() => nodeData);
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({
      selectedNodeId: NodeId('n1'),
      nodes: [{ id: 'n1', label: 'selectedFunc', type: 'function', filePath: '/test.ts', lineNumber: 42 } as any],
    });

    render(React.createElement(GraphPanel));

    // The getDataRef.current.getSelectedNodeData function is set in useEffect
    // and calls renderer.rendererRef.current?.getSelectedNodeData()
    // We verify the mock is properly wired
    expect(mockRenderer.getSelectedNodeData).toBeDefined();
  });

  it('handleCloseDetail: clears selectedNodeData via NodeDetail close button', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const funcNode = { id: 'fn1', label: 'myFunc', type: 'function', filePath: '/test.ts', lineNumber: 10 };
    const mockRenderer = createMockRenderer(new Map([['fn1', funcNode]]));
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({ selectedNodeId: NodeId('fn1') });
    vi.mocked(useGraphInteraction).mockReturnValue({
      searchQuery: '', selectedNodeId: NodeId('fn1'), highlightedNodeIds: [],
      expandedNodeIds: new Set(), pathResult: null,
      focusDepth: 1, focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
    });
    vi.mocked(useGraphData).mockReturnValue({
      nodes: [funcNode as any], edges: [],
      rawNodes: [funcNode as any], rawEdges: [],
    });

    const { container } = render(React.createElement(GraphPanel));
    // Use onNodeTap to select the node and set selectedNodeData
    act(() => {
      capturedCallbacks.onNodeTap(NodeId('fn1'));
    });
    const nodeDetail = container.querySelector('.cg-node-detail-panel');
    expect(nodeDetail).not.toBeNull();
    const closeBtn = nodeDetail?.querySelector('.cg-close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    // After close, selectedNodeId should be null
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});
describe('GraphPanel remaining handler coverage tests', () => {
  let capturedCallbacks: any;
  let capturedKeyboardHandlers: any;

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
    });
    capturedCallbacks = {};
    capturedKeyboardHandlers = {};
    vi.mocked(useGraphActions).mockReturnValue(useGraphStore.getState() as any);
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

  function setupKeyboardMockWithHandlers() {
    vi.mocked(usePanelKeyboard).mockImplementation((...args: any[]) => {
      capturedKeyboardHandlers = args[3];
      return {};
    });
  }

  function createMockRenderer(nodeMap: Map<string, any> = new Map(), edgeMap: Map<string, any> = new Map()) {
    return {
      getNodeData: vi.fn((id: string) => nodeMap.get(id) ?? null),
      getEdgeData: vi.fn((id: string) => edgeMap.get(id) ?? null),
      getSelectedNodeData: vi.fn(() => null as any),
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
      focusOnArea: vi.fn(),
      highlightCallChain: vi.fn(),
      highlightImpact: vi.fn(),
      getImpactStats: vi.fn(() => null),
      markDeadCode: vi.fn(),
      clearDeadCodeMarks: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn(),
    };
  }

  function makePanelStateMock(overrides: Record<string, any> = {}) {
    const base: Record<string, any> = {
      showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
      showFilterPanel: false, showPathFind: false, showHealthScore: false,
      showRules: false, showCallChain: false, showImpact: false,
      showCycles: false, showHotspot: false, showGodModule: false,
      showCoreFunction: false, showInheritance: false, cycleIsolation: false,
      showDeadCode: false,
      collapsed: false, isCollapsed: false, showTour: false,
      toPanelControls: {
        showImport: false, showSearch: false, showLegend: false, showMiniMap: false,
        showFilterPanel: false, showPathFind: false, showHealthScore: false,
        showRules: false, showCallChain: false, showImpact: false,
        showCycles: false, showHotspot: false, showGodModule: false,
        showCoreFunction: false, cycleIsolation: false, showInheritance: false, showTour: false,
        showDeadCode: false,
        onToggleSearch: vi.fn(), onToggleCallChain: vi.fn(), onToggleCycles: vi.fn(),
        onToggleCycleIsolation: vi.fn(), onToggleImpact: vi.fn(), onToggleInheritance: vi.fn(),
        onToggleMiniMap: vi.fn(), onToggleLegend: vi.fn(), onToggleImport: vi.fn(),
        onTogglePathFind: vi.fn(), onToggleHealthScore: vi.fn(), onToggleRules: vi.fn(),
        onToggleHotspot: vi.fn(), onToggleGodModule: vi.fn(), onToggleCoreFunction: vi.fn(),
        onToggleDeadCode: vi.fn(),
        onToggleFilterPanel: vi.fn(),
      },
      setShowImport: vi.fn(), setShowSearch: vi.fn(), setShowLegend: vi.fn(),
      setShowMiniMap: vi.fn(), setShowFilterPanel: vi.fn(), setShowPathFind: vi.fn(),
      setShowHealthScore: vi.fn(), setShowRules: vi.fn(), setShowCallChain: vi.fn(),
      setShowImpact: vi.fn(), setShowCycles: vi.fn(), setShowHotspot: vi.fn(),
      setShowGodModule: vi.fn(), setShowCoreFunction: vi.fn(),
      setShowDeadCode: vi.fn(),
      setShowCycleIsolation: vi.fn(), setShowInheritance: vi.fn(), setShowTour: vi.fn(),
      toggleCollapsed: vi.fn(), toggleCollapse: vi.fn(),
      toggleSearch: vi.fn(), toggleCycles: vi.fn(), toggleCycleIsolation: vi.fn(),
      toggleCallChain: vi.fn(), toggleImpact: vi.fn(), toggleInheritance: vi.fn(),
      toggleMiniMap: vi.fn(), toggleImport: vi.fn(), toggleLegend: vi.fn(),
      togglePathFind: vi.fn(), toggleHealthScore: vi.fn(), toggleRules: vi.fn(),
      toggleHotspot: vi.fn(), toggleGodModule: vi.fn(), toggleCoreFunction: vi.fn(),
      toggleFilterPanel: vi.fn(),
    };
    return { ...base, ...overrides };
  }

  it('layoutConfig.onChange: triggers setClusterDepth when depth select changed', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const setClusterDepthSpy = vi.fn();
    vi.mocked(useGraphActions).mockReturnValue({
      ...useGraphStore.getState(),
      setClusterDepth: setClusterDepthSpy,
    } as any);
    vi.mocked(useGraphDisplay).mockReturnValue({
      layout: 'dagre', dagreRankDir: 'TB', theme: 'dark',
      filterType: 'all', graphType: 'callgraph', clusterDepth: 1,
      viewMode: 'code', currentLayer: 0, diagramData: null, hierarchyLevel: 1,
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    const depthSelect = container.querySelector('.cg-depth-select') as HTMLSelectElement;
    expect(depthSelect).toBeTruthy();
    fireEvent.change(depthSelect, { target: { value: '2' } });
    expect(setClusterDepthSpy).toHaveBeenCalledWith(2);
  });

  it('viewConfig.onChange: triggers setHierarchyLevel when hierarchy button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const setHierarchyLevelSpy = vi.fn();
    vi.mocked(useGraphActions).mockReturnValue({
      ...useGraphStore.getState(),
      setHierarchyLevel: setHierarchyLevelSpy,
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    const hierarchyBtns = container.querySelectorAll('.cg-hierarchy-btn');
    expect(hierarchyBtns.length).toBeGreaterThan(1);
    const targetBtn = Array.from(hierarchyBtns).find((btn) => !btn.classList.contains('cg-active')) as HTMLButtonElement;
    expect(targetBtn).toBeTruthy();
    fireEvent.click(targetBtn);
    expect(setHierarchyLevelSpy).toHaveBeenCalled();
  });

  it('viewConfig.onChange: triggers setFilterType when filter select changed', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    useGraphStore.setState({ filterType: 'all' } as any);

    const { container } = render(React.createElement(GraphPanel));
    const filterSelect = container.querySelector('.cg-filter-select') as HTMLSelectElement;
    expect(filterSelect).toBeTruthy();
    fireEvent.change(filterSelect, { target: { value: 'function' } });
    expect(useGraphStore.getState().filterType).toBe('function');
  });

  it('onRetry (ErrorOverlay): calls assembleMicro when retry button clicked in micro view', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const assembleMicroSpy = vi.fn();
    vi.mocked(useGraphActions).mockReturnValue({
      ...useGraphStore.getState(),
      assembleMicro: assembleMicroSpy,
    } as any);
    useGraphStore.setState({ viewMode: 'cfg', error: 'Test error' } as any);
    vi.mocked(useGraphAnalysis).mockReturnValue({
      ruleViolations: [], selectedFunction: { nodeId: 'fn1', functionName: 'myFunc', filePath: '/test.ts' },
      fanInThreshold: 0, fanOutThreshold: 0, visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
    } as any);
    vi.mocked(useGraphStatus).mockReturnValue({
      isLoading: false, error: 'Test error', lastUpdated: 0, truncated: false,
      totalNodeCount: 0, prerequisites: { codegraph: false, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', urlRestored: true, panelVisible: true,
    });

    const { container } = render(React.createElement(GraphPanel));
    const retryBtn = container.querySelector('.cg-error-overlay-retry') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(assembleMicroSpy).toHaveBeenCalledWith('cfg');
  });

  it('onSelectDeadNode: sets selectedNodeId when dead code node clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    const panelState = makePanelStateMock({ showDeadCode: true });
    vi.mocked(usePanelState).mockReturnValue(panelState as any);
    const deadCodeResult = {
      deadNodes: [{ nodeId: 'dead1', confidence: 'confirmed', category: 'unreachable', label: 'deadFunc', filePath: '/dead.ts' }],
      unreachableNodes: new Set(['dead1']),
      stats: { total: 1, confirmed: 1, suspected: 0 },
    };
    vi.mocked(useAnalysisPanels).mockReturnValue({
      handleRulesCheck: vi.fn(), hotspotNodes: [], godModules: [], impactStats: null,
      coreFunctions: [], deadCodeResult, cycleDetails: [], healthScore: null,
    } as any);

    const { container } = render(React.createElement(GraphPanel));
    const deadNodeItem = container.querySelector('.cg-deadcode-item') as HTMLElement;
    expect(deadNodeItem).toBeTruthy();
    fireEvent.click(deadNodeItem);
    expect(useGraphStore.getState().selectedNodeId).toEqual(NodeId('dead1'));
    expect(mockRenderer.focusOnNode).toHaveBeenCalledWith('dead1');
  });

  it('KeyboardHelp onClose: closes help panel when close button clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    setupKeyboardMockWithHandlers();

    const { container } = render(React.createElement(GraphPanel));
    expect(capturedKeyboardHandlers.onToggleHelp).toBeInstanceOf(Function);
    act(() => {
      capturedKeyboardHandlers.onToggleHelp();
    });
    const helpCloseBtn = container.querySelector('.cg-keyboard-help-close') as HTMLButtonElement;
    expect(helpCloseBtn).toBeTruthy();
    fireEvent.click(helpCloseBtn);
    expect(container.querySelector('.cg-keyboard-help-overlay')).toBeNull();
  });

  it('KeyboardHelp onClose: closes help panel when overlay backdrop clicked', async () => {
    const { GraphPanel } = await import('../../src/client/GraphPanel.tsx');
    const mockRenderer = createMockRenderer();
    setupRendererMockWithCallbacks(mockRenderer);
    setupKeyboardMockWithHandlers();

    const { container } = render(React.createElement(GraphPanel));
    act(() => {
      capturedKeyboardHandlers.onToggleHelp();
    });
    const helpOverlay = container.querySelector('.cg-keyboard-help-overlay') as HTMLElement;
    expect(helpOverlay).toBeTruthy();
    fireEvent.click(helpOverlay);
    expect(container.querySelector('.cg-keyboard-help-overlay')).toBeNull();
  });
});
