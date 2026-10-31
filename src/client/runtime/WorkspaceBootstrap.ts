import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { fetchWorkspace, fetchBootstrap } from '../api/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { POLLING } from '../../shared/constants.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

const log = scoped('client');

export function setupWorkspaceBootstrap(ctx: Context): { scanInProgress: { value: boolean } } {
  let lastDshWorkspace = '';
  const scanInProgress = { value: false };

  const getWorkspaceAndScan = async () => {
    if (scanInProgress.value) return;
    scanInProgress.value = true;
    try {
      const { path: workspacePath, list: wsList } = await fetchWorkspace();
      lastDshWorkspace = workspacePath;
      const s = useGraphStore.getState();
      // 启动首扫：pin 不可能已存在（store 刚建、pin 仅驻内存），但守卫放在这里
      // 让「重连复用会话」形态同样被覆盖——一致性优先于当前不可达性。
      if (s.pinnedWorkspace === null) {
        s.setCurrentWorkspace(workspacePath);
      }
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

      const bootstrap = await fetchBootstrap(undefined, workspacePath);
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
      scanInProgress.value = false;
    }
  };

  const store = useGraphStore.getState();
  if (store.nodes.length === 0 && !store.isLoading) { getWorkspaceAndScan(); }

  ctx.effect(() => {
    const workspacePoll = setInterval(async () => {
      if (document.hidden) return;
      if (!useGraphStore.getState().panelVisible) return;
      try {
        const { path: dshCurrent, list: dshList } = await fetchWorkspace();
        const s = useGraphStore.getState();
        if (dshCurrent && dshCurrent !== lastDshWorkspace) {
          log.info('DSH workspace changed', { from: lastDshWorkspace, to: dshCurrent });
          // 用户 pin 优先（显式意图是粘性状态，cycle-85）：pin 在场时只记日志不动画布。
          // **lastDshWorkspace 同样不推进**——否则「抑制期间发生的宿主切换」会被标记为
          // 已消费，解除 pin 后 `dshCurrent === lastDshWorkspace` 恒真，恢复跟随永远
          // 追不上宿主的真实工作区（待应用的变化必须保持 pending）。
          // pinnedWorkspace 每次读取最新值——解除 pin 后下一轮轮询自然恢复跟随。
          if (s.pinnedWorkspace === null) {
            lastDshWorkspace = dshCurrent;
            s.setCurrentWorkspace(dshCurrent);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path: dshCurrent } }));
            }
          } else {
            log.info('workspace poll suppressed by user pin', { dsh: dshCurrent, pinned: s.pinnedWorkspace });
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

  return { scanInProgress };
}