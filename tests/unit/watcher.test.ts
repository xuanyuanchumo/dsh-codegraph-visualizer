import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { makeGraphData, makeNode } from '../helpers.ts';
import { logger } from '../../src/shared/Logger.ts';
import { computeGraphFingerprint } from '../../src/shared/graphFingerprint.ts';

vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: vi.fn(),
}));

// The incremental path talks to a real SQLite index; here we only care about the watcher's decision
// logic around it (publish, stay quiet, or fall back to the full fetch).
const { incrementalMock } = vi.hoisted(() => ({
  incrementalMock: { buildIncrementalUpdate: vi.fn() },
}));

vi.mock('../../src/host/incrementalUpdate.ts', () => ({
  buildIncrementalUpdate: incrementalMock.buildIncrementalUpdate,
}));

const { watchMock } = vi.hoisted(() => ({
  watchMock: {
    callback: null as ((eventType: string, filename: string | null) => void) | null,
    lastWatcher: null as { close: ReturnType<typeof vi.fn> } | null,
  },
}));

vi.mock('node:fs', () => ({
  watch: vi.fn((_path: string, _opts: unknown, cb: (eventType: string, filename: string | null) => void) => {
    watchMock.callback = cb;
    watchMock.lastWatcher = { close: vi.fn() };
    return watchMock.lastWatcher;
  }),
}));

const { registerWatcher, registerEventListeners } = await import('../../src/host/watcher.ts');
const { fetchMergedGraph } = await import('../../src/tools.ts');
const mockedFetchMergedGraph = vi.mocked(fetchMergedGraph);
const { watch: fsWatch } = await import('node:fs');
const mockedFsWatch = vi.mocked(fsWatch);

type MockCtx = Omit<Context, 'effect' | 'on' | 'emit'> & {
  effect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

function makeMockCtx(): MockCtx {
  return {
    effect: vi.fn((fn: () => unknown) => fn()),
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  } as unknown as MockCtx;
}

const config = {
  dataSource: 'auto' as const,
  requestTimeout: 5000,
  scanCacheTtl: 30000,
  scanCacheLimit: 4,
  maxBodyBytes: 1048576,
  prerequisiteRetryDelay: 3000,
  watchDebounce: 100,
  maxNodes: 1000,
  allowedOrigins: [],
  panelMinHeight: 240,
  panelDefaultHeight: 600,
};

describe('registerWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers effect without throwing', () => {
    const ctx = makeMockCtx();
    registerWatcher(ctx, config, vi.fn());
    expect(ctx.effect).toHaveBeenCalled();
  });

  it('returns dispose function from effect', () => {
    const ctx = makeMockCtx();
    registerWatcher(ctx, config, vi.fn());
    expect(ctx.effect).toHaveBeenCalled();
  });
});

describe('registerEventListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers 4 event listeners via ctx.effect', () => {
    const ctx = makeMockCtx();
    registerEventListeners(ctx, vi.fn());
    expect(ctx.effect).toHaveBeenCalledTimes(4);
  });

  it('repo imported listener emits graph updated event', () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    registerEventListeners(ctx, vi.fn());
    const importedCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/repo/imported');
    expect(importedCb).toBeDefined();
    importedCb!.cb({ repoId: 'r1', timestamp: 123 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', { repoId: 'r1', nodeCount: 0, edgeCount: 0, timestamp: 123 });
  });

  it('repo scanned listener emits graph updated event', () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    registerEventListeners(ctx, vi.fn());
    const scannedCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/repo/scanned');
    expect(scannedCb).toBeDefined();
    scannedCb!.cb({ repoId: 'r2', timestamp: 456 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', { repoId: 'r2', nodeCount: 0, edgeCount: 0, timestamp: 456 });
  });

  it('request-scan listener calls scanAndPush', async () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void | Promise<void> }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void | Promise<void>) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    registerEventListeners(ctx, vi.fn());
    const scanCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/repo/request-scan');
    expect(scanCb).toBeDefined();
    await scanCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: '/repo' }));
  });

  it('graph init listener emits init-result on success', async () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void | Promise<void> }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void | Promise<void>) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    const invokeUpstream = vi.fn().mockResolvedValue({ success: true });
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    registerEventListeners(ctx, invokeUpstream);
    const initCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/graph/init');
    expect(initCb).toBeDefined();
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/init-result', expect.objectContaining({ success: true }));
  });

  it('graph init listener emits failed init-result when init returns null', async () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void | Promise<void> }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void | Promise<void>) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    registerEventListeners(ctx, invokeUpstream);
    const initCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/graph/init');
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/init-result', expect.objectContaining({ success: false }));
  });

  it('graph init listener emits failed init-result on exception', async () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void | Promise<void> }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void | Promise<void>) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    const invokeUpstream = vi.fn().mockRejectedValue(new Error('init failed'));
    registerEventListeners(ctx, invokeUpstream);
    const initCb = onCallbacks.find((c) => c.event === 'codegraph-visualizer/graph/init');
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/init-result', expect.objectContaining({ success: false, errorCode: 'INIT_FAILED' }));
  });
});
// ── Helper: capture watch/toggle callback from registerWatcher ────────────
function captureToggleCb(
  ctx: MockCtx,
  invokeUpstream: ReturnType<typeof vi.fn> = vi.fn(),
  state?: unknown,
): (e: { enabled: boolean; path: string; timestamp: number }) => void {
  let toggleCb: ((e: { enabled: boolean; path: string; timestamp: number }) => void) | null = null;
  ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
    if (event === 'codegraph-visualizer/watch/toggle') toggleCb = cb as typeof toggleCb;
    return vi.fn();
  });
  registerWatcher(ctx, config, invokeUpstream, state as Parameters<typeof registerWatcher>[3]);
  return toggleCb!;
}

