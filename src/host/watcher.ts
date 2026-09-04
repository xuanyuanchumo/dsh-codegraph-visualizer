import { watch } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';
import { fetchMergedGraph } from '../tools.ts';
import type { VisualizerConfig } from './config.ts';

const log = scoped('host');

let watchTimer: ReturnType<typeof setTimeout> | null = null;
let activeWatcher: { close: () => void } | null = null;

function closeActiveWatcher(): void {
  if (activeWatcher) {
    try { activeWatcher.close(); } catch { /* best-effort */ }
    activeWatcher = null;
  }
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
}

export function registerWatcher(ctx: Context, config: VisualizerConfig, invokeUpstream: (tool: string, args: Record<string, unknown>) => Promise<unknown | null>): void {
  const scanAndPush = async (path: string) => {
    log.info('scan requested', { path });
    try {
      const repoId = path || `workspace-${Date.now()}`;
      const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
      ctx.emit('codegraph/graph/updated', {
        repoId,
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        timestamp: data.metadata.timestamp,
      });
      ctx.emit('codegraph/graph/data', {
        repoId,
        nodes: data.nodes,
        edges: data.edges,
        timestamp: data.metadata.timestamp,
      });
      log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
    } catch (e) {
      log.error('scan failed', e);
    }
  };

  ctx.effect(() => {
    const dispose = ctx.on('codegraph/watch/toggle', (event) => {
      closeActiveWatcher();

      if (!event.enabled) {
        log.info('watch disabled');
        return;
      }

      log.info('watch enabled', { path: event.path });
      try {
        activeWatcher = watch(event.path, { recursive: true }, (_eventType: string, filename: string | null) => {
          if (filename && filename.includes('.codegraph')) return;
          if (filename && filename.includes('node_modules')) return;
          if (filename && filename.includes('.git')) return;

          if (watchTimer) clearTimeout(watchTimer);
          watchTimer = setTimeout(() => {
            watchTimer = null;
            log.info('file changed, syncing + re-scanning', { filename });
            invokeUpstream('codegraph_sync', { path: event.path })
              .then(() => scanAndPush(event.path))
              .catch((e) => log.error('watch re-scan failed', e));
          }, config.watchDebounce);
        });
      } catch (e) {
        log.error('watch setup failed', e);
      }
    });
    return () => {
      dispose();
      closeActiveWatcher();
    };
  }, 'codegraph: watch toggle listener');
}

export function registerEventListeners(ctx: Context, invokeUpstream: (tool: string, args: Record<string, unknown>) => Promise<unknown | null>): void {
  const scanAndPush = async (path: string) => {
    log.info('scan requested', { path });
    try {
      const repoId = path || `workspace-${Date.now()}`;
      const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
      ctx.emit('codegraph/graph/updated', {
        repoId,
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        timestamp: data.metadata.timestamp,
      });
      ctx.emit('codegraph/graph/data', {
        repoId,
        nodes: data.nodes,
        edges: data.edges,
        timestamp: data.metadata.timestamp,
      });
      log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
    } catch (e) {
      log.error('scan failed', e);
    }
  };

  ctx.effect(() => ctx.on('codegraph/repo/imported', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo imported listener');

  ctx.effect(() => ctx.on('codegraph/repo/scanned', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo scanned listener');

  ctx.effect(() => ctx.on('codegraph/repo/request-scan', async (event) => {
    await scanAndPush(event.path);
  }), 'codegraph: repo request-scan listener');

  ctx.effect(() => ctx.on('codegraph/graph/init', async (event) => {
    log.info('init requested', { path: event.path });
    try {
      const result = await invokeUpstream('codegraph_init', { path: event.path, force: true });
      const success = result !== null;
      ctx.emit('codegraph/graph/init-result', {
        success,
        path: event.path,
        message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
        timestamp: Date.now(),
      });
      if (success) {
        await scanAndPush(event.path);
      }
    } catch (e) {
      ctx.emit('codegraph/graph/init-result', {
        success: false,
        path: event.path,
        message: e instanceof Error ? e.message : String(e),
        timestamp: Date.now(),
      });
    }
  }), 'codegraph: graph init listener');
}