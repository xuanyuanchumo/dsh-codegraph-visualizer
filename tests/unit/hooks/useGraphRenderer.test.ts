/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockRenderer } = vi.hoisted(() => ({
  mockRenderer: {
    init: vi.fn(),
    destroy: vi.fn(),
    updateData: vi.fn(),
    setRawNodes: vi.fn(),
    applyLayout: vi.fn(),
    applyIncrementalLayout: vi.fn(),
    isWorkerLayoutAvailable: vi.fn(() => false),
    applyLayoutWithWorker: vi.fn(() => Promise.resolve({})),
    applyWorkerLayout: vi.fn(),
    enableVirtualScroll: vi.fn(),
    disableVirtualScroll: vi.fn(),
    isVirtualScrollEnabled: vi.fn(() => false),
    shouldEnableVirtualScroll: vi.fn(() => false),
    highlightNodes: vi.fn(),
    selectNode: vi.fn(),
    filterByType: vi.fn(),
    filterByGraphType: vi.fn(),
    applyConnectionFilters: vi.fn(),
    search: vi.fn(() => 0),
    focusOnNode: vi.fn(),
    highlightCallChain: vi.fn(),
    detectCycles: vi.fn(() => new Set()),
    detectCyclesDetailed: vi.fn(() => []),
    highlightCycles: vi.fn(),
    isolateCycles: vi.fn(),
    relayoutCycles: vi.fn(),
    restoreIsolation: vi.fn(),
    highlightImpact: vi.fn(),
    getImpactStats: vi.fn(() => null),
    highlightInheritance: vi.fn(),
    focusNeighborhood: vi.fn(),
    getThumbnail: vi.fn(() => null),
    getViewportInfo: vi.fn(() => null),
    focusOnArea: vi.fn(),
    exportJSON: vi.fn((): string => '{}'),
    exportMermaid: vi.fn((): string => 'graph TD'),
    exportMermaidSequence: vi.fn((): string => 'sequenceDiagram'),
    exportMermaidClass: vi.fn((): string => 'classDiagram'),
    exportGraphML: vi.fn((): string => '<graphml/>'),
    exportJSONLD: vi.fn((): string => '{"@context":"..."}'),
    exportPNG: vi.fn((): string | null => null),
    exportSVG: vi.fn((): string | null => null),
    getSelectedNodeData: vi.fn(() => null),
    getNodeData: vi.fn(() => null),
    getEdgeData: vi.fn(() => null),
    resize: vi.fn(),
    updateTheme: vi.fn(),
    setHeatmapMode: vi.fn(),
    getHeatmapMode: vi.fn(() => 'none'),
    setTodoMarkerMode: vi.fn(),
    getTodoMarkerMode: vi.fn(() => 'none'),
    findPath: vi.fn(() => null),
    highlightPath: vi.fn(),
    expandNeighborhood: vi.fn(() => new Set()),
    setFocusMode: vi.fn(),
    clearFocusMode: vi.fn(),
    filterByPath: vi.fn(),
    setDagreRankDir: vi.fn(),
  },
}));

vi.mock('../../../src/client/renderer/CytoscapeRenderer.ts', () => ({
  CytoscapeRenderer: vi.fn(() => mockRenderer),
}));

import { useGraphRenderer } from '../../../src/client/hooks/useGraphRenderer.ts';
import { NodeId, type GraphNode, type GraphEdge } from '../../../src/types/index.ts';
import type { GraphRendererCallbacks } from '../../../src/client/hooks/useGraphRenderer.ts';

function makeNode(id: string): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: 'function',
    filePath: `/src/${id}.ts`,
    properties: {},
  };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id: `${id}` as any,
    source: NodeId(source),
    target: NodeId(target),
    type: 'call',
    properties: {},
  };
}

function makeCallbacks(): GraphRendererCallbacks {
  return {
    onNodeTap: vi.fn(),
    onNodeDoubleTap: vi.fn(),
    onNodeHover: vi.fn(),
    onNodeHoverOut: vi.fn(),
    onEdgeTap: vi.fn(),
    onEdgeHover: vi.fn(),
    onEdgeHoverOut: vi.fn(),
  };
}

