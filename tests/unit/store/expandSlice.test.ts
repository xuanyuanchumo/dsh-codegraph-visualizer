// Independent unit tests for the expandSlice factory.
// Directly imports createExpandSlice and mocks set/get (Zustand slice factory pattern).
// Source: tests/unit/store/expandSlice.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Hoisted mock references shared with vi.mock factories -------------------
const mocks = vi.hoisted(() => ({
  fetchNodeChildren: vi.fn(),
  fetchBootstrap: vi.fn(),
  fetchFileOutline: vi.fn(),
  fetchSymbolAST: vi.fn(),
  measureAsync: vi.fn(),
  measureSync: vi.fn(),
  reclusterWith: vi.fn(),
  mergeAndRecluster: vi.fn(),
  estimateExpandCost: vi.fn(),
  computeClusteredGraph: vi.fn(),
  readUrlExpand: vi.fn(),
  restoreExpandedNodeIds: vi.fn(),
}));

// --- Module mocks ------------------------------------------------------------
vi.mock('../../../src/client/api/index.ts', () => ({
  fetchNodeChildren: mocks.fetchNodeChildren,
  fetchBootstrap: mocks.fetchBootstrap,
  fetchFileOutline: mocks.fetchFileOutline,
  fetchSymbolAST: mocks.fetchSymbolAST,
}));

vi.mock('../../../src/shared/PerformanceMonitor.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/PerformanceMonitor.ts')>();
  return { ...actual, measureAsync: mocks.measureAsync, measureSync: mocks.measureSync };
});

vi.mock('../../../src/client/store/internals.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/client/store/internals.ts')>();
  return {
    ...actual,
    reclusterWith: mocks.reclusterWith,
    mergeAndRecluster: mocks.mergeAndRecluster,
    estimateExpandCost: mocks.estimateExpandCost,
  };
});

vi.mock('../../../src/client/store/cluster/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/client/store/cluster/index.ts')>();
  return { ...actual, computeClusteredGraph: mocks.computeClusteredGraph };
});

vi.mock('../../../src/client/utils/urlState.ts', () => ({
  readUrlExpand: mocks.readUrlExpand,
  restoreExpandedNodeIds: mocks.restoreExpandedNodeIds,
}));

// --- Imports under test (after mocks are in place) ---------------------------
import { createExpandSlice } from '../../../src/client/store/slices/expandSlice.ts';
import {
  internals,
  clusterCache,
  replaceController,
  enforceFunctionBodyBudget,
  collapseExcessClusters,
  computeMaxVisible,
  log,
} from '../../../src/client/store/internals.ts';
import { CLUSTER, PREFETCH, FUNCTION_BODY, SYMBOL_AST } from '../../../src/shared/constants.ts';
import { makeNode } from '../../helpers.ts';
import type { GraphState } from '../../../src/client/store/types.ts';
import type { GraphNode, GraphEdge } from '../../../src/types/index.ts';
import type { IndexedDBCache } from '../../../src/client/cache/IndexedDBCache.ts';

// --- Helpers ----------------------------------------------------------------
type SliceMethods = Pick<
  GraphState,
  | 'expandNode' | 'loadNodeChildren' | 'loadBootstrap' | 'batchExpandNodes'
  | 'prefetchExpand' | 'collapseNode' | 'collapseAll' | 'pinNode' | 'unpinNode'
  | 'cancelPendingRequest' | 'restoreFromUrl'
>;

interface SliceHarness {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  slice: SliceMethods;
  state: GraphState;
}

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    rawNodes: [],
    rawEdges: [],
    nodes: [],
    edges: [],
    expandedNodeIds: new Set<string>(),
    expandedNodeIdsByViewMode: {},
    loadedChildrenByNodeId: new Set<string>(),
    prefetchedNodeIds: new Set<string>(),
    loadErrorsByNodeId: new Map<string, string>(),
    pendingRequests: new Map<string, AbortController>(),
    pinnedIds: new Set<string>(),
    viewMode: 'code',
    clusterDepth: 0,
    panelWidth: null,
    currentWorkspace: '.',
    diagramData: null,
    currentLayer: 0,
    savedRawNodes: [],
    savedRawEdges: [],
    ...overrides,
  } as unknown as GraphState;
}

function makeSlice(initial: Partial<GraphState> = {}): SliceHarness {
  let state = makeState(initial);
  const set = vi.fn((partial: Partial<GraphState>) => {
    state = { ...state, ...partial } as GraphState;
  });
  const get = vi.fn(() => state);
  const slice = createExpandSlice(set, get) as SliceMethods;
  // Inject slice methods into state so _get().loadNodeChildren / setBootstrapData resolve.
  // Spread order: slice provides methods + initial empty collections; state (with caller
  // overrides) wins so user-supplied expandedNodeIds/pinnedIds etc. are preserved.
  state = { ...slice, ...state } as GraphState;
  return { set, get, slice, get state() { return state; } };
}

function fnNode(id: string, type: GraphNode['type'] = 'module', parentId?: string): GraphNode {
  return makeNode(id, id, type, `${id}.ts`, 1, {}, parentId);
}

