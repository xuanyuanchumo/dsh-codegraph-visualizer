import { useEffect, useRef, useCallback, useState } from 'react';
import { useGraphStore } from './store/graphStore.ts';
import type { ThemeType, GraphType } from './store/graphStore.ts';

import type { GraphNode, ViewMode } from '../types/index.ts';
import type { ClusterNode } from './store/cluster/index.ts';
import { NodeId } from '../types/index.ts';
import { usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard, useViewMode, useAnalysisPanels,
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus, useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions, usePanelDimensions,
  useGraphDerivedValues, useWorkspaceHandlers,
  useAdjacencyMap, usePanelSizeApply, useVisibleNodeCount, useDeadCodeMarker, useDiffComparison, useWorkspaceEventListener, useUrlExpandSync, usePanelVisibility,
  useGraphDiff,
} from './hooks/index.ts';


import { useThemeSync } from './hooks/useThemeSync.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useGraphCache } from './hooks/useGraphCache.ts';
import { useWorkspaceCache } from './hooks/useWorkspaceCache.ts';
import { useSymbolSelectListener } from './hooks/useSymbolSelectListener.ts';
import { useLODZoom } from './hooks/useLODZoom.ts';
import { useMiniMapSync } from './hooks/useMiniMapSync.ts';
import { useAutoBootstrap } from './hooks/useAutoBootstrap.ts';
import { useAncestorResize } from './hooks/useAncestorResize.ts';
import { useViewModePanelGuard } from './hooks/useViewModePanelGuard.ts';
import { useSearchInteraction, type GetDataApi } from './hooks/useSearchInteraction.ts';
import { useFocusMode } from './hooks/useFocusMode.ts';
import { useNodeInteraction } from './hooks/useNodeInteraction.ts';
import { invalidateCssVarCache } from './renderer/styles/ThemeStylesheet.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { Toolbar } from './components/Toolbar.tsx';

import { GraphTooltip, type TooltipData, type EdgeTooltipData } from './components/GraphTooltip.tsx';
import { ContextMenu } from './components/ContextMenu.tsx';
import { LoadingOverlay } from './components/LoadingOverlay.tsx';
import { ErrorOverlay } from './components/ErrorOverlay.tsx';
import { KeyboardHelp } from './components/KeyboardHelp.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FocusModeBar } from './components/FocusModeBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';

import { MicroViewPrompt, MicroFunctionBar } from './components/MicroViewBar.tsx';
import { GraphIcon } from './components/Icons.tsx';
import { OverlayBar } from './components/OverlayBar.tsx';
import { LeftPanelStack } from './components/LeftPanelStack.tsx';
import { RightPanelStack } from './components/RightPanelStack.tsx';

import { SequenceDiagramRenderer } from './renderer/SequenceDiagramRenderer.tsx';
import { scoped } from '../shared/Logger.ts';
import { DOM_EVENTS } from '../shared/domEvents.ts';
import { dispatchCgEvent } from './utils/cgEvents.ts';
import { UI, FUNCTION_BODY } from '../shared/constants.ts';
import { getAvailablePanels, getViewLayer } from '../shared/viewModeUtils.ts';


