import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import type { GraphUpdatedEvent, GraphData } from '../types/index.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject: (slotName: string, callback: () => void) => void;
      register: (options: { name: string; id: string; order?: number; label?: () => string }, component?: unknown) => void;
    };
    // Optional: dsh-better-sidebar integration (graceful degradation if absent).
    betterSidebar?: {
      registerTab: (tab: {
        id: string;
        label: string;
        icon?: string;
        render: () => React.ReactNode;
      }) => void;
    };
    // Optional: dsh-spotlight command integration.
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
  // Primary: register as a shell overlay panel. DSH web's slots API uses
  // ctx.slots.inject(slotName, () => ctx.slots.register({name, id, ...}, Component)).
  // Wrap in try-catch so activation never fails on slot mismatch; fall back
  // to direct DOM mount if the slot system rejects the registration.
  let mounted = false;
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
    mounted = true;
  } catch {
    // Slot registration is best-effort; fall through to DOM mount.
  }

  // Fallback: mount directly into the document body if no slot accepted us.
  if (!mounted && typeof document !== 'undefined') {
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

  // CR-01: Register as a sidebar tab if dsh-better-sidebar is available.
  try {
    const betterSidebar = (ctx as unknown as Record<string, unknown>).betterSidebar as
      | { registerTab: (tab: { id: string; label: string; icon?: string; render: () => React.ReactNode }) => void }
      | undefined;
    if (betterSidebar) {
      betterSidebar.registerTab({
        id: 'codegraph-visualizer',
        label: 'Code Graph',
        icon: '📊',
        render: () => React.createElement(GraphPanel),
      });
    }
  } catch {
    // Sidebar registration is best-effort; ignore failures.
  }

  // CR-03: Register spotlight command if dsh-spotlight is available.
  try {
    const spotlight = (ctx as unknown as Record<string, unknown>).spotlight as
      | { registerCommand: (cmd: { id: string; title: string; handler: () => void }) => void }
      | undefined;
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
    // Spotlight registration is best-effort.
  }


  // Heat-update: when the host signals a graph update, mark loading for the matching repo.
  ctx.on('codegraph/graph/updated', (event: GraphUpdatedEvent) => {
    const store = useGraphStore.getState();
    if (store.repoId === event.repoId) {
      store.setLoading(true);
    }
  });

  // Client-side event listeners for panel-initiated actions. Native window
  // listeners are registered through ctx.effect() so they are removed when
  // the plugin fiber disposes (red line 1: register-as-effect, J13 no-leak).
  if (typeof window !== 'undefined') {
    const refreshListener = () => {
      const store = useGraphStore.getState();
      store.setLoading(true);
    };

    const openSourceListener = (e: Event) => {
      // Delegate to the host shell to open the source file in the editor.
      // The host listens for this event and invokes the editor's jump-to-line API.
      ctx.emit('codegraph/source/open', (e as CustomEvent).detail as { filePath: string; lineNumber: number });
    };

    window.addEventListener('codegraph:refresh', refreshListener);
    window.addEventListener('codegraph:open-source', openSourceListener);
    ctx.effect(() => () => {
      window.removeEventListener('codegraph:refresh', refreshListener);
      window.removeEventListener('codegraph:open-source', openSourceListener);
    });
  }
}

// DSH web loads the client bundle via a classic <script> tag and expects
// window.__ModuleLoader__.load({ id, factory: (require) => {...} }). The
// build:client post-processing script (scripts/wrap-client-bundle.mjs)
// wraps the CJS bundle in this signature; the ESM build (index.esm.js)
// is used only by the dev server. Do NOT call __ModuleLoader__ here —
// the wrapper script owns the registration.
