/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateCommandUi } from '../../../src/client/integrations/CommandUiIntegration.ts';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false,
    betterSidebar: false,
    slots: false,
    conversationView: false,
    commandUi: false,
    desktopPlatform: false,
    remoteNarrow: false,
    ...overrides,
  };
}

interface CommandContribution {
  name: string;
  label?: () => string;
  available: (session: unknown) => boolean;
  ui: { kind: 'action'; run: (session: unknown) => void };
}

function makeCommandUi() {
  const registered: CommandContribution[] = [];
  const disposers: Array<() => void> = [];
  const register = vi.fn((contribution: CommandContribution) => {
    registered.push(contribution);
    const d = vi.fn();
    disposers.push(d);
    return d;
  });
  return { api: { register }, register, registered, disposers };
}

function makeState(commandUi: unknown, flags = makeFlags({ commandUi: true })) {
  const effect = vi.fn();
  // cycle-83：integrateCommandUi 已改为响应式 `ctx.inject(['commandUi'], cb)`，
  // 因此夹具必须提供真实的 `inject`：依赖在场时**同步**跑回调，并把 scope 交给回调。
  // 真实契约见 `<A>\cordis\lib\types\registry.d.ts:111`（回调首参是 Context）。
  const inject = vi.fn((deps: string[], cb: (scope: Context) => void) => {
    const scope = {
      get: (key: string, _strict?: boolean) => (key === 'commandUi' ? commandUi : undefined),
      effect,
    } as unknown as Context;
    if (deps.includes('commandUi') && commandUi !== undefined) cb(scope);
    return { dispose: vi.fn() };
  });
  const ctx = {
    effect,
    inject,
    get: (key: string, _strict?: boolean) => (key === 'commandUi' ? commandUi : undefined),
  } as unknown as Context;
  const state = new IntegrationState(ctx, flags);
  return { state, effect, ctx, inject };
}

/** 取某条命令的 action 回调。 */
function runOf(contribution: CommandContribution): () => void {
  return () => contribution.ui.run({});
}