function nextTick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Test suite --------------------------------------------------------------
describe('expandSlice', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchNodeChildren.mockResolvedValue({ nodes: [], edges: [], cursor: null, total: 0 });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [],
      edges: [],
      metadata: { repoId: 'r', totalNodeCount: 0, totalEdgeCount: 0, timestamp: 1 },
      indexStatus: 'ok',
    });
    mocks.fetchFileOutline.mockResolvedValue({ symbols: [], edges: [] });
    mocks.fetchSymbolAST.mockResolvedValue({ astNodes: [], astEdges: [], sourceLines: [] });
    mocks.measureAsync.mockImplementation((_label: string, fn: () => Promise<unknown>) => fn());
    mocks.measureSync.mockImplementation((_label: string, fn: () => unknown) => fn());
    mocks.reclusterWith.mockImplementation(() => {});
    mocks.mergeAndRecluster.mockImplementation(() => {});
    mocks.estimateExpandCost.mockReturnValue(0);
    mocks.computeClusteredGraph.mockReturnValue({ nodes: [], edges: [] });

    // Reset module-level mutable internals to avoid cross-test pollution.
    internals.expandGeneration = 0;
    internals.restoreGeneration = 0;
    internals.prefetchInFlightCount = 0;
    internals.expandAbortControllers.clear();
    internals.prefetchAbortControllers.clear();
    internals.prefetchIdleHandle = null;
    internals.persistentCache = null;
    internals.incrementalClusterCtx = null;
    internals.restoreAbortController = null;
    internals.restoreTimeoutHandle = null;
    clusterCache.invalidate();

    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  // ── expandNode ────────────────────────────────────────────────────────────
  describe('expandNode', () => {
    it('expands a directory cluster node and tracks viewMode via reclusterWith', () => {
      const node = fnNode('cluster__src', 'module');
      const h = makeSlice({ rawNodes: [node], viewMode: 'code' });

      h.slice.expandNode('cluster__src');

      expect(mocks.estimateExpandCost).toHaveBeenCalledWith('cluster__src', [node]);
      expect(mocks.reclusterWith).toHaveBeenCalledTimes(1);
      const [getFn, setFn, newExpanded, newByViewMode] = mocks.reclusterWith.mock.calls[0]!;
      expect(getFn).toBe(h.get);
      expect(setFn).toBe(h.set);
      expect(newExpanded.has('cluster__src')).toBe(true);
      expect(newByViewMode['code'].has('cluster__src')).toBe(true);
    });

    it('tracks viewMode in expandedNodeIdsByViewMode for the active viewMode', () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], viewMode: 'dependencies' });

      h.slice.expandNode('n1');

      const newByViewMode = mocks.reclusterWith.mock.calls[0]![3] as Record<string, Set<string>>;
      expect(newByViewMode['dependencies']!.has('n1')).toBe(true);
      expect(newByViewMode['code']).toBeUndefined();
    });

    it('evicts oldest function body when exceeding FUNCTION_BODY.MAX_EXPANDED budget', () => {
      const fn1 = fnNode('fn1', 'function');
      const fn2 = fnNode('fn2', 'function');
      const fn3 = fnNode('fn3', 'function');
      const h = makeSlice({
        rawNodes: [fn1, fn2, fn3],
        expandedNodeIds: new Set(['fn1', 'fn2']),
      });

      h.slice.expandNode('fn3');

      // expandNode calls enforceFunctionBodyBudget with MAX_EXPANDED - 1 = 1 BEFORE adding nodeId.
      // Starting expanded {fn1,fn2} evicted to 1 => {fn2}, then add fn3 => {fn2, fn3}.
      const newExpanded = mocks.reclusterWith.mock.calls[0]![2] as Set<string>;
      expect(newExpanded.has('fn3')).toBe(true);
      expect(newExpanded.has('fn2')).toBe(true);
      expect(newExpanded.has('fn1')).toBe(false);
      // fetchSymbolAST invoked for the function node (no persistent cache).
      expect(mocks.fetchSymbolAST).toHaveBeenCalledTimes(1);
    });

    it('warns when expand cost exceeds CLUSTER.EXPAND_BUDGET_SINGLE', () => {
      const node = fnNode('big', 'module');
      mocks.estimateExpandCost.mockReturnValue(CLUSTER.EXPAND_BUDGET_SINGLE + 1);
      const h = makeSlice({ rawNodes: [node] });

      h.slice.expandNode('big');

      expect(warnSpy).toHaveBeenCalledWith(
        'expand budget exceeded',
        expect.objectContaining({ nodeId: 'big', budget: CLUSTER.EXPAND_BUDGET_SINGLE }),
      );
    });

    it('does not load children when nodeId is not in rawNodes', () => {
      const h = makeSlice({ rawNodes: [fnNode('other', 'module')] });

      h.slice.expandNode('missing');

      expect(mocks.reclusterWith).toHaveBeenCalledTimes(1);
      expect(internals.expandAbortControllers.has('missing')).toBe(false);
    });

    it('fetches file outline for module nodes and merges when symbols present', async () => {
      const mod = fnNode('mod1', 'module');
      const sym = fnNode('sym1', 'function');
      mocks.fetchFileOutline.mockResolvedValue({ symbols: [sym], edges: [] });
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      await nextTick();

      expect(mocks.fetchFileOutline).toHaveBeenCalledWith('mod1', expect.any(AbortSignal), '.');
      expect(mocks.mergeAndRecluster).toHaveBeenCalledWith(
        [sym],
        [],
        h.set,
        'file outline loaded',
        { nodeId: 'mod1' },
      );
    });

    it('uses persistent cache outline when available and skips fetch', async () => {
      const mod = fnNode('mod1', 'module');
      const sym = fnNode('sym1', 'function');
      const cacheMock = {
        getOutline: vi.fn().mockResolvedValue({ symbols: [sym], edges: [] }),
        setOutline: vi.fn().mockResolvedValue(undefined),
        getAST: vi.fn(),
        setAST: vi.fn(),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      await nextTick();

      expect(cacheMock.getOutline).toHaveBeenCalledWith('mod1');
      expect(mocks.fetchFileOutline).not.toHaveBeenCalled();
      expect(mocks.mergeAndRecluster).toHaveBeenCalledWith(
        [sym],
        [],
        h.set,
        'file outline loaded (cache)',
        { nodeId: 'mod1' },
      );
    });

    it('fetches symbol AST for function nodes and merges truncated data', async () => {
      const fn = fnNode('fn1', 'function');
      const astNodes: GraphNode[] = Array.from({ length: SYMBOL_AST.MAX_NODES + 5 }, (_, i) =>
        fnNode(`a${i}`, 'function'),
      );
      const astEdges: GraphEdge[] = [];
      mocks.fetchSymbolAST.mockResolvedValue({
        astNodes,
        astEdges,
        sourceLines: [],
      });
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.expandNode('fn1');
      await nextTick();

      expect(mocks.fetchSymbolAST).toHaveBeenCalledWith('fn1', expect.any(AbortSignal), '.');
      expect(warnSpy).toHaveBeenCalledWith(
        'symbol AST truncated',
        expect.objectContaining({ nodeId: 'fn1', original: astNodes.length }),
      );
      const merged = mocks.mergeAndRecluster.mock.calls[0]!;
      expect(merged[0]).toHaveLength(SYMBOL_AST.MAX_NODES);
      expect(merged[3]).toBe('symbol AST loaded');
    });

    it('silently handles AbortError from loadNodeChildren during expand', async () => {
      const mod = fnNode('mod1', 'module');
      const abortErr = new DOMException('aborted', 'AbortError');
      mocks.fetchNodeChildren.mockRejectedValue(abortErr);
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      await nextTick();

      // AbortError should not produce a loadErrors entry nor a warn for expand.
      expect(internals.expandAbortControllers.has('mod1')).toBe(false);
    });

    it('logs warning when fetchFileOutline rejects', async () => {
      const mod = fnNode('mod1', 'module');
      mocks.fetchFileOutline.mockRejectedValue(new Error('net'));
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      await nextTick();

      expect(warnSpy).toHaveBeenCalledWith(
        'expandNode: fetchFileOutline failed',
        expect.objectContaining({ nodeId: 'mod1' }),
      );
    });

    it('logs warning when fetchSymbolAST rejects', async () => {
      const fn = fnNode('fn1', 'function');
      mocks.fetchSymbolAST.mockRejectedValue(new Error('net'));
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.expandNode('fn1');
      await nextTick();

      expect(warnSpy).toHaveBeenCalledWith(
        'expandNode: fetchSymbolAST failed',
        expect.objectContaining({ nodeId: 'fn1' }),
      );
    });
  });

  // ── batchExpandNodes ──────────────────────────────────────────────────────
  describe('batchExpandNodes', () => {
    it('expands multiple nodes in one call', () => {
      const h = makeSlice({ rawNodes: [fnNode('a'), fnNode('b'), fnNode('c')] });

      h.slice.batchExpandNodes(['a', 'b', 'c']);

      const newExpanded = mocks.reclusterWith.mock.calls[0]![2] as Set<string>;
      expect(newExpanded.has('a')).toBe(true);
      expect(newExpanded.has('b')).toBe(true);
      expect(newExpanded.has('c')).toBe(true);
    });

    it('returns early for empty array without reclustering', () => {
      const h = makeSlice();

      h.slice.batchExpandNodes([]);

      expect(mocks.reclusterWith).not.toHaveBeenCalled();
    });

    it('enforces function body budget across the batch', () => {
      const fn1 = fnNode('fn1', 'function');
      const fn2 = fnNode('fn2', 'function');
      const fn3 = fnNode('fn3', 'function');
      const h = makeSlice({
        rawNodes: [fn1, fn2, fn3],
        expandedNodeIds: new Set(['fn1']),
      });

      h.slice.batchExpandNodes(['fn2', 'fn3']);

      // batchExpand uses enforceFunctionBodyBudget with MAX_EXPANDED = 2.
      // effective = {fn1, fn2, fn3}, evict to 2 => removes oldest fn1.
      const newExpanded = mocks.reclusterWith.mock.calls[0]![2] as Set<string>;
      expect(newExpanded.has('fn1')).toBe(false);
      expect(newExpanded.has('fn2')).toBe(true);
      expect(newExpanded.has('fn3')).toBe(true);
    });
  });

  // ── collapseNode ───────────────────────────────────────────────────────────
  describe('collapseNode', () => {
    it('removes node from expanded set and reclusters', () => {
      const h = makeSlice({
        expandedNodeIds: new Set(['n1', 'n2']),
        viewMode: 'code',
      });

      h.slice.collapseNode('n2');

      const newExpanded = mocks.reclusterWith.mock.calls[0]![2] as Set<string>;
      expect(newExpanded.has('n2')).toBe(false);
      expect(newExpanded.has('n1')).toBe(true);
    });

    it('does not collapse a pinned node', () => {
      const h = makeSlice({
        expandedNodeIds: new Set(['n1']),
        pinnedIds: new Set(['n1']),
      });

      h.slice.collapseNode('n1');

      expect(mocks.reclusterWith).not.toHaveBeenCalled();
    });
  });

  // ── collapseAll ───────────────────────────────────────────────────────────
  describe('collapseAll', () => {
    it('collapses current viewMode to only pinned nodes', () => {
      const h = makeSlice({
        expandedNodeIds: new Set(['n1', 'n2', 'n3']),
        pinnedIds: new Set(['n2']),
        viewMode: 'code',
      });

      h.slice.collapseAll();

      const [getFn, setFn, newExpanded, newByViewMode] = mocks.reclusterWith.mock.calls[0]!;
      expect(getFn).toBe(h.get);
      expect(setFn).toBe(h.set);
      expect(newExpanded.has('n2')).toBe(true);
      expect(newExpanded.has('n1')).toBe(false);
      expect(newExpanded.has('n3')).toBe(false);
      expect((newByViewMode as Record<string, Set<string>>)['code']!.has('n2')).toBe(true);
    });
  });

  // ── prefetchExpand ────────────────────────────────────────────────────────
  describe('prefetchExpand', () => {
    it('skips when viewMode is layered', () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], viewMode: 'dependencies' });

      h.slice.prefetchExpand('n1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('skips when node already expanded', () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], expandedNodeIds: new Set(['n1']) });

      h.slice.prefetchExpand('n1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('skips when node is a function', () => {
      const fn = fnNode('fn1', 'function');
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.prefetchExpand('fn1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('skips when node already prefetched', () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], prefetchedNodeIds: new Set(['n1']) });

      h.slice.prefetchExpand('n1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('skips when expand cost exceeds PREFETCH.COST_THRESHOLD', () => {
      const node = fnNode('n1', 'module');
      mocks.estimateExpandCost.mockReturnValue(PREFETCH.COST_THRESHOLD + 1);
      const h = makeSlice({ rawNodes: [node] });

      h.slice.prefetchExpand('n1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('skips when prefetch concurrency limit reached', () => {
      const node = fnNode('n1', 'module');
      internals.prefetchInFlightCount = PREFETCH.CONCURRENCY_LIMIT;
      const h = makeSlice({ rawNodes: [node] });

      h.slice.prefetchExpand('n1');

      expect(h.set).not.toHaveBeenCalled();
    });

    it('marks node prefetched and loads children when not yet loaded', async () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node] });

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(h.state.prefetchedNodeIds.has('n1')).toBe(true);
      expect(mocks.fetchNodeChildren).toHaveBeenCalledWith('n1', undefined, undefined, expect.any(AbortSignal), '.');
      expect(mocks.computeClusteredGraph).toHaveBeenCalled();
      expect(internals.prefetchAbortControllers.has('n1')).toBe(false);
    });

    it('skips loadNodeChildren when children already loaded but still clusters', async () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], loadedChildrenByNodeId: new Set(['n1']) });

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(mocks.fetchNodeChildren).not.toHaveBeenCalled();
      expect(mocks.computeClusteredGraph).toHaveBeenCalled();
    });

    it('skips clustering when clusterCache already has the result', async () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], loadedChildrenByNodeId: new Set(['n1']) });
      // Pre-seed cache with the exact key prefetchExpand will compute.
      const { computeDataHash } = await import('../../../src/client/store/internals.ts');
      const dataHash = computeDataHash([node], []);
      clusterCache.set(dataHash, 'progressive:0', 'n1', { nodes: [], edges: [] });

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(mocks.computeClusteredGraph).not.toHaveBeenCalled();
    });

    it('records load error when prefetched loadNodeChildren fails', async () => {
      const node = fnNode('n1', 'module');
      mocks.fetchNodeChildren.mockRejectedValue(new Error('boom'));
      const h = makeSlice({ rawNodes: [node] });

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(h.state.loadErrorsByNodeId.get('n1')).toBe('boom');
    });
  });

  // ── pinNode / unpinNode ───────────────────────────────────────────────────
  describe('pinNode / unpinNode', () => {
    it('adds node to pinnedIds', () => {
      const h = makeSlice();
      h.slice.pinNode('n1');
      expect(h.state.pinnedIds.has('n1')).toBe(true);
    });

    it('removes node from pinnedIds', () => {
      const h = makeSlice({ pinnedIds: new Set(['n1']) });
      h.slice.unpinNode('n1');
      expect(h.state.pinnedIds.has('n1')).toBe(false);
    });
  });

  // ── cancelPendingRequest ──────────────────────────────────────────────────
  describe('cancelPendingRequest', () => {
    it('aborts and removes an existing pending controller', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');
      const h = makeSlice({ pendingRequests: new Map([['n1', controller]]) });

      h.slice.cancelPendingRequest('n1');

      expect(abortSpy).toHaveBeenCalled();
      expect(h.state.pendingRequests.has('n1')).toBe(false);
    });

    it('is a no-op for unknown nodeId', () => {
      const h = makeSlice();
      expect(() => h.slice.cancelPendingRequest('nope')).not.toThrow();
      expect(h.set).not.toHaveBeenCalled();
    });
  });

  // ── loadNodeChildren ────────────────────────────────────────────────────────
  describe('loadNodeChildren', () => {
    it('returns early when children already loaded', async () => {
      const h = makeSlice({ loadedChildrenByNodeId: new Set(['n1']) });
      await h.slice.loadNodeChildren('n1');
      expect(mocks.fetchNodeChildren).not.toHaveBeenCalled();
    });

    it('marks loaded without fetch when rawNodes already contain children', async () => {
      const child = fnNode('n1/child', 'module', 'n1');
      const h = makeSlice({ rawNodes: [child] });
      await h.slice.loadNodeChildren('n1');
      expect(mocks.fetchNodeChildren).not.toHaveBeenCalled();
      expect(h.state.loadedChildrenByNodeId.has('n1')).toBe(true);
    });

    it('marks loaded when fetch returns empty nodes', async () => {
      mocks.fetchNodeChildren.mockResolvedValue({ nodes: [], edges: [], cursor: null, total: 0 });
      const h = makeSlice();
      await h.slice.loadNodeChildren('n1');
      expect(h.state.loadedChildrenByNodeId.has('n1')).toBe(true);
      expect(h.state.pendingRequests.has('n1')).toBe(false);
    });

    it('merges fetched nodes and reclusters', async () => {
      const newNode = fnNode('c1', 'module');
      mocks.fetchNodeChildren.mockResolvedValue({ nodes: [newNode], edges: [], cursor: null, total: 1 });
      const h = makeSlice();
      await h.slice.loadNodeChildren('n1');
      expect(h.state.rawNodes).toHaveLength(1);
      expect(h.state.loadedChildrenByNodeId.has('n1')).toBe(true);
      expect(h.state.pendingRequests.has('n1')).toBe(false);
    });

    it('skips merge when all fetched nodes/edges are duplicates', async () => {
      const existing = fnNode('c1', 'module');
      mocks.fetchNodeChildren.mockResolvedValue({
        nodes: [existing],
        edges: [],
        cursor: null,
        total: 1,
      });
      const h = makeSlice({ rawNodes: [existing], rawEdges: [] });
      await h.slice.loadNodeChildren('n1');
      expect(h.state.rawNodes).toHaveLength(1);
      expect(h.state.loadedChildrenByNodeId.has('n1')).toBe(true);
    });

    it('clears pending and records error on non-abort failure', async () => {
      mocks.fetchNodeChildren.mockRejectedValue(new Error('network down'));
      const h = makeSlice();
      await h.slice.loadNodeChildren('n1');
      expect(h.state.pendingRequests.has('n1')).toBe(false);
      expect(h.state.loadErrorsByNodeId.get('n1')).toBe('network down');
    });

    it('clears pending without error on AbortError', async () => {
      mocks.fetchNodeChildren.mockRejectedValue(new DOMException('aborted', 'AbortError'));
      const h = makeSlice();
      await h.slice.loadNodeChildren('n1');
      expect(h.state.pendingRequests.has('n1')).toBe(false);
      expect(h.state.loadErrorsByNodeId.has('n1')).toBe(false);
    });
  });

  // ── loadBootstrap ─────────────────────────────────────────────────────────
  describe('loadBootstrap', () => {
    it('returns false and falls back when bootstrap is empty', async () => {
      mocks.fetchBootstrap.mockResolvedValue({
        topLevelNodes: [],
        edges: [],
        metadata: { repoId: 'r', totalNodeCount: 0, totalEdgeCount: 0, timestamp: 1 },
        indexStatus: 'ok',
      });
      const setBootstrapData = vi.fn();
      const h = makeSlice({ setBootstrapData: setBootstrapData } as unknown as Partial<GraphState>);
      const ok = await h.slice.loadBootstrap();
      expect(ok).toBe(false);
      expect(setBootstrapData).not.toHaveBeenCalled();
    });

    it('returns true and applies bootstrap data when present', async () => {
      const top = fnNode('root', 'module');
      mocks.fetchBootstrap.mockResolvedValue({
        topLevelNodes: [top],
        edges: [],
        metadata: { repoId: 'r', totalNodeCount: 5, totalEdgeCount: 2, timestamp: 9 },
        indexStatus: 'ready',
      });
      const setBootstrapData = vi.fn();
      const h = makeSlice({ setBootstrapData: setBootstrapData } as unknown as Partial<GraphState>);
      const ok = await h.slice.loadBootstrap();
      expect(ok).toBe(true);
      expect(setBootstrapData).toHaveBeenCalledWith(
        [top],
        [],
        'r',
        { totalNodeCount: 5, totalEdgeCount: 2, timestamp: 9 },
      );
    });

    it('returns false on fetch error', async () => {
      mocks.fetchBootstrap.mockRejectedValue(new Error('boom'));
      const h = makeSlice();
      const ok = await h.slice.loadBootstrap();
      expect(ok).toBe(false);
    });
  });

  // ── expandGeneration stale-write protection ────────────────────────────────
  describe('expandGeneration stale-write protection', () => {
    it('increments expandGeneration on each expandNode call', () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node] });
      expect(internals.expandGeneration).toBe(0);
      h.slice.expandNode('n1');
      expect(internals.expandGeneration).toBe(1);
      h.slice.expandNode('n1');
      expect(internals.expandGeneration).toBe(2);
    });

    it('skips stale file-outline merge when a newer expand superseded the generation', async () => {
      const mod = fnNode('mod1', 'module');
      const sym = fnNode('sym1', 'function');
      // Hold the outline promise so we can resolve it after a newer expand bumps generation.
      let resolveOutline: (v: { symbols: GraphNode[]; edges: GraphEdge[] }) => void = () => {};
      mocks.fetchFileOutline.mockImplementation(
        () => new Promise((r) => { resolveOutline = r; }),
      );
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1'); // gen becomes 1
      const genAfterFirst = internals.expandGeneration;
      expect(genAfterFirst).toBe(1);

      // A second expand on a different node bumps generation to 2.
      const mod2 = fnNode('mod2', 'module');
      h.state.rawNodes = [mod, mod2];
      h.slice.expandNode('mod2'); // gen becomes 2
      expect(internals.expandGeneration).toBe(2);

      // Now resolve the first (stale) outline; mergeAndRecluster must NOT be called for it.
      resolveOutline({ symbols: [sym], edges: [] });
      await nextTick();

      // The stale (mod1) outline must be skipped; only the fresh mod2 outline may merge.
      const staleMerge = mocks.mergeAndRecluster.mock.calls.find(
        (c) =>
          (c[3] as string) === 'file outline loaded' &&
          (c[4] as { nodeId?: string }).nodeId === 'mod1',
      );
      expect(staleMerge).toBeUndefined();
    });
  });

  // ── AbortController lifecycle ─────────────────────────────────────────────
  describe('AbortController lifecycle', () => {
    it('registers an expand AbortController and cleans up after load completes', async () => {
      const mod = fnNode('mod1', 'module');
      mocks.fetchNodeChildren.mockResolvedValue({ nodes: [], edges: [], cursor: null, total: 0 });
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      // Controller registered synchronously.
      expect(internals.expandAbortControllers.has('mod1')).toBe(true);

      await nextTick();
      // Cleaned up in finally after loadNodeChildren settles.
      expect(internals.expandAbortControllers.has('mod1')).toBe(false);
    });

    it('replaceController aborts the previous controller for the same key', () => {
      const map = new Map<string, AbortController>();
      const first = replaceController(map, 'k');
      const firstAbort = vi.spyOn(first, 'abort');
      const second = replaceController(map, 'k');
      expect(firstAbort).toHaveBeenCalled();
      expect(map.get('k')).toBe(second);
      expect(second).not.toBe(first);
    });

    it('prefetch registers and cleans up a prefetch AbortController', async () => {
      const node = fnNode('n1', 'module');
      // Do not pre-load children so the loadNodeChildren branch runs and its
      // finally cleans up the prefetch AbortController.
      const h = makeSlice({ rawNodes: [node] });

      h.slice.prefetchExpand('n1');
      expect(internals.prefetchAbortControllers.has('n1')).toBe(true);
      await nextTick();
      expect(internals.prefetchAbortControllers.has('n1')).toBe(false);
    });
  });

  // ── restoreFromUrl (early return in node env) ─────────────────────────────
  describe('restoreFromUrl', () => {
    it('returns early when window is undefined (node env)', async () => {
      const h = makeSlice();
      await expect(h.slice.restoreFromUrl()).resolves.toBeUndefined();
      expect(h.set).not.toHaveBeenCalled();
    });
  });

  // ── pure helper coverage (enforceFunctionBodyBudget / collapseExcessClusters / computeMaxVisible)
  describe('re-exported pure helpers', () => {
    it('enforceFunctionBodyBudget evicts oldest function expansions beyond max', () => {
      const fns = [fnNode('f1', 'function'), fnNode('f2', 'function'), fnNode('f3', 'function')];
      const expanded = new Set(['f1', 'f2', 'f3']);
      enforceFunctionBodyBudget(expanded, fns, 1);
      expect(expanded.has('f1')).toBe(false);
      expect(expanded.has('f2')).toBe(false);
      expect(expanded.has('f3')).toBe(true);
    });

    it('collapseExcessClusters is a no-op when within maxVisible', () => {
      const expanded = new Set(['c1']);
      collapseExcessClusters([], expanded, 1500, 0);
      expect(expanded.has('c1')).toBe(true);
    });

    it('computeMaxVisible falls back to CLUSTER.MAX_VISIBLE_NODES when panelWidth null', () => {
      expect(computeMaxVisible(null)).toBe(CLUSTER.MAX_VISIBLE_NODES);
      expect(computeMaxVisible(undefined)).toBe(CLUSTER.MAX_VISIBLE_NODES);
    });
  });

  // ── Coverage supplements: persistent cache, defensive catches, idle handles ─
  describe('persistent cache integration', () => {
    it('writes module outline to persistent cache after fetch', async () => {
      const mod = fnNode('mod1', 'module');
      const sym = fnNode('s1', 'function');
      const cacheMock = {
        getOutline: vi.fn().mockResolvedValue(null),
        setOutline: vi.fn().mockResolvedValue(undefined),
        getAST: vi.fn(),
        setAST: vi.fn(),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchFileOutline.mockResolvedValue({ symbols: [sym], edges: [] });
      const h = makeSlice({ rawNodes: [mod] });

      h.slice.expandNode('mod1');
      await nextTick();

      expect(cacheMock.setOutline).toHaveBeenCalledWith('mod1', { symbols: [sym], edges: [] });
    });

    it('uses cached AST for function nodes and skips fetch', async () => {
      const fn = fnNode('fn1', 'function');
      const astNodes = [fnNode('a1', 'function')];
      const cacheMock = {
        getOutline: vi.fn(),
        setOutline: vi.fn(),
        getAST: vi.fn().mockResolvedValue({ astNodes, astEdges: [], sourceLines: [] }),
        setAST: vi.fn(),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.expandNode('fn1');
      await nextTick();

      expect(cacheMock.getAST).toHaveBeenCalledWith('fn1');
      expect(mocks.fetchSymbolAST).not.toHaveBeenCalled();
      expect(mocks.mergeAndRecluster).toHaveBeenCalledWith(
        astNodes,
        [],
        h.set,
        'symbol AST loaded (cache)',
        { nodeId: 'fn1', sourceLines: 0 },
      );
    });

    it('writes AST to persistent cache after fetch', async () => {
      const fn = fnNode('fn1', 'function');
      const astNodes = [fnNode('a1', 'function')];
      const cacheMock = {
        getOutline: vi.fn(),
        setOutline: vi.fn(),
        getAST: vi.fn().mockResolvedValue(null),
        setAST: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchSymbolAST.mockResolvedValue({ astNodes, astEdges: [], sourceLines: ['x'] });
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.expandNode('fn1');
      await nextTick();

      expect(cacheMock.setAST).toHaveBeenCalledWith('fn1', { astNodes, astEdges: [], sourceLines: ['x'] });
    });

    it('truncates sourceLines exceeding SYMBOL_AST.MAX_SOURCE_LINES', async () => {
      const fn = fnNode('fn1', 'function');
      mocks.fetchSymbolAST.mockResolvedValue({
        astNodes: [fnNode('a1', 'function')],
        astEdges: [],
        sourceLines: Array.from({ length: SYMBOL_AST.MAX_SOURCE_LINES + 5 }, () => 'line'),
      });
      const h = makeSlice({ rawNodes: [fn] });

      h.slice.expandNode('fn1');
      await nextTick();

      const merged = mocks.mergeAndRecluster.mock.calls[0]!;
      expect((merged[4] as { sourceLines?: number }).sourceLines).toBe(SYMBOL_AST.MAX_SOURCE_LINES);
    });
  });

  describe('defensive loadNodeChildren rejection', () => {
    it('expandNode logs warning when loadNodeChildren rejects with non-abort error', async () => {
      const mod = fnNode('mod1', 'module');
      const h = makeSlice({ rawNodes: [mod] });
      // Force the slice's loadNodeChildren to reject so expandNode's .catch runs.
      h.state.loadNodeChildren = vi.fn().mockRejectedValue(new Error('load fail')) as GraphState['loadNodeChildren'];

      h.slice.expandNode('mod1');
      await nextTick();

      expect(warnSpy).toHaveBeenCalledWith(
        'expandNode: loadNodeChildren failed',
        expect.objectContaining({ nodeId: 'mod1' }),
      );
      expect(internals.expandAbortControllers.has('mod1')).toBe(false);
    });

    it('prefetchExpand records error when loadNodeChildren rejects with non-abort error', async () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node] });
      h.state.loadNodeChildren = vi.fn().mockRejectedValue(new Error('prefetch fail')) as GraphState['loadNodeChildren'];

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(h.state.loadErrorsByNodeId.get('n1')).toBe('prefetch fail');
    });

    it('prefetchExpand swallows AbortError from loadNodeChildren without recording error', async () => {
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node] });
      h.state.loadNodeChildren = vi
        .fn()
        .mockRejectedValue(new DOMException('aborted', 'AbortError')) as GraphState['loadNodeChildren'];

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(h.state.loadErrorsByNodeId.has('n1')).toBe(false);
    });
  });

  describe('prefetchExpand clustering sources & idle handle', () => {
    it('uses diagramData layer nodes/edges as clustering source when present', async () => {
      const node = fnNode('n1', 'module');
      const layerNodes = [fnNode('ln1', 'module')];
      const diagramData = {
        layers: [{ nodes: layerNodes, edges: [], nodeIds: ['ln1'] }],
        allNodes: layerNodes,
        allEdges: [],
      } as unknown as NonNullable<GraphState['diagramData']>;
      const h = makeSlice({ rawNodes: [node], diagramData, currentLayer: 0, loadedChildrenByNodeId: new Set(['n1']) });

      h.slice.prefetchExpand('n1');
      await nextTick();

      expect(mocks.computeClusteredGraph).toHaveBeenCalled();
      expect(mocks.computeClusteredGraph.mock.calls[0]![0]).toBe(layerNodes);
    });

    it('cancels a pending idle handle when a second prefetch supersedes it', async () => {
      const n1 = fnNode('n1', 'module');
      const n2 = fnNode('n2', 'module');
      const h = makeSlice({ rawNodes: [n1, n2], loadedChildrenByNodeId: new Set(['n1', 'n2']) });

      // Two synchronous prefetches: the second cancels the first idle handle.
      h.slice.prefetchExpand('n1');
      h.slice.prefetchExpand('n2');
      await nextTick();

      // Only the second prefetch's runPrefetch executes; the first was cancelled.
      expect(mocks.computeClusteredGraph).toHaveBeenCalledTimes(1);
    });

    it('uses requestIdleCallback when available in the environment', () => {
      const idleSpy = vi.fn(() => 42);
      vi.stubGlobal('requestIdleCallback', idleSpy);
      const node = fnNode('n1', 'module');
      const h = makeSlice({ rawNodes: [node], loadedChildrenByNodeId: new Set(['n1']) });

      h.slice.prefetchExpand('n1');

      expect(idleSpy).toHaveBeenCalled();
      expect(internals.prefetchIdleHandle).toBe(42);
    });

    it('cancels via cancelIdleCallback when a prior idle handle is a number', () => {
      const idleSpy = vi.fn(() => 7);
      const cancelSpy = vi.fn();
      vi.stubGlobal('requestIdleCallback', idleSpy);
      vi.stubGlobal('cancelIdleCallback', cancelSpy);
      const n1 = fnNode('n1', 'module');
      const n2 = fnNode('n2', 'module');
      const h = makeSlice({ rawNodes: [n1, n2], loadedChildrenByNodeId: new Set(['n1', 'n2']) });

      h.slice.prefetchExpand('n1');
      h.slice.prefetchExpand('n2');

      expect(cancelSpy).toHaveBeenCalledWith(7);
    });
  });

  describe('restoreFromUrl (window present)', () => {
    it('restores expanded nodes from URL and marks urlRestored', async () => {
      vi.useFakeTimers();
      try {
        const mod = fnNode('n1', 'module');
        mocks.readUrlExpand.mockReturnValue({
          expandedDirs: ['n1'],
          expandedFiles: [],
          expandedSymbols: [],
        });
        mocks.restoreExpandedNodeIds.mockReturnValue(['n1']);
        vi.stubGlobal('window', {});
        const h = makeSlice({ rawNodes: [mod] });

        const p = h.slice.restoreFromUrl();
        await vi.advanceTimersByTimeAsync(50);
        await p;

        expect(mocks.reclusterWith).toHaveBeenCalled();
        expect(h.state.urlRestored).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('loads missing parent children before expanding a non-existent node', async () => {
      vi.useFakeTimers();
      try {
        mocks.readUrlExpand.mockReturnValue({
          expandedDirs: [],
          expandedFiles: ['parent/child'],
          expandedSymbols: [],
        });
        mocks.restoreExpandedNodeIds.mockReturnValue(['parent/child']);
        vi.stubGlobal('window', {});
        const h = makeSlice({ rawNodes: [] });

        const p = h.slice.restoreFromUrl();
        await vi.advanceTimersByTimeAsync(50);
        await p;

        expect(mocks.fetchNodeChildren).toHaveBeenCalledWith('parent', undefined, undefined, expect.any(AbortSignal), '.');
        expect(h.state.urlRestored).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts early when a newer restore supersedes the generation', async () => {
      vi.useFakeTimers();
      try {
        mocks.readUrlExpand.mockReturnValue({
          expandedDirs: ['n1', 'n2'],
          expandedFiles: [],
          expandedSymbols: [],
        });
        mocks.restoreExpandedNodeIds.mockReturnValue(['n1', 'n2']);
        vi.stubGlobal('window', {});
        const mod1 = fnNode('n1', 'module');
        const mod2 = fnNode('n2', 'module');
        const h = makeSlice({ rawNodes: [mod1, mod2] });

        const p = h.slice.restoreFromUrl();
        // Supersede the generation before the loop continues.
        internals.restoreGeneration++;
        await vi.advanceTimersByTimeAsync(50);
        await p;

        // First expandNode (n1) still ran before the stale check, but the loop
        // aborted before processing n2, so reclusterWith was called at most once.
        expect(mocks.reclusterWith.mock.calls.length).toBeLessThanOrEqual(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns early when URL has no expanded ids', async () => {
      vi.stubGlobal('window', {});
      mocks.readUrlExpand.mockReturnValue({ expandedDirs: [], expandedFiles: [], expandedSymbols: [] });
      const h = makeSlice();
      await h.slice.restoreFromUrl();
      expect(mocks.restoreExpandedNodeIds).not.toHaveBeenCalled();
    });

    it('logs warning when parent loadNodeChildren fails during restore', async () => {
      vi.useFakeTimers();
      try {
        mocks.readUrlExpand.mockReturnValue({
          expandedDirs: [],
          expandedFiles: ['parent/child'],
          expandedSymbols: [],
        });
        mocks.restoreExpandedNodeIds.mockReturnValue(['parent/child']);
        vi.stubGlobal('window', {});
        const h = makeSlice({ rawNodes: [] });
        h.state.loadNodeChildren = vi
          .fn()
          .mockRejectedValue(new Error('parent fail')) as GraphState['loadNodeChildren'];

        const p = h.slice.restoreFromUrl();
        await vi.advanceTimersByTimeAsync(50);
        await p;

        expect(warnSpy).toHaveBeenCalledWith(
          'restoreFromUrl: loadNodeChildren failed',
          expect.objectContaining({ parentId: 'parent' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});