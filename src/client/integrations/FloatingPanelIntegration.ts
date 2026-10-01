import React from 'react';
import ReactDOM from 'react-dom/client';
import type { IntegrationState } from './IntegrationState.ts';
import { FloatingGraphPanel, MinimizedFloatingButton } from '../components/FloatingUI.tsx';
import { useGraphStore } from '../store/graphStore.ts';

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

  ctx.effect(() => () => {
    floatingRoot.unmount();
    floatingContainer.remove();
  }, 'codegraph: floating panel cleanup');
}