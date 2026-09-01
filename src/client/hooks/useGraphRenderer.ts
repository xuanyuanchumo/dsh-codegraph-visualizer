import { useEffect, useRef, useState, useCallback } from 'react';
import { CytoscapeRenderer } from '../renderer/CytoscapeRenderer.ts';
import type { IRenderer, LayoutType, ThemeType } from '../renderer/IRenderer.ts';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';
import { scoped } from '../../shared/Logger.ts';

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
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: string,
  theme: ThemeType,
  highlightedNodeIds: NodeId[],
  selectedNodeId: NodeId | null,
  filterType: string,
  graphType: 'all' | 'call' | 'dependency',
  debouncedSearch: string,
  showCallChain: boolean,
  showCycles: boolean,
  callbacks: GraphRendererCallbacks,
  showCallChainRef: React.RefObject<boolean>,
): UseGraphRendererResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IRenderer | null>(null);
  const [searchMatchCount, setSearchMatchCount] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new CytoscapeRenderer({
      container: containerRef.current,
      theme,
      onNodeTap: (nodeId: string) => {
        const id = nodeId as NodeId;
        callbacks.onNodeTap(id);
        if (showCallChainRef.current) { rendererRef.current?.highlightCallChain(id); }
      },
      onNodeDoubleTap: (nodeId: string) => callbacks.onNodeDoubleTap(nodeId),
      onNodeHover: (nodeId: string, pos: { x: number; y: number }) => callbacks.onNodeHover(nodeId, pos),
      onNodeHoverOut: () => callbacks.onNodeHoverOut(),
    });
    renderer.init();
    rendererRef.current = renderer;
    log.info('renderer initialized', { theme });
    return () => { renderer.destroy(); rendererRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.updateData(nodes, edges);
  }, [nodes, edges]);

  useEffect(() => {
    rendererRef.current?.applyLayout(layout as LayoutType);
  }, [layout]);

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

  return { containerRef, rendererRef, searchMatchCount, setSearchMatchCount, exportGraph, updateTheme };
}