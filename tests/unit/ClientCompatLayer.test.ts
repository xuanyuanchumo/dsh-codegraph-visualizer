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

/**
 * 上下文桩。
 *
 * cycle-83 移除了 `spotlight` 与 `remoteWebUI` 两个选项 —— 它们对应的服务键在任何 DSH 代
 * 都不存在（幻影），保留它们只会让测试继续断言一条永不执行的分支。新增
 * `commandUi`（spotlight 的真实替代）与两个 0.2 独有服务键（用于代际判定）。
 */
interface CtxOptions {
  sidebarRightTabs?: unknown;
  betterSidebar?: unknown;
  commandUi?: unknown;
  pluginNavigation?: unknown;
  userQuestionPanels?: unknown;
  slots?: unknown;
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
      if (key === 'commandUi') return opts.commandUi;
      if (key === 'pluginNavigation') return opts.pluginNavigation;
      if (key === 'userQuestionPanels') return opts.userQuestionPanels;
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

/** 完整的「什么都没探测到」标志快照，供 `toEqual` 断言。 */
const NO_FLAGS: ClientFeatureFlags = {
  sidebarRightTabs: false,
  betterSidebar: false,
  slots: false,
  conversationView: false,
  commandUi: false,
  desktopPlatform: false,
  remoteNarrow: false,
};

describe('ClientCompatLayer', () => {
  let layer: ClientCompatLayerInterface;

  beforeEach(() => {
    layer = createClientCompatLayer();
  });

  describe('initial state', () => {
    it('defaults mode to floating and flags to all false', () => {
      expect(layer.mode).toBe<SidebarIntegrationMode>('floating');
      expect(layer.flags).toEqual(NO_FLAGS satisfies ClientFeatureFlags);
    });

    it('reports a web carrier when there is no DOM', () => {
      // 本文件跑在 node 环境（无 jsdom），因此平台探测必须优雅退化为网页端。
      expect(layer.platform.carrier).toBe('web');
      expect(layer.platform.isDesktop).toBe(false);
      expect(layer.platform.isRemoteNarrow).toBe(false);
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

    it('returns floating when nothing is available', () => {
      const ctx = makeCtx({});
      expect(layer.detectMode(ctx)).toBe<SidebarIntegrationMode>('floating');
    });

    it('prioritises sidebar-right over better-sidebar', () => {
      const ctx = makeCtx({ sidebarRightTabs: {}, betterSidebar: {} });
      expect(layer.detectMode(ctx)).toBe('sidebar-right');
    });

    it('prioritises slots over every tab registry', () => {
      // slot 系统是唯一能给出顶层标签席位的通道，故优先级最高。
      const ctx = makeCtx({ slots: { inject: () => {}, register: () => {} }, sidebarRightTabs: {}, betterSidebar: {} });
      expect(layer.detectMode(ctx)).toBe('conversation-view');
    });

    it('prioritises sidebar-right over slots', () => {
      const ctx = makeCtx({ sidebarRightTabs: {}, slots: {} });
      expect(layer.detectMode(ctx)).toBe('sidebar-right');
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

    it('never reports a mode for the removed remote-web-ui phantom', () => {
      // `ctx.get('remoteWebUI')` 在任何 DSH 代都不存在；即使被注入也不该影响模式判定。
      const ctx = makeCtx({});
      (ctx as unknown as Record<string, unknown>).get = (key: string) =>
        key === 'remoteWebUI' ? { id: 'phantom' } : undefined;
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

    it('sets commandUi=true when the commandUi service is available', () => {
      const ctx = makeCtx({ commandUi: { register: () => () => {} } });
      const flags = layer.detectFlags(ctx);
      expect(flags.commandUi).toBe(true);
    });

    it('sets slots=true only when the slot service exposes both inject and register', () => {
      // 只给 `inject` 不算可用：`ConversationViewIntegration` 两条都要用。
      expect(layer.detectFlags(makeCtx({ slots: { inject: () => () => {} } })).slots).toBe(false);
      expect(layer.detectFlags(makeCtx({ slots: { register: () => () => {} } })).slots).toBe(false);
      expect(layer.detectFlags(makeCtx({ slots: { inject: () => () => {}, register: () => () => {} } })).slots).toBe(true);
    });

    it('ties conversationView to the slot system (its only carrier)', () => {
      expect(layer.detectFlags(makeCtx({ slots: { inject: () => {}, register: () => {} } })).conversationView).toBe(true);
      expect(layer.detectFlags(makeCtx({ sidebarRightTabs: {} })).conversationView).toBe(false);
    });

    it('returns all false when nothing is available', () => {
      const ctx = makeCtx({});
      const flags = layer.detectFlags(ctx);
      expect(flags).toEqual(NO_FLAGS satisfies ClientFeatureFlags);
    });

    it('degrades safely when ctx.get throws (all get-based flags false)', () => {
      const ctx = makeCtx({
        getThrows: true,
        sidebarRightTabs: {},
        slots: { inject: () => () => {}, register: () => () => {} },
      });
      const flags = layer.detectFlags(ctx);
      expect(flags.sidebarRightTabs).toBe(false);
      expect(flags.betterSidebar).toBe(false);
      expect(flags.commandUi).toBe(false);
      // slot 系统走属性访问而非 `ctx.get`，因此不受 `get` 抛错影响。
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
      const ctx = makeCtx({ sidebarRightTabs: {}, commandUi: {} });
      layer.detectFlags(ctx);
      expect(layer.hasFlag('sidebarRightTabs')).toBe(true);
      expect(layer.hasFlag('commandUi')).toBe(true);
      expect(layer.hasFlag('betterSidebar')).toBe(false);
      expect(layer.hasFlag('slots')).toBe(false);
    });

    it('returns false for all keys before any detection', () => {
      expect(layer.hasFlag('sidebarRightTabs')).toBe(false);
      expect(layer.hasFlag('betterSidebar')).toBe(false);
      expect(layer.hasFlag('commandUi')).toBe(false);
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

    it('detects gen2 when pluginNavigation is present', () => {
      // `pluginNavigation` 是 0.2 独有服务（gen1 树零 provide）。
      const ctx = makeCtx({ pluginNavigation: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen2 when userQuestionPanels is present', () => {
      const ctx = makeCtx({ userQuestionPanels: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen2()).toBe(true);
    });

    it('detects gen1 when only the slot system is present', () => {
      const ctx = makeCtx({ slots: { inject: () => {}, register: () => {} } });
      layer.detectVersion(ctx);
      expect(layer.isGen1()).toBe(true);
    });

    it('detects gen1 when only a two-generation service is present', () => {
      // `sidebarRightTabs` 两代都有，故只能作「身处 0.1 线」的下界证据，不能定 gen2。
      const ctx = makeCtx({ sidebarRightTabs: {} });
      layer.detectVersion(ctx);
      expect(layer.isGen1()).toBe(true);
      expect(layer.isGen2()).toBe(false);
    });

    it('returns unknown when nothing is available', () => {
      const ctx = makeCtx({});
      layer.detectVersion(ctx);
      expect(layer.generation).toBe('unknown');
    });
  });
});
