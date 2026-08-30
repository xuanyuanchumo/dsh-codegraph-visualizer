import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import { GraphIcon } from './components/Icons.tsx';
import { scoped } from './services/Logger.ts';
import type { GraphUpdatedEvent, GraphDataEvent, GraphData } from '../types/index.ts';

const log = scoped('client');

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject: (slotName: string, callback: () => void) => void;
      register: (options: { name: string; id: string; order?: number; label?: () => string }, component?: unknown) => void;
    };
    // Optional services — accessed via ctx.get(), not inject (cordis optional pattern).
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
      }) => void;
    };
  }
}

interface ModuleLoader {
  load(registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }): void;
}

declare const __ModuleLoader__: ModuleLoader | undefined;

export const name = 'dsh-codegraph-visualizer-client';
export const inject = ['slots'];

// Standalone initialization for dev server / testing environments.
export function init(container: HTMLElement, initialData?: GraphData): void {
  const root = ReactDOM.createRoot(container);
  if (initialData) {
    const store = useGraphStore.getState();
    store.setGraphData(initialData.nodes, initialData.edges, initialData.metadata.repoId);
  }
  root.render(React.createElement(GraphPanel));
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

  // (1) better-sidebar tab — use ctx.get() for optional service detection
  //     (cordis pattern: ctx.get returns undefined if service not provided).
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
        component: (props: { visible: boolean }) =>
          props.visible ? React.createElement(GraphPanel) : null,
      });
      ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
      entryRegistered = true;
    }
  } catch {
    // best-effort; fall through to slot registration
  }

  // (2) sidebar.footer.action — quick-access button in sidebar footer
  if (!entryRegistered) {
    try {
      ctx.slots.inject('sidebar.footer.action', () => {
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'codegraph-visualizer',
            order: 10,
            label: () => 'Code Graph',
          },
          GraphPanel,
        );
      });
      entryRegistered = true;
    } catch {
      // slot not available; fall through
    }
  }

  // (3) settings.section — always register as a fallback in Settings dialog
  try {
    ctx.slots.inject('settings.section', () => {
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'codegraph-visualizer',
          order: 50,
          label: () => 'Code Graph',
        },
        GraphPanel,
      );
    });
  } catch {
    // best-effort
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
    });
  }

  // ── Optional: spotlight commands ───────────────────────────────────
  try {
    const spotlight = ctx.get('spotlight') as Context['spotlight'] | undefined;
    if (spotlight) {
      spotlight.registerCommand({
        id: 'codegraph-search',
        title: 'Code Graph: Search Symbols',
        handler: () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
        },
      });
      spotlight.registerCommand({
        id: 'codegraph-toggle',
        title: 'Code Graph: Toggle Panel',
        handler: () => {
          const panel = document.querySelector('.graph-panel');
          panel?.dispatchEvent(new MouseEvent('click'));
        },
      });
    }
  } catch {
    // best-effort
  }


  // Heat-update: when the host signals a graph update, mark loading for the matching repo.
  ctx.on('codegraph/graph/updated', (event: GraphUpdatedEvent) => {
    const store = useGraphStore.getState();
    if (store.repoId === event.repoId || store.repoId === null) {
      store.setLoading(true);
    }
  });

  // Full data push: when the host sends complete graph data, load it into the store.
  ctx.on('codegraph/graph/data', (event: GraphDataEvent) => {
    const store = useGraphStore.getState();
    store.setGraphData(event.nodes, event.edges, event.repoId);
    log.info('graph data received', { repoId: event.repoId, nodes: event.nodes.length, edges: event.edges.length });
  });

  // Client-side event listeners for panel-initiated actions. Native window
  // listeners are registered through ctx.effect() so they are removed when
  // the plugin fiber disposes (red line 1: register-as-effect, J13 no-leak).
  if (typeof window !== 'undefined') {
    const refreshListener = () => {
      // Only mark loading when we already have data (refresh); avoid stuck
      // loading when no data source answers the initial auto-import.
      const store = useGraphStore.getState();
      if (store.nodes.length > 0) {
        store.setLoading(true);
      }
    };

    const openSourceListener = (e: Event) => {
      ctx.emit('codegraph/source/open', (e as CustomEvent).detail as { filePath: string; lineNumber: number });
    };

    const importRepoListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string };
      ctx.emit('codegraph/repo/request-scan', { path: detail.path, timestamp: Date.now() });
      log.info('import-repo forwarded', { path: detail.path });
    };

    window.addEventListener('codegraph:refresh', refreshListener);
    window.addEventListener('codegraph:open-source', openSourceListener);
    window.addEventListener('codegraph:import-repo', importRepoListener);
    ctx.effect(() => () => {
      window.removeEventListener('codegraph:refresh', refreshListener);
      window.removeEventListener('codegraph:open-source', openSourceListener);
      window.removeEventListener('codegraph:import-repo', importRepoListener);
    });
  }

  // Auto-import: on first load, if no graph data is present, request a scan of
  // the current workspace. Best-effort — if no data source answers, the panel
  // simply shows the empty state with an Import button.
  const store = useGraphStore.getState();
  if (store.nodes.length === 0 && !store.isLoading) {
    const workspacePath = (typeof window !== 'undefined' &&
      (window as unknown as { __DSH_WORKSPACE__?: string }).__DSH_WORKSPACE__) || '.';
    log.info('auto-import requested', { path: workspacePath });
    ctx.emit('codegraph/repo/request-scan', { path: workspacePath, timestamp: Date.now() });
  }
}

// DSH web loads the client bundle via a classic <script> tag and expects
// window.__ModuleLoader__.load({ id, factory: (require) => {...} }). The
// build:client post-processing script (scripts/wrap-client-bundle.mjs)
// wraps the CJS bundle in this signature; the ESM build (index.esm.js)
// is used only by the dev server. Do NOT call __ModuleLoader__ here —
// the wrapper script owns the registration.
