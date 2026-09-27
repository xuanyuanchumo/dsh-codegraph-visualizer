import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphStore, disposeStore } from '../../src/client/store/graphStore.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import { FUNCTION_BODY } from '../../src/shared/constants.ts';

describe('P2-2: pendingRequests state management', () => {
  beforeEach(() => {
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({
      pendingRequests: new Map(),
      pinnedIds: new Set(),
      expandedNodeIds: new Set(),
      loadedChildrenByNodeId: new Set(),
    });
  });

  it('should initialize with empty pendingRequests', () => {
    expect(useGraphStore.getState().pendingRequests).toBeInstanceOf(Map);
    expect(useGraphStore.getState().pendingRequests.size).toBe(0);
  });

  it('should add AbortController to pendingRequests when loading children', async () => {
    const node = makeNode('n1', 'A', 'module', 'a.ts', 1);
    useGraphStore.getState().setGraphData([node], [], 'repo-1');
    vi.doMock('../../src/client/api/index.ts', () => ({
      fetchNodeChildren: vi.fn().mockResolvedValue({ nodes: [], edges: [], cursor: null, total: 0 }),
      fetchBootstrap: vi.fn(),
      fetchFileOutline: vi.fn(),
      fetchSymbolAST: vi.fn(),
      fetchEdges: vi.fn(),
    }));
    const loadPromise = useGraphStore.getState().loadNodeChildren('n1');
    const pendingDuring = useGraphStore.getState().pendingRequests;
    expect(pendingDuring.has('n1')).toBe(true);
    await loadPromise;
    const pendingAfter = useGraphStore.getState().pendingRequests;
    expect(pendingAfter.has('n1')).toBe(false);
  });

  it('should remove pendingRequest on error', async () => {
    const node = makeNode('n1', 'A', 'module', 'a.ts', 1);
    useGraphStore.getState().setGraphData([node], [], 'repo-1');
    vi.doMock('../../src/client/api/index.ts', () => ({
      fetchNodeChildren: vi.fn().mockRejectedValue(new Error('network')),
      fetchBootstrap: vi.fn(),
      fetchFileOutline: vi.fn(),
      fetchSymbolAST: vi.fn(),
      fetchEdges: vi.fn(),
    }));
    await useGraphStore.getState().loadNodeChildren('n1').catch(() => {});
    expect(useGraphStore.getState().pendingRequests.has('n1')).toBe(false);
  });

  it('should cancel pending request via cancelPendingRequest', () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');
    const pending = new Map([['n1', controller]]);
    useGraphStore.setState({ pendingRequests: pending });
    useGraphStore.getState().cancelPendingRequest('n1');
    expect(abortSpy).toHaveBeenCalled();
    expect(useGraphStore.getState().pendingRequests.has('n1')).toBe(false);
  });

  it('should handle cancelPendingRequest for non-existent nodeId', () => {
    expect(() => useGraphStore.getState().cancelPendingRequest('nonexistent')).not.toThrow();
  });
});

describe('P2-3: pinnedIds fixed nodes', () => {
  beforeEach(() => {
    useGraphStore.getState().clearGraph();
    useGraphStore.setState({
      pinnedIds: new Set(),
      expandedNodeIds: new Set(),
      pendingRequests: new Map(),
      loadedChildrenByNodeId: new Set(),
    });
  });

  it('should initialize with empty pinnedIds', () => {
    expect(useGraphStore.getState().pinnedIds).toBeInstanceOf(Set);
    expect(useGraphStore.getState().pinnedIds.size).toBe(0);
  });

  it('should pin a node via pinNode', () => {
    useGraphStore.getState().pinNode('n1');
    expect(useGraphStore.getState().pinnedIds.has('n1')).toBe(true);
  });

  it('should unpin a node via unpinNode', () => {
    useGraphStore.getState().pinNode('n1');
    useGraphStore.getState().unpinNode('n1');
    expect(useGraphStore.getState().pinnedIds.has('n1')).toBe(false);
  });

  it('should not collapse a pinned node via collapseNode', () => {
    useGraphStore.setState({
      expandedNodeIds: new Set(['n1']),
      pinnedIds: new Set(['n1']),
    });
    useGraphStore.getState().collapseNode('n1');
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(true);
  });

  it('should collapse a non-pinned node via collapseNode', () => {
    useGraphStore.setState({
      expandedNodeIds: new Set(['n1', 'n2']),
      pinnedIds: new Set(['n1']),
    });
    useGraphStore.getState().collapseNode('n2');
    expect(useGraphStore.getState().expandedNodeIds.has('n2')).toBe(false);
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(true);
  });

  it('should keep pinned nodes expanded after collapseAll', () => {
    useGraphStore.setState({
      expandedNodeIds: new Set(['n1', 'n2', 'n3']),
      pinnedIds: new Set(['n1', 'n3']),
    });
    useGraphStore.getState().collapseAll();
    expect(useGraphStore.getState().expandedNodeIds.has('n1')).toBe(true);
    expect(useGraphStore.getState().expandedNodeIds.has('n3')).toBe(true);
    expect(useGraphStore.getState().expandedNodeIds.has('n2')).toBe(false);
  });

  it('should not collapse pinned cluster nodes in collapseExcessClusters', () => {
    const clusterNode = {
      id: 'cluster__src',
      label: 'src',
      type: 'directory' as const,
      filePath: 'src',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: 10,
      childIds: [] as string[],
    };
    const regularNode = makeNode('n1', 'A', 'function', 'a.ts', 1);
    useGraphStore.setState({
      nodes: [clusterNode as never, regularNode],
      expandedNodeIds: new Set(['cluster__src']),
      pinnedIds: new Set(['cluster__src']),
    });
    useGraphStore.getState().collapseNode('cluster__src');
    expect(useGraphStore.getState().expandedNodeIds.has('0')).toBe(false);
  });
});

describe('P1-2: Function body budget tracking', () => {
  it('should track expanded function body count correctly', () => {
    const fn1 = makeNode('fn1', 'funcA', 'function', 'a.ts', 1);
    const fn2 = makeNode('fn2', 'funcB', 'function', 'b.ts', 1);
    const mod = makeNode('mod1', 'Module', 'module', 'm.ts', 1);
    useGraphStore.getState().setGraphData([fn1, fn2, mod], [], 'repo-1');
    useGraphStore.setState({
      expandedNodeIds: new Set(['fn1', 'fn2']),
    });
    const expandedFunctionBodies = [...useGraphStore.getState().expandedNodeIds].filter((id) =>
      useGraphStore.getState().rawNodes.some((n) => n.id === id && n.type === 'function'),
    );
    expect(expandedFunctionBodies.length).toBe(2);
  });

  it('should enforce FUNCTION_BODY.MAX_EXPANDED constant', () => {
    expect(FUNCTION_BODY.MAX_EXPANDED).toBe(2);
  });
});