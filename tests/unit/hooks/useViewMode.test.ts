// @vitest-environment jsdom
// Unit tests for useViewMode hook — view mode switching logic
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ViewMode } from '../../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../../helpers.ts';

// ── Use vi.hoisted to define mocks that vi.mock factories can reference ──
const { mockStoreState, useGraphStoreMock } = vi.hoisted(() => {
  const storeState = {
    setViewMode: vi.fn(),
    setLoading: vi.fn(),
    setGraphData: vi.fn(),
    setError: vi.fn(),
    setGraphType: vi.fn(),
    setFilterType: vi.fn(),
    setSelectedFunction: vi.fn(),
    setSelectedNode: vi.fn(),
    setHighlightedNodes: vi.fn(),
    assembleMultiFunction: vi.fn(),
    setBootstrapData: vi.fn(),
    loadBootstrap: vi.fn(),
  };

  const storeMock = Object.assign(
    vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState)),
    { getState: vi.fn(() => storeState) },
  );

  return {
    mockStoreState: storeState,
    useGraphStoreMock: storeMock,

  };
});

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: useGraphStoreMock,
}));


// ── Import after mocks are set up ───────────────────────────────────
import { useViewMode } from '../../../src/client/hooks/useViewMode.ts';

// ── Test helpers ────────────────────────────────────────────────────
function makeMockFetchResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

