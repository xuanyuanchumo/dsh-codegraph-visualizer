import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import { GraphIcon } from './components/Icons.tsx';
import { scoped } from '../shared/Logger.ts';
import type { GraphData } from '../types/index.ts';
import { validateGraphData } from './validators.ts';
import { PLUGIN_VERSION } from '../generated/version.ts';
import { fetchStatus, fetchGraphData, fetchWorkspace, requestScan, requestInit, requestWatch } from './api/index.ts';

export { PLUGIN_VERSION };

const log = scoped('client');

export const name = 'dsh-codegraph-visualizer-client';
export const inject = ['slots'];

function SidebarNavButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  return React.createElement('button', {
    onClick,
    className: `cg-sidebar-nav-btn${active ? ' cg-sidebar-nav-btn-active' : ''}`,
    title: 'Code Graph',
    'aria-label': 'Code Graph',
  }, React.createElement(GraphIcon, { size: 18 }));
}

function FloatingGraphPanel({ onClose }: { onClose: () => void }) {
  return React.createElement('div', { className: 'cg-floating-overlay' },
    React.createElement('div', { className: 'cg-floating-panel' },
      React.createElement('div', { className: 'cg-floating-header' },
        React.createElement('span', { className: 'cg-floating-title' }, 'Code Graph'),
        React.createElement('button', {
          onClick: onClose,
          className: 'cg-floating-close',
          'aria-label': 'Close graph panel',
        }, '\u00d7'),
      ),
      React.createElement('div', { className: 'cg-floating-content' },
        React.createElement(GraphPanel),
      ),
    ),
  );
}

export function init(container: HTMLElement, initialData?: GraphData): void {
  const root = ReactDOM.createRoot(container);
  if (initialData) {
    const store = useGraphStore.getState();
    store.setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId, initialData.metadata);
  }
  root.render(React.createElement(GraphPanel));
}

