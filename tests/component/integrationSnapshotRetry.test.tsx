/**
 * @vitest-environment jsdom
 *
 * 「快照为假」不能决定一整轮：服务晚到时通道必须仍能注册（cycle-110 / C1）。
 *
 * ## 缺陷形态
 *
 * `apply()` 同步一次性执行，三条互斥通道用 `compat.detectFlags()` 的快照做早退：
 *
 * ```ts
 * if (!state.flags.betterSidebar) return;       // 快照为假 ⇒ 整条通道静默消失
 * if (!state.flags.sidebarRightTabs) return;
 * if (!state.flags.conversationView) { … }
 * ```
 *
 * 而 `ctx.get(name, false)` 读不到「提供者 fiber 还在 loading」的服务，
 * 真机 `better-sidebar pending` 已证明提供者晚到是**常态**。CLAUDE.md 记过同形教训：
 * 「A capability snapshot that gates an integration is a one-instant-decides-forever
 * defect amplifier」。
 *
 * ## 本文件守的两件事
 *
 * 1. 快照为假 ⇒ 留下可观测的 `snapshot-miss` 标记（`<html data-cg-channel-*>`），
 *    不是静默跳过；
 * 2. 服务随后就绪 ⇒ 通道**最终注册成功**（`late-registered`），且仍然受到互斥闸门约束
 *    （已被更高优先级通道占位时变为 `yielded`，绝不双占位）。
 *
 * 反向用例同样重要：服务**始终不出现**时不得伪造注册，也不得无限重试。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';

import {
  IntegrationState, getChannelRetryCount,
} from '../../src/client/integrations/IntegrationState.ts';
import { integrateSidebarRightTabs } from '../../src/client/integrations/SidebarRightTabsIntegration.ts';
import { integrateBetterSidebar } from '../../src/client/integrations/BetterSidebarIntegration.ts';
import { integrateConversationView } from '../../src/client/integrations/ConversationViewIntegration.ts';
import {
  CHANNEL_ATTR_PREFIX, getChannelState, resetChannelProbe, type ChannelName,
} from '../../src/client/integrations/integrationProbe.ts';
import { resetTopTabObservability } from '../../src/client/integrations/topTabObservability.ts';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { resetI18nListeners } from '../../src/client/i18n/index.ts';
import type { ClientFeatureFlags } from '../../src/client/compat/ClientCompatLayer.ts';

/** 记录下来的注入回调，用例可手动「让服务就绪」。 */
type InjectEntry = { deps: string[]; fire: () => void };

function makeCtx() {
  const services = new Map<string, unknown>();
  const injects: InjectEntry[] = [];
  const registrations: string[] = [];

  const ctx = {
    slots: {
      inject: (seat: string, callback: () => void) => {
        // `conversation.view` 视为已声明（本文件不测席位声明时机）
        if (seat === 'conversation.view') callback();
        return () => {};
      },
      register: (definition: Record<string, unknown>) => {
        registrations.push(String(definition.name ?? ''));
        return () => {};
      },
    },
    get: (key: string, _strict?: boolean) => services.get(key),
    inject: (deps: string[], callback: (scope: unknown) => void) => {
      injects.push({
        deps,
        fire: () => callback({
          get: (key: string) => services.get(key),
          effect: () => () => {},
        }),
      });
      return { dispose: () => {} };
    },
    effect: () => () => {},
  };

  return { ctx: ctx as unknown as Context, services, injects, registrations };
}

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false, betterSidebar: false, slots: true, conversationView: true,
    commandUi: false, desktopPlatform: false, remoteNarrow: false, ...overrides,
  };
}

const channelAttr = (channel: ChannelName) =>
  document.documentElement.getAttribute(`${CHANNEL_ATTR_PREFIX}${channel}`);

/** 一个最小可用的 betterSidebar 服务（字段照抄真实契约的子集）。 */
function makeBetterSidebar(registrations: string[]) {
  return {
    version: '0.24.1',
    features: ['badge', 'tabLifecycle'],
    registerTab: (descriptor: { id: string }) => {
      registrations.push(`betterSidebar:${descriptor.id}`);
      return () => {};
    },
    getSnapshot: () => ({ state: { activePane: null, bottomOpen: false } }),
    subscribeState: () => () => {},
    openTab: () => {},
  };
}

beforeEach(() => {
  resetTopTabObservability();
  resetChannelProbe();
  resetI18nListeners();
  useGraphStore.getState().setIntegrationMode('floating');
});

afterEach(() => {
  vi.useRealTimers();
  resetTopTabObservability();
  resetChannelProbe();
});