// ── Helper: capture event callbacks from registerEventListeners ───────────
function captureEventCb(ctx: MockCtx, targetEvent: string): (e: unknown) => void | Promise<void> {
  const onCallbacks: Array<{ event: string; cb: (e: unknown) => void | Promise<void> }> = [];
  ctx.on = vi.fn((event: string, cb: (e: unknown) => void | Promise<void>) => {
    onCallbacks.push({ event, cb });
    return vi.fn();
  });
  registerEventListeners(ctx, vi.fn());
  const found = onCallbacks.find((c) => c.event === targetEvent);
  return found!.cb;
}

describe('scanAndPush error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('logs error when fetchMergedGraph fails', async () => {
    const ctx = makeMockCtx();
    const errorSpy = vi.spyOn(logger, 'error');
    mockedFetchMergedGraph.mockRejectedValue(new Error('fetch failed'));
    const scanCb = captureEventCb(ctx, 'codegraph-visualizer/repo/request-scan');
    await scanCb({ path: '/repo', timestamp: 1 });
    expect(errorSpy).toHaveBeenCalledWith('host', 'scan failed', expect.any(Error));
  });

  it('emits both graph/updated and graph/data events on success', async () => {
    const ctx = makeMockCtx();
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    const scanCb = captureEventCb(ctx, 'codegraph-visualizer/repo/request-scan');
    await scanCb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({
      repoId: '/repo',
      nodeCount: 1,
      edgeCount: 0,
    }));
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/data', expect.objectContaining({
      repoId: '/repo',
      nodes: graphData.nodes,
      edges: graphData.edges,
    }));
  });

  // P0-6: the watcher must publish the same structural fingerprint the snapshot table is keyed by,
  // so a consumer can tell an unchanged re-scan from a real change without diffing nodes/edges.
  it('publishes the structural fingerprint on both events', async () => {
    const ctx = makeMockCtx();
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    const scanCb = captureEventCb(ctx, 'codegraph-visualizer/repo/request-scan');
    await scanCb({ path: '/repo', timestamp: 1 });

    const expected = computeGraphFingerprint(graphData);
    const updated = ctx.emit.mock.calls.find(([name]) => name === 'codegraph-visualizer/graph/updated')?.[1];
    const data = ctx.emit.mock.calls.find(([name]) => name === 'codegraph-visualizer/graph/data')?.[1];
    expect((updated as { fingerprint: string }).fingerprint).toBe(expected);
    expect((data as { fingerprint: string }).fingerprint).toBe(expected);
  });

  it('keeps the fingerprint stable when only metadata.timestamp changes', async () => {
    const ctx = makeMockCtx();
    mockedFetchMergedGraph.mockResolvedValue(
      makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], 'test-repo', 1),
    );
    const scanCb = captureEventCb(ctx, 'codegraph-visualizer/repo/request-scan');
    await scanCb({ path: '/repo', timestamp: 1 });
    const first = (ctx.emit.mock.calls.find(([n]) => n === 'codegraph-visualizer/graph/data')?.[1] as { fingerprint: string }).fingerprint;

    ctx.emit.mockClear();
    mockedFetchMergedGraph.mockResolvedValue(
      makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], 'test-repo', 987654),
    );
    await scanCb({ path: '/repo', timestamp: 987654 });
    const second = (ctx.emit.mock.calls.find(([n]) => n === 'codegraph-visualizer/graph/data')?.[1] as { fingerprint: string }).fingerprint;

    expect(first).toBe(second);
  });
});

