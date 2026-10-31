// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateBetterSidebar } from '../../../src/client/integrations/BetterSidebarIntegration.ts';
import { GraphPanel } from '../../../src/client/GraphPanel.tsx';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

const storeState = vi.hoisted(() => ({
  setIntegrationMode: vi.fn(),
  setPanelVisible: vi.fn(),
  setLayout: vi.fn(),
  nodes: [] as unknown[],
  layout: 'cose' as string,
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: () => storeState },
}));

vi.mock('../../../src/client/GraphPanel.tsx', () => ({ GraphPanel: 'GraphPanel' }));
vi.mock('../../../src/client/components/ErrorBoundary.tsx', () => ({ GraphErrorBoundary: 'GraphErrorBoundary' }));
vi.mock('../../../src/client/components/Icons.tsx', () => ({ GraphIcon: 'GraphIcon' }));
vi.mock('../../../src/client/i18n/index.ts', () => ({ t: (key: string) => key }));

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false,
    betterSidebar: false,
    slots: false,
    commandUi: false,
    conversationView: false,
    desktopPlatform: false,
    remoteNarrow: false,
    ...overrides,
  };
}

interface BetterSidebarApi {
  features: string[];
  version: string;
  registerTab: ReturnType<typeof vi.fn>;
  subscribeState: ReturnType<typeof vi.fn>;
  getSnapshot: ReturnType<typeof vi.fn>;
  openTab: ReturnType<typeof vi.fn>;
}

function makeBetterSidebarApi(overrides: Partial<BetterSidebarApi> = {}): BetterSidebarApi {
  return {
    features: [],
    version: '1.0.0',
    registerTab: vi.fn(() => vi.fn()),
    subscribeState: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ state: { activePane: 'other', bottomOpen: false } })),
    openTab: vi.fn(),
    ...overrides,
  };
}

function getTabDescriptor(api: BetterSidebarApi): Record<string, unknown> {
  const calls = api.registerTab.mock.calls as unknown as Array<[Record<string, unknown>]>;
  return calls[0]![0];
}