describe('sidebar-right：快照为假但服务晚到', () => {
  it('records snapshot-miss, then registers (late-registered) when the service appears', () => {
    const { ctx, services, injects, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: false }));

    integrateSidebarRightTabs(state);

    // 快照为假 ⇒ 可观测标记，且尚未注册
    expect(channelAttr('sidebar-right')).toBe('snapshot-miss');
    expect(registrations).toEqual([]);
    // 但通道本体已经挂上 ctx.inject，等服务就绪
    expect(injects.map((entry) => entry.deps)).toContainEqual(['sidebarRightTabs']);

    // 服务晚到
    services.set('sidebarRightTabs', {
      register: (definition: { id: string }) => {
        registrations.push(`sidebarRightTabs:${definition.id}`);
        return () => {};
      },
    });
    const entry = injects.find((candidate) => candidate.deps[0] === 'sidebarRightTabs')!;
    entry.fire();

    expect(registrations.length).toBeGreaterThan(0);
    expect(channelAttr('sidebar-right')).toBe('late-registered');
    expect(getChannelState('sidebar-right')).toBe('late-registered');
    expect(useGraphStore.getState().integrationMode).toBe('sidebar-right');
  });

  it('yields instead of double-registering when a better channel already took the seat', () => {
    const { ctx, services, injects, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: false }));
    integrateSidebarRightTabs(state);

    // 另一条通道先占位（模拟顶部标签先落地）
    state.navButtonRegistered = true;

    services.set('sidebarRightTabs', {
      register: (definition: { id: string }) => { registrations.push(`sidebarRightTabs:${definition.id}`); return () => {}; },
    });
    injects.find((entry) => entry.deps[0] === 'sidebarRightTabs')!.fire();

    expect(registrations).toEqual([]);
    expect(channelAttr('sidebar-right')).toBe('yielded');
    expect(state.navButtonRegistered).toBe(true);
  });

  it('does not fabricate a registration when the service never appears', () => {
    const { ctx, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ sidebarRightTabs: false }));

    integrateSidebarRightTabs(state);

    expect(registrations).toEqual([]);
    expect(state.navButtonRegistered).toBe(false);
    expect(channelAttr('sidebar-right')).toBe('snapshot-miss');
  });
});

describe('better-sidebar：快照为假 + 实时探测为假但服务晚到', () => {
  it('re-runs the channel through ctx.inject and registers late', () => {
    const { ctx, services, injects, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ betterSidebar: false }));

    integrateBetterSidebar(state);

    expect(channelAttr('better-sidebar')).toBe('retry-pending');
    expect(registrations).toEqual([]);
    expect(injects.map((entry) => entry.deps)).toContainEqual(['betterSidebar']);

    services.set('betterSidebar', makeBetterSidebar(registrations));
    injects.find((entry) => entry.deps[0] === 'betterSidebar')!.fire();

    expect(registrations).toContain('betterSidebar:codegraph-visualizer');
    expect(channelAttr('better-sidebar')).toBe('late-registered');
    expect(useGraphStore.getState().integrationMode).toBe('better-sidebar');
  });

  it('caps retries instead of looping forever when the service keeps vanishing', () => {
    const { ctx } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ betterSidebar: false }));

    // 模拟「注入回调立即触发、但服务仍读不到」的抖动：重跑会再次登记重试
    for (let attempt = 0; attempt < 6; attempt += 1) integrateBetterSidebar(state);

    expect(getChannelRetryCount('better-sidebar')).toBeGreaterThan(0);
    expect(getChannelRetryCount('better-sidebar')).toBeLessThanOrEqual(3);
  });
});

describe('conversation-view：快照为假但 slots 晚到', () => {
  it('marks unavailable, then registers the top tab once slots is live', () => {
    const { ctx, services, injects, registrations } = makeCtx();
    const state = new IntegrationState(
      ctx,
      // 快照说没有 slots；实时探测也读不到 ⇒ 走「快照为假」分支
      makeFlags({ conversationView: false }),
    );

    integrateConversationView(state);

    expect(state.topTabState).toBe('unavailable');
    expect(channelAttr('conversation-view')).toBe('retry-pending');
    expect(state.navButtonRegistered).toBe(false);

    // slots 就绪后重跑：实时探测为真 ⇒ 走正常注册路径
    services.set('slots', {});
    injects.find((entry) => entry.deps[0] === 'slots')!.fire();

    expect(registrations).toContain('conversation.view');
    expect(state.topTabState).toBe('registered');
    expect(channelAttr('conversation-view')).toBe('late-registered');
    expect(useGraphStore.getState().integrationMode).toBe('conversation-view');
  });

  it('uses the live probe over a stale snapshot even on the first call', () => {
    const { ctx, services, registrations } = makeCtx();
    // 快照为假，但服务此刻其实已经 provide（快照是旧的）
    services.set('slots', {});
    const state = new IntegrationState(ctx, makeFlags({ conversationView: false }));

    integrateConversationView(state);

    expect(registrations).toContain('conversation.view');
    expect(state.topTabState).toBe('registered');
    // 快照为假 ⇒ 记作晚到注册（可观测层要能区分）
    expect(channelAttr('conversation-view')).toBe('late-registered');
  });
});
