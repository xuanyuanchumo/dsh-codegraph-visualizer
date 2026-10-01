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

const log = scoped('client');

export function integrateBetterSidebar(state: IntegrationState): void {
  if (!state.flags.betterSidebar) return;
  if (state.navButtonRegistered) return;

  const { ctx } = state;

  try {
    const betterSidebarApi = ctx.get('betterSidebar') as Context['betterSidebar'] | undefined;
    if (!betterSidebarApi) return;

    const bsFeatures: string[] = safeCheck(() => betterSidebarApi?.features ?? [], []);
    const hasFeature = (f: string): boolean => bsFeatures.includes(f);
    log.info('better-sidebar features', { version: safeCheck(() => betterSidebarApi?.version, 'unknown'), features: bsFeatures });

    const tabDescriptor: Parameters<NonNullable<Context['betterSidebar']>['registerTab']>[0] = {
      id: 'codegraph-visualizer',
      title: () => t('nav.title'),
      description: () => t('nav.description'),
      icon: (size: number) => React.createElement(GraphIcon, { size }),
      order: 50,
      single: true,
      component: (props: {
        ctx: Context;
        visible: boolean;
        tab: { id: string; title: string; path?: string };
      }) => {
        state.panelVisible = props.visible;
        useGraphStore.getState().setPanelVisible(props.visible);
        if (props.tab?.id) state.betterSidebarTabId = props.tab.id;
        return React.createElement(
          'div',
          {
            style: {
              display: props.visible ? 'block' : 'none',
              width: '100%',
              height: '100%',
            },
            'data-cg-sidebar-visible': String(props.visible),
          },
          React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
        );
      },
    };

    if (hasFeature('badge')) {
      tabDescriptor.badge = () => {
        const s = useGraphStore.getState();
        if (s.nodes.length === 0) return null;
        return s.nodes.length > 99 ? '99+' : s.nodes.length;
      };
    }

    if (hasFeature('tabLifecycle')) {
      tabDescriptor.onOpen = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab opened', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      tabDescriptor.onActivate = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab activated', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      tabDescriptor.onClose = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab closed', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(false);
      };
    }

    const dispose = betterSidebarApi.registerTab(tabDescriptor);
    if (typeof dispose === 'function') {
      ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
      state.navButtonRegistered = true;
      state.betterSidebarApi = betterSidebarApi;
      useGraphStore.getState().setIntegrationMode('sidebar');
      if (hasFeature('stateSubscription')) {
        try {
          state.sidebarStateDisposer = betterSidebarApi.subscribeState(() => {
            const snapshot = betterSidebarApi?.getSnapshot();
            if (snapshot?.state) {
              const isVisible = snapshot.state.activePane === 'codegraph-visualizer' ||
                snapshot.state.bottomOpen;
              if (isVisible !== state.panelVisible) {
                state.panelVisible = isVisible;
                useGraphStore.getState().setPanelVisible(isVisible);
              }
            }
          });
          if (state.sidebarStateDisposer) {
            ctx.effect(() => state.sidebarStateDisposer!, 'codegraph: sidebar state subscription');
          }
        } catch (e) {
          log.warn('better-sidebar subscribeState failed', e);
        }
      }
    } else {
      log.warn('better-sidebar registerTab did not return a disposer, falling back to slots');
    }
  } catch (e) {
    log.warn('better-sidebar registration failed', e);
  }
}