import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_SLOT_ID } from './integrationIds.ts';

const log = scoped('client');

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
 */
export function integrateConversationView(state: IntegrationState): void {
  if (state.navButtonRegistered) return;
  if (!state.flags.conversationView) return;

  const { ctx } = state;

  try {
    const injectDisposer = ctx.slots.inject('conversation.view', () => {
      const regResult = ctx.slots.register(
        {
          name: 'conversation.view',
          id: PLUGIN_SLOT_ID,
          order: 100,
          label: () => t('nav.title'),
        },
        (props: { ctx?: unknown; visible?: boolean }) => {
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
            },
            React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
          );
        },
      );
      if (typeof regResult === 'function') state.slotDisposers.push(regResult);
      state.navButtonRegistered = true;
      useGraphStore.getState().setIntegrationMode('conversation-view');
      log.info('conversation.view slot registration succeeded');
    });

    if (typeof injectDisposer === 'function') state.trackSlotDisposer(injectDisposer);
  } catch (e) {
    log.warn('conversation.view slot registration failed', e);
  }
}
