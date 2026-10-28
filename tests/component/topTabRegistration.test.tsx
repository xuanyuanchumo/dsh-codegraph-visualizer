/**
 * @vitest-environment jsdom
 *
 * 顶部标签 `conversation.view` 的动态注册契约（cycle-110 / T3）。
 *
 * ## 为什么需要这组用例
 *
 * 优先级链的第 1 通道是**异步**的（`ctx.slots.inject` 的回调要等席位声明），
 * 而第 4/5 通道是**同步**占位的。改动前，「顶部标签」与「页脚按钮」会同时注册：
 * 同一个面板两个入口，而 `docs/agents/03-客户端API参考.md` §1.2 的语义是
 * 「先注册者占位，后续通道让位」。这个缺陷在真机上的表现只是「页脚多了一个按钮」，
 * 没有任何测试会变红——所以这里把三态写成可断言的 DOM 标记，并逐个钉住：
 *
 *   1. 预留（reserved）→ 注册成功（registered）
 *   2. 注册抛错（failed）→ 降级通道占位（degraded）
 *   3. 等待窗口超时（expired）→ 降级通道占位 → 顶部标签迟到注册（registered + 撤回降级席位）
 *
 * 第 3 条是最容易做反的一条：**只预留不超时**会让最小 profile（没有会话面板）下
 * 所有降级通道永久让位，用户一个入口都没有。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';

import { IntegrationState, TOP_TAB_SETTLE_WINDOW_MS } from '../../src/client/integrations/IntegrationState.ts';
import { integrateConversationView, CONVERSATION_VIEW_ORDER } from '../../src/client/integrations/ConversationViewIntegration.ts';
import { integrateSlotsFallback } from '../../src/client/integrations/SlotsFallback.ts';
import { integrateFloatingPanel } from '../../src/client/integrations/FloatingPanelIntegration.ts';
import { PLUGIN_SLOT_ID, PLUGIN_TAB_KIND } from '../../src/client/integrations/integrationIds.ts';
import {
  getTopTabHistory, getTopTabState, resetTopTabObservability, TOP_TAB_ATTR,
} from '../../src/client/integrations/topTabObservability.ts';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import type { ClientFeatureFlags } from '../../src/client/compat/ClientCompatLayer.ts';
import { zh } from '../../src/client/i18n/dicts/zh.ts';
import { en } from '../../src/client/i18n/dicts/en.ts';

/** 席位注册记录（每个用例断言「注册了什么、注册了几次」）。 */
interface Registration {
  seat: string;
  definition: Record<string, unknown>;
  body: unknown;
  disposed: boolean;
}

/**
 * 造一个最小 ctx。
 *
 * `autoDeclareSeats` 为真的席位会**同步**执行注入回调（模拟宿主已就绪）；
 * 为空则把回调存进 `pendingSeatCallbacks`，由用例决定何时"声明"（模拟异步/迟到）。
 */
function makeCtx(options: { declareSeats?: string[]; throwSeats?: string[] } = {}) {
  const registrations: Registration[] = [];
  const pendingSeatCallbacks = new Map<string, () => void>();
  // 默认：页脚席位**同步可用**（这是兜底通道真实的工作条件），`conversation.view`
  // 默认异步（要等会话面板声明）——两者正好构成要守的那个优先级反转。
  const declareSeats = new Set(options.declareSeats ?? ['sidebar.footer.action', 'sidebar.right.pane.tab']);
  /** 只让**指定席位**的注册抛错：全局抛错会让「降级通道接管」永远无法发生，
   *  那样测出来的只是「全都坏了」，而不是「顶部标签坏了、兜底还在」。 */
  const throwSeats = new Set(options.throwSeats ?? []);

  const register = (definition: Record<string, unknown>, body: unknown) => {
    const seat = String(definition.name ?? '');
    if (throwSeats.has(seat)) throw new Error(`duplicate id rejected by host: ${seat}`);
    const registration: Registration = { seat, definition, body, disposed: false };
    registrations.push(registration);
    return () => { registration.disposed = true; };
  };

  const injectSlot = (seat: string, callback: () => void) => {
    if (declareSeats.has(seat)) callback();
    else pendingSeatCallbacks.set(seat, callback);
    return () => { pendingSeatCallbacks.delete(seat); };
  };

  const ctx = {
    slots: { register, inject: injectSlot },
    get: () => undefined,
    inject: () => ({ dispose: () => {} }),
    effect: () => () => {},
  };
  return { ctx: ctx as unknown as Context, registrations, pendingSeatCallbacks };
}

