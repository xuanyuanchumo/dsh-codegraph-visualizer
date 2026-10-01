import type { GraphNode, NodeId } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import type { LayoutType, ThemeType, RankDir } from '../../../shared/viewModeUtils.ts';
import { isLayeredViewMode } from '../../../shared/viewModeUtils.ts';
import { computeViewModeTransition } from '../viewModeTransition.ts';
import { invalidateCssVarCache, diagramCache, detectInitialTheme, reclusterWith } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createViewModeSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    layout: 'cose',
    dagreRankDir: 'TB',
    theme: detectInitialTheme(),
    searchQuery: '',
    selectedNodeId: null,
    highlightedNodeIds: [],
    filterType: 'all',
    graphType: 'all',
    viewMode: 'code',
    diagramData: null,
    currentLayer: 0,
    clusterDepth: 0,
    hierarchyLevel: 3,
    setLayout: (layout: LayoutType) => _set({ layout }),
    setDagreRankDir: (dagreRankDir: RankDir) => _set({ dagreRankDir }),
    setTheme: (theme: ThemeType) => { invalidateCssVarCache(); _set({ theme }); },
    setSearchQuery: (searchQuery: string) => _set({ searchQuery }),
    setSelectedNode: (selectedNodeId: NodeId | null) => _set({ selectedNodeId }),
    setHighlightedNodes: (highlightedNodeIds: NodeId[]) => _set({ highlightedNodeIds }),
    setFilterType: (filterType: GraphNode['type'] | 'all') => _set({ filterType }),
    setGraphType: (graphType) => _set({ graphType }),
    setViewMode: (viewMode) => {
      const state = _get();
      const result = computeViewModeTransition(
        viewMode,
        {
          rawNodes: state.rawNodes,
          rawEdges: state.rawEdges,
          savedRawNodes: state.savedRawNodes,
          savedRawEdges: state.savedRawEdges,
          clusterDepth: state.clusterDepth,
          expandedNodeIds: state.expandedNodeIds,
          expandedNodeIdsByViewMode: state.expandedNodeIdsByViewMode,
          selectedFunction: state.selectedFunction,
          viewMode: state.viewMode,
        },
        diagramCache,
      );
      const { needsMicroAssembly, ...rest } = result;
      _set(rest);
      if (needsMicroAssembly) {
        const fn = _get().selectedFunction;
        _get().assembleMicro(viewMode as 'cfg' | 'flowchart' | 'sequence', fn);
      }
    },
    setClusterDepth: (clusterDepth: number) => {
      const { expandedNodeIds, expandedNodeIdsByViewMode, viewMode } = _get();
      if (isLayeredViewMode(viewMode)) {
        _set({ clusterDepth });
        return;
      }
      reclusterWith(_get, _set, expandedNodeIds, expandedNodeIdsByViewMode, clusterDepth);
      _set({ clusterDepth });
    },
    setHierarchyLevel: (hierarchyLevel: number) => {
      const level = Math.max(0, Math.min(3, hierarchyLevel));
      const depthMap = [0, 0, 1, 2];
      const clusterDepth = depthMap[level] ?? 0;
      if (level === 0) {
        _get().collapseAll();
      }
      const { expandedNodeIds, expandedNodeIdsByViewMode, viewMode } = _get();
      if (!isLayeredViewMode(viewMode)) {
        reclusterWith(_get, _set, expandedNodeIds, expandedNodeIdsByViewMode, clusterDepth);
      }
      _set({ hierarchyLevel: level, clusterDepth });
    },
    setLayer: (layer: number) => {
      const { diagramData, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, currentLayer } = _get();
      if (!diagramData || layer < 0 || layer >= diagramData.layers.length) return;
      const layerData = diagramData.layers[layer];
      if (!layerData) return;
      const currentLayerKey = `${viewMode}_layer${currentLayer}`;
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [currentLayerKey]: new Set(expandedNodeIds) };
      const layerExpanded = newExpandedByViewMode[`${viewMode}_layer${layer}`] ?? new Set<string>();
      _set({ currentLayer: layer, expandedNodeIds: layerExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: layerData.nodes, edges: layerData.edges });
    },
  };
}