describe('closeActiveWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('calls close() on activeWatcher when it exists', () => {
    const ctx = makeMockCtx();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    expect(watchMock.lastWatcher).not.toBeNull();
    const watcher = watchMock.lastWatcher!;
    toggleCb({ enabled: false, path: '/repo', timestamp: 2 });
    expect(watcher.close).toHaveBeenCalled();
  });

  it('calls clearTimeout when watchTimer exists', () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', 'src/file.ts');
    expect(vi.getTimerCount()).toBe(1);
    toggleCb({ enabled: false, path: '/repo', timestamp: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues cleanup even if close() throws', () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    const watcher = watchMock.lastWatcher!;
    watcher.close.mockImplementation(() => { throw new Error('close failed'); });
    watchMock.callback!('change', 'src/file.ts');
    expect(vi.getTimerCount()).toBe(1);
    toggleCb({ enabled: false, path: '/repo', timestamp: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('effect cleanup disposes toggle listener and closes active watcher', () => {
    let cleanupFn: (() => void) | null = null;
    let toggleCb: ((e: { enabled: boolean; path: string; timestamp: number }) => void) | null = null;
    const disposeSpy = vi.fn();
    const ctx = makeMockCtx();
    ctx.effect = vi.fn((fn: () => (() => void) | void) => {
      cleanupFn = fn() as (() => void) | null;
    });
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      if (event === 'codegraph-visualizer/watch/toggle') toggleCb = cb as typeof toggleCb;
      return disposeSpy;
    });
    registerWatcher(ctx, config, vi.fn());
    expect(cleanupFn).not.toBeNull();
    toggleCb!({ enabled: true, path: '/repo', timestamp: 1 });
    expect(watchMock.lastWatcher).not.toBeNull();
    const watcher = watchMock.lastWatcher!;
    cleanupFn!();
    expect(disposeSpy).toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalled();
  });
});

describe('watch toggle event handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('closes active watcher when enabled=false', () => {
    const ctx = makeMockCtx();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    const watcher = watchMock.lastWatcher!;
    toggleCb({ enabled: false, path: '/repo', timestamp: 2 });
    expect(watcher.close).toHaveBeenCalled();
  });

  it('creates new watcher when enabled=true', () => {
    const ctx = makeMockCtx();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    const expectedOpts = process.platform === 'win32' || process.platform === 'darwin' ? { recursive: true } : {};
    expect(mockedFsWatch).toHaveBeenCalledWith('/repo', expectedOpts, expect.any(Function));
  });

  it('logs error when watch setup fails', () => {
    const ctx = makeMockCtx();
    const errorSpy = vi.spyOn(logger, 'error');
    mockedFsWatch.mockImplementationOnce(() => { throw new Error('watch setup failed'); });
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    expect(errorSpy).toHaveBeenCalledWith('host', 'watch setup failed', expect.any(Error));
  });
});

