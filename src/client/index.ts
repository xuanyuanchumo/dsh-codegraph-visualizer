import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import { GraphIcon } from './components/Icons.tsx';
import { scoped } from '../shared/Logger.ts';
import { resetLoggerListeners } from '../shared/Logger.ts';
import type { GraphData } from '../types/index.ts';

import { PLUGIN_VERSION } from '../generated/version.ts';
import { fetchStatus, fetchGraphDataIncremental, fetchWorkspace, requestInit, requestWatch, fetchBootstrap } from './api/index.ts';
import { t } from './i18n/index.ts';
import { resetI18nListeners } from './i18n/index.ts';
import { disposeStore } from './store/graphStore.ts';
import { POLLING } from '../shared/constants.ts';
import { DOM_EVENTS } from '../shared/domEvents.ts';
import type { LayoutType } from '../shared/viewModeUtils.ts';

export { PLUGIN_VERSION };

const log = scoped('client');

export const name = 'dsh-codegraph-visualizer-client';
export const inject = ['slots', 'betterSidebar'];

function SidebarNavButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  return React.createElement('button', {
    onClick,
    className: `cg-sidebar-nav-btn${active ? ' cg-sidebar-nav-btn-active' : ''}`,
    title: t('nav.title'),
    'aria-label': t('nav.ariaLabel'),
  }, React.createElement(GraphIcon, { size: 18 }));
}

function FloatingGraphPanel({ onClose, onMinimize }: { onClose: () => void; onMinimize: () => void }) {
  return React.createElement('div', { className: 'cg-floating-overlay' },
    React.createElement('div', { className: 'cg-floating-panel' },
      React.createElement('div', { className: 'cg-floating-header' },
        React.createElement('div', { className: 'cg-floating-header-left' },
          React.createElement('span', { className: 'cg-floating-title' }, t('nav.title')),
          React.createElement('span', { className: 'cg-floating-mode-badge' }, t('nav.modeFloating')),
        ),
        React.createElement('div', { className: 'cg-floating-header-actions' },
          React.createElement('button', {
            onClick: onMinimize,
            className: 'cg-floating-minimize',
            'aria-label': t('nav.minimizePanel'),
            title: t('nav.minimizePanel'),
          }, '\u2013'),
          React.createElement('button', {
            onClick: onClose,
            className: 'cg-floating-close',
            'aria-label': t('nav.closePanel'),
          }, '\u00d7'),
        ),
      ),
      React.createElement('div', { className: 'cg-floating-content' },
        React.createElement(GraphPanel),
      ),
    ),
  );
}

function MinimizedFloatingButton({ onRestore }: { onRestore: () => void }) {
  return React.createElement('button', {
    onClick: onRestore,
    className: 'cg-floating-minimized-btn',
    'aria-label': t('nav.restorePanel'),
    title: t('nav.restorePanel'),
  }, React.createElement(GraphIcon, { size: 20 }));
}

export function init(container: HTMLElement, initialData?: GraphData): () => void {
  const root = ReactDOM.createRoot(container);
  if (initialData) {
    const store = useGraphStore.getState();
    store.setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId, initialData.metadata);
  }
  root.render(React.createElement(GraphPanel));
  return () => root.unmount();
}

