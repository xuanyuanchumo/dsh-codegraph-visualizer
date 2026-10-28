import type { Context } from '@deepseek-ai/cordis';
import type { ClientFeatureFlags } from '../compat/ClientCompatLayer.ts';
import { scoped } from '../../shared/Logger.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';
import {
  recordTopTab, resetTopTabObservability, type TopTabState,
} from './topTabObservability.ts';
import {
  recordChannel, resetChannelProbe, type ChannelName, type ChannelState,
} from './integrationProbe.ts';

const log = scoped('client');

/**
 * 顶部标签的等待窗口（cycle-110 / T3）。
 *
 * `conversation.view` 的声明时机由宿主决定，`apply()` 无法同步得知它会不会来。
 * 极端情况下它会**永远不来**（最小 profile：只装 `@deepseek-ai/dsh-base` + 本插件，
 * 没有任何会话面板）。此时如果只是「预留席位、等回调」，`navButtonRegistered`
 * 会永久为真，所有降级通道（右侧栏 / better-sidebar / 页脚按钮 / 浮动面板）
 * 都会让位，用户**没有任何入口**——这是比双占位更严重的故障。
 *
 * 因此预留必须配一个截止时间：窗口内到达 → 顶部标签；窗口外 → 降级通道先占位，
 * 迟到注册再把降级席位撤回（见 `commitTopTab`）。600ms 的依据：真机首屏里会话
 * 面板的 slot 声明在首个 paint 之后、空闲回调之前完成；同时它足够短，用户不会
 * 感到「点了没反应」。
 */
export const TOP_TAB_SETTLE_WINDOW_MS = 600;

/**
 * 每条通道允许的「服务晚到重试」次数。
 *
 * 重跑的是同一条通道函数；若服务反复消失/出现，无限重试会形成
 * 「inject 回调 → 重跑 → 再登记 inject」的自激循环（回调就绪时会同步触发）。
 */
const MAX_CHANNEL_RETRIES = 3;

/** 各通道已重试次数（模块级，便于诊断脚本读取；`--` 与实例生命周期无关）。 */
const retryCounters = new Map<ChannelName, number>();

/** 读取某通道的重试次数（诊断用）。 */
export function getChannelRetryCount(channel: ChannelName): number {
  return retryCounters.get(channel) ?? 0;
}

/** 集成通道标识（与 `setIntegrationMode` 的取值同名，便于交叉印证）。 */
export type IntegrationChannel =
  | 'conversation-view' | 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating' | 'pipeline';

/**
 * 集成期的可变状态与清理台账。
 *
 * 所有集成函数共享同一个实例：它们会互相看 `navButtonRegistered` 之类的「已经装好了」
 * 标记，避免同一席位被注册两次（DSH 的 slot / tab 注册表对重复 id 是**抛错**语义，
 * 不是覆盖语义 —— 见 `dsh-client-ui-sidebar-right/lib/client.js:8690` 的
 * `if (this.ids.has(id)) throw new Error(...)`）。
 *
 * ## 席位预留（cycle-110 / T3 新增）
 *
 * 优先级链第 1 通道（`conversation.view` 顶部标签）是**异步**注册的，而第 2~5 通道里
 * 有同步注册的。若不做任何事，同步通道会在 `apply()` 期间就 `navButtonRegistered = true`，
 * 随后顶部标签的回调再注册一次 —— 同一面板出现两个入口（顶部标签 + 页脚按钮），
 * 而优先级链的语义本应是「顶部优先，其余让位」。
 *
 * 三种手段共同保证「互斥且不丢入口」：
 *   1. `reserveTopTab()` 同步预留席位（其余通道让位并**排队**，不是丢弃）；
 *   2. `TOP_TAB_SETTLE_WINDOW_MS` 到期仍未注册 ⇒ `expireTopTab()` 释放预留并回放队列；
 *   3. `commitTopTab()` 在迟到注册时把已占位的降级席位**撤回**（`noteFallbackSeat`）。
 *
 * 清理走两条台账：
 *   - `slotDisposers` —— slot/tab 注册返回的 disposer，先清（它们持有 DOM 席位）；
 *   - `allDisposers`  —— 其余 disposer（状态订阅等），后清。
 * 两条都在构造器注册的 `ctx.effect` 里按「先 slot 后其余」的顺序释放，并把数组清空，
 * 使重复调用成为幂等操作。
 *
 * 历史：本类曾有 `remoteWebUiApi` / `remoteWebUiPanelId` / `openRemoteWebUiPanel()` 三个
 * 成员，服务于一个名为 `remoteWebUI` 的服务。cycle-83 逐条核验后确认该服务在任何 DSH
 * 代与本机全部已装插件中都不存在（幻影），已删除。
 */
