import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CytoscapeRenderer } from '../renderer/CytoscapeRenderer.ts';
import type { IRenderer, LayoutType, ThemeType, RankDir } from '../renderer/IRenderer.ts';
import type { GraphNode, GraphEdge, HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/cluster/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { RENDERER, UI } from '../../shared/constants.ts';
import { useGraphStore } from '../store/graphStore.ts';

type FilterType = GraphNode['type'] | 'all';

const log = scoped('renderer-hook');

export interface GraphRendererCallbacks {
  onNodeTap(nodeId: NodeId): void;
  onNodeDoubleTap(nodeId: string): void;
  onNodeHover(nodeId: string, pos: { x: number; y: number }): void;
  onNodeHoverPrefetch?(nodeId: string): void;
  onNodeHoverOut(): void;
  onEdgeTap(edgeId: string, pos: { x: number; y: number }): void;
  onEdgeHover(edgeId: string, pos: { x: number; y: number }): void;
  onEdgeHoverOut(): void;
  onNodeContextTap?(nodeId: string, pos: { x: number; y: number }): void;
}

export interface GraphRendererData {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
  rawNodes: GraphNode[];
}

export interface GraphRendererDisplay {
  layout: LayoutType;
  dagreRankDir: RankDir;
  theme: ThemeType;
  clusterDepth: number;
  heatmapMode: HeatmapMode;
  todoMarkerMode: TodoMarkerMode;
}

export interface GraphRendererInteraction {
  highlightedNodeIds: NodeId[];
  selectedNodeId: NodeId | null;
  focusNodeId: string | null;
  focusModeActive: boolean;
  focusModeNodeId: NodeId | null;
  focusDepth: number;
  debouncedSearch: string;
}

export interface GraphRendererFilters {
  filterType: FilterType;
  graphType: 'all' | 'call' | 'dependency';
  fanInThreshold: number;
  fanOutThreshold: number;
  visibleNodeTypes: Set<GraphNode['type']>;
  visibleEdgeTypes: Set<GraphEdge['type']>;
  pathFilterInclude: string | null;
  pathFilterExclude: string | null;
}

export interface GraphRendererAnalysis {
  showCallChain: boolean;
  showCycles: boolean;
  cycleIsolation: boolean;
  showImpact: boolean;
  showInheritance: boolean;
}

export interface GraphRendererConfig {
  data: GraphRendererData;
  display: GraphRendererDisplay;
  interaction: GraphRendererInteraction;
  filters: GraphRendererFilters;
  analysis: GraphRendererAnalysis;
  callbacks: GraphRendererCallbacks;
  showCallChainRef: React.RefObject<boolean>;
}

export interface UseGraphRendererResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rendererRef: React.RefObject<IRenderer | null>;
  searchMatchCount: number | null;
  setSearchMatchCount: (n: number | null) => void;
  exportGraph: (format: 'png' | 'svg' | 'json' | 'mermaid' | 'mermaid-seq' | 'mermaid-class' | 'graphml' | 'jsonld') => void;
  updateTheme: (theme: ThemeType) => void;
}