describe('file change callback filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('skips processing when filename is null', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', null);
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 100);
    expect(invokeUpstream).not.toHaveBeenCalled();
  });

  it('filters .codegraph directory changes', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', '.codegraph/some-file');
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 100);
    expect(invokeUpstream).not.toHaveBeenCalled();
  });

  it('filters node_modules directory changes', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', 'node_modules/some-package/index.js');
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 100);
    expect(invokeUpstream).not.toHaveBeenCalled();
  });

  it('filters .git directory changes', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn();
    const toggleCb = captureToggleCb(ctx);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', '.git/HEAD');
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 100);
    expect(invokeUpstream).not.toHaveBeenCalled();
  });

  it('triggers debounced re-scan for valid file changes', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    // Override the ctx.on to pass invokeUpstream into registerWatcher
    let toggleCb: ((e: { enabled: boolean; path: string; timestamp: number }) => void) | null = null;
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      if (event === 'codegraph-visualizer/watch/toggle') toggleCb = cb as typeof toggleCb;
      return vi.fn();
    });
    registerWatcher(ctx, config, invokeUpstream);
    toggleCb!({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', 'src/file.ts');
    expect(invokeUpstream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(config.watchDebounce);
    expect(invokeUpstream).toHaveBeenCalledWith('codegraph_sync', { path: '/repo' });
  });

  it('consecutive file changes clear previous watchTimer', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    let toggleCb: ((e: { enabled: boolean; path: string; timestamp: number }) => void) | null = null;
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      if (event === 'codegraph-visualizer/watch/toggle') toggleCb = cb as typeof toggleCb;
      return vi.fn();
    });
    registerWatcher(ctx, config, invokeUpstream);
    toggleCb!({ enabled: true, path: '/repo', timestamp: 1 });
    // 第一次文件变更 — watchTimer 为 null，不调用 clearTimeout
    watchMock.callback!('change', 'src/file1.ts');
    expect(vi.getTimerCount()).toBe(1);
    // 第二次文件变更 — watchTimer 不为 null，调用 clearTimeout 重置 debounce
    watchMock.callback!('change', 'src/file2.ts');
    expect(vi.getTimerCount()).toBe(1); // 仍然只有一个 timer（旧的被清除，新的被设置）
    await vi.advanceTimersByTimeAsync(config.watchDebounce);
    expect(invokeUpstream).toHaveBeenCalledWith('codegraph_sync', { path: '/repo' });
  });

  it('debounce callback skips re-scan when activeWatcher is null', async () => {
    vi.useFakeTimers();
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn();
    let toggleCb: ((e: { enabled: boolean; path: string; timestamp: number }) => void) | null = null;
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      if (event === 'codegraph-visualizer/watch/toggle') toggleCb = cb as typeof toggleCb;
      return vi.fn();
    });
    registerWatcher(ctx, config, invokeUpstream);
    toggleCb!({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', 'src/file.ts');
    // 在 debounce 回调执行前关闭 watcher
    toggleCb!({ enabled: false, path: '/repo', timestamp: 2 });
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 100);
    // invokeUpstream 不应被调用，因为 activeWatcher 为 null
    expect(invokeUpstream).not.toHaveBeenCalled();
  });
});

describe('scanAndPush with empty path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses workspace-default when path is empty', async () => {
    const ctx = makeMockCtx();
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    const scanCb = captureEventCb(ctx, 'codegraph-visualizer/repo/request-scan');
    await scanCb({ path: '', timestamp: 1 });
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), 'workspace-default', 'both');
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({
      repoId: 'workspace-default',
    }));
  });
});

