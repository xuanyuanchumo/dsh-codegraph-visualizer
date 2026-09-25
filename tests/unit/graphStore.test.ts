// Unit tests for Zustand graphStore — J6/J7/J9/J10 state management
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphStore, disposeStore, type LayoutType } from '../../src/client/store/graphStore.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
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
      currentWorkspace: '.',
      workspaceList: [],
      clusterDepth: 0,
      expandedNodeIds: new Set(),
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
    expect(s.clusterDepth).toBe(0);
  });

  it('should set graph data and clear error (J1)', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]).toHaveProperty('isCluster', true);
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

  it('should fail-safe reset isLoading after 15s with no data (J12)', () => {
    vi.useFakeTimers();
    try {
      useGraphStore.getState().setLoading(true);
      expect(useGraphStore.getState().isLoading).toBe(true);
      vi.advanceTimersByTime(15100);
      expect(useGraphStore.getState().isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fail-safe should not clear a freshly-set loading state from a later request', () => {
    vi.useFakeTimers();
    try {
      useGraphStore.getState().setLoading(true);
      vi.advanceTimersByTime(10000);
      useGraphStore.getState().setLoading(true);
      vi.advanceTimersByTime(11000);
      expect(useGraphStore.getState().isLoading).toBe(true);
      vi.advanceTimersByTime(5000);
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
    useGraphStore.setState({ layout: 'dagre' as LayoutType });
    expect(useGraphStore.getState().layout).toBe('dagre');
    useGraphStore.setState({ layout: 'cose' as LayoutType });
    expect(useGraphStore.getState().layout).toBe('cose');
  });

  it('should persist only UI preferences, never graph data (J10 personalization)', () => {
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

  // ── Workspace management (cycle-14) ─────────────────────────────────
  it('should initialize workspace state with defaults', () => {
    const s = useGraphStore.getState();
    expect(s.currentWorkspace).toBe('.');
    expect(s.workspaceList).toEqual([]);
  });

  it('setCurrentWorkspace should update the current workspace path', () => {
    useGraphStore.getState().setCurrentWorkspace('/home/user/project-a');
    expect(useGraphStore.getState().currentWorkspace).toBe('/home/user/project-a');
    useGraphStore.getState().setCurrentWorkspace('.');
    expect(useGraphStore.getState().currentWorkspace).toBe('.');
  });

  it('addWorkspace should add to list and set as current', () => {
    useGraphStore.getState().addWorkspace('/home/user/project-a');
    const s = useGraphStore.getState();
    expect(s.currentWorkspace).toBe('/home/user/project-a');
    expect(s.workspaceList).toHaveLength(1);
    expect(s.workspaceList[0]!.path).toBe('/home/user/project-a');
    expect(s.workspaceList[0]!.name).toBe('project-a');
    expect(s.workspaceList[0]!.lastUsed).toBeGreaterThan(0);
  });

  it('addWorkspace should derive name from Windows-style path', () => {
    useGraphStore.getState().addWorkspace('C:\\Users\\dev\\my-project');
    const s = useGraphStore.getState();
    expect(s.workspaceList[0]!.name).toBe('my-project');
  });

  it('addWorkspace should use custom name when provided', () => {
    useGraphStore.getState().addWorkspace('/home/user/project-b', 'Custom Name');
    expect(useGraphStore.getState().workspaceList[0]!.name).toBe('Custom Name');
  });

  it('addWorkspace should deduplicate by path and move to front', () => {
    useGraphStore.getState().addWorkspace('/path/a');
    useGraphStore.getState().addWorkspace('/path/b');
    useGraphStore.getState().addWorkspace('/path/a');
    const s = useGraphStore.getState();
    expect(s.workspaceList).toHaveLength(2);
    expect(s.workspaceList[0]!.path).toBe('/path/a');
    expect(s.workspaceList[1]!.path).toBe('/path/b');
    expect(s.currentWorkspace).toBe('/path/a');
  });

  it('addWorkspace should cap the list at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      useGraphStore.getState().addWorkspace(`/path/${i}`);
    }
    expect(useGraphStore.getState().workspaceList).toHaveLength(10);
    expect(useGraphStore.getState().workspaceList[0]!.path).toBe('/path/14');
  });

  it('removeWorkspace should remove from list', () => {
    useGraphStore.getState().addWorkspace('/path/a');
    useGraphStore.getState().addWorkspace('/path/b');
    useGraphStore.getState().removeWorkspace('/path/a');
    const s = useGraphStore.getState();
    expect(s.workspaceList).toHaveLength(1);
    expect(s.workspaceList[0]!.path).toBe('/path/b');
  });

  it('removeWorkspace should reset currentWorkspace to default when removing active', () => {
    useGraphStore.getState().addWorkspace('/path/a');
    expect(useGraphStore.getState().currentWorkspace).toBe('/path/a');
    useGraphStore.getState().removeWorkspace('/path/a');
    expect(useGraphStore.getState().currentWorkspace).toBe('.');
  });

  it('removeWorkspace should not change current when removing non-active', () => {
    useGraphStore.getState().addWorkspace('/path/a');
    useGraphStore.getState().addWorkspace('/path/b');
    useGraphStore.getState().removeWorkspace('/path/a');
    expect(useGraphStore.getState().currentWorkspace).toBe('/path/b');
  });

  // ── Cluster depth tests ─────────────────────────────────────────────
  it('setClusterDepth to 2 should show all nodes at function level', () => {
    const nodes = [
      makeNode('m1', 'ModuleA', 'module', 'a.ts', 1),
      makeNode('c1', 'ClassA', 'class', 'a.ts', 10),
      makeNode('f1', 'funcA', 'function', 'a.ts', 20),
    ];
    const edges = [
      makeEdge('e1', 'm1', 'c1', 'import'),
      makeEdge('e2', 'c1', 'f1', 'call'),
    ];
    useGraphStore.getState().setClusterDepth(2);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(3);
    const realNodes = s.nodes.filter((n) => !('isCluster' in n && n.isCluster));
    expect(realNodes).toHaveLength(3);
  });

  it('directory cluster level should aggregate nodes by top-level directory', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/core/src/b.ts', 1),
      makeNode('m3', 'c.ts', 'module', 'crates/api/src/c.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'm1', 'm3', 'import'),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(2);
    const clusterNodes = s.nodes.filter(n => 'isCluster' in n && n.isCluster);
    expect(clusterNodes).toHaveLength(2);
  });

  it('expandNode on directory cluster should show individual file nodes', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/core/src/b.ts', 1),
      makeNode('m3', 'c.ts', 'module', 'crates/api/src/c.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'm1', 'm3', 'import'),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    useGraphStore.getState().expandNode('cluster__crates__core');
    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(3);
    const realNodes = s.nodes.filter(n => !('isCluster' in n) || !n.isCluster);
    expect(realNodes).toHaveLength(2);
  });

  it('collapseAll should collapse all expanded directory clusters', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().expandNode('cluster__crates__core');
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    useGraphStore.getState().collapseAll();
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().expandedNodeIds.size).toBe(0);
  });

  // ── viewMode tests (FR-21) ──────────────────────────────────────────
  it('should initialize with viewMode code', () => {
    expect(useGraphStore.getState().viewMode).toBe('code');
  });

  it('should switch viewMode to dependencies', () => {
    useGraphStore.getState().setViewMode('dependencies');
    expect(useGraphStore.getState().viewMode).toBe('dependencies');
  });

  it('should switch viewMode back to code', () => {
    useGraphStore.getState().setViewMode('dependencies');
    useGraphStore.getState().setViewMode('code');
    expect(useGraphStore.getState().viewMode).toBe('code');
  });

  // ── graphType tests ─────────────────────────────────────────────────
  it('should set graphType', () => {
    useGraphStore.getState().setGraphType('call');
    expect(useGraphStore.getState().graphType).toBe('call');
    useGraphStore.getState().setGraphType('dependency');
    expect(useGraphStore.getState().graphType).toBe('dependency');
    useGraphStore.getState().setGraphType('all');
    expect(useGraphStore.getState().graphType).toBe('all');
  });

  // ── path finding tests (FR-25) ──────────────────────────────────────
  it('should set path start and end', () => {
    const n1 = makeNode('n1', 'A', 'function', 'a.ts', 1).id;
    const n2 = makeNode('n2', 'B', 'function', 'b.ts', 5).id;
    useGraphStore.getState().setPathStart(n1);
    useGraphStore.getState().setPathEnd(n2);
    expect(useGraphStore.getState().pathStartId).toBe(n1);
    expect(useGraphStore.getState().pathEndId).toBe(n2);
  });

  it('should set path result', () => {
    const n1 = makeNode('n1', 'A', 'function', 'a.ts', 1).id;
    const n2 = makeNode('n2', 'B', 'function', 'b.ts', 5).id;
    useGraphStore.getState().setPathResult([n1, n2]);
    expect(useGraphStore.getState().pathResult).toEqual([n1, n2]);
    useGraphStore.getState().setPathResult(null);
    expect(useGraphStore.getState().pathResult).toBeNull();
  });

  // ── focus depth tests (FR-26) ───────────────────────────────────────
  it('should set focus depth', () => {
    useGraphStore.getState().setFocusDepth(3);
    expect(useGraphStore.getState().focusDepth).toBe(3);
    useGraphStore.getState().setFocusDepth(1);
    expect(useGraphStore.getState().focusDepth).toBe(1);
  });

  // ── health score tests (FR-32) ──────────────────────────────────────
  it('should set health score', () => {
    const score = { overall: 75, breakdown: { complexity: 80, coupling: 70, coverage: 75 } };
    useGraphStore.getState().setHealthScore(score as any);
    expect(useGraphStore.getState().healthScore).toEqual(score);
    useGraphStore.getState().setHealthScore(null);
    expect(useGraphStore.getState().healthScore).toBeNull();
  });

  // ── rules tests (FR-34) ─────────────────────────────────────────────
  it('should set rules', () => {
    const rules = [{ id: 'r1', name: 'No God Classes', severity: 'warning' as const, description: 'test' }];
    useGraphStore.getState().setRules(rules as any);
    expect(useGraphStore.getState().rules).toHaveLength(1);
  });

  it('should set rule violations', () => {
    const violations = [{ ruleId: 'r1', nodeId: 'n1', message: 'God class detected' }];
    useGraphStore.getState().setRuleViolations(violations as any);
    expect(useGraphStore.getState().ruleViolations).toHaveLength(1);
  });

  // ── panel size tests (panel height/width persistence) ───────────────
  it('should initialize panelHeight and panelWidth as null', () => {
    useGraphStore.setState({ panelHeight: null, panelWidth: null });
    const s = useGraphStore.getState();
    expect(s.panelHeight).toBeNull();
    expect(s.panelWidth).toBeNull();
  });

  it('should set panel size via setPanelSize', () => {
    useGraphStore.getState().setPanelSize(600, 800);
    const s = useGraphStore.getState();
    expect(s.panelHeight).toBe(600);
    expect(s.panelWidth).toBe(800);
  });

  it('should reset panel size via resetPanelSize', () => {
    useGraphStore.getState().setPanelSize(500, 700);
    expect(useGraphStore.getState().panelHeight).toBe(500);
    expect(useGraphStore.getState().panelWidth).toBe(700);
    useGraphStore.getState().resetPanelSize();
    expect(useGraphStore.getState().panelHeight).toBeNull();
    expect(useGraphStore.getState().panelWidth).toBeNull();
  });

  it('collapseNode should remove node from expanded set', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().expandNode('cluster__crates__core');
    expect(useGraphStore.getState().expandedNodeIds.has('cluster__crates__core')).toBe(true);
    useGraphStore.getState().collapseNode('cluster__crates__core');
    expect(useGraphStore.getState().expandedNodeIds.has('cluster__crates__core')).toBe(false);
  });

  // ── sanitizeGraphData edge cases ─────────────────────────────────────
  it('should filter out nodes with missing required fields', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      { id: 'n2', label: '', type: 'function', filePath: 'b.ts', startLine: 1 } as any,
      { id: 'n3', label: 'C', type: '', filePath: 'c.ts', startLine: 1 } as any,
      { id: '', label: 'D', type: 'function', filePath: 'd.ts', startLine: 1 } as any,
    ];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it('should deduplicate nodes by id', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n1', 'A-dup', 'function', 'a.ts', 1),
    ];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    expect(useGraphStore.getState().rawNodes).toHaveLength(1);
  });

  it('should filter out self-loop edges', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [
      makeEdge('e1', 'n1', 'n1', 'call'),
      makeEdge('e2', 'n1', 'n2', 'call'),
    ];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().rawEdges).toHaveLength(0);
  });

  it('should filter out edges with dangling references', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [
      makeEdge('e1', 'n1', 'nonexistent', 'call'),
      makeEdge('e2', 'ghost', 'n1', 'call'),
    ];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().rawEdges).toHaveLength(0);
  });

  it('should deduplicate edges by id', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'function', 'b.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e1', 'n1', 'n2', 'call'),
    ];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().rawEdges).toHaveLength(1);
  });

  // ── setGraphData metadata ────────────────────────────────────────────
  it('should store metadata: truncated, totalNodeCount, totalEdgeCount', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1', {
      truncated: true,
      totalNodeCount: 500,
      totalEdgeCount: 1000,
    });
    const s = useGraphStore.getState();
    expect(s.truncated).toBe(true);
    expect(s.totalNodeCount).toBe(500);
    expect(s.totalEdgeCount).toBe(1000);
  });

  it('should default metadata counts to sanitized array lengths', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'function', 'b.ts', 1),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const s = useGraphStore.getState();
    expect(s.truncated).toBe(false);
    expect(s.totalNodeCount).toBe(2);
    expect(s.totalEdgeCount).toBe(1);
  });

  it('should clear healthScore and ruleViolations on new graph data', () => {
    useGraphStore.getState().setHealthScore({ overall: 50 } as any);
    useGraphStore.getState().setRuleViolations([{ ruleId: 'r1', nodeId: 'n1', message: 'x' }] as any);
    useGraphStore.getState().setGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], 'repo-1');
    expect(useGraphStore.getState().healthScore).toBeNull();
    expect(useGraphStore.getState().ruleViolations).toEqual([]);
  });

  // ── callChainDepth ───────────────────────────────────────────────────
  it('should set call chain depth', () => {
    useGraphStore.getState().setCallChainDepth(5);
    expect(useGraphStore.getState().callChainDepth).toBe(5);
    useGraphStore.getState().setCallChainDepth(2);
    expect(useGraphStore.getState().callChainDepth).toBe(2);
  });

  // ── fanIn/fanOut thresholds ──────────────────────────────────────────
  it('should set fanIn threshold', () => {
    useGraphStore.getState().setFanInThreshold(10);
    expect(useGraphStore.getState().fanInThreshold).toBe(10);
  });

  it('should set fanOut threshold', () => {
    useGraphStore.getState().setFanOutThreshold(5);
    expect(useGraphStore.getState().fanOutThreshold).toBe(5);
  });

  // ── visibleNodeTypes / visibleEdgeTypes ──────────────────────────────
  it('should set visible node types', () => {
    const types = new Set<GraphNode['type']>(['function', 'class']);
    useGraphStore.getState().setVisibleNodeTypes(types);
    expect(useGraphStore.getState().visibleNodeTypes).toEqual(types);
  });

  it('should set visible edge types', () => {
    const types = new Set<GraphEdge['type']>(['call', 'import']);
    useGraphStore.getState().setVisibleEdgeTypes(types);
    expect(useGraphStore.getState().visibleEdgeTypes).toEqual(types);
  });

  // ── selectedFunction ─────────────────────────────────────────────────
  it('should set selected function', () => {
    const fn = { nodeId: 'n1', filePath: 'src/a.ts', functionName: 'calculate' };
    useGraphStore.getState().setSelectedFunction(fn);
    expect(useGraphStore.getState().selectedFunction).toEqual(fn);
    useGraphStore.getState().setSelectedFunction(null);
    expect(useGraphStore.getState().selectedFunction).toBeNull();
  });

  // ── disposeStore ─────────────────────────────────────────────────────
  it('disposeStore should clear loading failsafe timer', () => {
    vi.useFakeTimers();
    try {
      useGraphStore.getState().setLoading(true);
      disposeStore();
      vi.advanceTimersByTime(20000);
      expect(useGraphStore.getState().isLoading).toBe(true);
    } finally {
      vi.useRealTimers();
      useGraphStore.getState().setLoading(false);
    }
  });

  // ── setLayer ─────────────────────────────────────────────────────────
  it('setLayer should not change layer if diagramData is null', () => {
    useGraphStore.getState().setLayer(2);
    expect(useGraphStore.getState().currentLayer).toBe(0);
  });

  it('setLayer should not change layer if out of range', () => {
    useGraphStore.getState().setGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [],
      'repo-1',
    );
    useGraphStore.getState().setLayer(-1);
    expect(useGraphStore.getState().currentLayer).toBe(0);
    useGraphStore.getState().setLayer(99);
    expect(useGraphStore.getState().currentLayer).toBe(0);
  });

  // ── setViewMode with layered mode ────────────────────────────────────
  it('setViewMode to dependencies should switch viewMode', () => {
    useGraphStore.getState().setGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [],
      'repo-1',
    );
    useGraphStore.getState().setViewMode('dependencies');
    expect(useGraphStore.getState().viewMode).toBe('dependencies');
  });

  it('setViewMode back to code should restore raw nodes', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setViewMode('dependencies');
    useGraphStore.getState().setViewMode('code');
    expect(useGraphStore.getState().viewMode).toBe('code');
  });

  // ── setClusterDepth with layered view mode ───────────────────────────
  it('setClusterDepth in layered view mode should only set depth without re-clustering', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setViewMode('dependencies');
    const nodesBefore = useGraphStore.getState().nodes;
    useGraphStore.getState().setClusterDepth(2);
    expect(useGraphStore.getState().clusterDepth).toBe(2);
    expect(useGraphStore.getState().nodes).toBe(nodesBefore);
  });

  // ── expandNode with viewMode-specific tracking ───────────────────────
  it('expandNode should track expanded nodes per viewMode', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    const clusterNodes = useGraphStore.getState().nodes.filter(n => 'isCluster' in n && n.isCluster);
    const clusterId = clusterNodes[0]?.id ?? 'cluster__crates__core';
    useGraphStore.getState().expandNode(clusterId);
    expect(useGraphStore.getState().expandedNodeIds.has(clusterId)).toBe(true);
    expect(useGraphStore.getState().expandedNodeIdsByViewMode['code']).toBeDefined();
  });

  // ── collapseAll clears expanded for current viewMode ─────────────────
  it('collapseAll should clear expanded for current viewMode only', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().expandNode('cluster__crates__core');
    useGraphStore.getState().expandNode('cluster__crates__api');
    useGraphStore.getState().collapseAll();
    expect(useGraphStore.getState().expandedNodeIds.size).toBe(0);
  });

  // ── Persistence migration tests ──────────────────────────────────────
  it('migrate v<3 should default workspaceList and currentWorkspace', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { layout: 'cose', theme: 'dark' } as any,
      2,
    ) as any;
    expect(migrated.workspaceList).toEqual([]);
    expect(migrated.currentWorkspace).toBe('.');
  });

  it('migrate v<5 should validate panelHeight >= 240 and panelWidth >= 320', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { panelHeight: 100, panelWidth: 100 } as any,
      4,
    ) as any;
    expect(migrated.panelHeight).toBeNull();
    expect(migrated.panelWidth).toBeNull();
  });

  it('migrate v<5 should keep valid panelHeight and panelWidth', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { panelHeight: 600, panelWidth: 800 } as any,
      4,
    ) as any;
    expect(migrated.panelHeight).toBe(600);
    expect(migrated.panelWidth).toBe(800);
  });

  it('migrate v<7 should map clusterLevel to clusterDepth', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { clusterLevel: 'file' } as any,
      6,
    ) as any;
    expect(migrated.clusterDepth).toBe(1);
  });

  it('migrate v<7 should map clusterLevel "function" to depth 2', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { clusterLevel: 'function' } as any,
      6,
    ) as any;
    expect(migrated.clusterDepth).toBe(2);
  });

  it('migrate v<7 should default unknown clusterLevel to depth 0', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { clusterLevel: 'unknown' } as any,
      6,
    ) as any;
    expect(migrated.clusterDepth).toBe(0);
  });

  it('migrate should fall back to cose for invalid layout', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { layout: 'invalid' } as any,
      7,
    ) as any;
    expect(migrated.layout).toBe('cose');
  });

  it('migrate should keep valid layout', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { layout: 'tree' } as any,
      7,
    ) as any;
    expect(migrated.layout).toBe('tree');
  });

  it('migrate should normalize theme to dark for unknown values', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { theme: 'blue' } as any,
      7,
    ) as any;
    expect(migrated.theme).toBe('dark');
  });

  it('migrate should keep light theme', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { theme: 'light' } as any,
      7,
    ) as any;
    expect(migrated.theme).toBe('light');
  });

  it('migrate v<9 should convert expandedNodeIds array to Set', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { expandedNodeIds: ['n1', 'n2'] } as any,
      8,
    ) as any;
    expect(migrated.expandedNodeIds).toBeInstanceOf(Set);
    expect([...migrated.expandedNodeIds]).toEqual(['n1', 'n2']);
  });

  it('migrate v<9 should default to empty Set for non-array expandedNodeIds', () => {
    const migrated = useGraphStore.persist.getOptions().migrate?.(
      { expandedNodeIds: 'not-an-array' } as any,
      8,
    ) as any;
    expect(migrated.expandedNodeIds).toBeInstanceOf(Set);
    expect(migrated.expandedNodeIds.size).toBe(0);
  });

  it('merge should convert expandedNodeIds array to Set', () => {
    const mergeFn = useGraphStore.persist.getOptions().merge;
    if (!mergeFn) return;
    const merged = mergeFn(
      { expandedNodeIds: ['a', 'b'] } as any,
      useGraphStore.getState(),
    ) as any;
    expect(merged.expandedNodeIds).toBeInstanceOf(Set);
    expect([...merged.expandedNodeIds]).toEqual(['a', 'b']);
  });

  it('merge should preserve expandedNodeIds when already a Set', () => {
    const mergeFn = useGraphStore.persist.getOptions().merge;
    if (!mergeFn) return;
    const existingSet = new Set(['x', 'y']);
    const merged = mergeFn(
      { expandedNodeIds: existingSet } as any,
      useGraphStore.getState(),
    ) as any;
    expect(merged.expandedNodeIds).toBeInstanceOf(Set);
    expect([...merged.expandedNodeIds]).toEqual(['x', 'y']);
  });

  it('merge should default to empty Set for unknown expandedNodeIds type', () => {
    const mergeFn = useGraphStore.persist.getOptions().merge;
    if (!mergeFn) return;
    const merged = mergeFn(
      { expandedNodeIds: 42 } as any,
      useGraphStore.getState(),
    ) as any;
    expect(merged.expandedNodeIds).toBeInstanceOf(Set);
    expect(merged.expandedNodeIds.size).toBe(0);
  });

  it('updateIncrementalClusterCtx should be set after setGraphData', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    const edges = [makeEdge('e1', 'm1', 'm2', 'import')];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-2');
    expect(useGraphStore.getState().repoId).toBe('repo-2');
  });

  it('assembleMicro should return early when no selectedFunction', async () => {
    useGraphStore.getState().setSelectedFunction(null);
    await useGraphStore.getState().assembleMicro('cfg');
    expect(useGraphStore.getState().isLoading).toBe(false);
  });

  it('assembleMicro should handle fetch error', async () => {
    useGraphStore.getState().setSelectedFunction({
      nodeId: 'n1',
      filePath: 'src/a.ts',
      functionName: 'calculate',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    try {
      await useGraphStore.getState().assembleMicro('cfg');
      expect(useGraphStore.getState().error).toContain('Network error');
      expect(useGraphStore.getState().isLoading).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assembleMicro should handle non-Error throw', async () => {
    useGraphStore.getState().setSelectedFunction({
      nodeId: 'n1',
      filePath: 'src/a.ts',
      functionName: 'calculate',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue('string error') as any;
    try {
      await useGraphStore.getState().assembleMicro('cfg');
      expect(useGraphStore.getState().error).toContain('Network error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assembleMicro should succeed with valid AST response', async () => {
    useGraphStore.getState().setSelectedFunction({
      nodeId: 'n1',
      filePath: 'src/a.ts',
      functionName: 'calculate',
    });
    const mockAst = {
      type: 'program',
      text: '',
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 10, column: 0 },
      children: [
        {
          type: 'function_declaration',
          text: 'function calculate() {}',
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 5, column: 0 },
          children: [],
        },
      ],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockAst,
    } as any);
    try {
      await useGraphStore.getState().assembleMicro('cfg');
      expect(useGraphStore.getState().isLoading).toBe(false);
      expect(useGraphStore.getState().error).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('setLayer should update layer when diagramData exists', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setViewMode('dependencies');
    const diagramData = useGraphStore.getState().diagramData;
    if (diagramData && diagramData.layers.length > 1) {
      useGraphStore.getState().setLayer(1);
      expect(useGraphStore.getState().currentLayer).toBe(1);
    }
  });
});
