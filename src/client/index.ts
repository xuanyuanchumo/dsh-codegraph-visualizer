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

export { PLUGIN_VERSION };

const log = scoped('client');

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject: (slotName: string, callback: () => void) => void;
      register: (options: { name: string; id: string; order?: number; label?: () => string }, component?: unknown) => (() => void) | void;
    };
    betterSidebar?: {
      registerTab: (descriptor: {
        id: string;
        title: string | (() => string);
        icon?: unknown;
        order?: number;
        single?: boolean;
        component: (props: { visible: boolean }) => React.ReactNode;
      }) => () => void;
      openTab: (seed: { type: string }) => void;
    };
    spotlight?: {
      registerCommand: (cmd: {
        id: string;
        title: string;
        handler: () => void;
      }) => (() => void) | void;
    };
  }
}


export const name = 'dsh-codegraph-visualizer-client';
export const inject = ['slots'];

// Standalone initialization for dev server / testing environments.
export function init(container: HTMLElement, initialData?: GraphData): void {
  const root = ReactDOM.createRoot(container);
  if (initialData) {
    const store = useGraphStore.getState();
    store.setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId, initialData.metadata);
  }
  root.render(React.createElement(GraphPanel));
}

// ── HTTP API helpers ──────────────────────────────────────────────────
// The client communicates with the Host via HTTP fetch() calls to routes
// registered by the Host-side plugin on the DSH webServer. ctx.emit/ctx.on
// is local-only (same process) and cannot cross the Host-Client boundary.

async function fetchStatus(): Promise<{ codegraph: boolean; lens: boolean }> {
  try {
    const res = await fetch('/api/codegraph/status');
    if (!res.ok) return { codegraph: false, lens: false };
    return await res.json();
  } catch (e) {
    log.warn('fetchStatus failed', e);
    return { codegraph: false, lens: false };
  }
}

async function fetchGraphData(): Promise<GraphData | null> {
  try {
    const res = await fetch('/api/codegraph/data');
    if (!res.ok) return null;
    return validateGraphData(await res.json());
  } catch (e) {
    log.warn('fetchGraphData failed', e);
    return null;
  }
}

async function fetchWorkspace(): Promise<{ path: string; list: string[] }> {
  try {
    const res = await fetch('/api/codegraph/workspace');
    if (!res.ok) return { path: '.', list: [] };
    const data = await res.json() as { path?: string; list?: string[] };
    return { path: data.path ?? '.', list: data.list ?? [] };
  } catch (e) {
    log.warn('fetchWorkspace failed', e);
    return { path: '.', list: [] };
  }
}

async function requestScan(path: string, maxNodes?: number): Promise<{ success: boolean; nodes: unknown[]; edges: unknown[]; metadata?: Record<string, unknown> } | null> {
  try {
    const res = await fetch('/api/codegraph/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, maxNodes }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestScan failed', e);
    return null;
  }
}

async function requestInit(path: string): Promise<{ success: boolean; message: string } | null> {
  try {
    const res = await fetch('/api/codegraph/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('requestInit failed', e);
    return null;
  }
}



async function requestWatch(enabled: boolean, path: string): Promise<boolean> {
  try {
    const res = await fetch('/api/codegraph/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, path }),
    });
    return res.ok;
  } catch (e) {
    log.warn('requestWatch failed', e);
    return false;
  }
}

