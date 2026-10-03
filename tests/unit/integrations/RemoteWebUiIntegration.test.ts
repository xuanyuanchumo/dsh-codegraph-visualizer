// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateRemoteWebUi } from '../../../src/client/integrations/RemoteWebUiIntegration.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

const storeState = vi.hoisted(() => ({
  setIntegrationMode: vi.fn(),
  setPanelVisible: vi.fn(),
  nodes: [] as unknown[],
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

type PanelDescriptor = Record<string, unknown> & {
  id: string;
  order: number;
  badge?: () => unknown;
  onOpen?: (panel: unknown, scope: unknown) => void;
  onActivate?: (panel: unknown, scope: unknown) => void;
  onClose?: (panel: unknown, scope: unknown) => void;
  component: (props: { ctx: Context; visible: boolean; panel: { id: string; title: string; path?: string } }) => unknown;
};

function makeRemoteWebUiApi(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    features: [] as string[],
    registerPanel: vi.fn(() => vi.fn()),
    openPanel: vi.fn(),
    subscribeState: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ state: { activePane: null, panelOpen: false } })),
    ...overrides,
  };
}

function getDescriptor(api: ReturnType<typeof makeRemoteWebUiApi>): PanelDescriptor {
  const calls = api.registerPanel.mock.calls as unknown as Array<[PanelDescriptor]>;
  return calls[0]![0];
}

describe('integrateRemoteWebUi', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn((fn: () => unknown) => { fn(); return () => {}; });
    vi.clearAllMocks();
    storeState.nodes = [];
  });

  it('skips when remoteWebUi flag is false', () => {
    const ctx = { effect, get: vi.fn() } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: false }));

    integrateRemoteWebUi(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('skips when already registered', () => {
    const ctx = { effect, get: vi.fn(() => makeRemoteWebUiApi()) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));
    state.navButtonRegistered = true;

    integrateRemoteWebUi(state);

    expect(ctx.get).not.toHaveBeenCalled();
  });

  it('skips when ctx.get(remoteWebUI) returns undefined', () => {
    const ctx = { effect, get: vi.fn(() => undefined) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('registers panel with correct id and order', () => {
    const api = makeRemoteWebUiApi();
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(api.registerPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'codegraph-visualizer',
        order: 100,
      }),
    );
  });

  it('sets navButtonRegistered and integration mode on success', () => {
    const api = makeRemoteWebUiApi();
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(state.navButtonRegistered).toBe(true);
    expect(state.remoteWebUiApi).toBe(api);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('remote-web-ui');
  });

  it('adds badge when feature is available', () => {
    const api = makeRemoteWebUiApi({ features: ['badge'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    expect(typeof descriptor.badge).toBe('function');
  });

  it('badge returns null when no nodes', () => {
    const api = makeRemoteWebUiApi({ features: ['badge'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    expect(descriptor.badge!()).toBeNull();
  });

  it('badge returns node count when nodes exist', () => {
    storeState.nodes = [{ id: 'n1' }, { id: 'n2' }];
    const api = makeRemoteWebUiApi({ features: ['badge'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    expect(descriptor.badge!()).toBe(2);
  });

  it('badge returns 99+ when node count exceeds 99', () => {
    storeState.nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}` }));
    const api = makeRemoteWebUiApi({ features: ['badge'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    expect(descriptor.badge!()).toBe('99+');
  });

  it('adds panel lifecycle callbacks when feature is available', () => {
    const api = makeRemoteWebUiApi({ features: ['panelLifecycle'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    expect(typeof descriptor.onOpen).toBe('function');
    expect(typeof descriptor.onActivate).toBe('function');
    expect(typeof descriptor.onClose).toBe('function');
  });

  it('onOpen sets panelVisible to true', () => {
    const api = makeRemoteWebUiApi({ features: ['panelLifecycle'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    descriptor.onOpen!({ id: 'panel-1' }, {});
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(true);
  });

  it('onClose sets panelVisible to false', () => {
    const api = makeRemoteWebUiApi({ features: ['panelLifecycle'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    descriptor.onClose!({ id: 'panel-1' }, {});
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(false);
  });

  it('subscribes to state when stateSubscription feature is available', () => {
    const api = makeRemoteWebUiApi({ features: ['stateSubscription'] });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(api.subscribeState).toHaveBeenCalled();
    expect(state.remoteWebUiStateDisposer).toBeDefined();
  });

  it('does not subscribe when stateSubscription feature is unavailable', () => {
    const api = makeRemoteWebUiApi();
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(api.subscribeState).not.toHaveBeenCalled();
  });

  it('warns when registerPanel does not return a disposer', () => {
    const api = makeRemoteWebUiApi({ registerPanel: vi.fn(() => undefined) });
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('catches exceptions and does not set navButtonRegistered', () => {
    const ctx = {
      effect,
      get: vi.fn(() => { throw new Error('get boom'); }),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    expect(state.navButtonRegistered).toBe(false);
  });

  it('component renders GraphPanel wrapped in ErrorBoundary', () => {
    const api = makeRemoteWebUiApi();
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    const result = descriptor.component({
      ctx,
      visible: true,
      panel: { id: 'test-panel', title: 'Test' },
    });

    expect(result).toBeDefined();
    expect(state.panelVisible).toBe(true);
    expect(state.remoteWebUiPanelId).toBe('test-panel');
  });

  it('component sets panelVisible to false when not visible', () => {
    const api = makeRemoteWebUiApi();
    const ctx = { effect, get: vi.fn(() => api) } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ remoteWebUi: true }));

    integrateRemoteWebUi(state);

    const descriptor = getDescriptor(api);
    descriptor.component({
      ctx,
      visible: false,
      panel: { id: 'test-panel', title: 'Test' },
    });

    expect(state.panelVisible).toBe(false);
    expect(storeState.setPanelVisible).toHaveBeenCalledWith(false);
  });
});