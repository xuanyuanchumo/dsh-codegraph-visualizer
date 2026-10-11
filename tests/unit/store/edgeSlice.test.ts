// Independent unit tests for the edgeSlice factory (lazy per-node edge loading).
// Directly imports createEdgeSlice and mocks set/get (Zustand slice factory pattern).
// Source: tests/unit/store/edgeSlice.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Hoisted mock references shared with vi.mock factories -------------------
const mocks = vi.hoisted(() => ({
  fetchEdges: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchEdges: mocks.fetchEdges,
}));

// --- Imports under test (after mocks are in place) ---------------------------
import { createEdgeSlice, emptyEdgeState } from '../../../src/client/store/slices/edgeSlice.ts';
import { internals } from '../../../src/client/store/internals.ts';
import { EDGE_DETAIL } from '../../../src/shared/constants.ts';
import { makeEdge } from '../../helpers.ts';
import type { GraphState } from '../../../src/client/store/types.ts';
import type { IndexedDBCache } from '../../../src/client/cache/IndexedDBCache.ts';

// --- Helpers ----------------------------------------------------------------
type SliceMethods = Pick<GraphState, 'loadNodeEdges'>;

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
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set<string>(),
    detailEdgeNodeIds: new Set<string>(),
    currentWorkspace: '.',
    ...overrides,
  } as unknown as GraphState;
}

function makeSlice(initial: Partial<GraphState> = {}): SliceHarness {
  let state = makeState(initial);
  const set = vi.fn((partial: Partial<GraphState>) => {
    state = { ...state, ...partial } as GraphState;
  });
  const get = vi.fn(() => state);
  const slice = createEdgeSlice(set, get) as SliceMethods;
  state = { ...slice, ...state } as GraphState;
  return { set, get, slice, get state() { return state; } };
}

function nextTick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  mocks.fetchEdges.mockReset();
  internals.expandGeneration = 0;
  internals.persistentCache = null;
  internals.expandAbortControllers.clear();
  internals.edgeRequestSeq.clear();
});

afterEach(() => {
  internals.persistentCache = null;
  internals.expandAbortControllers.clear();
  internals.edgeRequestSeq.clear();
});

