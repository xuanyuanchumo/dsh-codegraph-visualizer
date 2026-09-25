import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId, HealthScore, RuleDefinition, RuleViolation, ViewMode, HeatmapMode } from '../../types/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import type { ClusterNode, ClusterEdge, ClusterResult } from './cluster/index.ts';
import { estimateExpandCost } from './cluster/progressiveCluster.ts';
import { tryIncrementalOrFull, type IncrementalClusterContext } from './cluster/incrementalCluster.ts';
import { assembleDiagram, assembleMicroDiagram, type LayeredDiagram } from '../diagram/index.ts';
import { CallChainAggregator } from '../diagram/CallChainAggregator.ts';
import { DiagramCache, ClusterCache, computeDataHash } from '../cache/DiagramCache.ts';
import { IndexedDBCache } from '../cache/IndexedDBCache.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';
import { computeViewModeTransition } from './viewModeTransition.ts';
import { scoped } from '../../shared/Logger.ts';
import { type LayoutType, type ThemeType, type RankDir, isLayeredViewMode } from '../../shared/viewModeUtils.ts';

import { POLLING, CYCLE_DETECTION, CLUSTER, RENDERER, LOD, UI, getDynamicMaxVisibleNodes } from '../../shared/constants.ts';

const log = scoped('store');

export type { ClusterNode, ClusterEdge } from './cluster/index.ts';
export type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';

const diagramCache = new DiagramCache(10);
const clusterCache = new ClusterCache(20);
let id: IndexedDBCache | null = null;
const callChainAggregator = new CallChainAggregator();
let microAssemblyGeneration = 0;
let incrementalClusterCtx: IncrementalClusterContext | null = null;

function detectInitialTheme(): ThemeType {
  if (typeof document === 'undefined') return 'dark';
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
}

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};



export type GraphType = 'all' | 'call' | 'dependency';

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

const LOADING_FAILSAFE_MS = POLLING.LOADING_FAILSAFE_MS;
let loadingFailsafe: ReturnType<typeof setTimeout> | null = null;

function updateIncrementalClusterCtx(
  result: ClusterResult,
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
): void {
  const nodeIdToVisibleId = new Map<string, string>();
  for (const n of result.nodes) {
    if ('isCluster' in n && n.isCluster) {
      for (const childId of n.childIds) {
        nodeIdToVisibleId.set(childId, n.id);
      }
    } else {
      nodeIdToVisibleId.set(n.id, n.id);
    }
  }
  incrementalClusterCtx = {
    prevResult: result,
    prevNodeIdToVisibleId: nodeIdToVisibleId,
    prevRawNodes: rawNodes,
    prevRawEdges: rawEdges,
  };
}



function sanitizeGraphData(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const seenNodeIds = new Set<string>();
  const validNodes: GraphNode[] = [];
  for (const node of nodes) {
    if (!node || !node.id || !node.label || !node.type || !node.filePath) continue;
    if (seenNodeIds.has(node.id)) continue;
    seenNodeIds.add(node.id);
    validNodes.push(node);
  }

  const nodeIdSet = new Set(validNodes.map((n) => n.id));
  const seenEdgeIds = new Set<string>();
  const validEdges: GraphEdge[] = [];
  for (const edge of edges) {
    if (!edge || !edge.id || !edge.source || !edge.target) continue;
    if (edge.source === edge.target) continue;
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    validEdges.push(edge);
  }

  return { nodes: validNodes, edges: validEdges };
}

function computeLayeredExpandedView(
  diagramData: LayeredDiagram,
  currentLayer: number,
  expandedNodeIds: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layer = diagramData.layers[currentLayer];
  if (!layer) return { nodes: [], edges: [] };

  const inEdgesMap = new Map<string, string[]>();
  for (const e of diagramData.allEdges) {
    const list = inEdgesMap.get(e.target) ?? [];
    list.push(e.source);
    inEdgesMap.set(e.target, list);
  }

  const visibleIds = new Set<string>(layer.nodeIds);
  const queue: string[] = [];
  for (const id of expandedNodeIds) {
    if (visibleIds.has(id)) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = inEdgesMap.get(id) ?? [];
    for (const childId of children) {
      if (!visibleIds.has(childId)) {
        visibleIds.add(childId);
        if (expandedNodeIds.has(childId)) queue.push(childId);
      }
    }
  }

  const visibleNodes = diagramData.allNodes.filter((n) => visibleIds.has(n.id));
  const visibleEdges = diagramData.allEdges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  return { nodes: visibleNodes, edges: visibleEdges };
}

