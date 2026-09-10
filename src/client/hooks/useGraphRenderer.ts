import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CytoscapeRenderer } from '../renderer/CytoscapeRenderer.ts';
import type { IRenderer, LayoutType, ThemeType } from '../renderer/IRenderer.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import type { ClusterNode, ClusterEdge } from '../store/cluster/index.ts';
import { scoped } from '../../shared/Logger.ts';

type FilterType = GraphNode['type'] | 'all';

const log = scoped('renderer-hook');

export interface GraphRendererCallbacks {
  onNodeTap(nodeId: NodeId): void;
  onNodeDoubleTap(nodeId: string): void;
  onNodeHover(nodeId: string, pos: { x: number; y: number }): void;
  onNodeHoverOut(): void;
  onEdgeHover(edgeId: string, pos: { x: number; y: number }): void;
  onEdgeHoverOut(): void;
}

export interface UseGraphRendererResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rendererRef: React.RefObject<IRenderer | null>;
  searchMatchCount: number | null;
  setSearchMatchCount: (n: number | null) => void;
  exportGraph: (format: 'png' | 'svg' | 'json') => void;
  updateTheme: (theme: ThemeType) => void;
}

export function useGraphRenderer(
  nodes: (GraphNode | ClusterNode)[],
  edges: (GraphEdge | ClusterEdge)[],
  rawNodes: GraphNode[],
  layout: LayoutType,
  theme: ThemeType,
  highlightedNodeIds: NodeId[],
  selectedNodeId: NodeId | null,
  filterType: FilterType,
  graphType: 'all' | 'call' | 'dependency',
  clusterLevel: 'directory' | 'file' | 'function' | 'smart',
  debouncedSearch: string,
  showCallChain: boolean,
  showCycles: boolean,
  showImpact: boolean,
  showInheritance: boolean,
  focusNodeId: string | null,
  callbacks: GraphRendererCallbacks,
  showCallChainRef: React.RefObject<boolean>,
): UseGraphRendererResult {
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

    const initWhenReady = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
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
          onNodeHoverOut: () => callbacksRef.current.onNodeHoverOut(),
          onEdgeHover: (edgeId: string, pos: { x: number; y: number }) => callbacksRef.current.onEdgeHover(edgeId, pos),
          onEdgeHoverOut: () => callbacksRef.current.onEdgeHoverOut(),
        });
        renderer.init();
        rendererRef.current = renderer;
        log.info('renderer initialized', { theme, w, h });

        ro = new ResizeObserver(() => {
          rendererRef.current?.resize();
        });
        ro.observe(container);
      } else {
        initTimer = setTimeout(initWhenReady, 50);
      }
    };

    initWhenReady();

    return () => {
      if (initTimer !== null) clearTimeout(initTimer);
      ro?.disconnect();
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [callbacksRef, showCallChainRef]);

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
    const isIncremental = !isNewDataSet && currentCount > prevCount && currentCount - prevCount < 50;
    const shouldUseWorker = currentCount > 500 && r.isWorkerLayoutAvailable() && !isWorkerInProgressRef.current;

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
    }, isIncremental ? 50 : 150);
    return () => clearTimeout(timer);
  }, [layout, clusterLevel, nodes.length, edges.length]);

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
    setSearchMatchCount(debouncedSearch ? r.search(debouncedSearch) : null);
  }, [debouncedSearch, nodes]);

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
    const r = rendererRef.current;
    if (!r) return;
    if (r.shouldEnableVirtualScroll(nodes.length) && !r.isVirtualScrollEnabled()) {
      r.enableVirtualScroll();
    } else if (!r.shouldEnableVirtualScroll(nodes.length) && r.isVirtualScrollEnabled()) {
      r.disableVirtualScroll();
    }
  }, [nodes.length]);

  const exportGraph = useCallback((format: 'png' | 'svg' | 'json') => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let data: string | null = null;
    let mimeType = 'application/json';
    let extension = 'json';
    if (format === 'png') { data = renderer.exportPNG(); mimeType = 'image/png'; extension = 'png'; }
    else if (format === 'svg') { data = renderer.exportSVG(); mimeType = 'image/svg+xml'; extension = 'svg'; }
    else { data = renderer.exportJSON(); }
    if (data) {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `codegraph-${Date.now()}.${extension}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log.info(`exported ${format}`);
    }
  }, []);

  const updateTheme = useCallback((newTheme: ThemeType) => {
    rendererRef.current?.updateTheme(newTheme);
  }, []);

  return useMemo(() => ({
    containerRef, rendererRef, searchMatchCount, setSearchMatchCount, exportGraph, updateTheme
  }), [searchMatchCount, exportGraph, updateTheme]);
}
