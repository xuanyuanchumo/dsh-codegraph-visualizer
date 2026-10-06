import type { Context } from '@deepseek-ai/cordis';
import type { ClientFeatureFlags } from '../compat/ClientCompatLayer.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';

const log = scoped('client');

/**
 * 集成期的可变状态与清理台账。
 *
 * 所有集成函数共享同一个实例：它们会互相看 `navButtonRegistered` 之类的「已经装好了」
 * 标记，避免同一席位被注册两次（DSH 的 slot / tab 注册表对重复 id 是**抛错**语义，
 * 不是覆盖语义 —— 见 `dsh-client-ui-sidebar-right/lib/client.js:8690` 的
 * `if (this.ids.has(id)) throw new Error(...)`）。
 *
 * 清理走两条台账：
 *   - `slotDisposers` —— slot/tab 注册返回的 disposer，先清（它们持有 DOM 席位）；
 *   - `allDisposers`  —— 其余 disposer（状态订阅等），后清。
 * 两条都在构造器注册的 `ctx.effect` 里按「先 slot 后其余」的顺序释放，并把数组清空，
 * 使重复调用成为幂等操作。
 *
 * 历史：本类曾有 `remoteWebUiApi` / `remoteWebUiPanelId` / `openRemoteWebUiPanel()` 三个
 * 成员，服务于一个名为 `remoteWebUI` 的服务。cycle-83 逐条核验后确认该服务在任何 DSH
 * 代与本机全部已装插件中都不存在（幻影），已删除。
 */
export class IntegrationState {
  panelVisible = false;
  navButtonRegistered = false;
  betterSidebarApi: Context['betterSidebar'] | undefined;
  betterSidebarTabId: string | undefined;
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
        try { dispose(); } catch { /* 单个 disposer 失败不应阻断其余释放 */ }
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

  /** 让 `dsh-better-sidebar` 打开（或激活）本插件的 tab。无该服务时是空操作。 */
  openSidebarTab(): void {
    if (this.betterSidebarApi) {
      try {
        this.betterSidebarApi.openTab({ type: PLUGIN_TAB_KIND });
      } catch (e) {
        log.warn('betterSidebar.openTab failed', e);
      }
    }
  }

  /**
   * 切换图表面板的可见性。
   *
   * 三条路径按可用性降级：better-sidebar 的 tab → 插件自绘的浮动容器。
   * `panelVisible` 只描述**浮动容器**那条路径的状态；由宿主托管的席位
   * （conversation.view / sidebar-right / better-sidebar）的可见性由宿主自己决定，
   * 并通过 `setPanelVisible` 回灌进 store。
   */
  togglePanel(): void {
    if (this.panelVisible) {
      this.panelVisible = false;
      const container = document.querySelector('.cg-floating-container');
      if (container) container.setAttribute('data-visible', 'false');
      this.renderFloating();
      return;
    }
    if (this.betterSidebarApi) { this.openSidebarTab(); return; }
    this.panelVisible = true;
    const container = document.querySelector('.cg-floating-container');
    if (container) container.setAttribute('data-visible', 'true');
    this.renderFloating();
  }
}
