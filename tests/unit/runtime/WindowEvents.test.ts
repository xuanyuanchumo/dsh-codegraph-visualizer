/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';
import { logger } from '../../../src/shared/Logger.ts';

const mocks = vi.hoisted(() => ({
  fetchGraphDataIncremental: vi.fn(),
  requestInit: vi.fn(),
  requestWatch: vi.fn(),
  t: vi.fn((k: string) => k),
  getState: vi.fn(),
  setGraphData: vi.fn(),
  loadBootstrap: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setInitStatus: vi.fn(),
  setWatchEnabled: vi.fn(),
  setCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchGraphDataIncremental: mocks.fetchGraphDataIncremental,
  requestInit: mocks.requestInit,
  requestWatch: mocks.requestWatch,
}));

vi.mock('../../../src/client/i18n/index.ts', () => ({
  t: mocks.t,
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { setupWindowEvents } from '../../../src/client/runtime/WindowEvents.ts';

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
    lastUpdated: 123,
    repoId: 'r1',
    setGraphData: mocks.setGraphData,
    loadBootstrap: mocks.loadBootstrap,
    setLoading: mocks.setLoading,
    setError: mocks.setError,
    setInitStatus: mocks.setInitStatus,
    setWatchEnabled: mocks.setWatchEnabled,
    setCurrentWorkspace: mocks.setCurrentWorkspace,
    ...overrides,
  };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function dispatch(type: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

describe('setupWindowEvents', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchGraphDataIncremental.mockReset();
    mocks.requestInit.mockReset();
    mocks.requestWatch.mockReset();
    mocks.t.mockReset();
    mocks.t.mockImplementation((k: string) => k);
    mocks.getState.mockReset();
    mocks.setGraphData.mockReset();
    mocks.loadBootstrap.mockReset();
    mocks.setLoading.mockReset();
    mocks.setError.mockReset();
    mocks.setInitStatus.mockReset();
    mocks.setWatchEnabled.mockReset();
    mocks.setCurrentWorkspace.mockReset();
    mocks.getState.mockReturnValue(createStore());
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    vi.useRealTimers();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('returns early when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const effectSpy = vi.fn();
    const ctx = { effect: effectSpy, emit: vi.fn() } as unknown as Context;
    setupWindowEvents(ctx);
    expect(effectSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('registers all 8 event listeners', () => {
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain(DOM_EVENTS.REFRESH);
    expect(types).toContain(DOM_EVENTS.OPEN_SOURCE);
    expect(types).toContain(DOM_EVENTS.IMPORT_REPO);
    expect(types).toContain(DOM_EVENTS.INIT_GRAPH);
    expect(types).toContain(DOM_EVENTS.TOGGLE_WATCH);
    expect(types).toContain(DOM_EVENTS.WORKSPACE);
    expect(types).toContain(DOM_EVENTS.INSTALL_PLUGIN);
    expect(types).toContain(DOM_EVENTS.EDITOR_SYMBOL_SELECT);
  });

  it('refresh incremental branch fetches and sets graph data', async () => {
    mocks.fetchGraphDataIncremental.mockResolvedValue({
      nodes: [{ id: 'n2' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1 },
    });
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(mocks.fetchGraphDataIncremental).toHaveBeenCalledWith(123, 'r1');
    expect(mocks.setGraphData).toHaveBeenCalled();
  });

  it('refresh incremental with null data skips setGraphData', async () => {
    mocks.fetchGraphDataIncremental.mockResolvedValue(null);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(mocks.setGraphData).not.toHaveBeenCalled();
  });

  it('refresh incremental failure logs warn', async () => {
    mocks.fetchGraphDataIncremental.mockRejectedValue(new Error('inc'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'incremental graph fetch failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('refresh full branch calls loadBootstrap', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, {});
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('refresh full branch loadBootstrap false logs warn', async () => {
    mocks.loadBootstrap.mockResolvedValue(false);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, {});
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'bootstrap refresh failed', undefined);
    warnSpy.mockRestore();
  });

  it('refresh skips when nodes empty', async () => {
    mocks.getState.mockReturnValue(createStore({ nodes: [] }));
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(mocks.fetchGraphDataIncremental).not.toHaveBeenCalled();
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
  });

  // P0: `/data` returns the host's single graph slot with no workspace filter, so a poll fired
  // while the host slot still holds another workspace's graph would overwrite the visible graph.
  it('refresh incremental ignores a payload from another workspace', async () => {
    mocks.fetchGraphDataIncremental.mockResolvedValue({
      nodes: [{ id: 'n2' }],
      edges: [],
      metadata: { repoId: '/repo/other', timestamp: 1 },
    });
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(mocks.fetchGraphDataIncremental).toHaveBeenCalledWith(123, 'r1');
    expect(mocks.setGraphData).not.toHaveBeenCalled();
  });

  // Paths arrive with either separator; normalising keeps the guard from dropping the live graph.
  it('refresh incremental accepts a separator-only difference', async () => {
    mocks.getState.mockReturnValue(createStore({ repoId: 'D:/Projects/repo' }));
    mocks.fetchGraphDataIncremental.mockResolvedValue({
      nodes: [{ id: 'n2' }],
      edges: [],
      metadata: { repoId: 'D:\\Projects\\repo', timestamp: 1 },
    });
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.REFRESH, { incremental: true });
    await flush();
    expect(mocks.setGraphData).toHaveBeenCalled();
  });

  it('openSource emits source open event', () => {
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.OPEN_SOURCE, { filePath: '/a.ts', lineNumber: 5 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/source/open', {
      filePath: '/a.ts',
      lineNumber: 5,
    });
  });

  it('importRepo sets loading and calls loadBootstrap', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.IMPORT_REPO, { path: '/repo' });
    await flush();
    expect(mocks.setLoading).toHaveBeenCalledWith(true);
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('importRepo bootstrap false sets error', async () => {
    mocks.loadBootstrap.mockResolvedValue(false);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.IMPORT_REPO, { path: '/repo' });
    await flush();
    expect(mocks.setError).toHaveBeenCalledWith('error.loadGraphData');
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('importRepo failure sets loading false', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('imp'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.IMPORT_REPO, { path: '/repo' });
    await flush();
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
    warnSpy.mockRestore();
  });

  it('initGraph success sets done and loads bootstrap', async () => {
    mocks.requestInit.mockResolvedValue({ success: true, message: 'ok' });
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.INIT_GRAPH, { path: '/p' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('initializing');
    expect(mocks.setInitStatus).toHaveBeenCalledWith('done', 'ok');
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('initGraph failure result sets error status', async () => {
    mocks.requestInit.mockResolvedValue({ success: false, message: 'bad' });
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.INIT_GRAPH, { path: '/p' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('error', 'bad');
  });

  it('initGraph null result sets error with generic message', async () => {
    mocks.requestInit.mockResolvedValue(null);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.INIT_GRAPH, { path: '/p' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('error', 'error.generic');
  });

  it('initGraph request failure sets error status', async () => {
    mocks.requestInit.mockRejectedValue(new Error('init fail'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.INIT_GRAPH, { path: '/p' });
    await flush();
    expect(mocks.setInitStatus).toHaveBeenCalledWith('error', expect.any(String));
    warnSpy.mockRestore();
  });

  it('toggleWatch sets watch enabled and requests watch', async () => {
    mocks.requestWatch.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.TOGGLE_WATCH, { enabled: true, path: '/p' });
    await flush();
    expect(mocks.setWatchEnabled).toHaveBeenCalledWith(true);
    expect(mocks.requestWatch).toHaveBeenCalledWith(true, '/p');
  });

  it('toggleWatch request failure logs warn', async () => {
    mocks.requestWatch.mockRejectedValue(new Error('watch'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.TOGGLE_WATCH, { enabled: false, path: '/p' });
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'toggle-watch request failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('workspace sets current workspace and debounces bootstrap', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.WORKSPACE, { path: '/ws' });
    expect(mocks.setCurrentWorkspace).toHaveBeenCalledWith('/ws');
    expect(mocks.loadBootstrap).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('workspace bootstrap false sets error', async () => {
    mocks.loadBootstrap.mockResolvedValue(false);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.WORKSPACE, { path: '/ws' });
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(mocks.setError).toHaveBeenCalledWith('error.loadGraphData');
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('workspace failure sets loading false', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('ws'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.WORKSPACE, { path: '/ws' });
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
    warnSpy.mockRestore();
  });

  it('workspace debounce clears previous timer', async () => {
    mocks.loadBootstrap.mockResolvedValue(true);
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.WORKSPACE, { path: '/ws1' });
    dispatch(DOM_EVENTS.WORKSPACE, { path: '/ws2' });
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(mocks.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it('installPlugin logs info without throwing', () => {
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    expect(() => dispatch(DOM_EVENTS.INSTALL_PLUGIN, { plugin: 'x' })).not.toThrow();
  });

  it('symbolSelect forwards when symbol present', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatch(DOM_EVENTS.EDITOR_SYMBOL_SELECT, { symbol: 'sym', filePath: '/a', lineNumber: 1 });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOM_EVENTS.SYMBOL_SELECT }),
    );
    dispatchSpy.mockRestore();
  });

  it('symbolSelect skips when no symbol', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { ctx } = createCtx();
    setupWindowEvents(ctx);
    dispatchSpy.mockClear();
    dispatch(DOM_EVENTS.EDITOR_SYMBOL_SELECT, { filePath: '/a' });
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: DOM_EVENTS.SYMBOL_SELECT }),
    );
    dispatchSpy.mockRestore();
  });

  it('cleanup removes all listeners', () => {
    const { ctx, disposers } = createCtx();
    setupWindowEvents(ctx);
    disposers[0]!();
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.REFRESH, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.OPEN_SOURCE, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.IMPORT_REPO, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.INIT_GRAPH, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.TOGGLE_WATCH, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.WORKSPACE, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.INSTALL_PLUGIN, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.EDITOR_SYMBOL_SELECT, expect.any(Function));
  });
});