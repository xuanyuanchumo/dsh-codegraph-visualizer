import type { Context } from '@deepseek-ai/cordis';
import type { ClientFeatureFlags } from '../compat/ClientCompatLayer.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

export class IntegrationState {
  panelVisible = false;
  navButtonRegistered = false;
  betterSidebarApi: Context['betterSidebar'] | undefined;
  betterSidebarTabId: string | undefined;
  sidebarStateDisposer: (() => void) | undefined;
  slotDisposers: Array<() => void> = [];
  renderFloating: () => void = () => {};

  constructor(
    public ctx: Context,
    public flags: ClientFeatureFlags,
  ) {
    ctx.effect(() => () => {
      for (const dispose of this.slotDisposers) dispose();
      this.slotDisposers.length = 0;
    }, 'codegraph: slot registrations cleanup');
  }

  trackSlotDisposer(d: (() => void) | void): void {
    if (typeof d === 'function') this.slotDisposers.push(d);
  }

  openSidebarTab(): void {
    if (this.betterSidebarApi) {
      try {
        this.betterSidebarApi.openTab({ type: 'codegraph-visualizer' });
      } catch (e) {
        log.warn('betterSidebar.openTab failed', e);
      }
    }
  }

  togglePanel(): void {
    if (this.betterSidebarApi && !this.panelVisible) {
      this.openSidebarTab();
      return;
    }
    this.panelVisible = !this.panelVisible;
    const container = document.querySelector('.cg-floating-container');
    if (container) {
      container.setAttribute('data-visible', String(this.panelVisible));
    }
    this.renderFloating();
  }
}