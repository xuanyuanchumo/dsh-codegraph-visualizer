import { useGraphStore } from '../store/graphStore.ts';
import { useShallow } from 'zustand/shallow';

export function useGraphData() {
  return useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, rawNodes: s.rawNodes, rawEdges: s.rawEdges,
    // cycle-140：repoId 是「当前图属于哪个工作区」的身份维度——布局判据用它
    // 识别换工作区（同名文件在不同工作区的节点 id 会重叠，只有 repoId 能区分）。
    repoId: s.repoId,
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
    // cycle-130 · T2：图层来源（StatusBar 来源徽章数据面）。
    graphLayer: s.graphLayer,
  })));
}

export function useGraphWorkspace() {
  return useGraphStore(useShallow((s) => ({
    currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
    // 会话跟随可观测性：跟随态真相源 + 用户 pin（UI 显示「跟随中/已固定」与解除入口）。
    sessionWorkspace: s.sessionWorkspace, pinnedWorkspace: s.pinnedWorkspace,
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

/**
 * 版本对比结果（研究报告 §六 #13）。
 *
 * 单独一个选择器而不是并进 `useGraphAnalysis`：`diffResult` 在每次对比后整体替换，
 * 与 `ruleViolations` / `heatmapMode` 这些「分析设置」的更新节奏完全不同。并进去会让
 * 任何一次 diff 都触发 `useGraphAnalysis` 的整组重渲染，而它的消费者（规则面板、热力图）
 * 与 diff 毫无关系。
 */
export function useGraphDiff() {
  return useGraphStore(useShallow((s) => ({
    diffResult: s.diffResult,
  })));
}

export function useGraphPerformance() {
  return useGraphStore(useShallow((s) => ({
    performanceDegradations: s.performanceDegradations,
    lodLevel: s.lodLevel, lodEnabled: s.lodEnabled,
    // 璇玑图增量引擎健康信号（cycle-122）：StatusBar 状态条显示消费。
    xuanjiSignal: s.xuanjiSignal,
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
    pinWorkspace: s.pinWorkspace,
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