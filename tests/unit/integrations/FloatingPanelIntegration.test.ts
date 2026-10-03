// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import { integrateFloatingPanel } from '../../../src/client/integrations/FloatingPanelIntegration.ts';
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

const createRootMock = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}));

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

interface ReactElementLike {
  type: unknown;
  props: Record<string, unknown>;
}

function lastRenderCall(rootRender: ReturnType<typeof vi.fn>): ReactElementLike {
  const calls = rootRender.mock.calls as unknown as Array<[unknown]>;
  return calls[calls.length - 1]![0] as ReactElementLike;
}

describe('integrateFloatingPanel', () => {
  let effect: ReturnType<typeof vi.fn>;
  let rootRender: ReturnType<typeof vi.fn>;
  let rootUnmount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    effect = vi.fn();
    rootRender = vi.fn();
    rootUnmount = vi.fn();
    createRootMock.mockReturnValue({ render: rootRender, unmount: rootUnmount });
    document.body.innerHTML = '';
  });

  function makeState(): IntegrationState {
    const ctx = { effect } as unknown as Context;
    return new IntegrationState(ctx, makeFlags());
  }

  it('returns early when navButtonRegistered is true', () => {
    const state = makeState();
    state.navButtonRegistered = true;
    integrateFloatingPanel(state);
    expect(createRootMock).not.toHaveBeenCalled();
  });

  it('returns early when document is undefined', () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true, writable: true });
    try {
      const state = makeState();
      integrateFloatingPanel(state);
      expect(createRootMock).not.toHaveBeenCalled();
      expect(storeState.setIntegrationMode).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true, writable: true });
    }
  });

  it('creates floating container, root, sets renderFloating and integration mode', () => {
    const state = makeState();
    integrateFloatingPanel(state);

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(storeState.setIntegrationMode).toHaveBeenCalledWith('floating');
    expect(typeof state.renderFloating).toBe('function');
    const container = document.querySelector('.cg-floating-container');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('data-visible')).toBe('false');
    const labels = effect.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(labels).toContain('codegraph: floating panel cleanup');
  });

  it('appends container to document.body', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    const container = document.body.querySelector('.cg-floating-container');
    expect(container).not.toBeNull();
  });

  it('initial renderFloating call renders null (panelVisible false)', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    expect(rootRender).toHaveBeenCalledWith(null);
  });

  it('renderFloating renders null when panelVisible is false', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    rootRender.mockClear();
    state.panelVisible = false;
    state.renderFloating();
    expect(rootRender).toHaveBeenCalledWith(null);
  });

  it('renderFloating renders FloatingGraphPanel when visible and not minimized', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    state.panelVisible = true;
    state.renderFloating();
    const last = lastRenderCall(rootRender);
    expect(last.type).toBe('FloatingGraphPanel');
    expect(typeof last.props.onClose).toBe('function');
    expect(typeof last.props.onMinimize).toBe('function');
  });

  it('onMinimize switches render to MinimizedFloatingButton', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    state.panelVisible = true;
    state.renderFloating();
    const panel = lastRenderCall(rootRender);
    (panel.props.onMinimize as () => void)();
    state.renderFloating();
    const min = lastRenderCall(rootRender);
    expect(min.type).toBe('MinimizedFloatingButton');
    expect(typeof min.props.onRestore).toBe('function');
  });

  it('onRestore switches back to FloatingGraphPanel', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    state.panelVisible = true;
    state.renderFloating();
    const panel = lastRenderCall(rootRender);
    (panel.props.onMinimize as () => void)();
    state.renderFloating();
    const min = lastRenderCall(rootRender);
    (min.props.onRestore as () => void)();
    state.renderFloating();
    const restored = lastRenderCall(rootRender);
    expect(restored.type).toBe('FloatingGraphPanel');
  });

  it('onClose sets panelVisible false and data-visible false then renders null', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    state.panelVisible = true;
    state.renderFloating();
    const container = document.querySelector('.cg-floating-container');
    const panel = lastRenderCall(rootRender);
    rootRender.mockClear();
    (panel.props.onClose as () => void)();
    expect(state.panelVisible).toBe(false);
    expect(container?.getAttribute('data-visible')).toBe('false');
    expect(rootRender).toHaveBeenCalledWith(null);
  });

  it('cleanup effect unmounts root and removes container', () => {
    const state = makeState();
    integrateFloatingPanel(state);
    const container = document.querySelector('.cg-floating-container');
    expect(container).not.toBeNull();

    const cleanupCalls = effect.mock.calls.filter((c: unknown[]) => c[1] === 'codegraph: floating panel cleanup');
    const factory = cleanupCalls[0]![0] as () => () => void;
    const cleanup = factory();
    cleanup();

    expect(rootUnmount).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cg-floating-container')).toBeNull();
  });
});