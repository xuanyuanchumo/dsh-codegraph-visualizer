import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Context } from '@deepseek-ai/cordis';
import { GraphPanel } from './GraphPanel.tsx';
import { useGraphStore } from './store/graphStore.ts';
import type { GraphUpdatedEvent, GraphData } from '../types/index.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      register: (key: string, spec: { id: string; render: () => React.ReactNode }) => void;
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
  load(id: string, factory: () => Record<string, unknown>): void;
  register(registration: { id: string; factory: () => Record<string, unknown> }): void;
}

declare const __ModuleLoader__: ModuleLoader | undefined;

export const name = 'dsh-codegraph-visualizer-client';
export const inject = ['slots', '?betterSidebar', '?spotlight'];

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
  // Primary: register as a shell overlay panel.
  ctx.slots.register('shell.overlay', {
    id: 'codegraph-visualizer-panel',
    render: () => React.createElement(GraphPanel),
  });

  // CR-01: Register as a sidebar tab if dsh-better-sidebar is available.
  if (ctx.betterSidebar) {
    try {
      ctx.betterSidebar.registerTab({
        id: 'codegraph-visualizer',
        label: 'Code Graph',
        icon: '📊',
        render: () => React.createElement(GraphPanel),
      });
    } catch {
      // Sidebar registration is best-effort; ignore failures.
    }
  }

  // CR-03: Register spotlight command if dsh-spotlight is available.
  if (ctx.spotlight) {
    try {
      ctx.spotlight.registerCommand({
        id: 'codegraph-search',
        title: 'Code Graph: Search Symbols',
        handler: () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
        },
      });
      ctx.spotlight.registerCommand({
        id: 'codegraph-toggle',
        title: 'Code Graph: Toggle Panel',
        handler: () => {
          const panel = document.querySelector('.graph-panel');
          panel?.dispatchEvent(new MouseEvent('click'));
        },
      });
    } catch {
      // Spotlight registration is best-effort.
    }
  }

  // Heat-update: when the host signals a graph update, mark loading for the matching repo.
  ctx.on('codegraph/graph/updated', (event: GraphUpdatedEvent) => {
    const store = useGraphStore.getState();
    if (store.repoId === event.repoId) {
      store.setLoading(true);
    }
  });

  // Client-side event listeners for panel-initiated actions.
  if (typeof window !== 'undefined') {
    window.addEventListener('codegraph:refresh', () => {
      const store = useGraphStore.getState();
      store.setLoading(true);
    });

    window.addEventListener('codegraph:open-source', ((e: CustomEvent) => {
      // Delegate to the host shell to open the source file in the editor.
      // The host listens for this event and invokes the editor's jump-to-line API.
      ctx.emit('codegraph/source/open', e.detail as { filePath: string; lineNumber: number });
    }) as EventListener);
  }
}

// Register with DSH module loader so the client bundle can be discovered
// by the page's module registry and wired into the shell.
if (typeof __ModuleLoader__ !== 'undefined') {
  __ModuleLoader__.load('dsh-codegraph-visualizer', () => ({
    name,
    inject,
    apply,
  }));
}
