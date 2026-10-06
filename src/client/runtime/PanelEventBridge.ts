import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

/**
 * 面板事件桥：把「切换过滤面板 / 导出菜单」这两个 `window` 自定义事件转成对工具栏按钮的点击。
 *
 * 为什么需要这一层：命令贡献（`CommandUiIntegration`）与键盘快捷键只知道**语义**
 * （「打开过滤面板」），不知道工具栏此刻是否挂载、按钮是否可见。事件桥是二者的解耦缝 ——
 * 发送方不需要 import 任何 React 组件，接收方也不需要在未挂载时做保护性判断
 * （`querySelector` 返回 null 时静默跳过即可）。
 *
 * 命名历史：本文件原为 `SpotlightBridge.ts` / `setupSpotlightBridge`，因为它曾与一个
 * 名为 `spotlight` 的命令面板服务配套。cycle-83 逐条核验后确认**该服务在任何 DSH 代
 * 都不存在**（幻影），配套的 `SpotlightIntegration.ts` 已删除；本桥接只依赖
 * `window` 与 DOM，与那个幻影无关，故保留并改名去掉误导性前缀。
 */
export function setupPanelEventBridge(ctx: Context): void {
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
  }, 'codegraph: panel event bridge');
}
