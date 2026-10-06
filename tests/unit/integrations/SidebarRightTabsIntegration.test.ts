// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateSidebarRightTabs } from '../../../src/client/integrations/SidebarRightTabsIntegration.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

// cycle-83 契约说明：cordis 的 `ctx.inject(deps, callback)` 回调首参是 **Context**，
// 逐字见 `<A>\cordis\lib\types\registry.d.ts:71-73`
// `interface Function<T = any> extends Base<T> { (ctx: Context, config: T): any; }`
// 以及 `:111` `inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>;`。
// 本夹具因此传入一个最小 scope（`get` + `effect`），**不是** Map —— 旧夹具传 Map 曾让
// 一个与真实契约不符的形参声明长期为绿。

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

/** 构造 cordis 注入回调收到的 scope：只有 `get` 与 `effect` 被本实现使用。 */
function makeScope(tabs: unknown, effect: ReturnType<typeof vi.fn>): Context {
  return {
    get: (key: string, _strict?: boolean) => (key === 'sidebarRightTabs' ? tabs : undefined),
    effect,
  } as unknown as Context;
}

describe('integrateSidebarRightTabs', () => {
  let effect: ReturnType<typeof vi.fn>;
  let scopeEffect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    scopeEffect = vi.fn();
    vi.clearAllMocks();
  });

  it('registers tab and sets integration mode on success', () => {
    const typeDispose = vi.fn();
    const bodyDispose = vi.fn();
    const regResult = vi.fn();
    const tabs = { register: vi.fn(() => typeDispose) };
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return bodyDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctxInject = vi.fn((_keys: string[], cb: (scope: Context) => void) => {
      cb(makeScope(tabs, scopeEffect));
      return { dispose: vi.fn() };
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    expect(tabs.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dsh-codegraph-visualizer', kind: 'codegraph', priority: 'extension' }),
    );
    expect(state.navButtonRegistered).toBe(true);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('sidebar-right');
    // tab 类型的 disposer 交给 **scope.effect** 托管（随注入 fiber 释放），不再进 slotDisposers。
    expect(scopeEffect).toHaveBeenCalledWith(expect.any(Function), 'codegraph: sidebar-right tab type');
    expect(state.slotDisposers).toContain(bodyDispose);
    expect(state.slotDisposers).toContain(regResult);
    // 返回的 Fiber 由父 fiber 自动释放，不手工登记。
    expect(state.slotDisposers).not.toContain(typeDispose);
  });

  it('registers tab with canOpen=true and title function', () => {
    const tabs = { register: vi.fn(() => vi.fn()) };
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return vi.fn();
      }),
      register: vi.fn(() => vi.fn()),
    };
    const ctxInject = vi.fn((_keys: string[], cb: (scope: Context) => void) => {
      cb(makeScope(tabs, scopeEffect));
      return vi.fn();
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    const calls = tabs.register.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const descriptor = calls[0]![0];
    expect((descriptor.canOpen as () => boolean)()).toBe(true);
    expect((descriptor.title as () => string)()).toBe('nav.title');
  });

  it('warns and skips registration when sidebarRightTabs is injected but undefined', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctxInject = vi.fn((_keys: string[], cb: (scope: Context) => void) => {
      cb(makeScope(undefined, scopeEffect));
      return { dispose: vi.fn() };
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
    expect(slots.inject).not.toHaveBeenCalled();
    expect(state.slotDisposers).toEqual([]);
  });

  it('catches exceptions from ctx.inject and logs error', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctxInject = vi.fn(() => {
      throw new Error('inject boom');
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(state.slotDisposers).toEqual([]);
  });

  it('does not push non-function disposers from any source', () => {
    const tabs = { register: vi.fn(() => undefined) };
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return undefined;
      }),
      register: vi.fn(() => undefined),
    };
    const ctxInject = vi.fn((_keys: string[], cb: (scope: Context) => void) => {
      cb(makeScope(tabs, scopeEffect));
      return undefined;
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(state.slotDisposers).toEqual([]);
  });

  it('slots.inject callback registers GraphPanel as pane tab', () => {
    const tabs = { register: vi.fn(() => vi.fn()) };
    const regResult = vi.fn();
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return vi.fn();
      }),
      register: vi.fn(() => regResult),
    };
    const ctxInject = vi.fn((_keys: string[], cb: (scope: Context) => void) => {
      cb(makeScope(tabs, scopeEffect));
      return vi.fn();
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: true }));

    integrateSidebarRightTabs(state);

    expect(slots.inject).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.any(Function));
    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sidebar.right.pane.tab', key: 'dsh-codegraph-visualizer' }),
      'GraphPanel',
    );
  });
});