export function apply(ctx: Context) {
  // ── Entry-point strategy (priority order) ──────────────────────────
  // 1. better-sidebar tab  — when dsh-better-sidebar is installed, register
  //    as a first-class sidebar tab (icon in the + menu, panel in the sidebar).
  // 2. sidebar.footer.action — when no better-sidebar, add a quick-access
  //    button in the sidebar footer (next to Settings).
  // 3. settings.section      — always also register in Settings as a fallback.
  // 4. direct DOM mount      — last resort if slots reject us.

  let entryRegistered = false;

  // Slot registrations happen lazily inside slot callbacks; collect their
  // disposers so the fiber-level cleanup can revoke them on plugin unload
  // (red line 1: every registration returns/is tracked as a disposer).
  const slotDisposers: Array<() => void> = [];
  const trackSlotDisposer = (d: (() => void) | void): void => {
    if (typeof d === 'function') slotDisposers.push(d);
  };
  ctx.effect(() => () => {
    for (const dispose of slotDisposers) dispose();
    slotDisposers.length = 0;
  }, 'codegraph: slot registrations cleanup');

  function CodeGraphTab({ visible }: { visible: boolean }) {
    return visible ? React.createElement(GraphPanel) : null;
  }

  // (1) better-sidebar tab — use ctx.get() for optional service detection
  try {
    const betterSidebar = ctx.get('betterSidebar') as Context['betterSidebar'] | undefined;
    if (betterSidebar) {
      const dispose = betterSidebar.registerTab({
        id: 'codegraph-visualizer',
        title: 'Code Graph',
        icon: (size: number) =>
          React.createElement(GraphIcon, { size }),
        order: 50,
        single: true,
        component: CodeGraphTab,
      });
      ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
      entryRegistered = true;
    }
  } catch (e) {
    log.warn('better-sidebar registration failed', e);
  }

  // (2) sidebar.footer.action — quick-access button in sidebar footer
  if (!entryRegistered) {
    try {
      ctx.slots.inject('sidebar.footer.action', () => {
        trackSlotDisposer(
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'codegraph-visualizer',
              order: 10,
              label: () => 'Code Graph',
            },
            GraphPanel,
          ),
        );
      });
      entryRegistered = true;
    } catch (e) {
      log.warn('sidebar.footer.action slot failed', e);
    }
  }

  // (3) settings.section — always register as a fallback in Settings dialog
  try {
    ctx.slots.inject('settings.section', () => {
      trackSlotDisposer(
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'codegraph-visualizer',
            order: 50,
            label: () => 'Code Graph',
          },
          GraphPanel,
        ),
      );
    });
  } catch (e) {
    log.warn('settings.section slot failed', e);
  }

  // (4) Direct DOM mount — last resort if no slot accepted us
  if (!entryRegistered && typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.className = 'codegraph-visualizer-root';
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    root.render(React.createElement(GraphPanel));
    ctx.effect(() => () => {
      root.unmount();
      container.remove();
    }, 'codegraph: direct DOM mount');
  }

  // ── Optional: spotlight commands ───────────────────────────────────
  try {
    const spotlight = ctx.get('spotlight') as Context['spotlight'] | undefined;
    if (spotlight) {
      const d1 = spotlight.registerCommand({
        id: 'codegraph-search',
        title: 'Code Graph: Search Symbols',
        handler: () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
        },
      });
      if (typeof d1 === 'function') ctx.effect(() => d1, 'codegraph: spotlight search cmd');
      const d2 = spotlight.registerCommand({
        id: 'codegraph-toggle',
        title: 'Code Graph: Toggle Panel',
        handler: () => {
          const panel = document.querySelector('.graph-panel');
          panel?.dispatchEvent(new MouseEvent('click'));
        },
      });
      if (typeof d2 === 'function') ctx.effect(() => d2, 'codegraph: spotlight toggle cmd');
    }
  } catch (e) {
    log.warn('spotlight registration failed', e);
  }

  // ── Prerequisite status check via HTTP ─────────────────────────────
  // Poll the Host for prerequisite status until both are installed or
  // the plugin is disposed.
  {
    const checkStatus = async () => {
      const status = await fetchStatus();
      const store = useGraphStore.getState();
      store.setPrerequisites({ codegraph: status.codegraph, lens: status.lens });
      log.info('prerequisite status', status);
      return status;
    };
    checkStatus();
    // Re-check after a delay — upstream plugins may register later.
    const prereqTimer = setTimeout(checkStatus, 3000);
    ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

    // Poll every 10s when prerequisites are missing.
    const prereqInterval = setInterval(async () => {
      if (document.hidden) return;
      const s = useGraphStore.getState();
      if (s.prerequisites.codegraph && s.prerequisites.lens) {
        clearInterval(prereqInterval);
        return;
      }
      await checkStatus();
    }, 10000);
    ctx.effect(() => () => clearInterval(prereqInterval), 'codegraph: prereq polling');
  }

  // ── Auto-import: fetch graph data on first load ────────────────────
  // On first load, if no graph data is present, request a scan of the
  // current workspace. Best-effort — if no data source answers, the panel
  // simply shows the empty state with an Import button.
  let lastDshWorkspace = '';
  {
    const store = useGraphStore.getState();
    const getWorkspaceAndScan = async () => {
      const { path: workspacePath, list: wsList } = await fetchWorkspace();
      lastDshWorkspace = workspacePath;
      const s = useGraphStore.getState();
      s.setCurrentWorkspace(workspacePath);
      if (wsList.length > 0) {
        const workspaceInfos = wsList.map((p) => ({
          path: p,
          name: p.split(/[\\/]/).pop() ?? p,
          lastUsed: Date.now(),
        }));
        for (const wi of workspaceInfos) {
          if (!s.workspaceList.some((w) => w.path === wi.path)) {
            s.addWorkspace(wi.path, wi.name);
          }
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path: workspacePath } }));
      }
      log.info('auto-import requested', { path: workspacePath });
      store.setLoading(true);
      const result = await requestScan(workspacePath);
      if (result && result.success && result.nodes.length > 0) {
        const validated = validateGraphData(result);
        if (validated) {
          const s2 = useGraphStore.getState();
          s2.setGraphData(validated.nodes, validated.edges, workspacePath, validated.metadata);
          log.info('graph data received', { path: workspacePath, nodes: validated.nodes.length, edges: validated.edges.length });
        }
      }
      useGraphStore.getState().setLoading(false);
    };

    if (store.nodes.length === 0 && !store.isLoading) {
      getWorkspaceAndScan();
    }

    // ── DSH workspace change detection ────────────────────────────────
    // Poll DSH workspace every 5s. When DSH main window switches workspace,
    // sync the plugin's currentWorkspace and trigger re-scan.
    // Plugin-internal workspace switches do NOT affect DSH main window.
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
        if (!s.workspaceList.some((w) => w.path === p)) {
          s.addWorkspace(p, p.split(/[\\/]/).pop() ?? p);
        }
      }
    }, 5000);
    ctx.effect(() => () => clearInterval(workspacePoll), 'codegraph: workspace polling');
  }

  // ── Client-side event listeners for panel-initiated actions ────────
  // Native window listeners are registered through ctx.effect() so they
  // are removed when the plugin fiber disposes (red line 1: register-as-effect).
  if (typeof window !== 'undefined') {
    const refreshListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { incremental?: boolean } | undefined;
      const store = useGraphStore.getState();
      if (store.nodes.length > 0) {
        if (detail?.incremental) {
          fetch('/api/codegraph/data', { headers: { 'if-none-match': String(store.lastUpdated) } })
            .then((res) => {
              if (res.status === 304) return null;
              return res.json();
            })
            .then((data) => {
              if (data && data.nodes && data.nodes.length > 0) {
                store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
              }
            })
            .catch((e) => log.warn('incremental graph fetch failed', e));
        } else {
          fetchGraphData().then((data) => {
            if (data) {
              store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
            }
          });
        }
      }
    };

    const openSourceListener = (e: Event) => {
      ctx.emit('codegraph/source/open', (e as CustomEvent).detail as { filePath: string; lineNumber: number });
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
            // After successful init, fetch the fresh graph data
            fetchGraphData().then((data) => {
              if (data) {
                store.setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
              }
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
            if (validated) {
              store.setGraphData(validated.nodes, validated.edges, detail.path, validated.metadata);
            }
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
    ctx.effect(() => () => {
      window.removeEventListener('codegraph:refresh', refreshListener);
      window.removeEventListener('codegraph:open-source', openSourceListener);
      window.removeEventListener('codegraph:import-repo', importRepoListener);
      window.removeEventListener('codegraph:init-graph', initGraphListener);
      window.removeEventListener('codegraph:toggle-watch', toggleWatchListener);
      window.removeEventListener('codegraph:workspace', workspaceListener);
      window.removeEventListener('codegraph:install-plugin', installPluginListener);
    }, 'codegraph: window event listeners');
  }
}

// DSH web loads the client bundle via a classic <script> tag and expects
// window.__ModuleLoader__.load({ id, factory: (require) => {...} }). The
// build:client post-processing script (scripts/wrap-client-bundle.mjs)
// wraps the CJS bundle in this signature; the ESM build (index.esm.js)
// is used only by the dev server. Do NOT call __ModuleLoader__ here —
// the wrapper script owns the registration.