import { useT } from './i18n/index.ts';
import './styles/tokens.css'; import './styles/layout.css'; import './styles/overlays.css';
import './styles/graph.css'; import './styles/node-detail.css'; import './styles/import-workspace.css';
import './styles/path-finder.css'; import './styles/health-score-card.css'; import './styles/rule-config-panel.css';
import './styles/hotspot-godmodule-panel.css'; import './styles/impact-panel.css'; import './styles/cycle-panel.css'; import './styles/deadcode-panel.css';
import './styles/tour-panel.css'; import './styles/responsive.css'; import './styles/misc.css';
import './styles/runtime-panel.css';
import './styles/diff-panel.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const integrationMode = useGraphStore((s) => s.integrationMode);
  const panelRef = useRef<HTMLDivElement>(null);
  const depsFetchAbortRef = useRef<AbortController | null>(null);
  const getDataRef = useRef<GetDataApi | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | ClusterNode | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | EdgeTooltipData | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    position: { x: number; y: number };
  } | null>(null);


  const { nodes, edges, rawNodes, rawEdges } = useGraphData();
  const { layout, dagreRankDir, theme, filterType, graphType, clusterDepth, viewMode, currentLayer, diagramData, hierarchyLevel } = useGraphDisplay();
  const { searchQuery, selectedNodeId, highlightedNodeIds, expandedNodeIds, pathResult, focusDepth, focusModeActive, focusModeNodeId, pathFilterInclude, pathFilterExclude } = useGraphInteraction();
  const { isLoading, error, lastUpdated, truncated, totalNodeCount, prerequisites, watchEnabled, initStatus, urlRestored, panelVisible, indexStatus } = useGraphStatus();
  const { currentWorkspace, workspaceList } = useGraphWorkspace();
  const { ruleViolations, selectedFunction, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, heatmapMode, todoMarkerMode } = useGraphAnalysis();
  const { performanceDegradations, lodLevel, lodEnabled } = useGraphPerformance();
  const { diffResult } = useGraphDiff();
  const actions = useGraphActions();
  const { panelHeight, panelWidth } = usePanelDimensions();

  const {
    setLayout, setDagreRankDir, setTheme, setSearchQuery, setSelectedNode,
    setFilterType, setGraphType, setClusterDepth, setHierarchyLevel, setLayer, setLoading,
    setCurrentWorkspace, addWorkspace, removeWorkspace, setGraphData,
    setInitStatus, setWatchEnabled, setError, expandNode, collapseNode,
    collapseAll, setPathResult, setFocusDepth, setHeatmapMode, setTodoMarkerMode, setLODLevel,
    assembleMicro,
  } = actions;

  const handleCollapseAll = useCallback(() => { collapseAll(); }, [collapseAll]);

  const panel = usePanelState();
  const history = useHistory();
  const graphCache = useGraphCache();

  useWorkspaceCache({ currentWorkspace, rawNodes, rawEdges, graphCache, setGraphData });

  useUrlExpandSync(expandedNodeIds, urlRestored);


  const showCallChainRef = useRef(panel.showCallChain);

  const { debouncedSearch, searchResults, handleSelectSearchResult } = useSearchInteraction({
    searchQuery,
    rawNodes,
    setSelectedNode,
    setSelectedNodeData,
    getDataRef,
    setShowSearch: panel.setShowSearch,
  });

  const adjacencyMap = useAdjacencyMap(edges);
  useEffect(() => { showCallChainRef.current = panel.showCallChain; }, [panel.showCallChain]);

  useWorkspaceEventListener();

  const { handleWorkspaceSwitch, handleWorkspaceAdd } = useWorkspaceHandlers({
    setCurrentWorkspace, addWorkspace,
  });

  const handleNodeDoubleTapRef = useRef<(nodeId: string) => void>(() => {});

  const { handleViewModeChange, handleSelectFunction: rawHandleSelectFunction, handleCloseMicroView, handleAggregateCallChain } = useViewMode(
    viewMode, currentWorkspace, depsFetchAbortRef,
  );

  const {
    handleNodeTap, handleNodeDoubleTap, handleNodeHover, handleNodeHoverOut,
    handleNodeHoverPrefetch, handleEdgeHover, handleEdgeHoverOut, handleEdgeTap,
  } = useNodeInteraction({
    setSelectedNode, setSelectedNodeData, getDataRef, adjacencyMap,
    setTooltip, expandedNodeIds, collapseNode, expandNode,
    handleSelectFunction: rawHandleSelectFunction, setFocusNodeId, handleNodeDoubleTapRef,
  });

  const renderer = useGraphRenderer({
    data: { nodes, edges, rawNodes },
    display: { layout, dagreRankDir, theme, clusterDepth, heatmapMode, todoMarkerMode },
    interaction: { highlightedNodeIds, selectedNodeId, focusNodeId, focusModeActive, focusModeNodeId, focusDepth, debouncedSearch },
    filters: { filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, pathFilterInclude, pathFilterExclude },
    analysis: { showCallChain: panel.showCallChain, showCycles: panel.showCycles, cycleIsolation: panel.cycleIsolation, showImpact: panel.showImpact, showInheritance: panel.showInheritance },
    callbacks: { onNodeTap: handleNodeTap, onNodeDoubleTap: handleNodeDoubleTap, onNodeHover: handleNodeHover, onNodeHoverPrefetch: handleNodeHoverPrefetch, onNodeHoverOut: handleNodeHoverOut, onEdgeTap: handleEdgeTap, onEdgeHover: handleEdgeHover, onEdgeHoverOut: handleEdgeHoverOut, onNodeContextTap: (nodeId: string, pos: { x: number; y: number }) => setContextMenu({ nodeId, position: pos }) },
    showCallChainRef,
  });

  useEffect(() => {
    getDataRef.current = {
      getSelectedNodeData: () => renderer.rendererRef.current?.getSelectedNodeData() ?? null,
      getNodeData: (id: string) => renderer.rendererRef.current?.getNodeData(id) ?? null,
      getEdgeData: (id: string) => renderer.rendererRef.current?.getEdgeData(id) ?? null,
      revealNode: (id: string) => renderer.rendererRef.current?.revealNode(id) ?? false,
    };
  }, [renderer.rendererRef]);

  useSymbolSelectListener({ rendererRef: renderer.rendererRef });

  useThemeSync(renderer.updateTheme);

  useLODZoom({
    lodEnabled,
    lodLevel,
    rawNodesLength: rawNodes.length,
    rendererRef: renderer.rendererRef,
    setLODLevel,
  });

  usePanelResize(panelRef, renderer.rendererRef);

  usePanelSizeApply({
    panelRef, collapsed: panel.collapsed, panelHeight, panelWidth, integrationMode,
    rendererResize: () => renderer.rendererRef.current?.resize(),
  });

  useAncestorResize({
    collapsed: panel.collapsed,
    panelHeight,
    rendererRef: renderer.rendererRef,
    panelRef,
  });

  usePanelVisibility({ panelVisible, rendererRef: renderer.rendererRef });

  usePanelKeyboard(layout, setLayout, renderer.rendererRef, {
    onToggleSearch: panel.toggleSearch,
    onCloseAll: () => {
      // The node context menu is an overlay too, so Escape has to dismiss it; leaving it
      // out stranded keyboard users inside a menu the shortcut could not close. It goes
      // first because it is the topmost overlay.
      setContextMenu(null);
      panel.closeAll();
      setTooltip(null); setShowHelp(false); setFocusNodeId(null);
    },
    onToggleCallChain: panel.toggleCallChain,
    onToggleImpact: panel.toggleImpact,
    onToggleInheritance: panel.toggleInheritance,
    onToggleMiniMap: panel.toggleMiniMap,
    onCycleLayout: () => {},
    onToggleImport: panel.toggleImport,
    onToggleHelp: () => setShowHelp((v) => !v),
    onOpenContextMenu: () => {
      if (!selectedNodeId) return;
      const position = renderer.rendererRef.current?.getNodeRenderedPosition(selectedNodeId);
      if (!position) return;
      // Focus the canvas first so the menu's focus restoration lands on the graph instead
      // of <body>, where a keyboard user would be dropped after Escape (BUG-R12-03).
      renderer.containerRef.current?.focus();
      setContextMenu({ nodeId: selectedNodeId, position });
    },
    onUndo: history.undo,
    onRedo: history.redo,
    onRefresh: () => {
      setLoading(true);
      dispatchCgEvent(DOM_EVENTS.REFRESH, { incremental: false });
    },
  });

  const requestRefresh = useCallback(() => {
    dispatchCgEvent(DOM_EVENTS.REFRESH, { incremental: true });
  }, []);
  usePolling(requestRefresh, watchEnabled ? UI.POLLING_INTERVAL_WATCH_MS : UI.POLLING_INTERVAL_IDLE_MS, !panel.collapsed && panelVisible);

  const { visibleNodeCount, hasHiddenNodes } = useVisibleNodeCount({
    filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes,
    rendererRef: renderer.rendererRef, nodesLength: nodes.length,
  });

  const { thumbnail, viewportInfo } = useMiniMapSync({
    showMiniMap: panel.showMiniMap,
    collapsed: panel.collapsed,
    rendererRef: renderer.rendererRef,
    nodesLength: nodes.length,
    layout,
  });

  useEffect(() => () => depsFetchAbortRef.current?.abort(), []);

  const handleThemeToggle = useCallback(() => {
    try {
      const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
      if (newTheme === 'dark') document.body.setAttribute('data-ds-dark-theme', '');
      else document.body.removeAttribute('data-ds-dark-theme');
      invalidateCssVarCache();
      setTheme(newTheme);
      renderer.updateTheme(newTheme);
    } catch (err) {
      log.error('handleThemeToggle failed', { err });
    }
  }, [theme, setTheme, renderer]);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeData(null); setSelectedNode(null);
  }, [setSelectedNode]);

  const handleSelectFunction = useCallback((nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => {
    setSelectedNodeData(null);
    rawHandleSelectFunction(nodeId, filePath, functionName, mode);
  }, [rawHandleSelectFunction]);

  // NodeDetail 预算区的「只看调用链」与右键菜单的「高亮调用链」共用这一条轻通路：
  // 只让渲染器高亮，不改 viewMode、不重建子图。刻意不走 handleAggregateCallChain，
  // 因为那条通路会调 assembleMultiFunction 并把视图强制切到 'cfg'，与「只看」语义不符。
  //
  // 为什么必须按层判断再置位：useViewModePanelGuard 会在当前层不提供该面板时把
  // showCallChain 立刻改回 false，随后 useGraphRenderer 的 [showCallChain, selectedNodeId]
  // effect 会以 false 调 highlightCallChain(null)，把刚加上的高亮抹掉 —— 这正是
  // 默认 code 视图（structural 层，STRUCTURAL_PANELS 不含 showCallChain）下
  // 「高亮调用链」点了没反应的原因。因此仅在当前层确实提供该面板时才置位，
  // 否则只做一次性高亮（不置位就没有后续渲染，高亮得以保留）。
  const handleHighlightCallChain = useCallback((nodeId: string) => {
    if (getAvailablePanels(getViewLayer(viewMode)).has('showCallChain')) {
      panel.setShowCallChain(true);
    }
    renderer.rendererRef.current?.highlightCallChain(NodeId(nodeId));
  }, [panel, renderer.rendererRef, viewMode]);

  useViewModePanelGuard({ viewMode, setFocusNodeId, panel });

  /**
   * 进入运行时层时自动打开独立面板，离开时自动收起（cycle-88，P2-1）。
   *
   * 为什么不能只靠工具栏那个开关：切到运行时层后图谱容器被隐藏（这一层没有子图），
   * 如果面板默认关闭，用户看到的是一块完全空白的区域，只能靠猜测去工具下拉里找一个
   * 叫「运行时」的项——这正是 `docs/图谱按需加载.md:238-241` 风险 8
   * 「UI 必须明确：不是数据没有，而是按预算展开」要避免的沉默。
   *
   * 依赖只取 `viewMode` 与稳定的 setter：把整个 `panel` 放进 deps 会让每次
   * usePanelState 重渲染都触发一次 setState（toggle 回调虽稳定，但 `panel` 对象
   * 本身每次渲染都是新引用），产生无意义的重渲染循环。
   */
  useEffect(() => {
    panel.setShowRuntime(viewMode === 'runtime');
  }, [viewMode, panel.setShowRuntime]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    dispatchCgEvent(DOM_EVENTS.REFRESH, { incremental: false });
    log.info('manual refresh (full)');
  }, [setLoading]);

  const handleScanWorkspace = useCallback(() => {
    setLoading(true);
    dispatchCgEvent(DOM_EVENTS.IMPORT_REPO, { path: currentWorkspace || '.' });
    log.info('scan workspace from empty state', { path: currentWorkspace });
  }, [setLoading, currentWorkspace]);

  const handleFindPath = useCallback((sourceId: NodeId, targetId: NodeId) => {
    try {
      const r = renderer.rendererRef.current;
      if (!r) return;
      const result = r.findPath(sourceId, targetId);
      if (result) { setPathResult(result.path); r.highlightPath(result.path); }
      else { setPathResult(null); r.highlightPath(null); }
    } catch (err) {
      log.error('handleFindPath failed', { sourceId, targetId, err });
      setPathResult(null);
    }
  }, [renderer.rendererRef, setPathResult]);

  const handleClearPath = useCallback(() => {
    renderer.rendererRef.current?.highlightPath(null);
    setPathResult(null);
  }, [renderer.rendererRef, setPathResult]);

  const { handleFocusExpand, handleFocusContract, handleFocusExit } = useFocusMode({
    focusNodeId, focusDepth, setFocusDepth, setSelectedNode, setFocusNodeId, rendererRef: renderer.rendererRef,
  });

  const getImpactStats = useCallback(() => {
    if (!selectedNodeId) return null;
    return renderer.rendererRef.current?.getImpactStats(selectedNodeId) ?? null;
  }, [renderer.rendererRef, selectedNodeId]);

  const { handleRulesCheck, hotspotNodes, godModules, impactStats, coreFunctions, deadCodeResult } = useAnalysisPanels(
    rawNodes, rawEdges,
    panel.showHealthScore, panel.showRules, panel.showHotspot, panel.showGodModule,
    panel.showImpact, selectedNodeId, getImpactStats, panel.showCoreFunction, panel.showDeadCode,
  );

  useDeadCodeMarker({ showDeadCode: panel.showDeadCode, deadCodeResult, rendererRef: renderer.rendererRef });

  /**
   * 版本对比（研究报告 §六 #13）。
   *
   * `enabled` 传 `panel.showDiff` 而不是「有没有 diffResult」：面板关闭时即使还留着上次的
   * 结果，也必须把画布标记清掉——否则用户关掉面板后看到一堆无法解释的彩色边框。
   * `clearDiffResult` 由 hook 内部负责，这里只把 UI 需要的三样东西接出去。
   */
  const diff = useDiffComparison({
    enabled: panel.showDiff,
    rendererRef: renderer.rendererRef,
    workspace: currentWorkspace,
  });

  useAutoBootstrap({
    collapsed: panel.collapsed,
    nodesLength: nodes.length,
    rawNodesLength: rawNodes.length,
    codegraphReady: prerequisites.codegraph,
    currentWorkspace,
    handleScanWorkspace,
  });

  const { statsText, expandedFunctionBodyCount, showFunctionBodyBudget, nodeTypeCounts, cycleDetails, tourData, panelClassName } = useGraphDerivedValues({
    nodes, edges, rawNodes, rawEdges, diagramData, expandedNodeIds,
    showCycles: panel.showCycles, collapsed: panel.collapsed, className,
    integrationMode, rendererRef: renderer.rendererRef, t,
  });

  const isCollapsed = panel.collapsed;
  const isMicroView = viewMode === 'cfg' || viewMode === 'flowchart' || viewMode === 'sequence';
  /**
   * 运行时层（cycle-88，P2-1 三层独立面板）。
   *
   * `docs/图谱按需加载.md:202`：「三层不要同时叠加到一张图。切换层时替换子图，
   * 而不是追加节点。」运行时层根本没有图谱子图（`assembleDiagram('runtime', …)`
   * 返回 null，因为 `macroAssemblerRegistry` 里没有它的装配器），所以这里必须
   * 把图谱容器与空态都让位给 `RuntimePanel`——否则用户会看到一个「暂无数据 /
   * 请导入仓库」的空态，误以为运行时层也需要先索引代码。
   */
  const isRuntimeView = viewMode === 'runtime';

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}
      data-cg-integration={integrationMode}>
      <button className="cg-collapse-fab" onClick={panel.toggleCollapsed} aria-label={t('panel.expand')} aria-expanded={!panel.collapsed}>
        <GraphIcon size={22} />
      </button>

      <Toolbar
        statsText={statsText}
        hasData={nodes.length > 0}
        hasGraphData={rawNodes.length > 0}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        theme={theme}
        collapsed={panel.collapsed}
        panelControls={panel.toPanelControls}
        layoutConfig={{
          layout, dagreRankDir, clusterDepth,
          onChange: (field, value) => {
            if (field === 'layout') setLayout(value as typeof layout);
            else if (field === 'dagreRankDir') setDagreRankDir(value as typeof dagreRankDir);
            else if (field === 'clusterDepth') setClusterDepth(value as number);
          },
        }}
        viewConfig={{
          viewMode, graphType, filterType, currentLayer,
          layerNames: diagramData?.layers.map((l) => l.name) ?? [],
          hierarchyLevel,
          hasSelectedFunction: !!selectedFunction,
          onChange: (field, value) => {
            if (field === 'viewMode') handleViewModeChange(value as ViewMode);
            else if (field === 'graphType') setGraphType(value as GraphType);
            else if (field === 'filterType') setFilterType(value as GraphNode['type'] | 'all');
            else if (field === 'layer') setLayer(value as number);
            else if (field === 'hierarchyLevel') setHierarchyLevel(value as number);
          },
        }}
        history={{ undo: history.undo, redo: history.redo, canUndo: history.canUndo, canRedo: history.canRedo }}
        onThemeToggle={handleThemeToggle}
        onRefresh={handleRefresh}
        onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed}
        onCollapseAll={handleCollapseAll}
        currentWorkspace={currentWorkspace} workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch} onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
      />

      <LeftPanelStack
        panel={panel} isCollapsed={isCollapsed}
        searchQuery={searchQuery} searchResults={searchResults} searchMatchCount={renderer.searchMatchCount}
        onSearchChange={setSearchQuery} onSelectSearchResult={handleSelectSearchResult}
        onFindPath={handleFindPath} onClearPath={handleClearPath} pathResult={pathResult}
        ruleViolations={ruleViolations} onCheckRules={handleRulesCheck}
        selectedNodeData={selectedNodeData} onCloseDetail={handleCloseDetail}
        expandedNodeIds={expandedNodeIds} adjacencyMap={adjacencyMap}
        onCollapseNode={(id) => collapseNode(id)}
        onSelectFunction={(node, mode) => handleSelectFunction(node.id, node.filePath, node.label, mode)}
        onAggregateCallChain={handleAggregateCallChain}
        onHighlightCallChain={handleHighlightCallChain}
        viewMode={viewMode} currentWorkspace={currentWorkspace}
        prerequisites={prerequisites} initStatus={initStatus} watchEnabled={watchEnabled}
        onSetGraphData={setGraphData} onSetLoading={setLoading} onSetError={setError}
        onSetInitStatus={setInitStatus} onSetWatchEnabled={setWatchEnabled}
      />

      {!isCollapsed && !isMicroView && (
        <OverlayBar heatmapMode={heatmapMode} setHeatmapMode={setHeatmapMode} todoMarkerMode={todoMarkerMode} setTodoMarkerMode={setTodoMarkerMode} />
      )}

      {focusNodeId && !isCollapsed && (
        <GraphErrorBoundary><FocusModeBar focusNodeId={focusNodeId}
          onExpand={handleFocusExpand} onContract={handleFocusContract} onExit={handleFocusExit} /></GraphErrorBoundary>
      )}

      {showFunctionBodyBudget && !isCollapsed && (
        <div className="cg-function-body-budget" role="status" aria-live="polite">
          {t('stats.functionBodyBudget', { expanded: expandedFunctionBodyCount, max: FUNCTION_BODY.MAX_EXPANDED })}
        </div>
      )}

      {isLoading && !isCollapsed && <LoadingOverlay visible={true} />}
      {error && !isCollapsed && (
        <ErrorOverlay
          error={error}
          onBack={isMicroView ? handleCloseMicroView : undefined}
          onRetry={isMicroView && selectedFunction ? () => assembleMicro(viewMode) : undefined}
        />
      )}

      {isMicroView && !selectedFunction && !isLoading && !error && !isCollapsed && (
        <MicroViewPrompt viewMode={viewMode}
          selectFunctionPrompt={t('micro.selectFunctionPrompt')}
          flowchartLabel={t('toolbar.viewModeFlowchart')}
          sequenceLabel={t('toolbar.viewModeSequence')}
          backToCodeLabel={t('micro.backToCode')}
          onBackToCode={handleCloseMicroView} />
      )}

      {isMicroView && selectedFunction && !error && !isCollapsed && (
        <MicroFunctionBar functionName={selectedFunction.functionName} filePath={selectedFunction.filePath} viewMode={viewMode} onClose={handleCloseMicroView} />
      )}

      {nodes.length === 0 && !isLoading && !error && !isCollapsed && !isMicroView && !isRuntimeView && (
        <EmptyState prerequisites={prerequisites} indexing={indexStatus === 'building'} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}



      <GraphErrorBoundary
        onError={(err) => setError(err instanceof Error ? err.message : String(err))}
        fallback={<div className="cg-graph-container" />}
      >
        <div className="cg-graph-container" ref={renderer.containerRef}
          role="application"
          tabIndex={0}
          aria-label={t('a11y.graphContainerStats', { viewMode: t(`viewMode.${viewMode}`), nodeCount: nodes.length, edgeCount: edges.length })}
          aria-describedby="cg-graph-live-region"
          style={{ display: (viewMode === 'sequence' && selectedFunction) || isRuntimeView ? 'none' : undefined }}>
          <div id="cg-graph-live-region" className="cg-visually-hidden" role="status" aria-live="polite">
            {selectedNodeData
              ? t('a11y.selectedNodeDetail', { label: selectedNodeData.label, type: selectedNodeData.type, filePath: selectedNodeData.filePath, lineNumber: selectedNodeData.lineNumber ?? 0 })
              : ''}
          </div>
          {nodes.length > 0 && visibleNodeCount === 0 && !isMicroView && (
            <div className="cg-filter-empty-state" role="status">
              {t('common.noVisibleNodes')}
            </div>
          )}
        </div>
      </GraphErrorBoundary>
      {viewMode === 'sequence' && selectedFunction && !isCollapsed && (
        <GraphErrorBoundary><SequenceDiagramRenderer nodes={nodes} edges={edges} theme={theme}
          onNodeTap={(id) => handleNodeTap(NodeId(id))} /></GraphErrorBoundary>
      )}

      <RightPanelStack
        panel={panel} isCollapsed={isCollapsed}
        nodeTypeCounts={nodeTypeCounts}
        thumbnail={thumbnail} viewportInfo={viewportInfo}
        onFocusArea={(ratioX, ratioY) => {
          const info = renderer.rendererRef.current?.getViewportInfo();
          if (info) {
            renderer.rendererRef.current?.focusOnArea(info.totalSize.w * ratioX, info.totalSize.h * ratioY, info.zoom);
          }
        }}
        hotspotNodes={hotspotNodes} godModules={godModules}
        coreFunctions={coreFunctions} deadCodeResult={deadCodeResult}
        impactStats={impactStats} cycleDetails={cycleDetails}
        tourData={tourData}
        onSelectCoreFunction={(nodeId) => {
          setSelectedNode(NodeId(nodeId));
          renderer.rendererRef.current?.focusOnNode(nodeId);
          renderer.rendererRef.current?.selectNode(NodeId(nodeId));
        }}
        onSelectDeadNode={(nodeId) => {
          setSelectedNode(NodeId(nodeId));
          renderer.rendererRef.current?.focusOnNode(nodeId);
          renderer.rendererRef.current?.selectNode(NodeId(nodeId));
        }}
        diffResult={diffResult}
        diffMarkStats={diff.markStats}
        isDiffComparing={diff.isComparing}
        diffErrorMessage={diff.error ? t('diff.requestFailed') : null}
        onDiffCompare={(from, to) => { void diff.compare(from, to); }}
        onDiffClear={diff.clear}
        labels={{
          hotspot: t('toolbar.hotspot'),
          godModule: t('toolbar.godModule'),
          coreFunction: t('toolbar.coreFunction'),
          deadCode: t('toolbar.deadCode'),
          impact: t('toolbar.impact'),
          impactTotal: t('impact.total'),
          cycles: t('toolbar.cycles'),
          cyclesEmpty: t('cycles.empty'),
          runtime: t('runtime.title'),
          godModuleStats: (n, e) => t('godmodule.stats', { nodes: n, edges: e }),
        }}
      />


      {contextMenu && (
        <ContextMenu
          nodeId={contextMenu.nodeId}
          nodeData={getDataRef.current?.getNodeData(contextMenu.nodeId) ?? null}
          position={contextMenu.position}
          isCluster={expandedNodeIds.has(contextMenu.nodeId) || nodes.some((n) => n.id === contextMenu.nodeId && 'children' in n)}
          isExpanded={expandedNodeIds.has(contextMenu.nodeId)}
          onClose={() => setContextMenu(null)}
          onFocusNode={(id) => { renderer.rendererRef.current?.focusOnNode(id); renderer.rendererRef.current?.selectNode(NodeId(id)); }}
          onIsolateNode={(id) => { renderer.rendererRef.current?.focusNeighborhood(NodeId(id)); }}
          onHideNode={(id) => { renderer.rendererRef.current?.hideNode(NodeId(id)); }}
          onShowAllNodes={() => { renderer.rendererRef.current?.showAllNodes(); }}
          hasHiddenNodes={hasHiddenNodes}
          onExpandNode={(id) => { expandNode(id); }}
          onCollapseNode={(id) => { collapseNode(id); }}
          onFindPath={(id) => { panel.setShowPathFind(true); useGraphStore.getState().setPathStart(NodeId(id)); }}
          onHighlightCallChain={handleHighlightCallChain}
          onHighlightImpact={(id) => { panel.setShowImpact(true); renderer.rendererRef.current?.highlightImpact(NodeId(id)); }}
          onOpenSource={(id) => {
            const data = getDataRef.current?.getNodeData(id);
            if (data) {
              dispatchCgEvent(DOM_EVENTS.OPEN_SOURCE, { filePath: data.filePath, lineNumber: data.lineNumber });
            }
          }}
        />
      )}
      {tooltip && <GraphTooltip data={tooltip} />}
      <KeyboardHelp visible={showHelp} onClose={() => setShowHelp(false)} />
      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated}
        watchEnabled={watchEnabled} workspaceName={currentWorkspace}
        truncated={truncated} totalNodeCount={totalNodeCount} displayedNodeCount={nodes.length}
        performanceDegradations={performanceDegradations} />
      <div className="cg-resize-handle" title={t('panel.resetSize')} />
    </div>
  );
}

export function GraphPanel(props: GraphPanelProps) {
  return (
    <GraphErrorBoundary>
      <GraphPanelInner {...props} />
    </GraphErrorBoundary>

  );
}
