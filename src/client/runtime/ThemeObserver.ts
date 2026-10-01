import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

const log = scoped('client');

export function setupThemeObserver(ctx: Context): void {
  if (typeof window === 'undefined') return;

  ctx.effect(() => {
    const themeObserver = new MutationObserver(() => {
      const isDark = document.body.hasAttribute('data-ds-dark-theme');
      const store = useGraphStore.getState();
      if (store.theme !== (isDark ? 'dark' : 'light')) {
        store.setTheme(isDark ? 'dark' : 'light');
        window.dispatchEvent(new CustomEvent(DOM_EVENTS.THEME_CHANGED, { detail: { theme: isDark ? 'dark' : 'light' } }));
        log.info('theme changed via DSH host', { theme: isDark ? 'dark' : 'light' });
      }
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => themeObserver.disconnect();
  }, 'codegraph: theme observer');
}