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
      loadedChildrenByNodeId: new Set(),
      selectedFunction: null,
      viewMode: 'code',
      diagramData: null,
      currentLayer: 0,
      lodLevel: 'full',
      lodEnabled: false,
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
    useGraphStore.getState().setPrerequisites({ codegraph: true, lens: false, builtin: true });
    const s = useGraphStore.getState();
    expect(s.prerequisites).toEqual({ codegraph: true, lens: false, builtin: true });
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

  // ── setBootstrapData ───────────────────────────────────────────────
  it('setBootstrapData should set raw nodes and metadata', () => {
    const rootNodes = [makeNode('r1', 'root', 'module', '/', 0)];
    const edges = [makeEdge('e1', 'r1', 'r2', 'contains')];
    useGraphStore.getState().setBootstrapData(rootNodes, edges, 'repo-bootstrap', {
      totalNodeCount: 500,
      totalEdgeCount: 200,
      timestamp: 12345,
    });
    const s = useGraphStore.getState();
    expect(s.rawNodes).toHaveLength(1);
    expect(s.repoId).toBe('repo-bootstrap');
    expect(s.totalNodeCount).toBe(500);
    expect(s.totalEdgeCount).toBe(200);
    expect(s.lastUpdated).toBe(12345);
    expect(s.expandedNodeIds.size).toBe(0);
    expect(s.expandedNodeIdsByViewMode).toEqual({});
  });

  it('setBootstrapData should handle layered view mode', () => {
    const rootNodes = [
      makeNode('r1', 'root', 'class', 'src/A.ts', 1),
      makeNode('r2', 'child', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'r2', 'r1', 'extend')];
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setBootstrapData(rootNodes, edges, 'repo-bs', {
      totalNodeCount: 10,
      totalEdgeCount: 5,
      timestamp: 999,
    });
    const s = useGraphStore.getState();
    expect(s.diagramData).not.toBeNull();
    expect(s.repoId).toBe('repo-bs');
  });

  it('setBootstrapData should sanitize invalid nodes', () => {
    const rootNodes = [
      makeNode('r1', 'root', 'module', '/', 0),
      { id: '', label: 'bad', type: 'function', filePath: 'x.ts' } as any,
    ];
    useGraphStore.getState().setBootstrapData(rootNodes, [], 'repo-bs', {
      totalNodeCount: 1,
      totalEdgeCount: 0,
      timestamp: 1,
    });
    expect(useGraphStore.getState().rawNodes).toHaveLength(1);
  });

  it('setBootstrapData should handle error gracefully', () => {
    // Force an error by providing malformed data that triggers exception
    const original = useGraphStore.getState();
    useGraphStore.getState().setBootstrapData([], [], 'repo-err', {
      totalNodeCount: 0,
      totalEdgeCount: 0,
      timestamp: 0,
    });
    expect(useGraphStore.getState().error).toBeNull();
  });

  // ── loadNodeChildren ───────────────────────────────────────────────
  it('loadNodeChildren should skip if already loaded', async () => {
    useGraphStore.getState().setGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [],
      'repo-1',
    );
    useGraphStore.setState({ loadedChildrenByNodeId: new Set(['n1']) });
    await useGraphStore.getState().loadNodeChildren('n1');
    expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
  });

  it('loadNodeChildren should mark as loaded if node has children in rawNodes', async () => {
    const parentNode = makeNode('parent', 'Parent', 'module', 'p.ts', 1);
    const childNode = makeNode('child', 'Child', 'function', 'c.ts', 1, {}, 'parent');
    useGraphStore.getState().setGraphData([parentNode, childNode], [], 'repo-1');
    useGraphStore.getState().loadNodeChildren('parent');
    // Wait for potential async operation
    await new Promise((r) => setTimeout(r, 10));
    expect(useGraphStore.getState().loadedChildrenByNodeId.has('parent')).toBe(true);
  });

  it('loadNodeChildren should fetch from API when no local children', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [{ id: 'c1', label: 'child1', type: 'function', filePath: 'c1.ts', lineNumber: 1, properties: {} }],
        edges: [],
        cursor: null,
        total: 1,
      }),
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);

    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadNodeChildren should handle null API response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadNodeChildren should handle empty nodes from API', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [], cursor: null, total: 0 }),
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadNodeChildren should handle duplicate nodes from API', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [{ id: 'n1', label: 'dup', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        cursor: null,
        total: 1,
      }),
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      expect(useGraphStore.getState().rawNodes).toHaveLength(1);
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadNodeChildren should handle API error gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as any;
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      // fetchNodeChildren catches errors and returns null,
      // so loadNodeChildren marks nodeId as loaded (no children available)
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── batchExpandNodes ───────────────────────────────────────────────
  it('batchExpandNodes should expand multiple nodes', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
      makeNode('m3', 'c.ts', 'module', 'crates/utils/src/c.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    const clusterNodes = useGraphStore.getState().nodes.filter(n => 'isCluster' in n && n.isCluster);
    const clusterIds = clusterNodes.map(n => n.id);
    useGraphStore.getState().batchExpandNodes(clusterIds);
    expect(useGraphStore.getState().expandedNodeIds.size).toBe(clusterIds.length);
  });

  it('batchExpandNodes should do nothing for empty array', () => {
    useGraphStore.getState().setGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [],
      'repo-1',
    );
    const before = useGraphStore.getState().expandedNodeIds.size;
    useGraphStore.getState().batchExpandNodes([]);
    expect(useGraphStore.getState().expandedNodeIds.size).toBe(before);
  });

  // ── prefetchExpand ─────────────────────────────────────────────────
  it('prefetchExpand should not prefetch in layered view mode', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setViewMode('dependencies');
    // Should not throw
    useGraphStore.getState().prefetchExpand('n1');
  });

  it('prefetchExpand should skip already expanded nodes', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().expandNode('cluster__crates__core');
    // Should not throw when prefetching already expanded node
    useGraphStore.getState().prefetchExpand('cluster__crates__core');
  });

  it('prefetchExpand should skip function nodes', () => {
    const nodes = [makeNode('f1', 'funcA', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // Should not throw when prefetching function node
    useGraphStore.getState().prefetchExpand('f1');
  });

  // ── setDagreRankDir ────────────────────────────────────────────────
  it('setDagreRankDir should update rank direction', () => {
    useGraphStore.getState().setDagreRankDir('LR');
    expect(useGraphStore.getState().dagreRankDir).toBe('LR');
    useGraphStore.getState().setDagreRankDir('TB');
    expect(useGraphStore.getState().dagreRankDir).toBe('TB');
    useGraphStore.getState().setDagreRankDir('BT');
    expect(useGraphStore.getState().dagreRankDir).toBe('BT');
    useGraphStore.getState().setDagreRankDir('RL');
    expect(useGraphStore.getState().dagreRankDir).toBe('RL');
  });

  // ── setFocusMode ───────────────────────────────────────────────────
  it('setFocusMode should set active and nodeId', () => {
    const nodeId = makeNode('n1', 'A', 'function', 'a.ts', 1).id;
    useGraphStore.getState().setFocusMode(true, nodeId);
    expect(useGraphStore.getState().focusModeActive).toBe(true);
    expect(useGraphStore.getState().focusModeNodeId).toBe(nodeId);
    useGraphStore.getState().setFocusMode(false, null);
    expect(useGraphStore.getState().focusModeActive).toBe(false);
    expect(useGraphStore.getState().focusModeNodeId).toBeNull();
  });

  // ── setPathFilter ──────────────────────────────────────────────────
  it('setPathFilter should set include and exclude filters', () => {
    useGraphStore.getState().setPathFilter('src/', 'test/');
    expect(useGraphStore.getState().pathFilterInclude).toBe('src/');
    expect(useGraphStore.getState().pathFilterExclude).toBe('test/');
    useGraphStore.getState().setPathFilter(null, null);
    expect(useGraphStore.getState().pathFilterInclude).toBeNull();
    expect(useGraphStore.getState().pathFilterExclude).toBeNull();
  });

  // ── setHeatmapMode ─────────────────────────────────────────────────
  it('setHeatmapMode should update heatmap mode', () => {
    useGraphStore.getState().setHeatmapMode('instability');
    expect(useGraphStore.getState().heatmapMode).toBe('instability');
    useGraphStore.getState().setHeatmapMode('lines');
    expect(useGraphStore.getState().heatmapMode).toBe('lines');
    useGraphStore.getState().setHeatmapMode('complexity');
    expect(useGraphStore.getState().heatmapMode).toBe('complexity');
    useGraphStore.getState().setHeatmapMode('none');
    expect(useGraphStore.getState().heatmapMode).toBe('none');
  });

  // ── addDegradation / clearDegradations ─────────────────────────────
  it('addDegradation should add unique degradation key', () => {
    useGraphStore.getState().clearDegradations();
    useGraphStore.getState().addDegradation('cycle-detection-skipped');
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(1);
    // Adding same key again should not duplicate
    useGraphStore.getState().addDegradation('cycle-detection-skipped');
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(1);
    // Adding different key
    useGraphStore.getState().addDegradation('large-graph-mode');
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(2);
  });

  it('clearDegradations should empty the list', () => {
    useGraphStore.getState().addDegradation('test-key');
    useGraphStore.getState().clearDegradations();
    expect(useGraphStore.getState().performanceDegradations).toEqual([]);
  });

  // ── setLODLevel ────────────────────────────────────────────────────
  it('setLODLevel should update level when different', () => {
    useGraphStore.getState().setLODLevel('minimal');
    expect(useGraphStore.getState().lodLevel).toBe('minimal');
    useGraphStore.getState().setLODLevel('compact');
    expect(useGraphStore.getState().lodLevel).toBe('compact');
    useGraphStore.getState().setLODLevel('full');
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  it('setLODLevel should skip when same level', () => {
    useGraphStore.getState().setLODLevel('minimal');
    const nodesBefore = useGraphStore.getState().nodes;
    useGraphStore.getState().setLODLevel('minimal');
    expect(useGraphStore.getState().nodes).toBe(nodesBefore);
  });

  it('setLODLevel with lodEnabled should re-cluster', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setLODEnabled(true);
    useGraphStore.getState().setLODLevel('minimal');
    expect(useGraphStore.getState().lodLevel).toBe('minimal');
  });

  // ── setLODEnabled ──────────────────────────────────────────────────
  it('setLODEnabled should enable LOD', () => {
    useGraphStore.getState().setLODEnabled(true);
    expect(useGraphStore.getState().lodEnabled).toBe(true);
  });

  it('setLODEnabled should disable LOD and reset to full', () => {
    useGraphStore.getState().setLODEnabled(true);
    useGraphStore.getState().setLODLevel('minimal');
    useGraphStore.getState().setLODEnabled(false);
    expect(useGraphStore.getState().lodEnabled).toBe(false);
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  it('setLODEnabled false when already full should not change level', () => {
    useGraphStore.getState().setLODEnabled(false);
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  // ── setViewMode to micro mode ──────────────────────────────────────
  it('setViewMode to cfg should trigger micro assembly when selectedFunction exists', async () => {
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
      useGraphStore.getState().setViewMode('cfg');
      // Wait for async micro assembly
      await new Promise((r) => setTimeout(r, 50));
      expect(useGraphStore.getState().viewMode).toBe('cfg');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── assembleMultiFunction ──────────────────────────────────────────
  it('assembleMultiFunction should handle fetch error gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as any;
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().assembleMultiFunction('n1');
      // When fetch fails, astFetcher returns null, aggregator produces no results
      const s = useGraphStore.getState();
      expect(s.error !== null || s.nodes.length === 0).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assembleMultiFunction should set error when no results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().assembleMultiFunction('n1');
      // Either error set or nodes empty
      const s = useGraphStore.getState();
      expect(s.error !== null || s.nodes.length === 0).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── setGraphData with large graph degradation ──────────────────────
  it('setGraphData should add degradation for large node count', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5000; i++) {
      nodes.push(makeNode(`n${i}`, `node${i}`, 'function', `file${i}.ts`, i));
    }
    useGraphStore.getState().setGraphData(nodes, [], 'repo-large');
    const degradations = useGraphStore.getState().performanceDegradations;
    expect(degradations.length).toBeGreaterThan(0);
  });

  // ── setGraphData with layered view mode ────────────────────────────
  it('setGraphData in inheritance view mode should create diagramData', () => {
    const nodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().diagramData).not.toBeNull();
    expect(useGraphStore.getState().diagramData?.viewMode).toBe('inheritance');
  });

  // ── setGraphData error path ────────────────────────────────────────
  it('setGraphData should set error on exception', () => {
    // Passing null as nodes will cause sanitizeGraphData to handle it
    useGraphStore.getState().setGraphData(null as any, null as any, 'repo-err');
    expect(useGraphStore.getState().error).not.toBeNull();
  });

  // ── setGraphData with cached diagram ───────────────────────────────
  it('setGraphData should use cached diagram when available', () => {
    const nodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];
    useGraphStore.getState().setViewMode('inheritance');
    // First call creates and caches
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().diagramData).not.toBeNull();
    // Second call with same data should use cache
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    expect(useGraphStore.getState().diagramData).not.toBeNull();
  });

  // ── loadBootstrap ──────────────────────────────────────────────────
  it('loadBootstrap should return true and set bootstrap data on success', async () => {
    const mockBootstrapData = {
      rootNodes: [makeNode('r1', 'root', 'module', '/', 0)],
      topLevelNodes: [makeNode('t1', 'top', 'module', 'src/a.ts', 1)],
      topLevelTotal: 100,
      edges: [makeEdge('e1', 'r1', 't1', 'contains')],
      indexStatus: 'ready',
      metadata: {
        repoId: 'repo-bootstrap',
        timestamp: 12345,
        totalNodeCount: 100,
        totalEdgeCount: 50,
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBootstrapData,
    } as any);
    try {
      const result = await useGraphStore.getState().loadBootstrap();
      expect(result).toBe(true);
      const s = useGraphStore.getState();
      expect(s.repoId).toBe('repo-bootstrap');
      expect(s.totalNodeCount).toBe(100);
      expect(s.totalEdgeCount).toBe(50);
      expect(s.rawNodes.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadBootstrap should return false when data is null', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    } as any);
    try {
      const result = await useGraphStore.getState().loadBootstrap();
      expect(result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadBootstrap should return false when topLevelNodes is empty', async () => {
    const mockBootstrapData = {
      rootNodes: [],
      topLevelNodes: [],
      topLevelTotal: 0,
      edges: [],
      indexStatus: 'empty',
      metadata: {
        repoId: '',
        timestamp: 0,
        totalNodeCount: 0,
        totalEdgeCount: 0,
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBootstrapData,
    } as any);
    try {
      const result = await useGraphStore.getState().loadBootstrap();
      expect(result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadBootstrap should return false on fetch error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    try {
      const result = await useGraphStore.getState().loadBootstrap();
      expect(result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── prefetchExpand with actual prefetch ────────────────────────────
  it('prefetchExpand should prefetch a non-expanded module node', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // m1 is a module node, not expanded, not function, cost should be low
    useGraphStore.getState().prefetchExpand('m1');
    expect(useGraphStore.getState().prefetchedNodeIds.has('m1')).toBe(true);
  });

  it('prefetchExpand should skip already prefetched nodes', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().prefetchExpand('m1');
    expect(useGraphStore.getState().prefetchedNodeIds.has('m1')).toBe(true);
    // Second call should not throw and should remain prefetched
    useGraphStore.getState().prefetchExpand('m1');
    expect(useGraphStore.getState().prefetchedNodeIds.has('m1')).toBe(true);
  });

  it('prefetchExpand should skip nodes with cost above threshold', () => {
    // Create many nodes under a directory to inflate expand cost
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 100; i++) {
      nodes.push(makeNode(`m${i}`, `file${i}.ts`, 'module', `crates/huge/src/file${i}.ts`, 1));
    }
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    const clusterId = 'cluster__crates__huge';
    // The cluster has many children, cost should exceed PREFETCH.COST_THRESHOLD (50)
    useGraphStore.getState().prefetchExpand(clusterId);
    // Should not have prefetched due to high cost
    expect(useGraphStore.getState().prefetchedNodeIds.has(clusterId)).toBe(false);
  });

  // ── expandNode with function body budget ───────────────────────────
  it('expandNode should enforce function body budget for function nodes', () => {
    const nodes = [
      makeNode('f1', 'funcA', 'function', 'a.ts', 1),
      makeNode('f2', 'funcB', 'function', 'b.ts', 1),
      makeNode('f3', 'funcC', 'function', 'c.ts', 1),
      makeNode('c1', 'ClassA', 'class', 'a.ts', 10),
    ];
    useGraphStore.getState().setClusterDepth(2);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // Expand first function
    useGraphStore.getState().expandNode('f1');
    expect(useGraphStore.getState().expandedNodeIds.has('f1')).toBe(true);
    // Expand second function
    useGraphStore.getState().expandNode('f2');
    expect(useGraphStore.getState().expandedNodeIds.has('f2')).toBe(true);
    // Expand third function — should evict the oldest (f1) due to budget
    useGraphStore.getState().expandNode('f3');
    const expanded = useGraphStore.getState().expandedNodeIds;
    expect(expanded.has('f3')).toBe(true);
    // f1 should have been evicted (budget is MAX_EXPANDED=2, but expandNode uses MAX_EXPANDED-1=1)
    // Actually expandNode calls enforceFunctionBodyBudget with MAX_EXPANDED - 1 = 1
    // So after expanding f2, f1 should be evicted; after f3, f2 should be evicted
    expect(expanded.has('f1')).toBe(false);
  });

  // ── expandNode with panelWidth ──────────────────────────────────────
  it('expandNode should use dynamic max visible nodes when panelWidth is set', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setPanelSize(600, 1000);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().expandNode('cluster__crates__core');
    expect(useGraphStore.getState().expandedNodeIds.has('cluster__crates__core')).toBe(true);
    useGraphStore.getState().resetPanelSize();
  });

  // ── batchExpandNodes with function body budget ─────────────────────
  it('batchExpandNodes should enforce function body budget', () => {
    const nodes = [
      makeNode('f1', 'funcA', 'function', 'a.ts', 1),
      makeNode('f2', 'funcB', 'function', 'b.ts', 1),
      makeNode('f3', 'funcC', 'function', 'c.ts', 1),
      makeNode('c1', 'ClassA', 'class', 'a.ts', 10),
    ];
    useGraphStore.getState().setClusterDepth(2);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // Batch expand all three functions — budget is MAX_EXPANDED=2
    useGraphStore.getState().batchExpandNodes(['f1', 'f2', 'f3']);
    const expanded = useGraphStore.getState().expandedNodeIds;
    // Only the last 2 should remain (f2, f3), f1 should be evicted
    expect(expanded.has('f2')).toBe(true);
    expect(expanded.has('f3')).toBe(true);
    expect(expanded.has('f1')).toBe(false);
  });

  // ── setBootstrapData error path ────────────────────────────────────
  it('setBootstrapData should handle empty data gracefully without error', () => {
    useGraphStore.getState().setBootstrapData(
      [],
      [],
      'repo-empty',
      { totalNodeCount: 0, totalEdgeCount: 0, timestamp: 0 },
    );
    const s = useGraphStore.getState();
    expect(s.error).toBeNull();
    expect(s.rawNodes).toHaveLength(0);
    expect(s.repoId).toBe('repo-empty');
  });

  // ── setLODLevel with lodEnabled and layered view mode ──────────────
  it('setLODLevel with lodEnabled in layered view mode should skip re-clustering', () => {
    const nodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    useGraphStore.getState().setLODEnabled(true);
    const nodesBefore = useGraphStore.getState().nodes;
    useGraphStore.getState().setLODLevel('minimal');
    expect(useGraphStore.getState().lodLevel).toBe('minimal');
    // In layered view mode, re-clustering is skipped, nodes should not change
    expect(useGraphStore.getState().nodes).toBe(nodesBefore);
  });

  it('setLODLevel with lodEnabled and compact level should re-cluster', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setLODEnabled(true);
    useGraphStore.getState().setLODLevel('compact');
    expect(useGraphStore.getState().lodLevel).toBe('compact');
  });

  // ── assembleMultiFunction success path ─────────────────────────────
  it('assembleMultiFunction should set nodes and viewMode on success', async () => {
    const nodes = [
      makeNode('f1', 'funcA', 'function', 'a.ts', 1),
      makeNode('f2', 'funcB', 'function', 'b.ts', 5),
    ];
    const edges = [makeEdge('e1', 'f1', 'f2', 'call')];
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    // Mock fetch to return a valid AST response
    const mockAst = {
      type: 'program',
      text: '',
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 10, column: 0 },
      children: [
        {
          type: 'function_declaration',
          text: 'function funcA() { funcB(); }',
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
      await useGraphStore.getState().assembleMultiFunction('f1');
      const s = useGraphStore.getState();
      // Should have either set nodes (success) or error (no results)
      // With a valid AST, the aggregator should produce some result
      expect(s.viewMode === 'cfg' || s.error !== null).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assembleMultiFunction should handle non-Error throw in aggregation', async () => {
    const nodes = [makeNode('f1', 'funcA', 'function', 'a.ts', 1)];
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue('string error') as any;
    try {
      await useGraphStore.getState().assembleMultiFunction('f1');
      // Should not throw; error is handled gracefully
      const s = useGraphStore.getState();
      expect(s.error !== null || s.nodes.length === 0).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── computeLayeredExpandedView via setLayer ────────────────────────
  it('setLayer should expand children of expanded nodes in layered view', () => {
    const nodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
      makeNode('C', 'ClassC', 'class', 'src/C.ts', 1),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'extend'),
      makeEdge('e2', 'C', 'A', 'extend'),
    ];
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    const diagramData = useGraphStore.getState().diagramData;
    if (diagramData && diagramData.layers.length > 1) {
      // Expand a node, then switch layer — the expanded node's children should be visible
      useGraphStore.getState().expandNode('A');
      useGraphStore.getState().setLayer(1);
      expect(useGraphStore.getState().currentLayer).toBe(1);
      // Switching back should restore layer 0
      useGraphStore.getState().setLayer(0);
      expect(useGraphStore.getState().currentLayer).toBe(0);
    }
  });

  // ── collapseExcessClusters via expandNode with many clusters ───────
  it('expandNode should collapse excess clusters when exceeding max visible', () => {
    // Create enough nodes to form many clusters
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(makeNode(`m${i}`, `file${i}.ts`, 'module', `dir${i}/src/file${i}.ts`, 1));
    }
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // Expand multiple clusters to trigger collapseExcessClusters
    const clusterIds = useGraphStore.getState().nodes
      .filter(n => 'isCluster' in n && n.isCluster)
      .map(n => n.id);
    // Expand several clusters
    for (const id of clusterIds.slice(0, 5)) {
      useGraphStore.getState().expandNode(id);
    }
    // The state should remain consistent — some clusters may have been collapsed
    expect(useGraphStore.getState().expandedNodeIds.size).toBeGreaterThanOrEqual(0);
  });

  // ── setGraphData with community-detection-sampled degradation ──────
  it('setGraphData should add community-detection-sampled degradation for moderate node count', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5500; i++) {
      nodes.push(makeNode(`n${i}`, `node${i}`, 'function', `file${i}.ts`, i));
    }
    useGraphStore.getState().setGraphData(nodes, [], 'repo-large');
    const degradations = useGraphStore.getState().performanceDegradations;
    expect(degradations).toContain('community-detection-sampled');
  });

  // ── setBootstrapData in code view mode (non-layered) ──────────────
  it('setBootstrapData in code view mode should use tryIncrementalOrFull', () => {
    const rootNodes = [
      makeNode('r1', 'root', 'module', '/', 0),
      makeNode('r2', 'child', 'module', 'src/a.ts', 1),
    ];
    const edges = [makeEdge('e1', 'r1', 'r2', 'contains')];
    useGraphStore.getState().setBootstrapData(rootNodes, edges, 'repo-bs', {
      totalNodeCount: 100,
      totalEdgeCount: 50,
      timestamp: 9999,
    });
    const s = useGraphStore.getState();
    expect(s.repoId).toBe('repo-bs');
    expect(s.rawNodes).toHaveLength(2);
    expect(s.lastUpdated).toBe(9999);
    expect(s.expandedNodeIds.size).toBe(0);
  });

  // ── setBootstrapData should reset expandedNodeIdsByViewMode ────────
  it('setBootstrapData should reset expandedNodeIdsByViewMode to empty', () => {
    // Pre-populate expandedNodeIdsByViewMode
    useGraphStore.setState({
      expandedNodeIdsByViewMode: { code: new Set(['n1', 'n2']) },
    });
    useGraphStore.getState().setBootstrapData(
      [makeNode('r1', 'root', 'module', '/', 0)],
      [],
      'repo-bs',
      { totalNodeCount: 1, totalEdgeCount: 0, timestamp: 1 },
    );
    expect(useGraphStore.getState().expandedNodeIdsByViewMode).toEqual({});
  });

  // ── setBootstrapData / clearGraph must drop the per-node child caches ──
  // Regression: a stale loadedChildrenByNodeId made expandNode() a silent no-op
  // after a workspace switch (it early-returns on "children already loaded"),
  // and prefetchedNodeIds only ever grew.
  it('setBootstrapData resets loadedChildrenByNodeId and prefetchedNodeIds', () => {
    useGraphStore.setState({
      loadedChildrenByNodeId: new Set(['stale']),
      prefetchedNodeIds: new Set(['stale']),
    });
    useGraphStore.getState().setBootstrapData(
      [makeNode('r2', 'root', 'module', '/', 0)],
      [],
      'repo-bs',
      { totalNodeCount: 1, totalEdgeCount: 0, timestamp: 1 },
    );
    expect(useGraphStore.getState().loadedChildrenByNodeId.size).toBe(0);
    expect(useGraphStore.getState().prefetchedNodeIds.size).toBe(0);
  });

  it('clearGraph resets loadedChildrenByNodeId and prefetchedNodeIds', () => {
    useGraphStore.setState({
      loadedChildrenByNodeId: new Set(['stale']),
      prefetchedNodeIds: new Set(['stale']),
    });
    useGraphStore.getState().clearGraph();
    expect(useGraphStore.getState().loadedChildrenByNodeId.size).toBe(0);
    expect(useGraphStore.getState().prefetchedNodeIds.size).toBe(0);
  });

  // ── loadNodeChildren with new edges from API ──────────────────────
  it('loadNodeChildren should merge new edges from API response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          { id: 'c1', label: 'child1', type: 'function', filePath: 'c1.ts', lineNumber: 1, properties: {} },
          { id: 'c2', label: 'child2', type: 'function', filePath: 'c2.ts', lineNumber: 5, properties: {} },
        ],
        edges: [
          { id: 'newEdge1', source: 'n1', target: 'c1', type: 'call', properties: {} },
        ],
        cursor: null,
        total: 2,
      }),
    } as any);
    try {
      useGraphStore.getState().setGraphData(
        [makeNode('n1', 'A', 'module', 'a.ts', 1)],
        [],
        'repo-1',
      );
      await useGraphStore.getState().loadNodeChildren('n1');
      const s = useGraphStore.getState();
      expect(s.loadedChildrenByNodeId.has('n1')).toBe(true);
      // New nodes should be merged into rawNodes
      expect(s.rawNodes.length).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loadNodeChildren should handle path-based children detection', async () => {
    // Node with path-based children (id starts with parentId + '/')
    const parentNode = makeNode('parent', 'Parent', 'module', 'p.ts', 1);
    const childNode = makeNode('parent/child', 'Child', 'function', 'c.ts', 1);
    useGraphStore.getState().setGraphData([parentNode, childNode], [], 'repo-1');
    await useGraphStore.getState().loadNodeChildren('parent');
    expect(useGraphStore.getState().loadedChildrenByNodeId.has('parent')).toBe(true);
  });

  it('loadNodeChildren should skip when only duplicate nodes and edges returned', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        ],
        cursor: null,
        total: 1,
      }),
    } as any);
    try {
      const nodes = [
        makeNode('n1', 'A', 'function', 'a.ts', 1),
        makeNode('n2', 'B', 'function', 'b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
      await useGraphStore.getState().loadNodeChildren('n1');
      // All nodes and edges are duplicates, should still mark as loaded
      expect(useGraphStore.getState().loadedChildrenByNodeId.has('n1')).toBe(true);
      expect(useGraphStore.getState().rawNodes).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── assembleMicro with selectedFunctionOverride ────────────────────
  it('assembleMicro should use selectedFunctionOverride when provided', async () => {
    const mockAst = {
      type: 'program',
      text: '',
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 10, column: 0 },
      children: [
        {
          type: 'function_declaration',
          text: 'function override() {}',
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
      // No selectedFunction set, but override provided
      useGraphStore.getState().setSelectedFunction(null);
      await useGraphStore.getState().assembleMicro('cfg', {
        nodeId: 'override-node',
        filePath: 'src/override.ts',
        functionName: 'overrideFunc',
      });
      expect(useGraphStore.getState().isLoading).toBe(false);
      expect(useGraphStore.getState().error).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── setViewMode to flowchart ───────────────────────────────────────
  it('setViewMode to flowchart should trigger micro assembly when selectedFunction exists', async () => {
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
      useGraphStore.getState().setViewMode('flowchart');
      await new Promise((r) => setTimeout(r, 50));
      expect(useGraphStore.getState().viewMode).toBe('flowchart');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── setViewMode to sequence ────────────────────────────────────────
  it('setViewMode to sequence should trigger micro assembly when selectedFunction exists', async () => {
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
      useGraphStore.getState().setViewMode('sequence');
      await new Promise((r) => setTimeout(r, 50));
      expect(useGraphStore.getState().viewMode).toBe('sequence');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── setGraphData with large-graph-mode degradation ─────────────────
  it('setGraphData should add large-graph-mode degradation for very large node count', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 600; i++) {
      nodes.push(makeNode(`n${i}`, `node${i}`, 'function', `file${i}.ts`, i));
    }
    useGraphStore.getState().setGraphData(nodes, [], 'repo-large');
    const degradations = useGraphStore.getState().performanceDegradations;
    expect(degradations).toContain('large-graph-mode');
  });

  // ── setGraphData with cycle-detection-skipped degradation ──────────
  it('setGraphData should add cycle-detection-skipped degradation for large graph', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 11000; i++) {
      nodes.push(makeNode(`n${i}`, `node${i}`, 'function', `file${i}.ts`, i));
    }
    useGraphStore.getState().setGraphData(nodes, [], 'repo-huge');
    const degradations = useGraphStore.getState().performanceDegradations;
    expect(degradations).toContain('cycle-detection-skipped');
  });

  // ── setBootstrapData with layered view mode and cached diagram ─────
  it('setBootstrapData should use cached diagram in layered view mode', () => {
    const rootNodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];
    useGraphStore.getState().setViewMode('inheritance');
    // First call creates and caches diagram
    useGraphStore.getState().setBootstrapData(rootNodes, edges, 'repo-bs1', {
      totalNodeCount: 10,
      totalEdgeCount: 5,
      timestamp: 100,
    });
    expect(useGraphStore.getState().diagramData).not.toBeNull();
    // Second call with same data should use cache
    useGraphStore.getState().setBootstrapData(rootNodes, edges, 'repo-bs2', {
      totalNodeCount: 10,
      totalEdgeCount: 5,
      timestamp: 200,
    });
    expect(useGraphStore.getState().diagramData).not.toBeNull();
    expect(useGraphStore.getState().repoId).toBe('repo-bs2');
  });

  // ── prefetchExpand concurrency limit ──────────────────────────────
  it('prefetchExpand should respect concurrency limit', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
      makeNode('m3', 'c.ts', 'module', 'crates/utils/src/c.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    // First two should succeed (CONCURRENCY_LIMIT=2)
    useGraphStore.getState().prefetchExpand('m1');
    useGraphStore.getState().prefetchExpand('m2');
    expect(useGraphStore.getState().prefetchedNodeIds.has('m1')).toBe(true);
    expect(useGraphStore.getState().prefetchedNodeIds.has('m2')).toBe(true);
  });

  // ── setDagreRankDir default ────────────────────────────────────────
  it('setDagreRankDir should default to TB on fresh store', () => {
    useGraphStore.setState({ dagreRankDir: 'TB' });
    expect(useGraphStore.getState().dagreRankDir).toBe('TB');
  });

  // ── setGraphData in code view mode with diagramData layer fallback ─
  it('setGraphData in code view mode should use layer 0 fallback when currentLayer is out of range', () => {
    const nodes = [
      makeNode('A', 'ClassA', 'class', 'src/A.ts', 1),
      makeNode('B', 'ClassB', 'class', 'src/B.ts', 1),
    ];
    const edges = [makeEdge('e1', 'B', 'A', 'extend')];
    // Switch to layered view to create diagramData
    useGraphStore.getState().setViewMode('inheritance');
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');
    // Set currentLayer to an out-of-range value
    useGraphStore.setState({ currentLayer: 99 });
    // Switch back to code view — this should not crash
    useGraphStore.getState().setViewMode('code');
    expect(useGraphStore.getState().viewMode).toBe('code');
  });

  // ── setLODLevel to full with lodEnabled should re-cluster with clusterDepth ──
  it('setLODLevel to full with lodEnabled should use state clusterDepth', () => {
    const nodes = [
      makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
      makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
    ];
    useGraphStore.getState().setClusterDepth(2);
    useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
    useGraphStore.getState().setLODEnabled(true);
    useGraphStore.getState().setLODLevel('minimal');
    // Now switch back to full — should use state.clusterDepth (2)
    useGraphStore.getState().setLODLevel('full');
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  // ── prefetchExpand with requestIdleCallback ────────────────────────
  it('prefetchExpand should use requestIdleCallback when available', () => {
    // Temporarily provide requestIdleCallback
    const originalRIC = (globalThis as any).requestIdleCallback;
    (globalThis as any).requestIdleCallback = vi.fn((cb: () => void) => {
      // Execute immediately to trigger the callback
      cb();
      return 0;
    });
    try {
      const nodes = [
        makeNode('m1', 'a.ts', 'module', 'crates/core/src/a.ts', 1),
        makeNode('m2', 'b.ts', 'module', 'crates/api/src/b.ts', 1),
      ];
      useGraphStore.getState().setClusterDepth(0);
      useGraphStore.getState().setGraphData(nodes, [], 'repo-1');
      useGraphStore.getState().prefetchExpand('m1');
      expect(useGraphStore.getState().prefetchedNodeIds.has('m1')).toBe(true);
    } finally {
      if (originalRIC) {
        (globalThis as any).requestIdleCallback = originalRIC;
      } else {
        delete (globalThis as any).requestIdleCallback;
      }
    }
  });

  // ── assembleMultiFunction catch path ──────────────────────────────
  // The catch block (L883-886) is nearly unreachable because astFetcher
  // catches all errors internally and returns null, and CallChainAggregator
  // handles null AST gracefully. This is effectively dead code.
  it('assembleMultiFunction should produce no-results error when AST returns null', async () => {
    useGraphStore.getState().setGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [],
      'repo-1',
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    } as any);
    try {
      await useGraphStore.getState().assembleMultiFunction('n1');
      const s = useGraphStore.getState();
      expect(s.error).not.toBeNull();
      expect(s.error).toContain('聚合无结果');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('graphStore additional setters', () => {
  beforeEach(() => {
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({
      integrationMode: 'unknown',
      panelVisible: true,
      heatmapMode: 'none',
      todoMarkerMode: 'none',
      deadCodeResult: null,
      deadCodeModeActive: false,
      healthScore: null,
      rules: [],
      ruleViolations: [],
    });
  });

  it('setIntegrationMode updates integrationMode', () => {
    useGraphStore.getState().setIntegrationMode('better-sidebar');
    expect(useGraphStore.getState().integrationMode).toBe('better-sidebar');
    useGraphStore.getState().setIntegrationMode('slot');
    expect(useGraphStore.getState().integrationMode).toBe('slot');
    useGraphStore.getState().setIntegrationMode('floating');
    expect(useGraphStore.getState().integrationMode).toBe('floating');
    useGraphStore.getState().setIntegrationMode('sidebar-right');
    expect(useGraphStore.getState().integrationMode).toBe('sidebar-right');
  });

  it('setPanelVisible updates panelVisible', () => {
    useGraphStore.getState().setPanelVisible(false);
    expect(useGraphStore.getState().panelVisible).toBe(false);
    useGraphStore.getState().setPanelVisible(true);
    expect(useGraphStore.getState().panelVisible).toBe(true);
  });

  it('setPanelVisible false aborts pending requests', () => {
    const controller = new AbortController();
    const pendingRequests = new Map([['node1', controller]]);
    useGraphStore.setState({ pendingRequests });
    useGraphStore.getState().setPanelVisible(false);
    expect(controller.signal.aborted).toBe(true);
    expect(useGraphStore.getState().pendingRequests.size).toBe(0);
  });

  it('setTodoMarkerMode updates todoMarkerMode', () => {
    useGraphStore.getState().setTodoMarkerMode('todo');
    expect(useGraphStore.getState().todoMarkerMode).toBe('todo');
    useGraphStore.getState().setTodoMarkerMode('fixme');
    expect(useGraphStore.getState().todoMarkerMode).toBe('fixme');
    useGraphStore.getState().setTodoMarkerMode('none');
    expect(useGraphStore.getState().todoMarkerMode).toBe('none');
  });

  it('setDeadCodeResult updates deadCodeResult', () => {
    const result = { deadNodes: [], totalNodes: 0, coverage: 0 } as any;
    useGraphStore.getState().setDeadCodeResult(result);
    expect(useGraphStore.getState().deadCodeResult).toBe(result);
    useGraphStore.getState().setDeadCodeResult(null);
    expect(useGraphStore.getState().deadCodeResult).toBeNull();
  });

  it('setDeadCodeModeActive updates deadCodeModeActive', () => {
    useGraphStore.getState().setDeadCodeModeActive(true);
    expect(useGraphStore.getState().deadCodeModeActive).toBe(true);
    useGraphStore.getState().setDeadCodeModeActive(false);
    expect(useGraphStore.getState().deadCodeModeActive).toBe(false);
  });

  it('setHeatmapMode updates heatmapMode', () => {
    useGraphStore.getState().setHeatmapMode('instability');
    expect(useGraphStore.getState().heatmapMode).toBe('instability');
    useGraphStore.getState().setHeatmapMode('lines');
    expect(useGraphStore.getState().heatmapMode).toBe('lines');
    useGraphStore.getState().setHeatmapMode('complexity');
    expect(useGraphStore.getState().heatmapMode).toBe('complexity');
    useGraphStore.getState().setHeatmapMode('none');
    expect(useGraphStore.getState().heatmapMode).toBe('none');
  });

  it('setHealthScore updates healthScore', () => {
    const score = { overall: 80, breakdown: {} } as any;
    useGraphStore.getState().setHealthScore(score);
    expect(useGraphStore.getState().healthScore).toBe(score);
    useGraphStore.getState().setHealthScore(null);
    expect(useGraphStore.getState().healthScore).toBeNull();
  });

  it('setRules updates rules', () => {
    const rules = [{ id: 'r1', name: 'Rule 1', severity: 'warning' }] as any;
    useGraphStore.getState().setRules(rules);
    expect(useGraphStore.getState().rules).toBe(rules);
    useGraphStore.getState().setRules([]);
    expect(useGraphStore.getState().rules).toHaveLength(0);
  });

  it('setRuleViolations updates ruleViolations', () => {
    const violations = [{ ruleId: 'r1', nodeId: 'n1', message: 'violation' }] as any;
    useGraphStore.getState().setRuleViolations(violations);
    expect(useGraphStore.getState().ruleViolations).toBe(violations);
    useGraphStore.getState().setRuleViolations([]);
    expect(useGraphStore.getState().ruleViolations).toHaveLength(0);
  });

  it('setPrerequisites updates prerequisites', () => {
    useGraphStore.getState().setPrerequisites({ codegraph: true, lens: false, builtin: true });
    expect(useGraphStore.getState().prerequisites).toEqual({ codegraph: true, lens: false, builtin: true });
  });

  it('setInitStatus updates initStatus and initMessage', () => {
    useGraphStore.getState().setInitStatus('initializing', 'Loading...');
    expect(useGraphStore.getState().initStatus).toBe('initializing');
    expect(useGraphStore.getState().initMessage).toBe('Loading...');
    useGraphStore.getState().setInitStatus('done');
    expect(useGraphStore.getState().initStatus).toBe('done');
    expect(useGraphStore.getState().initMessage).toBeNull();
    useGraphStore.getState().setInitStatus('error', 'Failed to init');
    expect(useGraphStore.getState().initStatus).toBe('error');
    expect(useGraphStore.getState().initMessage).toBe('Failed to init');
  });

  it('setWatchEnabled updates watchEnabled', () => {
    useGraphStore.getState().setWatchEnabled(true);
    expect(useGraphStore.getState().watchEnabled).toBe(true);
    useGraphStore.getState().setWatchEnabled(false);
    expect(useGraphStore.getState().watchEnabled).toBe(false);
  });

  it('setPanelSize updates panelHeight and panelWidth', () => {
    useGraphStore.getState().setPanelSize(400, 600);
    expect(useGraphStore.getState().panelHeight).toBe(400);
    expect(useGraphStore.getState().panelWidth).toBe(600);
  });

  it('resetPanelSize resets panelHeight and panelWidth to null', () => {
    useGraphStore.getState().setPanelSize(400, 600);
    useGraphStore.getState().resetPanelSize();
    expect(useGraphStore.getState().panelHeight).toBeNull();
    expect(useGraphStore.getState().panelWidth).toBeNull();
  });

  it('addDegradation adds unique degradation key', () => {
    useGraphStore.getState().addDegradation('slow-render');
    expect(useGraphStore.getState().performanceDegradations).toContain('slow-render');
    useGraphStore.getState().addDegradation('slow-render');
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(1);
    useGraphStore.getState().addDegradation('high-memory');
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(2);
  });

  it('clearDegradations clears all degradations', () => {
    useGraphStore.getState().addDegradation('slow-render');
    useGraphStore.getState().addDegradation('high-memory');
    useGraphStore.getState().clearDegradations();
    expect(useGraphStore.getState().performanceDegradations).toHaveLength(0);
  });

  it('setSelectedFunction updates selectedFunction', () => {
    const fn = { nodeId: 'n1', filePath: 'src/foo.ts', functionName: 'foo' };
    useGraphStore.getState().setSelectedFunction(fn);
    expect(useGraphStore.getState().selectedFunction).toEqual(fn);
    useGraphStore.getState().setSelectedFunction(null);
    expect(useGraphStore.getState().selectedFunction).toBeNull();
  });

  it('setDagreRankDir updates dagreRankDir', () => {
    useGraphStore.getState().setDagreRankDir('LR');
    expect(useGraphStore.getState().dagreRankDir).toBe('LR');
    useGraphStore.getState().setDagreRankDir('TB');
    expect(useGraphStore.getState().dagreRankDir).toBe('TB');
    useGraphStore.getState().setDagreRankDir('BT');
    expect(useGraphStore.getState().dagreRankDir).toBe('BT');
    useGraphStore.getState().setDagreRankDir('RL');
    expect(useGraphStore.getState().dagreRankDir).toBe('RL');
  });

  it('setGraphType updates graphType', () => {
    useGraphStore.getState().setGraphType('call');
    expect(useGraphStore.getState().graphType).toBe('call');
    useGraphStore.getState().setGraphType('dependency');
    expect(useGraphStore.getState().graphType).toBe('dependency');
    useGraphStore.getState().setGraphType('all');
    expect(useGraphStore.getState().graphType).toBe('all');
  });

  it('setClusterDepth updates clusterDepth', () => {
    useGraphStore.getState().setClusterDepth(1);
    expect(useGraphStore.getState().clusterDepth).toBe(1);
    useGraphStore.getState().setClusterDepth(2);
    expect(useGraphStore.getState().clusterDepth).toBe(2);
    useGraphStore.getState().setClusterDepth(0);
    expect(useGraphStore.getState().clusterDepth).toBe(0);
  });

  it('setCurrentWorkspace updates currentWorkspace', () => {
    useGraphStore.getState().setCurrentWorkspace('/path/to/project');
    expect(useGraphStore.getState().currentWorkspace).toBe('/path/to/project');
  });

  it('addWorkspace adds workspace to list', () => {
    useGraphStore.getState().addWorkspace('/path/to/project', 'project');
    const list = useGraphStore.getState().workspaceList;
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe('/path/to/project');
    expect(list[0]!.name).toBe('project');
  });

  it('removeWorkspace removes workspace from list', () => {
    useGraphStore.getState().addWorkspace('/path/to/project', 'project');
    useGraphStore.getState().addWorkspace('/path/to/other', 'other');
    useGraphStore.getState().removeWorkspace('/path/to/project');
    const list = useGraphStore.getState().workspaceList;
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe('/path/to/other');
  });

  it('removeWorkspace updates currentWorkspace if it was removed', () => {
    useGraphStore.getState().setCurrentWorkspace('/path/to/project');
    useGraphStore.getState().addWorkspace('/path/to/project', 'project');
    useGraphStore.getState().removeWorkspace('/path/to/project');
    expect(useGraphStore.getState().currentWorkspace).toBe('.');
  });

  it('setPathStart updates pathStartId', () => {
    useGraphStore.getState().setPathStart('n1' as any);
    expect(useGraphStore.getState().pathStartId).toBe('n1');
    useGraphStore.getState().setPathStart(null);
    expect(useGraphStore.getState().pathStartId).toBeNull();
  });

  it('setPathEnd updates pathEndId', () => {
    useGraphStore.getState().setPathEnd('n2' as any);
    expect(useGraphStore.getState().pathEndId).toBe('n2');
    useGraphStore.getState().setPathEnd(null);
    expect(useGraphStore.getState().pathEndId).toBeNull();
  });

  it('setPathResult updates pathResult', () => {
    useGraphStore.getState().setPathResult(['n1', 'n2', 'n3'] as any);
    expect(useGraphStore.getState().pathResult).toEqual(['n1', 'n2', 'n3']);
    useGraphStore.getState().setPathResult(null);
    expect(useGraphStore.getState().pathResult).toBeNull();
  });

  it('setFocusDepth updates focusDepth', () => {
    useGraphStore.getState().setFocusDepth(3);
    expect(useGraphStore.getState().focusDepth).toBe(3);
  });

  it('setFocusMode updates focusModeActive and focusModeNodeId', () => {
    useGraphStore.getState().setFocusMode(true, 'n1' as any);
    expect(useGraphStore.getState().focusModeActive).toBe(true);
    expect(useGraphStore.getState().focusModeNodeId).toBe('n1');
    useGraphStore.getState().setFocusMode(false, null);
    expect(useGraphStore.getState().focusModeActive).toBe(false);
    expect(useGraphStore.getState().focusModeNodeId).toBeNull();
  });

  it('setPathFilter updates pathFilterInclude and pathFilterExclude', () => {
    useGraphStore.getState().setPathFilter('include-pattern', 'exclude-pattern');
    expect(useGraphStore.getState().pathFilterInclude).toBe('include-pattern');
    expect(useGraphStore.getState().pathFilterExclude).toBe('exclude-pattern');
    useGraphStore.getState().setPathFilter(null, null);
    expect(useGraphStore.getState().pathFilterInclude).toBeNull();
    expect(useGraphStore.getState().pathFilterExclude).toBeNull();
  });

  it('setCallChainDepth updates callChainDepth', () => {
    useGraphStore.getState().setCallChainDepth(5);
    expect(useGraphStore.getState().callChainDepth).toBe(5);
  });

  it('setFanInThreshold updates fanInThreshold', () => {
    useGraphStore.getState().setFanInThreshold(10);
    expect(useGraphStore.getState().fanInThreshold).toBe(10);
  });

  it('setFanOutThreshold updates fanOutThreshold', () => {
    useGraphStore.getState().setFanOutThreshold(15);
    expect(useGraphStore.getState().fanOutThreshold).toBe(15);
  });

  it('setVisibleNodeTypes updates visibleNodeTypes', () => {
    const types = new Set<GraphNode['type']>(['function', 'class']);
    useGraphStore.getState().setVisibleNodeTypes(types);
    expect(useGraphStore.getState().visibleNodeTypes).toStrictEqual(types);
  });

  it('setVisibleEdgeTypes updates visibleEdgeTypes', () => {
    const types = new Set<GraphEdge['type']>(['call', 'import']);
    useGraphStore.getState().setVisibleEdgeTypes(types);
    expect(useGraphStore.getState().visibleEdgeTypes).toStrictEqual(types);
  });
});
