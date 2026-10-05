/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { logger } from '../../../src/shared/Logger.ts';

const mocks = vi.hoisted(() => ({
  fetchGraphDataIncremental: vi.fn(),
  coerceGraphData: vi.fn(),
  coerceGraphDelta: vi.fn(),
  getState: vi.fn(),
  setGraphData: vi.fn(),
  applyGraphDelta: vi.fn(),
  loadBootstrap: vi.fn(),
  setInitStatus: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchGraphDataIncremental: mocks.fetchGraphDataIncremental,
}));

vi.mock('../../../src/shared/GraphValidator.ts', () => ({
  coerceGraphData: mocks.coerceGraphData,
  coerceGraphDelta: mocks.coerceGraphDelta,
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { setupSSEEvents } from '../../../src/client/runtime/SSEEvents.ts';

class MockEventSource {
  static instances: MockEventSource[] = [];
  static last(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1]!;
  }
  url: string;
  listeners = new Map<string, (e: MessageEvent) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    const fn = this.listeners.get(type);
    if (fn) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

let activeDisposers: Array<() => void> = [];
function createCtx(): { ctx: Context; disposers: Array<() => void> } {
  const disposers: Array<() => void> = [];
  activeDisposers = disposers;
  const ctx = {
    effect: vi.fn((setup: () => (() => void) | void) => {
      const d = setup();
      if (typeof d === 'function') disposers.push(d);
    }),
    emit: vi.fn(),
  } as unknown as Context;
  return { ctx, disposers };
}

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [{ id: 'n1' }],
    panelVisible: true,
    lastUpdated: 123,
    repoId: 'r1',
    setGraphData: mocks.setGraphData,
    applyGraphDelta: mocks.applyGraphDelta,
    loadBootstrap: mocks.loadBootstrap,
    setInitStatus: mocks.setInitStatus,
    ...overrides,
  };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('setupSSEEvents', () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    mocks.fetchGraphDataIncremental.mockReset();
    mocks.coerceGraphData.mockReset();
    mocks.coerceGraphDelta.mockReset();
    mocks.getState.mockReset();
    mocks.setGraphData.mockReset();
    mocks.applyGraphDelta.mockReset();
    mocks.loadBootstrap.mockReset();
    mocks.setInitStatus.mockReset();
    mocks.getState.mockReturnValue(createStore());
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource as typeof EventSource;
  });

  it('returns early when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const effectSpy = vi.fn();
    const ctx = { effect: effectSpy, emit: vi.fn() } as unknown as Context;
    setupSSEEvents(ctx);
    expect(effectSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('creates EventSource connected to events endpoint', () => {
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    expect(MockEventSource.last().url).toBe('/api/v1/codegraph/events');
  });

  it('graph-updated triggers incremental fetch and setGraphData', async () => {
    mocks.fetchGraphDataIncremental.mockResolvedValue({
      nodes: [{ id: 'n2' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1 },
    });
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-updated', { repoId: 'r1', nodeCount: 2, edgeCount: 0 });
    await flush();
    expect(mocks.fetchGraphDataIncremental).toHaveBeenCalledWith(123);
    expect(mocks.setGraphData).toHaveBeenCalledWith(
      [{ id: 'n2' }],
      [],
      'r1',
      { repoId: 'r1', timestamp: 1 },
    );
  });

  it('graph-updated re-bootstraps when the graph is empty (index was still building)', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    mocks.getState.mockReturnValue(createStore({ nodes: [] }));
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-updated', { repoId: 'r1' });
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.fetchGraphDataIncremental).not.toHaveBeenCalled();
  });

  it('graph-updated skips setGraphData when incremental fetch returns null', async () => {
    mocks.fetchGraphDataIncremental.mockResolvedValue(null);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-updated', { repoId: 'r1' });
    await flush();
    expect(mocks.setGraphData).not.toHaveBeenCalled();
  });

  it('graph-updated incremental fetch failure logs warn', async () => {
    mocks.fetchGraphDataIncremental.mockRejectedValue(new Error('inc fail'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-updated', { repoId: 'r1' });
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: incremental fetch failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('graph-data triggers coerceGraphData and setGraphData', async () => {
    const coerced = { nodes: [{ id: 'n2' }], edges: [], metadata: { repoId: 'r1', timestamp: 1 } };
    mocks.coerceGraphData.mockReturnValue(coerced);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-data', { repoId: 'r1', nodes: [{ id: 'n2' }], edges: [] });
    await flush();
    expect(mocks.coerceGraphData).toHaveBeenCalled();
    expect(mocks.setGraphData).toHaveBeenCalledWith(coerced.nodes, coerced.edges, 'r1', coerced.metadata);
  });

  it('graph-data skips when panelVisible false', async () => {
    mocks.getState.mockReturnValue(createStore({ panelVisible: false }));
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-data', { repoId: 'r1', nodes: [{ id: 'n2' }], edges: [] });
    await flush();
    expect(mocks.coerceGraphData).not.toHaveBeenCalled();
  });

  it('graph-data skips when coerceGraphData returns null', async () => {
    mocks.coerceGraphData.mockReturnValue(null);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-data', { repoId: 'r1', nodes: [{ id: 'n2' }], edges: [] });
    await flush();
    expect(mocks.setGraphData).not.toHaveBeenCalled();
  });

  it('repo-imported triggers loadBootstrap when panelVisible', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('repo-imported', {});
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('repo-imported skips when panelVisible false', async () => {
    mocks.getState.mockReturnValue(createStore({ panelVisible: false }));
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('repo-imported', {});
    await flush();
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
  });

  it('repo-scanned triggers loadBootstrap when panelVisible', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('repo-scanned', {});
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('repo-scanned bootstrap failure logs warn', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('boot fail'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('repo-scanned', {});
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: bootstrap failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('init-result success sets done and loads bootstrap', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('init-result', { success: true, path: '/p' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('done');
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('init-result failure sets error status', async () => {
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('init-result', { success: false, message: 'bad' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('error');
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
  });

  it('init-result bootstrap failure logs warn', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('after init fail'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('init-result', { success: true, path: '/p' });
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: bootstrap after init failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('onerror closes connection and schedules reconnect after 10s', async () => {
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    const first = MockEventSource.last();
    first.onerror!();
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockEventSource.instances.length).toBe(2);
  });

  it('cleanup closes eventSource and clears reconnectTimer', async () => {
    const { ctx, disposers } = createCtx();
    setupSSEEvents(ctx);
    const es = MockEventSource.last();
    es.onerror!();
    disposers[0]!();
    expect(es.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockEventSource.instances.length).toBe(1);
  });

  it('connect failure schedules reconnect', async () => {
    globalThis.EventSource = class {
      constructor() {
        throw new Error('connect boom');
      }
    } as unknown as typeof EventSource;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: connect failed', expect.any(Error));
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockEventSource.instances.length).toBe(1);
    warnSpy.mockRestore();
  });

  // ── P2-21: graph-delta ───────────────────────────────────────────────────
  describe('graph-delta', () => {
    const delta = {
      addedNodes: [{ id: 'n2' }], removedNodes: [], modifiedNodes: [],
      addedEdges: [], removedEdges: [], modifiedEdges: [],
    };

    // The host already sent the delta, so re-fetching the whole graph here would throw away the
    // entire point of the incremental path.
    it('graph-updated with incremental flag does not re-fetch the full graph', async () => {
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-updated', { repoId: 'r1', incremental: true });
      await flush();
      expect(mocks.fetchGraphDataIncremental).not.toHaveBeenCalled();
    });

    it('graph-updated without the incremental flag still re-fetches', async () => {
      mocks.fetchGraphDataIncremental.mockResolvedValue({
        nodes: [{ id: 'n2' }], edges: [], metadata: { repoId: 'r1', timestamp: 2 },
      });
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-updated', { repoId: 'r1' });
      await flush();
      expect(mocks.fetchGraphDataIncremental).toHaveBeenCalledWith(123);
    });

    it('graph-delta coerces and applies the delta', async () => {
      const coerced = { ...delta };
      mocks.coerceGraphDelta.mockReturnValue(coerced);
      mocks.applyGraphDelta.mockReturnValue(true);
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1', delta, timestamp: 2 });
      await flush();
      expect(mocks.coerceGraphDelta).toHaveBeenCalledWith(delta);
      expect(mocks.applyGraphDelta).toHaveBeenCalledWith(coerced);
      expect(mocks.loadBootstrap).not.toHaveBeenCalled();
    });

    it('graph-delta skips when panelVisible is false', async () => {
      mocks.getState.mockReturnValue(createStore({ panelVisible: false }));
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1', delta });
      await flush();
      expect(mocks.coerceGraphDelta).not.toHaveBeenCalled();
    });

    it('graph-delta skips when the payload carries no delta', async () => {
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1' });
      await flush();
      expect(mocks.coerceGraphDelta).not.toHaveBeenCalled();
    });

    it('graph-delta falls back to bootstrap when the payload is malformed', async () => {
      mocks.coerceGraphDelta.mockReturnValue(null);
      mocks.loadBootstrap.mockResolvedValue(true);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1', delta });
      await flush();
      expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: graph-delta payload malformed, falling back to bootstrap', undefined);
      expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
      expect(mocks.applyGraphDelta).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    // A delta describes one specific revision. When it no longer matches what the store holds, the
    // honest recovery is a full reload — never a half-applied graph.
    it('graph-delta falls back to bootstrap when the delta does not apply', async () => {
      mocks.coerceGraphDelta.mockReturnValue(delta);
      mocks.applyGraphDelta.mockReturnValue(false);
      mocks.loadBootstrap.mockResolvedValue(true);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1', delta });
      await flush();
      expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: graph-delta did not apply, falling back to bootstrap', undefined);
      expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('graph-delta bootstrap failure logs warn', async () => {
      mocks.coerceGraphDelta.mockReturnValue(delta);
      mocks.applyGraphDelta.mockReturnValue(false);
      mocks.loadBootstrap.mockRejectedValue(new Error('boot fail'));
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', { repoId: 'r1', delta });
      await flush();
      expect(warnSpy).toHaveBeenCalledWith('client', 'SSE: bootstrap after refused delta failed', expect.any(Error));
      warnSpy.mockRestore();
    });
  });

  // P0: the host keeps one graph slot while the client can browse any workspace, so events for the
  // workspace the user switched away from keep arriving on the same SSE channel. Applying them
  // replaces the visible graph with a foreign one; ignoring them is the only correct behaviour, and
  // it must NOT trigger a bootstrap (that would fight the graph the user is actually looking at).
  describe('cross-workspace guard', () => {
    it('graph-delta from another workspace is ignored without a bootstrap', async () => {
      mocks.getState.mockReturnValue(createStore({ repoId: '/repo/current' }));
      mocks.coerceGraphDelta.mockReturnValue({});
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', {
        repoId: '/repo/other',
        delta: { addedNodes: [{ id: 'n2' }], removedNodes: [], modifiedNodes: [], addedEdges: [], removedEdges: [], modifiedEdges: [] },
      });
      await flush();
      expect(mocks.coerceGraphDelta).not.toHaveBeenCalled();
      expect(mocks.applyGraphDelta).not.toHaveBeenCalled();
      expect(mocks.loadBootstrap).not.toHaveBeenCalled();
    });

    it('graph-data from another workspace is ignored without a bootstrap', async () => {
      mocks.getState.mockReturnValue(createStore({ repoId: '/repo/current' }));
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-data', { repoId: '/repo/other', nodes: [{ id: 'n2' }], edges: [] });
      await flush();
      expect(mocks.coerceGraphData).not.toHaveBeenCalled();
      expect(mocks.setGraphData).not.toHaveBeenCalled();
      expect(mocks.loadBootstrap).not.toHaveBeenCalled();
    });

    it('graph-updated from another workspace is ignored without a re-fetch', async () => {
      mocks.getState.mockReturnValue(createStore({ repoId: '/repo/current' }));
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-updated', { repoId: '/repo/other' });
      await flush();
      expect(mocks.fetchGraphDataIncremental).not.toHaveBeenCalled();
      expect(mocks.loadBootstrap).not.toHaveBeenCalled();
    });

    // Before the first load the store has no identity yet; dropping those events would leave the
    // panel permanently empty, so an unknown identity must be let through.
    it('events are accepted while the store has no workspace identity yet', async () => {
      mocks.getState.mockReturnValue(createStore({ repoId: null }));
      mocks.fetchGraphDataIncremental.mockResolvedValue({
        nodes: [{ id: 'n2' }], edges: [], metadata: { repoId: '/repo/other', timestamp: 2 },
      });
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-updated', { repoId: '/repo/other' });
      await flush();
      expect(mocks.fetchGraphDataIncremental).toHaveBeenCalledWith(123);
    });

    // A separator-only difference is the same workspace; the guard must normalise before comparing.
    it('a separator-only difference is treated as the same workspace', async () => {
      mocks.getState.mockReturnValue(createStore({ repoId: 'D:/Projects/repo' }));
      mocks.coerceGraphDelta.mockReturnValue({});
      mocks.applyGraphDelta.mockReturnValue(true);
      const { ctx } = createCtx();
      setupSSEEvents(ctx);
      MockEventSource.last().emit('graph-delta', {
        repoId: 'D:\\Projects\\repo',
        delta: { addedNodes: [{ id: 'n2' }], removedNodes: [], modifiedNodes: [], addedEdges: [], removedEdges: [], modifiedEdges: [] },
      });
      await flush();
      expect(mocks.applyGraphDelta).toHaveBeenCalled();
    });
  });
});