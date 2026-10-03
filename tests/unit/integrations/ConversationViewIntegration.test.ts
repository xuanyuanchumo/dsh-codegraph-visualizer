// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateConversationView } from '../../../src/client/integrations/ConversationViewIntegration.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

const storeState = vi.hoisted(() => ({
  setIntegrationMode: vi.fn(),
  setPanelVisible: vi.fn(),
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
    spotlight: false,
    slots: false,
    remoteWebUi: false,
    conversationView: false,
    desktopPlatform: false,
    ...overrides,
  };
}

describe('integrateConversationView', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    vi.clearAllMocks();
  });

  it('registers with id (not key) for list-kind conversation.view slot', () => {
    const injectDispose = vi.fn();
    const regResult = vi.fn();
    const slots = {
      inject: vi.fn((_: string, cb: () => void) => {
        cb();
        return injectDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation.view',
        id: 'dsh-codegraph-visualizer',
        order: 50,
      }),
      expect.any(Function),
    );
  });

  it('does not use key field (list slots require id, not key)', () => {
    const injectDispose = vi.fn();
    const regResult = vi.fn();
    const slots = {
      inject: vi.fn((_: string, cb: () => void) => {
        cb();
        return injectDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    const calls = slots.register.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const callArgs = calls[0]![0];
    expect(callArgs.key).toBeUndefined();
    expect(callArgs.id).toBe('dsh-codegraph-visualizer');
  });

  it('sets integration mode to conversation-view on success', () => {
    const injectDispose = vi.fn();
    const regResult = vi.fn();
    const slots = {
      inject: vi.fn((_: string, cb: () => void) => {
        cb();
        return injectDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('conversation-view');
  });

  it('tracks inject disposer and register disposer', () => {
    const injectDispose = vi.fn();
    const regResult = vi.fn();
    const slots = {
      inject: vi.fn((_: string, cb: () => void) => {
        cb();
        return injectDispose;
      }),
      register: vi.fn(() => regResult),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    expect(state.slotDisposers).toContain(injectDispose);
    expect(state.slotDisposers).toContain(regResult);
  });

  it('skips when conversationView flag is false', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: false }));

    integrateConversationView(state);

    expect(slots.inject).not.toHaveBeenCalled();
    expect(state.navButtonRegistered).toBe(false);
  });

  it('skips when already registered', () => {
    const slots = { inject: vi.fn(), register: vi.fn() };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));
    state.navButtonRegistered = true;

    integrateConversationView(state);

    expect(slots.inject).not.toHaveBeenCalled();
  });

  it('catches exceptions and does not set navButtonRegistered', () => {
    const slots = {
      inject: vi.fn(() => {
        throw new Error('inject boom');
      }),
      register: vi.fn(),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('does not push non-function disposers', () => {
    const slots = {
      inject: vi.fn((_: string, cb: () => void) => {
        cb();
        return undefined;
      }),
      register: vi.fn(() => undefined),
    };
    const ctx = { effect, slots } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ conversationView: true }));

    integrateConversationView(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(state.slotDisposers).toEqual([]);
  });
});