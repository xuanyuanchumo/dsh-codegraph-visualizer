// Zustand store for graph visualization state
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

// No-op storage so non-browser environments (SSR/tests) silently skip
// persistence instead of warning on every state update.
const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid';
export type ThemeType = 'light' | 'dark';

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

// Fail-safe window after which a stuck `isLoading` flag self-resets, so the
// loading overlay can never hang forever when no data arrives (J9/J12).
const LOADING_FAILSAFE_MS = 2000;
let loadingFailsafe: ReturnType<typeof setTimeout> | null = null;

function clearLoadingFailsafe(): void {
  if (loadingFailsafe !== null) {
    clearTimeout(loadingFailsafe);
    loadingFailsafe = null;
  }
}

interface GraphState {
  // Data
  nodes: GraphNode[];
  edges: GraphEdge[];
  repoId: string | null;
  
  // UI state
  layout: LayoutType;
  theme: ThemeType;
  searchQuery: string;
  selectedNodeId: NodeId | null;
  highlightedNodeIds: NodeId[];
  filterType: GraphNode['type'] | 'all';
  
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

  // Workspace management
  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];

  // Actions
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string) => void;
  setLayout: (layout: LayoutType) => void;
  setTheme: (theme: ThemeType) => void;
  setSearchQuery: (query: string) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setHighlightedNodes: (nodeIds: NodeId[]) => void;
  setFilterType: (filter: GraphNode['type'] | 'all') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearGraph: () => void;
  setPrerequisites: (status: { codegraph: boolean; lens: boolean }) => void;
  setInitStatus: (status: 'idle' | 'initializing' | 'done' | 'error', message?: string | null) => void;
  setWatchEnabled: (enabled: boolean) => void;
  setCurrentWorkspace: (path: string) => void;
  addWorkspace: (path: string, name?: string) => void;
  removeWorkspace: (path: string) => void;
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      nodes: [],
      edges: [],
      repoId: null,
      layout: 'cose',
      theme: 'dark',
      searchQuery: '',
      selectedNodeId: null,
      highlightedNodeIds: [],
      filterType: 'all',
      isLoading: false,
      error: null,
      lastUpdated: 0,
      prerequisites: { codegraph: false, lens: false },
      initStatus: 'idle',
      initMessage: null,
      watchEnabled: false,
      currentWorkspace: '.',
      workspaceList: [],

      // Arriving data always clears the loading flag (fixes the stuck-overlay bug).
      setGraphData: (nodes, edges, repoId) => {
        clearLoadingFailsafe();
        set({ nodes, edges, repoId, error: null, isLoading: false, lastUpdated: Date.now() });
      },
      setLayout: (layout) => set({ layout }),
      setTheme: (theme) => set({ theme }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
      setHighlightedNodes: (highlightedNodeIds) => set({ highlightedNodeIds }),
      setFilterType: (filterType) => set({ filterType }),
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
        set({ nodes: [], edges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0 });
      },
      setPrerequisites: (prerequisites) => set({ prerequisites }),
      setInitStatus: (initStatus, initMessage = null) => set({ initStatus, initMessage }),
      setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
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
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
      }),
    },
  ),
);