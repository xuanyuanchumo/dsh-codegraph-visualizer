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
        // A new request refreshes the fail-safe window; a real completion or
        // error path cancels it entirely.
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
    }),
    {
      // J10 personalization: persist UI preferences only (versioned schema).
      name: 'dsh-codegraph-visualizer/ui',
      version: 1,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
      partialize: (s) => ({ layout: s.layout, theme: s.theme, filterType: s.filterType }),
    },
  ),
);