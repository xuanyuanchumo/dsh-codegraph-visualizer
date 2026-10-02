import type { Context } from '@deepseek-ai/cordis';
import type { ClientFeatureFlags } from '../compat/ClientCompatLayer.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

export class IntegrationState {
  panelVisible = false;
  navButtonRegistered = false;
  betterSidebarApi: Context['betterSidebar'] | undefined;
  betterSidebarTabId: string | undefined;
  remoteWebUiApi: Context['remoteWebUI'] | undefined;
  remoteWebUiPanelId: string | undefined;
  slotDisposers: Array<() => void> = [];
  renderFloating: () => void = () => {};
  private allDisposers: Array<() => void> = [];

  constructor(
    public ctx: Context,
    public flags: ClientFeatureFlags,
  ) {
    ctx.effect(() => () => {
      for (const dispose of this.slotDisposers) dispose();
      this.slotDisposers.length = 0;
      for (const dispose of this.allDisposers) {
        try { dispose(); } catch { /* ignore */ }
      }
      this.allDisposers.length = 0;
    }, 'codegraph: slot registrations cleanup');
  }

  trackSlotDisposer(d: (() => void) | void): void {
    if (typeof d === 'function') this.slotDisposers.push(d);
  }

  trackDisposer(d: (() => void) | void): void {
    if (typeof d === 'function') this.allDisposers.push(d);
  }

  get sidebarStateDisposer(): (() => void) | undefined {
    return this._sidebarStateDisposer;
  }
  set sidebarStateDisposer(d: (() => void) | undefined) {
    this._sidebarStateDisposer = d;
    if (d) this.allDisposers.push(d);
  }
  private _sidebarStateDisposer: (() => void) | undefined;

  get remoteWebUiStateDisposer(): (() => void) | undefined {
    return this._remoteWebUiStateDisposer;
  }
  set remoteWebUiStateDisposer(d: (() => void) | undefined) {
    this._remoteWebUiStateDisposer = d;
    if (d) this.allDisposers.push(d);
  }
  private _remoteWebUiStateDisposer: (() => void) | undefined;

  openSidebarTab(): void {
    if (this.betterSidebarApi) {
      try {
        this.betterSidebarApi.openTab({ type: 'codegraph-visualizer' });
      } catch (e) {
        log.warn('betterSidebar.openTab failed', e);
      }
    }
  }

  openRemoteWebUiPanel(): void {
    if (this.remoteWebUiApi) {
      try {
        this.remoteWebUiApi.openPanel({ type: 'codegraph-visualizer' });
      } catch (e) {
        log.warn('remoteWebUI.openPanel failed', e);
      }
    }
  }

  togglePanel(): void {
    if (this.remoteWebUiApi && !this.panelVisible) {
      this.openRemoteWebUiPanel();
      return;
    }
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