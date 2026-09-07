import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { makeGraphData, makeNode } from '../helpers.ts';

vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: vi.fn(),
}));

const { registerWatcher, registerEventListeners } = await import('../../src/host/watcher.ts');
const { fetchMergedGraph } = await import('../../src/tools.ts');
const mockedFetchMergedGraph = vi.mocked(fetchMergedGraph);

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
    expect(() => registerWatcher(ctx, config, vi.fn())).not.toThrow();
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
    const importedCb = onCallbacks.find((c) => c.event === 'codegraph/repo/imported');
    expect(importedCb).toBeDefined();
    importedCb!.cb({ repoId: 'r1', timestamp: 123 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', { repoId: 'r1', nodeCount: 0, edgeCount: 0, timestamp: 123 });
  });

  it('repo scanned listener emits graph updated event', () => {
    const ctx = makeMockCtx();
    const onCallbacks: Array<{ event: string; cb: (e: unknown) => void }> = [];
    ctx.on = vi.fn((event: string, cb: (e: unknown) => void) => {
      onCallbacks.push({ event, cb });
      return vi.fn();
    });
    registerEventListeners(ctx, vi.fn());
    const scannedCb = onCallbacks.find((c) => c.event === 'codegraph/repo/scanned');
    expect(scannedCb).toBeDefined();
    scannedCb!.cb({ repoId: 'r2', timestamp: 456 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', { repoId: 'r2', nodeCount: 0, edgeCount: 0, timestamp: 456 });
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
    const scanCb = onCallbacks.find((c) => c.event === 'codegraph/repo/request-scan');
    expect(scanCb).toBeDefined();
    await scanCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: '/repo' }));
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
    const initCb = onCallbacks.find((c) => c.event === 'codegraph/graph/init');
    expect(initCb).toBeDefined();
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/init-result', expect.objectContaining({ success: true }));
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
    const initCb = onCallbacks.find((c) => c.event === 'codegraph/graph/init');
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/init-result', expect.objectContaining({ success: false }));
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
    const initCb = onCallbacks.find((c) => c.event === 'codegraph/graph/init');
    await initCb!.cb({ path: '/repo', timestamp: 1 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/init-result', expect.objectContaining({ success: false, message: 'Initialization failed' }));
  });
});