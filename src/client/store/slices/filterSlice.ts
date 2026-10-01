import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createFilterSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    fanInThreshold: 0,
    fanOutThreshold: 0,
    visibleNodeTypes: new Set<GraphNode['type']>(['function', 'class', 'variable', 'module', 'interface']),
    visibleEdgeTypes: new Set<GraphEdge['type']>(['call', 'extend', 'implement', 'import', 'dependency', 'contains']),
    heatmapMode: 'none',
    todoMarkerMode: 'none',
    setFanInThreshold: (threshold: number) => _set({ fanInThreshold: threshold }),
    setFanOutThreshold: (threshold: number) => _set({ fanOutThreshold: threshold }),
    setVisibleNodeTypes: (types: Set<GraphNode['type']>) => _set({ visibleNodeTypes: types }),
    setVisibleEdgeTypes: (types: Set<GraphEdge['type']>) => _set({ visibleEdgeTypes: types }),
    setHeatmapMode: (mode) => _set({ heatmapMode: mode }),
    setTodoMarkerMode: (mode) => _set({ todoMarkerMode: mode }),
  };
}