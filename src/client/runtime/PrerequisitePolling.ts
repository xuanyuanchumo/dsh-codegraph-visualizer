import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { fetchStatus } from '../api/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { POLLING } from '../../shared/constants.ts';

const log = scoped('client');

export function setupPrerequisitePolling(ctx: Context): void {
  let lastStatusKey = '';
  let prereqTimer: ReturnType<typeof setTimeout> | null = null;
  let prereqDisposed = false;

  const checkStatus = async () => {
    const status = await fetchStatus();
    const store = useGraphStore.getState();
    // `fetchStatus` 已经归一化过（`normalizePrerequisiteStatus`），这里**原样**写入：
    // 再兜一次 `?? true` 会让"宿主没应答"重新变成"内置可用"，那正是 §61.10 的假叙事。
    store.setPrerequisites(status);
    // 变化检测键必须包含 `graphSource`：它决定空态是否显示「降级模式」（客户端唯一的
    // 图数据通道判据）。只比 codegraph/lens 会让"通道位翻转了但日志一声不响"，
    // 而这正是排查 §61.10 那类假叙事时唯一能看的线索。
    const statusKey = `${status.codegraph}:${status.lens}:${status.graphSource}`;
    if (statusKey !== lastStatusKey) {
      log.info('prerequisite status', status);
      lastStatusKey = statusKey;
    }
    return status;
  };

  ctx.effect(() => () => {
    prereqDisposed = true;
    if (prereqTimer !== null) clearTimeout(prereqTimer);
  }, 'codegraph: prereq timer cleanup');

  checkStatus().then(() => {
    if (prereqDisposed) return;
    prereqTimer = setTimeout(() => {
      if (prereqDisposed) return;
      checkStatus().catch((e) => log.warn('prereq delayed check failed', e));
    }, POLLING.PREREQ_INITIAL_DELAY_MS);
  }).catch((e) => log.warn('initial status check failed', e));

  ctx.effect(() => {
    const prereqInterval = setInterval(async () => {
      if (document.hidden) return;
      if (!useGraphStore.getState().panelVisible) return;
      const s = useGraphStore.getState();
      if (s.prerequisites.codegraph && s.prerequisites.lens) { clearInterval(prereqInterval); return; }
      try { await checkStatus(); } catch (e) { log.warn('prereq polling failed', e); }
    }, POLLING.PREREQ_INTERVAL_MS);
    return () => clearInterval(prereqInterval);
  }, 'codegraph: prereq polling');
}