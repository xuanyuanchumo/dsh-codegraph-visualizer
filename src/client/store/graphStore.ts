// Zustand store for graph visualization state
import { create } from 'zustand';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid';
export type ThemeType = 'light' | 'dark';

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

export const useGraphStore = create<GraphState>((set) => ({
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

  setGraphData: (nodes, edges, repoId) => set({ nodes, edges, repoId, error: null }),
  setLayout: (layout) => set({ layout }),
  setTheme: (theme) => set({ theme }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setHighlightedNodes: (highlightedNodeIds) => set({ highlightedNodeIds }),
  setFilterType: (filterType) => set({ filterType }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clearGraph: () => set({ nodes: [], edges: [], repoId: null, error: null }),
}));