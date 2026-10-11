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
    dagreRankDir: s.dagreRankDir, hierarchyLevel: s.hierarchyLevel,
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
    initStatus: s.initStatus, urlRestored: s.urlRestored, panelVisible: s.panelVisible,
    indexStatus: s.indexStatus,
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

/** Lazily fetched per-node edge pages served by `GET /api/v1/codegraph/edges`. */
export function useNodeEdges() {
  return useGraphStore(useShallow((s) => ({
    nodeEdgesByNodeId: s.nodeEdgesByNodeId,
    nodeEdgeTotals: s.nodeEdgeTotals,
    nodeEdgeCursors: s.nodeEdgeCursors,
    loadingEdgeNodeIds: s.loadingEdgeNodeIds,
    detailEdgeNodeIds: s.detailEdgeNodeIds,
  })));
}

export function useGraphActions() {
  return useGraphStore(useShallow((s) => ({
    setLayout: s.setLayout,
    setDagreRankDir: s.setDagreRankDir,
    setTheme: s.setTheme,
    setSearchQuery: s.setSearchQuery,
    setSelectedNode: s.setSelectedNode,
    setFilterType: s.setFilterType,
    setGraphType: s.setGraphType,
    setClusterDepth: s.setClusterDepth,
    setHierarchyLevel: s.setHierarchyLevel,
    setLayer: s.setLayer,
    setLoading: s.setLoading,
    setCurrentWorkspace: s.setCurrentWorkspace,
    addWorkspace: s.addWorkspace,
    removeWorkspace: s.removeWorkspace,
    setGraphData: s.setGraphData,
    setInitStatus: s.setInitStatus,
    setWatchEnabled: s.setWatchEnabled,
    setError: s.setError,
    expandNode: s.expandNode,
    collapseNode: s.collapseNode,
    collapseAll: s.collapseAll,
    setPathResult: s.setPathResult,
    setFocusDepth: s.setFocusDepth,
    setHeatmapMode: s.setHeatmapMode,
    setTodoMarkerMode: s.setTodoMarkerMode,
    setLODLevel: s.setLODLevel,
    assembleMicro: s.assembleMicro,
    loadNodeEdges: s.loadNodeEdges,
  })));
}

export function usePanelDimensions() {
  return {
    panelHeight: useGraphStore((s) => s.panelHeight),
    panelWidth: useGraphStore((s) => s.panelWidth),
  };
}