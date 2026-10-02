import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { GraphIcon } from '../components/Icons.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';


const log = scoped('client');

export function integrateConversationView(state: IntegrationState): void {
  if (state.navButtonRegistered) return;

  const { ctx } = state;

  try {
    const injectDisposer = ctx.slots.inject('conversation.view', () => {
      const regResult = ctx.slots.register(
        {
          name: 'conversation.view',
          key: 'dsh-codegraph-visualizer',
          order: 50,
          label: () => t('nav.title'),
        },
        (props: { ctx?: unknown; visible?: boolean }) => {
          const visible = props?.visible ?? true;
          state.panelVisible = visible;
          useGraphStore.getState().setPanelVisible(visible);

          return React.createElement(
            'div',
            {
              style: {
                display: visible ? 'flex' : 'none',
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                minHeight: '0',
              },
              'data-cg-conversation-view': 'true',
              'data-cg-visible': String(visible),
            },
            React.createElement(
              'div',
              {
                className: 'cg-conversation-view-header',
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 8px',
                  borderBottom: '1px solid var(--cg-border, #e0e0e0)',
                  flexShrink: 0,
                },
              },
              React.createElement(GraphIcon, { size: 16 }),
              React.createElement(
                'span',
                { style: { fontSize: '13px', fontWeight: 500 } },
                t('nav.title'),
              ),
            ),
            React.createElement(
              'div',
              {
                style: {
                  flex: 1,
                  minHeight: '0',
                  overflow: 'hidden',
                },
              },
              React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
            ),
          );
        },
      );
      if (typeof regResult === 'function') state.slotDisposers.push(regResult);
    });

    if (typeof injectDisposer === 'function') state.trackSlotDisposer(injectDisposer);

    state.navButtonRegistered = true;
    useGraphStore.getState().setIntegrationMode('conversation-view');
    log.info('conversation.view slot registration succeeded');
  } catch (e) {
    log.warn('conversation.view slot registration failed', e);
  }
}