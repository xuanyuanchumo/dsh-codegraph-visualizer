/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';
import { logger } from '../../../src/shared/Logger.ts';

const mocks = vi.hoisted(() => ({
  fetchWorkspace: vi.fn(),
  fetchBootstrap: vi.fn(),
  getState: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  addWorkspace: vi.fn(),
  setBootstrapData: vi.fn(),
  setLoading: vi.fn(),
  restoreFromUrl: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchWorkspace: mocks.fetchWorkspace,
  fetchBootstrap: mocks.fetchBootstrap,
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { setupWorkspaceBootstrap } from '../../../src/client/runtime/WorkspaceBootstrap.ts';

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
    nodes: [],
    isLoading: false,
    panelVisible: true,
    workspaceList: [] as Array<{ path: string }>,
    // cycle-140：首扫竞态防护读 currentWorkspace（fetchBootstrap 期间工作区是否
    // 被会话跟随切换）。mock 缺省 '/ws' 与 fetchWorkspace 的返回一致。
    currentWorkspace: '/ws',
    // 会话跟随新增字段（sessionFollow 机制）：pin 缺省 null = 跟随态。
    // 此键缺席会让 `pinnedWorkspace === null` 判 false 而误入「pin 抑制」分支。
    pinnedWorkspace: null as string | null,
    sessionWorkspace: null as string | null,
    setCurrentWorkspace: mocks.setCurrentWorkspace,
    addWorkspace: mocks.addWorkspace,
    setBootstrapData: mocks.setBootstrapData,
    setLoading: mocks.setLoading,
    restoreFromUrl: mocks.restoreFromUrl,
    ...overrides,
  };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function captureWorkspaceEvent(): { received: Array<Event>; stop: () => void } {
  const received: Array<Event> = [];
  const handler = (e: Event) => { received.push(e); };
  window.addEventListener(DOM_EVENTS.WORKSPACE, handler);
  return { received, stop: () => window.removeEventListener(DOM_EVENTS.WORKSPACE, handler) };
}

describe('setupWorkspaceBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchWorkspace.mockReset();
    mocks.fetchBootstrap.mockReset();
    mocks.getState.mockReset();
    mocks.setCurrentWorkspace.mockReset();
    mocks.addWorkspace.mockReset();
    mocks.setBootstrapData.mockReset();
    mocks.setLoading.mockReset();
    mocks.restoreFromUrl.mockReset();
    mocks.restoreFromUrl.mockResolvedValue(undefined);
    mocks.getState.mockReturnValue(createStore());
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    vi.useRealTimers();
  });

  it('initial scan fetches workspace and bootstrap when nodes empty', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    const result = setupWorkspaceBootstrap(ctx);
    expect(result.scanInProgress.value).toBe(true);
    await flush();
    expect(mocks.fetchWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.setCurrentWorkspace).toHaveBeenCalledWith('/ws');
    expect(mocks.setBootstrapData).toHaveBeenCalled();
    expect(result.scanInProgress.value).toBe(false);
  });

  it('initial scan adds workspaces from list', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: ['/a', '/b'] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    expect(mocks.addWorkspace).toHaveBeenCalledWith('/a', 'a');
    expect(mocks.addWorkspace).toHaveBeenCalledWith('/b', 'b');
  });

  it('initial scan dispatches workspace event', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const cap = captureWorkspaceEvent();
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    expect(cap.received.length).toBeGreaterThan(0);
    cap.stop();
  });

  it('initial scan with empty bootstrap shows empty state', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 0, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    expect(mocks.setBootstrapData).not.toHaveBeenCalled();
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('initial scan with null bootstrap shows empty state', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue(null);
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    expect(mocks.setBootstrapData).not.toHaveBeenCalled();
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('initial scan failure logs warn and sets loading false', async () => {
    mocks.fetchWorkspace.mockRejectedValue(new Error('ws fail'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'getWorkspaceAndScan failed', expect.any(Error));
    expect(mocks.setLoading).toHaveBeenCalledWith(false);
    warnSpy.mockRestore();
  });

  it('skips initial scan when nodes already present', () => {
    mocks.getState.mockReturnValue(createStore({ nodes: [{ id: 'n1' }] }));
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    expect(mocks.fetchWorkspace).not.toHaveBeenCalled();
  });

  it('skips initial scan when loading', () => {
    mocks.getState.mockReturnValue(createStore({ isLoading: true }));
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    expect(mocks.fetchWorkspace).not.toHaveBeenCalled();
  });

  it('scanInProgress guards concurrent scans', async () => {
    mocks.fetchWorkspace.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ path: '/ws', list: [] }), 5000)),
    );
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 0, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    const result = setupWorkspaceBootstrap(ctx);
    expect(result.scanInProgress.value).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(result.scanInProgress.value).toBe(false);
  });

  it('polling skips when document.hidden', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.fetchWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.fetchWorkspace).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('polling skips when panelVisible false', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    mocks.getState.mockReturnValue(createStore({ panelVisible: false }));
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.fetchWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.fetchWorkspace).not.toHaveBeenCalled();
  });

  it('polling detects workspace change and dispatches event', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws1', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const cap = captureWorkspaceEvent();
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws2', list: [] });
    mocks.setCurrentWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.setCurrentWorkspace).toHaveBeenCalledWith('/ws2');
    expect(cap.received.length).toBeGreaterThan(0);
    cap.stop();
  });

  it('polling suppressed by user pin (sessionFollow): does not overwrite canvas', async () => {
    // 用户手动切换过（pin 在场）⇒ 宿主工作区变化不得覆盖画布（显式意图是粘性状态）。
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws1', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const cap = captureWorkspaceEvent();
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    const baseline = cap.received.length; // 首扫会派发一次 WORKSPACE 事件，作为基线
    // 用户在面板里切到 /pinned（写 pin —— 通过 getState().pinWorkspace 语义，
    // 测试里直接以 store override 形态表达）。
    mocks.getState.mockReturnValue(createStore({ pinnedWorkspace: '/pinned' }));
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws2', list: [] });
    mocks.setCurrentWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.setCurrentWorkspace).not.toHaveBeenCalled();
    expect(cap.received.length).toBe(baseline); // 轮询期间零新增事件
    cap.stop();
  });

  it('polling resumes following after pin is released', async () => {
    // 解除 pin 后，下一轮轮询恢复跟随（pin 是每次读取的最新值，不是快照）。
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws1', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.getState.mockReturnValue(createStore({ pinnedWorkspace: '/pinned' }));
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws2', list: [] });
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    mocks.getState.mockReturnValue(createStore({ pinnedWorkspace: null })); // 用户解除 pin
    mocks.setCurrentWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.setCurrentWorkspace).toHaveBeenCalledWith('/ws2');
  });

  it('polling adds new workspaces from list', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: ['/new'] });
    mocks.addWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(mocks.addWorkspace).toHaveBeenCalledWith('/new', 'new');
  });

  it('polling failure logs warn', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    mocks.fetchWorkspace.mockRejectedValue(new Error('poll fail'));
    warnSpy.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'workspace polling failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('cleanup clears polling interval', async () => {
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const { ctx, disposers } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    disposers[0]!();
    mocks.fetchWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchWorkspace).not.toHaveBeenCalled();
  });

  // ── cycle-140：会话跟随优先于宿主注册序 ──────────────────────────────────────

  it('polling suppressed by session-follow: 不覆盖会话工作区', async () => {
    // 会话工作区已知且与宿主 /workspace 不同 ⇒ 轮询不得覆盖 currentWorkspace
    // （宿主 /workspace 返回 registry[0]（注册序），多会话宿主里它不等于当前对话）。
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws-host', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const cap = captureWorkspaceEvent();
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();
    const baseline = cap.received.length;

    // 会话工作区已知且与宿主不同
    mocks.getState.mockReturnValue(createStore({ sessionWorkspace: '/ws-session' }));
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws-host2', list: [] });
    mocks.setCurrentWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();

    expect(mocks.setCurrentWorkspace).not.toHaveBeenCalled();
    expect(cap.received.length).toBe(baseline); // 轮询期间零新增事件
    cap.stop();
  });

  it('polling follows host when sessionWorkspace unknown (desktop fallback)', async () => {
    // sessionWorkspace 未知（桌面/旧代宿主）⇒ 回落到宿主 /workspace（保持旧行为）
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws-host', list: [] });
    mocks.fetchBootstrap.mockResolvedValue({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    const cap = captureWorkspaceEvent();
    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();

    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws-host2', list: [] });
    mocks.setCurrentWorkspace.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();

    expect(mocks.setCurrentWorkspace).toHaveBeenCalledWith('/ws-host2');
    cap.stop();
  });

  it('initial scan discarded when workspace changes during fetch (race guard)', async () => {
    // 首扫 fetchBootstrap 期间会话跟随已切换工作区 ⇒ 丢弃 registry[0] 的载荷
    mocks.fetchWorkspace.mockResolvedValue({ path: '/ws-host', list: [] });
    let resolveBootstrap: (v: any) => void;
    mocks.fetchBootstrap.mockImplementation(() => new Promise((r) => { resolveBootstrap = r; }));

    const { ctx } = createCtx();
    setupWorkspaceBootstrap(ctx);
    await flush();

    // fetchBootstrap 尚未 resolve，会话跟随把 currentWorkspace 切到 /ws-session
    mocks.getState.mockReturnValue(createStore({ currentWorkspace: '/ws-session' }));
    resolveBootstrap!({
      topLevelNodes: [{ id: 'n1' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 1, totalNodeCount: 1, totalEdgeCount: 0 },
    });
    await flush();

    // 载荷被丢弃：setBootstrapData 不应被调用（竞态防护生效）
    expect(mocks.setBootstrapData).not.toHaveBeenCalled();
  });
});