function clearLoadingFailsafe(): void {
  if (loadingFailsafe !== null) {
    clearTimeout(loadingFailsafe);
    loadingFailsafe = null;
  }
}

export function disposeStore(): void {
  diagramCache.invalidate();
  clusterCache.invalidate();
  incrementalClusterCtx = null;
  microAssemblyGeneration = 0;
  clearLoadingFailsafe();
  if (id) { id.close(); id = null; }
}

function applyClusterUpdate(
  newExpanded: Set<string>,
  newExpandedByViewMode: Record<string, Set<string>>,
  viewMode: ViewMode,
  diagramData: LayeredDiagram | null,
  currentLayer: number,
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterDepth: number,
  clusterCache: ClusterCache,
  set: (partial: Partial<GraphState>) => void,
): void {
  if (isLayeredViewMode(viewMode)) {
    if (diagramData) {
      const { nodes: visNodes, edges: visEdges } = computeLayeredExpandedView(diagramData, currentLayer, newExpanded);
      set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: visNodes, edges: visEdges });
    } else {
      set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode });
    }
    return;
  }
  let sourceNodes = rawNodes;
  let sourceEdges = rawEdges;
  if (diagramData) {
    const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
    if (layer) {
      sourceNodes = layer.nodes;
      sourceEdges = layer.edges;
    }
  }
  const dataHash = computeDataHash(sourceNodes, sourceEdges);
  const expandedKey = [...newExpanded].sort().join(',');
  const cacheLevel = `progressive:${clusterDepth}`;
  const cached = clusterCache.get(dataHash, cacheLevel, expandedKey);
  if (cached) {
    set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
    return;
  }
  const result = computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', newExpanded, clusterDepth, useGraphStore.getState().panelWidth ?? undefined);
  clusterCache.set(dataHash, cacheLevel, expandedKey, result);
  set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
}

interface GraphState {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  savedRawNodes: GraphNode[];
  savedRawEdges: GraphEdge[];
  repoId: string | null;

  truncated: boolean;
  totalNodeCount: number;
  totalEdgeCount: number;

  layout: LayoutType;
  dagreRankDir: RankDir;
  theme: ThemeType;
  searchQuery: string;
  selectedNodeId: NodeId | null;
  highlightedNodeIds: NodeId[];
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  viewMode: ViewMode;
  diagramData: LayeredDiagram | null;
  currentLayer: number;
  clusterDepth: number;

  isLoading: boolean;
  error: string | null;
  lastUpdated: number;

