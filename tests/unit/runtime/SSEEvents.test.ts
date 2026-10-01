/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { logger } from '../../../src/shared/Logger.ts';

const mocks = vi.hoisted(() => ({
  fetchGraphDataIncremental: vi.fn(),
  coerceGraphData: vi.fn(),
  getState: vi.fn(),
  setGraphData: vi.fn(),
  loadBootstrap: vi.fn(),
  setInitStatus: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchGraphDataIncremental: mocks.fetchGraphDataIncremental,
}));

vi.mock('../../../src/shared/GraphValidator.ts', () => ({
  coerceGraphData: mocks.coerceGraphData,
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
    setGraphData: mocks.setGraphData,
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
    mocks.getState.mockReset();
    mocks.setGraphData.mockReset();
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

  it('graph-updated skips fetch when nodes empty', async () => {
    mocks.getState.mockReturnValue(createStore({ nodes: [] }));
    const { ctx } = createCtx();
    setupSSEEvents(ctx);
    MockEventSource.last().emit('graph-updated', { repoId: 'r1' });
    await flush();
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
});