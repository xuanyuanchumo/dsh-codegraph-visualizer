import { useCallback } from 'react';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { dispatchCgEvent } from '../utils/cgEvents.ts';

export interface WorkspaceHandlersParams {
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name: string) => void;
  /** 用户手动切换的粘性覆盖（pin）：切换即写 pin，轮询/会话跟随不再覆盖。 */
  pinWorkspace: (path: string | null) => void;
}

export interface WorkspaceHandlers {
  handleWorkspaceSwitch: (path: string) => void;
  handleWorkspaceAdd: (path: string) => void;
}

export function useWorkspaceHandlers(params: WorkspaceHandlersParams): WorkspaceHandlers {
  const { addWorkspace, pinWorkspace } = params;

  const handleWorkspaceSwitch = useCallback((path: string) => {
    // 手动切换 = pin（粘性，cycle-85：显式用户意图是粘性状态）：pinWorkspace 内部
    // 复用 setCurrentWorkspace 的身份失效语义；之后轮询/会话跟随不得覆盖。
    pinWorkspace(path);
    dispatchCgEvent(DOM_EVENTS.WORKSPACE, { path });
  }, [pinWorkspace]);

  const handleWorkspaceAdd = useCallback((path: string) => {
    addWorkspace(path, path.split(/[\\/]/).pop() || path);
    // 新增工作区同样是显式意图：写 pin，防止 15s 轮询把它拉回旧值。
    pinWorkspace(path);
    dispatchCgEvent(DOM_EVENTS.WORKSPACE, { path });
    dispatchCgEvent(DOM_EVENTS.IMPORT_REPO, { path });
  }, [addWorkspace, pinWorkspace]);

  return { handleWorkspaceSwitch, handleWorkspaceAdd };
}