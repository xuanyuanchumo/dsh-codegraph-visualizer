import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import { PLUGIN_SLOT_ID } from './integrationIds.ts';

const log = scoped('client');

/** 顶部标签在 `conversation.view` 席位里的排序值（原生「对话」「轨迹」之后）。 */
export const CONVERSATION_VIEW_ORDER = 100;

/**
 * 注册主会话面板**顶部标签栏**同级的「代码图谱」标签。
 *
 * 席位契约（逐行核验自 `@deepseek-ai/dsh-client-ui-conversation`）：
 *   - `lib/types/client/contract/slots.d.ts`：`'conversation.view': { kind: 'list';
 *     scope: 'session'; owner: ConvViewOwnerProps; }`——`list` 型即**可叠加**，
 *     多个注册项会并排成为多个标签，而不是互相遮蔽（对比 `single` 型的 `'root'`，
 *     在那里注册会顶掉整个 AppFrame）。
 *   - `lib/types/client/contract/views.d.ts`：标签是 `conversation.view` 注册项的
 *     投影，`label` 缺席时回落为条目 id。
 *   - 同席位的既有注册者：`dsh-client-ui-chat`（id `chat` → 「对话」）、
 *     `dsh-client-ui-trajectory`（id `trajectory` → 「轨迹」）。本插件是第三个。
 *   - 该席位由 `conversation.session` 条目**声明**，故只在会话面板挂载时才存在；
 *     `ctx.slots.inject` 的回调会在声明就绪后才运行，因此无需自己重试。
 *
 * 两代一致性：`dsh-client-ui-slots` 的 `lib/index.js` 在 gen1（0.1.7-rc.1）与
 * gen2（0.2.0-rc.2）**逐字节相同**（SHA256 57E1314E…，均 23461 B），故这一条注册路径
 * 跨代通用；gen1 另有一条 `ctx.uiConversation.views.register` 旧并行入口，本项目不采用，
 * 因为 slot 才是标签投影的真源（gen1/gen2 的 `dsh-client-ui-conversation` 都用
 * `slots.entries('conversation.view')` 生成标签）。
 *
 * ## 为什么这里先「预留席位」再注入（cycle-110 / T3）
 *
 * 本通道是全链里唯一**异步就绪**的通道，兜底链里的 `SlotsFallback` /
 * `FloatingPanelIntegration` 却是同步占位的。不预留时，兜底会在注入回调跑之前
 * `navButtonRegistered = true`，顶部标签随后仍然注册 ⇒ 同一面板两个入口
 * （`docs/agents/03-客户端API参考.md` §1.2 的优先级链语义被反转）。
 *
 * 预留 + 等待窗口 + 迟到撤回的组合见 `IntegrationState` 的类注释；三态与原因通过
 * `topTabObservability` 写到 `<html data-cg-top-tab>`，供 E2E 与真机排查读取。
 */
