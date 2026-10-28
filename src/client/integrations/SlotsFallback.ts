import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { SidebarNavButton } from '../components/FloatingUI.tsx';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';

const log = scoped('client');

/**
 * 席位兜底通道：当 `conversation.view` 与两个右侧栏服务都不可用时，退到左侧栏底部的
 * 一个动作按钮（`sidebar.footer.action`）。
 *
 * 席位契约（核验自 `@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`）：
 * `'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps; }`
 * ——`list` 型可叠加，因此与第三方插件**共处**是设计内的行为，不是冲突。
 *
 * 已知的同席位邻居：`@linxin666/dsh-remote-web-ui` v0.4.4 也在
 * `lib/client.js:5552` 注册同一席位（它用于移动端配对入口）。两者都是 `list` 型条目，
 * 会并排出现；本插件不假设自己是唯一占用者，也不做任何抢占。
 *
 * `order: 10` 让它排在该席位的靠前位置；`scope: 'root'` 表示按钮在所有会话之外常驻。
 */
export function integrateSlotsFallback(state: IntegrationState): void {
  // 顶部标签预留窗口内排队，窗口结束后再决定是否退到页脚按钮。
  if (state.deferIfTopTabPending(() => integrateSlotsFallback(state), 'slot')) return;
  if (state.navButtonRegistered) return;

  const { ctx } = state;

  try {
    const injectDisposer = ctx.slots.inject('sidebar.footer.action', () => {
      const regResult = ctx.slots.register(
        { name: 'sidebar.footer.action', id: PLUGIN_TAB_KIND, order: 10, label: () => t('nav.title') },
        () => React.createElement(SidebarNavButton, { onClick: state.togglePanel.bind(state), active: state.panelVisible }),
      );
      state.trackSlotDisposer(regResult);
      // 顶部标签迟到注册时撤回页脚按钮。
      state.noteFallbackSeat(() => {
        if (typeof regResult === 'function') {
          try { regResult(); } catch (e) { log.warn('sidebar.footer.action withdrawal failed', e); }
        }
      }, 'slot');
    });
    state.trackSlotDisposer(injectDisposer);
    state.navButtonRegistered = true;
    state.markChannel('slot');
  } catch (e) {
    log.warn('sidebar.footer.action slot failed', e);
  }
}
