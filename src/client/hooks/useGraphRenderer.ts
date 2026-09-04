import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CytoscapeRenderer } from '../renderer/CytoscapeRenderer.ts';
import type { IRenderer, LayoutType, ThemeType } from '../renderer/IRenderer.ts';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import { scoped } from '../../shared/Logger.ts';

type FilterType = GraphNode['type'] | 'all';

const log = scoped('renderer-hook');

export interface GraphRendererCallbacks {
  onNodeTap(nodeId: NodeId): void;
  onNodeDoubleTap(nodeId: string): void;
  onNodeHover(nodeId: string, pos: { x: number; y: number }): void;
  onNodeHoverOut(): void;
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
  nodes: (GraphNode | import('../store/graphStore.ts').ClusterNode)[],
  edges: (GraphEdge | import('../store/graphStore.ts').ClusterEdge)[],
  layout: LayoutType,
  theme: ThemeType,
  highlightedNodeIds: NodeId[],
  selectedNodeId: NodeId | null,
  filterType: FilterType,
  graphType: 'all' | 'call' | 'dependency',
  clusterLevel: 'directory' | 'file' | 'function',
  debouncedSearch: string,
  showCallChain: boolean,
  showCycles: boolean,
  showImpact: boolean,
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
    if (!containerRef.current) return;
    const renderer = new CytoscapeRenderer({
      container: containerRef.current,
      theme,
      onNodeTap: (nodeId: string) => {
        const id = nodeId as NodeId;
        callbacksRef.current.onNodeTap(id);
        if (showCallChainRef.current) { rendererRef.current?.highlightCallChain(id); }
      },
      onNodeDoubleTap: (nodeId: string) => callbacksRef.current.onNodeDoubleTap(nodeId),
      onNodeHover: (nodeId: string, pos: { x: number; y: number }) => callbacksRef.current.onNodeHover(nodeId, pos),
      onNodeHoverOut: () => callbacksRef.current.onNodeHoverOut(),
    });
    renderer.init();
    rendererRef.current = renderer;
    log.info('renderer initialized', { theme });
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, [callbacksRef, showCallChainRef]);

  useEffect(() => {
    rendererRef.current?.updateData(nodes, edges);
  }, [nodes, edges]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const timer = setTimeout(() => r.applyLayout(layout), 150);
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