export function useGraphRenderer(config: GraphRendererConfig): UseGraphRendererResult {
  const { data, display, interaction, filters, analysis, callbacks, showCallChainRef } = config;
  const { nodes, edges, rawNodes } = data;
  const { layout, dagreRankDir, theme, clusterDepth, heatmapMode, todoMarkerMode } = display;
  const { highlightedNodeIds, selectedNodeId, focusNodeId, focusModeActive, focusModeNodeId, focusDepth, debouncedSearch } = interaction;
  const { filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, pathFilterInclude, pathFilterExclude } = filters;
  const { showCallChain, showCycles, cycleIsolation, showImpact, showInheritance } = analysis;

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IRenderer | null>(null);
  const [searchMatchCount, setSearchMatchCount] = useState<number | null>(null);
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: CytoscapeRenderer | null = null;
    let ro: ResizeObserver | null = null;
    let initTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupExtra: (() => void) | null = null;

    const initWhenReady = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        try {
          renderer = new CytoscapeRenderer({
            container,
            theme,
            onNodeTap: (nodeId: string) => {
              const id = NodeId(nodeId);
              callbacksRef.current.onNodeTap(id);
              if (showCallChainRef.current) { rendererRef.current?.highlightCallChain(id); }
            },
            onNodeDoubleTap: (nodeId: string) => callbacksRef.current.onNodeDoubleTap(nodeId),
            onNodeHover: (nodeId: string, pos: { x: number; y: number }) => callbacksRef.current.onNodeHover(nodeId, pos),
            onNodeHoverPrefetch: (nodeId: string) => callbacksRef.current.onNodeHoverPrefetch?.(nodeId),
            onNodeHoverOut: () => callbacksRef.current.onNodeHoverOut(),
            onEdgeTap: (edgeId: string, pos: { x: number; y: number }) => callbacksRef.current.onEdgeTap(edgeId, pos),
            onEdgeHover: (edgeId: string, pos: { x: number; y: number }) => callbacksRef.current.onEdgeHover(edgeId, pos),
            onEdgeHoverOut: () => callbacksRef.current.onEdgeHoverOut(),
          });
          renderer.init();
          rendererRef.current = renderer;
          log.info('renderer initialized', { theme, w, h });
        } catch (err) {
          log.error('renderer init failed', { err });
          renderer?.destroy();
          renderer = null;
          useGraphStore.getState().setError(err instanceof Error ? err.message : String(err));
          return;
        }

        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => {
            rendererRef.current?.resize();
          });
          ro.observe(container);
        } else {
          const onResize = () => rendererRef.current?.resize();
          window.addEventListener('resize', onResize);
          cleanupExtra = () => window.removeEventListener('resize', onResize);
        }
      } else {
        initTimer = setTimeout(initWhenReady, UI.INIT_RETRY_DELAY_MS);
      }
    };

    initWhenReady();

    return () => {
      if (initTimer !== null) clearTimeout(initTimer);
      ro?.disconnect();
      cleanupExtra?.();
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [callbacksRef, showCallChainRef]);

  useEffect(() => {
    rendererRef.current?.updateTheme(theme);
  }, [theme]);

  useEffect(() => {
    rendererRef.current?.updateData(nodes, edges);
  }, [nodes, edges]);

  useEffect(() => {
    rendererRef.current?.setRawNodes(rawNodes);
  }, [rawNodes]);

  const prevNodeCountRef = useRef(0);
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const isWorkerInProgressRef = useRef(false);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const currentCount = nodes.length;
    const prevCount = prevNodeCountRef.current;
    const isNewDataSet = prevCount === 0 && currentCount > 0;
    const isIncremental = !isNewDataSet && currentCount > prevCount && currentCount - prevCount < RENDERER.INCREMENTAL_LAYOUT_THRESHOLD;
    const shouldUseWorker = currentCount > RENDERER.WORKER_NODE_THRESHOLD && r.isWorkerLayoutAvailable() && !isWorkerInProgressRef.current;

    const timer = setTimeout(async () => {
      if (shouldUseWorker && !isNewDataSet) {
        isWorkerInProgressRef.current = true;
        try {
          const positions = await r.applyLayoutWithWorker(
            nodes as GraphNode[],
            edges as GraphEdge[],
            layout,
          );
          if (Object.keys(positions).length > 0) {
            r.applyWorkerLayout(positions);
          } else {
            r.applyLayout(layout);
          }
        } finally {
          isWorkerInProgressRef.current = false;
        }
      } else if (isIncremental) {
        const currentNodeIds = new Set(nodes.map((n) => n.id));
        const newNodeIds = new Set<string>();
        for (const id of currentNodeIds) {
          if (!prevNodeIdsRef.current.has(id)) newNodeIds.add(id);
        }
        r.applyIncrementalLayout(layout, newNodeIds);
      } else {
        r.applyLayout(layout);
      }
      prevNodeCountRef.current = currentCount;
      prevNodeIdsRef.current = new Set(nodes.map((n) => n.id));
    }, isIncremental ? RENDERER.INCREMENTAL_LAYOUT_DELAY_MS : RENDERER.FULL_LAYOUT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [layout, clusterDepth, nodes, edges]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setDagreRankDir(dagreRankDir);
    if (layout === 'dagre') r.applyLayout('dagre');
  }, [dagreRankDir, layout]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.highlightNodes(highlightedNodeIds);
    r.selectNode(selectedNodeId);
  }, [highlightedNodeIds, selectedNodeId]);

  useEffect(() => {
    rendererRef.current?.filterByType(filterType);
  }, [filterType]);

  useEffect(() => {
    rendererRef.current?.filterByGraphType(graphType);
  }, [graphType]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.applyConnectionFilters(fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes);
  }, [fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, nodes.length, edges.length]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    setSearchMatchCount(debouncedSearch ? r.search(debouncedSearch) : null);
  }, [debouncedSearch, nodes.length]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (showCallChain && selectedNodeId) { r.highlightCallChain(selectedNodeId); }
    else { r.highlightCallChain(null); }
  }, [showCallChain, selectedNodeId]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (showCycles) { const cycles = r.detectCycles(); r.highlightCycles(cycles); }
    else { r.highlightCycles(new Set<string>()); }
  }, [showCycles]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (cycleIsolation && showCycles) {
      const cycles = r.detectCycles();
      r.isolateCycles(cycles);
      r.relayoutCycles(cycles);
    } else {
      r.restoreIsolation();
    }
  }, [cycleIsolation, showCycles]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (showImpact && selectedNodeId) { r.highlightImpact(selectedNodeId); }
    else { r.highlightImpact(null); }
  }, [showImpact, selectedNodeId]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (showInheritance) { r.highlightInheritance(selectedNodeId); }
    else { r.highlightInheritance(null); }
  }, [showInheritance, selectedNodeId]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (focusNodeId) { r.focusNeighborhood(NodeId(focusNodeId)); }
    else { r.focusNeighborhood(null); }
  }, [focusNodeId]);

  useEffect(() => {
    rendererRef.current?.setHeatmapMode(heatmapMode);
  }, [heatmapMode]);

  useEffect(() => {
    rendererRef.current?.setTodoMarkerMode(todoMarkerMode);
  }, [todoMarkerMode]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (focusModeActive && focusModeNodeId) {
      r.setFocusMode(focusModeNodeId, focusDepth);
    } else {
      r.clearFocusMode();
    }
  }, [focusModeActive, focusModeNodeId, focusDepth]);

  useEffect(() => {
    rendererRef.current?.filterByPath(pathFilterInclude, pathFilterExclude);
  }, [pathFilterInclude, pathFilterExclude, nodes.length]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (r.shouldEnableVirtualScroll(nodes.length) && !r.isVirtualScrollEnabled()) {
      r.enableVirtualScroll();
    } else if (!r.shouldEnableVirtualScroll(nodes.length) && r.isVirtualScrollEnabled()) {
      r.disableVirtualScroll();
    }
  }, [nodes.length]);

  const exportGraph = useCallback((format: 'png' | 'svg' | 'json' | 'mermaid' | 'mermaid-seq' | 'mermaid-class' | 'graphml' | 'jsonld') => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let data: string | null = null;
    let mimeType = 'application/json';
    let extension = 'json';
    if (format === 'png') { data = renderer.exportPNG(); mimeType = 'image/png'; extension = 'png'; }
    else if (format === 'svg') { data = renderer.exportSVG(theme); mimeType = 'image/svg+xml'; extension = 'svg'; }
    else if (format === 'mermaid') { data = renderer.exportMermaid(); mimeType = 'text/plain'; extension = 'mmd'; }
    else if (format === 'mermaid-seq') { data = renderer.exportMermaidSequence(); mimeType = 'text/plain'; extension = 'mmd'; }
    else if (format === 'mermaid-class') { data = renderer.exportMermaidClass(); mimeType = 'text/plain'; extension = 'mmd'; }
    else if (format === 'graphml') { data = renderer.exportGraphML(); mimeType = 'application/xml'; extension = 'graphml'; }
    else if (format === 'jsonld') { data = renderer.exportJSONLD(); mimeType = 'application/ld+json'; extension = 'jsonld'; }
    else { data = renderer.exportJSON(); }
    if (data) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `codegraph-${Date.now()}.${extension}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), UI.URL_REVOKE_DELAY_MS);
      log.info(`exported ${format}`);
    }
  }, [theme]);

  const updateTheme = useCallback((newTheme: ThemeType) => {
    rendererRef.current?.updateTheme(newTheme);
  }, []);

  return useMemo(() => ({
    containerRef, rendererRef, searchMatchCount, setSearchMatchCount, exportGraph, updateTheme
  }), [searchMatchCount, exportGraph, updateTheme]);
}
