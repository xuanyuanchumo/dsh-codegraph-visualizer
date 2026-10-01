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
    store.setPrerequisites({ codegraph: status.codegraph, lens: status.lens, builtin: status.builtin ?? true });
    const statusKey = `${status.codegraph}:${status.lens}`;
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