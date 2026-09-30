import { useGraphStore } from '../store/graphStore.ts';
import { useShallow } from 'zustand/shallow';

export function useGraphData() {
  return useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, rawNodes: s.rawNodes, rawEdges: s.rawEdges,
  })));
}

export function useGraphDisplay() {
  return useGraphStore(useShallow((s) => ({
    layout: s.layout, theme: s.theme,
    filterType: s.filterType, graphType: s.graphType, clusterDepth: s.clusterDepth,
    viewMode: s.viewMode, currentLayer: s.currentLayer, diagramData: s.diagramData,
    dagreRankDir: s.dagreRankDir,
  })));
}

export function useGraphInteraction() {
  return useGraphStore(useShallow((s) => ({
    searchQuery: s.searchQuery, selectedNodeId: s.selectedNodeId,
    highlightedNodeIds: s.highlightedNodeIds, expandedNodeIds: s.expandedNodeIds,
    pathResult: s.pathResult, focusDepth: s.focusDepth,
    focusModeActive: s.focusModeActive, focusModeNodeId: s.focusModeNodeId,
    pathFilterInclude: s.pathFilterInclude, pathFilterExclude: s.pathFilterExclude,
  })));
}

export function useGraphStatus() {
  return useGraphStore(useShallow((s) => ({
    isLoading: s.isLoading, error: s.error, lastUpdated: s.lastUpdated,
    truncated: s.truncated, totalNodeCount: s.totalNodeCount,
    prerequisites: s.prerequisites, watchEnabled: s.watchEnabled,
    initStatus: s.initStatus, urlRestored: s.urlRestored,
  })));
}

export function useGraphWorkspace() {
  return useGraphStore(useShallow((s) => ({
    currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
  })));
}

export function useGraphAnalysis() {
  return useGraphStore(useShallow((s) => ({
    ruleViolations: s.ruleViolations, selectedFunction: s.selectedFunction,
    fanInThreshold: s.fanInThreshold, fanOutThreshold: s.fanOutThreshold,
    visibleNodeTypes: s.visibleNodeTypes, visibleEdgeTypes: s.visibleEdgeTypes,
    heatmapMode: s.heatmapMode,
    todoMarkerMode: s.todoMarkerMode,
  })));
}

export function useGraphPerformance() {
  return useGraphStore(useShallow((s) => ({
    performanceDegradations: s.performanceDegradations,
    lodLevel: s.lodLevel, lodEnabled: s.lodEnabled,
  })));
}

export function useGraphActions() {
  return {
    setLayout: useGraphStore((s) => s.setLayout),
    setDagreRankDir: useGraphStore((s) => s.setDagreRankDir),
    setTheme: useGraphStore((s) => s.setTheme),
    setSearchQuery: useGraphStore((s) => s.setSearchQuery),
    setSelectedNode: useGraphStore((s) => s.setSelectedNode),
    setFilterType: useGraphStore((s) => s.setFilterType),
    setGraphType: useGraphStore((s) => s.setGraphType),
    setClusterDepth: useGraphStore((s) => s.setClusterDepth),
    setLayer: useGraphStore((s) => s.setLayer),
    setLoading: useGraphStore((s) => s.setLoading),
    setCurrentWorkspace: useGraphStore((s) => s.setCurrentWorkspace),
    addWorkspace: useGraphStore((s) => s.addWorkspace),
    removeWorkspace: useGraphStore((s) => s.removeWorkspace),
    setGraphData: useGraphStore((s) => s.setGraphData),
    setInitStatus: useGraphStore((s) => s.setInitStatus),
    setWatchEnabled: useGraphStore((s) => s.setWatchEnabled),
    setError: useGraphStore((s) => s.setError),
    expandNode: useGraphStore((s) => s.expandNode),
    collapseNode: useGraphStore((s) => s.collapseNode),
    collapseAll: useGraphStore((s) => s.collapseAll),
    setPathResult: useGraphStore((s) => s.setPathResult),
    setFocusDepth: useGraphStore((s) => s.setFocusDepth),
    setHeatmapMode: useGraphStore((s) => s.setHeatmapMode),
    setTodoMarkerMode: useGraphStore((s) => s.setTodoMarkerMode),
    setLODLevel: useGraphStore((s) => s.setLODLevel),
    assembleMicro: useGraphStore((s) => s.assembleMicro),
  };
}

export function usePanelDimensions() {
  return {
    panelHeight: useGraphStore((s) => s.panelHeight),
    panelWidth: useGraphStore((s) => s.panelWidth),
  };
}