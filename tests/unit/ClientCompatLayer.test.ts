import { describe, it, expect, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import {
  createClientCompatLayer,
} from '../../src/client/compat/ClientCompatLayer.ts';
import type {
  SidebarIntegrationMode,
  ClientFeatureFlags,
  ClientCompatLayer as ClientCompatLayerInterface,
} from '../../src/client/compat/ClientCompatLayer.ts';

interface CtxOptions {
  sidebarRightTabs?: unknown;
  betterSidebar?: unknown;
  spotlight?: unknown;
  slots?: unknown;
  remoteWebUI?: unknown;
  getThrows?: boolean;
  slotsThrows?: boolean;
  sidebarRightTabsThrows?: boolean;
}

function makeCtx(opts: CtxOptions = {}): Context {
  const ctx: Record<string, unknown> = {
    get: (key: string): unknown => {
      if (opts.getThrows) throw new Error('get boom');
      if (key === 'sidebarRightTabs') return opts.sidebarRightTabs;
      if (key === 'betterSidebar') return opts.betterSidebar;
      if (key === 'spotlight') return opts.spotlight;
      if (key === 'remoteWebUI') return opts.remoteWebUI;
      return undefined;
    },
  };

  if (opts.slotsThrows) {
    Object.defineProperty(ctx, 'slots', {
      get() {
        throw new Error('slots boom');
      },
      configurable: true,
    });
  } else {
    ctx.slots = opts.slots;
  }

  if (opts.sidebarRightTabsThrows) {
    Object.defineProperty(ctx, 'sidebarRightTabs', {
      get() {
        throw new Error('tabs boom');
      },
      configurable: true,
    });
  } else {
    ctx.sidebarRightTabs = opts.sidebarRightTabs;
  }

  return ctx as unknown as Context;
}

describe('ClientCompatLayer', () => {
  let layer: ClientCompatLayerInterface;

  beforeEach(() => {
    layer = createClientCompatLayer();
  });

  describe('initial state', () => {
    it('defaults mode to floating and flags to all false', () => {
      expect(layer.mode).toBe<SidebarIntegrationMode>('floating');
      expect(layer.flags).toEqual({
        sidebarRightTabs: false,
        betterSidebar: false,
        spotlight: false,
        slots: false,
        remoteWebUi: false,
        conversationView: false,
    desktopPlatform: false,
      } satisfies ClientFeatureFlags);
    });
  });

  describe('detectMode', () => {
    it('returns sidebar-right when ctx.sidebarRightTabs is present', () => {
      const ctx = makeCtx({ sidebarRightTabs: { tabs: true } });
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('sidebar-right');
      expect(layer.mode).toBe('sidebar-right');
    });

    it('returns better-sidebar when betterSidebar service is available', () => {
      const ctx = makeCtx({ betterSidebar: { id: 'bs' } });
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('better-sidebar');
    });

    it('returns conversation-view when ctx.slots has inject and register', () => {
      const ctx = makeCtx({ slots: { inject: () => () => {}, register: () => {} } });
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('conversation-view');
    });

    it('returns remote-web-ui when remoteWebUI service is available', () => {
      const ctx = makeCtx({ remoteWebUI: { id: 'rui' } });
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('remote-web-ui');
    });

    it('returns floating when nothing is available', () => {
      const ctx = makeCtx({});
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('floating');
    });

    it('prioritises sidebar-right over better-sidebar', () => {
      const ctx = makeCtx({ sidebarRightTabs: {}, betterSidebar: {} });
      expect(layer.detectMode(ctx)).toBe('sidebar-right');
    });

    it('prioritises better-sidebar over remote-web-ui', () => {
      const ctx = makeCtx({ betterSidebar: {}, remoteWebUI: {} });
      expect(layer.detectMode(ctx)).toBe('better-sidebar');
    });

    it('prioritises remote-web-ui over slots', () => {
      const ctx = makeCtx({ remoteWebUI: {}, slots: {} });
      expect(layer.detectMode(ctx)).toBe('remote-web-ui');
    });

    it('prioritises better-sidebar over slots', () => {
      const ctx = makeCtx({ betterSidebar: {}, slots: {} });
      expect(layer.detectMode(ctx)).toBe('better-sidebar');
    });

    it('treats null sidebarRightTabs as absent and falls through', () => {
      const ctx = makeCtx({ sidebarRightTabs: null, betterSidebar: {} });
      expect(layer.detectMode(ctx)).toBe('better-sidebar');
    });

    it('treats undefined sidebarRightTabs as absent and falls through', () => {
      const ctx = makeCtx({ sidebarRightTabs: undefined, slots: { inject: () => {}, register: () => {} } });
      expect(layer.detectMode(ctx)).toBe('conversation-view');
    });

    it('falls back to floating when sidebarRightTabs access throws', () => {
      const ctx = makeCtx({ sidebarRightTabsThrows: true });
      expect(layer.detectMode(ctx)).toBe('floating');
    });

    it('falls back when ctx.get throws (better-sidebar check degrades safely)', () => {
      const ctx = makeCtx({ getThrows: true, slots: { inject: () => {}, register: () => {} } });
      expect(layer.detectMode(ctx)).toBe('conversation-view');
    });

    it('falls back to floating when slots access throws', () => {
      const ctx = makeCtx({ slotsThrows: true });
      expect(layer.detectMode(ctx)).toBe('floating');
    });
  });

  describe('detectFlags', () => {
    it('sets sidebarRightTabs=true when ctx.sidebarRightTabs is present', () => {
      const ctx = makeCtx({ sidebarRightTabs: { tabs: true } });
      const flags = layer.detectFlags(ctx);
      expect(flags.sidebarRightTabs).toBe(true);
      expect(layer.flags.sidebarRightTabs).toBe(true);
    });

    it('sets betterSidebar=true when the betterSidebar service is available', () => {
      const ctx = makeCtx({ betterSidebar: { id: 'bs' } });
      const flags = layer.detectFlags(ctx);
      expect(flags.betterSidebar).toBe(true);
    });

    it('sets spotlight=true when the spotlight service is available', () => {
      const ctx = makeCtx({ spotlight: { id: 'sp' } });
      const flags = layer.detectFlags(ctx);
      expect(flags.spotlight).toBe(true);
    });

    it('sets slots=true when ctx.slots is present', () => {
      const ctx = makeCtx({ slots: { inject: () => () => {} } });
      const flags = layer.detectFlags(ctx);
      expect(flags.slots).toBe(true);
    });

    it('returns all false when nothing is available', () => {
      const ctx = makeCtx({});
      const flags = layer.detectFlags(ctx);
      expect(flags).toEqual({
        sidebarRightTabs: false,
        betterSidebar: false,
        spotlight: false,
        slots: false,
        remoteWebUi: false,
        conversationView: false,
    desktopPlatform: false,
      } satisfies ClientFeatureFlags);
    });

    it('degrades safely when ctx.get throws (all get-based flags false)', () => {
      const ctx = makeCtx({ getThrows: true, sidebarRightTabs: {}, slots: {} });
      const flags = layer.detectFlags(ctx);
      expect(flags.sidebarRightTabs).toBe(false);
      expect(flags.betterSidebar).toBe(false);
      expect(flags.spotlight).toBe(false);
      expect(flags.slots).toBe(true);
    });

    it('degrades safely when sidebarRightTabs access throws', () => {
      const ctx = makeCtx({ sidebarRightTabsThrows: true });
      const flags = layer.detectFlags(ctx);
      expect(flags.sidebarRightTabs).toBe(false);
    });

    it('degrades safely when slots access throws', () => {
      const ctx = makeCtx({ slotsThrows: true });
      const flags = layer.detectFlags(ctx);
      expect(flags.slots).toBe(false);
    });
  });

  describe('hasFlag', () => {
    it('reflects the latest detected flags', () => {
      const ctx = makeCtx({ sidebarRightTabs: {}, spotlight: {} });
      layer.detectFlags(ctx);
      expect(layer.hasFlag('sidebarRightTabs')).toBe(true);
      expect(layer.hasFlag('spotlight')).toBe(true);
      expect(layer.hasFlag('betterSidebar')).toBe(false);
      expect(layer.hasFlag('slots')).toBe(false);
    });

    it('returns false for all keys before any detection', () => {
      expect(layer.hasFlag('sidebarRightTabs')).toBe(false);
      expect(layer.hasFlag('betterSidebar')).toBe(false);
      expect(layer.hasFlag('spotlight')).toBe(false);
      expect(layer.hasFlag('slots')).toBe(false);
    });
  });

  describe('detectVersion', () => {
    it('defaults to unknown generation before detection', () => {
      expect(layer.generation).toBe('unknown');
      expect(layer.isGen1()).toBe(false);
      expect(layer.isGen2()).toBe(false);
      expect(layer.isGen3()).toBe(false);
    });

    it('detects gen2 when sidebarRightTabs is present', () => {
      const ctx = makeCtx({ sidebarRightTabs: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen2 when remoteWebUI is present', () => {
      const ctx = makeCtx({ remoteWebUI: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen2 when betterSidebar is present', () => {
      const ctx = makeCtx({ betterSidebar: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen2 when slots are present', () => {
      const ctx = makeCtx({ slots: { inject: () => {}, register: () => {} } });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen1 when only spotlight is present', () => {
      const ctx = makeCtx({ spotlight: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen1()).toBe(true);
    });

    it('returns unknown when nothing is available', () => {
      const ctx = makeCtx({});
      layer.detectVersion(ctx);
      expect(layer.generation).toBe('unknown');
    });
  });
});