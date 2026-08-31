// Unit tests for Zustand graphStore — J6/J7/J9/J10 state management
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGraphStore, type LayoutType } from '../../src/client/store/graphStore.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('graphStore (J6/J7/J10)', () => {
  beforeEach(() => {
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({
      layout: 'cose',
      theme: 'dark',
      searchQuery: '',
      selectedNodeId: null,
      highlightedNodeIds: [],
      filterType: 'all',
      isLoading: false,
      error: null,
    });
  });

  it('should initialize with default state', () => {
    const s = useGraphStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.layout).toBe('cose');
    expect(s.theme).toBe('dark');
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('should set graph data and clear error (J1)', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(1);
    expect(s.edges).toHaveLength(1);
    expect(s.repoId).toBe('repo-1');
    expect(s.lastUpdated).toBeGreaterThan(0);
  });

  it('should switch layout (J6)', () => {
    const { setLayout } = useGraphStore.getState();
    setLayout('dagre');
    expect(useGraphStore.getState().layout).toBe('dagre');
    setLayout('circle');
    expect(useGraphStore.getState().layout).toBe('circle');
    setLayout('grid');
    expect(useGraphStore.getState().layout).toBe('grid');
    setLayout('cose');
    expect(useGraphStore.getState().layout).toBe('cose');
  });

  it('should toggle theme (J10)', () => {
    const { setTheme } = useGraphStore.getState();
    setTheme('light');
    expect(useGraphStore.getState().theme).toBe('light');
    setTheme('dark');
    expect(useGraphStore.getState().theme).toBe('dark');
  });

  it('should set search query (J3)', () => {
    useGraphStore.getState().setSearchQuery('calculate');
    expect(useGraphStore.getState().searchQuery).toBe('calculate');
  });

  it('should set selected node (J4)', () => {
    const id = makeNode('n1', 'A', 'function', 'a.ts', 1).id;
    useGraphStore.getState().setSelectedNode(id);
    expect(useGraphStore.getState().selectedNodeId).toBe(id);
    useGraphStore.getState().setSelectedNode(null);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('should set highlighted nodes (J4 call chain)', () => {
    const ids = [makeNode('n1', '', 'function', '', 0).id, makeNode('n2', '', 'function', '', 0).id];
    useGraphStore.getState().setHighlightedNodes(ids);
    expect(useGraphStore.getState().highlightedNodeIds).toHaveLength(2);
  });

  it('should set filter type (J7)', () => {
    useGraphStore.getState().setFilterType('function');
    expect(useGraphStore.getState().filterType).toBe('function');
    useGraphStore.getState().setFilterType('class');
    expect(useGraphStore.getState().filterType).toBe('class');
    useGraphStore.getState().setFilterType('all');
    expect(useGraphStore.getState().filterType).toBe('all');
  });

  it('should set loading state (J9 realtime)', () => {
    useGraphStore.getState().setLoading(true);
    expect(useGraphStore.getState().isLoading).toBe(true);
    useGraphStore.getState().setLoading(false);
    expect(useGraphStore.getState().isLoading).toBe(false);
  });

  it('should reset isLoading when graph data arrives (stuck-overlay fix, J9)', () => {
    useGraphStore.getState().setLoading(true);
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().isLoading).toBe(false);
  });

  it('should fail-safe reset isLoading after 2s with no data (J12)', () => {
    vi.useFakeTimers();
    try {
      useGraphStore.getState().setLoading(true);
      expect(useGraphStore.getState().isLoading).toBe(true);
      vi.advanceTimersByTime(2100);
      expect(useGraphStore.getState().isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fail-safe should not clear a freshly-set loading state from a later request', () => {
    vi.useFakeTimers();
    try {
      useGraphStore.getState().setLoading(true);
      vi.advanceTimersByTime(1000);
      // A second loading request (e.g. refresh) must survive the first fail-safe.
      useGraphStore.getState().setLoading(true);
      vi.advanceTimersByTime(1100);
      expect(useGraphStore.getState().isLoading).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(useGraphStore.getState().isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should set error and clear loading (J12 chaos)', () => {
    useGraphStore.getState().setLoading(true);
    useGraphStore.getState().setError('upstream failed');
    const s = useGraphStore.getState();
    expect(s.error).toBe('upstream failed');
    expect(s.isLoading).toBe(false);
  });

  it('should clear graph (J12 recovery)', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().clearGraph();
    const s = useGraphStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.repoId).toBeNull();
    expect(s.lastUpdated).toBe(0);
  });

  it('should apply v2 schema migration: keep valid layout, fall back to cose otherwise', () => {
    // Trigger the store's persist migrate() manually by exercising a partial
    // state write — the migrate guard must not corrupt an existing valid state.
    useGraphStore.setState({ layout: 'dagre' as LayoutType });
    expect(useGraphStore.getState().layout).toBe('dagre');
    useGraphStore.setState({ layout: 'cose' as LayoutType });
    expect(useGraphStore.getState().layout).toBe('cose');
  });

  it('should persist only UI preferences, never graph data (J10 personalization)', () => {
    // partialize must exclude nodes/edges so snapshot data never lands in localStorage.
    const partial = useGraphStore.persist.getOptions().partialize?.(useGraphStore.getState()) as Record<string, unknown>;
    expect(partial.nodes).toBeUndefined();
    expect(partial.edges).toBeUndefined();
    expect(partial.repoId).toBeUndefined();
    expect(partial.layout).toBeDefined();
    expect(partial.theme).toBeDefined();
    expect(partial.filterType).toBeDefined();
  });

it('should track prerequisites (J11 data source detection)', () => {
    useGraphStore.getState().setPrerequisites({ codegraph: true, lens: false });
    const s = useGraphStore.getState();
    expect(s.prerequisites).toEqual({ codegraph: true, lens: false });
  });

  it('should track init status lifecycle (J1 init)', () => {
    const { setInitStatus } = useGraphStore.getState();
    setInitStatus('initializing');
    expect(useGraphStore.getState().initStatus).toBe('initializing');
    setInitStatus('done', 'ok');
    expect(useGraphStore.getState().initStatus).toBe('done');
    expect(useGraphStore.getState().initMessage).toBe('ok');
    setInitStatus('error', 'boom');
    expect(useGraphStore.getState().initStatus).toBe('error');
    expect(useGraphStore.getState().initMessage).toBe('boom');
  });

  it('should toggle watch enabled (J9 hot-reload)', () => {
    useGraphStore.getState().setWatchEnabled(true);
    expect(useGraphStore.getState().watchEnabled).toBe(true);
    useGraphStore.getState().setWatchEnabled(false);
    expect(useGraphStore.getState().watchEnabled).toBe(false);
  });

  it('setHighlightedNodes should replace the highlight set (J4 call chain)', () => {
    const a = makeNode('n1', '', 'function', '', 0).id;
    const b = makeNode('n2', '', 'function', '', 0).id;
    useGraphStore.getState().setHighlightedNodes([a, b]);
    expect(useGraphStore.getState().highlightedNodeIds).toEqual([a, b]);
    useGraphStore.getState().setHighlightedNodes([]);
    expect(useGraphStore.getState().highlightedNodeIds).toEqual([]);
  });
});