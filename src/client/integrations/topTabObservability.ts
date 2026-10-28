import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

/**
 * 顶部标签栏「动态注册」的可观测三态（cycle-110 / T3）。
 *
 * ## 为什么需要这一层
 *
 * `conversation.view` 席位的注册是**异步**的：`ctx.slots.inject` 的回调只在席位被
 * 声明之后才运行，而 `apply()` 是同步一次性执行的。于是「注册成功」只发生在控制台
 * 的一行 `log.info` 里——真机出问题时，界面、DOM 和测试都读不到任何证据：
 *
 *   - 注册成功 ⇒ 顶部出现「代码图谱」标签；
 *   - 注册失败 ⇒ 静默回落到侧边栏/页脚按钮，用户与排查者都不知道发生过降级；
 *   - 迟迟不注册 ⇒ 同上，且**没有任何超时判据**。
 *
 * 因此这里把状态写成 DOM 标记（`<html data-cg-top-tab="…">`），并记录一条有界历史，
 * 供 E2E / 组件测试 / 真机 DevTools 直接读取。三个状态与一次降级是：
 *
 * ```
 *  reserved ──(slot register 成功)──────────► registered
 *     │
 *     ├─(register 抛错 / 未返回 disposer)──► failed ──(降级通道占位)──► degraded
 *     └─(等待窗口超时)──────────────────► expired ──(降级通道占位)──► degraded
 * ```
 *
 * `expired` 与 `failed` 的区别很重要：前者是「席位一直没声明」，后者是「注册动作出错」。
 * 真机上两者都表现为「顶部没有标签」，但处置完全不同（等宿主 vs 查契约）。
 *
 * 迟到注册是允许的：等待窗口超时后降级通道先占位，若 `conversation.view` 稍后才声明，
 * 顶部标签仍然注册并把降级席位**撤回**（`withdrawn`），最终收敛到 `registered`。
 */

/** 顶部标签注册状态。`idle` 表示本进程还没尝试过。 */
export type TopTabState =
  | 'idle'
  | 'reserved'
  | 'registered'
  | 'failed'
  | 'expired'
  | 'degraded'
  | 'unavailable'
  | 'withdrawn';

/** 一次状态跃迁的记录。 */
export interface TopTabRecord {
  state: TopTabState;
  /** 人类可读原因；只用于日志/证据，不参与判定。 */
  reason: string;
  /** 触发这次跃迁的通道标识（`conversation-view` / `sidebar-right` / …）。 */
  channel: string;
  /** 相对时间戳（`Date.now()`），便于对齐控制台日志。 */
  at: number;
}

/** DOM 标记的属性名（写在 `document.documentElement` 上）。 */
export const TOP_TAB_ATTR = 'data-cg-top-tab';
/** 状态原因的属性名，排查时不需要再翻日志。 */
export const TOP_TAB_REASON_ATTR = 'data-cg-top-tab-reason';
/** 状态变化时派发的 `CustomEvent` 名（真机 E2E 可监听）。 */
export const TOP_TAB_EVENT = 'codegraph-visualizer/top-tab-state';

/** 历史记录上限：状态机最多 8 次跃迁，留一倍余量即可，不能无限增长。 */
const HISTORY_LIMIT = 32;

let history: TopTabRecord[] = [];
let current: TopTabState = 'idle';

/** 读取当前状态（测试与真机排查入口）。 */
export function getTopTabState(): TopTabState {
  return current;
}

/** 读取状态历史（只读拷贝，避免调用方改内部数组）。 */
export function getTopTabHistory(): readonly TopTabRecord[] {
  return history.slice();
}

/**
 * 记录一次状态跃迁：更新内部状态、写 DOM 标记、派发事件。
 *
 * DOM 写入必须**容错**：本模块也会在 jsdom / SSR / 极简 profile 下被调用，
 * 没有 `document` 时只保留内存历史（函数不抛）。
 */
export function recordTopTab(state: TopTabState, reason: string, channel: string): void {
  current = state;
  const record: TopTabRecord = { state, reason, channel, at: Date.now() };
  history.push(record);
  if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);

  const doc = typeof document === 'undefined' ? null : document;
  if (doc?.documentElement) {
    doc.documentElement.setAttribute(TOP_TAB_ATTR, state);
    doc.documentElement.setAttribute(TOP_TAB_REASON_ATTR, reason);
  }

  // 状态事件与安装/卸载无关：监听方（E2E、诊断脚本）自行决定去留。
  const target = typeof window === 'undefined' ? null : window;
  if (target && typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(TOP_TAB_EVENT, { detail: record }));
  }

  log.info(`top tab state → ${state}`, { reason, channel });
}

/**
 * 重置可观测层。
 *
 * 只清内存与 DOM 标记，**不**清 `documentElement` 之外的任何状态；插件卸载时调用，
 * 避免下一次 `apply()` 读到上一轮的 `registered`（那会让新的等待窗口直接判成功）。
 */
export function resetTopTabObservability(): void {
  history = [];
  current = 'idle';
  const doc = typeof document === 'undefined' ? null : document;
  if (doc?.documentElement) {
    doc.documentElement.removeAttribute(TOP_TAB_ATTR);
    doc.documentElement.removeAttribute(TOP_TAB_REASON_ATTR);
  }
}