function makeConfig(overrides: Record<string, any> = {}) {
  const defaults = {
    nodes: [] as GraphNode[],
    edges: [] as GraphEdge[],
    rawNodes: [] as GraphNode[],
    layout: 'cose' as const,
    dagreRankDir: 'TB' as const,
    theme: 'dark' as const,
    highlightedNodeIds: [] as any[],
    selectedNodeId: null as any,
    filterType: 'all' as const,
    graphType: 'all' as const,
    clusterDepth: 0,
    debouncedSearch: '',
    showCallChain: false,
    showCycles: false,
    cycleIsolation: false,
    showImpact: false,
    showInheritance: false,
    focusNodeId: null as string | null,
    focusModeActive: false,
    focusModeNodeId: null as any,
    focusDepth: 1,
    callbacks: makeCallbacks(),
    showCallChainRef: { current: false } as any,
    fanInThreshold: 0,
    fanOutThreshold: 0,
    visibleNodeTypes: new Set<GraphNode['type']>(),
    visibleEdgeTypes: new Set<GraphEdge['type']>(),
    pathFilterInclude: null as string | null,
    pathFilterExclude: null as string | null,
    heatmapMode: 'none' as const,
    todoMarkerMode: 'none' as const,
  };
  const p = { ...defaults, ...overrides };
  return {
    data: { nodes: p.nodes, edges: p.edges, rawNodes: p.rawNodes },
    display: { layout: p.layout, dagreRankDir: p.dagreRankDir, theme: p.theme, clusterDepth: p.clusterDepth, heatmapMode: p.heatmapMode, todoMarkerMode: p.todoMarkerMode },
    interaction: { highlightedNodeIds: p.highlightedNodeIds, selectedNodeId: p.selectedNodeId, focusNodeId: p.focusNodeId, focusModeActive: p.focusModeActive, focusModeNodeId: p.focusModeNodeId, focusDepth: p.focusDepth, debouncedSearch: p.debouncedSearch },
    filters: { filterType: p.filterType, graphType: p.graphType, fanInThreshold: p.fanInThreshold, fanOutThreshold: p.fanOutThreshold, visibleNodeTypes: p.visibleNodeTypes, visibleEdgeTypes: p.visibleEdgeTypes, pathFilterInclude: p.pathFilterInclude, pathFilterExclude: p.pathFilterExclude },
    analysis: { showCallChain: p.showCallChain, showCycles: p.showCycles, cycleIsolation: p.cycleIsolation, showImpact: p.showImpact, showInheritance: p.showInheritance },
    callbacks: p.callbacks,
    showCallChainRef: p.showCallChainRef,
  };
}

function renderUseGraphRenderer(overrides: Record<string, any> = {}) {
  return renderHook(() => useGraphRenderer(makeConfig(overrides)));
}

610