  prerequisites: { codegraph: boolean; lens: boolean };
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  initMessage: string | null;
  watchEnabled: boolean;

  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;

  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];

  pathStartId: NodeId | null;
  pathEndId: NodeId | null;
  pathResult: NodeId[] | null;

  focusDepth: number;
  focusModeActive: boolean;
  focusModeNodeId: NodeId | null;

  pathFilterInclude: string | null;
  pathFilterExclude: string | null;

  callChainDepth: number;

  fanInThreshold: number;
  fanOutThreshold: number;
  visibleNodeTypes: Set<GraphNode['type']>;
  visibleEdgeTypes: Set<GraphEdge['type']>;
  heatmapMode: HeatmapMode;

  healthScore: HealthScore | null;
  rules: RuleDefinition[];
  ruleViolations: RuleViolation[];

  panelHeight: number | null;
  panelWidth: number | null;

  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;

  performanceDegradations: string[];

  lodLevel: 'minimal' | 'compact' | 'full';
  lodEnabled: boolean;

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number }) => void;
  setLayout: (layout: LayoutType) => void;
  setDagreRankDir: (dir: RankDir) => void;
  setTheme: (theme: ThemeType) => void;
  setSearchQuery: (query: string) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setHighlightedNodes: (nodeIds: NodeId[]) => void;
  setFilterType: (filter: GraphNode['type'] | 'all') => void;
  setGraphType: (graphType: GraphType) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setLayer: (layer: number) => void;
  setClusterDepth: (depth: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearGraph: () => void;
  setPrerequisites: (status: { codegraph: boolean; lens: boolean }) => void;
  setInitStatus: (status: 'idle' | 'initializing' | 'done' | 'error', message?: string | null) => void;
  setWatchEnabled: (enabled: boolean) => void;
  expandNode: (nodeId: string) => void;
  prefetchExpand: (nodeId: string) => void;
  collapseNode: (nodeId: string) => void;
  collapseAll: () => void;
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name?: string) => void;
  removeWorkspace: (path: string) => void;
  setPathStart: (nodeId: NodeId | null) => void;
  setPathEnd: (nodeId: NodeId | null) => void;
  setPathResult: (path: NodeId[] | null) => void;
  setFocusDepth: (depth: number) => void;
  setFocusMode: (active: boolean, nodeId: NodeId | null) => void;
  setPathFilter: (include: string | null, exclude: string | null) => void;
  setCallChainDepth: (depth: number) => void;
  setFanInThreshold: (threshold: number) => void;
  setFanOutThreshold: (threshold: number) => void;
  setVisibleNodeTypes: (types: Set<GraphNode['type']>) => void;
  setVisibleEdgeTypes: (types: Set<GraphEdge['type']>) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  assembleMultiFunction: (entryNodeId: string) => Promise<void>;
  setHealthScore: (score: HealthScore | null) => void;
  setRules: (rules: RuleDefinition[]) => void;
  setRuleViolations: (violations: RuleViolation[]) => void;
  setSelectedFunction: (fn: { nodeId: string; filePath: string; functionName: string } | null) => void;
  assembleMicro: (viewMode: 'cfg' | 'flowchart' | 'sequence', selectedFunctionOverride?: { nodeId: string; filePath: string; functionName: string } | null) => Promise<void>;
  setPanelSize: (height: number, width: number) => void;
  resetPanelSize: () => void;
  addDegradation: (key: string) => void;
  clearDegradations: () => void;
  setLODLevel: (level: 'minimal' | 'compact' | 'full') => void;
  setLODEnabled: (enabled: boolean) => void;
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      nodes: [],
      edges: [],
      rawNodes: [],
      rawEdges: [],
      savedRawNodes: [],
      savedRawEdges: [],
      repoId: null,
      truncated: false,
      totalNodeCount: 0,
      totalEdgeCount: 0,
      layout: 'cose',
      dagreRankDir: 'TB',
      theme: detectInitialTheme(),
      searchQuery: '',
      selectedNodeId: null,
      highlightedNodeIds: [],
      filterType: 'all',
      graphType: 'all',
      viewMode: 'code',
      diagramData: null,
      currentLayer: 0,
      clusterDepth: 0,
      isLoading: false,
      error: null,
      lastUpdated: 0,
      prerequisites: { codegraph: false, lens: false },
      initStatus: 'idle',
      initMessage: null,
      watchEnabled: false,
      expandedNodeIds: new Set(),
      expandedNodeIdsByViewMode: {},
      currentWorkspace: '.',
      workspaceList: [],
      pathStartId: null,
      pathEndId: null,
      pathResult: null,
      focusDepth: 1,
      focusModeActive: false,
      focusModeNodeId: null,
      pathFilterInclude: null,
      pathFilterExclude: null,
      callChainDepth: 2,
      fanInThreshold: 0,
      fanOutThreshold: 0,
      visibleNodeTypes: new Set<GraphNode['type']>(),
      visibleEdgeTypes: new Set<GraphEdge['type']>(),
      heatmapMode: 'none' as HeatmapMode,
      healthScore: null,
      rules: [],
      ruleViolations: [],
      panelHeight: null,
      panelWidth: null,
      selectedFunction: null,
      performanceDegradations: [],
      lodLevel: 'full',
      lodEnabled: false,

      setGraphData: (nodes, edges, repoId, metadata) => {
        try {
          clearLoadingFailsafe();
          if (id?.['repoId'] !== repoId) {
            if (id) id.close();
            id = new IndexedDBCache(repoId);
            diagramCache.setPersistentBackend(id);
            clusterCache.setPersistentBackend(id);
          }
          const { clusterDepth, expandedNodeIds, viewMode, currentLayer } = useGraphStore.getState();
          const sanitized = sanitizeGraphData(nodes, edges);
          const newDegradations: string[] = [];
          if (sanitized.nodes.length > CYCLE_DETECTION.MAX_NODES_FOR_DETECTION) {
            newDegradations.push('cycle-detection-skipped');
          }
          if (sanitized.nodes.length > CLUSTER.MAX_NODES_FOR_LABEL_PROP) {
            newDegradations.push('community-detection-sampled');
          }
          if (sanitized.nodes.length > RENDERER.LARGE_GRAPH_NODE_THRESHOLD) {
            newDegradations.push('large-graph-mode');
          }
          let displayNodes = sanitized.nodes;
          let displayEdges = sanitized.edges;
          let diagramData: LayeredDiagram | null = null;
          const isLayeredView = isLayeredViewMode(viewMode);
          if (isLayeredView) {
            const dataHash = computeDataHash(sanitized.nodes, sanitized.edges);
            const cached = diagramCache.get(viewMode, dataHash);
            if (cached) {
              diagramData = cached;
            } else {
              diagramData = assembleDiagram(viewMode, sanitized.nodes, sanitized.edges);
              if (diagramData) diagramCache.set(viewMode, dataHash, diagramData);
            }
            if (diagramData) {
              const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
              if (layer) {
                displayNodes = layer.nodes;
                displayEdges = layer.edges;
              }
            }
            set({
              rawNodes: sanitized.nodes, rawEdges: sanitized.edges,
              nodes: displayNodes, edges: displayEdges,
              diagramData,
              repoId, error: null, isLoading: false, lastUpdated: Date.now(),
              truncated: !!metadata?.truncated,
              totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
              totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
              healthScore: null,
              ruleViolations: [],
              performanceDegradations: newDegradations,
            });
            return;
          }
          const result = tryIncrementalOrFull(
            incrementalClusterCtx,
            displayNodes, displayEdges,
            expandedNodeIds, clusterDepth,
            useGraphStore.getState().panelWidth ?? undefined,
          );
          updateIncrementalClusterCtx(result, sanitized.nodes, sanitized.edges);
          set({
            rawNodes: sanitized.nodes, rawEdges: sanitized.edges,
            nodes: result.nodes, edges: result.edges,
            diagramData,
            repoId, error: null, isLoading: false, lastUpdated: Date.now(),
            truncated: !!metadata?.truncated,
            totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
            totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
            healthScore: null,
            ruleViolations: [],
            performanceDegradations: newDegradations,
          });
        } catch (err) {
          log.error('setGraphData failed', { err });
          set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
        }
      },
      setLayout: (layout) => set({ layout }),
      setDagreRankDir: (dagreRankDir) => set({ dagreRankDir }),
      setTheme: (theme) => { invalidateCssVarCache(); set({ theme }); },
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
      setHighlightedNodes: (highlightedNodeIds) => set({ highlightedNodeIds }),
      setFilterType: (filterType) => set({ filterType }),
      setGraphType: (graphType) => set({ graphType }),
      setViewMode: (viewMode) => {
        const state = useGraphStore.getState();
        const result = computeViewModeTransition(
          viewMode,
          {
            rawNodes: state.rawNodes,
            rawEdges: state.rawEdges,
            savedRawNodes: state.savedRawNodes,
            savedRawEdges: state.savedRawEdges,
            clusterDepth: state.clusterDepth,
            expandedNodeIds: state.expandedNodeIds,
            expandedNodeIdsByViewMode: state.expandedNodeIdsByViewMode,
            selectedFunction: state.selectedFunction,
            viewMode: state.viewMode,
          },
          diagramCache,

        );
        if (result.needsMicroAssembly) {
          const { needsMicroAssembly: _discarded, ...rest } = result;
          const fn = useGraphStore.getState().selectedFunction;
          set(rest);
          useGraphStore.getState().assembleMicro(viewMode as 'cfg' | 'flowchart' | 'sequence', fn);
          return;
        }
        const { needsMicroAssembly: _discarded2, ...rest } = result;
        set(rest);
      },
      setClusterDepth: (clusterDepth) => {
        const { rawNodes, rawEdges, expandedNodeIds, expandedNodeIdsByViewMode, diagramData, currentLayer, viewMode } = useGraphStore.getState();
        if (isLayeredViewMode(viewMode)) {
          set({ clusterDepth });
          return;
        }
        applyClusterUpdate(expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, set);
        set({ clusterDepth });
      },
      setLoading: (isLoading) => {
        clearLoadingFailsafe();
        set({ isLoading });
        if (isLoading) {
          loadingFailsafe = setTimeout(() => {
            loadingFailsafe = null;
            if (useGraphStore.getState().isLoading) {
              useGraphStore.setState({ isLoading: false });
            }
          }, LOADING_FAILSAFE_MS);
        }
      },
      setError: (error) => {
        clearLoadingFailsafe();
        set({ error, isLoading: false });
      },
      clearGraph: () => {
        clearLoadingFailsafe();
        incrementalClusterCtx = null;
        set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], savedRawNodes: [], savedRawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, truncated: false, totalNodeCount: 0, totalEdgeCount: 0 });
      },
      setPrerequisites: (prerequisites) => set({ prerequisites }),
      setInitStatus: (initStatus, initMessage = null) => set({ initStatus, initMessage }),
      setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
      expandNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, nodes, panelWidth } = useGraphStore.getState();
        const cost = estimateExpandCost(nodeId, rawNodes);
        const maxVisible = panelWidth !== null && panelWidth !== undefined
          ? getDynamicMaxVisibleNodes(panelWidth)
          : CLUSTER.MAX_VISIBLE_NODES;
        const effectiveExpanded = new Set(expandedNodeIds);
        effectiveExpanded.add(nodeId);
        if (nodes.length + cost > maxVisible) {
          const clusterNodes = nodes.filter((n): n is ClusterNode => 'isCluster' in n && n.isCluster === true);
          const sorted = [...clusterNodes].sort((a, b) => b.childCount - a.childCount);
          for (const cn of sorted) {
            if (nodes.length + cost - cn.childCount <= maxVisible) {
              effectiveExpanded.delete(cn.id);
              break;
            }
            effectiveExpanded.delete(cn.id);
          }
        }
        if (cost > CLUSTER.EXPAND_BUDGET_SINGLE) {
          log.warn('expand budget exceeded', { nodeId, cost, budget: CLUSTER.EXPAND_BUDGET_SINGLE });
        }
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: effectiveExpanded };
        applyClusterUpdate(effectiveExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, set);
      },
      prefetchExpand: (nodeId) => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        if (isLayeredViewMode(viewMode)) return;
        if (expandedNodeIds.has(nodeId)) return;
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.add(nodeId);
        let sourceNodes = rawNodes;
        let sourceEdges = rawEdges;
        if (diagramData) {
          const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
          if (layer) {
            sourceNodes = layer.nodes;
            sourceEdges = layer.edges;
          }
        }
        const dataHash = computeDataHash(sourceNodes, sourceEdges);
        const expandedKey = [...newExpanded].sort().join(',');
        const cacheLevel = `progressive:${clusterDepth}`;
        if (clusterCache.get(dataHash, cacheLevel, expandedKey)) return;
        const result = computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', newExpanded, clusterDepth, useGraphStore.getState().panelWidth ?? undefined);
        clusterCache.set(dataHash, cacheLevel, expandedKey, result);
      },
      collapseNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.delete(nodeId);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
        applyClusterUpdate(newExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, set);
      },
      collapseAll: () => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: new Set<string>() };
        applyClusterUpdate(new Set(), newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, set);
      },
      setCurrentWorkspace: (path) => set({ currentWorkspace: path }),
      addWorkspace: (path, name) => set((s) => {
        const wsName = name ?? path.split(/[\\/]/).pop() ?? path;
        const existing = s.workspaceList.filter((w) => w.path !== path);
        return {
          currentWorkspace: path,
          workspaceList: [{ path, name: wsName, lastUsed: Date.now() }, ...existing].slice(0, UI.WORKSPACE_LIST_MAX),
        };
      }),
      removeWorkspace: (path) => set((s) => ({
        workspaceList: s.workspaceList.filter((w) => w.path !== path),
        currentWorkspace: s.currentWorkspace === path ? '.' : s.currentWorkspace,
      })),
      setPathStart: (nodeId) => set({ pathStartId: nodeId }),
      setPathEnd: (nodeId) => set({ pathEndId: nodeId }),
      setPathResult: (path) => set({ pathResult: path }),
      setFocusDepth: (depth) => set({ focusDepth: depth }),
      setFocusMode: (active, nodeId) => set({ focusModeActive: active, focusModeNodeId: nodeId }),
      setPathFilter: (include, exclude) => set({ pathFilterInclude: include, pathFilterExclude: exclude }),
      setCallChainDepth: (depth) => set({ callChainDepth: depth }),
      setFanInThreshold: (threshold) => set({ fanInThreshold: threshold }),
      setFanOutThreshold: (threshold) => set({ fanOutThreshold: threshold }),
      setVisibleNodeTypes: (types) => set({ visibleNodeTypes: types }),
      setVisibleEdgeTypes: (types) => set({ visibleEdgeTypes: types }),
      setHeatmapMode: (mode) => set({ heatmapMode: mode }),
      assembleMultiFunction: async (entryNodeId) => {
        const { rawNodes, rawEdges, callChainDepth, clusterDepth, expandedNodeIds } = useGraphStore.getState();
        const astFetcher = async (filePath: string) => {
          try {
            const response = await fetch('/api/v1/codegraph/ast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath }),
            });
            if (!response.ok) return null;
            return await response.json();
          } catch (e) {
            log.warn('AST fetch failed', e);
            return null;
          }
        };
        try {
          const result = await callChainAggregator.aggregate(
            entryNodeId, rawNodes, rawEdges, astFetcher,
            { depth: callChainDepth, maxFunctions: UI.MAX_FUNCTIONS_PER_CLUSTER },
          );
          if (result && result.diagram.nodes.length > 0) {
            const clustered = computeClusteredGraph(result.diagram.nodes, result.diagram.edges, 'progressive', expandedNodeIds, clusterDepth, useGraphStore.getState().panelWidth ?? undefined);
            set({
              diagramData: null,
              nodes: clustered.nodes,
              edges: clustered.edges,
              viewMode: 'cfg',
              error: null,
            });
          } else {
            set({ error: 'Call chain aggregation produced no results — the selected function may have no callable targets or AST parsing failed.', isLoading: false });
          }
        } catch (e) {
          log.warn('assembleMultiFunction failed', e);
          set({ error: `Call chain aggregation failed: ${e instanceof Error ? e.message : String(e)}`, isLoading: false });
        }
      },
      setHealthScore: (score) => set({ healthScore: score }),
      setRules: (rules) => set({ rules }),
      setRuleViolations: (violations) => set({ ruleViolations: violations }),
      setPanelSize: (height, width) => set({ panelHeight: height, panelWidth: width }),
      resetPanelSize: () => set({ panelHeight: null, panelWidth: null }),
      addDegradation: (key) => set((s) => {
        if (s.performanceDegradations.includes(key)) return s;
        return { performanceDegradations: [...s.performanceDegradations, key] };
      }),
      clearDegradations: () => set({ performanceDegradations: [] }),
      setLODLevel: (level) => {
        const state = useGraphStore.getState();
        if (state.lodLevel === level) return;
        set({ lodLevel: level });
        if (!state.lodEnabled) return;
        if (isLayeredViewMode(state.viewMode)) return;
        const lodDepth = level === 'minimal' ? LOD.MINIMAL_CLUSTER_DEPTH
          : level === 'compact' ? LOD.COMPACT_CLUSTER_DEPTH
          : state.clusterDepth;
        const { rawNodes, rawEdges, expandedNodeIds } = state;
        const result = tryIncrementalOrFull(
          incrementalClusterCtx,
          rawNodes, rawEdges,
          expandedNodeIds, lodDepth,
          state.panelWidth ?? undefined,
        );
        updateIncrementalClusterCtx(result, rawNodes, rawEdges);
        set({ nodes: result.nodes, edges: result.edges });
      },
      setLODEnabled: (enabled) => {
        set({ lodEnabled: enabled });
        if (!enabled) {
          const state = useGraphStore.getState();
          if (state.lodLevel !== 'full') {
            useGraphStore.getState().setLODLevel('full');
          }
        }
      },
      setSelectedFunction: (fn) => set({ selectedFunction: fn }),
      assembleMicro: async (viewMode, selectedFunctionOverride) => {
        const selectedFunction = selectedFunctionOverride ?? useGraphStore.getState().selectedFunction;
        if (!selectedFunction) return;
        const gen = ++microAssemblyGeneration;
        set({ isLoading: true, error: null });
        try {
          const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName);
          if (gen !== microAssemblyGeneration) return;
          set({ diagramData: null, nodes: diagram.nodes, edges: diagram.edges, isLoading: false });
        } catch (e) {
          if (gen !== microAssemblyGeneration) return;
          const msg = e instanceof Error ? e.message : String(e);
          set({ isLoading: false, error: `${msg} — ${selectedFunction.functionName}` });
        }
      },
      setLayer: (layer) => {
        const { diagramData, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, currentLayer } = useGraphStore.getState();
        if (!diagramData || layer < 0 || layer >= diagramData.layers.length) return;
        const layerData = diagramData.layers[layer];
        if (!layerData) return;
        const currentLayerKey = `${viewMode}_layer${currentLayer}`;
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [currentLayerKey]: new Set(expandedNodeIds) };
        const layerExpanded = newExpandedByViewMode[`${viewMode}_layer${layer}`] ?? new Set<string>();
        set({ currentLayer: layer, expandedNodeIds: layerExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: layerData.nodes, edges: layerData.edges });
      },
    }),
    {
      name: 'dsh-codegraph-visualizer/ui',
      version: 9,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>;
        const raw = p.expandedNodeIds;
        const expandedNodeIds = Array.isArray(raw)
          ? new Set(raw as string[])
          : raw instanceof Set ? (raw as Set<string>) : new Set<string>();
        return { ...current, ...(persisted as object), expandedNodeIds } as GraphState;
      },
      migrate: (persisted, version) => {
        const p = persisted as Partial<GraphState>;
        const layout = p.layout;
        const valid: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
        const result: Partial<GraphState> = {
          ...p,
          layout: valid.includes(layout as LayoutType) ? (layout as LayoutType) : 'cose',
          theme: p.theme === 'light' ? 'light' : 'dark',
          filterType: p.filterType ?? 'all',
        };
        if (version < 3) {
          result.workspaceList = Array.isArray(p.workspaceList) ? p.workspaceList : [];
          result.currentWorkspace = typeof p.currentWorkspace === 'string' ? p.currentWorkspace : '.';
        }
        if (version < 4) {
          (result as Record<string, unknown>).clusterLevel = 'directory';
        }
        if (version < 5) {
          const h = (p as { panelHeight?: unknown }).panelHeight;
          const w = (p as { panelWidth?: unknown }).panelWidth;
          result.panelHeight = typeof h === 'number' && h >= 240 ? h : null;
          result.panelWidth = typeof w === 'number' && w >= 320 ? w : null;
        }
        if (version < 6) {
          const validClusterLevels = ['directory', 'file', 'function', 'progressive'];
          if (!validClusterLevels.includes((p as { clusterLevel?: string }).clusterLevel ?? '')) {
            (result as Record<string, unknown>).clusterLevel = 'progressive';
          }
        }
        if (version < 7) {
          const oldLevel = (p as { clusterLevel?: string }).clusterLevel;
          const depthMap: Record<string, number> = { directory: 0, file: 1, function: 2, progressive: 0, smart: 0 };
          result.clusterDepth = typeof oldLevel === 'string' ? (depthMap[oldLevel] ?? 0) : 0;
        }
        if (version < 8) {
          const validRankDirs = ['TB', 'LR', 'BT', 'RL'];
          const savedRankDir = (p as { dagreRankDir?: string }).dagreRankDir;
          (result as Record<string, unknown>).dagreRankDir = validRankDirs.includes(savedRankDir ?? '') ? savedRankDir : 'TB';
        }
        if (version < 9) {
          const arr = (p as { expandedNodeIds?: unknown }).expandedNodeIds;
          (result as Record<string, unknown>).expandedNodeIds = Array.isArray(arr)
            ? new Set(arr as string[])
            : new Set<string>();
        }
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, dagreRankDir: s.dagreRankDir, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, clusterDepth: s.clusterDepth,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
        rules: s.rules, focusDepth: s.focusDepth,
        panelHeight: s.panelHeight, panelWidth: s.panelWidth,
        expandedNodeIds: [...s.expandedNodeIds] as unknown as Set<string>,
      }),
    },
  ),
);
