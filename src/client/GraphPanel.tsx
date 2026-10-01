import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGraphStore } from './store/graphStore.ts';
import type { ThemeType, GraphType } from './store/graphStore.ts';

import type { GraphNode, GraphEdge, ViewMode } from '../types/index.ts';
import type { ClusterNode } from './store/cluster/index.ts';
import { NodeId } from '../types/index.ts';
import { useDebounce, usePolling, useGraphRenderer, usePanelResize, usePanelState, usePanelKeyboard, useViewMode, useAnalysisPanels, useNodeSearch,
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus, useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions, usePanelDimensions,
} from './hooks/index.ts';
import { updateUrlExpand } from './utils/urlState.ts';
import { getViewLayer, getAvailablePanels } from '../shared/viewModeUtils.ts';
import type { AnalysisPanelKey } from '../shared/viewModeUtils.ts';
import { useThemeSync } from './hooks/useThemeSync.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useGraphCache } from './hooks/useGraphCache.ts';
import { invalidateCssVarCache } from './renderer/styles/ThemeStylesheet.ts';
import { GraphErrorBoundary } from './components/ErrorBoundary.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import type { SearchResultItem } from './components/SearchBar.tsx';
import { GraphTooltip, type TooltipData, type EdgeTooltipData } from './components/GraphTooltip.tsx';
import { ContextMenu } from './components/ContextMenu.tsx';
import { LoadingOverlay } from './components/LoadingOverlay.tsx';
import { ErrorOverlay } from './components/ErrorOverlay.tsx';
import { KeyboardHelp } from './components/KeyboardHelp.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FocusModeBar } from './components/FocusModeBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { buildTour } from '../shared/analysis/TourBuilder.ts';
import { MicroViewPrompt, MicroFunctionBar } from './components/MicroViewBar.tsx';
import { GraphIcon } from './components/Icons.tsx';
import { OverlayBar } from './components/OverlayBar.tsx';
import { LeftPanelStack } from './components/LeftPanelStack.tsx';
import { RightPanelStack } from './components/RightPanelStack.tsx';

import { SequenceDiagramRenderer } from './renderer/SequenceDiagramRenderer.tsx';
import { scoped } from '../shared/Logger.ts';
import { DOM_EVENTS } from '../shared/domEvents.ts';
import { LOD, UI, PREFETCH, FUNCTION_BODY } from '../shared/constants.ts';

