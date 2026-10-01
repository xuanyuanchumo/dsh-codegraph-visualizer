// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateSlotsFallback } from '../../../src/client/integrations/SlotsFallback.ts';
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

vi.mock('../../../src/client/components/FloatingUI.tsx', () => ({
  SidebarNavButton: 'SidebarNavButton',
  FloatingGraphPanel: 'FloatingGraphPanel',
  MinimizedFloatingButton: 'MinimizedFloatingButton',
}));

vi.mock('../../../src/client/i18n/index.ts', () => ({
  t: (key: string) => key,
}));

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false,
    betterSidebar: false,
    spotlight: false,
    slots: false,
    remoteWebUi: false,
    ...overrides,
  };
}

describe('integrateSlotsFallback', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    vi.clearAllMocks();
  });

  it('returns early when navButtonRegistered is already true', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());
    state.navButtonRegistered = true;
    integrateSlotsFallback(state);
    expect(slots.inject).not.toHaveBeenCalled();
  });

  it('injects slot, registers nav button, tracks disposers and sets integration mode', () => {
    const registerDisposer = vi.fn();
    const injectDisposer = vi.fn();
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return injectDisposer;
      }),
      register: vi.fn(() => registerDisposer),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSlotsFallback(state);

    expect(slots.inject).toHaveBeenCalledWith('sidebar.footer.action', expect.any(Function));
    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sidebar.footer.action',
        id: 'codegraph-visualizer',
        order: 10,
      }),
      expect.any(Function),
    );
    expect(state.navButtonRegistered).toBe(true);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('slot');
    expect(state.slotDisposers).toContain(injectDisposer);
    expect(state.slotDisposers).toContain(registerDisposer);
  });

  it('register label is a function returning nav.title translation', () => {
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return vi.fn();
      }),
      register: vi.fn(() => vi.fn()),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSlotsFallback(state);

    const calls = slots.register.mock.calls as unknown as Array<[{ label: () => string }, unknown]>;
    const descriptor = calls[0]![0];
    expect(typeof descriptor.label).toBe('function');
    expect(descriptor.label()).toBe('nav.title');
  });

  it('swallows exceptions from slots.inject and does not set navButtonRegistered', () => {
    const slots = {
      inject: vi.fn(() => {
        throw new Error('inject boom');
      }),
      register: vi.fn(),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSlotsFallback(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
  });

  it('swallows exceptions from slots.register inside callback', () => {
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return vi.fn();
      }),
      register: vi.fn(() => {
        throw new Error('register boom');
      }),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSlotsFallback(state);

    expect(state.navButtonRegistered).toBe(false);
    expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
  });

  it('does not track non-function disposers from inject or register', () => {
    const slots = {
      inject: vi.fn((_, cb: () => void) => {
        cb();
        return undefined;
      }),
      register: vi.fn(() => undefined),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags());

    integrateSlotsFallback(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(state.slotDisposers).toEqual([]);
  });
});