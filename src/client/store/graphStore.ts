import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId, HealthScore, RuleDefinition, RuleViolation, ViewMode } from '../../types/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import type { ClusterNode, ClusterEdge } from './cluster/index.ts';
import { assembleDiagram, assembleMicroDiagram, type LayeredDiagram } from '../diagram/index.ts';
import { CallChainAggregator } from '../diagram/CallChainAggregator.ts';
import { DiagramCache, ClusterCache, computeDataHash } from '../cache/DiagramCache.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';

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

const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType> = {
  code: 'cose',
  dependencies: 'dagre',
  inheritance: 'tree',
  callgraph: 'dagre',
  package: 'tree',
  class: 'dagre',
  cfg: 'dagre',
  flowchart: 'dagre',
  sequence: 'grid',
};

function isLayeredViewMode(mode: ViewMode): boolean {
  return mode === 'inheritance' || mode === 'callgraph' || mode === 'package' || mode === 'class' || mode === 'dependencies';
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
        let displayNodes = nodes;
        let displayEdges = edges;
        let diagramData: LayeredDiagram | null = null;
        const isLayeredView = viewMode === 'inheritance' || viewMode === 'callgraph' || viewMode === 'package' || viewMode === 'class' || viewMode === 'dependencies';
        if (isLayeredView) {
          const dataHash = computeDataHash(nodes, edges);
          const cached = diagramCache.get(viewMode, dataHash);
          if (cached) {
            diagramData = cached;
          } else {
            diagramData = assembleDiagram(viewMode, nodes, edges);
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
            rawNodes: nodes, rawEdges: edges,
            nodes: displayNodes, edges: displayEdges,
            diagramData,
            repoId, error: null, isLoading: false, lastUpdated: Date.now(),
            truncated: !!metadata?.truncated,
            totalNodeCount: metadata?.totalNodeCount ?? nodes.length,
            totalEdgeCount: metadata?.totalEdgeCount ?? edges.length,
            healthScore: null,
            ruleViolations: [],
          });
          return;
        }
        const result = computeClusteredGraph(displayNodes, displayEdges, 'progressive', expandedNodeIds, clusterDepth);
        set({
          rawNodes: nodes, rawEdges: edges,
          nodes: result.nodes, edges: result.edges,
          diagramData,
          repoId, error: null, isLoading: false, lastUpdated: Date.now(),
          truncated: !!metadata?.truncated,
          totalNodeCount: metadata?.totalNodeCount ?? nodes.length,
          totalEdgeCount: metadata?.totalEdgeCount ?? edges.length,
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
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, selectedFunction, savedRawNodes, savedRawEdges, viewMode: prevViewMode } = state;
        const recommendedLayout = VIEW_MODE_LAYOUT[viewMode];

        const savedExpanded = expandedNodeIdsByViewMode[viewMode] ?? new Set<string>();
        const prevExpanded = new Set(expandedNodeIds);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [prevViewMode]: prevExpanded };

        if (viewMode === 'dependencies') {
          const sourceNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
          const sourceEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
          const dataHash = computeDataHash(sourceNodes, sourceEdges);
          let diagram = diagramCache.get(viewMode, dataHash);
          if (!diagram) {
            diagram = assembleDiagram(viewMode, sourceNodes, sourceEdges);
            if (diagram) diagramCache.set(viewMode, dataHash, diagram);
          }
          if (diagram) {
            const layer = diagram.layers[0];
            const layerNodes = layer ? layer.nodes : diagram.allNodes;
            const layerEdges = layer ? layer.edges : diagram.allEdges;
            set({
              viewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
              savedRawNodes: rawNodes, savedRawEdges: rawEdges,
              expandedNodeIds: savedExpanded,
              expandedNodeIdsByViewMode: newExpandedByViewMode,
              nodes: layerNodes, edges: layerEdges,
            });
            return;
          }
          set({
            viewMode, diagramData: null, layout: recommendedLayout,
            savedRawNodes: rawNodes, savedRawEdges: rawEdges,
            expandedNodeIds: savedExpanded,
            expandedNodeIdsByViewMode: newExpandedByViewMode,
            nodes: rawNodes, edges: rawEdges,
          });
          return;
        }

        if (viewMode === 'code') {
          const restoreNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
          const restoreEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
          const result = computeClusteredGraph(restoreNodes, restoreEdges, 'progressive', savedExpanded, clusterDepth);
          set({
            viewMode, diagramData: null, layout: recommendedLayout,
            rawNodes: restoreNodes, rawEdges: restoreEdges,
            savedRawNodes: [], savedRawEdges: [],
            expandedNodeIds: savedExpanded,
            expandedNodeIdsByViewMode: newExpandedByViewMode,
            nodes: result.nodes, edges: result.edges,
          });
          return;
        }

        if (viewMode === 'inheritance' || viewMode === 'callgraph' || viewMode === 'package' || viewMode === 'class') {
          const sourceNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
          const sourceEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
          const dataHash = computeDataHash(sourceNodes, sourceEdges);
          let diagram = diagramCache.get(viewMode, dataHash);
          if (!diagram) {
            diagram = assembleDiagram(viewMode, sourceNodes, sourceEdges);
            if (diagram) diagramCache.set(viewMode, dataHash, diagram);
          }
          if (diagram) {
            const layer = diagram.layers[0];
            const layerNodes = layer ? layer.nodes : diagram.allNodes;
            const layerEdges = layer ? layer.edges : diagram.allEdges;
            set({
              viewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
              savedRawNodes: sourceNodes, savedRawEdges: sourceEdges,
              expandedNodeIds: savedExpanded,
              expandedNodeIdsByViewMode: newExpandedByViewMode,
              nodes: layerNodes, edges: layerEdges,
            });
            return;
          }
        }

        if (viewMode === 'cfg' || viewMode === 'flowchart' || viewMode === 'sequence') {
          if (selectedFunction) {
            set({ viewMode, layout: recommendedLayout, expandedNodeIdsByViewMode: newExpandedByViewMode });
            useGraphStore.getState().assembleMicro(viewMode);
            return;
          }
          set({ viewMode, diagramData: null, layout: recommendedLayout, nodes: [], edges: [], expandedNodeIdsByViewMode: newExpandedByViewMode });
          return;
        }

        const result = computeClusteredGraph(rawNodes, rawEdges, 'progressive', savedExpanded, clusterDepth);
        set({ viewMode, diagramData: null, layout: recommendedLayout, expandedNodeIds: savedExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
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
      },
      collapseNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.delete(nodeId);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
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
      },
      collapseAll: () => {
        const { rawNodes, rawEdges, clusterDepth, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: new Set<string>() };
        if (isLayeredViewMode(viewMode)) {
          if (diagramData) {
            const layer = diagramData.layers[currentLayer];
            const layerNodes = layer ? layer.nodes : diagramData.allNodes;
            const layerEdges = layer ? layer.edges : diagramData.allEdges;
            set({ expandedNodeIds: new Set(), expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: layerNodes, edges: layerEdges });
          } else {
            set({ expandedNodeIds: new Set(), expandedNodeIdsByViewMode: newExpandedByViewMode });
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
        const expandedKey = '';
        const cached = clusterCache.get(dataHash, 'progressive', expandedKey);
        if (cached) {
          set({ expandedNodeIds: new Set(), expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', new Set(), clusterDepth);
        clusterCache.set(dataHash, 'progressive', expandedKey, result);
        set({ expandedNodeIds: new Set(), expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
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
        const { selectedFunction, clusterDepth, expandedNodeIds } = useGraphStore.getState();
        if (!selectedFunction) return;
        const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName);
        if (diagram) {
          const result = computeClusteredGraph(diagram.nodes, diagram.edges, 'progressive', expandedNodeIds, clusterDepth);
          set({ diagramData: null, nodes: result.nodes, edges: result.edges });
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