export class IntegrationState {
  panelVisible = false;
  navButtonRegistered = false;
  betterSidebarApi: Context['betterSidebar'] | undefined;
  betterSidebarTabId: string | undefined;
  slotDisposers: Array<() => void> = [];
  renderFloating: () => void = () => {};

  /** 顶部标签注册状态（与 `topTabObservability` 写出的 DOM 标记同源）。 */
  topTabState: TopTabState = 'idle';

  private allDisposers: Array<() => void> = [];
  /** 顶部标签是否处于「已预留、尚未定论」窗口内。 */
  private topTabReserved = false;
  /** 因顶部标签预留而排队等待的降级通道（按调用顺序保存，回放顺序即优先级）。 */
  private deferredChannels: Array<() => void> = [];
  /** 当前占位的降级席位撤回器；顶部标签迟到注册时逐个执行。 */
  private fallbackSeatDisposers: Array<() => void> = [];
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 每条通道已重试次数（实例级；模块级 `retryCounters` 只用于诊断读取）。 */
  private channelRetries = new Map<ChannelName, number>();

  constructor(
    public ctx: Context,
    public flags: ClientFeatureFlags,
  ) {
    ctx.effect(() => () => {
      this.clearSettleTimer();
      this.deferredChannels.length = 0;
      this.fallbackSeatDisposers.length = 0;
      for (const dispose of this.slotDisposers) dispose();
      this.slotDisposers.length = 0;
      for (const dispose of this.allDisposers) {
        try { dispose(); } catch { /* 单个 disposer 失败不应阻断其余释放 */ }
      }
      this.allDisposers.length = 0;
      this.topTabReserved = false;
      resetTopTabObservability();
      resetChannelProbe();
    }, 'codegraph: slot registrations cleanup');
  }

  trackSlotDisposer(d: (() => void) | void): void {
    if (typeof d === 'function') this.slotDisposers.push(d);
  }

  trackDisposer(d: (() => void) | void): void {
    if (typeof d === 'function') this.allDisposers.push(d);
  }

  get sidebarStateDisposer(): (() => void) | undefined {
    return this._sidebarStateDisposer;
  }
  set sidebarStateDisposer(d: (() => void) | undefined) {
    this._sidebarStateDisposer = d;
    if (d) this.allDisposers.push(d);
  }
  private _sidebarStateDisposer: (() => void) | undefined;

  // ---- 席位预留与顶部标签状态机 -------------------------------------------

  /** 顶部标签是否仍在等待窗口内（降级通道据此排队而不是丢弃）。 */
  get topTabPending(): boolean {
    return this.topTabReserved;
  }

  /**
   * 同步预留顶部标签席位。
   *
   * @returns `true` 表示本次调用成功占住预留；`false` 表示已被其它通道占位或已注册。
   */
  reserveTopTab(windowMs: number = TOP_TAB_SETTLE_WINDOW_MS): boolean {
    if (this.topTabReserved || this.topTabState === 'registered') return false;
    if (this.navButtonRegistered) return false;
    this.topTabReserved = true;
    // 预留即占位：同步通道看到 `navButtonRegistered` 为真后不会再注册第二个入口。
    this.navButtonRegistered = true;
    this.topTabState = 'reserved';
    recordTopTab('reserved', 'conversation.view 席位声明等待中', 'conversation-view');
    this.scheduleSettleDeadline(windowMs);
    return true;
  }

  /** 顶部标签注册成功（可能发生在等待窗口之后，此时要撤回已占位的降级席位）。 */
  commitTopTab(): void {
    this.clearSettleTimer();
    this.topTabReserved = false;
    this.navButtonRegistered = true;
    this.topTabState = 'registered';
    recordTopTab('registered', 'conversation.view 注册成功', 'conversation-view');
    this.withdrawFallbackSeats();
  }

