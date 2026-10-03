import React from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { GraphIcon } from '../components/Icons.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';

const log = scoped('client');

export function integrateRemoteWebUi(state: IntegrationState): void {
  if (!state.flags.remoteWebUi) return;
  if (state.navButtonRegistered) return;

  const { ctx } = state;

  try {
    const remoteWebUiApi = ctx.get('remoteWebUI') as Context['remoteWebUI'] | undefined;
    if (!remoteWebUiApi) return;

    const ruiFeatures: string[] = safeCheck(() => remoteWebUiApi?.features ?? [], []);
    const hasFeature = (f: string): boolean => ruiFeatures.includes(f);
    log.info('remote-web-ui features', { version: safeCheck(() => remoteWebUiApi?.version, 'unknown'), features: ruiFeatures });

    const panelDescriptor: Parameters<NonNullable<Context['remoteWebUI']>['registerPanel']>[0] = {
      id: PLUGIN_TAB_KIND,
      title: () => t('nav.title'),
      description: () => t('nav.description'),
      icon: (size: number) => React.createElement(GraphIcon, { size }),
      order: 50,
      component: (props: {
        ctx: Context;
        visible: boolean;
        panel: { id: string; title: string; path?: string };
      }) => {
        state.panelVisible = props.visible;
        useGraphStore.getState().setPanelVisible(props.visible);
        if (props.panel?.id) state.remoteWebUiPanelId = props.panel.id;
        return React.createElement(
          'div',
          {
            className: 'cg-integration-host',
            'data-cg-visible': String(props.visible),
            'data-cg-remote-web-ui-visible': String(props.visible),
          },
          React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
        );
      },
    };

    if (hasFeature('badge')) {
      panelDescriptor.badge = () => {
        const s = useGraphStore.getState();
        if (s.nodes.length === 0) return null;
        return s.nodes.length > 99 ? '99+' : s.nodes.length;
      };
    }

    if (hasFeature('panelLifecycle')) {
      panelDescriptor.onOpen = (panel: unknown, scope: unknown) => {
        log.info('remote-web-ui panel opened', { panelId: (panel as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      panelDescriptor.onActivate = (panel: unknown, scope: unknown) => {
        log.info('remote-web-ui panel activated', { panelId: (panel as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      panelDescriptor.onClose = (panel: unknown, scope: unknown) => {
        log.info('remote-web-ui panel closed', { panelId: (panel as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(false);
      };
    }

    const dispose = remoteWebUiApi.registerPanel(panelDescriptor);
    if (typeof dispose === 'function') {
      ctx.effect(() => dispose, 'codegraph: remote-web-ui panel');
      state.navButtonRegistered = true;
      state.remoteWebUiApi = remoteWebUiApi;
      useGraphStore.getState().setIntegrationMode('remote-web-ui');

      if (hasFeature('stateSubscription')) {
        try {
          state.remoteWebUiStateDisposer = remoteWebUiApi.subscribeState(() => {
            const snapshot = remoteWebUiApi?.getSnapshot();
            if (snapshot?.state) {
              const isVisible = snapshot.state.activePane === PLUGIN_TAB_KIND ||
                snapshot.state.panelOpen;
              if (isVisible !== state.panelVisible) {
                state.panelVisible = isVisible;
                useGraphStore.getState().setPanelVisible(isVisible);
              }
            }
          });
          if (state.remoteWebUiStateDisposer) {
            ctx.effect(() => state.remoteWebUiStateDisposer!, 'codegraph: remote-web-ui state subscription');
          }
        } catch (e) {
          log.warn('remote-web-ui subscribeState failed', e);
        }
      }
    } else {
      log.warn('remote-web-ui registerPanel did not return a disposer, falling back to slots');
    }
  } catch (e) {
    log.warn('remote-web-ui registration failed, will fallback', e);
  }
}