function makeFlags(overrides: Partial<ClientFeatureFlags> = {}): ClientFeatureFlags {
  return {
    sidebarRightTabs: false,
    betterSidebar: false,
    slots: true,
    conversationView: true,
    commandUi: false,
    desktopPlatform: false,
    remoteNarrow: false,
    ...overrides,
  };
}

const htmlState = () => document.documentElement.getAttribute(TOP_TAB_ATTR);

beforeEach(() => {
  resetTopTabObservability();
  resetI18nListeners();
  setLang('zh');
  useGraphStore.getState().setIntegrationMode('floating');
  // jsdom 的 document 在同一文件的用例之间共享：浮动兜底会创建 `.cg-floating-container`
  // 而清理走的是构造器注册的 ctx.effect（本文件的假 ctx 不自动执行）。上一轮残留会让
  // 「这个通道有没有注册」的断言变成「上个用例有没有留垃圾」。
  document.querySelectorAll('.cg-floating-container').forEach((el) => el.remove());
});

afterEach(() => {
  vi.useRealTimers();
  resetTopTabObservability();
  document.querySelectorAll('.cg-floating-container').forEach((el) => el.remove());
});

describe('conversation.view 三态可观测', () => {
  it('预留席位后状态为 reserved，并写进 <html data-cg-top-tab>', () => {
    const { ctx } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);

    expect(state.topTabState).toBe('reserved');
    expect(state.navButtonRegistered).toBe(true);
    expect(htmlState()).toBe('reserved');
    // 预留期间不动集成模式：此时还没有任何一个入口真正落地。
    expect(useGraphStore.getState().integrationMode).not.toBe('conversation-view');
  });

  it('席位声明后注册成功：状态 registered，slot id / order / label 全部符合契约', () => {
    const { ctx, pendingSeatCallbacks, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());
    integrateConversationView(state);

    pendingSeatCallbacks.get('conversation.view')?.();

    expect(state.topTabState).toBe('registered');
    expect(htmlState()).toBe('registered');
    expect(useGraphStore.getState().integrationMode).toBe('conversation-view');

    const reg = registrations.find((r) => r.seat === 'conversation.view');
    expect(reg).toBeDefined();
    expect(reg!.definition.id).toBe(PLUGIN_SLOT_ID);
    expect(reg!.definition.order).toBe(CONVERSATION_VIEW_ORDER);
    expect(reg!.definition.order).toBe(100);
    // label 是函数（语言热切换），不是一次性字符串
    const label = reg!.definition.label as () => string;
    expect(typeof label).toBe('function');
    expect(label()).toBe(zh['nav.title']);
    setLang('en');
    expect(label()).toBe(en['nav.title']);
    // 与同席位的既有注册者（chat / trajectory）不撞车
    expect(PLUGIN_SLOT_ID).not.toBe('chat');
    expect(PLUGIN_SLOT_ID).not.toBe('trajectory');
  });

  it('注册抛错时记为 failed，并把队列里的降级通道放出来（互斥且不丢入口）', () => {
    const { ctx, pendingSeatCallbacks, registrations } = makeCtx({ throwSeats: ['conversation.view'] });
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    // index.ts 的真实调用顺序：其余通道排在顶部标签之后
    integrateSlotsFallback(state);
    // 预留期内页脚按钮必须**排队**而不是注册
    expect(registrations.some((r) => r.seat === 'sidebar.footer.action')).toBe(false);

    pendingSeatCallbacks.get('conversation.view')?.();

    expect(state.topTabState).toBe('degraded');
    expect(htmlState()).toBe('degraded');
    expect(useGraphStore.getState().integrationMode).toBe('slot');
    const footer = registrations.filter((r) => r.seat === 'sidebar.footer.action');
    expect(footer).toHaveLength(1);
    expect(footer[0]!.definition.id).toBe(PLUGIN_TAB_KIND);
    // 历史里同时留下失败与降级两条记录：真机排查时能区分「注册出错」与「一直没声明」
    const states = getTopTabHistory().map((r) => r.state);
    expect(states).toContain('failed');
    expect(states).toContain('degraded');
  });
});

