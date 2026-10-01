import type { GraphState } from '../types.ts';
import { POLLING, internals, clearLoadingFailsafe, abortAllControllers } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

const LOADING_FAILSAFE_MS = POLLING.LOADING_FAILSAFE_MS;

export function createSessionSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    isLoading: false,
    error: null,
    lastUpdated: 0,
    prerequisites: { codegraph: false, lens: false, builtin: true },
    integrationMode: 'unknown',
    panelVisible: true,
    urlRestored: false,
    initStatus: 'idle',
    initMessage: null,
    watchEnabled: false,
    setLoading: (isLoading: boolean) => {
      clearLoadingFailsafe();
      _set({ isLoading });
      if (isLoading) {
        internals.loadingFailsafe = setTimeout(() => {
          internals.loadingFailsafe = null;
          if (_get().isLoading) {
            _set({ isLoading: false });
          }
        }, LOADING_FAILSAFE_MS);
      }
    },
    setError: (error: string | null) => {
      clearLoadingFailsafe();
      _set({ error, isLoading: false });
    },
    setPrerequisites: (prerequisites) => _set({ prerequisites }),
    setIntegrationMode: (integrationMode) => _set({ integrationMode }),
    setPanelVisible: (panelVisible: boolean) => {
      _set({ panelVisible });
      if (!panelVisible) {
        abortAllControllers(internals.prefetchAbortControllers);
        internals.prefetchInFlightCount = 0;
        abortAllControllers(internals.expandAbortControllers);
        const state = _get();
        abortAllControllers(state.pendingRequests);
        if (internals.prefetchIdleHandle !== null) {
          if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(internals.prefetchIdleHandle as number);
          else clearTimeout(internals.prefetchIdleHandle as ReturnType<typeof setTimeout>);
          internals.prefetchIdleHandle = null;
        }
      }
    },
    setInitStatus: (initStatus, initMessage = null) => _set({ initStatus, initMessage }),
    setWatchEnabled: (watchEnabled: boolean) => _set({ watchEnabled }),
  };
}