export function apply(ctx: Context): () => void {
  let panelVisible = false;
  let navButtonRegistered = false;
  let renderFloating: () => void = () => {};
  let betterSidebarApi: Context['betterSidebar'] | undefined;
  let _betterSidebarTabId: string | undefined;
  let sidebarStateDisposer: (() => void) | undefined;
  const slotDisposers: Array<() => void> = [];
  const trackSlotDisposer = (d: (() => void) | void): void => {
    if (typeof d === 'function') slotDisposers.push(d);
  };
  ctx.effect(() => () => {
    for (const dispose of slotDisposers) dispose();
    slotDisposers.length = 0;
  }, 'codegraph: slot registrations cleanup');

  const openSidebarTab = (): void => {
    if (betterSidebarApi) {
      try {
        betterSidebarApi.openTab({ type: 'codegraph-visualizer', target: 'bottom' });
      } catch (e) {
        log.warn('betterSidebar.openTab failed', e);
      }
    }
  };

  const togglePanel = (): void => {
    if (betterSidebarApi && !panelVisible) {
      openSidebarTab();
      return;
    }
    panelVisible = !panelVisible;
    const container = document.querySelector('.cg-floating-container');
    if (container) {
      container.setAttribute('data-visible', String(panelVisible));
    }
    renderFloating();
  };

  try {
    betterSidebarApi = ctx.get('betterSidebar') as Context['betterSidebar'] | undefined;
    if (betterSidebarApi) {
      const dispose = betterSidebarApi.registerTab({
        id: 'codegraph-visualizer',
        title: () => t('nav.title'),
        description: () => t('nav.description'),
        icon: (size: number) => React.createElement(GraphIcon, { size }),
        order: 50,
        single: true,
        badge: () => {
          const s = useGraphStore.getState();
          if (s.nodes.length === 0) return null;
          return s.nodes.length > 99 ? '99+' : s.nodes.length;
        },
        onOpen: () => {
          log.info('better-sidebar tab opened');
          useGraphStore.getState().setPanelVisible(true);
        },
        onActivate: () => {
          useGraphStore.getState().setPanelVisible(true);
        },
        onClose: () => {
          log.info('better-sidebar tab closed');
          useGraphStore.getState().setPanelVisible(false);
        },
        component: (props: {
          ctx: Context;
          visible: boolean;
          tab: { id: string; title: string; path?: string };
        }) => {
          panelVisible = props.visible;
          useGraphStore.getState().setPanelVisible(props.visible);
          if (props.tab?.id) _betterSidebarTabId = props.tab.id;
          return React.createElement(
            'div',
            {
              style: {
                display: props.visible ? 'block' : 'none',
                width: '100%',
                height: '100%',
              },
              'data-cg-sidebar-visible': String(props.visible),
            },
            React.createElement(GraphPanel),
          );
        },
      });
      if (typeof dispose === 'function') {
        ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
        navButtonRegistered = true;
        useGraphStore.getState().setIntegrationMode('sidebar');
        try {
          sidebarStateDisposer = betterSidebarApi.subscribeState(() => {
            const snapshot = betterSidebarApi?.getSnapshot();
            if (snapshot?.state) {
              const isVisible = snapshot.state.activePane === 'codegraph-visualizer' ||
                snapshot.state.bottomOpen;
              if (isVisible !== panelVisible) {
                panelVisible = isVisible;
                useGraphStore.getState().setPanelVisible(isVisible);
              }
            }
          });
          if (sidebarStateDisposer) {
            ctx.effect(() => sidebarStateDisposer!, 'codegraph: sidebar state subscription');
          }
        } catch (e) {
          log.warn('better-sidebar subscribeState failed', e);
        }
      } else {
        log.warn('better-sidebar registerTab did not return a disposer, falling back to slots');
      }
    }
  } catch (e) {
    log.warn('better-sidebar registration failed', e);
  }

  if (!navButtonRegistered) {
    try {
      const injectDisposer = ctx.slots.inject('sidebar.footer.action', () => {
        trackSlotDisposer(
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'codegraph-visualizer', order: 10, label: () => t('nav.title') },
            () => React.createElement(SidebarNavButton, { onClick: togglePanel, active: panelVisible }),
          ),
        );
      });
      trackSlotDisposer(injectDisposer);
      navButtonRegistered = true;
      useGraphStore.getState().setIntegrationMode('slot');
    } catch (e) {
      log.warn('sidebar.footer.action slot failed', e);
    }
  }

  if (!navButtonRegistered && typeof document !== 'undefined') {
    let floatingMinimized = false;
    const floatingContainer = document.createElement('div');
    floatingContainer.className = 'cg-floating-container';
    floatingContainer.setAttribute('data-visible', 'false');
    document.body.appendChild(floatingContainer);
    const floatingRoot = ReactDOM.createRoot(floatingContainer);

    renderFloating = () => {
      if (!panelVisible) {
        floatingRoot.render(null);
        return;
      }
      if (floatingMinimized) {
        floatingRoot.render(
          React.createElement(MinimizedFloatingButton, {
            onRestore: () => { floatingMinimized = false; renderFloating(); },
          }),
        );
      } else {
        floatingRoot.render(
          React.createElement(FloatingGraphPanel, {
            onClose: () => { panelVisible = false; floatingContainer.setAttribute('data-visible', 'false'); renderFloating(); },
            onMinimize: () => { floatingMinimized = true; renderFloating(); },
          }),
        );
      }
    };

    renderFloating();
    useGraphStore.getState().setIntegrationMode('floating');

    ctx.effect(() => () => {
      floatingRoot.unmount();
      floatingContainer.remove();
    }, 'codegraph: floating panel cleanup');
  }

  try {
    const spotlight = ctx.get('spotlight') as Context['spotlight'] | undefined;
    if (spotlight) {
      const d1 = spotlight.registerCommand({
        id: 'codegraph-search',
        title: t('nav.searchSymbols'),
        handler: () => {
          openSidebarTab();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
        },
      });
      if (typeof d1 === 'function') ctx.effect(() => d1, 'codegraph: spotlight search cmd');
      const d2 = spotlight.registerCommand({
        id: 'codegraph-toggle',
        title: t('nav.togglePanel'),
        handler: () => togglePanel(),
      });
      if (typeof d2 === 'function') ctx.effect(() => d2, 'codegraph: spotlight toggle cmd');
      const d3 = spotlight.registerCommand({
        id: 'codegraph-layout',
        title: t('nav.switchLayout'),
        handler: () => {
          openSidebarTab();
          const store = useGraphStore.getState();
          const layouts: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
          const currentIdx = layouts.indexOf(store.layout);
          const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % layouts.length : 0;
          store.setLayout(layouts[nextIdx] ?? 'cose');
        },
      });
      if (typeof d3 === 'function') ctx.effect(() => d3, 'codegraph: spotlight layout cmd');
      const d4 = spotlight.registerCommand({
        id: 'codegraph-filter',
        title: t('nav.toggleFilter'),
        handler: () => {
          openSidebarTab();
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_FILTER_PANEL));
        },
      });
      if (typeof d4 === 'function') ctx.effect(() => d4, 'codegraph: spotlight filter cmd');
      const d5 = spotlight.registerCommand({
        id: 'codegraph-export',
        title: t('nav.exportGraph'),
        handler: () => {
          openSidebarTab();
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_EXPORT_MENU));
        },
      });
      if (typeof d5 === 'function') ctx.effect(() => d5, 'codegraph: spotlight export cmd');
    }
  } catch (e) {
    log.warn('spotlight registration failed', e);
  }

  {
    let lastStatusKey = '';
    let prereqTimer: ReturnType<typeof setTimeout> | null = null;
    let prereqDisposed = false;
    const checkStatus = async () => {
      const status = await fetchStatus();
      const store = useGraphStore.getState();
      store.setPrerequisites({ codegraph: status.codegraph, lens: status.lens, builtin: status.builtin ?? true });
      const statusKey = `${status.codegraph}:${status.lens}`;
      if (statusKey !== lastStatusKey) {
        log.info('prerequisite status', status);
        lastStatusKey = statusKey;
      }
      return status;
    };
    ctx.effect(() => () => {
      prereqDisposed = true;
      if (prereqTimer !== null) clearTimeout(prereqTimer);
    }, 'codegraph: prereq timer cleanup');
    checkStatus().then(() => {
      if (prereqDisposed) return;
      prereqTimer = setTimeout(() => {
        if (prereqDisposed) return;
        checkStatus().catch((e) => log.warn('prereq delayed check failed', e));
      }, POLLING.PREREQ_INITIAL_DELAY_MS);
    }).catch((e) => log.warn('initial status check failed', e));

    ctx.effect(() => {
      const prereqInterval = setInterval(async () => {
        if (document.hidden) return;
        const s = useGraphStore.getState();
        if (s.prerequisites.codegraph && s.prerequisites.lens) { clearInterval(prereqInterval); return; }
        try { await checkStatus(); } catch (e) { log.warn('prereq polling failed', e); }
      }, POLLING.PREREQ_INTERVAL_MS);
      return () => clearInterval(prereqInterval);
    }, 'codegraph: prereq polling');
  }

  let lastDshWorkspace = '';
  let scanInProgress = false;
  {
    const store = useGraphStore.getState();
    const getWorkspaceAndScan = async () => {
      if (scanInProgress) return;
      scanInProgress = true;
      try {
        const { path: workspacePath, list: wsList } = await fetchWorkspace();
        lastDshWorkspace = workspacePath;
        const s = useGraphStore.getState();
        s.setCurrentWorkspace(workspacePath);
        if (wsList.length > 0) {
          const workspaceInfos = wsList.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p, lastUsed: Date.now() }));
          for (const wi of workspaceInfos) {
            if (!s.workspaceList.some((w) => w.path === wi.path)) { s.addWorkspace(wi.path, wi.name); }
          }
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path: workspacePath } }));
        }
        log.info('auto-import requested', { path: workspacePath });

        const bootstrap = await fetchBootstrap();
        if (bootstrap && bootstrap.topLevelNodes.length > 0) {
          const s2 = useGraphStore.getState();
          s2.setBootstrapData(bootstrap.topLevelNodes, bootstrap.edges, workspacePath, {
            totalNodeCount: bootstrap.metadata.totalNodeCount,
            totalEdgeCount: bootstrap.metadata.totalEdgeCount,
            timestamp: bootstrap.metadata.timestamp,
          });
          log.info('bootstrap data loaded', { rootNodes: bootstrap.topLevelNodes.length, totalNodeCount: bootstrap.metadata.totalNodeCount });
          useGraphStore.getState().setLoading(false);
          useGraphStore.getState().restoreFromUrl().catch((err) => {
            log.warn('URL restore failed', { err });
          });
          return;
        }

        log.info('bootstrap returned no data, showing empty state');
        useGraphStore.getState().setLoading(false);
      } catch (e) {
        log.warn('getWorkspaceAndScan failed', e);
        useGraphStore.getState().setLoading(false);
      } finally {
        scanInProgress = false;
      }
    };

    if (store.nodes.length === 0 && !store.isLoading) { getWorkspaceAndScan(); }

    ctx.effect(() => {
      const workspacePoll = setInterval(async () => {
        if (document.hidden) return;
        try {
          const { path: dshCurrent, list: dshList } = await fetchWorkspace();
          if (dshCurrent && dshCurrent !== lastDshWorkspace) {
            log.info('DSH workspace changed', { from: lastDshWorkspace, to: dshCurrent });
            lastDshWorkspace = dshCurrent;
            const s = useGraphStore.getState();
            s.setCurrentWorkspace(dshCurrent);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path: dshCurrent } }));
            }
          }
          for (const p of dshList) {
            const s = useGraphStore.getState();
            if (!s.workspaceList.some((w) => w.path === p)) { s.addWorkspace(p, p.split(/[\\/]/).pop() ?? p); }
          }
        } catch (e) {
          log.warn('workspace polling failed', e);
        }
      }, POLLING.WORKSPACE_INTERVAL_MS);
      return () => clearInterval(workspacePoll);
    }, 'codegraph: workspace polling');
  }

  if (typeof window !== 'undefined') {
    ctx.effect(() => {
      const refreshListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { incremental?: boolean } | undefined;
        const store = useGraphStore.getState();
        if (store.nodes.length > 0) {
          if (detail?.incremental) {
            fetchGraphDataIncremental(store.lastUpdated)
              .then((data) => { if (data && data.nodes && data.nodes.length > 0) { store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata); } })
              .catch((e) => log.warn('incremental graph fetch failed', e));
          } else {
            store.loadBootstrap().then((ok) => {
              if (!ok) log.warn('bootstrap refresh failed');
            }).catch((e) => log.warn('bootstrap refresh failed', e));
          }
        }
      };

      const openSourceListener = (e: Event) => {
        ctx.emit('codegraph-visualizer/source/open', (e as CustomEvent).detail as { filePath: string; lineNumber: number });
      };

      const importRepoListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { path: string };
        const store = useGraphStore.getState();
        store.setLoading(true);
        store.loadBootstrap().then((ok) => {
          if (!ok) {
            log.warn('import-repo bootstrap failed');
            store.setError('Failed to load code graph data');
          }
          store.setLoading(false);
        }).catch((e) => { log.warn('import-repo failed', e); store.setLoading(false); });
        log.info('import-repo forwarded', { path: detail.path });
      };

      const initGraphListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { path: string };
        const store = useGraphStore.getState();
        store.setInitStatus('initializing');
        requestInit(detail.path).then((result) => {
          if (result) {
            store.setInitStatus(result.success ? 'done' : 'error', result.message);
            if (result.success) {
              store.loadBootstrap().then((ok) => {
                if (!ok) log.warn('post-init bootstrap failed');
              }).catch((e) => log.warn('post-init bootstrap failed', e));
            }
          } else {
            store.setInitStatus('error', 'Request failed');
          }
          log.info('init result', { path: detail.path, success: result?.success });
        }).catch((e) => { log.warn('init-graph failed', e); store.setInitStatus('error', String(e)); });
        log.info('init-graph forwarded', { path: detail.path });
      };

      const toggleWatchListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { enabled: boolean; path: string };
        const store = useGraphStore.getState();
        store.setWatchEnabled(detail.enabled);
        requestWatch(detail.enabled, detail.path).catch((err) => log.warn('toggle-watch request failed', err));
        log.info('toggle-watch forwarded', { enabled: detail.enabled, path: detail.path });
      };

      let workspaceScanTimer: ReturnType<typeof setTimeout> | null = null;
      const workspaceListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { path: string };
        const store = useGraphStore.getState();
        store.setCurrentWorkspace(detail.path);
        if (workspaceScanTimer) clearTimeout(workspaceScanTimer);
        workspaceScanTimer = setTimeout(() => {
          workspaceScanTimer = null;
          store.setLoading(true);
          store.loadBootstrap().then((ok) => {
            if (!ok) {
              log.warn('workspace change bootstrap failed');
              store.setError('Failed to load code graph data');
            }
            store.setLoading(false);
          }).catch((e) => { log.warn('workspace scan failed', e); store.setLoading(false); });
          log.info('workspace change forwarded', { path: detail.path });
        }, POLLING.WORKSPACE_SCAN_DEBOUNCE_MS);
      };

      const installPluginListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { plugin: string };
        log.info('install plugin requested', { plugin: detail.plugin });
      };

      const symbolSelectListener = (e: Event) => {
        const detail = (e as CustomEvent).detail as { symbol?: string; filePath?: string; lineNumber?: number };
        if (detail?.symbol) {
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.SYMBOL_SELECT, { detail }));
        }
      };

      window.addEventListener(DOM_EVENTS.REFRESH, refreshListener);
      window.addEventListener(DOM_EVENTS.OPEN_SOURCE, openSourceListener);
      window.addEventListener(DOM_EVENTS.IMPORT_REPO, importRepoListener);
      window.addEventListener(DOM_EVENTS.INIT_GRAPH, initGraphListener);
      window.addEventListener(DOM_EVENTS.TOGGLE_WATCH, toggleWatchListener);
      window.addEventListener(DOM_EVENTS.WORKSPACE, workspaceListener);
      window.addEventListener(DOM_EVENTS.INSTALL_PLUGIN, installPluginListener);
      window.addEventListener(DOM_EVENTS.EDITOR_SYMBOL_SELECT, symbolSelectListener);

      return () => {
        if (workspaceScanTimer) clearTimeout(workspaceScanTimer);
        window.removeEventListener(DOM_EVENTS.REFRESH, refreshListener);
        window.removeEventListener(DOM_EVENTS.OPEN_SOURCE, openSourceListener);
        window.removeEventListener(DOM_EVENTS.IMPORT_REPO, importRepoListener);
        window.removeEventListener(DOM_EVENTS.INIT_GRAPH, initGraphListener);
        window.removeEventListener(DOM_EVENTS.TOGGLE_WATCH, toggleWatchListener);
        window.removeEventListener(DOM_EVENTS.WORKSPACE, workspaceListener);
        window.removeEventListener(DOM_EVENTS.INSTALL_PLUGIN, installPluginListener);
        window.removeEventListener(DOM_EVENTS.EDITOR_SYMBOL_SELECT, symbolSelectListener);
      };
    }, 'codegraph: window event listeners');
  }

  if (typeof window !== 'undefined') {
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

  if (typeof window !== 'undefined') {
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

  if (typeof window !== 'undefined') {
    ctx.effect(() => {
      const rejectionHandler = (e: PromiseRejectionEvent) => {
        log.warn('unhandled promise rejection', e.reason);
        e.preventDefault();
      };
      window.addEventListener('unhandledrejection', rejectionHandler);
      return () => window.removeEventListener('unhandledrejection', rejectionHandler);
    }, 'codegraph: unhandled rejection handler');
  }

  return () => {
    disposeStore();
    resetI18nListeners();
    resetLoggerListeners();
  };
}