import { useT } from './i18n/index.ts';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/overlays.css';
import './styles/graph.css';
import './styles/node-detail.css';
import './styles/import-workspace.css';
import './styles/path-finder.css';
import './styles/health-score-card.css';
import './styles/rule-config-panel.css';
import './styles/hotspot-godmodule-panel.css';
import './styles/impact-panel.css';
import './styles/cycle-panel.css';
import './styles/tour-panel.css';
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
  const { layout, dagreRankDir, theme, filterType, graphType, clusterDepth, viewMode, currentLayer, diagramData, hierarchyLevel } = useGraphDisplay();
  const { searchQuery, selectedNodeId, highlightedNodeIds, expandedNodeIds, pathResult, focusDepth, focusModeActive, focusModeNodeId, pathFilterInclude, pathFilterExclude } = useGraphInteraction();
  const { isLoading, error, lastUpdated, truncated, totalNodeCount, prerequisites, watchEnabled, initStatus, urlRestored, panelVisible } = useGraphStatus();
  const { currentWorkspace, workspaceList } = useGraphWorkspace();
  const { ruleViolations, selectedFunction, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, heatmapMode, todoMarkerMode } = useGraphAnalysis();
  const { performanceDegradations, lodLevel, lodEnabled } = useGraphPerformance();
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

  useEffect(() => {
    if (!urlRestored) return;
    updateUrlExpand(expandedNodeIds);
  }, [expandedNodeIds, urlRestored]);

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
    while (ancestor && depth < UI.ANCESTOR_SEARCH_MAX_DEPTH) {
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

  useEffect(() => {
    const r = renderer.rendererRef.current;
    if (!r) return;
    if (panelVisible) {
      r.resumeAnimations();
    } else {
      r.pauseAnimations();
    }
  }, [panelVisible, renderer.rendererRef]);

  usePanelKeyboard(layout, setLayout, renderer.rendererRef, {
    onToggleSearch: panel.toggleSearch,
    onCloseAll: () => {
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
    let lastUpdate = 0;
    const intervalId = setInterval(() => {
      const now = Date.now();
      if (now - lastUpdate < UI.MINIMAP_THROTTLE_MS) return;
      lastUpdate = now;
      updateMiniMap();
    }, UI.MINIMAP_UPDATE_INTERVAL_MS);
    return () => clearInterval(intervalId);
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
    const available = getAvailablePanels(getViewLayer(viewMode));
    const panelEntries: Array<[AnalysisPanelKey, boolean, () => void]> = [
      ['showCallChain', panel.showCallChain, () => panel.setShowCallChain(false)],
      ['showCycles', panel.showCycles, () => panel.setShowCycles(false)],
      ['showImpact', panel.showImpact, () => panel.setShowImpact(false)],
      ['showInheritance', panel.showInheritance, () => panel.setShowInheritance(false)],
      ['showHotspot', panel.showHotspot, () => panel.setShowHotspot(false)],
      ['showGodModule', panel.showGodModule, () => panel.setShowGodModule(false)],
      ['showCoreFunction', panel.showCoreFunction, () => panel.setShowCoreFunction(false)],
      ['showDeadCode', panel.showDeadCode, () => panel.setShowDeadCode(false)],
      ['showHealthScore', panel.showHealthScore, () => panel.setShowHealthScore(false)],
      ['showRules', panel.showRules, () => panel.setShowRules(false)],
      ['showImport', panel.showImport, () => panel.setShowImport(false)],
      ['showFilterPanel', panel.showFilterPanel, () => panel.setShowFilterPanel(false)],
      ['showSearch', panel.showSearch, () => panel.setShowSearch(false)],
      ['showPathFind', panel.showPathFind, () => panel.setShowPathFind(false)],
    ];
    for (const [key, isShowing, close] of panelEntries) {
      if (!available.has(key) && isShowing) close();
    }
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

  const { handleRulesCheck, hotspotNodes, godModules, impactStats, coreFunctions, deadCodeResult } = useAnalysisPanels(
    rawNodes, rawEdges,
    panel.showHealthScore, panel.showRules, panel.showHotspot, panel.showGodModule,
    panel.showImpact, selectedNodeId, getImpactStats, panel.showCoreFunction, panel.showDeadCode,
  );

  useEffect(() => {
    const r = renderer.rendererRef.current;
    if (!r) return;
    if (panel.showDeadCode && deadCodeResult) {
      r.markDeadCode(new Set(deadCodeResult.unreachableNodes));
    } else {
      r.clearDeadCodeMarks();
    }
  }, [panel.showDeadCode, deadCodeResult, renderer.rendererRef]);

  const hasAutoScannedRef = useRef(false);
  useEffect(() => {
    if (hasAutoScannedRef.current) return;
    if (panel.collapsed) return;
    if (nodes.length > 0 || rawNodes.length > 0) return;
    if (!prerequisites.codegraph) return;
    if (!currentWorkspace) return;
    hasAutoScannedRef.current = true;
    log.info('auto-fill: triggering bootstrap on first open', { path: currentWorkspace });
    useGraphStore.getState().loadBootstrap().then((ok) => {
      if (!ok) {
        log.info('auto-fill: bootstrap failed, falling back to scan', { path: currentWorkspace });
        handleScanWorkspace();
      }
    });
  }, [panel.collapsed, nodes.length, rawNodes.length, prerequisites.codegraph, currentWorkspace, handleScanWorkspace]);

  const statsText = useMemo(() => {
    const totalNodes = diagramData?.allNodes.length ?? nodes.length;
    const totalEdges = diagramData?.allEdges.length ?? edges.length;
    return t('stats.nodesEdges', { nodes: totalNodes, edges: totalEdges });
  }, [nodes.length, edges.length, diagramData, t]);

  const expandedFunctionBodyCount = useMemo(() => {
    const functionIdSet = new Set(rawNodes.filter(n => n.type === 'function').map(n => n.id as string));
    return [...expandedNodeIds].filter(id => functionIdSet.has(id)).length;
  }, [expandedNodeIds, rawNodes]);

  const showFunctionBodyBudget = expandedFunctionBodyCount > 0;

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
  }, [panel.showCycles, nodes.length, edges.length, renderer.rendererRef]);

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

      {nodes.length === 0 && !isLoading && !error && !isCollapsed && !isMicroView && (
        <EmptyState prerequisites={prerequisites} onImport={() => panel.setShowImport(true)} onScanWorkspace={handleScanWorkspace} />
      )}



      <div className="cg-graph-container" ref={renderer.containerRef}
        role="application"
        aria-label={t('a11y.graphContainerStats', { viewMode: t(`viewMode.${viewMode}`), nodeCount: nodes.length, edgeCount: edges.length })}
        aria-describedby="cg-graph-live-region"
        style={{ display: viewMode === 'sequence' && selectedFunction ? 'none' : undefined }}>
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
        labels={{
          hotspot: t('toolbar.hotspot'),
          godModule: t('toolbar.godModule'),
          coreFunction: t('toolbar.coreFunction'),
          deadCode: t('toolbar.deadCode'),
          impact: t('toolbar.impact'),
          impactTotal: t('impact.total'),
          cycles: t('toolbar.cycles'),
          cyclesEmpty: t('cycles.empty'),
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
