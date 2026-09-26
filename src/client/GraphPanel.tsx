import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore } from './store/graphStore.ts';
import type { ThemeType } from './store/graphStore.ts';

import type { GraphNode, GraphEdge } from '../types/index.ts';
import type { ClusterNode } from './store/cluster/index.ts';
import { NodeId } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard, useViewMode, useAnalysisPanels, useNodeSearch,
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus, useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions, usePanelDimensions,
} from './hooks/index.ts';
import { readUrlExpand, restoreExpandedNodeIds, updateUrlExpand } from './utils/urlState.ts';
import { getViewLayer, getAvailablePanels } from '../shared/viewModeUtils.ts';
import { useThemeSync } from './hooks/useThemeSync.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useGraphCache } from './hooks/useGraphCache.ts';
import { invalidateCssVarCache } from './renderer/styles/ThemeStylesheet.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Legend } from './components/Legend.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { SearchBar, type SearchResultItem } from './components/SearchBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { NodeDetail } from './components/NodeDetail.tsx';
import { StatsPanel } from './components/StatsPanel.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { GraphTooltip, type TooltipData, type EdgeTooltipData } from './components/GraphTooltip.tsx';
import { ContextMenu } from './components/ContextMenu.tsx';
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
import { CyclePanel } from './components/CyclePanel.tsx';
import { CoreFunctionPanel } from './components/CoreFunctionPanel.tsx';
import { FilterPanel } from './components/FilterPanel.tsx';
import { TourPanel } from './components/TourPanel.tsx';
import { buildTour } from '../shared/analysis/TourBuilder.ts';
import { MicroViewPrompt, MicroFunctionBar } from './components/MicroViewBar.tsx';
import { GraphIcon } from './components/Icons.tsx';

import { SequenceDiagramRenderer } from './renderer/SequenceDiagramRenderer.tsx';
import { scoped } from '../shared/Logger.ts';
import { DOM_EVENTS } from '../shared/domEvents.ts';
import { LOD, UI, PREFETCH } from '../shared/constants.ts';

import { useT } from './i18n/index.ts';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/overlays.css';
import './styles/graph.css';
import './styles/node-detail.css';
import './styles/import-workspace.css';
import './styles/path-finder.css';
import './styles/analysis-panels.css';
import './styles/responsive.css';
import './styles/misc.css';

const log = scoped('panel');

interface GraphPanelProps {
  className?: string;
}

