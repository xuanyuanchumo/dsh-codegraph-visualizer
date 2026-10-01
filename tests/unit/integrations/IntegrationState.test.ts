// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { IntegrationState } from '../../../src/client/integrations/IntegrationState.ts';
import type { ClientFeatureFlags } from '../../../src/client/compat/ClientCompatLayer.ts';

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

describe('IntegrationState', () => {
  let effect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effect = vi.fn();
  });

  function makeState(flags?: ClientFeatureFlags): IntegrationState {
    const ctx = { effect } as unknown as Context;
    return new IntegrationState(ctx, flags ?? makeFlags());
  }

  describe('initialization', () => {
    it('sets default field values', () => {
      const state = makeState();
      expect(state.panelVisible).toBe(false);
      expect(state.navButtonRegistered).toBe(false);
      expect(state.betterSidebarApi).toBeUndefined();
      expect(state.betterSidebarTabId).toBeUndefined();
      expect(state.sidebarStateDisposer).toBeUndefined();
      expect(state.slotDisposers).toEqual([]);
      expect(typeof state.renderFloating).toBe('function');
      state.renderFloating();
    });

    it('registers a slot cleanup effect via ctx.effect with label', () => {
      makeState();
      expect(effect).toHaveBeenCalledTimes(1);
      expect(effect.mock.calls[0]![1]).toBe('codegraph: slot registrations cleanup');
    });

    it('stores ctx and flags as public fields', () => {
      const flags = makeFlags({ betterSidebar: true });
      const ctx = { effect } as unknown as Context;
      const state = new IntegrationState(ctx, flags);
      expect(state.ctx).toBe(ctx);
      expect(state.flags).toBe(flags);
    });
  });

  describe('trackSlotDisposer', () => {
    it('pushes function disposers into slotDisposers', () => {
      const state = makeState();
      const d1 = vi.fn();
      const d2 = vi.fn();
      state.trackSlotDisposer(d1);
      state.trackSlotDisposer(d2);
      expect(state.slotDisposers).toEqual([d1, d2]);
    });

    it('ignores undefined disposers', () => {
      const state = makeState();
      state.trackSlotDisposer(undefined);
      expect(state.slotDisposers).toEqual([]);
    });

    it('ignores non-function values', () => {
      const state = makeState();
      state.trackSlotDisposer(undefined as unknown as () => void);
      state.trackSlotDisposer(null as unknown as () => void);
      expect(state.slotDisposers).toEqual([]);
    });
  });

  describe('effect cleanup', () => {
    it('runs all tracked slot disposers and clears the array', () => {
      const state = makeState();
      const d1 = vi.fn();
      const d2 = vi.fn();
      state.trackSlotDisposer(d1);
      state.trackSlotDisposer(d2);

      const factory = effect.mock.calls[0]![0] as () => () => void;
      const cleanup = factory();
      cleanup();

      expect(d1).toHaveBeenCalledTimes(1);
      expect(d2).toHaveBeenCalledTimes(1);
      expect(state.slotDisposers).toHaveLength(0);
    });

    it('cleanup works with no tracked disposers', () => {
      const state = makeState();
      const factory = effect.mock.calls[0]![0] as () => () => void;
      const cleanup = factory();
      cleanup();
      expect(state.slotDisposers).toHaveLength(0);
    });
  });

  describe('openSidebarTab', () => {
    it('calls betterSidebarApi.openTab when api is present', () => {
      const state = makeState();
      const openTab = vi.fn();
      state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
      state.openSidebarTab();
      expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
    });

    it('is a no-op when betterSidebarApi is absent', () => {
      const state = makeState();
      state.openSidebarTab();
    });

    it('swallows openTab exceptions without rethrowing', () => {
      const state = makeState();
      const openTab = vi.fn(() => {
        throw new Error('boom');
      });
      state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
      state.openSidebarTab();
      expect(openTab).toHaveBeenCalledTimes(1);
    });
  });

  describe('togglePanel', () => {
    it('opens sidebar tab when betterSidebarApi is present and panel not visible', () => {
      const state = makeState();
      const openTab = vi.fn();
      state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
      state.panelVisible = false;
      const renderFloating = vi.fn();
      state.renderFloating = renderFloating;
      state.togglePanel();
      expect(openTab).toHaveBeenCalledWith({ type: 'codegraph-visualizer' });
      expect(state.panelVisible).toBe(false);
      expect(renderFloating).not.toHaveBeenCalled();
    });

    it('toggles panelVisible, updates container data-visible and calls renderFloating when no sidebar api', () => {
      const state = makeState();
      const container = document.createElement('div');
      container.className = 'cg-floating-container';
      document.body.appendChild(container);
      const renderFloating = vi.fn();
      state.renderFloating = renderFloating;

      state.togglePanel();
      expect(state.panelVisible).toBe(true);
      expect(container.getAttribute('data-visible')).toBe('true');
      expect(renderFloating).toHaveBeenCalledTimes(1);

      state.togglePanel();
      expect(state.panelVisible).toBe(false);
      expect(container.getAttribute('data-visible')).toBe('false');
      expect(renderFloating).toHaveBeenCalledTimes(2);

      container.remove();
    });

    it('toggles without container present (querySelector returns null)', () => {
      const state = makeState();
      const renderFloating = vi.fn();
      state.renderFloating = renderFloating;
      state.togglePanel();
      expect(state.panelVisible).toBe(true);
      expect(renderFloating).toHaveBeenCalledTimes(1);
    });

    it('toggles when betterSidebarApi present and panel already visible', () => {
      const state = makeState();
      const openTab = vi.fn();
      state.betterSidebarApi = { openTab } as unknown as NonNullable<typeof state.betterSidebarApi>;
      state.panelVisible = true;
      const renderFloating = vi.fn();
      state.renderFloating = renderFloating;
      state.togglePanel();
      expect(openTab).not.toHaveBeenCalled();
      expect(state.panelVisible).toBe(false);
      expect(renderFloating).toHaveBeenCalledTimes(1);
    });
  });
});