describe('integrateCommandUi', () => {
  let openSidebarTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openSidebarTab = vi.fn();
  });

  it('still registers when the capability snapshot says false (reactive injection is authoritative)', () => {
    // cycle-83 结构性修复的回归守卫：旧实现以 `state.flags.commandUi` 作硬门，
    // 而该快照取自 apply() 那一刻的 `ctx.get(key, strict)`，服务提供者 fiber 尚未
    // active 时会被误判为 false，于是 5 条命令被永久丢弃（真机 `/` 弹层零命令）。
    // 现在服务在不在场由 `ctx.inject` 判定，快照为 false 也不得阻断注册。
    const { api, register } = makeCommandUi();
    const { state } = makeState(api, makeFlags({ commandUi: false }));
    state.openSidebarTab = openSidebarTab;
    integrateCommandUi(state);
    expect(register).toHaveBeenCalledTimes(5);
  });

  it('returns early when the service is absent', () => {
    const { state } = makeState(undefined);
    integrateCommandUi(state);
    // 无服务时不抛错，也不注册任何东西。
    expect(state.slotDisposers).toEqual([]);
  });

  it('returns early when the service exposes no register()', () => {
    const { state } = makeState({ notRegister: true });
    integrateCommandUi(state);
    expect(state.slotDisposers).toEqual([]);
  });

  it('registers all five actions as action-kind contributions', () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    integrateCommandUi(state);
    expect(registered.map((c) => c.name)).toEqual([
      'codegraph-search',
      'codegraph-toggle',
      'codegraph-layout',
      'codegraph-filter',
      'codegraph-export',
    ]);
    for (const c of registered) {
      expect(c.ui.kind).toBe('action');
      expect(typeof c.ui.run).toBe('function');
      expect(c.available({})).toBe(true);
      expect(typeof c.label?.()).toBe('string');
    }
  });

  it('adopts each returned disposer through ctx.effect with a labelled cleanup', () => {
    const { api } = makeCommandUi();
    const { state, effect } = makeState(api);
    integrateCommandUi(state);
    // IntegrationState 的构造器自己会占用一次 ctx.effect（slot 清理），
    // 因此这里只筛出本模块注册的 5 条命令 effect。
    const commandCalls = effect.mock.calls.filter((c) => String(c[1]).startsWith('codegraph: command '));
    expect(commandCalls).toHaveLength(5);
    expect(commandCalls.map((c) => c[1])).toEqual([
      'codegraph: command search',
      'codegraph: command toggle',
      'codegraph: command layout',
      'codegraph: command filter',
      'codegraph: command export',
    ]);
    // effect 收到的是「返回该 disposer」的工厂，而不是 disposer 本身。
    for (const call of commandCalls) {
      const factory = call[0] as () => () => void;
      expect(typeof factory()).toBe('function');
    }
  });

  it('search action opens the sidebar tab and dispatches the "/" key', () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    state.openSidebarTab = openSidebarTab;
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    integrateCommandUi(state);
    runOf(registered[0]!)();
    expect(openSidebarTab).toHaveBeenCalledTimes(1);
    const evt = dispatch.mock.calls.at(-1)![0] as KeyboardEvent;
    expect(evt.type).toBe('keydown');
    expect(evt.key).toBe('/');
    dispatch.mockRestore();
  });

  it('toggle action delegates to state.togglePanel', () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    const togglePanel = vi.fn();
    state.togglePanel = togglePanel;
    integrateCommandUi(state);
    runOf(registered[1]!)();
    expect(togglePanel).toHaveBeenCalledTimes(1);
  });

  it('layout action advances the layout cycle and wraps around', async () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    state.openSidebarTab = openSidebarTab;
    const { useGraphStore } = await import('../../../src/client/store/graphStore.ts');
    const store = useGraphStore.getState();
    const original = store.layout;
    try {
      store.setLayout('cose');
      integrateCommandUi(state);
      runOf(registered[2]!)();
      expect(useGraphStore.getState().layout).toBe('fcose');
      // 从最后一项绕回第一项。
      useGraphStore.getState().setLayout('tree');
      runOf(registered[2]!)();
      expect(useGraphStore.getState().layout).toBe('cose');
    } finally {
      useGraphStore.getState().setLayout(original);
    }
  });

  it('layout action falls back to the first layout when the current one is unknown', async () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    state.openSidebarTab = openSidebarTab;
    const { useGraphStore } = await import('../../../src/client/store/graphStore.ts');
    const original = useGraphStore.getState().layout;
    try {
      useGraphStore.getState().setLayout('not-a-layout' as typeof original);
      integrateCommandUi(state);
      runOf(registered[2]!)();
      expect(useGraphStore.getState().layout).toBe('cose');
    } finally {
      useGraphStore.getState().setLayout(original);
    }
  });

  it('filter and export actions dispatch their panel events', () => {
    const { api, registered } = makeCommandUi();
    const { state } = makeState(api);
    state.openSidebarTab = openSidebarTab;
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    integrateCommandUi(state);

    runOf(registered[3]!)();
    expect((dispatch.mock.calls.at(-1)![0] as CustomEvent).type).toBe(DOM_EVENTS.TOGGLE_FILTER_PANEL);

    runOf(registered[4]!)();
    expect((dispatch.mock.calls.at(-1)![0] as CustomEvent).type).toBe(DOM_EVENTS.TOGGLE_EXPORT_MENU);

    expect(openSidebarTab).toHaveBeenCalledTimes(2);
    dispatch.mockRestore();
  });

  it('swallows a throwing service without propagating', () => {
    const register = vi.fn(() => {
      throw new Error('duplicate command name');
    });
    const { state } = makeState({ register });
    expect(() => integrateCommandUi(state)).not.toThrow();
  });
});
