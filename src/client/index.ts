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
import { integrateSlotsFallback } from './integrations/SlotsFallback.ts';
import { integrateFloatingPanel } from './integrations/FloatingPanelIntegration.ts';
import { integrateCommandUi } from './integrations/CommandUiIntegration.ts';
import { setupPrerequisitePolling } from './runtime/PrerequisitePolling.ts';
import { setupWorkspaceBootstrap } from './runtime/WorkspaceBootstrap.ts';
import { setupSSEEvents } from './runtime/SSEEvents.ts';
import { setupWindowEvents } from './runtime/WindowEvents.ts';
import { setupThemeObserver } from './runtime/ThemeObserver.ts';
import { setupPanelEventBridge } from './runtime/PanelEventBridge.ts';
import { setupRejectionHandler } from './runtime/RejectionHandler.ts';

export { PLUGIN_VERSION };

export const name = 'dsh-codegraph-visualizer-client';

/**
 * 只有 slot 系统是硬需求。
 *
 * `betterSidebar`（第三方 `dsh-better-sidebar`）与 `commandUi` 都是**可选**集成，各自的
 * 集成函数在运行时用 `ctx.get()` 动态探测。若把它们写进静态 `inject`，Cordis 的 fiber
 * 注入必须完全满足，插件会在缺失这些服务的最小宿主上被整体置为 INACTIVE —— 那是拿
 * 「一个可选集成」换取「整个插件不加载」。
 *
 * 注意 `sidebarRightTabs` **不是** gen2 独有：`@deepseek-ai/dsh-client-ui-sidebar-right`
 * 的 `ctx.reflect.provide("sidebarRightTabs", tabs)` 在 gen1 与 gen2 两套树里都存在，
 * 因此它同样只需动态探测。
 */
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

/**
 * 客户端半入口。
 *
 * 集成顺序即**优先级**：越靠前的通道越完整，先注册的会先占住席位并把
 * `state.navButtonRegistered` 置真，后续通道据此让位（DSH 的 slot/tab 注册表对重复 id
 * 是抛错语义，不是覆盖语义）。顺序：
 *
 *   conversation.view（顶层标签，slot 系统）
 *     → sidebar.right.pane.tab（DSH 原生右侧栏）
 *       → better-sidebar tab（第三方侧边栏）
 *         → sidebar.footer.action（页脚按钮）
 *           → 浮动面板（兜底）
 *
 * `integrateCommandUi` 与集成通道正交：它贡献斜杠命令，不占席位，因此无条件尝试。
 */
export function apply(ctx: Context): void {
  const compat = createClientCompatLayer();
  compat.detectVersion(ctx);
  compat.detectPlatform();
  compat.detectMode(ctx);
  compat.detectFlags(ctx);

  const state = new IntegrationState(ctx, compat.flags);

  integrateConversationView(state);
  integrateSidebarRightTabs(state);
  integrateBetterSidebar(state);
  integrateSlotsFallback(state);
  integrateFloatingPanel(state);
  integrateCommandUi(state);

  setupPrerequisitePolling(ctx);
  const { scanInProgress } = setupWorkspaceBootstrap(ctx);
  setupSSEEvents(ctx);
  setupWindowEvents(ctx);
  setupThemeObserver(ctx);
  setupPanelEventBridge(ctx);
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