describe('conversation.view 等待窗口（最小 profile 不丢入口）', () => {
  it('窗口到期未声明 ⇒ expired，降级通道接管，状态降级为 degraded', () => {
    vi.useFakeTimers();
    const { ctx, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    integrateSlotsFallback(state);
    expect(registrations).toHaveLength(0);

    vi.advanceTimersByTime(TOP_TAB_SETTLE_WINDOW_MS);

    expect(state.topTabState).toBe('degraded');
    expect(htmlState()).toBe('degraded');
    expect(registrations.map((r) => r.seat)).toContain('sidebar.footer.action');
    expect(useGraphStore.getState().integrationMode).toBe('slot');
  });

  it('窗口到期后浮层兜底也能接管（没有 slots 的家庭也用得上面板）', () => {
    vi.useFakeTimers();
    const { ctx } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    integrateFloatingPanel(state);
    vi.advanceTimersByTime(TOP_TAB_SETTLE_WINDOW_MS);

    expect(document.querySelector('.cg-floating-container')).not.toBeNull();
    expect(state.topTabState).toBe('degraded');
    expect(useGraphStore.getState().integrationMode).toBe('floating');
  });

  it('超时之后顶部标签迟到注册 ⇒ 收敛回 registered，并撤回已占位的降级席位', () => {
    vi.useFakeTimers();
    const { ctx, registrations, pendingSeatCallbacks } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    integrateSlotsFallback(state);
    vi.advanceTimersByTime(TOP_TAB_SETTLE_WINDOW_MS);

    const footerBefore = registrations.filter((r) => r.seat === 'sidebar.footer.action');
    expect(footerBefore).toHaveLength(1);
    expect(footerBefore[0]!.disposed).toBe(false);

    // 宿主终于声明了席位
    pendingSeatCallbacks.get('conversation.view')?.();

    expect(state.topTabState).toBe('registered');
    expect(htmlState()).toBe('registered');
    expect(useGraphStore.getState().integrationMode).toBe('conversation-view');
    // 降级席位被撤回：同一面板不允许两个入口
    expect(footerBefore[0]!.disposed).toBe(true);
    expect(getTopTabHistory().map((r) => r.state)).toContain('withdrawn');
  });

  it('已注册后重复调用不再注册第二个入口（幂等）', () => {
    const { ctx, pendingSeatCallbacks, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    pendingSeatCallbacks.get('conversation.view')?.();
    // 再跑一遍完整优先级链
    integrateConversationView(state);
    integrateSlotsFallback(state);
    integrateFloatingPanel(state);

    expect(registrations.filter((r) => r.seat === 'conversation.view')).toHaveLength(1);
    expect(registrations.filter((r) => r.seat === 'sidebar.footer.action')).toHaveLength(0);
    expect(document.querySelector('.cg-floating-container')).toBeNull();
    expect(useGraphStore.getState().integrationMode).toBe('conversation-view');
  });
});

describe('conversation.view 不可用时的降级', () => {
  it('宿主没有该席位 ⇒ unavailable，且不预留（同步通道可立刻占位）', () => {
    const { ctx, registrations } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags({ conversationView: false }));

    integrateConversationView(state);
    integrateSlotsFallback(state);

    expect(state.topTabState).toBe('unavailable');
    expect(htmlState()).toBe('unavailable');
    expect(state.navButtonRegistered).toBe(true);
    // 没有预留 ⇒ 页脚按钮同步注册，不需要等 600ms
    expect(registrations.map((r) => r.seat)).toContain('sidebar.footer.action');
    expect(getTopTabState()).toBe('unavailable');
  });

  it('注册成功但未返回 disposer 仍算成功（席位已存在，只是无法撤回）', () => {
    const { ctx } = makeCtx();
    const state = new IntegrationState(ctx, makeFlags());
    // 抹掉 register 的返回值（DSH 历史实现允许不返回 disposer）
    const slots = ctx.slots as unknown as { register: () => undefined; inject: (seat: string, cb: () => void) => () => void };
    const originalInject = slots.inject;
    slots.register = () => undefined;
    let fired = false;
    slots.inject = (seat: string, cb: () => void) => {
      if (seat === 'conversation.view') { fired = true; cb(); }
      return originalInject(seat, cb);
    };

    integrateConversationView(state);

    expect(fired).toBe(true);
    expect(state.topTabState).toBe('registered');
    expect(htmlState()).toBe('registered');
    // 没有 disposer 就不该把它塞进台账（否则卸载时会调用 undefined）
    expect(state.slotDisposers.every((d) => typeof d === 'function')).toBe(true);
    expect(useGraphStore.getState().integrationMode).toBe('conversation-view');
  });

  it('slots.inject 未返回 disposer 时不判失败，靠等待窗口兜底降级', () => {
    vi.useFakeTimers();
    const { ctx, registrations } = makeCtx();
    // 只让 conversation.view 的 inject 不返回 disposer（宿主契约不符），
    // 其余席位保持真实行为 —— 否则测出来的只是「全都坏了」。
    const slots = ctx.slots as unknown as { inject: (seat: string, cb: () => void) => undefined | (() => void) };
    const originalInject = slots.inject;
    slots.inject = (seat: string, cb: () => void) => {
      if (seat === 'conversation.view') { cb(); return undefined; }
      return originalInject(seat, cb);
    };
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    // 回调已跑但 register 也没返回 disposer？—— 本用例的 register 正常，故已直接成功
    expect(state.topTabState).toBe('registered');

    // 换个场景：席位一直不声明且 inject 不返回 disposer ⇒ 等待窗口兜底
    const second = makeCtx();
    const secondSlots = second.ctx.slots as unknown as { inject: (seat: string, cb: () => void) => undefined | (() => void) };
    const secondOriginal = secondSlots.inject;
    secondSlots.inject = (seat: string, cb: () => void) => (seat === 'conversation.view' ? undefined : secondOriginal(seat, cb));
    const state2 = new IntegrationState(second.ctx, makeFlags());
    integrateConversationView(state2);
    expect(state2.topTabState).toBe('reserved');

    integrateSlotsFallback(state2);
    expect(second.registrations.map((r) => r.seat)).not.toContain('sidebar.footer.action');

    vi.advanceTimersByTime(TOP_TAB_SETTLE_WINDOW_MS);

    // 窗口到期 ⇒ 释放预留 + 回放排队通道，用户仍有入口
    expect(state2.topTabState).toBe('degraded');
    expect(second.registrations.map((r) => r.seat)).toContain('sidebar.footer.action');
    expect(registrations.length).toBeGreaterThan(0);
  });

  it('卸载时清掉等待窗口与 DOM 标记，避免下一轮误判为已注册', () => {
    vi.useFakeTimers();
    const { ctx } = makeCtx();
    // IntegrationState 的清理走 ctx.effect 注册的 disposer，这里手动捕获
    let cleanup: (() => void) | undefined;
    (ctx as unknown as { effect: (fn: () => () => void) => void }).effect = (fn) => { cleanup = fn(); };
    const state = new IntegrationState(ctx, makeFlags());

    integrateConversationView(state);
    expect(htmlState()).toBe('reserved');

    cleanup?.();

    expect(htmlState()).toBeNull();
    expect(getTopTabState()).toBe('idle');
    // 定时器被清掉：推进时间不应再产生状态跃迁
    const before = getTopTabHistory().length;
    vi.advanceTimersByTime(TOP_TAB_SETTLE_WINDOW_MS * 2);
    expect(getTopTabHistory().length).toBe(before);
    expect(state.topTabState).toBe('reserved');
  });
});
