import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId, HealthScore, RuleDefinition, RuleViolation, ViewMode } from '../../types/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import type { ClusterNode, ClusterEdge } from './cluster/index.ts';
import { assembleDiagram, assembleMicroDiagram, type LayeredDiagram } from '../diagram/index.ts';
import { CallChainAggregator } from '../diagram/CallChainAggregator.ts';
import { DiagramCache, ClusterCache, computeDataHash } from '../cache/DiagramCache.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';
import { computeViewModeTransition, VIEW_MODE_LAYOUT } from './viewModeTransition.ts';

export type { ClusterNode, ClusterEdge } from './cluster/index.ts';

const diagramCache = new DiagramCache(10);
const clusterCache = new ClusterCache(20);
const callChainAggregator = new CallChainAggregator();

function detectInitialTheme(): ThemeType {
  if (typeof document === 'undefined') return 'dark';
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
}

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';
export type ThemeType = 'light' | 'dark';
export type GraphType = 'all' | 'call' | 'dependency';

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

const LOADING_FAILSAFE_MS = 15000;
let loadingFailsafe: ReturnType<typeof setTimeout> | null = null;


function isLayeredViewMode(mode: ViewMode): boolean {
  return mode === 'inheritance' || mode === 'callgraph' || mode === 'package' || mode === 'class' || mode === 'dependencies';
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
  const cached = clusterCache.get(dataHash, 'progressive', expandedKey);
  if (cached) {
    set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
    return;
  }
  const result = computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', newExpanded, clusterDepth);
  clusterCache.set(dataHash, 'progressive', expandedKey, result);
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

  callChainDepth: number;

  healthScore: HealthScore | null;
  rules: RuleDefinition[];
  ruleViolations: RuleViolation[];

  panelHeight: number | null;
  panelWidth: number | null;

  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number }) => void;
  setLayout: (layout: LayoutType) => void;
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
  collapseNode: (nodeId: string) => void;
  collapseAll: () => void;
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name?: string) => void;
  removeWorkspace: (path: string) => void;
  setPathStart: (nodeId: NodeId | null) => void;
  setPathEnd: (nodeId: NodeId | null) => void;
  setPathResult: (path: NodeId[] | null) => void;
  setFocusDepth: (depth: number) => void;
  setCallChainDepth: (depth: number) => void;
  assembleMultiFunction: (entryNodeId: string) => Promise<void>;
  setHealthScore: (score: HealthScore | null) => void;
  setRules: (rules: RuleDefinition[]) => void;
  setRuleViolations: (violations: RuleViolation[]) => void;
  setSelectedFunction: (fn: { nodeId: string; filePath: string; functionName: string } | null) => void;
  assembleMicro: (viewMode: 'cfg' | 'flowchart' | 'sequence') => Promise<void>;
  setPanelSize: (height: number, width: number) => void;
  resetPanelSize: () => void;
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
      callChainDepth: 2,
      healthScore: null,
      rules: [],
      ruleViolations: [],
      panelHeight: null,
      panelWidth: null,
      selectedFunction: null,

      setGraphData: (nodes, edges, repoId, metadata) => {
        clearLoadingFailsafe();
        const { clusterDepth, expandedNodeIds, viewMode, currentLayer } = useGraphStore.getState();
        const sanitized = sanitizeGraphData(nodes, edges);
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
          });
          return;
        }
        const result = computeClusteredGraph(displayNodes, displayEdges, 'progressive', expandedNodeIds, clusterDepth);
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
        });
      },
      setLayout: (layout) => set({ layout }),
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
          (vm) => useGraphStore.getState().assembleMicro(vm),
        );
        if (result.needsMicroAssembly) {
          const { needsMicroAssembly, ...rest } = result;
          set(rest);
          useGraphStore.getState().assembleMicro(viewMode as 'cfg' | 'flowchart' | 'sequence');
          return;
        }
        const { needsMicroAssembly: _, ...rest } = result;
        set(rest);
      },
      setClusterDepth: (clusterDepth) => {
        const { rawNodes, rawEdges, expandedNodeIds, diagramData, currentLayer, viewMode } = useGraphStore.getState();
        if (isLayeredViewMode(viewMode)) {
          set({ clusterDepth });
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
        const expandedKey = [...expandedNodeIds].sort().join(',');
        const cached = clusterCache.get(dataHash, 'progressive', expandedKey);
        if (cached) {
          set({ clusterDepth, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', expandedNodeIds, clusterDepth);
        clusterCache.set(dataHash, 'progressive', expandedKey, result);
        set({ clusterDepth, nodes: result.nodes, edges: result.edges });
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
        set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], savedRawNodes: [], savedRawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, truncated: false, totalNodeCount: 0, totalEdgeCount: 0 });
      },
      setPrerequisites: (prerequisites) => set({ prerequisites }),
      setInitStatus: (initStatus, initMessage = null) => set({ initStatus, initMessage }),
      setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
      expandNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.add(nodeId);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
        applyClusterUpdate(newExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, set);
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
          workspaceList: [{ path, name: wsName, lastUsed: Date.now() }, ...existing].slice(0, 10),
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
      setCallChainDepth: (depth) => set({ callChainDepth: depth }),
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
            console.warn('[codegraph:store] AST fetch failed', e);
            return null;
          }
        };
        const result = await callChainAggregator.aggregate(
          entryNodeId, rawNodes, rawEdges, astFetcher,
          { depth: callChainDepth, maxFunctions: 20 },
        );
        if (result) {
          const clustered = computeClusteredGraph(result.diagram.nodes, result.diagram.edges, 'progressive', expandedNodeIds, clusterDepth);
          set({
            diagramData: null,
            nodes: clustered.nodes,
            edges: clustered.edges,
            viewMode: 'cfg',
          });
        }
      },
      setHealthScore: (score) => set({ healthScore: score }),
      setRules: (rules) => set({ rules }),
      setRuleViolations: (violations) => set({ ruleViolations: violations }),
      setPanelSize: (height, width) => set({ panelHeight: height, panelWidth: width }),
      resetPanelSize: () => set({ panelHeight: null, panelWidth: null }),
      setSelectedFunction: (fn) => set({ selectedFunction: fn }),
      assembleMicro: async (viewMode) => {
        const { selectedFunction } = useGraphStore.getState();
        if (!selectedFunction) return;
        set({ isLoading: true, error: null });
        try {
          const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName);
          set({ diagramData: null, nodes: diagram.nodes, edges: diagram.edges, isLoading: false });
        } catch (e) {
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
      version: 7,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
      migrate: (persisted, version) => {
        const p = persisted as Partial<GraphState>;
        const layout = p.layout;
        const valid: LayoutType[] = ['cose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
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
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, clusterDepth: s.clusterDepth,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
        rules: s.rules, focusDepth: s.focusDepth,
        panelHeight: s.panelHeight, panelWidth: s.panelWidth,
      }),
    },
  ),
);