describe('useViewMode', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let depsFetchAbortRef: { current: AbortController | null };

  beforeEach(() => {
    // Reset all mock functions
    mockStoreState.setViewMode.mockReset();
    mockStoreState.setLoading.mockReset();
    mockStoreState.setGraphData.mockReset();
    mockStoreState.setError.mockReset();
    mockStoreState.setGraphType.mockReset();
    mockStoreState.setFilterType.mockReset();
    mockStoreState.setSelectedFunction.mockReset();
    mockStoreState.setSelectedNode.mockReset();
    mockStoreState.setHighlightedNodes.mockReset();
    mockStoreState.assembleMultiFunction.mockReset();
    mockStoreState.setBootstrapData.mockReset();
    mockStoreState.loadBootstrap.mockReset();
    mockStoreState.loadBootstrap.mockResolvedValue(false);

    useGraphStoreMock.getState.mockReset();
    useGraphStoreMock.getState.mockReturnValue(mockStoreState);
    useGraphStoreMock.mockImplementation((selector: (s: typeof mockStoreState) => unknown) =>
      selector(mockStoreState),
    );

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    // Fresh abort ref for each test
    depsFetchAbortRef = { current: null };
  });

  function renderViewModeHook(
    viewMode: ViewMode = 'code',
    currentWorkspace = 'test-workspace',
  ) {
    return renderHook(
      (props: {
        viewMode: ViewMode;
        currentWorkspace: string;
        depsFetchAbortRef: { current: AbortController | null };
      }) =>
        useViewMode(props.viewMode, props.currentWorkspace, props.depsFetchAbortRef),
      {
        initialProps: { viewMode, currentWorkspace, depsFetchAbortRef },
      },
    );
  }

  // ── handleViewModeChange ──────────────────────────────────────────

  describe('handleViewModeChange', () => {
    it('should do nothing when switching to the same mode', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.setViewMode).not.toHaveBeenCalled();
      expect(mockStoreState.setSelectedNode).not.toHaveBeenCalled();
    });

    it('should clear selected node and highlighted nodes on any mode switch', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('inheritance');
      });

      expect(mockStoreState.setSelectedNode).toHaveBeenCalledWith(null);
      expect(mockStoreState.setHighlightedNodes).toHaveBeenCalledWith([]);
    });

    // ── code mode ───────────────────────────────────────────────────

    it('should switch to code mode via bootstrap successfully', async () => {
      mockStoreState.loadBootstrap.mockResolvedValue(true);

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.loadBootstrap).toHaveBeenCalledTimes(1);
      expect(mockStoreState.setGraphType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setFilterType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(true);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('code');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should set error when loadBootstrap returns false', async () => {
      mockStoreState.loadBootstrap.mockResolvedValue(false);

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.setError).toHaveBeenCalledWith('Failed to load code graph data');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
      expect(mockStoreState.setViewMode).not.toHaveBeenCalled();
    });

    it('should set error when loadBootstrap throws', async () => {
      mockStoreState.loadBootstrap.mockRejectedValue(new Error('Network error'));

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.setError).toHaveBeenCalledWith('Failed to load code graph: Network error');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should use bootstrap when loadBootstrap returns true and skip fetchGraphData', async () => {
      mockStoreState.loadBootstrap.mockResolvedValue(true);

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.loadBootstrap).toHaveBeenCalledTimes(1);

      expect(mockStoreState.setGraphType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setFilterType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(true);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('code');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should set error when loadBootstrap throws', async () => {
      mockStoreState.loadBootstrap.mockRejectedValue(new Error('bootstrap network error'));

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.loadBootstrap).toHaveBeenCalledTimes(1);
      expect(mockStoreState.setError).toHaveBeenCalledWith('Failed to load code graph: bootstrap network error');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should abort previous dependencies fetch when switching to code mode', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const controller = new AbortController();
      depsFetchAbortRef.current = controller;

      mockStoreState.loadBootstrap.mockResolvedValue(true);

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
    });

    // ── dependencies mode ───────────────────────────────────────────

    it('should switch to dependencies mode and fetch dependency data successfully', async () => {
      const depData = {
        nodes: [makeNode('n1', 'A', 'module', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'dependency')],
        metadata: { repoId: 'dep-repo' },
      };
      mockFetch.mockResolvedValue(makeMockFetchResponse(depData));

      const { result } = renderViewModeHook('code');

      await act(async () => {
        result.current.handleViewModeChange('dependencies');
      });

      await waitFor(() => {
        expect(mockStoreState.setViewMode).toHaveBeenCalledWith('dependencies');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/codegraph/dependencies',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(mockStoreState.setGraphType).toHaveBeenCalledWith('dependency');
      expect(mockStoreState.setFilterType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(true);
      expect(mockStoreState.setGraphData).toHaveBeenCalledWith(
        depData.nodes,
        depData.edges,
        'dep-repo',
      );
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should use currentWorkspace when metadata.repoId is missing', async () => {
      const depData = {
        nodes: [makeNode('n1', 'A', 'module', 'a.ts', 1)],
        edges: [],
      };
      mockFetch.mockResolvedValue(makeMockFetchResponse(depData));

      const { result } = renderViewModeHook('code', 'my-workspace');

      await act(async () => {
        result.current.handleViewModeChange('dependencies');
      });

      await waitFor(() => {
        expect(mockStoreState.setGraphData).toHaveBeenCalledWith(
          depData.nodes,
          depData.edges,
          'my-workspace',
        );
      });
    });

    it('should not switch view mode when dependencies data has empty nodes', async () => {
      const depData = { nodes: [], edges: [], metadata: { repoId: 'r' } };
      mockFetch.mockResolvedValue(makeMockFetchResponse(depData));

      const { result } = renderViewModeHook('code');

      await act(async () => {
        result.current.handleViewModeChange('dependencies');
      });

      await waitFor(() => {
        expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
      });

      expect(mockStoreState.setViewMode).not.toHaveBeenCalledWith('dependencies');
      expect(mockStoreState.setGraphData).not.toHaveBeenCalled();
    });

    it('should set error when dependencies fetch returns non-ok response', async () => {
      mockFetch.mockResolvedValue(makeMockFetchResponse({}, false, 500));

      const { result } = renderViewModeHook('code');

      await act(async () => {
        result.current.handleViewModeChange('dependencies');
      });

      await waitFor(() => {
        expect(mockStoreState.setError).toHaveBeenCalledWith(
          'Failed to load dependencies: HTTP 500',
        );
      });
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should set error when dependencies fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const { result } = renderViewModeHook('code');

      await act(async () => {
        result.current.handleViewModeChange('dependencies');
      });

      await waitFor(() => {
        expect(mockStoreState.setError).toHaveBeenCalledWith(
          'Failed to load dependencies: Connection refused',
        );
      });
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should store AbortController in depsFetchAbortRef when fetching dependencies', async () => {
      const depData = {
        nodes: [makeNode('n1', 'A', 'module', 'a.ts', 1)],
        edges: [],
        metadata: { repoId: 'r' },
      };
      mockFetch.mockResolvedValue(makeMockFetchResponse(depData));

      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('dependencies');
      });

      expect(depsFetchAbortRef.current).toBeInstanceOf(AbortController);

      await waitFor(() => {
        expect(mockStoreState.setViewMode).toHaveBeenCalledWith('dependencies');
      });
    });

    // ── macro view modes (inheritance/callgraph/package/class) ───────

    it('should switch to inheritance mode directly with no API call', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('inheritance');
      });

      expect(mockFetch).not.toHaveBeenCalled();

      expect(mockStoreState.setGraphType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setFilterType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('inheritance');
    });

    it('should switch to callgraph mode directly with no API call', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('callgraph');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('callgraph');
    });

    it('should switch to package mode directly with no API call', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('package');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('package');
    });

    it('should switch to class mode directly with no API call', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('class');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('class');
    });

    // ── micro view modes (cfg/flowchart/sequence) ───────────────────

    it('should switch to cfg mode without clearing selectedFunction', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('cfg');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStoreState.setGraphType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setFilterType).toHaveBeenCalledWith('all');
      expect(mockStoreState.setSelectedFunction).not.toHaveBeenCalled();
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('cfg');
    });

    it('should switch to flowchart mode without clearing selectedFunction', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('flowchart');
      });

      expect(mockStoreState.setSelectedFunction).not.toHaveBeenCalled();
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('flowchart');
    });

    it('should switch to sequence mode without clearing selectedFunction', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('sequence');
      });

      expect(mockStoreState.setSelectedFunction).not.toHaveBeenCalled();
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('sequence');
    });

    it('should abort previous dependencies fetch when switching to a macro/micro mode', () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const controller = new AbortController();
      depsFetchAbortRef.current = controller;

      const { result } = renderViewModeHook('dependencies');

      act(() => {
        result.current.handleViewModeChange('inheritance');
      });

      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
    });
  });

  // ── handleSelectFunction ──────────────────────────────────────────

  describe('handleSelectFunction', () => {
    it('should set selectedFunction and switch to micro view mode', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleSelectFunction('n1', 'src/a.ts', 'foo', 'cfg');
      });

      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith({
        nodeId: 'n1',
        filePath: 'src/a.ts',
        functionName: 'foo',
      });
      expect(mockStoreState.setSelectedNode).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('cfg');
    });

    it('should save current macro view mode to prevMacroViewModeRef', () => {
      const { result } = renderViewModeHook('dependencies');

      act(() => {
        result.current.handleSelectFunction('n1', 'src/a.ts', 'foo', 'cfg');
      });

      // After selecting a function from dependencies mode,
      // handleCloseMicroView should restore to 'dependencies'
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('dependencies');
    });

    it('should not update prevMacroViewModeRef when already in a micro mode', () => {
      const { result, rerender } = renderViewModeHook('code');

      // First: switch from code to cfg — prevMacroViewModeRef should be 'code'
      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'cfg');
      });

      // Rerender with viewMode='cfg' to simulate the view mode having changed
      rerender({ viewMode: 'cfg', currentWorkspace: 'test-workspace', depsFetchAbortRef });

      // Second: switch from cfg to flowchart — prevMacroViewModeRef should remain 'code'
      act(() => {
        result.current.handleSelectFunction('n2', 'b.ts', 'bar', 'flowchart');
      });

      // Close micro view — should restore to 'code', not 'cfg'
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('code');
    });

    it('should support all three micro view mode targets', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'cfg');
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('cfg');

      mockStoreState.setViewMode.mockReset();

      act(() => {
        result.current.handleSelectFunction('n2', 'b.ts', 'bar', 'flowchart');
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('flowchart');

      mockStoreState.setViewMode.mockReset();

      act(() => {
        result.current.handleSelectFunction('n3', 'c.ts', 'baz', 'sequence');
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('sequence');
    });
  });

  // ── handleCloseMicroView ──────────────────────────────────────────

  describe('handleCloseMicroView', () => {
    it('should clear selectedFunction and restore previous macro view mode', () => {
      const { result } = renderViewModeHook('code');

      // Enter micro view from code mode
      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'cfg');
      });

      // Close micro view
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('code');
    });

    it('should restore to dependencies when previously in dependencies mode', () => {
      const { result } = renderViewModeHook('dependencies');

      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'flowchart');
      });

      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('dependencies');
    });

    it('should fallback to code when prevMacroViewModeRef is a micro mode', () => {
      const { result } = renderViewModeHook('cfg');

      // Since viewMode is already 'cfg' (a micro mode), handleSelectFunction
      // won't update prevMacroViewModeRef, so it stays at the default 'code'.
      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'flowchart');
      });

      // prevMacroViewModeRef is 'code' (default), so closing should restore to 'code'
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('code');
    });

    it('should clear selectedFunction on close', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'cfg');
      });

      act(() => {
        result.current.handleCloseMicroView();
      });

      const calls = mockStoreState.setSelectedFunction.mock.calls;
      expect(calls.some((c) => c[0] === null)).toBe(true);
    });
  });

  // ── handleAggregateCallChain ──────────────────────────────────────

  describe('handleAggregateCallChain', () => {
    it('should call assembleMultiFunction with the given nodeId', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleAggregateCallChain('n1');
      });

      expect(mockStoreState.assembleMultiFunction).toHaveBeenCalledWith('n1');
    });

    it('should clear selectedFunction and selectedNode', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleAggregateCallChain('n1');
      });

      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setSelectedNode).toHaveBeenCalledWith(null);
    });

    it('should save current macro view mode to prevMacroViewModeRef', () => {
      const { result } = renderViewModeHook('callgraph');

      act(() => {
        result.current.handleAggregateCallChain('n1');
      });

      // After aggregate call chain from callgraph mode,
      // close micro view should restore to 'callgraph'
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('callgraph');
    });

    it('should not update prevMacroViewModeRef when already in a micro mode', () => {
      const { result, rerender } = renderViewModeHook('code');

      // First: aggregate from code mode — prevMacroViewModeRef = 'code'
      act(() => {
        result.current.handleAggregateCallChain('n1');
      });

      // Rerender with viewMode='cfg'
      rerender({ viewMode: 'cfg', currentWorkspace: 'test-workspace', depsFetchAbortRef });

      // Second: aggregate from cfg mode — prevMacroViewModeRef should remain 'code'
      act(() => {
        result.current.handleAggregateCallChain('n2');
      });

      // Close micro view — should restore to 'code'
      act(() => {
        result.current.handleCloseMicroView();
      });

      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('code');
    });
  });

  // ── Integration: full workflow ────────────────────────────────────

  describe('integration workflows', () => {
    it('should handle a full code → cfg → close → code workflow', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleSelectFunction('n1', 'a.ts', 'foo', 'cfg');
      });
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith({
        nodeId: 'n1',
        filePath: 'a.ts',
        functionName: 'foo',
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('cfg');

      act(() => {
        result.current.handleCloseMicroView();
      });
      expect(mockStoreState.setSelectedFunction).toHaveBeenCalledWith(null);
      expect(mockStoreState.setViewMode).toHaveBeenLastCalledWith('code');
    });

    it('should handle a full dependencies → code workflow via bootstrap', async () => {
      mockStoreState.loadBootstrap.mockResolvedValue(true);

      const { result } = renderViewModeHook('dependencies');

      await act(async () => {
        result.current.handleViewModeChange('code');
      });

      expect(mockStoreState.loadBootstrap).toHaveBeenCalled();
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('code');
      expect(mockStoreState.setLoading).toHaveBeenCalledWith(false);
    });

    it('should handle switching through multiple macro view modes', () => {
      const { result } = renderViewModeHook('code');

      act(() => {
        result.current.handleViewModeChange('inheritance');
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('inheritance');
      expect(mockStoreState.setSelectedNode).toHaveBeenCalledWith(null);
      expect(mockStoreState.setHighlightedNodes).toHaveBeenCalledWith([]);

      mockStoreState.setSelectedNode.mockReset();
      mockStoreState.setHighlightedNodes.mockReset();

      act(() => {
        result.current.handleViewModeChange('callgraph');
      });
      expect(mockStoreState.setViewMode).toHaveBeenCalledWith('callgraph');
      expect(mockStoreState.setSelectedNode).toHaveBeenCalledWith(null);
      expect(mockStoreState.setHighlightedNodes).toHaveBeenCalledWith([]);
    });
  });
});
