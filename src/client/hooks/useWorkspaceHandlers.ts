import { useCallback } from 'react';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { dispatchCgEvent } from '../utils/cgEvents.ts';

export interface WorkspaceHandlersParams {
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name: string) => void;
}

export interface WorkspaceHandlers {
  handleWorkspaceSwitch: (path: string) => void;
  handleWorkspaceAdd: (path: string) => void;
}

export function useWorkspaceHandlers(params: WorkspaceHandlersParams): WorkspaceHandlers {
  const { setCurrentWorkspace, addWorkspace } = params;

  const handleWorkspaceSwitch = useCallback((path: string) => {
    setCurrentWorkspace(path);
    dispatchCgEvent(DOM_EVENTS.WORKSPACE, { path });
  }, [setCurrentWorkspace]);

  const handleWorkspaceAdd = useCallback((path: string) => {
    addWorkspace(path, path.split(/[\\/]/).pop() || path);
    dispatchCgEvent(DOM_EVENTS.WORKSPACE, { path });
    dispatchCgEvent(DOM_EVENTS.IMPORT_REPO, { path });
  }, [addWorkspace]);

  return { handleWorkspaceSwitch, handleWorkspaceAdd };
}