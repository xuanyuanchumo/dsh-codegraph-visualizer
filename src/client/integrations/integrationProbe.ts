import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

/**
 * 集成通道的「快照 vs 现实」可观测层（cycle-110 / C1）。
 *
 * ## 缺陷形态
 *
 * `apply()` 是**同步一次性**执行的，而各集成通道用 `compat.detectFlags()` 那一刻的快照
 * 决定「这条通道整轮要不要注册」：
 *
 * ```ts
 * if (!state.flags.sidebarRightTabs) return;   // ← 快照说没有服务，永远不等于「以后也没有」
 * ```
 *
 * `ctx.get(name, false)` 的语义是「**已被 provide 且未被撤回**」，它读不到
 * 「提供者 fiber 还在 loading」的服务（`cordis/lib/index.js:763-772`）。真机实测
 * `better-sidebar pending` 证明提供者晚到是**常态**而不是异常。于是快照为假时：
 *
 *   - 整条通道被静默跳过（**没有任何错误**，只有一行日志可能看出）；
 *   - 用户少了一个入口，且没有任何 DOM/事件证据能证明「曾经尝试过」。
 *
 * CLAUDE.md 早已记过同形教训：「A capability snapshot that gates an integration is a
 * one-instant-decides-forever defect amplifier」。
 *
 * ## 但也不能无脑改成 `ctx.inject`
 *
 * 同一份 CLAUDE.md 的另一条明确：互斥通道必须留在**同步优先级链**里，异步注入会造成
 * 优先级反转（兜底通道先同步占位，更好的通道反而拿不到入口）。所以本轮的修法是
 * **保留同步占位 + 把快照为假变可观测 + 允许服务晚到时重试**：
 *
 * ```
 * 快照为真 ⇒ 同步/注入路径照旧（registered）
 * 快照为假 ⇒ 写 snapshot-miss 标记，然后登记一次「服务出现就重跑本通道」的重试
 *             重试仍然走同一条优先级链的闸门（预留 → navButtonRegistered），
 *             因此不会抢走已被更高优先级通道占住的席位（late-registered / yielded）
 * ```
 *
 * 标记写在 `<html data-cg-channel-<id>="…">` 上，事件名
 * `codegraph-visualizer/integration-channel`。真机排查顺序：先读这个属性，
 * 再怀疑注册代码——「没注册上」和「注册了但被切掉」是两回事。
 */

/** 集成通道 id（与集成模式同名，便于交叉印证）。 */
export type ChannelName =
  | 'conversation-view' | 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating';

/** 通道状态。 */
export type ChannelState =
  /** 快照为假：本轮**没有**注册该通道（可观测的降级起点）。 */
  | 'snapshot-miss'
  /** 已登记「服务出现后重跑」的重试，尚未落地。 */
  | 'retry-pending'
  /** 快照为真且注册成功。 */
  | 'registered'
  /** 快照为假，但服务晚到后注册成功（本轮修复的目标形态）。 */
  | 'late-registered'
  /** 到达时席位已被更高优先级的通道占住，本通道主动让位（正常，不是故障）。 */
  | 'yielded'
  /** 注册动作抛错。 */
  | 'failed';

/** 一次状态记录。 */
export interface ChannelRecord {
  channel: ChannelName;
  state: ChannelState;
  reason: string;
  at: number;
}

/** DOM 属性前缀：`<html data-cg-channel-sidebar-right="late-registered">`。 */
export const CHANNEL_ATTR_PREFIX = 'data-cg-channel-';
/** 状态变化事件名。 */
export const CHANNEL_EVENT = 'codegraph-visualizer/integration-channel';
/** 有界历史上限：5 条通道 × 5 次跃迁足够排查。 */
const HISTORY_LIMIT = 40;

let history: ChannelRecord[] = [];
const current = new Map<ChannelName, ChannelState>();

/** 读取某通道的当前状态（未出现过则 `undefined`）。 */
export function getChannelState(channel: ChannelName): ChannelState | undefined {
  return current.get(channel);
}

/** 读取历史（只读拷贝）。 */
export function getChannelHistory(channel?: ChannelName): readonly ChannelRecord[] {
  const all = history.slice();
  return channel ? all.filter((record) => record.channel === channel) : all;
}

/**
 * 记录一次通道状态跃迁。
 *
 * DOM 写入容错（jsdom / SSR / 无 document 时只保留内存历史），函数不抛。
 */
export function recordChannel(channel: ChannelName, state: ChannelState, reason: string): void {
  current.set(channel, state);
  const record: ChannelRecord = { channel, state, reason, at: Date.now() };
  history.push(record);
  if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);

  const doc = typeof document === 'undefined' ? null : document;
  if (doc?.documentElement) {
    doc.documentElement.setAttribute(`${CHANNEL_ATTR_PREFIX}${channel}`, state);
  }

  const target = typeof window === 'undefined' ? null : window;
  if (target && typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(CHANNEL_EVENT, { detail: record }));
  }

  log.info(`integration channel ${channel} → ${state}`, { reason });
}

/** 重置可观测层（插件卸载时调用，避免下一轮读到上一轮的 late-registered）。 */
export function resetChannelProbe(): void {
  history = [];
  current.clear();
  const doc = typeof document === 'undefined' ? null : document;
  if (!doc?.documentElement) return;
  for (const channel of ['conversation-view', 'sidebar-right', 'better-sidebar', 'slot', 'floating'] as ChannelName[]) {
    doc.documentElement.removeAttribute(`${CHANNEL_ATTR_PREFIX}${channel}`);
  }
}
