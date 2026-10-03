import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { resetLoggerListeners } from '../shared/Logger.ts';
import type { GraphData } from '../types/index.ts';
import { PLUGIN_VERSION } from '../generated/version.ts';
import { resetI18nListeners } from './i18n/index.ts';
import { disposeStore } from './store/graphStore.ts';
import { createClientCompatLayer } from './compat/ClientCompatLayer.ts';
import { IntegrationState } from './integrations/IntegrationState.ts';
import { integrateConversationView } from './integrations/ConversationViewIntegration.ts';
import { integrateSidebarRightTabs } from './integrations/SidebarRightTabsIntegration.ts';
import { integrateBetterSidebar } from './integrations/BetterSidebarIntegration.ts';
import { integrateRemoteWebUi } from './integrations/RemoteWebUiIntegration.ts';
import { integrateSlotsFallback } from './integrations/SlotsFallback.ts';
import { integrateFloatingPanel } from './integrations/FloatingPanelIntegration.ts';
import { integrateSpotlight } from './integrations/SpotlightIntegration.ts';
import { setupPrerequisitePolling } from './runtime/PrerequisitePolling.ts';
import { setupWorkspaceBootstrap } from './runtime/WorkspaceBootstrap.ts';
import { setupSSEEvents } from './runtime/SSEEvents.ts';
import { setupWindowEvents } from './runtime/WindowEvents.ts';
import { setupThemeObserver } from './runtime/ThemeObserver.ts';
import { setupSpotlightBridge } from './runtime/SpotlightBridge.ts';
import { setupRejectionHandler } from './runtime/RejectionHandler.ts';

export { PLUGIN_VERSION };

export const name = 'dsh-codegraph-visualizer-client';
// Only the slot system is a hard requirement. `betterSidebar`, `sidebarRightTabs`
// and `uiConversation` are gen2-only optional integrations: each integrator probes
// them dynamically (ctx.inject / ctx.get), so declaring them as static inject would
// needlessly deactivate the plugin on gen1/minimal hosts.
export const inject = ['slots'];

export function init(container: HTMLElement, initialData?: GraphData): () => void {
  const root = ReactDOM.createRoot(container);
  if (initialData) {
    const store = useGraphStore.getState();
    store.setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId, initialData.metadata);
  }
  root.render(React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)));
  return () => root.unmount();
}

export function apply(ctx: Context): void {
  const compat = createClientCompatLayer();
  compat.detectMode(ctx);
  compat.detectFlags(ctx);

  const state = new IntegrationState(ctx, compat.flags);

  integrateConversationView(state);
  integrateSidebarRightTabs(state);
  integrateBetterSidebar(state);
  integrateRemoteWebUi(state);
  integrateSlotsFallback(state);
  integrateFloatingPanel(state);
  integrateSpotlight(state);

  setupPrerequisitePolling(ctx);
  const { scanInProgress } = setupWorkspaceBootstrap(ctx);
  setupSSEEvents(ctx);
  setupWindowEvents(ctx);
  setupThemeObserver(ctx);
  setupSpotlightBridge(ctx);
  setupRejectionHandler(ctx);

  ctx.effect(() => {
    return () => {
      scanInProgress.value = false;
      disposeStore();
      resetI18nListeners();
      resetLoggerListeners();
    };
  }, 'codegraph: client cleanup');
}