describe('edgeSlice', () => {
  describe('emptyEdgeState', () => {
    it('returns fresh empty collections on every call', () => {
      const a = emptyEdgeState();
      const b = emptyEdgeState();
      expect(a.nodeEdgesByNodeId.size).toBe(0);
      expect(a.nodeEdgeTotals.size).toBe(0);
      expect(a.nodeEdgeCursors.size).toBe(0);
      expect(a.loadingEdgeNodeIds.size).toBe(0);
      expect(a.detailEdgeNodeIds.size).toBe(0);
      expect(a.nodeEdgesByNodeId).not.toBe(b.nodeEdgesByNodeId);
      expect(a.loadingEdgeNodeIds).not.toBe(b.loadingEdgeNodeIds);
      expect(a.detailEdgeNodeIds).not.toBe(b.detailEdgeNodeIds);
    });
  });

  describe('loadNodeEdges', () => {
    it('fetches the first page and stores edges, total and cursor', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      const e2 = makeEdge('e2', 'n3', 'n1', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1, e2], total: 2, cursor: 2, hasMore: false });

      const h = makeSlice();
      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).toHaveBeenCalledWith(
        'n1', 'file', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', false,
      );
      expect(h.state.nodeEdgesByNodeId.get('n1')).toEqual([e1, e2]);
      expect(h.state.nodeEdgeTotals.get('n1')).toBe(2);
      expect(h.state.nodeEdgeCursors.get('n1')).toBe(2);
      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(false);
    });

    it('passes scope=file by default and honours an explicit symbol scope', async () => {
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');
      expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
        'n1', 'file', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', false,
      );

      mocks.fetchEdges.mockClear();
      await h.slice.loadNodeEdges('n2', { scope: 'symbol' });
      expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
        'n2', 'symbol', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', false,
      );
    });

    it('forwards the active workspace to the request', async () => {
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice({ currentWorkspace: '/repo' });

      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).toHaveBeenCalledWith(
        'n1', 'file', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '/repo', false,
      );
    });

    it('skips the request when a complete page is already loaded', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      const h = makeSlice({
        nodeEdgesByNodeId: new Map([['n1', [e1]]]),
        nodeEdgeTotals: new Map([['n1', 1]]),
        nodeEdgeCursors: new Map([['n1', 1]]),
      });

      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).not.toHaveBeenCalled();
    });

    it('refetches when the loaded page is shorter than the server total', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 9, cursor: 1, hasMore: true });
      const h = makeSlice({
        nodeEdgesByNodeId: new Map([['n1', [e1]]]),
        nodeEdgeTotals: new Map([['n1', 9]]),
        nodeEdgeCursors: new Map([['n1', 1]]),
      });

      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).toHaveBeenCalledTimes(1);
    });

    it('coalesces a concurrent request for the same node', async () => {
      let release: ((v: unknown) => void) | null = null;
      mocks.fetchEdges.mockImplementation(() => new Promise((r) => { release = r; }));
      const h = makeSlice();

      const first = h.slice.loadNodeEdges('n1');
      await nextTick(0);
      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).toHaveBeenCalledTimes(1);
      release!({ edges: [], total: 0, cursor: 0, hasMore: false });
      await first;
    });

    it('appends the next page without refetching the first', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      const e2 = makeEdge('e2', 'n1', 'n3', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 2, cursor: 1, hasMore: true });
      const h = makeSlice();
      await h.slice.loadNodeEdges('n1');

      mocks.fetchEdges.mockResolvedValue({ edges: [e2], total: 2, cursor: 2, hasMore: false });
      await h.slice.loadNodeEdges('n1', { append: true });

      expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
        'n1', 'file', 1, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', false,
      );
      expect(h.state.nodeEdgesByNodeId.get('n1')?.map((e) => e.id)).toEqual(['e1', 'e2']);
      expect(h.state.nodeEdgeCursors.get('n1')).toBe(2);
    });

    it('deduplicates edges that the server repeats across pages', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 2, cursor: 1, hasMore: true });
      const h = makeSlice();
      await h.slice.loadNodeEdges('n1');

      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 2, cursor: 2, hasMore: false });
      await h.slice.loadNodeEdges('n1', { append: true });

      expect(h.state.nodeEdgesByNodeId.get('n1')).toHaveLength(1);
    });

    it('appends to an empty list when appending with no prior page', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 1, cursor: 1, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { append: true });

      expect(mocks.fetchEdges).toHaveBeenCalledWith(
        'n1', 'file', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', false,
      );
      expect(h.state.nodeEdgesByNodeId.get('n1')).toEqual([e1]);
    });

    it('tolerates a malformed response with a non-array edges field', async () => {
      mocks.fetchEdges.mockResolvedValue({ edges: undefined, total: 0, cursor: 0, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(h.state.nodeEdgesByNodeId.get('n1')).toEqual([]);
    });

    it('logs and returns without state changes when the request yields null', async () => {
      mocks.fetchEdges.mockResolvedValue(null);
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(h.state.nodeEdgesByNodeId.has('n1')).toBe(false);
      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(false);
    });

    it('clears the loading flag and does not throw when the request rejects', async () => {
      mocks.fetchEdges.mockRejectedValue(new Error('network'));
      const h = makeSlice();

      await expect(h.slice.loadNodeEdges('n1')).resolves.toBeUndefined();

      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(false);
    });

    it('swallows AbortError without recording a failure', async () => {
      mocks.fetchEdges.mockRejectedValue(new DOMException('aborted', 'AbortError'));
      const h = makeSlice();

      await expect(h.slice.loadNodeEdges('n1')).resolves.toBeUndefined();

      expect(h.state.nodeEdgesByNodeId.has('n1')).toBe(false);
    });

    it('discards a response that arrives after a generation bump', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockImplementation(async () => {
        internals.expandGeneration++;
        return { edges: [e1], total: 1, cursor: 1, hasMore: false };
      });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(h.state.nodeEdgesByNodeId.has('n1')).toBe(false);
    });

    it('releases its own loading flag even when a graph reload bumps the generation', async () => {
      mocks.fetchEdges.mockImplementation(async () => {
        internals.expandGeneration++;
        return { edges: [], total: 0, cursor: 0, hasMore: false };
      });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      // The generation guard drops the payload, but the per-node request token still
      // owns the loading flag, so it must not leak a permanent spinner.
      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(false);
    });

    it('reads a complete page from IndexedDB without hitting the network', async () => {
      const cachedEdge = makeEdge('cached', 'n1', 'n2', 'call');
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue({ edges: [cachedEdge], total: 1 }),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).not.toHaveBeenCalled();
      expect(h.state.nodeEdgesByNodeId.get('n1')).toEqual([cachedEdge]);
      expect(h.state.nodeEdgeTotals.get('n1')).toBe(1);
    });

    it('keys the cache by node id and scope', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue(null),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { scope: 'symbol' });

      expect(cacheMock.getEdges).toHaveBeenCalledWith('edges:symbol:n1');
    });

    it('persists only a complete page', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue(null),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchEdges.mockResolvedValue({ edges: [makeEdge('e1', 'n1', 'n2', 'call')], total: 9, cursor: 1, hasMore: true });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(cacheMock.setEdges).not.toHaveBeenCalled();
    });

    it('writes the merged page to the cache once the server reports no more', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue(null),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 1, cursor: 1, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(cacheMock.setEdges).toHaveBeenCalledWith('edges:file:n1', { edges: [e1], total: 1 });
    });

    it('falls through to the network when the cache holds an empty page', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue({ edges: [], total: 0 }),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      mocks.fetchEdges.mockResolvedValue({ edges: [e1], total: 1, cursor: 1, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(mocks.fetchEdges).toHaveBeenCalledTimes(1);
      expect(h.state.nodeEdgesByNodeId.get('n1')).toEqual([e1]);
    });

    it('ignores a cache hit that arrives after a generation bump', async () => {
      const cachedEdge = makeEdge('cached', 'n1', 'n2', 'call');
      const cacheMock = {
        getEdges: vi.fn().mockImplementation(async () => {
          internals.expandGeneration++;
          return { edges: [cachedEdge], total: 1 };
        }),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1');

      expect(h.state.nodeEdgesByNodeId.has('n1')).toBe(false);
      expect(mocks.fetchEdges).not.toHaveBeenCalled();
    });

    it('does not consult the cache when appending', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue({ edges: [], total: 0 }),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { append: true });

      expect(cacheMock.getEdges).not.toHaveBeenCalled();
    });

    it('keeps the loaded flag set while the request is in flight', async () => {
      let release: ((v: unknown) => void) | null = null;
      mocks.fetchEdges.mockImplementation(() => new Promise((r) => { release = r; }));
      const h = makeSlice();

      const pending = h.slice.loadNodeEdges('n1');
      await nextTick(0);

      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(true);
      release!({ edges: [], total: 0, cursor: 0, hasMore: false });
      await pending;
      expect(h.state.loadingEdgeNodeIds.has('n1')).toBe(false);
    });
  });

  // --- P1-3: expanding a file-pair aggregate into raw edges ------------------
  // The aggregate page reports `hasMore: false` and `total === edges.length`, so
  // the "complete page" early-return would block the detail request forever. These
  // cases pin the escape hatch and the sticky per-node detail flag.
  describe('detail mode (expand aggregated edges)', () => {
    const aggregate = () => {
      const e = makeEdge('agg:pair', 'n1', 'lib/util.ts', 'dependency');
      e.properties = { aggregated: true, count: 25, filePair: 'lib/util.ts\0src/main.ts' };
      return e;
    };

    it('requests unaggregated edges with detail=true', async () => {
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { detail: true });

      expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
        'n1', 'file', 0, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', true,
      );
      expect(h.state.detailEdgeNodeIds.has('n1')).toBe(true);
    });

    it('overrides the complete-page early return when the page is an aggregate', async () => {
      const agg = aggregate();
      mocks.fetchEdges.mockResolvedValue({ edges: [], total: 0, cursor: 0, hasMore: false });
      const h = makeSlice({
        nodeEdgesByNodeId: new Map([['n1', [agg]]]),
        nodeEdgeTotals: new Map([['n1', 1]]),
        nodeEdgeCursors: new Map([['n1', 1]]),
      });

      await h.slice.loadNodeEdges('n1', { detail: true });

      // Without the override this would be 0 calls — the aggregate reports
      // loaded.length === knownTotal, exactly like a genuinely complete page.
      expect(mocks.fetchEdges).toHaveBeenCalledTimes(1);
    });

    it('still skips a complete page that is not an aggregate', async () => {
      const e1 = makeEdge('e1', 'n1', 'n2', 'call');
      const h = makeSlice({
        nodeEdgesByNodeId: new Map([['n1', [e1]]]),
        nodeEdgeTotals: new Map([['n1', 1]]),
        nodeEdgeCursors: new Map([['n1', 1]]),
      });

      await h.slice.loadNodeEdges('n1', { detail: true });

      expect(mocks.fetchEdges).not.toHaveBeenCalled();
    });

    it('keeps requesting detail for later pages once the flag is set', async () => {
      mocks.fetchEdges.mockResolvedValue({ edges: [makeEdge('e1', 'n1', 'n2', 'call')], total: 2, cursor: 1, hasMore: true });
      const h = makeSlice();
      await h.slice.loadNodeEdges('n1', { detail: true });

      mocks.fetchEdges.mockClear();
      mocks.fetchEdges.mockResolvedValue({ edges: [makeEdge('e2', 'n1', 'n3', 'call')], total: 2, cursor: 2, hasMore: false });
      // No `detail` in the options: the sticky per-node flag must carry it.
      await h.slice.loadNodeEdges('n1', { append: true });

      expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
        'n1', 'file', 1, EDGE_DETAIL.PAGE_SIZE, expect.any(AbortSignal), '.', true,
      );
    });

    it('never reads the cache in detail mode', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue({ edges: [aggregate()], total: 1 }),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchEdges.mockResolvedValue({ edges: [makeEdge('e1', 'n1', 'n2', 'call')], total: 1, cursor: 1, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { detail: true });

      // The cached payload IS the aggregate the user asked to leave.
      expect(cacheMock.getEdges).not.toHaveBeenCalled();
    });

    it('never writes the cache in detail mode', async () => {
      const cacheMock = {
        getEdges: vi.fn().mockResolvedValue(null),
        setEdges: vi.fn().mockResolvedValue(undefined),
      } as unknown as IndexedDBCache;
      internals.persistentCache = cacheMock;
      mocks.fetchEdges.mockResolvedValue({ edges: [makeEdge('e1', 'n1', 'n2', 'call')], total: 1, cursor: 1, hasMore: false });
      const h = makeSlice();

      await h.slice.loadNodeEdges('n1', { detail: true });

      // A detail page must not poison the aggregate cache for the next visit.
      expect(cacheMock.setEdges).not.toHaveBeenCalled();
    });

    it('resets the detail flag when the graph is replaced', () => {
      const cleared = emptyEdgeState();
      expect(cleared.detailEdgeNodeIds.size).toBe(0);
    });
  });
});
