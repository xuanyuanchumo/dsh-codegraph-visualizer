import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

export function setupRejectionHandler(ctx: Context): void {
  if (typeof window === 'undefined') return;

  ctx.effect(() => {
    const rejectionHandler = (e: PromiseRejectionEvent) => {
      log.warn('unhandled promise rejection', e.reason);
      e.preventDefault();
    };
    window.addEventListener('unhandledrejection', rejectionHandler);
    return () => window.removeEventListener('unhandledrejection', rejectionHandler);
  }, 'codegraph: unhandled rejection handler');
}