  /** 顶部标签注册失败（`slots.register` 抛错 / 未返回 disposer / `inject` 本身失败）。 */
  failTopTab(reason: string): void {
    if (this.topTabState === 'registered') return;
    this.clearSettleTimer();
    const wasReserved = this.topTabReserved;
    this.topTabReserved = false;
    this.topTabState = 'failed';
    recordTopTab('failed', reason, 'conversation-view');
    if (wasReserved) this.navButtonRegistered = false;
    this.flushDeferredChannels();
  }

  /** 等待窗口到期：席位声明一直没来，释放预留并让降级通道接管。 */
  expireTopTab(reason = `等待窗口 ${TOP_TAB_SETTLE_WINDOW_MS}ms 内未收到 conversation.view 声明`): void {
    if (!this.topTabReserved) return;
    this.clearSettleTimer();
    this.topTabReserved = false;
    this.topTabState = 'expired';
    recordTopTab('expired', reason, 'conversation-view');
    this.navButtonRegistered = false;
    this.flushDeferredChannels();
  }

  /**
   * 若顶部标签仍在预留窗口内，则把该降级通道**推迟**到窗口结束再决定。
   *
   * @returns `true` 表示已推迟（调用方应立即 return，不要注册）。
   */
  deferIfTopTabPending(run: () => void, channel: IntegrationChannel): boolean {
    if (!this.topTabReserved) return false;
    this.deferredChannels.push(run);
    log.info('integration channel deferred behind top-tab reservation', { channel });
    return true;
  }

  /**
   * 登记「某个降级通道已经占住席位，以及如何撤回它」。
   *
   * 顶部标签迟到注册时，`commitTopTab()` 会执行这些撤回器，把重复入口收掉。
   */
  noteFallbackSeat(dispose: () => void, channel: IntegrationChannel): void {
    this.fallbackSeatDisposers.push(dispose);
    log.info('fallback seat claimed', { channel, seats: this.fallbackSeatDisposers.length });
  }

  /** 记录集成模式，并在「顶部标签已失败/超时」时把状态推进到 `degraded`。 */
  markChannel(channel: Exclude<IntegrationChannel, 'pipeline'>, state?: ChannelState): void {
    useGraphStore.getState().setIntegrationMode(channel);
    recordChannel(channel as ChannelName, state ?? 'registered', '通道占位成功');
    if (this.topTabState === 'failed' || this.topTabState === 'expired') {
      this.topTabState = 'degraded';
      recordTopTab('degraded', '降级通道占位成功', channel);
    }
  }

  /**
   * 快照为假（cycle-110 / C1）。
   *
   * 快照只说明「`apply()` 那一刻读不到」，**不说明以后也读不到**。因此这里绝不
   * 静默 return，而是写一条可观测的 `snapshot-miss` 记录，并由调用方接着登记重试。
   */
  noteSnapshotMiss(channel: ChannelName, flag: string): void {
    recordChannel(channel, 'snapshot-miss', `集成快照 ${flag} 为假（提供者可能尚未就绪）`);
    log.warn('integration snapshot miss; scheduling retry', { channel, flag });
  }

  /** 通道主动让位（席位已被更高优先级通道占住）。 */
  noteChannelYielded(channel: ChannelName, reason: string): void {
    recordChannel(channel, 'yielded', reason);
  }

  /** 通道注册抛错。 */
  noteChannelFailed(channel: ChannelName, reason: string): void {
    recordChannel(channel, 'failed', reason);
  }

