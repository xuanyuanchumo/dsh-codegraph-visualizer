import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type ThemeType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import type { NodeId, GraphNode, GraphEdge } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard } from './hooks/index.ts';
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
import { GraphIcon, CloseIcon } from './components/Icons.tsx';
import { HealthScorer } from './analysis/HealthScorer.ts';
import { RuleEngine, getPresetRules } from './analysis/RuleEngine.ts';
import { HotspotAnalyzer, GodModuleDetector } from './analysis/HotspotAnalyzer.ts';
import { scoped } from '../shared/Logger.ts';
import { useT } from './i18n/index.ts';
import './styles.css';

const log = scoped('panel');

const healthScorer = new HealthScorer();
const ruleEngine = new RuleEngine();
const hotspotAnalyzer = new HotspotAnalyzer();
const godModuleDetector = new GodModuleDetector();

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
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

  const {
    nodes, edges, rawNodes, rawEdges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, graphType, clusterLevel, isLoading, error, lastUpdated,
    prerequisites, watchEnabled, currentWorkspace, workspaceList,
    initStatus, truncated, totalNodeCount, totalEdgeCount, expandedNodeIds,
    pathResult, focusDepth, healthScore, rules, ruleViolations,
  } = useGraphStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, rawNodes: s.rawNodes, rawEdges: s.rawEdges,
    layout: s.layout, theme: s.theme,
    searchQuery: s.searchQuery, selectedNodeId: s.selectedNodeId,
    highlightedNodeIds: s.highlightedNodeIds, filterType: s.filterType,
    graphType: s.graphType, clusterLevel: s.clusterLevel,
    isLoading: s.isLoading, error: s.error, lastUpdated: s.lastUpdated,
    prerequisites: s.prerequisites, watchEnabled: s.watchEnabled,
    currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
    initStatus: s.initStatus,
    truncated: s.truncated, totalNodeCount: s.totalNodeCount, totalEdgeCount: s.totalEdgeCount,
    expandedNodeIds: s.expandedNodeIds,
    pathStartId: s.pathStartId, pathEndId: s.pathEndId, pathResult: s.pathResult,
    focusDepth: s.focusDepth, healthScore: s.healthScore,
    rules: s.rules, ruleViolations: s.ruleViolations,
  })));

  const setLayout = useGraphStore((s) => s.setLayout);
  const setTheme = useGraphStore((s) => s.setTheme);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setFilterType = useGraphStore((s) => s.setFilterType);
  const setGraphType = useGraphStore((s) => s.setGraphType);
  const setClusterLevel = useGraphStore((s) => s.setClusterLevel);
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

  const handleCollapseAll = useCallback(() => {
    collapseAll();
  }, [collapseAll]);

  const panel = usePanelState();
  const debouncedSearch = useDebounce(searchQuery, 200);
  const showCallChainRef = useRef(panel.showCallChain);

  useEffect(() => {
    showCallChainRef.current = panel.showCallChain;
  }, [panel.showCallChain]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) {
        useGraphStore.getState().setCurrentWorkspace(detail.path);
      }
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

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    const data = getDataRef.current?.getNodeData(nodeId);
    if (!data) return;
    const isClusterNode = 'isCluster' in data && data.isCluster === true;
    if (isClusterNode) {
      const isExpanded = expandedNodeIds.has(nodeId);
      if (isExpanded) {
        collapseNode(nodeId);
      } else {
        expandNode(nodeId);
      }
    } else {
      setFocusNodeId((prev) => {
        if (prev === nodeId) {
          return null;
        }
        return nodeId;
      });
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
  });

  const requestRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('codegraph:refresh', { detail: { incremental: true } }));
  }, []);
  usePolling(requestRefresh, watchEnabled ? 3000 : 10000, !panel.collapsed);

  useEffect(() => {
    if (!panel.showMiniMap || panel.collapsed) return;
    const updateMiniMap = () => {
      const r = renderer.rendererRef.current;
      if (!r) return;
      setThumbnail(r.getThumbnail());
      setViewportInfo(r.getViewportInfo());
    };
    updateMiniMap();
    const id = setInterval(updateMiniMap, 2000);
    return () => clearInterval(id);
  }, [panel.showMiniMap, panel.collapsed, renderer.rendererRef, nodes.length, layout]);

  const handleThemeToggle = useCallback(() => {
    const newTheme: ThemeType = theme === 'dark' ? 'light' : 'dark';
    if (newTheme === 'dark') {
      document.body.setAttribute('data-ds-dark-theme', '');
    } else {
      document.body.removeAttribute('data-ds-dark-theme');
    }
    setTheme(newTheme);
    renderer.updateTheme(newTheme);
  }, [theme, setTheme, renderer]);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeData(null); setSelectedNode(null);
  }, [setSelectedNode]);

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

  // FR-25: Path finding handlers
  const handleFindPath = useCallback((sourceId: NodeId, targetId: NodeId) => {
    const r = renderer.rendererRef.current;
    if (!r) return;
    const result = r.findPath(sourceId, targetId);
    if (result) {
      setPathResult(result.path);
      r.highlightPath(result.path);
    } else {
      setPathResult(null);
      r.highlightPath(null);
    }
  }, [renderer.rendererRef, setPathResult]);

  const handleClearPath = useCallback(() => {
    renderer.rendererRef.current?.highlightPath(null);
    setPathResult(null);
  }, [renderer.rendererRef, setPathResult]);

  // FR-26/28: Focus mode handlers
  const handleFocusExpand = useCallback(() => {
    if (!focusNodeId) return;
    const newDepth = focusDepth + 1;
    setFocusDepth(newDepth);
    renderer.rendererRef.current?.expandNeighborhood(focusNodeId as NodeId, newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, renderer.rendererRef]);

  const handleFocusContract = useCallback(() => {
    if (!focusNodeId || focusDepth <= 1) return;
    const newDepth = focusDepth - 1;
    setFocusDepth(newDepth);
    renderer.rendererRef.current?.expandNeighborhood(focusNodeId as NodeId, newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, renderer.rendererRef]);

  const handleFocusExit = useCallback(() => {
    setFocusNodeId(null);
    setFocusDepth(1);
    renderer.rendererRef.current?.focusNeighborhood(null);
  }, [setFocusDepth, renderer.rendererRef]);

  // FR-32: Health score handler
  const handleHealthCheck = useCallback(() => {
    const score = healthScorer.calculate(rawNodes, rawEdges);
    setHealthScore(score);
  }, [rawNodes, rawEdges, setHealthScore]);

  // FR-34: Rule engine handler
  const handleRulesCheck = useCallback(() => {
    const violations = ruleEngine.check(rules, rawNodes, rawEdges);
    setRuleViolations(violations);
  }, [rules, rawNodes, rawEdges, setRuleViolations]);

  // FR-35: Impact radius stats
  const [impactStats, setImpactStats] = useState<{ d1: number; d2: number; d3: number; total: number } | null>(null);

  // FR-33: Hotspot analysis handler
  const [hotspotNodes, setHotspotNodes] = useState<{ nodeId: string; label: string; indegree: number; level: string }[]>([]);
  const handleHotspotToggle = useCallback(() => {
    if (panel.showHotspot) {
      setHotspotNodes([]);
      return;
    }
    const hotspots = hotspotAnalyzer.analyze(rawNodes, rawEdges);
    setHotspotNodes(hotspots);
  }, [panel.showHotspot, rawNodes, rawEdges]);

  // FR-36: God Module detection handler
  const [godModules, setGodModules] = useState<{ modulePath: string; nodeCount: number; edgeCount: number; suggestion: string }[]>([]);
  const handleGodModuleToggle = useCallback(() => {
    if (panel.showGodModule) {
      setGodModules([]);
      return;
    }
    const modules = godModuleDetector.detect(rawNodes, rawEdges);
    setGodModules(modules);
  }, [panel.showGodModule, rawNodes, rawEdges]);

  // Auto-calculate health score when panel opens
  useEffect(() => {
    if (panel.showHealthScore && !healthScore && rawNodes.length > 0) {
      handleHealthCheck();
    }
  }, [panel.showHealthScore, healthScore, rawNodes.length, handleHealthCheck]);

  // Auto-check rules when panel opens
  useEffect(() => {
    if (panel.showRules && rules.length === 0) {
      setRules(getPresetRules());
    }
  }, [panel.showRules, rules.length, setRules]);

  // Auto-run hotspot analysis when panel opens
  useEffect(() => {
    if (panel.showHotspot) {
      handleHotspotToggle();
    }
  }, [panel.showHotspot, handleHotspotToggle]);

  // Auto-run God Module detection when panel opens
  useEffect(() => {
    if (panel.showGodModule) {
      handleGodModuleToggle();
    }
  }, [panel.showGodModule, handleGodModuleToggle]);

  // FR-35: Auto-fetch impact stats when impact mode is on and a node is selected
  useEffect(() => {
    if (panel.showImpact && selectedNodeId) {
      const stats = renderer.rendererRef.current?.getImpactStats(selectedNodeId);
      setImpactStats(stats ?? null);
    } else {
      setImpactStats(null);
    }
  }, [panel.showImpact, selectedNodeId, renderer.rendererRef, nodes.length]);

  const statsText = useMemo(() => `${nodes.length} nodes · ${edges.length} edges`, [nodes.length, edges.length]);
  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of rawNodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [rawNodes]);
  const panelClassName = useMemo(() =>
    `graph-panel resizable ${panel.collapsed ? 'collapsed' : ''} ${className}`.trim(),
    [panel.collapsed, className],
  );

  const c = panel.collapsed;

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={panel.toggleCollapsed} role="button" aria-label={t('panel.expand')}>
        <GraphIcon size={22} />
      </div>

      <Toolbar
        statsText={statsText}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        layout={layout}
        theme={theme}
        filterType={filterType}
        graphType={graphType}
        clusterLevel={clusterLevel}
        showSearch={panel.showSearch}
        showCallChain={panel.showCallChain}
        showCycles={panel.showCycles}
        showImpact={panel.showImpact}
        showInheritance={panel.showInheritance}
        showMiniMap={panel.showMiniMap}
        showLegend={panel.showLegend}
        showImport={panel.showImport}
        showPathFind={panel.showPathFind}
        showHealthScore={panel.showHealthScore}
        showRules={panel.showRules}
        showHotspot={panel.showHotspot}
        showGodModule={panel.showGodModule}
        collapsed={panel.collapsed}
        onLayoutChange={setLayout}
        onThemeToggle={handleThemeToggle}
        onFilterChange={setFilterType}
        onGraphTypeChange={setGraphType}
        onClusterLevelChange={setClusterLevel}
        onToggleSearch={panel.toggleSearch}
        onToggleCallChain={panel.toggleCallChain}
        onToggleCycles={panel.toggleCycles}
        onToggleImpact={panel.toggleImpact}
        onToggleInheritance={panel.toggleInheritance}
        onToggleMiniMap={panel.toggleMiniMap}
        onToggleLegend={panel.toggleLegend}
        onToggleImport={panel.toggleImport}
        onTogglePathFind={panel.togglePathFind}
        onToggleHealthScore={panel.toggleHealthScore}
        onToggleRules={panel.toggleRules}
        onToggleHotspot={panel.toggleHotspot}
        onToggleGodModule={panel.toggleGodModule}
        onRefresh={handleRefresh}
        onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed}
        onCollapseAll={handleCollapseAll}
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch}
        onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
      />

      {panel.showSearch && !c && (
        <SearchBar
          query={searchQuery}
          matchCount={renderer.searchMatchCount}
          onChange={setSearchQuery}
          onClose={() => panel.setShowSearch(false)}
        />
      )}

      {panel.showPathFind && !c && (
        <PathBar
          onFindPath={handleFindPath}
          onClearPath={handleClearPath}
          pathResult={pathResult}
          pathLength={pathResult ? pathResult.length - 1 : null}
          onClose={() => panel.setShowPathFind(false)}
        />
      )}

      {focusNodeId && !c && (
        <FocusModeBar
          focusNodeId={focusNodeId}
          onExpand={handleFocusExpand}
          onContract={handleFocusContract}
          onExit={handleFocusExit}
        />
      )}

      {panel.showHealthScore && !c && (
        <HealthScoreCard onClose={() => panel.setShowHealthScore(false)} />
      )}

      {panel.showRules && !c && (
        <RuleConfigPanel
          violations={ruleViolations}
          onCheckRules={handleRulesCheck}
          onClose={() => panel.setShowRules(false)}
        />
      )}

      {isLoading && !c && <LoadingOverlay visible={true} />}

      {error && !c && <ErrorOverlay error={error} />}

      {nodes.length === 0 && !isLoading && !error && !c && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}

      {panel.showImport && !c && (
        <ImportPanel
          onClose={() => panel.setShowImport(false)}
          workspacePath={currentWorkspace}
          prerequisites={prerequisites}
          initStatus={initStatus}
          watchEnabled={watchEnabled}
          onSetGraphData={setGraphData}
          onSetLoading={setLoading}
          onSetError={setError}
          onSetInitStatus={setInitStatus}
          onSetWatchEnabled={setWatchEnabled}
        />
      )}
      {selectedNodeData && !c && (
        <NodeDetail
          node={selectedNodeData}
          onClose={handleCloseDetail}
          isExpanded={selectedNodeData ? expandedNodeIds.has(selectedNodeData.id) : false}
          connectionCount={selectedNodeData ? edges.filter((e) => e.source === selectedNodeData.id || e.target === selectedNodeData.id).length : 0}
          onCollapse={() => selectedNodeData && collapseNode(selectedNodeData.id)}
        />
      )}

      <div className="graph-container" ref={renderer.containerRef} />

      {panel.showLegend && !c && (<Legend onClose={() => panel.setShowLegend(false)} />)}

      {panel.showMiniMap && !c && (
        <StatsPanel
          counts={{
            function: nodeTypeCounts.function,
            class: nodeTypeCounts.class,
            variable: nodeTypeCounts.variable,
            module: nodeTypeCounts.module,
            interface: nodeTypeCounts.interface,
          }}
          onClose={() => panel.setShowMiniMap(false)}
          thumbnail={thumbnail}
          viewportInfo={viewportInfo}
          onFocusArea={(ratioX, ratioY) => renderer.rendererRef.current?.focusOnArea(ratioX, ratioY)}
        />
      )}

      {panel.showHotspot && !c && hotspotNodes.length > 0 && (
        <div className="analysis-panel hotspot-panel" role="region" aria-label={t('toolbar.hotspot')}>
          <div className="analysis-panel-header">
            <span>{t('toolbar.hotspot')}</span>
            <button onClick={() => panel.setShowHotspot(false)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 'auto' }}><CloseIcon size={14} /></button>
          </div>
          <div className="analysis-panel-content">
            {hotspotNodes.slice(0, 20).map((h) => (
              <div key={h.nodeId} className={`hotspot-item ${h.level}`}>
                <span className="hotspot-level-badge">{h.level}</span>
                <span className="hotspot-label">{h.label}</span>
                <span className="hotspot-indegree">{h.indegree}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.showGodModule && !c && godModules.length > 0 && (
        <div className="analysis-panel godmodule-panel" role="region" aria-label={t('toolbar.godModule')}>
          <div className="analysis-panel-header">
            <span>{t('toolbar.godModule')}</span>
            <button onClick={() => panel.setShowGodModule(false)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 'auto' }}><CloseIcon size={14} /></button>
          </div>
          <div className="analysis-panel-content">
            {godModules.map((m) => (
              <div key={m.modulePath} className="godmodule-item">
                <div className="godmodule-path">{m.modulePath}</div>
                <div className="godmodule-stats">{m.nodeCount} nodes · {m.edgeCount} edges</div>
                <div className="godmodule-suggestion">{m.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.showImpact && !c && impactStats && (
        <div className="analysis-panel impact-panel" role="region" aria-label={t('toolbar.impact')}>
          <div className="analysis-panel-header">
            <span>{t('toolbar.impact')}</span>
          </div>
          <div className="analysis-panel-content">
            <div className="impact-stat-row">
              <span className="impact-stat-badge d1">D1</span>
              <span className="impact-stat-count">{impactStats.d1}</span>
            </div>
            <div className="impact-stat-row">
              <span className="impact-stat-badge d2">D2</span>
              <span className="impact-stat-count">{impactStats.d2}</span>
            </div>
            <div className="impact-stat-row">
              <span className="impact-stat-badge d3">D3</span>
              <span className="impact-stat-count">{impactStats.d3}</span>
            </div>
            <div className="impact-stat-total">{t('impact.total')}: {impactStats.total}</div>
          </div>
        </div>
      )}

      {tooltip && <GraphTooltip data={tooltip} />}

      <KeyboardHelp visible={showHelp} onClose={() => setShowHelp(false)} />

      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated} watchEnabled={watchEnabled} workspaceName={currentWorkspace} truncated={truncated} totalNodeCount={totalNodeCount} totalEdgeCount={totalEdgeCount} displayedNodeCount={nodes.length} />

      <div className="resize-handle" aria-hidden="true" />
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
