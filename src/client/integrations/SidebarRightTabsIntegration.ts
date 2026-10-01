
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

export function integrateSidebarRightTabs(state: IntegrationState): void {
  const { ctx } = state;

  try {
    const seatDispose = ctx.inject(['sidebarRightTabs'], (injected: Map<string, unknown>) => {
      const tabs = injected.get('sidebarRightTabs') as typeof ctx.sidebarRightTabs | undefined;
      if (!tabs) {
        log.warn('sidebarRightTabs injected but undefined');
        return;
      }
      log.info('sidebarRightTabs injected via ctx.inject, registering...');

      const typeDispose = tabs.register({
        id: 'dsh-codegraph-visualizer',
        kind: 'codegraph',
        priority: 'extension',
        canOpen: () => true,
        title: () => t('nav.title'),
      });
      if (typeof typeDispose === 'function') state.slotDisposers.push(typeDispose);

      const bodyDispose = ctx.slots.inject('sidebar.right.pane.tab', () => {
        const regResult = ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: 'dsh-codegraph-visualizer' },
          GraphPanel,
        );
        if (typeof regResult === 'function') state.slotDisposers.push(regResult);
      });
      if (typeof bodyDispose === 'function') state.slotDisposers.push(bodyDispose);

      state.navButtonRegistered = true;
      useGraphStore.getState().setIntegrationMode('sidebar-right');
      log.info('sidebarRightTabs registration succeeded');
    });
    if (typeof seatDispose === 'function') state.slotDisposers.push(seatDispose);
  } catch (e) {
    log.error('sidebarRightTabs ctx.inject failed', e);
  }
}