describe('integrateBetterSidebar', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    vi.clearAllMocks();
  });

  function makeState(flags?: ClientFeatureFlags, api?: BetterSidebarApi): { state: IntegrationState; api: BetterSidebarApi } {
    const resolvedApi = api ?? makeBetterSidebarApi();
    const ctx = {
      effect,
      get: vi.fn((key: string) => (key === 'betterSidebar' ? resolvedApi : undefined)),
    } as unknown as Context;
    const state = new IntegrationState(ctx, flags ?? makeFlags({ betterSidebar: true }));
    return { state, api: resolvedApi };
  }

  it('does not register on a false snapshot, but leaves an observable snapshot-miss and arms a retry', () => {
    // cycle-110 / C1：旧契约是「快照为假 ⇒ 永不探测」（`expect(ctx.get).not.toHaveBeenCalled()`），
    // 那是「一瞬决定永远」缺陷本身。新契约保留「不注册」，但要求：
    //   1. 写出可观测标记（`<html data-cg-channel-better-sidebar>`），
    //   2. 用**实时**探测复核快照（快照可能是旧的），
    //   3. 实时也为假时登记「服务就绪后重跑」。
    const ctx = { effect, get: vi.fn(() => undefined), inject: vi.fn(() => ({})) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ betterSidebar: false }));

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(false);
    // 实时探测必须真的发生（否则快照仍旧决定一整轮）
    expect(ctx.get).toHaveBeenCalledWith('betterSidebar', false);
    // 可观测标记落在 <html> 上（jsdom 有 document，故此断言可执行）
    expect(document.documentElement.getAttribute('data-cg-channel-better-sidebar')).toBe('retry-pending');
    // 重试用 ctx.inject 作为「服务就绪」触发器
    expect(ctx.inject).toHaveBeenCalledWith(['betterSidebar'], expect.any(Function));
  });

  it('returns early when navButtonRegistered is already true', () => {
    const { state, api } = makeState();
    state.navButtonRegistered = true;
    integrateBetterSidebar(state);
    expect(api.registerTab).not.toHaveBeenCalled();
  });

  it('returns early when ctx.get returns undefined for betterSidebar', () => {
    const ctx = {
      effect,
      get: vi.fn(() => undefined),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ betterSidebar: true }));
    integrateBetterSidebar(state);
    expect(state.navButtonRegistered).toBe(false);
  });

  it('registers tab and sets integration mode when registerTab returns a disposer function', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(api.registerTab).toHaveBeenCalledTimes(1);
    expect(state.navButtonRegistered).toBe(true);
    expect(state.betterSidebarApi).toBe(api);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('better-sidebar');
    const labels = effect.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(labels).toContain('codegraph: better-sidebar tab');
  });

  it('does NOT register when registerTab returns a non-function (falls back to slots)', () => {
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => undefined) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(state.betterSidebarApi).toBeUndefined();
    expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
  });

  it('does NOT register when registerTab returns null', () => {
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => null) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('sets tabDescriptor.badge when badge feature is present', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ features: ['badge'], registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    const descriptor = getTabDescriptor(api);
    expect(typeof descriptor.badge).toBe('function');
  });

  it('does not set badge when badge feature is absent', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ features: [], registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    const descriptor = getTabDescriptor(api);
    expect(descriptor.badge).toBeUndefined();
  });

  it('badge returns null when no nodes, count when <=99, 99+ when >99', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ features: ['badge'], registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);
    const descriptor = getTabDescriptor(api);
    const badge = descriptor.badge as () => unknown;

    storeState.nodes = [];
    expect(badge()).toBeNull();

    storeState.nodes = new Array(5);
    expect(badge()).toBe(5);

    storeState.nodes = new Array(99);
    expect(badge()).toBe(99);

    storeState.nodes = new Array(100);
    expect(badge()).toBe('99+');
  });

  it('sets onOpen/onActivate/onClose when tabLifecycle feature is present', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ features: ['tabLifecycle'], registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    const descriptor = getTabDescriptor(api);
    expect(typeof descriptor.onOpen).toBe('function');
    expect(typeof descriptor.onActivate).toBe('function');
    expect(typeof descriptor.onClose).toBe('function');

    storeState.setPanelVisible.mockClear();
    (descriptor.onOpen as (t: unknown, s: unknown) => void)({ id: 'tab1' }, 'scope');
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);

    storeState.setPanelVisible.mockClear();
    (descriptor.onActivate as (t: unknown, s: unknown) => void)({ id: 'tab1' }, 'scope');
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);

    storeState.setPanelVisible.mockClear();
    (descriptor.onClose as (t: unknown, s: unknown) => void)({ id: 'tab1' }, 'scope');
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(false);
  });

  it('does not set lifecycle hooks when tabLifecycle feature is absent', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ features: [], registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    const descriptor = getTabDescriptor(api);
    expect(descriptor.onOpen).toBeUndefined();
    expect(descriptor.onActivate).toBeUndefined();
    expect(descriptor.onClose).toBeUndefined();
  });

  it('subscribes to state when stateSubscription feature is present', () => {
    const dispose = vi.fn();
    const stateDisposer = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn(() => stateDisposer),
    });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(api.subscribeState).toHaveBeenCalledTimes(1);
    expect(state.sidebarStateDisposer).toBe(stateDisposer);
    const labels = effect.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(labels).toContain('codegraph: sidebar state subscription');
  });

  it('state subscription callback updates panelVisible when snapshot differs (activePane match)', () => {
    const dispose = vi.fn();
    const stateDisposer = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn((cb: () => void) => {
        cb();
        return stateDisposer;
      }),
      getSnapshot: vi.fn(() => ({ state: { activePane: 'codegraph-visualizer', bottomOpen: false } })),
    });
    const { state } = makeState(undefined, api);
    state.panelVisible = false;

    integrateBetterSidebar(state);

    expect(state.panelVisible).toBe(true);
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);
  });

  it('state subscription callback updates panelVisible when bottomOpen is true', () => {
    const dispose = vi.fn();
    const stateDisposer = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn((cb: () => void) => {
        cb();
        return stateDisposer;
      }),
      getSnapshot: vi.fn(() => ({ state: { activePane: 'other', bottomOpen: true } })),
    });
    const { state } = makeState(undefined, api);
    state.panelVisible = false;

    integrateBetterSidebar(state);

    expect(state.panelVisible).toBe(true);
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);
  });

  it('state subscription callback does not update when snapshot matches panelVisible', () => {
    const dispose = vi.fn();
    const stateDisposer = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn((cb: () => void) => {
        cb();
        return stateDisposer;
      }),
      getSnapshot: vi.fn(() => ({ state: { activePane: 'other', bottomOpen: false } })),
    });
    const { state } = makeState(undefined, api);
    state.panelVisible = false;

    integrateBetterSidebar(state);

    expect(state.panelVisible).toBe(false);
    expect(storeState.setPanelVisible).not.toHaveBeenCalled();
  });

  it('state subscription callback handles missing snapshot.state gracefully', () => {
    const dispose = vi.fn();
    const stateDisposer = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn((cb: () => void) => {
        cb();
        return stateDisposer;
      }),
      getSnapshot: vi.fn(() => undefined),
    });
    const { state } = makeState(undefined, api);
    state.panelVisible = false;

    integrateBetterSidebar(state);

    expect(state.panelVisible).toBe(false);
  });

  it('recovers from subscribeState exceptions without failing registration', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn(() => {
        throw new Error('subscribe boom');
      }),
    });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(state.sidebarStateDisposer).toBeUndefined();
  });

  it('does not call effect for state subscription when subscribeState returns undefined', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({
      features: ['stateSubscription'],
      registerTab: vi.fn(() => dispose),
      subscribeState: vi.fn(() => undefined),
    });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.sidebarStateDisposer).toBeUndefined();
    const labels = effect.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(labels).not.toContain('codegraph: sidebar state subscription');
  });

  it('degrades safely when features access throws (safeCheck returns [])', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
    Object.defineProperty(api, 'features', {
      get() {
        throw new Error('features boom');
      },
      configurable: true,
    });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(true);
    const descriptor = getTabDescriptor(api);
    expect(descriptor.badge).toBeUndefined();
    expect(descriptor.onOpen).toBeUndefined();
  });

  it('catches outer exceptions from ctx.get', () => {
    const ctx = {
      effect,
      get: vi.fn(() => {
        throw new Error('get boom');
      }),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ betterSidebar: true }));

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('catches outer exceptions from registerTab', () => {
    const api = makeBetterSidebarApi({
      registerTab: vi.fn(() => {
        throw new Error('registerTab boom');
      }),
    });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('component callback sets panelVisible, betterSidebarTabId and calls setPanelVisible', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);
    const descriptor = getTabDescriptor(api);
    const component = descriptor.component as (props: {
      ctx: Context;
      visible: boolean;
      tab: { id: string; title: string; path?: string };
    }) => unknown;

    storeState.setPanelVisible.mockClear();
    const result = component({
      ctx: state.ctx,
      visible: true,
      tab: { id: 'tab-1', title: 'T' },
    });
    expect(state.panelVisible).toBe(true);
    expect(state.betterSidebarTabId).toBe('tab-1');
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);
    expect(result).toBeDefined();
  });

  it('component callback handles missing tab.id', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);
    const descriptor = getTabDescriptor(api);
    const component = descriptor.component as (props: {
      ctx: Context;
      visible: boolean;
      tab: { id: string; title: string; path?: string };
    }) => unknown;

    component({
      ctx: state.ctx,
      visible: false,
      tab: { id: '', title: 'T' },
    });
    expect(state.panelVisible).toBe(false);
  });

  it('tab descriptor has correct id, order and single flag', () => {
    const dispose = vi.fn();
    const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
    const { state } = makeState(undefined, api);

    integrateBetterSidebar(state);

    const descriptor = getTabDescriptor(api);
    expect(descriptor.id).toBe('codegraph-visualizer');
    expect(descriptor.order).toBe(50);
    expect(descriptor.single).toBe(true);
    expect(typeof descriptor.title).toBe('function');
    expect(typeof descriptor.description).toBe('function');
    expect(typeof descriptor.icon).toBe('function');
  });

  // ── 会话跟随接线（cycle-121 增强：better-sidebar 通道）──────────────────
  // 宿主实测（dsh-better-sidebar lib/client.js useSessionScope）：tab 组件收到
  // scope = { sessionId, cwd }。跟随引擎吃 useSessions 形状，适配器在此转换。
  describe('session follow wiring', () => {
    function renderedPanelProps(component: unknown, props: Record<string, unknown>): Record<string, unknown> | null {
      // component 返回 React element 树；GraphPanel 包在 GraphErrorBoundary 里。
      // 沿 element 树找到 type === GraphPanel 的节点，返回它的 props。
      const stack: Array<{ type: unknown; props: Record<string, unknown> }> = [];
      const root = component as (p: Record<string, unknown>) => { props?: { children?: unknown } };
      let children = root(props)?.props?.children;
      while (children !== null && children !== undefined) {
        if (typeof children !== 'object') break;
        const el = children as { type?: unknown; props?: Record<string, unknown> };
        if (el.type === GraphPanel) return el.props ?? {};
        stack.push({ type: el.type, props: el.props ?? {} });
        children = el.props?.children;
      }
      return null;
    }

    it('scope 携带会话身份 ⇒ GraphPanel 收到 sessionId + useSessions 适配器', () => {
      const dispose = vi.fn();
      const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
      const { state } = makeState(undefined, api);
      integrateBetterSidebar(state);
      const component = (getTabDescriptor(api).component as (p: Record<string, unknown>) => unknown);
      const panelProps = renderedPanelProps(component, {
        ctx: state.ctx, visible: true, tab: { id: 't', title: 'T' },
        scope: { sessionId: 'sess-1', cwd: 'D:\\proj\\x' },
      });
      expect(panelProps).not.toBeNull();
      expect(panelProps!.sessionId).toBe('sess-1');
      // 适配器形状：useSessions(selector) → selector({byId: {sess-1: {cwd}}})
      const useSessions = panelProps!.useSessions as (s: (x: { byId: Record<string, { cwd?: string } | undefined> }) => unknown) => unknown;
      expect(typeof useSessions).toBe('function');
      const cwd = useSessions((s) => s.byId['sess-1']?.cwd);
      expect(cwd).toBe('D:\\proj\\x');
    });

    it('scope 缺席 / 无 sessionId ⇒ GraphPanel 收到 undefined（unknown 态宁缺勿猜）', () => {
      const dispose = vi.fn();
      const api = makeBetterSidebarApi({ registerTab: vi.fn(() => dispose) });
      const { state } = makeState(undefined, api);
      integrateBetterSidebar(state);
      const component = (getTabDescriptor(api).component as (p: Record<string, unknown>) => unknown);
      // scope 整体缺席
      const p1 = renderedPanelProps(component, { ctx: state.ctx, visible: true, tab: { id: 't', title: 'T' } });
      expect(p1!.sessionId).toBeUndefined();
      expect(p1!.useSessions).toBeUndefined();
      // scope 在场但 sessionId 缺席
      const p2 = renderedPanelProps(component, { ctx: state.ctx, visible: true, tab: { id: 't', title: 'T' }, scope: { cwd: 'D:\\x' } });
      expect(p2!.sessionId).toBeUndefined();
      expect(p2!.useSessions).toBeUndefined();
    });
  });
});