describe('useGraphRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!URL.createObjectURL) {
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:url'), revokeObjectURL: vi.fn() });
    }
  });

  describe('return value', () => {
    it('returns all expected fields with correct types', () => {
      const { result } = renderUseGraphRenderer();
      expect(result.current.containerRef).toBeDefined();
      expect(result.current.rendererRef).toBeDefined();
      expect(result.current.searchMatchCount).toBeNull();
      expect(typeof result.current.setSearchMatchCount).toBe('function');
      expect(typeof result.current.exportGraph).toBe('function');
      expect(typeof result.current.updateTheme).toBe('function');
    });
  });

  describe('exportGraph', () => {
    it('returns undefined when renderer is null (no crash, no side effect)', () => {
      const { result } = renderUseGraphRenderer();
      const returnValue = result.current.exportGraph('json');
      expect(returnValue).toBeUndefined();
    });

    it('handles png export gracefully when renderer is null', () => {
      const { result } = renderUseGraphRenderer();
      expect(result.current.exportGraph('png')).toBeUndefined();
    });

    it('handles svg export gracefully when renderer is null', () => {
      const { result } = renderUseGraphRenderer();
      expect(result.current.exportGraph('svg')).toBeUndefined();
    });

    it('handles mermaid export gracefully when renderer is null', () => {
      const { result } = renderUseGraphRenderer();
      expect(result.current.exportGraph('mermaid')).toBeUndefined();
    });
  });

  describe('updateTheme', () => {
    it('does not crash when renderer is null and rendererRef stays null', () => {
      const { result } = renderUseGraphRenderer();
      result.current.updateTheme('light');
      expect(result.current.rendererRef.current).toBeNull();
    });
  });

  describe('setSearchMatchCount', () => {
    it('updates searchMatchCount state to a number', () => {
      const { result } = renderUseGraphRenderer();
      act(() => {
        result.current.setSearchMatchCount(5);
      });
      expect(result.current.searchMatchCount).toBe(5);
    });

    it('can set back to null after setting a number', () => {
      const { result } = renderUseGraphRenderer();
      act(() => {
        result.current.setSearchMatchCount(3);
      });
      expect(result.current.searchMatchCount).toBe(3);
      act(() => {
        result.current.setSearchMatchCount(null);
      });
      expect(result.current.searchMatchCount).toBeNull();
    });
  });

  describe('with nodes and edges', () => {
    it('renders without error with non-empty node data', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      const { result } = renderUseGraphRenderer({ nodes, edges });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with raw nodes', () => {
      const rawNodes = [makeNode('a'), makeNode('b')];
      const { result } = renderUseGraphRenderer({ rawNodes });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with highlighted node ids', () => {
      const highlightedNodeIds = [NodeId('a')];
      const { result } = renderUseGraphRenderer({ highlightedNodeIds });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with selected node id', () => {
      const selectedNodeId = NodeId('a');
      const { result } = renderUseGraphRenderer({ selectedNodeId });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with filter type', () => {
      const { result } = renderUseGraphRenderer({ filterType: 'function' });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with graph type filter', () => {
      const { result } = renderUseGraphRenderer({ graphType: 'call' });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with showCallChain and selectedNodeId', () => {
      const { result } = renderUseGraphRenderer({
        showCallChain: true,
        selectedNodeId: NodeId('a'),
      });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with showCycles enabled', () => {
      const { result } = renderUseGraphRenderer({ showCycles: true });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with cycleIsolation and showCycles', () => {
      const { result } = renderUseGraphRenderer({
        cycleIsolation: true,
        showCycles: true,
      });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with showImpact and selectedNodeId', () => {
      const { result } = renderUseGraphRenderer({
        showImpact: true,
        selectedNodeId: NodeId('a'),
      });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with showInheritance and selectedNodeId', () => {
      const { result } = renderUseGraphRenderer({
        showInheritance: true,
        selectedNodeId: NodeId('a'),
      });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with focusNodeId', () => {
      const { result } = renderUseGraphRenderer({ focusNodeId: 'a' });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with heatmapMode', () => {
      const { result } = renderUseGraphRenderer({ heatmapMode: 'instability' });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with debouncedSearch', () => {
      const { result } = renderUseGraphRenderer({ debouncedSearch: 'test' });
      expect(result.current.containerRef).toBeDefined();
    });

    it('renders without error with fanInThreshold and fanOutThreshold', () => {
      const { result } = renderUseGraphRenderer({
        fanInThreshold: 5,
        fanOutThreshold: 3,
      });
      expect(result.current.containerRef).toBeDefined();
    });
  });

  describe('theme change', () => {
    it('survives theme rerender without error', () => {
      const { rerender, result } = renderUseGraphRenderer({ theme: 'dark' });
      rerender();
      expect(result.current.containerRef).toBeDefined();
    });
  });

  describe('renderer method calls via effect triggers', () => {
    function renderWithRenderer<P extends Record<string, any>, R>(initialProps: P, renderFn: (props: P) => R) {
      const { result, rerender } = renderHook(renderFn as any, { initialProps });
      (result.current as any).rendererRef.current = mockRenderer;
      return { result, rerender } as any;
    }

    it('calls filterByType when filterType prop changes', () => {
      const { rerender } = renderWithRenderer(
        { filterType: 'all' },
        ({ filterType }: { filterType: string }) => useGraphRenderer(makeConfig({ filterType }))
      );
      rerender({ filterType: 'function' });
      expect(mockRenderer.filterByType).toHaveBeenCalledWith('function');
    });

    it('calls filterByGraphType when graphType prop changes', () => {
      const { rerender } = renderWithRenderer(
        { graphType: 'all' },
        ({ graphType }: { graphType: string }) => useGraphRenderer(makeConfig({ graphType }))
      );
      rerender({ graphType: 'call' });
      expect(mockRenderer.filterByGraphType).toHaveBeenCalledWith('call');
    });

    it('calls setHeatmapMode when heatmapMode prop changes', () => {
      const { rerender } = renderWithRenderer(
        { heatmapMode: 'none' },
        ({ heatmapMode }: { heatmapMode: string }) => useGraphRenderer(makeConfig({ heatmapMode }))
      );
      rerender({ heatmapMode: 'instability' });
      expect(mockRenderer.setHeatmapMode).toHaveBeenCalledWith('instability');
    });

    it('calls highlightNodes and selectNode when interaction changes', () => {
      const { rerender } = renderWithRenderer(
        { highlightedNodeIds: [] as any[], selectedNodeId: null },
        ({ highlightedNodeIds, selectedNodeId }: { highlightedNodeIds: any[]; selectedNodeId: any }) =>
          useGraphRenderer(makeConfig({ highlightedNodeIds, selectedNodeId }))
      );
      rerender({ highlightedNodeIds: [NodeId('a')], selectedNodeId: NodeId('b') });
      expect(mockRenderer.highlightNodes).toHaveBeenCalledWith([NodeId('a')]);
      expect(mockRenderer.selectNode).toHaveBeenCalledWith(NodeId('b'));
    });

    it('calls focusNeighborhood when focusNodeId changes', () => {
      const { rerender } = renderWithRenderer(
        { focusNodeId: null },
        ({ focusNodeId }: { focusNodeId: string | null }) =>
          useGraphRenderer(makeConfig({ focusNodeId }))
      );
      rerender({ focusNodeId: 'nodeA' });
      expect(mockRenderer.focusNeighborhood).toHaveBeenCalled();
    });

    it('calls setFocusMode when focusModeActive and focusModeNodeId set', () => {
      const { rerender } = renderWithRenderer(
        { focusModeActive: false, focusModeNodeId: null },
        ({ focusModeActive, focusModeNodeId }: { focusModeActive: boolean; focusModeNodeId: any }) =>
          useGraphRenderer(makeConfig({ focusModeActive, focusModeNodeId }))
      );
      rerender({ focusModeActive: true, focusModeNodeId: NodeId('a') });
      expect(mockRenderer.setFocusMode).toHaveBeenCalledWith(NodeId('a'), 1);
    });

    it('calls clearFocusMode when focusModeActive becomes false', () => {
      const { rerender } = renderWithRenderer(
        { focusModeActive: true },
        ({ focusModeActive }: { focusModeActive: boolean }) =>
          useGraphRenderer(makeConfig({ focusModeActive, focusModeNodeId: NodeId('a') }))
      );
      rerender({ focusModeActive: false });
      expect(mockRenderer.clearFocusMode).toHaveBeenCalled();
    });

    it('calls filterByPath when path filters change', () => {
      const { rerender } = renderWithRenderer(
        { pathFilterInclude: null, pathFilterExclude: null },
        ({ pathFilterInclude, pathFilterExclude }: { pathFilterInclude: string | null; pathFilterExclude: string | null }) =>
          useGraphRenderer(makeConfig({ pathFilterInclude, pathFilterExclude }))
      );
      rerender({ pathFilterInclude: 'src/', pathFilterExclude: 'test/' });
      expect(mockRenderer.filterByPath).toHaveBeenCalledWith('src/', 'test/');
    });

    it('calls setDagreRankDir when dagreRankDir changes', () => {
      const { rerender } = renderWithRenderer(
        { dagreRankDir: 'TB' },
        ({ dagreRankDir }: { dagreRankDir: string }) =>
          useGraphRenderer(makeConfig({ dagreRankDir, layout: 'dagre' }))
      );
      rerender({ dagreRankDir: 'LR' });
      expect(mockRenderer.setDagreRankDir).toHaveBeenCalledWith('LR');
    });

    it('calls highlightCallChain when showCallChain and selectedNodeId set', () => {
      const { rerender } = renderWithRenderer(
        { showCallChain: false, selectedNodeId: null },
        ({ showCallChain, selectedNodeId }: { showCallChain: boolean; selectedNodeId: any }) =>
          useGraphRenderer(makeConfig({ showCallChain, selectedNodeId }))
      );
      rerender({ showCallChain: true, selectedNodeId: NodeId('a') });
      expect(mockRenderer.highlightCallChain).toHaveBeenCalledWith(NodeId('a'));
    });

    it('calls highlightCallChain(null) when showCallChain becomes false', () => {
      const { rerender } = renderWithRenderer(
        { showCallChain: true },
        ({ showCallChain }: { showCallChain: boolean }) =>
          useGraphRenderer(makeConfig({ showCallChain, selectedNodeId: NodeId('a') }))
      );
      rerender({ showCallChain: false });
      expect(mockRenderer.highlightCallChain).toHaveBeenCalledWith(null);
    });

    it('calls detectCycles and highlightCycles when showCycles enabled', () => {
      const { rerender } = renderWithRenderer(
        { showCycles: false },
        ({ showCycles }: { showCycles: boolean }) =>
          useGraphRenderer(makeConfig({ showCycles }))
      );
      rerender({ showCycles: true });
      expect(mockRenderer.detectCycles).toHaveBeenCalled();
      expect(mockRenderer.highlightCycles).toHaveBeenCalled();
    });

    it('calls highlightCycles with empty set when showCycles disabled', () => {
      const { rerender } = renderWithRenderer(
        { showCycles: true },
        ({ showCycles }: { showCycles: boolean }) =>
          useGraphRenderer(makeConfig({ showCycles }))
      );
      rerender({ showCycles: false });
      expect(mockRenderer.highlightCycles).toHaveBeenCalledWith(new Set<string>());
    });

    it('calls highlightImpact when showImpact and selectedNodeId set', () => {
      const { rerender } = renderWithRenderer(
        { showImpact: false, selectedNodeId: null },
        ({ showImpact, selectedNodeId }: { showImpact: boolean; selectedNodeId: any }) =>
          useGraphRenderer(makeConfig({ showImpact, selectedNodeId }))
      );
      rerender({ showImpact: true, selectedNodeId: NodeId('a') });
      expect(mockRenderer.highlightImpact).toHaveBeenCalledWith(NodeId('a'));
    });

    it('calls highlightInheritance when showInheritance enabled', () => {
      const { rerender } = renderWithRenderer(
        { showInheritance: false, selectedNodeId: null },
        ({ showInheritance, selectedNodeId }: { showInheritance: boolean; selectedNodeId: any }) =>
          useGraphRenderer(makeConfig({ showInheritance, selectedNodeId }))
      );
      rerender({ showInheritance: true, selectedNodeId: NodeId('a') });
      expect(mockRenderer.highlightInheritance).toHaveBeenCalledWith(NodeId('a'));
    });

    it('calls highlightInheritance(null) when showInheritance disabled', () => {
      const { rerender } = renderWithRenderer(
        { showInheritance: true },
        ({ showInheritance }: { showInheritance: boolean }) =>
          useGraphRenderer(makeConfig({ showInheritance, selectedNodeId: NodeId('a') }))
      );
      rerender({ showInheritance: false });
      expect(mockRenderer.highlightInheritance).toHaveBeenCalledWith(null);
    });
  });

  describe('exportGraph with renderer', () => {
    it('calls exportPNG when exportGraph("png") and renderer exists', () => {
      mockRenderer.exportPNG = vi.fn(() => 'data:image/png;base64,abc');
      const { result } = renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('png'); });
      expect(mockRenderer.exportPNG).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportSVG when exportGraph("svg") and renderer exists', () => {
      mockRenderer.exportSVG = vi.fn(() => '<svg></svg>');
      const { result } = renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('svg'); });
      expect(mockRenderer.exportSVG).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportJSON when exportGraph("json") and renderer exists', () => {
      mockRenderer.exportJSON = vi.fn(() => '{"nodes":[]}');
      const { result } = renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('json'); });
      expect(mockRenderer.exportJSON).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportMermaid when exportGraph("mermaid") and renderer exists', () => {
      mockRenderer.exportMermaid = vi.fn(() => 'graph TD');
      const { result } = renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('mermaid'); });
      expect(mockRenderer.exportMermaid).toHaveBeenCalled();
      clickSpy.mockRestore();
    });
  });

  describe('updateTheme with renderer', () => {
    it('calls renderer.updateTheme when renderer exists', () => {
      const { result } = renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });

      act(() => {
        result.current.updateTheme('light');
      });
      expect(mockRenderer.updateTheme).toHaveBeenCalledWith('light');
    });
  });

  describe('additional effect triggers', () => {
    function renderWithRenderer<P extends Record<string, any>, R>(initialProps: P, renderFn: (props: P) => R) {
      const { result, rerender } = renderHook(renderFn as any, { initialProps });
      (result.current as any).rendererRef.current = mockRenderer;
      return { result, rerender } as any;
    }

    it('calls applyConnectionFilters when fanIn/fanOut thresholds change', () => {
      const { rerender } = renderWithRenderer(
        { fanInThreshold: 0, fanOutThreshold: 0 },
        ({ fanInThreshold, fanOutThreshold }: { fanInThreshold: number; fanOutThreshold: number }) =>
          useGraphRenderer(makeConfig({ fanInThreshold, fanOutThreshold }))
      );
      rerender({ fanInThreshold: 5, fanOutThreshold: 3 });
      expect(mockRenderer.applyConnectionFilters).toHaveBeenCalledWith(
        5, 3,
        expect.any(Set),
        expect.any(Set),
      );
    });

    it('calls setTodoMarkerMode when todoMarkerMode changes', () => {
      const { rerender } = renderWithRenderer(
        { todoMarkerMode: 'none' },
        ({ todoMarkerMode }: { todoMarkerMode: string }) =>
          useGraphRenderer(makeConfig({ todoMarkerMode }))
      );
      rerender({ todoMarkerMode: 'todo' });
      expect(mockRenderer.setTodoMarkerMode).toHaveBeenCalledWith('todo');
    });

    it('calls search and sets match count when debouncedSearch changes', () => {
      mockRenderer.search = vi.fn(() => 7);
      const { rerender, result } = renderWithRenderer(
        { debouncedSearch: '' },
        ({ debouncedSearch }: { debouncedSearch: string }) =>
          useGraphRenderer(makeConfig({ debouncedSearch }))
      );
      rerender({ debouncedSearch: 'foo' });
      expect(mockRenderer.search).toHaveBeenCalledWith('foo');
      expect(result.current.searchMatchCount).toBe(7);
    });

    it('sets searchMatchCount to null when debouncedSearch is empty', () => {
      mockRenderer.search = vi.fn(() => 0);
      const { rerender, result } = renderWithRenderer(
        { debouncedSearch: 'foo' },
        ({ debouncedSearch }: { debouncedSearch: string }) =>
          useGraphRenderer(makeConfig({ debouncedSearch }))
      );
      rerender({ debouncedSearch: '' });
      expect(result.current.searchMatchCount).toBeNull();
    });

    it('calls isolateCycles and relayoutCycles when cycleIsolation + showCycles enabled', () => {
      const { rerender } = renderWithRenderer(
        { cycleIsolation: false, showCycles: true },
        ({ cycleIsolation }: { cycleIsolation: boolean }) =>
          useGraphRenderer(makeConfig({ cycleIsolation, showCycles: true }))
      );
      rerender({ cycleIsolation: true });
      expect(mockRenderer.isolateCycles).toHaveBeenCalled();
      expect(mockRenderer.relayoutCycles).toHaveBeenCalled();
    });

    it('calls restoreIsolation when cycleIsolation becomes false', () => {
      const { rerender } = renderWithRenderer(
        { cycleIsolation: true, showCycles: true },
        ({ cycleIsolation }: { cycleIsolation: boolean }) =>
          useGraphRenderer(makeConfig({ cycleIsolation, showCycles: true }))
      );
      rerender({ cycleIsolation: false });
      expect(mockRenderer.restoreIsolation).toHaveBeenCalled();
    });

    it('calls restoreIsolation when showCycles becomes false with cycleIsolation true', () => {
      const { rerender } = renderWithRenderer(
        { cycleIsolation: true, showCycles: true },
        ({ showCycles }: { showCycles: boolean }) =>
          useGraphRenderer(makeConfig({ cycleIsolation: true, showCycles }))
      );
      rerender({ showCycles: false });
      expect(mockRenderer.restoreIsolation).toHaveBeenCalled();
    });

    it('calls enableVirtualScroll when node count exceeds threshold', () => {
      mockRenderer.shouldEnableVirtualScroll = vi.fn(() => true);
      mockRenderer.isVirtualScrollEnabled = vi.fn(() => false);
      const { rerender } = renderWithRenderer(
        { nodes: [] as GraphNode[] },
        ({ nodes }: { nodes: GraphNode[] }) =>
          useGraphRenderer(makeConfig({ nodes }))
      );
      const manyNodes = Array.from({ length: 500 }, (_, i) => makeNode(`n${i}`));
      rerender({ nodes: manyNodes });
      expect(mockRenderer.enableVirtualScroll).toHaveBeenCalled();
    });

    it('calls disableVirtualScroll when node count drops below threshold', () => {
      mockRenderer.shouldEnableVirtualScroll = vi.fn(() => false);
      mockRenderer.isVirtualScrollEnabled = vi.fn(() => true);
      const manyNodes = Array.from({ length: 500 }, (_, i) => makeNode(`n${i}`));
      const { rerender } = renderWithRenderer(
        { nodes: manyNodes },
        ({ nodes }: { nodes: GraphNode[] }) =>
          useGraphRenderer(makeConfig({ nodes }))
      );
      rerender({ nodes: [] });
      expect(mockRenderer.disableVirtualScroll).toHaveBeenCalled();
    });

    it('calls applyLayout when layout changes', () => {
      vi.useFakeTimers();
      const { rerender } = renderWithRenderer(
        { layout: 'cose' },
        ({ layout }: { layout: string }) =>
          useGraphRenderer(makeConfig({ layout }))
      );
      rerender({ layout: 'breadthfirst' });
      vi.advanceTimersByTime(1000);
      expect(mockRenderer.applyLayout).toHaveBeenCalledWith('breadthfirst');
      vi.useRealTimers();
    });

    it('calls updateData when nodes change', () => {
      const { rerender } = renderWithRenderer(
        { nodes: [] as GraphNode[] },
        ({ nodes }: { nodes: GraphNode[] }) =>
          useGraphRenderer(makeConfig({ nodes }))
      );
      rerender({ nodes: [makeNode('x')] });
      expect(mockRenderer.updateData).toHaveBeenCalled();
    });

    it('calls setRawNodes when rawNodes change', () => {
      const { rerender } = renderWithRenderer(
        { rawNodes: [] as GraphNode[] },
        ({ rawNodes }: { rawNodes: GraphNode[] }) =>
          useGraphRenderer(makeConfig({ rawNodes }))
      );
      rerender({ rawNodes: [makeNode('r1')] });
      expect(mockRenderer.setRawNodes).toHaveBeenCalledWith([makeNode('r1')]);
    });
  });

  describe('exportGraph additional formats', () => {
    function renderWithRendererRef() {
      return renderHook(() => {
        const r = useGraphRenderer(makeConfig());
        r.rendererRef.current = mockRenderer as any;
        return r;
      });
    }

    it('calls exportMermaidSequence for mermaid-seq format', () => {
      mockRenderer.exportMermaidSequence = vi.fn(() => 'sequenceDiagram');
      const { result } = renderWithRendererRef();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('mermaid-seq'); });
      expect(mockRenderer.exportMermaidSequence).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportMermaidClass for mermaid-class format', () => {
      mockRenderer.exportMermaidClass = vi.fn(() => 'classDiagram');
      const { result } = renderWithRendererRef();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('mermaid-class'); });
      expect(mockRenderer.exportMermaidClass).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportGraphML for graphml format', () => {
      mockRenderer.exportGraphML = vi.fn(() => '<graphml/>');
      const { result } = renderWithRendererRef();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('graphml'); });
      expect(mockRenderer.exportGraphML).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('calls exportJSONLD for jsonld format', () => {
      mockRenderer.exportJSONLD = vi.fn(() => '{"@context":"..."}');
      const { result } = renderWithRendererRef();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      act(() => { result.current.exportGraph('jsonld'); });
      expect(mockRenderer.exportJSONLD).toHaveBeenCalled();
      clickSpy.mockRestore();
    });
  });
});
