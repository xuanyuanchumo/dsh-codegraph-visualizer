import { watch } from 'node:fs';
import { platform } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';
import { WATCHER, ERROR_CODES } from '../shared/constants.ts';
import { fetchMergedGraph } from '../tools.ts';
import { RepoId } from '../types/index.ts';
import type { VisualizerConfig } from './config.ts';

const log = scoped('host');
const supportsRecursive = platform() === 'win32' || platform() === 'darwin';

async function scanAndPush(
  ctx: Context,
  invokeUpstream: (tool: string, args: Record<string, unknown>) => Promise<unknown | null>,
  path: string,
): Promise<void> {
  log.info('scan requested', { path });
  try {
    const repoId = path || 'workspace-default';
    const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
    ctx.emit('codegraph-visualizer/graph/updated', {
      repoId: RepoId(repoId),
      nodeCount: data.metadata.nodeCount,
      edgeCount: data.metadata.edgeCount,
      timestamp: data.metadata.timestamp,
    });
    ctx.emit('codegraph-visualizer/graph/data', {
      repoId: RepoId(repoId),
      nodes: data.nodes,
      edges: data.edges,
      timestamp: data.metadata.timestamp,
    });
    log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
  } catch (e) {
    log.error('scan failed', e);
  }
}

export function registerWatcher(ctx: Context, config: VisualizerConfig, invokeUpstream: (tool: string, args: Record<string, unknown>) => Promise<unknown | null>): void {
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let activeWatcher: { close: () => void } | null = null;
  let retryCount = 0;
  const MAX_RETRIES = WATCHER.MAX_RETRIES;
  const RETRY_BASE_DELAY = WATCHER.RETRY_BASE_DELAY_MS;

  const closeActiveWatcher = (): void => {
    if (activeWatcher) {
      try { activeWatcher.close(); } catch (e) { log.warn('Failed to close watcher', e); }
      activeWatcher = null;
    }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  };

  const setupWatch = (watchPath: string): void => {
    try {
      const watchOpts = supportsRecursive ? { recursive: true } : {};
      activeWatcher = watch(watchPath, watchOpts, (_eventType: string, filename: string | null) => {
        if (!filename) return;
        const segments = filename.split(/[\\/]/);
        if (segments.includes('.codegraph')) return;
        if (segments.includes('node_modules')) return;
        if (segments.includes('.git')) return;

        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          if (!activeWatcher) return;
          log.info('file changed, syncing + re-scanning', { filename });
          invokeUpstream('codegraph_sync', { path: watchPath })
            .then(() => scanAndPush(ctx, invokeUpstream, watchPath))
            .catch((e) => log.error('watch re-scan failed', e));
        }, config.watchDebounce);
      });
      retryCount = 0;
    } catch (e) {
      log.error('watch setup failed', e);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount - 1);
        log.info('retrying watch setup', { retryCount, delay, path: watchPath });
        setTimeout(() => setupWatch(watchPath), delay);
      } else {
        log.error('watch setup exhausted retries', { path: watchPath });
        ctx.emit('codegraph-visualizer/watch/error', { path: watchPath, message: 'Watch setup failed after retries', errorCode: ERROR_CODES.WATCH_SETUP_FAILED, timestamp: Date.now() });
      }
    }
  };

  ctx.effect(() => {
    const dispose = ctx.on('codegraph-visualizer/watch/toggle', (event) => {
      closeActiveWatcher();

      if (!event.enabled) {
        log.info('watch disabled');
        return;
      }

      log.info('watch enabled', { path: event.path });
      retryCount = 0;
      setupWatch(event.path);
    });
    return () => {
      dispose();
      closeActiveWatcher();
    };
  }, 'codegraph: watch toggle listener');
}

export function registerEventListeners(ctx: Context, invokeUpstream: (tool: string, args: Record<string, unknown>) => Promise<unknown | null>): void {
  ctx.effect(() => ctx.on('codegraph-visualizer/repo/imported', (event) => {
    ctx.emit('codegraph-visualizer/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo imported listener');

  ctx.effect(() => ctx.on('codegraph-visualizer/repo/scanned', (event) => {
    ctx.emit('codegraph-visualizer/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo scanned listener');

  ctx.effect(() => ctx.on('codegraph-visualizer/repo/request-scan', async (event) => {
    await scanAndPush(ctx, invokeUpstream, event.path);
  }), 'codegraph: repo request-scan listener');

  ctx.effect(() => ctx.on('codegraph-visualizer/graph/init', async (event) => {
    log.info('init requested', { path: event.path });
    try {
      const result = await invokeUpstream('codegraph_init', { path: event.path, force: true });
      const success = result !== null;
      const initResult: { success: boolean; path: string; message: string; errorCode?: string; timestamp: number } = {
        success,
        path: event.path,
        message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
        timestamp: Date.now(),
      };
      if (!success) initResult.errorCode = ERROR_CODES.INIT_FAILED;
      ctx.emit('codegraph-visualizer/graph/init-result', initResult);
      if (success) {
        await scanAndPush(ctx, invokeUpstream, event.path);
      }
    } catch (e) {
      log.warn('graph init failed', e);
      ctx.emit('codegraph-visualizer/graph/init-result', {
        success: false,
        path: event.path,
        message: 'Initialization failed',
        errorCode: ERROR_CODES.INIT_FAILED,
        timestamp: Date.now(),
      });
    }
  }), 'codegraph: graph init listener');
}