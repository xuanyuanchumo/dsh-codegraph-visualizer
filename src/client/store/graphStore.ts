// Zustand store for graph visualization state
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

function detectInitialTheme(): ThemeType {
  if (typeof document === 'undefined') return 'dark';
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
}
// persistence instead of warning on every state update.
const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid';
export type ThemeType = 'light' | 'dark';
export type GraphType = 'all' | 'call' | 'dependency';

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

// Fail-safe window after which a stuck `isLoading` flag self-resets, so the
// loading overlay can never hang forever when no data arrives (J9/J12).
const LOADING_FAILSAFE_MS = 15000;
let loadingFailsafe: ReturnType<typeof setTimeout> | null = null;

function clearLoadingFailsafe(): void {
  if (loadingFailsafe !== null) {
    clearTimeout(loadingFailsafe);
    loadingFailsafe = null;
  }
}

const DEPTH_TYPE_MAP: Record<number, Set<string>> = {
  1: new Set(['module']),
  2: new Set(['module', 'class', 'interface', 'type']),
  3: new Set(['module', 'class', 'interface', 'type', 'function', 'variable']),
};

function filterByDepthLevel(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  depthLevel: 1 | 2 | 3 | 'all',
  expandedNodeIds?: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (depthLevel === 'all') return { nodes: rawNodes, edges: rawEdges };
  const allowedTypes = DEPTH_TYPE_MAP[depthLevel] ?? DEPTH_TYPE_MAP[3]!;
  const expanded = expandedNodeIds ?? new Set<string>();

  const childrenOfParent = new Map<string, GraphNode[]>();
  for (const n of rawNodes) {
    if (n.parentId) {
      const list = childrenOfParent.get(n.parentId);
      if (list) list.push(n);
      else childrenOfParent.set(n.parentId, [n]);
    }
  }

  const edgeAdjacency = new Map<string, string[]>();
  for (const e of rawEdges) {
    const list = edgeAdjacency.get(e.source);
    if (list) list.push(e.target);
    else edgeAdjacency.set(e.source, [e.target]);
    const list2 = edgeAdjacency.get(e.target);
    if (list2) list2.push(e.source);
    else edgeAdjacency.set(e.target, [e.source]);
  }

  const visibleNodeIds = new Set<string>();
  for (const n of rawNodes) {
    if (allowedTypes.has(n.type) && !n.parentId) {
      visibleNodeIds.add(n.id);
    }
  }

  for (const expandedId of expanded) {
    const children = childrenOfParent.get(expandedId);
    if (children) {
      for (const child of children) {
        visibleNodeIds.add(child.id);
      }
    }
    const neighbors = edgeAdjacency.get(expandedId) ?? [];
    for (const neighborId of neighbors) {
      const neighbor = rawNodes.find((n) => n.id === neighborId);
      if (neighbor && allowedTypes.has(neighbor.type)) {
        visibleNodeIds.add(neighborId);
      }
    }
  }

  const filteredNodes = rawNodes.filter((n) => visibleNodeIds.has(n.id));
  const filteredEdges = rawEdges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  return { nodes: filteredNodes, edges: filteredEdges };
}

interface GraphState {
  // Data (filtered by depthLevel)
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Raw data (full graph, unfiltered)
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  repoId: string | null;

  // Truncation info (when graph is too large to render fully)
  truncated: boolean;
  totalNodeCount: number;
  totalEdgeCount: number;
  
  // UI state
  layout: LayoutType;
  theme: ThemeType;
  searchQuery: string;
  selectedNodeId: NodeId | null;
  highlightedNodeIds: NodeId[];
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  depthLevel: 1 | 2 | 3 | 'all';
  
  // Loading
  isLoading: boolean;
  error: string | null;
  lastUpdated: number;

  // Prerequisite plugin status
  prerequisites: { codegraph: boolean; lens: boolean };

  // Init status: idle | initializing | done | error
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  initMessage: string | null;

  // Hot-update watch toggle
  watchEnabled: boolean;

  // Expanded nodes (per-node depth expansion for double-click interaction)
  expandedNodeIds: Set<string>;

