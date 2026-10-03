// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateSidebarRightTabs } from '../../../src/client/integrations/SidebarRightTabsIntegration.ts';
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
vi.mock('../../../src/client/i18n/index.ts', () => ({ t: (key: string) => key }));

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false,
    betterSidebar: false,
    spotlight: false,
    slots: false,
    remoteWebUi: false,
    conversationView: false,
    desktopPlatform: false,
    ...overrides,
  };
}

describe('integrateSidebarRightTabs', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    vi.clearAllMocks();
  });

  it('registers tab and sets integration mode on success', () => {
    const typeDispose = vi.fn();
    const bodyDispose = vi.fn();
    const seatDispose = vi.fn();
    const regResult = vi.fn();
    const tabs = { register: vi.fn(() => typeDispose) };
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return bodyDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctxInject = vi.fn((keys: string[], cb: (m: Map<string, unknown>) => void) => {
      cb(new Map([['sidebarRightTabs', tabs]]));
      return seatDispose;
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSidebarRightTabs(state);

    expect(tabs.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dsh-codegraph-visualizer', kind: 'codegraph', priority: 'extension' }),
    );
    expect(state.navButtonRegistered).toBe(true);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('sidebar-right');
    expect(state.slotDisposers).toContain(typeDispose);
    expect(state.slotDisposers).toContain(bodyDispose);
    expect(state.slotDisposers).toContain(seatDispose);
    expect(state.slotDisposers).toContain(regResult);
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
    const ctxInject = vi.fn((keys: string[], cb: (m: Map<string, unknown>) => void) => {
      cb(new Map([['sidebarRightTabs', tabs]]));
      return vi.fn();
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSidebarRightTabs(state);

    const calls = tabs.register.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const descriptor = calls[0]![0];
    expect((descriptor.canOpen as () => boolean)()).toBe(true);
    expect((descriptor.title as () => string)()).toBe('nav.title');
  });

  it('warns and skips registration when sidebarRightTabs is injected but undefined', () => {
    const seatDispose = vi.fn();
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctxInject = vi.fn((keys: string[], cb: (m: Map<string, unknown>) => void) => {
      cb(new Map([['sidebarRightTabs', undefined]]));
      return seatDispose;
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSidebarRightTabs(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
    expect(slots.inject).not.toHaveBeenCalled();
    expect(state.slotDisposers).toContain(seatDispose);
  });

  it('catches exceptions from ctx.inject and logs error', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctxInject = vi.fn(() => {
      throw new Error('inject boom');
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

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
    const ctxInject = vi.fn((keys: string[], cb: (m: Map<string, unknown>) => void) => {
      cb(new Map([['sidebarRightTabs', tabs]]));
      return undefined;
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

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
    const ctxInject = vi.fn((keys: string[], cb: (m: Map<string, unknown>) => void) => {
      cb(new Map([['sidebarRightTabs', tabs]]));
      return vi.fn();
    });
    const ctx = { effect, slots, inject: ctxInject } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSidebarRightTabs(state);

    expect(slots.inject).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.any(Function));
    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sidebar.right.pane.tab', key: 'dsh-codegraph-visualizer' }),
      'GraphPanel',
    );
  });
});