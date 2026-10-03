import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_SLOT_ID } from './integrationIds.ts';

const log = scoped('client');

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