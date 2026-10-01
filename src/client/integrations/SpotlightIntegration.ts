import type { Context } from '@deepseek-ai/cordis';
import type { IntegrationState } from './IntegrationState.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { scoped } from '../../shared/Logger.ts';
import type { LayoutType } from '../../shared/viewModeUtils.ts';

const log = scoped('client');

export function integrateSpotlight(state: IntegrationState): void {
  if (!state.flags.spotlight) return;

  const { ctx } = state;

  try {
    const spotlight = ctx.get('spotlight') as Context['spotlight'] | undefined;
    if (!spotlight) return;

    const d1 = spotlight.registerCommand({
      id: 'codegraph-search',
      title: t('nav.searchSymbols'),
      handler: () => {
        state.openSidebarTab();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
      },
    });
    if (typeof d1 === 'function') ctx.effect(() => d1, 'codegraph: spotlight search cmd');

    const d2 = spotlight.registerCommand({
      id: 'codegraph-toggle',
      title: t('nav.togglePanel'),
      handler: () => state.togglePanel(),
    });
    if (typeof d2 === 'function') ctx.effect(() => d2, 'codegraph: spotlight toggle cmd');

    const d3 = spotlight.registerCommand({
      id: 'codegraph-layout',
      title: t('nav.switchLayout'),
      handler: () => {
        state.openSidebarTab();
        const store = useGraphStore.getState();
        const layouts: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
        const currentIdx = layouts.indexOf(store.layout);
        const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % layouts.length : 0;
        store.setLayout(layouts[nextIdx] ?? 'cose');
      },
    });
    if (typeof d3 === 'function') ctx.effect(() => d3, 'codegraph: spotlight layout cmd');

    const d4 = spotlight.registerCommand({
      id: 'codegraph-filter',
      title: t('nav.toggleFilter'),
      handler: () => {
        state.openSidebarTab();
        window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_FILTER_PANEL));
      },
    });
    if (typeof d4 === 'function') ctx.effect(() => d4, 'codegraph: spotlight filter cmd');

    const d5 = spotlight.registerCommand({
      id: 'codegraph-export',
      title: t('nav.exportGraph'),
      handler: () => {
        state.openSidebarTab();
        window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_EXPORT_MENU));
      },
    });
    if (typeof d5 === 'function') ctx.effect(() => d5, 'codegraph: spotlight export cmd');
  } catch (e) {
    log.warn('spotlight registration failed', e);
  }
}