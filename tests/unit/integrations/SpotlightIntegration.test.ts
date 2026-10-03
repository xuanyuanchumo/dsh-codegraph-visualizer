// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateSpotlight } from '../../../src/client/integrations/SpotlightIntegration.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';

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

interface SpotlightApi {
  registerCommand: ReturnType<typeof vi.fn>;
}

function makeSpotlightApi(overrides: Partial<SpotlightApi> = {}): SpotlightApi {
  return {
    registerCommand: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function getCommand(api: SpotlightApi, index: number): { id: string; title: string; handler: () => void } {
  const calls = api.registerCommand.mock.calls as unknown as Array<[{ id: string; title: string; handler: () => void }]>;
  return calls[index]![0];
}

describe('integrateSpotlight', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
    vi.clearAllMocks();
  });

  function makeState(api?: SpotlightApi): { state: IntegrationState; api: SpotlightApi } {
    const resolvedApi = api ?? makeSpotlightApi();
    const ctx = {
      effect,
      get: vi.fn((key: string) => (key === 'spotlight' ? resolvedApi : undefined)),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ spotlight: true }));
    return { state, api: resolvedApi };
  }

  it('returns early when flags.spotlight is false', () => {
    const ctx = { effect, get: vi.fn() } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ spotlight: false }));
    integrateSpotlight(state);
    expect(ctx.get).not.toHaveBeenCalled();
  });

  it('returns early when ctx.get returns undefined for spotlight', () => {
    const ctx = {
      effect,
      get: vi.fn(() => undefined),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ spotlight: true }));
    integrateSpotlight(state);
    expect(state.navButtonRegistered).toBe(false);
  });

  it('registers all five commands with correct ids and titles', () => {
    const { state, api } = makeState();
    integrateSpotlight(state);

    expect(api.registerCommand).toHaveBeenCalledTimes(5);
    expect(getCommand(api, 0).id).toBe('codegraph-search');
    expect(getCommand(api, 0).title).toBe('nav.searchSymbols');
    expect(getCommand(api, 1).id).toBe('codegraph-toggle');
    expect(getCommand(api, 1).title).toBe('nav.togglePanel');
    expect(getCommand(api, 2).id).toBe('codegraph-layout');
    expect(getCommand(api, 2).title).toBe('nav.switchLayout');
    expect(getCommand(api, 3).id).toBe('codegraph-filter');
    expect(getCommand(api, 3).title).toBe('nav.toggleFilter');
    expect(getCommand(api, 4).id).toBe('codegraph-export');
    expect(getCommand(api, 4).title).toBe('nav.exportGraph');
  });

  it('tracks all five disposers via ctx.effect when registerCommand returns functions', () => {
    const { state } = makeState();
    integrateSpotlight(state);

    const labels = effect.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(labels).toContain('codegraph: spotlight search cmd');
    expect(labels).toContain('codegraph: spotlight toggle cmd');
    expect(labels).toContain('codegraph: spotlight layout cmd');
    expect(labels).toContain('codegraph: spotlight filter cmd');
    expect(labels).toContain('codegraph: spotlight export cmd');
  });

  it('does not call ctx.effect when registerCommand returns non-function', () => {
    const api = makeSpotlightApi({ registerCommand: vi.fn(() => undefined) });
    const { state } = makeState(api);
    integrateSpotlight(state);
    const cmdLabels = effect.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .filter((l) => typeof l === 'string' && l.startsWith('codegraph: spotlight'));
    expect(cmdLabels).toHaveLength(0);
  });

  it('codegraph-search handler opens sidebar tab and dispatches keydown /', () => {
    const { state, api } = makeState();
    const openTab = vi.fn();
    state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    integrateSpotlight(state);
    getCommand(api, 0).handler();

    expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0]![0] as KeyboardEvent;
    expect(event.key).toBe('/');
    dispatchSpy.mockRestore();
  });

  it('codegraph-toggle handler toggles panel', () => {
    const { state, api } = makeState();
    const renderFloating = vi.fn();
    state.renderFloating = renderFloating;
    integrateSpotlight(state);
    getCommand(api, 1).handler();
    expect(state.panelVisible).toBe(true);
  });

  it('codegraph-layout handler cycles layout forward', () => {
    const { state, api } = makeState();
    storeState.layout = 'cose';
    integrateSpotlight(state);
    getCommand(api, 2).handler();
    expect(storeState.setLayout).toHaveBeenCalledWith('fcose');
  });

  it('codegraph-layout handler wraps from tree back to cose', () => {
    const { state, api } = makeState();
    storeState.layout = 'tree';
    integrateSpotlight(state);
    getCommand(api, 2).handler();
    expect(storeState.setLayout).toHaveBeenCalledWith('cose');
  });

  it('codegraph-layout handler uses cose when current layout not in list', () => {
    const { state, api } = makeState();
    storeState.layout = 'unknown-layout';
    integrateSpotlight(state);
    getCommand(api, 2).handler();
    expect(storeState.setLayout).toHaveBeenCalledWith('cose');
  });

  it('codegraph-layout handler opens sidebar tab before cycling', () => {
    const { state, api } = makeState();
    const openTab = vi.fn();
    state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
    integrateSpotlight(state);
    getCommand(api, 2).handler();
    expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
  });

  it('codegraph-filter handler opens sidebar tab and dispatches toggle filter event', () => {
    const { state, api } = makeState();
    const openTab = vi.fn();
    state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    integrateSpotlight(state);
    getCommand(api, 3).handler();

    expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
    const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe(DOM_EVENTS.TOGGLE_FILTER_PANEL);
    dispatchSpy.mockRestore();
  });

  it('codegraph-export handler opens sidebar tab and dispatches toggle export event', () => {
    const { state, api } = makeState();
    const openTab = vi.fn();
    state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    integrateSpotlight(state);
    getCommand(api, 4).handler();

    expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
    const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe(DOM_EVENTS.TOGGLE_EXPORT_MENU);
    dispatchSpy.mockRestore();
  });

  it('catches exceptions from ctx.get and logs warning', () => {
    const ctx = {
      effect,
      get: vi.fn(() => {
        throw new Error('get boom');
      }),
    } as unknown as Context;
    const state = new IntegrationState(ctx, makeFlags({ spotlight: true }));
    integrateSpotlight(state);
    expect(state.navButtonRegistered).toBe(false);
  });

  it('catches exceptions from registerCommand without registering subsequent commands', () => {
    const api = makeSpotlightApi({
      registerCommand: vi.fn(() => {
        throw new Error('reg boom');
      }),
    });
    const { state } = makeState(api);
    integrateSpotlight(state);
    const cmdLabels = effect.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .filter((l) => typeof l === 'string' && l.startsWith('codegraph: spotlight'));
    expect(cmdLabels).toHaveLength(0);
  });
});