  // Workspace management
  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];

  // Actions
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number }) => void;
  setLayout: (layout: LayoutType) => void;
  setTheme: (theme: ThemeType) => void;
  setSearchQuery: (query: string) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setHighlightedNodes: (nodeIds: NodeId[]) => void;
  setFilterType: (filter: GraphNode['type'] | 'all') => void;
  setGraphType: (graphType: GraphType) => void;
  setDepthLevel: (level: 1 | 2 | 3 | 'all') => void;
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
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      nodes: [],
      edges: [],
      rawNodes: [],
      rawEdges: [],
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
      depthLevel: 1,
      isLoading: false,
      error: null,
      lastUpdated: 0,
      prerequisites: { codegraph: false, lens: false },
      initStatus: 'idle',
      initMessage: null,
      watchEnabled: false,
      expandedNodeIds: new Set(),
      currentWorkspace: '.',
      workspaceList: [],

      // Arriving data always clears the loading flag (fixes the stuck-overlay bug).
      setGraphData: (nodes, edges, repoId, metadata) => {
        clearLoadingFailsafe();
        const depthLevel = useGraphStore.getState().depthLevel;
        const expandedNodeIds = useGraphStore.getState().expandedNodeIds;
        const { nodes: filteredNodes, edges: filteredEdges } = filterByDepthLevel(nodes, edges, depthLevel, expandedNodeIds);
        set({
          rawNodes: nodes, rawEdges: edges,
          nodes: filteredNodes, edges: filteredEdges,
          repoId, error: null, isLoading: false, lastUpdated: Date.now(),
          truncated: !!metadata?.truncated,
          totalNodeCount: metadata?.totalNodeCount ?? nodes.length,
          totalEdgeCount: metadata?.totalEdgeCount ?? edges.length,
        });
      },
      setLayout: (layout) => set({ layout }),
      setTheme: (theme) => set({ theme }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
      setHighlightedNodes: (highlightedNodeIds) => set({ highlightedNodeIds }),
      setFilterType: (filterType) => set({ filterType }),
      setGraphType: (graphType) => set({ graphType }),
      setDepthLevel: (depthLevel) => {
        const { rawNodes, rawEdges, expandedNodeIds } = useGraphStore.getState();
        const { nodes, edges } = filterByDepthLevel(rawNodes, rawEdges, depthLevel, expandedNodeIds);
        set({ depthLevel, nodes, edges });
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
        set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, truncated: false, totalNodeCount: 0, totalEdgeCount: 0 });
      },
      setPrerequisites: (prerequisites) => set({ prerequisites }),
      setInitStatus: (initStatus, initMessage = null) => set({ initStatus, initMessage }),
      setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
      expandNode: (nodeId) => {
        const { rawNodes, rawEdges, depthLevel, expandedNodeIds } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.add(nodeId);
        const { nodes, edges } = filterByDepthLevel(rawNodes, rawEdges, depthLevel, newExpanded);
        set({ expandedNodeIds: newExpanded, nodes, edges });
      },
      collapseNode: (nodeId) => {
        const { rawNodes, rawEdges, depthLevel, expandedNodeIds } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.delete(nodeId);
        const { nodes, edges } = filterByDepthLevel(rawNodes, rawEdges, depthLevel, newExpanded);
        set({ expandedNodeIds: newExpanded, nodes, edges });
      },
      collapseAll: () => {
        const { rawNodes, rawEdges, depthLevel } = useGraphStore.getState();
        const { nodes, edges } = filterByDepthLevel(rawNodes, rawEdges, depthLevel, new Set());
        set({ expandedNodeIds: new Set(), nodes, edges });
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
    }),
    {
      // J10 personalization: persist UI preferences only (versioned schema).
      name: 'dsh-codegraph-visualizer/ui',
      version: 3,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
      // Schema guard: v1 persisted 'dagre' etc.; future migrations normalize
      // unknown values instead of letting a stale value poison the store.
      migrate: (persisted, version) => {
        const p = persisted as Partial<GraphState>;
        const layout = p.layout;
        const valid: LayoutType[] = ['cose', 'dagre', 'circle', 'grid'];
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
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, depthLevel: s.depthLevel,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
      }),
    },
  ),
);