// ── P2-21: the watcher's targeted-update branch ───────────────────────────
describe('scanAndPush incremental updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchMock.callback = null;
    watchMock.lastWatcher = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const EMPTY_DELTA = {
    addedNodes: [], removedNodes: [], modifiedNodes: [],
    addedEdges: [], removedEdges: [], modifiedEdges: [],
  };

  /** Build a state surface backed by a mutable slot, the way src/index.ts wires the module state. */
  function makeState(initial: ReturnType<typeof makeGraphData> | null) {
    let current = initial;
    return {
      state: {
        getLastGraphData: () => current,
        setLastGraphData: (d: ReturnType<typeof makeGraphData> | null) => { current = d; },
      },
      read: () => current,
    };
  }

  /** Drive the debounced watcher once with a real file change and return after the timer fires. */
  async function fireChange(ctx: MockCtx, invokeUpstream: ReturnType<typeof vi.fn>, state: unknown, file = 'src/file.ts') {
    vi.useFakeTimers();
    const toggleCb = captureToggleCb(ctx, invokeUpstream, state);
    toggleCb({ enabled: true, path: '/repo', timestamp: 1 });
    watchMock.callback!('change', file);
    await vi.advanceTimersByTimeAsync(config.watchDebounce + 10);
  }

  it('publishes a graph/delta event carrying the real change', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '/repo');
    const { state } = makeState(current);
    const added = makeNode('n2', 'B', 'function', 'a.ts', 9);
    const next = makeGraphData([...current.nodes, added], [], '/repo', 42);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: { ...EMPTY_DELTA, addedNodes: [added] },
      next,
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(incrementalMock.buildIncrementalUpdate).toHaveBeenCalledWith({
      workspacePath: '/repo',
      changedFiles: ['src/file.ts'],
      current,
    });
    const deltaEvent = ctx.emit.mock.calls.find(([n]) => n === 'codegraph-visualizer/graph/delta')?.[1];
    expect(deltaEvent).toMatchObject({
      repoId: '/repo',
      timestamp: 42,
      changedFiles: ['src/file.ts'],
      delta: expect.objectContaining({ addedNodes: [added] }),
    });
  });

  // The incremental path already handed the client the delta, so re-sending the whole graph would
  // make the payload proportional to the repo again — exactly what P2-21 set out to avoid.
  it('does not re-send the whole graph on the incremental path', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '/repo');
    const { state } = makeState(current);
    const added = makeNode('n2', 'B', 'function', 'a.ts', 9);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: { ...EMPTY_DELTA, addedNodes: [added] },
      next: makeGraphData([...current.nodes, added], [], '/repo', 42),
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(mockedFetchMergedGraph).not.toHaveBeenCalled();
    expect(ctx.emit.mock.calls.some(([n]) => n === 'codegraph-visualizer/graph/data')).toBe(false);
  });

  it('marks the graph/updated event as incremental', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '/repo');
    const { state } = makeState(current);
    const added = makeNode('n2', 'B', 'function', 'a.ts', 9);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: { ...EMPTY_DELTA, addedNodes: [added] },
      next: makeGraphData([...current.nodes, added], [], '/repo', 42),
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({
      repoId: '/repo',
      nodeCount: 2,
      edgeCount: 0,
      incremental: true,
    }));
  });

  // A debounce tick that changes nothing must stay silent: publishing would make an idle editor
  // look like a stream of real updates and make the fingerprint meaningless.
  it('stays silent when the targeted read finds no structural change', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '/repo');
    const { state } = makeState(current);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: EMPTY_DELTA,
      next: current,
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(ctx.emit).not.toHaveBeenCalled();
    expect(mockedFetchMergedGraph).not.toHaveBeenCalled();
  });

  it('records the folded graph as the host state so the next delta diffs the right revision', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '/repo');
    const { state, read } = makeState(current);
    const added = makeNode('n2', 'B', 'function', 'a.ts', 9);
    const next = makeGraphData([...current.nodes, added], [], '/repo', 42);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: { ...EMPTY_DELTA, addedNodes: [added] },
      next,
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(read()).toBe(next);
  });

  it('falls back to the full fetch when the targeted read is unusable', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    const { state } = makeState(graphData);
    incrementalMock.buildIncrementalUpdate.mockReturnValue(null);

    await fireChange(ctx, invokeUpstream, state);

    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/repo', 'both');
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/data', expect.objectContaining({
      repoId: '/repo',
    }));
  });

  it('falls back to the full fetch when the host holds no graph yet', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);
    const { state } = makeState(null);

    await fireChange(ctx, invokeUpstream, state);

    expect(incrementalMock.buildIncrementalUpdate).not.toHaveBeenCalled();
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/repo', 'both');
  });

  // P0: the host keeps a single graph slot but the client can browse any workspace. If that slot
  // still holds another workspace's graph (the user switched away before the watched repo finished
  // indexing), diffing against it reports every touched node as "added" and publishes a two-node
  // graph as the watched repo's whole graph. The watcher must refuse and re-fetch instead.
  it('refuses to diff a graph that belongs to another workspace and re-fetches instead', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const foreign = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], 'D:\\Projects\\Other');
    mockedFetchMergedGraph.mockResolvedValue(foreign);
    const { state } = makeState(foreign);

    await fireChange(ctx, invokeUpstream, state);

    expect(incrementalMock.buildIncrementalUpdate).not.toHaveBeenCalled();
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/repo', 'both');
    // The full fetch must also repair the slot, otherwise every later tick repeats the mistake.
    expect(state.getLastGraphData()).toBe(foreign);
  });

  // Workspace paths reach the watcher with either separator depending on who produced them, so the
  // guard has to normalise instead of comparing raw strings.
  it('treats a separator-only difference as the same workspace', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const current = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], [], '\\repo');
    const { state } = makeState(current);
    const added = makeNode('n2', 'B', 'function', 'a.ts', 9);
    incrementalMock.buildIncrementalUpdate.mockReturnValue({
      delta: { ...EMPTY_DELTA, addedNodes: [added] },
      next: makeGraphData([...current.nodes, added], [], '\\repo', 42),
      scanned: { nodes: 1, edges: 0 },
    });

    await fireChange(ctx, invokeUpstream, state);

    expect(incrementalMock.buildIncrementalUpdate).toHaveBeenCalled();
    expect(mockedFetchMergedGraph).not.toHaveBeenCalled();
  });

  // Without a state surface the watcher cannot read the current revision, so it must keep the old
  // whole-graph behaviour rather than guessing.
  it('keeps the full fetch when no state surface was provided', async () => {
    const ctx = makeMockCtx();
    const invokeUpstream = vi.fn().mockResolvedValue(null);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    mockedFetchMergedGraph.mockResolvedValue(graphData);

    await fireChange(ctx, invokeUpstream, undefined);

    expect(incrementalMock.buildIncrementalUpdate).not.toHaveBeenCalled();
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/repo', 'both');
  });
});