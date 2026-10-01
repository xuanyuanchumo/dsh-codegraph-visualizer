import type { NodeId } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createPathFocusSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    pathStartId: null,
    pathEndId: null,
    pathResult: null,
    focusDepth: 1,
    focusModeActive: false,
    focusModeNodeId: null,
    pathFilterInclude: null,
    pathFilterExclude: null,
    callChainDepth: 2,
    setPathStart: (nodeId: NodeId | null) => _set({ pathStartId: nodeId }),
    setPathEnd: (nodeId: NodeId | null) => _set({ pathEndId: nodeId }),
    setPathResult: (path: NodeId[] | null) => _set({ pathResult: path }),
    setFocusDepth: (depth: number) => _set({ focusDepth: depth }),
    setFocusMode: (active: boolean, nodeId: NodeId | null) => _set({ focusModeActive: active, focusModeNodeId: nodeId }),
    setPathFilter: (include: string | null, exclude: string | null) => _set({ pathFilterInclude: include, pathFilterExclude: exclude }),
    setCallChainDepth: (depth: number) => _set({ callChainDepth: depth }),
  };
}