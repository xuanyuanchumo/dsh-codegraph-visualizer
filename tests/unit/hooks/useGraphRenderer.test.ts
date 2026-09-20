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
  return renderHook(() => useGraphRenderer(
    props.nodes,
    props.edges,
    props.rawNodes,
    props.layout,
    props.theme,
    props.highlightedNodeIds,
    props.selectedNodeId,
    props.filterType,
    props.graphType,
    props.clusterDepth,
    props.debouncedSearch,
    props.showCallChain,
    props.showCycles,
    props.cycleIsolation,
    props.showImpact,
    props.showInheritance,
    props.focusNodeId,
    props.callbacks,
    props.showCallChainRef,
    props.fanInThreshold,
    props.fanOutThreshold,
    props.visibleNodeTypes,
    props.visibleEdgeTypes,
    props.heatmapMode,
  ));
}

describe('useGraphRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('return value', () => {
    it('returns containerRef, rendererRef, searchMatchCount, setSearchMatchCount, exportGraph, updateTheme', () => {
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
    it('does not throw when renderer is null', () => {
      const { result } = renderUseGraphRenderer();
      expect(() => result.current.exportGraph('json')).not.toThrow();
    });

    it('does not throw when exporting png', () => {
      const { result } = renderUseGraphRenderer();
      expect(() => result.current.exportGraph('png')).not.toThrow();
    });

    it('does not throw when exporting svg', () => {
      const { result } = renderUseGraphRenderer();
      expect(() => result.current.exportGraph('svg')).not.toThrow();
    });

    it('does not throw when exporting mermaid', () => {
      const { result } = renderUseGraphRenderer();
      expect(() => result.current.exportGraph('mermaid')).not.toThrow();
    });
  });

  describe('updateTheme', () => {
    it('does not throw when renderer is null', () => {
      const { result } = renderUseGraphRenderer();
      expect(() => result.current.updateTheme('light')).not.toThrow();
    });
  });

  describe('setSearchMatchCount', () => {
    it('updates searchMatchCount state', () => {
      const { result } = renderUseGraphRenderer();
      act(() => {
        result.current.setSearchMatchCount(5);
      });
      expect(result.current.searchMatchCount).toBe(5);
    });

    it('can set back to null', () => {
      const { result } = renderUseGraphRenderer();
      act(() => {
        result.current.setSearchMatchCount(3);
      });
      act(() => {
        result.current.setSearchMatchCount(null);
      });
      expect(result.current.searchMatchCount).toBeNull();
    });
  });

  describe('with nodes and edges', () => {
    it('handles non-empty node data without throwing', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];
      expect(() => renderUseGraphRenderer({ nodes, edges })).not.toThrow();
    });

    it('handles raw nodes without throwing', () => {
      const rawNodes = [makeNode('a'), makeNode('b')];
      expect(() => renderUseGraphRenderer({ rawNodes })).not.toThrow();
    });

    it('handles highlighted node ids', () => {
      const highlightedNodeIds = [NodeId('a')];
      expect(() => renderUseGraphRenderer({ highlightedNodeIds })).not.toThrow();
    });

    it('handles selected node id', () => {
      const selectedNodeId = NodeId('a');
      expect(() => renderUseGraphRenderer({ selectedNodeId })).not.toThrow();
    });

    it('handles filter type', () => {
      expect(() => renderUseGraphRenderer({ filterType: 'function' })).not.toThrow();
    });

    it('handles graph type filter', () => {
      expect(() => renderUseGraphRenderer({ graphType: 'call' })).not.toThrow();
    });

    it('handles showCallChain with selectedNodeId', () => {
      expect(() => renderUseGraphRenderer({
        showCallChain: true,
        selectedNodeId: NodeId('a'),
      })).not.toThrow();
    });

    it('handles showCycles', () => {
      expect(() => renderUseGraphRenderer({ showCycles: true })).not.toThrow();
    });

    it('handles cycleIsolation with showCycles', () => {
      expect(() => renderUseGraphRenderer({
        cycleIsolation: true,
        showCycles: true,
      })).not.toThrow();
    });

    it('handles showImpact with selectedNodeId', () => {
      expect(() => renderUseGraphRenderer({
        showImpact: true,
        selectedNodeId: NodeId('a'),
      })).not.toThrow();
    });

    it('handles showInheritance with selectedNodeId', () => {
      expect(() => renderUseGraphRenderer({
        showInheritance: true,
        selectedNodeId: NodeId('a'),
      })).not.toThrow();
    });

    it('handles focusNodeId', () => {
      expect(() => renderUseGraphRenderer({ focusNodeId: 'a' })).not.toThrow();
    });

    it('handles heatmapMode', () => {
      expect(() => renderUseGraphRenderer({ heatmapMode: 'instability' })).not.toThrow();
    });

    it('handles debouncedSearch', () => {
      expect(() => renderUseGraphRenderer({ debouncedSearch: 'test' })).not.toThrow();
    });

    it('handles fanInThreshold and fanOutThreshold', () => {
      expect(() => renderUseGraphRenderer({
        fanInThreshold: 5,
        fanOutThreshold: 3,
      })).not.toThrow();
    });
  });

  describe('theme change', () => {
    it('does not throw when theme changes', () => {
      const { rerender } = renderUseGraphRenderer({ theme: 'dark' });
      expect(() => rerender()).not.toThrow();
    });
  });
});