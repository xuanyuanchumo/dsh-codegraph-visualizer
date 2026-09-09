import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore, type ThemeType } from './store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import type { GraphNode, GraphEdge } from '../types/index.ts';
import { NodeId } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard } from './hooks/index.ts';
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
import { GraphIcon, CloseIcon } from './components/Icons.tsx';
import { HealthScorer } from '../shared/analysis/HealthScorer.ts';
import { RuleEngine, getPresetRules } from '../shared/analysis/RuleEngine.ts';
import { HotspotAnalyzer, GodModuleDetector } from '../shared/analysis/HotspotAnalyzer.ts';
import { fetchGraphData } from './api/index.ts';
import { scoped } from '../shared/Logger.ts';
import { useT } from './i18n/index.ts';
import './styles.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const healthScorer = useMemo(() => new HealthScorer(), []);
  const ruleEngine = useMemo(() => new RuleEngine(), []);
  const hotspotAnalyzer = useMemo(() => new HotspotAnalyzer(), []);
  const godModuleDetector = useMemo(() => new GodModuleDetector(), []);
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

  const {
    nodes, edges, rawNodes, rawEdges, layout, theme, searchQuery, selectedNodeId,
    highlightedNodeIds, filterType, graphType, clusterLevel, isLoading, error, lastUpdated,
    prerequisites, watchEnabled, currentWorkspace, workspaceList,
    initStatus, truncated, totalNodeCount, expandedNodeIds,
    pathResult, focusDepth, healthScore, rules, ruleViolations,
    viewMode,
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
    truncated: s.truncated, totalNodeCount: s.totalNodeCount,
    expandedNodeIds: s.expandedNodeIds,
    pathResult: s.pathResult,
    focusDepth: s.focusDepth, healthScore: s.healthScore,
    rules: s.rules, ruleViolations: s.ruleViolations,
    viewMode: s.viewMode,
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
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const panelHeight = useGraphStore((s) => s.panelHeight);
  const panelWidth = useGraphStore((s) => s.panelWidth);

  const handleCollapseAll = useCallback(() => {
    collapseAll();
  }, [collapseAll]);

  const panel = usePanelState();
  const history = useHistory();
  const graphCache = useGraphCache();
  // FR-53: Smart cache — cache graph data on workspace switch
  const prevWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentWorkspace) return;
    if (prevWorkspaceRef.current && prevWorkspaceRef.current !== currentWorkspace) {
      const cached = graphCache.getCachedData(currentWorkspace);
      if (cached) {
        setGraphData(cached.nodes, cached.edges, currentWorkspace);
      }
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

  // FR-27: Smart focus linkage — listen for editor symbol selection events
  useEffect(() => {
    const symbolHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { symbol?: string; filePath?: string; lineNumber?: number };
      if (!detail?.symbol) return;
      const sym = detail.symbol;
      const store = useGraphStore.getState();
      const match = store.rawNodes.find((n) =>
        n.label === sym ||
        n.label.endsWith(`.${sym}`) ||
        n.label.includes(sym),
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

    if (panelHeight !== null && panelHeight >= 240) {
      panelEl.style.height = `${panelHeight}px`;
    }
    if (panelWidth !== null && panelWidth >= 320) {
      panelEl.style.width = `${panelWidth}px`;
    }
    if (panelHeight !== null || panelWidth !== null) {
      renderer.rendererRef.current?.resize();
    }
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

    let rafId: number | null = null;
    const applyAncestorHeight = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const h = target.getBoundingClientRect().height;
        if (h >= 240) {
          panelEl.style.height = `${h}px`;
          renderer.rendererRef.current?.resize();
        }
      });
    };

    applyAncestorHeight();
    const ro = new ResizeObserver(applyAncestorHeight);
    ro.observe(target);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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

  // Abort in-flight dependency fetch on unmount
  useEffect(() => () => depsFetchAbortRef.current?.abort(), []);

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

  // FR-21: View mode toggle — code graph vs dependency graph
  const prevClusterLevelRef = useRef(clusterLevel);
  const prevGraphTypeRef = useRef(graphType);
  const prevFilterTypeRef = useRef(filterType);
  const prevLayoutRef = useRef(layout);
  const handleToggleViewMode = useCallback(() => {
    const newMode = viewMode === 'code' ? 'dependencies' : 'code';
    setViewMode(newMode);
    if (newMode === 'dependencies') {
      prevClusterLevelRef.current = clusterLevel;
      prevGraphTypeRef.current = graphType;
      prevFilterTypeRef.current = filterType;
      prevLayoutRef.current = layout;
      setClusterLevel('directory');
      setGraphType('dependency');
      setFilterType('all');
      setLayout('radial');
      setLoading(true);
      const controller = new AbortController();
      depsFetchAbortRef.current?.abort();
      depsFetchAbortRef.current = controller;
      fetch('/api/v1/codegraph/dependencies', { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.nodes && data.nodes.length > 0) {
            setGraphData(data.nodes, data.edges, data.metadata?.repoId || currentWorkspace);
          }
        })
        .catch(() => { if (!controller.signal.aborted) setError(t('error.title')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else {
      depsFetchAbortRef.current?.abort();
      setClusterLevel(prevClusterLevelRef.current);
      setGraphType(prevGraphTypeRef.current);
      setFilterType(prevFilterTypeRef.current);
      setLayout(prevLayoutRef.current);
      setLoading(true);
      fetchGraphData().then((data) => {
        if (data) {
          setGraphData(data.nodes, data.edges, data.metadata.repoId, data.metadata);
        }
        setLoading(false);
      }).catch(() => { setLoading(false); });
    }
  }, [viewMode, setViewMode, setLoading, setGraphData, setError, currentWorkspace, clusterLevel, graphType, filterType, layout, setClusterLevel, setGraphType, setFilterType, setLayout]);

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

  // FR-33: Hotspot analysis state (auto-computed when panel opens)
  const [hotspotNodes, setHotspotNodes] = useState<{ nodeId: string; label: string; indegree: number; level: string }[]>([]);

  // FR-36: God Module detection state (auto-computed when panel opens)
  const [godModules, setGodModules] = useState<{ modulePath: string; nodeCount: number; edgeCount: number; suggestion: string }[]>([]);

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
    if (panel.showHotspot && rawNodes.length > 0) {
      setHotspotNodes(hotspotAnalyzer.analyze(rawNodes, rawEdges));
    }
  }, [panel.showHotspot, rawNodes, rawEdges]);

  // Auto-run God Module detection when panel opens
  useEffect(() => {
    if (panel.showGodModule && rawNodes.length > 0) {
      setGodModules(godModuleDetector.detect(rawNodes, rawEdges));
    }
  }, [panel.showGodModule, rawNodes, rawEdges]);

  // FR-XX: Auto-fill graph on first panel open
  // When panel is opened with no data and prerequisites are met, auto-trigger scan.
  // This eliminates the "manual fill" friction while still guarding against
  // scanning when upstream tools are unavailable.
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

  const isCollapsed = panel.collapsed;

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <div className="collapse-fab" onClick={panel.toggleCollapsed} role="button" tabIndex={0} aria-label={t('panel.expand')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel.toggleCollapsed(); } }}>
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
        viewMode={viewMode}
        collapsed={panel.collapsed}
        panelControls={{
          showSearch: panel.showSearch,
          showCallChain: panel.showCallChain,
          showCycles: panel.showCycles,
          showImpact: panel.showImpact,
          showInheritance: panel.showInheritance,
          showMiniMap: panel.showMiniMap,
          showLegend: panel.showLegend,
          showImport: panel.showImport,
          showPathFind: panel.showPathFind,
          showHealthScore: panel.showHealthScore,
          showRules: panel.showRules,
          showHotspot: panel.showHotspot,
          showGodModule: panel.showGodModule,
          onToggleSearch: panel.toggleSearch,
          onToggleCallChain: panel.toggleCallChain,
          onToggleCycles: panel.toggleCycles,
          onToggleImpact: panel.toggleImpact,
          onToggleInheritance: panel.toggleInheritance,
          onToggleMiniMap: panel.toggleMiniMap,
          onToggleLegend: panel.toggleLegend,
          onToggleImport: panel.toggleImport,
          onTogglePathFind: panel.togglePathFind,
          onToggleHealthScore: panel.toggleHealthScore,
          onToggleRules: panel.toggleRules,
          onToggleHotspot: panel.toggleHotspot,
          onToggleGodModule: panel.toggleGodModule,
        }}
        onToggleViewMode={handleToggleViewMode}
        onLayoutChange={setLayout}
        onThemeToggle={handleThemeToggle}
        onFilterChange={setFilterType}
        onGraphTypeChange={setGraphType}
        onClusterLevelChange={setClusterLevel}
        onRefresh={handleRefresh}
        onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed}
        onCollapseAll={handleCollapseAll}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch}
        onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
      />

      {panel.showSearch && !isCollapsed && (
        <SearchBar
          query={searchQuery}
          matchCount={renderer.searchMatchCount}
          onChange={setSearchQuery}
          onClose={() => panel.setShowSearch(false)}
        />
      )}

      {panel.showPathFind && !isCollapsed && (
        <PathBar
          onFindPath={handleFindPath}
          onClearPath={handleClearPath}
          pathResult={pathResult}
          pathLength={pathResult ? pathResult.length - 1 : null}
          onClose={() => panel.setShowPathFind(false)}
        />
      )}

      {focusNodeId && !isCollapsed && (
        <FocusModeBar
          focusNodeId={focusNodeId}
          onExpand={handleFocusExpand}
          onContract={handleFocusContract}
          onExit={handleFocusExit}
        />
      )}

      {panel.showHealthScore && !isCollapsed && (
        <HealthScoreCard onClose={() => panel.setShowHealthScore(false)} />
      )}

      {panel.showRules && !isCollapsed && (
        <RuleConfigPanel
          violations={ruleViolations}
          onCheckRules={handleRulesCheck}
          onClose={() => panel.setShowRules(false)}
        />
      )}

      {isLoading && !isCollapsed && <LoadingOverlay visible={true} />}

      {error && !isCollapsed && <ErrorOverlay error={error} />}

      {nodes.length === 0 && !isLoading && !error && !isCollapsed && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}

      {panel.showImport && !isCollapsed && (
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
      {selectedNodeData && !isCollapsed && (
        <NodeDetail
          node={selectedNodeData}
          onClose={handleCloseDetail}
          isExpanded={selectedNodeData ? expandedNodeIds.has(selectedNodeData.id) : false}
          connectionCount={selectedNodeData ? edges.filter((e) => e.source === selectedNodeData.id || e.target === selectedNodeData.id).length : 0}
          onCollapse={() => selectedNodeData && collapseNode(selectedNodeData.id)}
        />
      )}

      <div className="graph-container" ref={renderer.containerRef} />

      {panel.showLegend && !isCollapsed && (<Legend onClose={() => panel.setShowLegend(false)} />)}

      {panel.showMiniMap && !isCollapsed && (
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

      {panel.showHotspot && !isCollapsed && hotspotNodes.length > 0 && (
        <div className="analysis-panel hotspot-panel" role="region" aria-label={t('toolbar.hotspot')}>
          <div className="analysis-panel-header">
            <span>{t('toolbar.hotspot')}</span>
            <button onClick={() => panel.setShowHotspot(false)} className="cg-close-btn"><CloseIcon size={14} /></button>
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

      {panel.showGodModule && !isCollapsed && godModules.length > 0 && (
        <div className="analysis-panel godmodule-panel" role="region" aria-label={t('toolbar.godModule')}>
          <div className="analysis-panel-header">
            <span>{t('toolbar.godModule')}</span>
            <button onClick={() => panel.setShowGodModule(false)} className="cg-close-btn"><CloseIcon size={14} /></button>
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

      {panel.showImpact && !isCollapsed && impactStats && (
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

      <StatusBar error={error} isLoading={isLoading} lastUpdated={lastUpdated} watchEnabled={watchEnabled} workspaceName={currentWorkspace} truncated={truncated} totalNodeCount={totalNodeCount} displayedNodeCount={nodes.length} />

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