export function apply(ctx: Context) {
  let panelVisible = false;
  let navButtonRegistered = false;
  let renderFloating: () => void = () => {};
  const slotDisposers: Array<() => void> = [];
  const trackSlotDisposer = (d: (() => void) | void): void => {
    if (typeof d === 'function') slotDisposers.push(d);
  };
  ctx.effect(() => () => {
    for (const dispose of slotDisposers) dispose();
    slotDisposers.length = 0;
  }, 'codegraph: slot registrations cleanup');

  const togglePanel = (): void => {
    panelVisible = !panelVisible;
    const container = document.querySelector('.cg-floating-container');
    if (container) {
      container.setAttribute('data-visible', String(panelVisible));
    }
    renderFloating();
  };

  try {
    const betterSidebar = ctx.get('betterSidebar') as Context['betterSidebar'] | undefined;
    if (betterSidebar) {
      const dispose = betterSidebar.registerTab({
        id: 'codegraph-visualizer',
        title: 'Code Graph',
        icon: (size: number) => React.createElement(GraphIcon, { size }),
        order: 50,
        single: true,
        component: ({ visible }: { visible: boolean }) => {
          panelVisible = visible;
          return visible ? React.createElement(GraphPanel) : null;
        },
      });
      ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
      navButtonRegistered = true;
    }
  } catch (e) {
    log.warn('better-sidebar registration failed', e);
  }

  if (!navButtonRegistered) {
    try {
      ctx.slots.inject('sidebar.footer.action', () => {
        trackSlotDisposer(
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'codegraph-visualizer', order: 10, label: () => 'Code Graph' },
            () => React.createElement(SidebarNavButton, { onClick: togglePanel, active: panelVisible }),
          ),
        );
      });
      navButtonRegistered = true;
    } catch (e) {
      log.warn('sidebar.footer.action slot failed', e);
    }
  }

  if (typeof document !== 'undefined') {
    const floatingContainer = document.createElement('div');
    floatingContainer.className = 'cg-floating-container';
    floatingContainer.setAttribute('data-visible', 'false');
    document.body.appendChild(floatingContainer);
    const floatingRoot = ReactDOM.createRoot(floatingContainer);

    renderFloating = () => {
      floatingRoot.render(
        panelVisible
          ? React.createElement(FloatingGraphPanel, { onClose: () => { panelVisible = false; floatingContainer.setAttribute('data-visible', 'false'); renderFloating(); } })
          : null,
      );
    };

    renderFloating();

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
        title: 'Code Graph: Search Symbols',
        handler: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' })); },
      });
      if (typeof d1 === 'function') ctx.effect(() => d1, 'codegraph: spotlight search cmd');
      const d2 = spotlight.registerCommand({
        id: 'codegraph-toggle',
        title: 'Code Graph: Toggle Panel',
        handler: () => togglePanel(),
      });
      if (typeof d2 === 'function') ctx.effect(() => d2, 'codegraph: spotlight toggle cmd');
    }
  } catch (e) {
    log.warn('spotlight registration failed', e);
  }

  {
    let lastStatusKey = '';
    const checkStatus = async () => {
      const status = await fetchStatus();
      const store = useGraphStore.getState();
      store.setPrerequisites({ codegraph: status.codegraph, lens: status.lens });
      const statusKey = `${status.codegraph}:${status.lens}`;
      if (statusKey !== lastStatusKey) {
        log.info('prerequisite status', status);
        lastStatusKey = statusKey;
      }
      return status;
    };
    checkStatus();
    const prereqTimer = setTimeout(checkStatus, 3000);
    ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

    const prereqInterval = setInterval(async () => {
      if (document.hidden) return;
      const s = useGraphStore.getState();
      if (s.prerequisites.codegraph && s.prerequisites.lens) { clearInterval(prereqInterval); return; }
      await checkStatus();
    }, 30000);
    ctx.effect(() => () => clearInterval(prereqInterval), 'codegraph: prereq polling');
  }

  let lastDshWorkspace = '';
  {
    const store = useGraphStore.getState();
    const getWorkspaceAndScan = async () => {
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
        window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path: workspacePath } }));
      }
      log.info('auto-import requested', { path: workspacePath });
      store.setLoading(true);
      try {
        const result = await requestScan(workspacePath);
        if (result && result.success && result.nodes.length > 0) {
          const validated = validateGraphData(result);
          if (validated) {
            const s2 = useGraphStore.getState();
            s2.setGraphData(validated.nodes, validated.edges, workspacePath, validated.metadata);
            log.info('graph data received', { path: workspacePath, nodes: validated.nodes.length, edges: validated.edges.length });
          }
        }
      } finally {
        useGraphStore.getState().setLoading(false);
      }
    };

    if (store.nodes.length === 0 && !store.isLoading) { getWorkspaceAndScan(); }

    const workspacePoll = setInterval(async () => {
      if (document.hidden) return;
      const { path: dshCurrent, list: dshList } = await fetchWorkspace();
      if (dshCurrent && dshCurrent !== lastDshWorkspace) {
        log.info('DSH workspace changed', { from: lastDshWorkspace, to: dshCurrent });
        lastDshWorkspace = dshCurrent;
        const s = useGraphStore.getState();
        s.setCurrentWorkspace(dshCurrent);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path: dshCurrent } }));
        }
      }
      for (const p of dshList) {
        const s = useGraphStore.getState();
        if (!s.workspaceList.some((w) => w.path === p)) { s.addWorkspace(p, p.split(/[\\/]/).pop() ?? p); }
      }
    }, 15000);
    ctx.effect(() => () => clearInterval(workspacePoll), 'codegraph: workspace polling');
  }

  if (typeof window !== 'undefined') {
    const refreshListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { incremental?: boolean } | undefined;
      const store = useGraphStore.getState();
      if (store.nodes.length > 0) {
        if (detail?.incremental) {
          fetch('/api/v1/codegraph/data', { headers: { 'if-none-match': String(store.lastUpdated) } })
            .then((res) => { if (res.status === 304) return null; return res.json(); })
            .then((data) => { if (data && data.nodes && data.nodes.length > 0) { store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata); } })
            .catch((e) => log.warn('incremental graph fetch failed', e));
        } else {
          fetchGraphData().then((data) => { if (data) { store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata); } });
        }
      }
    };

    const openSourceListener = (e: Event) => {
      ctx.emit('cg-viz/source/open', (e as CustomEvent).detail as { filePath: string; lineNumber: number });
    };

    const importRepoListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string };
      const store = useGraphStore.getState();
      store.setLoading(true);
      requestScan(detail.path).then((result) => {
        if (result && result.success && result.nodes.length > 0) {
          const validated = validateGraphData(result);
          if (validated) {
            store.setGraphData(validated.nodes, validated.edges, detail.path, validated.metadata);
            log.info('import-repo completed', { path: detail.path, nodes: validated.nodes.length });
          }
        }
        store.setLoading(false);
      });
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
            fetchGraphData().then((data) => {
              if (data) { store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata); }
            });
          }
        } else {
          store.setInitStatus('error', 'Request failed');
        }
        log.info('init result', { path: detail.path, success: result?.success });
      });
      log.info('init-graph forwarded', { path: detail.path });
    };

    const toggleWatchListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { enabled: boolean; path: string };
      const store = useGraphStore.getState();
      store.setWatchEnabled(detail.enabled);
      requestWatch(detail.enabled, detail.path);
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
        requestScan(detail.path).then((result) => {
          if (result && result.success && result.nodes.length > 0) {
            const validated = validateGraphData(result);
            if (validated) { store.setGraphData(validated.nodes, validated.edges, detail.path, validated.metadata); }
          }
          store.setLoading(false);
        });
        log.info('workspace change forwarded', { path: detail.path });
      }, 300);
    };

    const installPluginListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { plugin: string };
      log.info('install plugin requested', { plugin: detail.plugin });
    };

    window.addEventListener('codegraph:refresh', refreshListener);
    window.addEventListener('codegraph:open-source', openSourceListener);
    window.addEventListener('codegraph:import-repo', importRepoListener);
    window.addEventListener('codegraph:init-graph', initGraphListener);
    window.addEventListener('codegraph:toggle-watch', toggleWatchListener);
    window.addEventListener('codegraph:workspace', workspaceListener);
    window.addEventListener('codegraph:install-plugin', installPluginListener);

    const symbolSelectListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { symbol?: string; filePath?: string; lineNumber?: number };
      if (detail?.symbol) {
        window.dispatchEvent(new CustomEvent('codegraph:symbol-select', { detail }));
      }
    };
    window.addEventListener('dsh:editor-symbol-select', symbolSelectListener);

    ctx.effect(() => () => {
      window.removeEventListener('codegraph:refresh', refreshListener);
      window.removeEventListener('codegraph:open-source', openSourceListener);
      window.removeEventListener('codegraph:import-repo', importRepoListener);
      window.removeEventListener('codegraph:init-graph', initGraphListener);
      window.removeEventListener('codegraph:toggle-watch', toggleWatchListener);
      window.removeEventListener('codegraph:workspace', workspaceListener);
      window.removeEventListener('codegraph:install-plugin', installPluginListener);
      window.removeEventListener('dsh:editor-symbol-select', symbolSelectListener);
    }, 'codegraph: window event listeners');
  }
}