export function integrateConversationView(state: IntegrationState): void {
  if (state.navButtonRegistered) return;
  const { ctx } = state;
  // 快照可能是**旧的**：`flags.conversationView` 在 `apply()` 那一刻算出来，
  // 而 `slots` 是硬依赖（`inject = ['slots']`），理论上总在。为兼容「提供者晚到」
  // （cycle-110 / C1 实测的 `better-sidebar pending` 同族现象），这里实时再问一次：
  // `ctx.get(key, false)` 的语义是「已 provide 且未撤回」。
  const snapshot = state.flags.conversationView;
  const liveSlotService = safeCheck(() => {
    const service = ctx.get('slots', false);
    return service !== null && service !== undefined;
  }, false);
  if (!snapshot && !liveSlotService) {
    // 快照与实时探测都说没有（cycle-110 / C1）：**不静默 return**。
    state.markTopTabUnavailable('宿主未提供 conversation.view 席位（slots 快照与实时探测均为假）');
    state.noteSnapshotMiss('conversation-view', 'conversationView');
    // 登记「slots 服务就绪后重跑本通道」——重跑仍走同一条优先级链闸门
    // （预留 → navButtonRegistered），因此不会与已占位的通道打架。
    state.retryWhenAvailable('slots', 'conversation-view', () => integrateConversationView(state));
    return;
  }
  /** 快照为假、实时为真 ⇒ 这次注册属于「晚到」，在可观测层里区分出来。 */
  const lateRegistration = !snapshot;
  if (!state.reserveTopTab()) return;

  /** 一次注册只能定论一次：迟到/重复回调不得覆盖已落地状态。 */
  let settled = false;
  const settle = (failReason?: string): void => {
    if (settled) return;
    settled = true;
    if (failReason === undefined) {
      state.commitTopTab();
      state.markChannel('conversation-view', lateRegistration ? 'late-registered' : 'registered');
      log.info('conversation.view slot registration succeeded');
      return;
    }
    state.failTopTab(failReason);
    state.noteChannelFailed('conversation-view', failReason);
    log.warn('conversation.view slot registration failed', { reason: failReason });
  };

  try {
    const injectDisposer = ctx.slots.inject('conversation.view', () => {
      try {
        const regResult = ctx.slots.register(
          {
            name: 'conversation.view',
            id: PLUGIN_SLOT_ID,
            order: CONVERSATION_VIEW_ORDER,
            label: () => t('nav.title'),
          },
          (props: {
            ctx?: unknown;
            visible?: boolean;
            // 宿主会话 scope 注入的标准 props（asar 实测 renderer.standardProps +
            // ui-session BUILTIN_SOURCE：session scope 组件自动收到这两项）。
            // 结构化消费：缺失/改名都不炸，跟随引擎自行降级（宁缺勿猜）。
            sessionId?: string;
            useSessions?: unknown;
          }) => {
            // 可见性由宿主决定（同一时刻只有一个 view 被渲染），组件只如实转述回 store。
            const visible = props?.visible ?? true;
            state.panelVisible = visible;
            useGraphStore.getState().setPanelVisible(visible);

            return React.createElement(
              'div',
              {
                className: 'cg-conversation-view-wrapper',
                'data-cg-conversation-view': 'true',
                'data-cg-visible': String(visible),
                // 顶层标签的 DOM 证据：即使 `<html data-cg-top-tab>` 被别的脚本覆盖，
                // 面板自己的包装节点仍然证明「这个面板是作为顶部标签渲染的」。
                'data-cg-top-tab': 'instance',
              },
              React.createElement(
                GraphErrorBoundary,
                null,
                React.createElement(GraphPanel, {
                  // 会话跟随（默认工作区 = 对话工作区）：透传宿主会话身份，
                  // GraphPanel 内经 useSessionWorkspaceFollow 消费。
                  sessionId: props?.sessionId,
                  useSessions: props?.useSessions,
                }),
              ),
            );
          },
        );
        // DSH 的 `register` 契约上返回 disposer，但**允许不返回**（历史实现如此，
        // 见 CLAUDE.md「may not return a disposer」）。不返回 ≠ 注册失败：席位条目
        // 已经出现在宿主的注册表里（用户看得见标签），只是我们无权撤回。
        // 因此这里记成功并留下告警，绝不能判失败——判失败会让降级通道再注册一个入口。
        if (typeof regResult !== 'function') {
          log.warn('conversation.view registered without a disposer (seat cannot be withdrawn later)');
        }
        state.trackSlotDisposer(regResult);
        settle();
      } catch (e) {
        settle(`slots.register 抛错: ${errorText(e)}`);
      }
    });

    // `slots.inject` 同样允许不返回 disposer。不返回时无法主动撤销「等待声明」这件事，
    // 但等待窗口（`TOP_TAB_SETTLE_WINDOW_MS`）仍然兜底：窗口到期 ⇒ 降级通道接管。
    // 因此这里只告警，不判失败（判失败会让「其实已经排上队的回调」与降级通道并存）。
    if (typeof injectDisposer !== 'function') {
      log.warn('slots.inject returned no disposer; relying on the settle window');
      return;
    }
    state.trackSlotDisposer(injectDisposer);
  } catch (e) {
    settle(`slots.inject 抛错: ${errorText(e)}`);
  }
}

/** 把未知异常压成一行可读文本，写进状态原因（不能把 Error 对象塞进 DOM 属性）。 */
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return String(e); } catch { return 'unknown error'; }
}
