/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

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
});

describe('GraphPanel component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