  /**
   * 服务晚到时重跑某条通道（cycle-110 / C1）。
   *
   * 用 `ctx.inject([serviceKey], …)` 作为**响应式触发器**，回调里重跑的是同一条通道函数，
   * 因此它仍然经过同一条优先级链的闸门（顶部标签预留 → `navButtonRegistered`）：
   * 更好的通道已经占位时它会 `yielded`，不会造成双入口或优先级反转。
   *
   * `ctx.inject` 返回的是 Fiber（不是 disposer），随父 fiber 自动释放，故不做 disposer 登记。
   */
  retryWhenAvailable(serviceKey: string, channel: ChannelName, run: () => void): void {
    // 每条通道最多重试 `MAX_CHANNEL_RETRIES` 次：
    // 重跑的是同一条通道函数，若服务反复消失/出现，没有上限就会形成
    // 「inject 回调 → 重跑 → 再登记 inject」的自激循环（回调立即触发时是同步递归）。
    const attempts = (this.channelRetries.get(channel) ?? 0) + 1;
    if (attempts > MAX_CHANNEL_RETRIES) {
      this.noteChannelFailed(channel, `重试超过 ${MAX_CHANNEL_RETRIES} 次仍未注册成功`);
      return;
    }
    this.channelRetries.set(channel, attempts);
    retryCounters.set(channel, attempts);
    try {
      recordChannel(channel, 'retry-pending', `等待服务 ${serviceKey} 就绪后重跑 ${channel}（第 ${attempts} 次）`);
      this.ctx.inject([serviceKey], () => {
        log.info('integration service became available; re-running channel', { channel, serviceKey, attempt: attempts });
        run();
      });
    } catch (e) {
      this.noteChannelFailed(channel, `ctx.inject(${serviceKey}) 抛错: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 宿主不提供 `conversation.view` 席位（`slots` 服务缺失 / 最小 profile）。
   *
   * 这条也必须**写状态**而不是只写一行日志：否则「宿主根本没法给顶部标签」
   * 与「插件还没尝试」在 DOM 上完全一样，真机排查时无法区分（`idle` vs `unavailable`）。
   */
  markTopTabUnavailable(reason: string): void {
    if (this.topTabState === 'registered') return;
    this.topTabState = 'unavailable';
    recordTopTab('unavailable', reason, 'conversation-view');
  }

  // ---- 内部 ---------------------------------------------------------------

  private scheduleSettleDeadline(windowMs: number): void {
    this.clearSettleTimer();
    if (!Number.isFinite(windowMs) || windowMs <= 0) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.expireTopTab(`等待窗口 ${windowMs}ms 内未收到 conversation.view 声明`);
    }, windowMs);
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private flushDeferredChannels(): void {
    const queue = this.deferredChannels.splice(0);
    for (const run of queue) {
      try { run(); } catch (e) { log.warn('deferred integration channel failed', e); }
    }
  }

  private withdrawFallbackSeats(): void {
    if (this.fallbackSeatDisposers.length === 0) return;
    const seats = this.fallbackSeatDisposers.splice(0);
    for (const dispose of seats) {
      try { dispose(); } catch (e) { log.warn('fallback seat withdrawal failed', e); }
    }
    // 撤回后顶部标签是唯一入口：状态收敛回 registered（withdrawn 只作为历史留痕）。
    recordTopTab('withdrawn', '降级席位已撤回（顶部标签迟到注册）', 'pipeline');
    this.navButtonRegistered = true;
    this.topTabState = 'registered';
    recordTopTab('registered', '顶部标签成为唯一入口', 'conversation-view');
  }

  /** 让 `dsh-better-sidebar` 打开（或激活）本插件的 tab。无该服务时是空操作。 */
  openSidebarTab(): void {
    if (this.betterSidebarApi) {
      try {
        this.betterSidebarApi.openTab({ type: PLUGIN_TAB_KIND });
      } catch (e) {
        log.warn('betterSidebar.openTab failed', e);
      }
    }
  }

  /**
   * 切换图表面板的可见性。
   *
   * 三条路径按可用性降级：better-sidebar 的 tab → 插件自绘的浮动容器。
   * `panelVisible` 只描述**浮动容器**那条路径的状态；由宿主托管的席位
   * （conversation.view / sidebar-right / better-sidebar）的可见性由宿主自己决定，
   * 并通过 `setPanelVisible` 回灌进 store。
   */
  togglePanel(): void {
    if (this.panelVisible) {
      this.panelVisible = false;
      const container = document.querySelector('.cg-floating-container');
      if (container) container.setAttribute('data-visible', 'false');
      this.renderFloating();
      return;
    }
    if (this.betterSidebarApi) { this.openSidebarTab(); return; }
    this.panelVisible = true;
    const container = document.querySelector('.cg-floating-container');
    if (container) container.setAttribute('data-visible', 'true');
    this.renderFloating();
  }
}
