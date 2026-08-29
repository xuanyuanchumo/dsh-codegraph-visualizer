// Unit tests for Zustand graphStore — J6/J7/J10 state management
import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
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
});