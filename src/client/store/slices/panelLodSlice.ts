import type { GraphState } from '../types.ts';
import { LOD } from '../../../shared/constants.ts';
import { isLayeredViewMode, tryIncrementalOrFull, updateIncrementalClusterCtx, internals } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createPanelLodSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    panelHeight: null,
    panelWidth: null,
    performanceDegradations: [],
    lodLevel: 'full',
    lodEnabled: false,
    setPanelSize: (height: number, width: number) => _set({ panelHeight: height, panelWidth: width }),
    resetPanelSize: () => _set({ panelHeight: null, panelWidth: null }),
    addDegradation: (key: string) => {
      const s = _get();
      if (s.performanceDegradations.includes(key)) return;
      _set({ performanceDegradations: [...s.performanceDegradations, key] });
    },
    clearDegradations: () => _set({ performanceDegradations: [] }),
    setLODLevel: (level: 'minimal' | 'compact' | 'full') => {
      const state = _get();
      if (state.lodLevel === level) return;
      _set({ lodLevel: level });
      if (!state.lodEnabled) return;
      if (isLayeredViewMode(state.viewMode)) return;
      const lodDepth = level === 'minimal' ? LOD.MINIMAL_CLUSTER_DEPTH
        : level === 'compact' ? LOD.COMPACT_CLUSTER_DEPTH
        : state.clusterDepth;
      const { rawNodes, rawEdges, expandedNodeIds } = state;
      const result = tryIncrementalOrFull(
        internals.incrementalClusterCtx,
        rawNodes, rawEdges,
        expandedNodeIds, lodDepth,
        state.panelWidth ?? undefined,
      );
      updateIncrementalClusterCtx(result, rawNodes, rawEdges);
      _set({ nodes: result.nodes, edges: result.edges });
    },
    setLODEnabled: (enabled: boolean) => {
      _set({ lodEnabled: enabled });
      if (!enabled) {
        const state = _get();
        if (state.lodLevel !== 'full') {
          _get().setLODLevel('full');
        }
      }
    },
  };
}