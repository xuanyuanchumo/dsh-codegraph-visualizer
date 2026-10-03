import React from 'react';
import type { IntegrationState } from './IntegrationState.ts';
import { SidebarNavButton } from '../components/FloatingUI.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';

const log = scoped('client');

export function integrateSlotsFallback(state: IntegrationState): void {
  if (state.navButtonRegistered) return;

  const { ctx } = state;

  try {
    const injectDisposer = ctx.slots.inject('sidebar.footer.action', () => {
      state.trackSlotDisposer(
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: PLUGIN_TAB_KIND, order: 10, label: () => t('nav.title') },
          () => React.createElement(SidebarNavButton, { onClick: state.togglePanel.bind(state), active: state.panelVisible }),
        ),
      );
    });
    state.trackSlotDisposer(injectDisposer);
    state.navButtonRegistered = true;
    useGraphStore.getState().setIntegrationMode('slot');
  } catch (e) {
    log.warn('sidebar.footer.action slot failed', e);
  }
}