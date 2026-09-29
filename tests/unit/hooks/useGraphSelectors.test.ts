// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGraphStore } from '../../../src/client/store/graphStore.ts';
import { NodeId } from '../../../src/types/index.ts';
import {
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus,
  useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions,
  usePanelDimensions,
} from '../../../src/client/hooks/useGraphSelectors.ts';

describe('useGraphSelectors', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [], edges: [], rawNodes: [], rawEdges: [],
      savedRawNodes: [], savedRawEdges: [], repoId: null,
      layout: 'cose', theme: 'dark', filterType: 'all', graphType: 'all',
      clusterDepth: 2, viewMode: 'code', currentLayer: 0, diagramData: null,
      dagreRankDir: 'TB',
      searchQuery: '', selectedNodeId: null, highlightedNodeIds: [],
      expandedNodeIds: new Set<string>(), pathResult: null, focusDepth: 1,
      focusModeActive: false, focusModeNodeId: null,
      pathFilterInclude: null, pathFilterExclude: null,
      isLoading: false, error: null, lastUpdated: 0, truncated: false,
      totalNodeCount: 0, totalEdgeCount: 0,
      prerequisites: { codegraph: false, lens: false, builtin: true },
      watchEnabled: false, initStatus: 'idle', initMessage: null,
      currentWorkspace: '', workspaceList: [],
      pathStartId: null, pathEndId: null,
      ruleViolations: [], selectedFunction: null,
      fanInThreshold: 0, fanOutThreshold: 0,
      visibleNodeTypes: new Set(), visibleEdgeTypes: new Set(), heatmapMode: 'none',
      healthScore: null, rules: [],
      performanceDegradations: [], lodLevel: 'full', lodEnabled: false,
      panelHeight: null, panelWidth: null,
      callChainDepth: 0,
      expandedNodeIdsByViewMode: {},
    });
  });


  describe('useGraphData', () => {
    it('returns nodes, edges, rawNodes, rawEdges', () => {
      const { result } = renderHook(() => useGraphData());
      expect(result.current).toHaveProperty('nodes');
      expect(result.current).toHaveProperty('edges');
      expect(result.current).toHaveProperty('rawNodes');
      expect(result.current).toHaveProperty('rawEdges');
    });

    it('updates when nodes change', () => {
      const { result, rerender } = renderHook(() => useGraphData());
      expect(result.current.nodes).toHaveLength(0);
      act(() => {
        useGraphStore.setState({ nodes: [{ id: NodeId('n1'), label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }] });
      });
      rerender();
      expect(result.current.nodes).toHaveLength(1);
    });
  });

  describe('useGraphDisplay', () => {
    it('returns display configuration fields', () => {
      const { result } = renderHook(() => useGraphDisplay());
      expect(result.current).toHaveProperty('layout');
      expect(result.current).toHaveProperty('theme');
      expect(result.current).toHaveProperty('filterType');
      expect(result.current).toHaveProperty('graphType');
      expect(result.current).toHaveProperty('clusterDepth');
      expect(result.current).toHaveProperty('viewMode');
      expect(result.current).toHaveProperty('currentLayer');
      expect(result.current).toHaveProperty('diagramData');
      expect(result.current).toHaveProperty('dagreRankDir');
    });

    it('updates when theme changes', () => {
      const { result, rerender } = renderHook(() => useGraphDisplay());
      expect(result.current.theme).toBe('dark');
      act(() => {
        useGraphStore.setState({ theme: 'light' });
      });
      rerender();
      expect(result.current.theme).toBe('light');
    });
  });

  describe('useGraphInteraction', () => {
    it('returns interaction state fields', () => {
      const { result } = renderHook(() => useGraphInteraction());
      expect(result.current).toHaveProperty('searchQuery');
      expect(result.current).toHaveProperty('selectedNodeId');
      expect(result.current).toHaveProperty('highlightedNodeIds');
      expect(result.current).toHaveProperty('expandedNodeIds');
      expect(result.current).toHaveProperty('pathResult');
      expect(result.current).toHaveProperty('focusDepth');
      expect(result.current).toHaveProperty('focusModeActive');
      expect(result.current).toHaveProperty('focusModeNodeId');
      expect(result.current).toHaveProperty('pathFilterInclude');
      expect(result.current).toHaveProperty('pathFilterExclude');
    });
  });

  describe('useGraphStatus', () => {
    it('returns status fields', () => {
      const { result } = renderHook(() => useGraphStatus());
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('lastUpdated');
      expect(result.current).toHaveProperty('truncated');
      expect(result.current).toHaveProperty('totalNodeCount');
      expect(result.current).toHaveProperty('prerequisites');
      expect(result.current).toHaveProperty('watchEnabled');
      expect(result.current).toHaveProperty('initStatus');
    });

    it('updates when isLoading changes', () => {
      const { result, rerender } = renderHook(() => useGraphStatus());
      expect(result.current.isLoading).toBe(false);
      act(() => {
        useGraphStore.setState({ isLoading: true });
      });
      rerender();
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('useGraphWorkspace', () => {
    it('returns workspace fields', () => {
      const { result } = renderHook(() => useGraphWorkspace());
      expect(result.current).toHaveProperty('currentWorkspace');
      expect(result.current).toHaveProperty('workspaceList');
    });
  });

  describe('useGraphAnalysis', () => {
    it('returns analysis fields', () => {
      const { result } = renderHook(() => useGraphAnalysis());
      expect(result.current).toHaveProperty('ruleViolations');
      expect(result.current).toHaveProperty('selectedFunction');
      expect(result.current).toHaveProperty('fanInThreshold');
      expect(result.current).toHaveProperty('fanOutThreshold');
      expect(result.current).toHaveProperty('visibleNodeTypes');
      expect(result.current).toHaveProperty('visibleEdgeTypes');
      expect(result.current).toHaveProperty('heatmapMode');
    });
  });

  describe('useGraphPerformance', () => {
    it('returns performance fields', () => {
      const { result } = renderHook(() => useGraphPerformance());
      expect(result.current).toHaveProperty('performanceDegradations');
      expect(result.current).toHaveProperty('lodLevel');
      expect(result.current).toHaveProperty('lodEnabled');
    });
  });

  describe('useGraphActions', () => {
    it('returns all action functions', () => {
      const { result } = renderHook(() => useGraphActions());
      expect(typeof result.current.setLayout).toBe('function');
      expect(typeof result.current.setTheme).toBe('function');
      expect(typeof result.current.setSelectedNode).toBe('function');
      expect(typeof result.current.setGraphData).toBe('function');
      expect(typeof result.current.expandNode).toBe('function');
      expect(typeof result.current.collapseNode).toBe('function');
      expect(typeof result.current.assembleMicro).toBe('function');
    });

    it('actions are stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useGraphActions());
      const firstSetLayout = result.current.setLayout;
      rerender();
      expect(result.current.setLayout).toBe(firstSetLayout);
    });
  });

  describe('usePanelDimensions', () => {
    it('returns panelHeight and panelWidth', () => {
      const { result } = renderHook(() => usePanelDimensions());
      expect(result.current).toHaveProperty('panelHeight');
      expect(result.current).toHaveProperty('panelWidth');
    });
  });
});