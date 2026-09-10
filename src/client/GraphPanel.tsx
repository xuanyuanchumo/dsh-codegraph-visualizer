import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type ThemeType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import type { GraphNode, GraphEdge, ViewMode } from '../types/index.ts';
import { NodeId } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard, useViewMode, useAnalysisPanels } from './hooks/index.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useGraphCache } from './hooks/useGraphCache.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Legend } from './components/Legend.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { NodeDetail } from './components/NodeDetail.tsx';
import { StatsPanel } from './components/StatsPanel.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { GraphTooltip, type TooltipData, type EdgeTooltipData } from './components/GraphTooltip.tsx';
import { LoadingOverlay } from './components/LoadingOverlay.tsx';
import { ErrorOverlay } from './components/ErrorOverlay.tsx';
import { KeyboardHelp } from './components/KeyboardHelp.tsx';
import { PathBar } from './components/PathBar.tsx';
import { HealthScoreCard } from './components/HealthScoreCard.tsx';
import { RuleConfigPanel } from './components/RuleConfigPanel.tsx';
import { FocusModeBar } from './components/FocusModeBar.tsx';
import { HotspotPanel } from './components/HotspotPanel.tsx';
import { GodModulePanel } from './components/GodModulePanel.tsx';
import { ImpactPanel } from './components/ImpactPanel.tsx';
import { MicroViewPrompt, MicroFunctionBar } from './components/MicroViewBar.tsx';
import { GraphIcon } from './components/Icons.tsx';
import { fetchGraphData } from './api/index.ts';
import { SequenceDiagramRenderer } from './renderer/SequenceDiagramRenderer.tsx';
import { scoped } from '../shared/Logger.ts';
import { useT } from './i18n/index.ts';
import './styles.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const depsFetchAbortRef = useRef<AbortController | null>(null);
  const getDataRef = useRef<{
    getSelectedNodeData: () => GraphNode | null;
    getNodeData: (id: string) => GraphNode | null;
    getEdgeData: (id: string) => GraphEdge | null;
  } | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | EdgeTooltipData | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [viewportInfo, setViewportInfo] = useState<{
    zoom: number; pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const {
    nodes, edges, rawNodes, rawEdges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, graphType, clusterLevel, isLoading, error, lastUpdated,
    prerequisites, watchEnabled, currentWorkspace, workspaceList,
    initStatus, truncated, totalNodeCount, expandedNodeIds,
    pathResult, focusDepth, healthScore, rules, ruleViolations,
    viewMode, selectedFunction, currentLayer, diagramData,
  } = useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, rawNodes: s.rawNodes, rawEdges: s.rawEdges,
    layout: s.layout, theme: s.theme,
    searchQuery: s.searchQuery, selectedNodeId: s.selectedNodeId,
    highlightedNodeIds: s.highlightedNodeIds, filterType: s.filterType,
    graphType: s.graphType, clusterLevel: s.clusterLevel,
    isLoading: s.isLoading, error: s.error, lastUpdated: s.lastUpdated,
    prerequisites: s.prerequisites, watchEnabled: s.watchEnabled,
    currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
    initStatus: s.initStatus, truncated: s.truncated, totalNodeCount: s.totalNodeCount,
    expandedNodeIds: s.expandedNodeIds, pathResult: s.pathResult,
    focusDepth: s.focusDepth, healthScore: s.healthScore,
    rules: s.rules, ruleViolations: s.ruleViolations,
    viewMode: s.viewMode, selectedFunction: s.selectedFunction,
    currentLayer: s.currentLayer, diagramData: s.diagramData,
  })));

  const setLayout = useGraphStore((s) => s.setLayout);
  const setTheme = useGraphStore((s) => s.setTheme);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setFilterType = useGraphStore((s) => s.setFilterType);
  const setGraphType = useGraphStore((s) => s.setGraphType);
  const setClusterLevel = useGraphStore((s) => s.setClusterLevel);
  const setLayer = useGraphStore((s) => s.setLayer);
  const setLoading = useGraphStore((s) => s.setLoading);
  const setCurrentWorkspace = useGraphStore((s) => s.setCurrentWorkspace);
  const addWorkspace = useGraphStore((s) => s.addWorkspace);
  const removeWorkspace = useGraphStore((s) => s.removeWorkspace);
  const setGraphData = useGraphStore((s) => s.setGraphData);
  const setInitStatus = useGraphStore((s) => s.setInitStatus);
  const setWatchEnabled = useGraphStore((s) => s.setWatchEnabled);
  const setError = useGraphStore((s) => s.setError);
  const expandNode = useGraphStore((s) => s.expandNode);
  const collapseNode = useGraphStore((s) => s.collapseNode);
  const collapseAll = useGraphStore((s) => s.collapseAll);
  const setPathResult = useGraphStore((s) => s.setPathResult);
  const setFocusDepth = useGraphStore((s) => s.setFocusDepth);
  const setHealthScore = useGraphStore((s) => s.setHealthScore);
  const setRules = useGraphStore((s) => s.setRules);
  const setRuleViolations = useGraphStore((s) => s.setRuleViolations);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const setSelectedFunction = useGraphStore((s) => s.setSelectedFunction);
  const panelHeight = useGraphStore((s) => s.panelHeight);
  const panelWidth = useGraphStore((s) => s.panelWidth);

  const handleCollapseAll = useCallback(() => { collapseAll(); }, [collapseAll]);

  const panel = usePanelState();
  const history = useHistory();
  const graphCache = useGraphCache();

  const prevWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentWorkspace) return;
    if (prevWorkspaceRef.current && prevWorkspaceRef.current !== currentWorkspace) {
      const cached = graphCache.getCachedData(currentWorkspace);
      if (cached) setGraphData(cached.nodes, cached.edges, currentWorkspace);
    }
    prevWorkspaceRef.current = currentWorkspace;
  }, [currentWorkspace, graphCache, setGraphData]);

  useEffect(() => {
    if (currentWorkspace && rawNodes.length > 0) {
      graphCache.cacheData(currentWorkspace, rawNodes, rawEdges);
    }
  }, [currentWorkspace, rawNodes, rawEdges, graphCache]);

  const debouncedSearch = useDebounce(searchQuery, 200);
  const showCallChainRef = useRef(panel.showCallChain);
  useEffect(() => { showCallChainRef.current = panel.showCallChain; }, [panel.showCallChain]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) useGraphStore.getState().setCurrentWorkspace(detail.path);
    };
    window.addEventListener('codegraph:workspace', handler);
    return () => window.removeEventListener('codegraph:workspace', handler);
  }, []);

  const handleWorkspaceSwitch = useCallback((path: string) => {
    setCurrentWorkspace(path);
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path } }));
  }, [setCurrentWorkspace]);

  const handleWorkspaceAdd = useCallback((path: string) => {
    addWorkspace(path, path.split(/[\\/]/).pop() || path);
    window.dispatchEvent(new CustomEvent('codegraph:workspace', { detail: { path } }));
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path } }));
  }, [addWorkspace]);

  const handleNodeTap = useCallback((id: NodeId) => {
    setSelectedNode(id);
    const data = getDataRef.current?.getSelectedNodeData() ?? null;
    setSelectedNodeData(data);
  }, [setSelectedNode]);

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    const data = getDataRef.current?.getNodeData(nodeId);
    if (!data) return;
    const isClusterNode = 'isCluster' in data && data.isCluster === true;
    if (isClusterNode) {
      const isExpanded = expandedNodeIds.has(nodeId);
      if (isExpanded) collapseNode(nodeId);
      else expandNode(nodeId);
    } else {
      setFocusNodeId((prev) => prev === nodeId ? null : nodeId);
    }
  }, [expandedNodeIds, expandNode, collapseNode]);

  const handleNodeHover = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    const data = getDataRef.current?.getNodeData(nodeId);
    if (data) {
      setTooltip({ x: pos.x, y: pos.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type });
    }
  }, []);

  const handleNodeHoverOut = useCallback(() => setTooltip(null), []);
  const handleEdgeHover = useCallback((edgeId: string, pos: { x: number; y: number }) => {
    const edgeData = getDataRef.current?.getEdgeData(edgeId);
    if (edgeData) {
      const sourceNode = getDataRef.current?.getNodeData(edgeData.source);
      const targetNode = getDataRef.current?.getNodeData(edgeData.target);
      setTooltip({
        x: pos.x, y: pos.y,
        sourceLabel: sourceNode?.label ?? edgeData.source,
        targetLabel: targetNode?.label ?? edgeData.target,
        edgeType: edgeData.type,
      });
    }
  }, []);
  const handleEdgeHoverOut = useCallback(() => setTooltip(null), []);

  const renderer = useGraphRenderer(
    nodes, edges, rawNodes, layout, theme,
    highlightedNodeIds, selectedNodeId, filterType, graphType, clusterLevel,
    debouncedSearch, panel.showCallChain, panel.showCycles, panel.showImpact, panel.showInheritance, focusNodeId,
    { onNodeTap: handleNodeTap, onNodeDoubleTap: handleNodeDoubleTap, onNodeHover: handleNodeHover, onNodeHoverOut: handleNodeHoverOut, onEdgeHover: handleEdgeHover, onEdgeHoverOut: handleEdgeHoverOut },
    showCallChainRef,
  );

  useEffect(() => {
    getDataRef.current = {
      getSelectedNodeData: () => renderer.rendererRef.current?.getSelectedNodeData() ?? null,
      getNodeData: (id: string) => renderer.rendererRef.current?.getNodeData(id) ?? null,
      getEdgeData: (id: string) => renderer.rendererRef.current?.getEdgeData(id) ?? null,
    };
  }, [renderer.rendererRef]);

  useEffect(() => {
    const symbolHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { symbol?: string };
      if (!detail?.symbol) return;
      const sym = detail.symbol;
      const store = useGraphStore.getState();
      const match = store.rawNodes.find((n) =>
        n.label === sym || n.label.endsWith(`.${sym}`) || n.label.includes(sym),
      );
      if (match) {
        store.setSelectedNode(NodeId(match.id));
        renderer.rendererRef.current?.focusOnNode(match.id);
        renderer.rendererRef.current?.selectNode(NodeId(match.id));
      }
    };
    window.addEventListener('codegraph:symbol-select', symbolHandler);
    return () => window.removeEventListener('codegraph:symbol-select', symbolHandler);
  }, [renderer.rendererRef]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.body.hasAttribute('data-ds-dark-theme');
      const newTheme: ThemeType = isDark ? 'dark' : 'light';
      const current = useGraphStore.getState().theme;
      if (current !== newTheme) {
        useGraphStore.getState().setTheme(newTheme);
        renderer.updateTheme(newTheme);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => observer.disconnect();
  }, [renderer.updateTheme]);

  usePanelResize(panelRef, renderer.rendererRef);

  useEffect(() => {
    if (panel.collapsed) return;
    const panelEl = panelRef.current;
    if (!panelEl) return;
    if (panelHeight !== null && panelHeight >= 240) panelEl.style.height = `${panelHeight}px`;
    if (panelWidth !== null && panelWidth >= 320) panelEl.style.width = `${panelWidth}px`;
    if (panelHeight !== null || panelWidth !== null) renderer.rendererRef.current?.resize();
  }, [panel.collapsed, panelHeight, panelWidth, renderer.rendererRef]);

  useEffect(() => {
    if (panel.collapsed) return;
    const panelEl = panelRef.current;
    if (!panelEl) return;
    const hasUserOverride = panelHeight !== null;
    if (hasUserOverride) return;
    let ancestor: HTMLElement | null = panelEl.parentElement;
    let depth = 0;
    while (ancestor && depth < 8) {
      const h = ancestor.getBoundingClientRect().height;
      if (h >= 300) break;
      ancestor = ancestor.parentElement;
      depth++;
    }
    const target = ancestor ?? panelEl.parentElement ?? panelEl;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const applyAncestorHeight = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        const h = target.getBoundingClientRect().height;
        if (h >= 240) {
          panelEl.style.height = `${h}px`;
          renderer.rendererRef.current?.resize();
        }
      }, 200);
    };
    applyAncestorHeight();
    const ro = new ResizeObserver(applyAncestorHeight);
    ro.observe(target);
    return () => { ro.disconnect(); if (resizeTimer !== null) clearTimeout(resizeTimer); };
  }, [panel.collapsed, panelHeight, renderer.rendererRef]);

  usePanelKeyboard(layout, setLayout, renderer.rendererRef, {
    onToggleSearch: panel.toggleSearch,
    onCloseAll: () => {
      panel.setShowSearch(false); panel.setShowCallChain(false); panel.setShowCycles(false);
      panel.setShowImpact(false); panel.setShowInheritance(false); panel.setShowImport(false); panel.setShowLegend(false);
      panel.setShowPathFind(false); panel.setShowHealthScore(false); panel.setShowRules(false);
      panel.setShowHotspot(false); panel.setShowGodModule(false);
      setTooltip(null); setShowHelp(false); setFocusNodeId(null);
    },
    onToggleCallChain: panel.toggleCallChain,
    onToggleImpact: panel.toggleImpact,
    onToggleInheritance: panel.toggleInheritance,
    onToggleMiniMap: panel.toggleMiniMap,
    onCycleLayout: () => {},
    onToggleImport: panel.toggleImport,
    onToggleHelp: () => setShowHelp((v) => !v),
    onUndo: history.undo,
    onRedo: history.redo,
  });

  const requestRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('codegraph:refresh', { detail: { incremental: true } }));
  }, []);
  usePolling(requestRefresh, watchEnabled ? 10000 : 30000, !panel.collapsed);

  useEffect(() => {
    if (!panel.showMiniMap || panel.collapsed) return;
    const updateMiniMap = () => {
      const r = renderer.rendererRef.current;
      if (!r) return;
      setThumbnail(r.getThumbnail());
      setViewportInfo(r.getViewportInfo());
    };
    updateMiniMap();
    let rafId: number | null = null;
    let lastUpdate = 0;
    const MIN_INTERVAL = 500;
    const throttledUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate < MIN_INTERVAL) return;
      lastUpdate = now;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateMiniMap);
    };
    const fallbackId = setInterval(throttledUpdate, 500);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearInterval(fallbackId);
    };
  }, [panel.showMiniMap, panel.collapsed, renderer.rendererRef, nodes.length, layout]);

  useEffect(() => () => depsFetchAbortRef.current?.abort(), []);

  const handleThemeToggle = useCallback(() => {
    const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
    if (newTheme === 'dark') document.body.setAttribute('data-ds-dark-theme', '');
    else document.body.removeAttribute('data-ds-dark-theme');
    setTheme(newTheme);
    renderer.updateTheme(newTheme);
  }, [theme, setTheme, renderer]);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeData(null); setSelectedNode(null);
  }, [setSelectedNode]);

  const { handleViewModeChange, handleSelectFunction, handleCloseMicroView } = useViewMode(
    viewMode, layout, currentWorkspace, depsFetchAbortRef,
  );

  const handleRefresh = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:refresh', { detail: { incremental: false } }));
    log.info('manual refresh (full)');
  }, [setLoading]);

  const handleScanWorkspace = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path: currentWorkspace || '.' } }));
    log.info('scan workspace from empty state', { path: currentWorkspace });
  }, [setLoading, currentWorkspace]);

  const handleFindPath = useCallback((sourceId: NodeId, targetId: NodeId) => {
    const r = renderer.rendererRef.current;
    if (!r) return;
    const result = r.findPath(sourceId, targetId);
    if (result) { setPathResult(result.path); r.highlightPath(result.path); }
    else { setPathResult(null); r.highlightPath(null); }
  }, [renderer.rendererRef, setPathResult]);

  const handleClearPath = useCallback(() => {
    renderer.rendererRef.current?.highlightPath(null);
    setPathResult(null);
  }, [renderer.rendererRef, setPathResult]);

  const handleFocusExpand = useCallback(() => {
    if (!focusNodeId) return;
    const newDepth = focusDepth + 1;
    setFocusDepth(newDepth);
    renderer.rendererRef.current?.expandNeighborhood(NodeId(focusNodeId), newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, renderer.rendererRef]);

  const handleFocusContract = useCallback(() => {
    if (!focusNodeId || focusDepth <= 1) return;
    const newDepth = focusDepth - 1;
    setFocusDepth(newDepth);
    renderer.rendererRef.current?.expandNeighborhood(NodeId(focusNodeId), newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, renderer.rendererRef]);

  const handleFocusExit = useCallback(() => {
    setFocusNodeId(null);
    setFocusDepth(1);
    renderer.rendererRef.current?.focusNeighborhood(null);
  }, [setFocusDepth, renderer.rendererRef]);

  const getImpactStats = useCallback(() => {
    if (!selectedNodeId) return null;
    return renderer.rendererRef.current?.getImpactStats(selectedNodeId) ?? null;
  }, [renderer.rendererRef, selectedNodeId]);

  const { handleHealthCheck, handleRulesCheck, hotspotNodes, godModules, impactStats } = useAnalysisPanels(
    rawNodes, rawEdges,
    panel.showHealthScore, panel.showRules, panel.showHotspot, panel.showGodModule,
    panel.showImpact, selectedNodeId, getImpactStats,
  );

  const hasAutoScannedRef = useRef(false);
  useEffect(() => {
    if (hasAutoScannedRef.current) return;
    if (panel.collapsed) return;
    if (nodes.length > 0 || rawNodes.length > 0) return;
    if (!prerequisites.codegraph) return;
    if (!currentWorkspace) return;
    hasAutoScannedRef.current = true;
    log.info('auto-fill: triggering scan on first open', { path: currentWorkspace });
    handleScanWorkspace();
  }, [panel.collapsed, nodes.length, rawNodes.length, prerequisites.codegraph, currentWorkspace, handleScanWorkspace]);

  const statsText = useMemo(() => t('stats.nodesEdges', { nodes: nodes.length, edges: edges.length }), [nodes.length, edges.length, t]);
  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of rawNodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [rawNodes]);
  const panelClassName = useMemo(() =>
    `graph-panel resizable ${panel.collapsed ? 'collapsed' : ''} ${className}`.trim(),
    [panel.collapsed, className],
  );

  const isCollapsed = panel.collapsed;
  const isMicroView = viewMode === 'cfg' || viewMode === 'flowchart' || viewMode === 'sequence';

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={panel.toggleCollapsed} role="button" tabIndex={0} aria-label={t('panel.expand')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel.toggleCollapsed(); } }}>
        <GraphIcon size={22} />
      </div>

      <Toolbar
        statsText={statsText}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        layout={layout} theme={theme} filterType={filterType} graphType={graphType}
        clusterLevel={clusterLevel} viewMode={viewMode} currentLayer={currentLayer}
        layerNames={diagramData?.layers.map((l) => l.name) ?? []}
        onLayerChange={setLayer} collapsed={panel.collapsed}
        panelControls={{
          showSearch: panel.showSearch, showCallChain: panel.showCallChain,
          showCycles: panel.showCycles, showImpact: panel.showImpact,
          showInheritance: panel.showInheritance, showMiniMap: panel.showMiniMap,
          showLegend: panel.showLegend, showImport: panel.showImport,
          showPathFind: panel.showPathFind, showHealthScore: panel.showHealthScore,
          showRules: panel.showRules, showHotspot: panel.showHotspot,
          showGodModule: panel.showGodModule,
          onToggleSearch: panel.toggleSearch, onToggleCallChain: panel.toggleCallChain,
          onToggleCycles: panel.toggleCycles, onToggleImpact: panel.toggleImpact,
          onToggleInheritance: panel.toggleInheritance, onToggleMiniMap: panel.toggleMiniMap,
          onToggleLegend: panel.toggleLegend, onToggleImport: panel.toggleImport,
          onTogglePathFind: panel.togglePathFind, onToggleHealthScore: panel.toggleHealthScore,
          onToggleRules: panel.toggleRules, onToggleHotspot: panel.toggleHotspot,
          onToggleGodModule: panel.toggleGodModule,
        }}
        onViewModeChange={handleViewModeChange} onLayoutChange={setLayout}
        onThemeToggle={handleThemeToggle} onFilterChange={setFilterType}
        onGraphTypeChange={setGraphType} onClusterLevelChange={setClusterLevel}
        onRefresh={handleRefresh} onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed} onCollapseAll={handleCollapseAll}
        onUndo={history.undo} onRedo={history.redo}
        canUndo={history.canUndo} canRedo={history.canRedo}
        currentWorkspace={currentWorkspace} workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch} onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
      />

      {panel.showSearch && !isCollapsed && (
        <SearchBar query={searchQuery} matchCount={renderer.searchMatchCount}
          onChange={setSearchQuery} onClose={() => panel.setShowSearch(false)} />
      )}

      {panel.showPathFind && !isCollapsed && (
        <PathBar onFindPath={handleFindPath} onClearPath={handleClearPath}
          pathResult={pathResult} pathLength={pathResult ? pathResult.length - 1 : null}
          onClose={() => panel.setShowPathFind(false)} />
      )}

      {focusNodeId && !isCollapsed && (
        <FocusModeBar focusNodeId={focusNodeId}
          onExpand={handleFocusExpand} onContract={handleFocusContract} onExit={handleFocusExit} />
      )}

      {panel.showHealthScore && !isCollapsed && (
        <HealthScoreCard onClose={() => panel.setShowHealthScore(false)} />
      )}

      {panel.showRules && !isCollapsed && (
        <RuleConfigPanel violations={ruleViolations} onCheckRules={handleRulesCheck}
          onClose={() => panel.setShowRules(false)} />
      )}

      {isLoading && !isCollapsed && <LoadingOverlay visible={true} />}
      {error && !isCollapsed && <ErrorOverlay error={error} />}

      {isMicroView && !selectedFunction && !isLoading && !isCollapsed && (
        <MicroViewPrompt viewMode={viewMode}
          selectFunctionPrompt={t('micro.selectFunctionPrompt')}
          flowchartLabel={t('toolbar.viewModeFlowchart')}
          sequenceLabel={t('toolbar.viewModeSequence')} />
      )}

      {isMicroView && selectedFunction && !isCollapsed && (
        <MicroFunctionBar functionName={selectedFunction.functionName} onClose={handleCloseMicroView} />
      )}

      {nodes.length === 0 && !isLoading && !error && !isCollapsed && !isMicroView && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}

      {panel.showImport && !isCollapsed && (
        <ImportPanel onClose={() => panel.setShowImport(false)} workspacePath={currentWorkspace}
          prerequisites={prerequisites} initStatus={initStatus} watchEnabled={watchEnabled}
          onSetGraphData={setGraphData} onSetLoading={setLoading} onSetError={setError}
          onSetInitStatus={setInitStatus} onSetWatchEnabled={setWatchEnabled} />
      )}

      {selectedNodeData && !isCollapsed && (
        <NodeDetail node={selectedNodeData} onClose={handleCloseDetail}
          isExpanded={selectedNodeData ? expandedNodeIds.has(selectedNodeData.id) : false}
          connectionCount={selectedNodeData ? edges.filter((e) => e.source === selectedNodeData.id || e.target === selectedNodeData.id).length : 0}
          onCollapse={() => selectedNodeData && collapseNode(selectedNodeData.id)}
          onSelectFunction={(node, mode) => handleSelectFunction(node.id, node.filePath, node.label, mode)} />
      )}

      <div className="graph-container" ref={renderer.containerRef}
        style={{ display: viewMode === 'sequence' && selectedFunction ? 'none' : undefined }} />
      {viewMode === 'sequence' && selectedFunction && !isCollapsed && (
        <SequenceDiagramRenderer nodes={nodes} edges={edges} theme={theme}
          onNodeTap={(id) => handleNodeTap(NodeId(id))} />
      )}

      {panel.showLegend && !isCollapsed && (<Legend onClose={() => panel.setShowLegend(false)} />)}

      {panel.showMiniMap && !isCollapsed && (
        <StatsPanel
          counts={{
            function: nodeTypeCounts.function, class: nodeTypeCounts.class,
            variable: nodeTypeCounts.variable, module: nodeTypeCounts.module,
            interface: nodeTypeCounts.interface,
          }}
          onClose={() => panel.setShowMiniMap(false)} thumbnail={thumbnail} viewportInfo={viewportInfo}
          onFocusArea={(ratioX, ratioY) => renderer.rendererRef.current?.focusOnArea(ratioX, ratioY)} />
      )}

      {panel.showHotspot && !isCollapsed && hotspotNodes.length > 0 && (
        <HotspotPanel hotspotNodes={hotspotNodes} onClose={() => panel.setShowHotspot(false)} label={t('toolbar.hotspot')} />
      )}

      {panel.showGodModule && !isCollapsed && godModules.length > 0 && (
        <GodModulePanel godModules={godModules} onClose={() => panel.setShowGodModule(false)}
          label={t('toolbar.godModule')} statsLabel={(n, e) => t('godmodule.stats', { nodes: n, edges: e })} />
      )}

      {panel.showImpact && !isCollapsed && impactStats && (
        <ImpactPanel impactStats={impactStats} label={t('toolbar.impact')} totalLabel={t('impact.total')} />
      )}

      {tooltip && <GraphTooltip data={tooltip} />}
      <KeyboardHelp visible={showHelp} onClose={() => setShowHelp(false)} />
      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated}
        watchEnabled={watchEnabled} workspaceName={currentWorkspace}
        truncated={truncated} totalNodeCount={totalNodeCount} displayedNodeCount={nodes.length} />
      <div className="resize-handle" title={t('panel.resetSize')} />
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
