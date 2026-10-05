import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { fetchGraphDataIncremental, requestInit, requestWatch } from '../api/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { applyScopedGraphPayload } from './repoScope.ts';
import { t } from '../i18n/index.ts';
import { POLLING } from '../../shared/constants.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

const log = scoped('client');

export function setupWindowEvents(ctx: Context): void {
  if (typeof window === 'undefined') return;

  ctx.effect(() => {
    const refreshListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { incremental?: boolean } | undefined;
      const store = useGraphStore.getState();
      if (store.nodes.length > 0) {
        if (detail?.incremental) {
          // P0：`/api/v1/codegraph/data` 返回的是 host 单槽里的图。若该槽此刻属于另一个工作区，
          // 直接落库会静默覆盖当前画布——这正是"50 节点骨架变成 2 节点图"的机理。
          // 取数侧（`fetchGraphDataIncremental` 的第二个参数）已按 `store.repoId` 过滤，
          // 落库侧统一走 `applyScopedGraphPayload`，不再在本处内联判定。
          fetchGraphDataIncremental(store.lastUpdated, store.repoId)
            .then((data) => {
              applyScopedGraphPayload(store, data, store.repoId, 'incremental graph fetch');
            })
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
          store.setError(t('error.loadGraphData'));
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
          store.setInitStatus('error', t('error.generic'));
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
            store.setError(t('error.loadGraphData'));
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