function GraphPanelInner({ className = '' }: GraphPanelProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const depsFetchAbortRef = useRef<AbortController | null>(null);
  const getDataRef = useRef<{
    getSelectedNodeData: () => GraphNode | ClusterNode | null;
    getNodeData: (id: string) => GraphNode | ClusterNode | null;
    getEdgeData: (id: string) => GraphEdge | null;
  } | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | ClusterNode | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | EdgeTooltipData | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [viewportInfo, setViewportInfo] = useState<{
    zoom: number; pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState<number>(0);
  const [hasHiddenNodes, setHasHiddenNodes] = useState<boolean>(false);

  const { nodes, edges, rawNodes, rawEdges } = useGraphData();
  const { layout, dagreRankDir, theme, filterType, graphType, clusterDepth, viewMode, currentLayer, diagramData } = useGraphDisplay();
  const { searchQuery, selectedNodeId, highlightedNodeIds, expandedNodeIds, pathResult, focusDepth, focusModeActive, focusModeNodeId, pathFilterInclude, pathFilterExclude } = useGraphInteraction();
  const { isLoading, error, lastUpdated, truncated, totalNodeCount, prerequisites, watchEnabled, initStatus } = useGraphStatus();
  const { currentWorkspace, workspaceList } = useGraphWorkspace();
  const { ruleViolations, selectedFunction, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, heatmapMode } = useGraphAnalysis();
  const { performanceDegradations, lodLevel, lodEnabled } = useGraphPerformance();
  const actions = useGraphActions();
  const { panelHeight, panelWidth } = usePanelDimensions();

  const {
    setLayout, setDagreRankDir, setTheme, setSearchQuery, setSelectedNode,
    setFilterType, setGraphType, setClusterDepth, setLayer, setLoading,
    setCurrentWorkspace, addWorkspace, removeWorkspace, setGraphData,
    setInitStatus, setWatchEnabled, setError, expandNode, collapseNode,
    collapseAll, setPathResult, setFocusDepth, setHeatmapMode, setLODLevel,
    assembleMicro,
  } = actions;

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

  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (urlRestoredRef.current) return;
    if (rawNodes.length === 0) return;
    const parsed = readUrlExpand();
    if (parsed.expandedDirs.length === 0 && parsed.expandedFiles.length === 0 && parsed.expandedSymbols.length === 0 && parsed.expandedSubgroups.length === 0) {
      urlRestoredRef.current = true;
      return;
    }
    const restoredIds = restoreExpandedNodeIds(parsed);
    const validIds = new Set<string>();
    for (const id of restoredIds) {
      const exists = rawNodes.some(n => n.id === id) || useGraphStore.getState().nodes.some(n => n.id === id);
      if (exists) validIds.add(id);
    }
    if (validIds.size > 0) {
      const store = useGraphStore.getState();
      store.batchExpandNodes([...validIds]);
    }
    urlRestoredRef.current = true;
  }, [rawNodes]);

  useEffect(() => {
    if (!urlRestoredRef.current) return;
    updateUrlExpand(expandedNodeIds);
  }, [expandedNodeIds]);

  const debouncedSearch = useDebounce(searchQuery, UI.SEARCH_DEBOUNCE_MS);
  const { search: searchNodes } = useNodeSearch(rawNodes);
  const showCallChainRef = useRef(panel.showCallChain);

  const adjacencyMap = useMemo(() => {
    const map = new Map<string, { in: number; out: number }>();
    for (const edge of edges) {
      const src = map.get(edge.source);
      if (src) src.out++;
      else map.set(edge.source, { in: 0, out: 1 });
      const tgt = map.get(edge.target);
      if (tgt) tgt.in++;
      else map.set(edge.target, { in: 1, out: 0 });
    }
    return map;
  }, [edges]);
  useEffect(() => { showCallChainRef.current = panel.showCallChain; }, [panel.showCallChain]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) useGraphStore.getState().setCurrentWorkspace(detail.path);
    };
    window.addEventListener(DOM_EVENTS.WORKSPACE, handler);
    return () => window.removeEventListener(DOM_EVENTS.WORKSPACE, handler);
  }, []);

  const handleWorkspaceSwitch = useCallback((path: string) => {
    setCurrentWorkspace(path);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path } }));
  }, [setCurrentWorkspace]);

  const handleWorkspaceAdd = useCallback((path: string) => {
    addWorkspace(path, path.split(/[\\/]/).pop() || path);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.WORKSPACE, { detail: { path } }));
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.IMPORT_REPO, { detail: { path } }));
  }, [addWorkspace]);

  const handleNodeTap = useCallback((id: NodeId) => {
    try {
      setSelectedNode(id);
      const data = getDataRef.current?.getNodeData(id) ?? null;
      setSelectedNodeData(data);
    } catch (err) {
      log.error('handleNodeTap failed', { id, err });
    }
  }, [setSelectedNode]);

  const handleNodeDoubleTapRef = useRef<(nodeId: string) => void>(() => {});

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    handleNodeDoubleTapRef.current(nodeId);
  }, []);

  const handleNodeHover = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    try {
      const data = getDataRef.current?.getNodeData(nodeId);
      if (data) {
        const counts = adjacencyMap.get(nodeId) ?? { in: 0, out: 0 };
        setTooltip({ x: pos.x, y: pos.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type, linksIn: counts.in, linksOut: counts.out });
      }
    } catch (err) {
      log.error('handleNodeHover failed', { nodeId, err });
    }
  }, [adjacencyMap]);

  const handleNodeHoverOut = useCallback(() => setTooltip(null), []);

  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodeHoverPrefetch = useCallback((nodeId: string) => {
    if (hoverPrefetchTimerRef.current) clearTimeout(hoverPrefetchTimerRef.current);
    hoverPrefetchTimerRef.current = setTimeout(() => {
      useGraphStore.getState().prefetchExpand(nodeId);
    }, PREFETCH.HOVER_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (hoverPrefetchTimerRef.current) clearTimeout(hoverPrefetchTimerRef.current); }, []);
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

  const handleEdgeTap = useCallback((edgeId: string, pos: { x: number; y: number }) => {
    try {
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
    } catch (err) {
      log.error('handleEdgeTap failed', { edgeId, err });
    }
  }, []);

  const renderer = useGraphRenderer({
    data: { nodes, edges, rawNodes },
    display: { layout, dagreRankDir, theme, clusterDepth, heatmapMode },
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
    window.addEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
    return () => window.removeEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
  }, [renderer.rendererRef]);

  useThemeSync(renderer.updateTheme);

  useEffect(() => {
    if (!lodEnabled) return;
    const r = renderer.rendererRef.current;
    if (!r) return;
    let rafId: number | null = null;
    const computeLODFromZoom = (zoom: number) => {
      const nodeCount = rawNodes.length;
      let minimalThreshold: number;
      let compactThreshold: number;
      if (nodeCount < LOD.SMALL_NODE_COUNT) {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_SMALL;
        compactThreshold = LOD.COMPACT_THRESHOLD_SMALL;
      } else if (nodeCount < LOD.MEDIUM_NODE_COUNT) {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_MEDIUM;
        compactThreshold = LOD.COMPACT_THRESHOLD_MEDIUM;
      } else {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_LARGE;
        compactThreshold = LOD.COMPACT_THRESHOLD_LARGE;
      }
      if (zoom < minimalThreshold) return 'minimal' as const;
      if (zoom < compactThreshold) return 'compact' as const;
      return 'full' as const;
    };
    const handleZoom = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const newLevel = computeLODFromZoom(r.getZoom());
        if (newLevel !== lodLevel) setLODLevel(newLevel);
      });
    };
    const disposeZoomListener = r.onZoomChange(handleZoom);
    return () => {
      disposeZoomListener();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [lodEnabled, lodLevel, rawNodes.length, renderer.rendererRef, setLODLevel]);

  usePanelResize(panelRef, renderer.rendererRef);

  useEffect(() => {
    if (panel.collapsed) return;
    const panelEl = panelRef.current;
    if (!panelEl) return;
    if (panelHeight !== null && panelHeight >= UI.MIN_PANEL_HEIGHT_PX) panelEl.style.height = `${Math.min(panelHeight, window.innerHeight)}px`;
    if (panelWidth !== null && panelWidth >= UI.MIN_PANEL_WIDTH_PX) panelEl.style.width = `${panelWidth}px`;
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
      if (h >= UI.ANCESTOR_MIN_HEIGHT_PX) break;
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
        const maxH = window.innerHeight;
        const finalH = Math.min(h, maxH);
        if (finalH > 0) {
          panelEl.style.height = `${finalH}px`;
          renderer.rendererRef.current?.resize();
        }
      }, UI.RESIZE_DEBOUNCE_MS);
    };
    applyAncestorHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(applyAncestorHeight);
      ro.observe(target);
      return () => { ro.disconnect(); if (resizeTimer !== null) clearTimeout(resizeTimer); };
    } else {
      const onWinResize = () => applyAncestorHeight();
      window.addEventListener('resize', onWinResize);
      return () => { window.removeEventListener('resize', onWinResize); if (resizeTimer !== null) clearTimeout(resizeTimer); };
    }
  }, [panel.collapsed, panelHeight, renderer.rendererRef]);

  usePanelKeyboard(layout, setLayout, renderer.rendererRef, {
    onToggleSearch: panel.toggleSearch,
    onCloseAll: () => {
      panel.setShowSearch(false); panel.setShowCallChain(false); panel.setShowCycles(false);
      panel.setShowImpact(false); panel.setShowInheritance(false); panel.setShowImport(false); panel.setShowLegend(false);
      panel.setShowPathFind(false); panel.setShowHealthScore(false); panel.setShowRules(false);
      panel.setShowHotspot(false); panel.setShowGodModule(false); panel.setShowCoreFunction(false);
      panel.setShowFilterPanel(false); panel.setShowTour(false);
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
    onRefresh: () => {
      setLoading(true);
      window.dispatchEvent(new CustomEvent(DOM_EVENTS.REFRESH, { detail: { incremental: false } }));
    },
  });

  const requestRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.REFRESH, { detail: { incremental: true } }));
  }, []);
  usePolling(requestRefresh, watchEnabled ? UI.POLLING_INTERVAL_WATCH_MS : UI.POLLING_INTERVAL_IDLE_MS, !panel.collapsed);

  useEffect(() => {
    const count = renderer.rendererRef.current?.getVisibleNodeCount() ?? 0;
    setVisibleNodeCount(count);
    setHasHiddenNodes(count < nodes.length);
  }, [filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, renderer.rendererRef, nodes.length]);

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
    const throttledUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate < UI.MINIMAP_THROTTLE_MS) return;
      lastUpdate = now;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateMiniMap);
    };
    const fallbackId = setInterval(throttledUpdate, UI.MINIMAP_UPDATE_INTERVAL_MS);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearInterval(fallbackId);
    };
  }, [panel.showMiniMap, panel.collapsed, renderer.rendererRef, nodes.length, layout]);

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

  const { handleViewModeChange, handleSelectFunction: rawHandleSelectFunction, handleCloseMicroView, handleAggregateCallChain } = useViewMode(
    viewMode, currentWorkspace, depsFetchAbortRef,
  );

  const handleSelectFunction = useCallback((nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => {
    setSelectedNodeData(null);
    rawHandleSelectFunction(nodeId, filePath, functionName, mode);
  }, [rawHandleSelectFunction]);

  useEffect(() => {
    setFocusNodeId(null);
  }, [viewMode]);

  useEffect(() => {
    const layer = getViewLayer(viewMode);
    const available = getAvailablePanels(layer);
    if (!available.has('showCallChain') && panel.showCallChain) panel.setShowCallChain(false);
    if (!available.has('showCycles') && panel.showCycles) panel.setShowCycles(false);
    if (!available.has('showImpact') && panel.showImpact) panel.setShowImpact(false);
    if (!available.has('showInheritance') && panel.showInheritance) panel.setShowInheritance(false);
    if (!available.has('showHotspot') && panel.showHotspot) panel.setShowHotspot(false);
    if (!available.has('showGodModule') && panel.showGodModule) panel.setShowGodModule(false);
    if (!available.has('showCoreFunction') && panel.showCoreFunction) panel.setShowCoreFunction(false);
    if (!available.has('showHealthScore') && panel.showHealthScore) panel.setShowHealthScore(false);
    if (!available.has('showRules') && panel.showRules) panel.setShowRules(false);
    if (!available.has('showImport') && panel.showImport) panel.setShowImport(false);
    if (!available.has('showFilterPanel') && panel.showFilterPanel) panel.setShowFilterPanel(false);
  }, [viewMode]);

  useEffect(() => {
    handleNodeDoubleTapRef.current = (nodeId: string) => {
      try {
        const data = getDataRef.current?.getNodeData(nodeId);
        const isClusterNode = data ? ('isCluster' in data && data.isCluster === true) : nodeId.startsWith('cluster__') || nodeId.startsWith('filecluster__') || nodeId.startsWith('subgroup__');
        if (isClusterNode) {
          const isExpanded = expandedNodeIds.has(nodeId);
          if (isExpanded) collapseNode(nodeId);
          else expandNode(nodeId);
        } else if (data && data.type === 'function') {
          setSelectedNode(NodeId(nodeId));
          setSelectedNodeData(data);
        } else {
          setFocusNodeId((prev) => {
            if (prev === nodeId) {
              setSelectedNode(null);
              return null;
            }
            setSelectedNode(null);
            return nodeId;
          });
        }
      } catch (err) {
        log.error('handleNodeDoubleTap failed', { nodeId, err });
      }
    };
  }, [expandedNodeIds, collapseNode, expandNode, handleSelectFunction, setSelectedNode]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.REFRESH, { detail: { incremental: false } }));
    log.info('manual refresh (full)');
  }, [setLoading]);

  const handleScanWorkspace = useCallback(() => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.IMPORT_REPO, { detail: { path: currentWorkspace || '.' } }));
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
    setSelectedNode(null);
    renderer.rendererRef.current?.focusNeighborhood(null);
  }, [setFocusDepth, setSelectedNode, renderer.rendererRef]);

  const getImpactStats = useCallback(() => {
    if (!selectedNodeId) return null;
    return renderer.rendererRef.current?.getImpactStats(selectedNodeId) ?? null;
  }, [renderer.rendererRef, selectedNodeId]);

  const { handleRulesCheck, hotspotNodes, godModules, impactStats, coreFunctions } = useAnalysisPanels(
    rawNodes, rawEdges,
    panel.showHealthScore, panel.showRules, panel.showHotspot, panel.showGodModule,
    panel.showImpact, selectedNodeId, getImpactStats, panel.showCoreFunction,
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

  const statsText = useMemo(() => {
    const totalNodes = diagramData?.allNodes.length ?? nodes.length;
    const totalEdges = diagramData?.allEdges.length ?? edges.length;
    return t('stats.nodesEdges', { nodes: totalNodes, edges: totalEdges });
  }, [nodes.length, edges.length, diagramData, t]);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    if (!debouncedSearch) return [];
    return searchNodes(debouncedSearch, 50)
      .map((n) => ({ id: n.id, label: n.label, type: n.type, filePath: n.filePath }));
  }, [debouncedSearch, searchNodes]);

  const handleSelectSearchResult = useCallback((id: string) => {
    try {
      setSelectedNode(NodeId(id));
      const data = getDataRef.current?.getNodeData(NodeId(id)) ?? null;
      setSelectedNodeData(data);
      panel.setShowSearch(false);
    } catch (err) {
      log.error('handleSelectSearchResult failed', { id, err });
    }
  }, [setSelectedNode, panel]);

  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of rawNodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [rawNodes]);

  const cycleDetails = useMemo(() => {
    if (!panel.showCycles) return [];
    return renderer.rendererRef.current?.detectCyclesDetailed() ?? [];
  }, [panel.showCycles, nodes.length, edges.length]);

  const tourData = useMemo(() => buildTour(rawNodes, rawEdges), [rawNodes, rawEdges]);

  const panelClassName = useMemo(() =>
    `cg-graph-panel cg-resizable ${panel.collapsed ? 'cg-collapsed' : ''} ${className}`.trim(),
    [panel.collapsed, className],
  );

  const isCollapsed = panel.collapsed;
  const isMicroView = viewMode === 'cfg' || viewMode === 'flowchart' || viewMode === 'sequence';

  return (
    <div className={panelClassName} ref={panelRef} role="region" aria-label={t('panel.ariaLabel')}>
      <button className="cg-collapse-fab" onClick={panel.toggleCollapsed} aria-label={t('panel.expand')}>
        <GraphIcon size={22} />
      </button>

      <Toolbar
        statsText={statsText}
        typeCounts={{ function: nodeTypeCounts.function, class: nodeTypeCounts.class, interface: nodeTypeCounts.interface }}
        layout={layout} dagreRankDir={dagreRankDir} theme={theme} filterType={filterType} graphType={graphType}
        clusterDepth={clusterDepth} viewMode={viewMode} currentLayer={currentLayer}
        layerNames={diagramData?.layers.map((l) => l.name) ?? []}
        onLayerChange={setLayer} collapsed={panel.collapsed}
        panelControls={panel.toPanelControls}
        onViewModeChange={handleViewModeChange} onLayoutChange={setLayout}
        onDagreRankDirChange={setDagreRankDir}
        onThemeToggle={handleThemeToggle} onFilterChange={setFilterType}
        onGraphTypeChange={setGraphType} onClusterDepthChange={setClusterDepth}
        onRefresh={handleRefresh} onExport={renderer.exportGraph}
        onCollapse={panel.toggleCollapsed} onCollapseAll={handleCollapseAll}
        onUndo={history.undo} onRedo={history.redo}
        canUndo={history.canUndo} canRedo={history.canRedo}
        hasSelectedFunction={!!selectedFunction}
        currentWorkspace={currentWorkspace} workspaceList={workspaceList}
        onSwitchWorkspace={handleWorkspaceSwitch} onAddWorkspace={handleWorkspaceAdd}
        onRemoveWorkspace={removeWorkspace}
      />

      <div className="cg-panel-stack cg-panel-stack-left">
        {panel.showSearch && !isCollapsed && (
          <GraphErrorBoundary><SearchBar query={searchQuery} matchCount={renderer.searchMatchCount}
            searchResults={searchResults}
            onChange={setSearchQuery} onClose={() => panel.setShowSearch(false)}
            onSelectResult={handleSelectSearchResult} /></GraphErrorBoundary>
        )}

        {panel.showPathFind && !isCollapsed && (
          <GraphErrorBoundary><PathBar onFindPath={handleFindPath} onClearPath={handleClearPath}
            pathResult={pathResult} pathLength={pathResult ? pathResult.length - 1 : null}
            onClose={() => panel.setShowPathFind(false)} /></GraphErrorBoundary>
        )}

        {panel.showHealthScore && !isCollapsed && (
          <GraphErrorBoundary><HealthScoreCard onClose={() => panel.setShowHealthScore(false)} /></GraphErrorBoundary>
        )}

        {panel.showRules && !isCollapsed && (
          <GraphErrorBoundary><RuleConfigPanel violations={ruleViolations} onCheckRules={handleRulesCheck}
            onClose={() => panel.setShowRules(false)} /></GraphErrorBoundary>
        )}

        {selectedNodeData && !isCollapsed && (
          <GraphErrorBoundary><NodeDetail node={selectedNodeData} onClose={handleCloseDetail}
            isExpanded={selectedNodeData ? expandedNodeIds.has(selectedNodeData.id) : false}
            connectionCount={selectedNodeData ? (adjacencyMap.get(selectedNodeData.id)?.in ?? 0) + (adjacencyMap.get(selectedNodeData.id)?.out ?? 0) : 0}
            onCollapse={() => selectedNodeData && collapseNode(selectedNodeData.id)}
            onSelectFunction={(node, mode) => handleSelectFunction(node.id, node.filePath, node.label, mode)}
            onAggregateCallChain={handleAggregateCallChain} /></GraphErrorBoundary>
        )}

        {panel.showLegend && !isCollapsed && (
          <GraphErrorBoundary><Legend viewMode={viewMode} onClose={() => panel.setShowLegend(false)} /></GraphErrorBoundary>
        )}

        {panel.showImport && !isCollapsed && (
          <GraphErrorBoundary><ImportPanel onClose={() => panel.setShowImport(false)} workspacePath={currentWorkspace}
            prerequisites={prerequisites} initStatus={initStatus} watchEnabled={watchEnabled}
            onSetGraphData={setGraphData} onSetLoading={setLoading} onSetError={setError}
            onSetInitStatus={setInitStatus} onSetWatchEnabled={setWatchEnabled} /></GraphErrorBoundary>
        )}
      </div>

      {!isCollapsed && !isMicroView && (
        <div className={`cg-heatmap-bar ${heatmapMode === 'none' ? 'cg-heatmap-bar--collapsed' : ''}`} role="group" aria-label={t('heatmap.title')}>
          {heatmapMode === 'none' ? (
            <button
              className="cg-heatmap-btn cg-heatmap-btn--activate"
              onClick={() => setHeatmapMode('instability')}
              aria-label={t('heatmap.title')}
            >
              {t('heatmap.title')}
            </button>
          ) : (
            <>
              <span className="cg-heatmap-label">{t('heatmap.title')}:</span>
              {(['none', 'instability', 'lines', 'complexity'] as const).map((m) => (
                <button
                  key={m}
                  className={`cg-heatmap-btn ${heatmapMode === m ? 'cg-active' : ''}`}
                  onClick={() => setHeatmapMode(m)}
                  aria-pressed={heatmapMode === m}
                  aria-label={t(`heatmap.${m}`)}
                >
                  {t(`heatmap.${m}`)}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {focusNodeId && !isCollapsed && (
        <GraphErrorBoundary><FocusModeBar focusNodeId={focusNodeId}
          onExpand={handleFocusExpand} onContract={handleFocusContract} onExit={handleFocusExit} /></GraphErrorBoundary>
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

      {nodes.length === 0 && !isLoading && !error && !isCollapsed && !isMicroView && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}



      <div className="cg-graph-container" ref={renderer.containerRef}
        role="application"
        aria-label={t('a11y.graphContainer') + `: ${t(`viewMode.${viewMode}`)}, ${nodes.length} ${t('a11y.nodes')}, ${edges.length} ${t('a11y.edges')}`}
        aria-describedby="cg-graph-live-region"
        style={{ display: viewMode === 'sequence' && selectedFunction ? 'none' : undefined }}>
        <div id="cg-graph-live-region" className="cg-visually-hidden" role="status" aria-live="polite">
          {selectedNodeData
            ? `${t('a11y.selectedNode')}: ${selectedNodeData.label}, ${selectedNodeData.type}, ${selectedNodeData.filePath}:${selectedNodeData.lineNumber}`
            : ''}
        </div>
        {nodes.length > 0 && visibleNodeCount === 0 && !isMicroView && (
          <div className="cg-filter-empty-state" role="status">
            {t('common.noVisibleNodes')}
          </div>
        )}
      </div>
      {viewMode === 'sequence' && selectedFunction && !isCollapsed && (
        <GraphErrorBoundary><SequenceDiagramRenderer nodes={nodes} edges={edges} theme={theme}
          onNodeTap={(id) => handleNodeTap(NodeId(id))} /></GraphErrorBoundary>
      )}

      <div className="cg-panel-stack cg-panel-stack-right">
        {panel.showMiniMap && !isCollapsed && (
          <GraphErrorBoundary><StatsPanel
            counts={{
              function: nodeTypeCounts.function, class: nodeTypeCounts.class,
              variable: nodeTypeCounts.variable, module: nodeTypeCounts.module,
              interface: nodeTypeCounts.interface,
            }}
            onClose={() => panel.setShowMiniMap(false)} thumbnail={thumbnail} viewportInfo={viewportInfo}
            onFocusArea={(ratioX, ratioY) => {
              const info = renderer.rendererRef.current?.getViewportInfo();
              if (info) {
                renderer.rendererRef.current?.focusOnArea(info.totalSize.w * ratioX, info.totalSize.h * ratioY, info.zoom);
              }
            }} /></GraphErrorBoundary>
        )}

        {panel.showHotspot && !isCollapsed && hotspotNodes.length > 0 && (
          <GraphErrorBoundary><HotspotPanel hotspotNodes={hotspotNodes} onClose={() => panel.setShowHotspot(false)} label={t('toolbar.hotspot')} /></GraphErrorBoundary>
        )}

        {panel.showGodModule && !isCollapsed && godModules.length > 0 && (
          <GraphErrorBoundary><GodModulePanel godModules={godModules} onClose={() => panel.setShowGodModule(false)}
            label={t('toolbar.godModule')} statsLabel={(n, e) => t('godmodule.stats', { nodes: n, edges: e })} /></GraphErrorBoundary>
        )}

        {panel.showCoreFunction && !isCollapsed && coreFunctions.length > 0 && (
          <GraphErrorBoundary><CoreFunctionPanel coreFunctions={coreFunctions} onClose={() => panel.setShowCoreFunction(false)}
            label={t('toolbar.coreFunction')} onSelectFunction={(nodeId) => {
              setSelectedNode(NodeId(nodeId));
              renderer.rendererRef.current?.focusOnNode(nodeId);
              renderer.rendererRef.current?.selectNode(NodeId(nodeId));
            }} /></GraphErrorBoundary>
        )}

        {panel.showFilterPanel && !isCollapsed && (
          <GraphErrorBoundary><FilterPanel onClose={() => panel.setShowFilterPanel(false)} /></GraphErrorBoundary>
        )}

        {panel.showTour && !isCollapsed && (
          <GraphErrorBoundary><TourPanel tour={tourData} onClose={() => panel.setShowTour(false)} /></GraphErrorBoundary>
        )}

        {panel.showImpact && !isCollapsed && impactStats && (
          <GraphErrorBoundary><ImpactPanel impactStats={impactStats} label={t('toolbar.impact')} totalLabel={t('impact.total')} onClose={() => panel.setShowImpact(false)} /></GraphErrorBoundary>
        )}

        {panel.showCycles && !isCollapsed && cycleDetails.length > 0 && (
          <GraphErrorBoundary><CyclePanel cycles={cycleDetails} label={t('toolbar.cycles')} emptyLabel={t('cycles.empty')} onClose={() => panel.setShowCycles(false)} /></GraphErrorBoundary>
        )}
      </div>

      {panel.showLegend && !isCollapsed && (
        <GraphErrorBoundary><Legend viewMode={viewMode} onClose={() => panel.setShowLegend(false)} /></GraphErrorBoundary>
      )}


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
          onHighlightCallChain={(id) => { panel.setShowCallChain(true); renderer.rendererRef.current?.highlightCallChain(NodeId(id)); }}
          onHighlightImpact={(id) => { panel.setShowImpact(true); renderer.rendererRef.current?.highlightImpact(NodeId(id)); }}
          onOpenSource={(id) => {
            const data = getDataRef.current?.getNodeData(id);
            if (data) {
              window.dispatchEvent(new CustomEvent(DOM_EVENTS.OPEN_SOURCE, { detail: { filePath: data.filePath, lineNumber: data.lineNumber } }));
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
