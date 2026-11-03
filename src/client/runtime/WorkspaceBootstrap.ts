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
      // cycle-140：会话跟随优先。sessionWorkspace 已知时，它是「当前对话」的真相源；
      // 宿主 /workspace 返回 registry[0]（注册序），多会话宿主里它不等于当前对话。
      // 首扫在面板挂载前运行（sessionWorkspace 通常为 null ⇒ 沿用宿主值），
      // 但重连复用会话形态下 sessionWorkspace 可能已就位 ⇒ 首扫直接加载会话工作区，
      // 避免「先加载 registry[0] 的图、会话跟随再切换」的竞态窗口。
      const sessionKnown = s.sessionWorkspace !== null && s.sessionWorkspace !== '';
      const scanTarget = sessionKnown ? s.sessionWorkspace! : workspacePath;
      // 启动首扫：pin 不可能已存在（store 刚建、pin 仅驻内存），但守卫放在这里
      // 让「重连复用会话」形态同样被覆盖——一致性优先于当前不可达性。
      if (s.pinnedWorkspace === null) {
        s.setCurrentWorkspace(scanTarget);
      }
      if (wsList.length > 0) {
        const workspaceInfos = wsList.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p, lastUsed: Date.now() }));
        for (const wi of workspaceInfos) {
          if (!s.workspaceList.some((w) => w.path === wi.path)) { s.addWorkspace(wi.path, wi.name); }
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path: scanTarget } }));
      }
      log.info('auto-import requested', { path: scanTarget });

      const bootstrap = await fetchBootstrap(undefined, scanTarget);
      // cycle-140 竞态防护：fetchBootstrap 是异步的，期间会话跟随（面板挂载后
      // sessionFollow 生效）可能已把 currentWorkspace 切到会话工作区。若此刻
      // currentWorkspace 已不等于 scanTarget，这份 registry[0] 的载荷是过期的——
      // 应用它会把会话工作区的画布覆盖回注册序工作区（正是用户报的不一致）。
      // 丢弃它，让 useWorkspaceCache 的 loadBootstrap 路径完成正确的加载。
      if (useGraphStore.getState().currentWorkspace !== scanTarget) {
        log.info('initial scan discarded — workspace changed during fetch', { scanTarget, current: useGraphStore.getState().currentWorkspace });
        useGraphStore.getState().setLoading(false);
        return;
      }
      if (bootstrap && bootstrap.topLevelNodes.length > 0) {
        const s2 = useGraphStore.getState();
        s2.setBootstrapData(bootstrap.topLevelNodes, bootstrap.edges, scanTarget, {
          totalNodeCount: bootstrap.metadata.totalNodeCount,
          totalEdgeCount: bootstrap.metadata.totalEdgeCount,
          timestamp: bootstrap.metadata.timestamp,
          // cycle-130 · T2：图层来源透传（缺席 = host 未提供，徽章不渲染）。
          graphLayer: bootstrap.metadata.graphLayer,
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
          //
          // cycle-140：会话跟随优先于宿主注册序。sessionWorkspace 已知（面板已挂载、
          // 宿主注入了会话 scope）时，会话 cwd 是「当前对话」的真相源；宿主 /workspace
          // 返回 registry[0]（注册序），多会话宿主里它不等于当前对话 ⇒ 不覆盖。
          // sessionWorkspace 未知（桌面/旧代宿主/面板未挂载）时才回落到宿主值。
          const sessionKnown = s.sessionWorkspace !== null && s.sessionWorkspace !== '';
          if (s.pinnedWorkspace === null && !(sessionKnown && s.sessionWorkspace !== dshCurrent)) {
            lastDshWorkspace = dshCurrent;
            s.setCurrentWorkspace(dshCurrent);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path: dshCurrent } }));
            }
          } else if (s.pinnedWorkspace !== null) {
            log.info('workspace poll suppressed by user pin', { dsh: dshCurrent, pinned: s.pinnedWorkspace });
          } else {
            log.info('workspace poll suppressed by session-follow', { dsh: dshCurrent, session: s.sessionWorkspace });
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