import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

export function setupSpotlightBridge(ctx: Context): void {
  if (typeof window === 'undefined') return;

  ctx.effect(() => {
    const toggleFilterListener = () => {
      const filterBtn = document.querySelector('.cg-filter-panel-btn') as HTMLButtonElement | null;
      if (filterBtn) filterBtn.click();
    };
    const toggleExportListener = () => {
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement | null;
      if (exportBtn) exportBtn.click();
    };
    window.addEventListener(DOM_EVENTS.TOGGLE_FILTER_PANEL, toggleFilterListener);
    window.addEventListener(DOM_EVENTS.TOGGLE_EXPORT_MENU, toggleExportListener);
    return () => {
      window.removeEventListener(DOM_EVENTS.TOGGLE_FILTER_PANEL, toggleFilterListener);
      window.removeEventListener(DOM_EVENTS.TOGGLE_EXPORT_MENU, toggleExportListener);
    };
  }, 'codegraph: spotlight event bridge');
}