import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId, HealthScore, RuleDefinition, RuleViolation, ViewMode } from '../../types/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import type { ClusterLevel, ClusterNode, ClusterEdge } from './cluster/index.ts';
import { assembleDiagram, assembleMicroDiagram, type LayeredDiagram } from '../diagram/index.ts';
import { DiagramCache, ClusterCache, computeDataHash } from '../cache/DiagramCache.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';

export type { ClusterLevel, ClusterNode, ClusterEdge } from './cluster/index.ts';

const diagramCache = new DiagramCache(10);
const clusterCache = new ClusterCache(20);

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
  clusterLevel: ClusterLevel;

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
  setClusterLevel: (level: ClusterLevel) => void;
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
      clusterLevel: 'directory',
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
      healthScore: null,
      rules: [],
      ruleViolations: [],
      panelHeight: null,
      panelWidth: null,
      selectedFunction: null,

      setGraphData: (nodes, edges, repoId, metadata) => {
        clearLoadingFailsafe();
        const { clusterLevel, expandedNodeIds, viewMode, currentLayer } = useGraphStore.getState();
        let displayNodes = nodes;
        let displayEdges = edges;
        let diagramData: LayeredDiagram | null = null;
        if (viewMode === 'inheritance' || viewMode === 'callgraph' || viewMode === 'package' || viewMode === 'class') {
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
        }
        const result = computeClusteredGraph(displayNodes, displayEdges, clusterLevel, expandedNodeIds);
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
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIds, expandedNodeIdsByViewMode, selectedFunction, savedRawNodes, savedRawEdges, viewMode: prevViewMode } = state;
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
            const result = computeClusteredGraph(layerNodes, layerEdges, 'directory', savedExpanded);
            set({
              viewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
              savedRawNodes: rawNodes, savedRawEdges: rawEdges,
              clusterLevel: 'directory', expandedNodeIds: savedExpanded,
              expandedNodeIdsByViewMode: newExpandedByViewMode,
              nodes: result.nodes, edges: result.edges,
            });
            return;
          }
          const result = computeClusteredGraph(rawNodes, rawEdges, 'directory', savedExpanded);
          set({
            viewMode, diagramData: null, layout: recommendedLayout,
            savedRawNodes: rawNodes, savedRawEdges: rawEdges,
            clusterLevel: 'directory', expandedNodeIds: savedExpanded,
            expandedNodeIdsByViewMode: newExpandedByViewMode,
            nodes: result.nodes, edges: result.edges,
          });
          return;
        }

        if (viewMode === 'code') {
          const restoreNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
          const restoreEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
          const result = computeClusteredGraph(restoreNodes, restoreEdges, 'directory', savedExpanded);
          set({
            viewMode, diagramData: null, layout: recommendedLayout,
            rawNodes: restoreNodes, rawEdges: restoreEdges,
            savedRawNodes: [], savedRawEdges: [],
            clusterLevel: 'directory', expandedNodeIds: savedExpanded,
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
            const result = computeClusteredGraph(layerNodes, layerEdges, 'directory', savedExpanded);
            set({
              viewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
              savedRawNodes: sourceNodes, savedRawEdges: sourceEdges,
              clusterLevel: 'directory', expandedNodeIds: savedExpanded,
              expandedNodeIdsByViewMode: newExpandedByViewMode,
              nodes: result.nodes, edges: result.edges,
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

        const result = computeClusteredGraph(rawNodes, rawEdges, clusterLevel, savedExpanded);
        set({ viewMode, diagramData: null, layout: recommendedLayout, expandedNodeIds: savedExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
      },
      setClusterLevel: (clusterLevel) => {
        const { rawNodes, rawEdges, expandedNodeIds, diagramData, currentLayer } = useGraphStore.getState();
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
        const cached = clusterCache.get(dataHash, clusterLevel, expandedKey);
        if (cached) {
          set({ clusterLevel, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, clusterLevel, expandedNodeIds);
        clusterCache.set(dataHash, clusterLevel, expandedKey, result);
        set({ clusterLevel, nodes: result.nodes, edges: result.edges });
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
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        let sourceNodes = rawNodes;
        let sourceEdges = rawEdges;
        if (diagramData) {
          const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
          if (layer) {
            sourceNodes = layer.nodes;
            sourceEdges = layer.edges;
          }
        }
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.add(nodeId);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
        const dataHash = computeDataHash(sourceNodes, sourceEdges);
        const expandedKey = [...newExpanded].sort().join(',');
        const cached = clusterCache.get(dataHash, clusterLevel, expandedKey);
        if (cached) {
          set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, clusterLevel, newExpanded);
        clusterCache.set(dataHash, clusterLevel, expandedKey, result);
        set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
      },
      collapseNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
        let sourceNodes = rawNodes;
        let sourceEdges = rawEdges;
        if (diagramData) {
          const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
          if (layer) {
            sourceNodes = layer.nodes;
            sourceEdges = layer.edges;
          }
        }
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.delete(nodeId);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
        const dataHash = computeDataHash(sourceNodes, sourceEdges);
        const expandedKey = [...newExpanded].sort().join(',');
        const cached = clusterCache.get(dataHash, clusterLevel, expandedKey);
        if (cached) {
          set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, clusterLevel, newExpanded);
        clusterCache.set(dataHash, clusterLevel, expandedKey, result);
        set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
      },
      collapseAll: () => {
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer } = useGraphStore.getState();
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
        const cached = clusterCache.get(dataHash, clusterLevel, expandedKey);
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: new Set<string>() };
        if (cached) {
          set({ expandedNodeIds: new Set(), expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(sourceNodes, sourceEdges, clusterLevel, new Set());
        clusterCache.set(dataHash, clusterLevel, expandedKey, result);
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
      setHealthScore: (score) => set({ healthScore: score }),
      setRules: (rules) => set({ rules }),
      setRuleViolations: (violations) => set({ ruleViolations: violations }),
      setPanelSize: (height, width) => set({ panelHeight: height, panelWidth: width }),
      resetPanelSize: () => set({ panelHeight: null, panelWidth: null }),
      setSelectedFunction: (fn) => set({ selectedFunction: fn }),
      assembleMicro: async (viewMode) => {
        const { selectedFunction, clusterLevel, expandedNodeIds } = useGraphStore.getState();
        if (!selectedFunction) return;
        const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName);
        if (diagram) {
          const result = computeClusteredGraph(diagram.nodes, diagram.edges, clusterLevel, expandedNodeIds);
          set({ diagramData: null, nodes: result.nodes, edges: result.edges });
        }
      },
      setLayer: (layer) => {
        const { diagramData, clusterLevel, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, currentLayer } = useGraphStore.getState();
        if (!diagramData || layer < 0 || layer >= diagramData.layers.length) return;
        const layerData = diagramData.layers[layer];
        if (!layerData) return;
        const currentLayerKey = `${viewMode}_layer${currentLayer}`;
        const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [currentLayerKey]: new Set(expandedNodeIds) };
        const layerExpanded = newExpandedByViewMode[`${viewMode}_layer${layer}`] ?? new Set<string>();
        const dataHash = computeDataHash(layerData.nodes, layerData.edges);
        const expandedKey = [...layerExpanded].sort().join(',');
        const cached = clusterCache.get(dataHash, clusterLevel, expandedKey);
        if (cached) {
          set({ currentLayer: layer, expandedNodeIds: layerExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
          return;
        }
        const result = computeClusteredGraph(layerData.nodes, layerData.edges, clusterLevel, layerExpanded);
        clusterCache.set(dataHash, clusterLevel, expandedKey, result);
        set({ currentLayer: layer, expandedNodeIds: layerExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
      },
    }),
    {
      name: 'dsh-codegraph-visualizer/ui',
      version: 5,
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
          result.clusterLevel = 'directory';
        }
        if (version < 5) {
          const h = (p as { panelHeight?: unknown }).panelHeight;
          const w = (p as { panelWidth?: unknown }).panelWidth;
          result.panelHeight = typeof h === 'number' && h >= 240 ? h : null;
          result.panelWidth = typeof w === 'number' && w >= 320 ? w : null;
        }
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, clusterLevel: s.clusterLevel,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
        rules: s.rules, focusDepth: s.focusDepth,
        panelHeight: s.panelHeight, panelWidth: s.panelWidth,
      }),
    },
  ),
);
