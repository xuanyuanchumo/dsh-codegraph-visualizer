/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../src/client/renderer/CytoscapeRenderer.ts', () => {
  const mockRenderer = {
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
    exportJSON: vi.fn(() => '{}'),
    exportMermaid: vi.fn(() => 'graph TD'),
    exportPNG: vi.fn(() => null),
    exportSVG: vi.fn(() => null),
    getSelectedNodeData: vi.fn(() => null),
    getNodeData: vi.fn(() => null),
    getEdgeData: vi.fn(() => null),
    resize: vi.fn(),
    updateTheme: vi.fn(),
    setHeatmapMode: vi.fn(),
    getHeatmapMode: vi.fn(() => 'none'),
    findPath: vi.fn(() => null),
    highlightPath: vi.fn(),
    expandNeighborhood: vi.fn(() => new Set()),
  };
  return {
    CytoscapeRenderer: vi.fn(() => mockRenderer),
    __mockRenderer: mockRenderer,
  };
});

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

function renderUseGraphRenderer(overrides: Record<string, any> = {}) {
  const defaults = {
    nodes: [],
    edges: [],
    rawNodes: [],
    layout: 'cose' as const,
    theme: 'dark' as const,
    highlightedNodeIds: [] as any[],
    selectedNodeId: null,
    filterType: 'all' as const,
    graphType: 'all' as const,
    clusterDepth: 0,
    debouncedSearch: '',
    showCallChain: false,
    showCycles: false,
    cycleIsolation: false,
    showImpact: false,
    showInheritance: false,
    focusNodeId: null,
    callbacks: makeCallbacks(),
    showCallChainRef: { current: false } as any,
    fanInThreshold: 0,
    fanOutThreshold: 0,
    visibleNodeTypes: new Set<GraphNode['type']>(),
    visibleEdgeTypes: new Set<GraphEdge['type']>(),
    heatmapMode: 'none' as const,
  };
  const props = { ...defaults, ...overrides };
  return renderHook(() => useGraphRenderer({
    data: { nodes: props.nodes, edges: props.edges, rawNodes: props.rawNodes },
    display: { layout: props.layout, dagreRankDir: 'TB' as const, theme: props.theme, clusterDepth: props.clusterDepth, heatmapMode: props.heatmapMode },
    interaction: { highlightedNodeIds: props.highlightedNodeIds, selectedNodeId: props.selectedNodeId, focusNodeId: props.focusNodeId, focusModeActive: false, focusModeNodeId: null, focusDepth: 1, debouncedSearch: props.debouncedSearch },
    filters: { filterType: props.filterType, graphType: props.graphType, fanInThreshold: props.fanInThreshold, fanOutThreshold: props.fanOutThreshold, visibleNodeTypes: props.visibleNodeTypes, visibleEdgeTypes: props.visibleEdgeTypes, pathFilterInclude: null, pathFilterExclude: null },
    analysis: { showCallChain: props.showCallChain, showCycles: props.showCycles, cycleIsolation: props.cycleIsolation, showImpact: props.showImpact, showInheritance: props.showInheritance },
    callbacks: props.callbacks,
    showCallChainRef: props.showCallChainRef,
  }));
}

describe('useGraphRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
