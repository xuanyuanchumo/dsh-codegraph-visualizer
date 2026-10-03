import type { GraphState } from '../types.ts';
import { UI } from '../../../shared/constants.ts';
import { internals } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createWorkspaceSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    currentWorkspace: '.',
    workspaceList: [],
    setCurrentWorkspace: (path) => {
      internals.incrementalClusterCtx = null;
      _set({ currentWorkspace: path });
    },
    addWorkspace: (path, name) => {
      const s = _get();
      const wsName = name ?? path.split(/[\\/]/).pop() ?? path;
      const existing = s.workspaceList.filter((w) => w.path !== path);
      internals.incrementalClusterCtx = null;
      _set({
        currentWorkspace: path,
        workspaceList: [{ path, name: wsName, lastUsed: Date.now() }, ...existing].slice(0, UI.WORKSPACE_LIST_MAX),
      });
    },
    removeWorkspace: (path) => {
      const s = _get();
      if (s.currentWorkspace === path) internals.incrementalClusterCtx = null;
      _set({
        workspaceList: s.workspaceList.filter((w) => w.path !== path),
        currentWorkspace: s.currentWorkspace === path ? '.' : s.currentWorkspace,
      });
    },
  };
}