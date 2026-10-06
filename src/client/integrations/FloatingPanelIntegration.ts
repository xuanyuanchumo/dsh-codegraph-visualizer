import React from 'react';
import ReactDOM from 'react-dom/client';
import type { IntegrationState } from './IntegrationState.ts';
import { FloatingGraphPanel, MinimizedFloatingButton } from '../components/FloatingUI.tsx';
import { useGraphStore } from '../store/graphStore.ts';

/**
 * 兜底集成通道：所有 DSH 托管席位都不可用时，把面板挂到 `document.body` 上自行浮动。
 *
 * 这是「最小 profile」（例如只装 `@deepseek-ai/dsh-base` + 本插件的
 * `~/.dsh/profiles/codegraph/`）里唯一还能工作的路径：那种 profile 里既没有
 * `conversation.view` 声明，也没有 `betterSidebar`/`sidebarRightTabs` 服务。
 *
 * 与前几条通道不同，这里**由本插件自己持有几何尺寸**（`FloatingGraphPanel` 可拖拽缩放），
 * 因此集成模式记为 `floating`，属于 `HOST_SIZED_INTEGRATION_MODES` 的补集
 * ——`responsive.css` 不会把它的宽高钉成 100%。
 */
export function integrateFloatingPanel(state: IntegrationState): void {
  if (state.navButtonRegistered) return;
  if (typeof document === 'undefined') return;

  const { ctx } = state;
  let floatingMinimized = false;
  const floatingContainer = document.createElement('div');
  floatingContainer.className = 'cg-floating-container';
  floatingContainer.setAttribute('data-visible', 'false');
  document.body.appendChild(floatingContainer);
  const floatingRoot = ReactDOM.createRoot(floatingContainer);

  state.renderFloating = () => {
    if (!state.panelVisible) {
      floatingRoot.render(null);
      return;
    }
    if (floatingMinimized) {
      floatingRoot.render(
        React.createElement(MinimizedFloatingButton, {
          onRestore: () => { floatingMinimized = false; state.renderFloating(); },
        }),
      );
    } else {
      floatingRoot.render(
        React.createElement(FloatingGraphPanel, {
          onClose: () => { state.panelVisible = false; floatingContainer.setAttribute('data-visible', 'false'); state.renderFloating(); },
          onMinimize: () => { floatingMinimized = true; state.renderFloating(); },
        }),
      );
    }
  };

  state.renderFloating();
  useGraphStore.getState().setIntegrationMode('floating');

  // 卸载时同时拆掉 React root 与宿主容器，避免留下空 div 影响后续布局测量。
  ctx.effect(() => () => {
    floatingRoot.unmount();
    floatingContainer.remove();
  }, 'codegraph: floating panel cleanup');
}
