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
  /** Shift+Click 多选切换（cycle-149）：渲染器维护集合，经此回传完整集合给消费面。 */
  onSelectionToggle?(nodeId: string, selected: boolean, selectedIds: readonly string[]): void;
  /** 多选集合被渲染器静默清空（普通点击 / Esc）时的对侧同步（cycle-149）。 */
  onSelectionClear?(): void;
}

export interface GraphRendererData {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
  rawNodes: GraphNode[];
  /**
   * cycle-140：当前图所属的 repoId（工作区身份）。布局判据用它识别「换工作区」
   * ——节点 id 在不同工作区间可能重叠（同名文件），只有 repoId 能区分「同 id 不同图」。
   */
  repoId: string | null;
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
  const { nodes, edges, rawNodes, repoId } = data;
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
            // Forwarded through callbacksRef like every other interaction callback: the renderer
            // snapshots its options once at construction, so this wrapper keeps right-click
            // working after a re-render. Dropping this line silently disables the node context
            // menu (InteractionController keeps the cxttap binding but has no handler to call).
            onNodeContextTap: (nodeId: string, pos: { x: number; y: number }) =>
              callbacksRef.current.onNodeContextTap?.(nodeId, pos),
            onNodeHover: (nodeId: string, pos: { x: number; y: number }) => callbacksRef.current.onNodeHover(nodeId, pos),
            onNodeHoverPrefetch: (nodeId: string) => callbacksRef.current.onNodeHoverPrefetch?.(nodeId),
            onNodeHoverOut: () => callbacksRef.current.onNodeHoverOut(),
            onEdgeTap: (edgeId: string, pos: { x: number; y: number }) => callbacksRef.current.onEdgeTap(edgeId, pos),
            onEdgeHover: (edgeId: string, pos: { x: number; y: number }) => callbacksRef.current.onEdgeHover(edgeId, pos),
            onEdgeHoverOut: () => callbacksRef.current.onEdgeHoverOut(),
            // cycle-149：多选回调转发。缺这两行 = InteractionController 的多选集合
            // 永远到不了消费面（注册✓/生产✓/消费✗）——multiSelectWiringContract 守卫钉死。
            onSelectionToggle: (nodeId: string, selected: boolean, selectedIds: readonly string[]) =>
              callbacksRef.current.onSelectionToggle?.(nodeId, selected, selectedIds),
            onSelectionClear: () => callbacksRef.current.onSelectionClear?.(),
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
  const lastAppliedLayoutRef = useRef<LayoutType | null>(null);
  const prevRepoIdRef = useRef<string | null>(null);
  const isWorkerInProgressRef = useRef(false);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const currentCount = nodes.length;
    const prevCount = prevNodeCountRef.current;
    const prevIds = prevNodeIdsRef.current;
    const currentIds = new Set(nodes.map((n) => n.id));
    // cycle-140 布局稳定性：判据从「数量变化」改为「节点集合语义」。
    // 用户期望「位置相对固定，只有展开才移动」。旧判据下折叠（子集）、
    // 同集合刷新、LOD 过渡都走全量重排（cose/fcose randomize:true）⇒ 全图跳变。
    // 新判据：
    // - 布局类型变化 / 换工作区 / 新数据集 / 完全不相交 ⇒ 全量重排（显式意图或全新图）；
    // - 子集（折叠/同集合刷新）⇒ 不重排（updateData 只做增删，位置保持）；
    // - 有新增且新增量 ≤ 阈值 ⇒ 增量布局（只有新节点获得位置）；
    // - 有新增但新增量超阈值 / 混变 ⇒ 全量重排（结构性大变，一次性重排更合理）。
    const layoutChanged = lastAppliedLayoutRef.current !== layout;
    const repoChanged = prevRepoIdRef.current !== null && prevRepoIdRef.current !== repoId;

    let action: 'full' | 'incremental' | 'none';
    if (layoutChanged || repoChanged) {
      action = 'full';
    } else if (prevCount === 0 && currentCount > 0) {
      action = 'full';
    } else if (currentCount === 0) {
      action = 'none';
    } else {
      const overlapCount = [...currentIds].filter((id) => prevIds.has(id)).length;
      if (overlapCount === 0) {
        action = 'full';
      } else if (overlapCount === currentIds.size) {
        action = 'none';
      } else {
        const newCount = currentIds.size - overlapCount;
        action = newCount <= RENDERER.INCREMENTAL_LAYOUT_THRESHOLD ? 'incremental' : 'full';
      }
    }

    if (action === 'none') {
      // 折叠/同集合刷新：不重排。当前集即「已布局集」（位置未变），同步落基线。
      prevNodeCountRef.current = currentCount;
      prevNodeIdsRef.current = currentIds;
      prevRepoIdRef.current = repoId;
      return;
    }

    const isNewDataSet = prevCount === 0 && currentCount > 0;
    const shouldUseWorker = action === 'full' && !isNewDataSet && currentCount > RENDERER.WORKER_NODE_THRESHOLD && r.isWorkerLayoutAvailable() && !isWorkerInProgressRef.current;

    const timer = setTimeout(async () => {
      if (shouldUseWorker) {
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
      } else if (action === 'full') {
        r.applyLayout(layout);
      } else {
        const newNodeIds = new Set<string>();
        for (const id of currentIds) {
          if (!prevIds.has(id)) newNodeIds.add(id);
        }
        r.applyIncrementalLayout(layout, newNodeIds);
      }
      prevNodeCountRef.current = currentCount;
      prevNodeIdsRef.current = currentIds;
      lastAppliedLayoutRef.current = layout;
      prevRepoIdRef.current = repoId;
    }, action === 'incremental' ? RENDERER.INCREMENTAL_LAYOUT_DELAY_MS : RENDERER.FULL_LAYOUT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [layout, clusterDepth, nodes, edges, repoId]);

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
