// Zustand store for graph visualization state
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { EdgeId } from '../../types/index.ts';
import type { GraphNode, GraphEdge, NodeId } from '../../types/index.ts';

function detectInitialTheme(): ThemeType {
  if (typeof document === 'undefined') return 'dark';
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
}
const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid';
export type ThemeType = 'light' | 'dark';
export type GraphType = 'all' | 'call' | 'dependency';
export type ClusterLevel = 'directory' | 'file' | 'function';

export interface WorkspaceInfo {
  path: string;
  name: string;
  lastUsed: number;
}

// Cluster node: a virtual node representing a directory aggregation
export interface ClusterNode extends GraphNode {
  isCluster: true;
  childCount: number;
  childIds: string[];
  clusterPath: string;
}

// Cluster edge: a virtual edge representing aggregated dependencies
export interface ClusterEdge extends GraphEdge {
  isCluster: true;
  aggregatedCount: number;
}

const LOADING_FAILSAFE_MS = 15000;
let loadingFailsafe: ReturnType<typeof setTimeout> | null = null;

function clearLoadingFailsafe(): void {
  if (loadingFailsafe !== null) {
    clearTimeout(loadingFailsafe);
    loadingFailsafe = null;
  }
}

// ---- Directory path utilities ----------------------------------------------


function getTopLevelDir(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 2) return filePath;
  // For Rust projects: crates/<name>/src/... → group by crates/<name>
  // For other projects: first 2-3 path segments
  if (parts[0] === 'crates' && parts.length >= 2) {
    return `crates/${parts[1]}`;
  }
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app') {
    return parts.slice(0, 2).join('/');
  }
  return parts.slice(0, 2).join('/');
}

function getDirLabel(dirPath: string): string {
  const parts = dirPath.split('/');
  return parts[parts.length - 1] ?? dirPath;
}

// ---- Cluster computation ----------------------------------------------------

interface ClusterResult {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
}

function computeDirectoryClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedDirs: Set<string>,
): ClusterResult {
  // Map each node to its top-level directory
  const nodeToDir = new Map<string, string>();
  const dirToNodes = new Map<string, GraphNode[]>();

  for (const n of rawNodes) {
    const dir = getTopLevelDir(n.filePath);
    nodeToDir.set(n.id, dir);
    const list = dirToNodes.get(dir);
    if (list) list.push(n);
    else dirToNodes.set(dir, [n]);
  }

  // If a directory is expanded, show its children as file-level nodes
  // Otherwise, show a cluster node
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>(); // raw node id → visible id (cluster or self)

  for (const [dirPath, nodes] of dirToNodes) {
    if (expandedDirs.has(dirPath)) {
      // Expanded: show individual file-level nodes
      for (const n of nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else {
      // Collapsed: create cluster node
      const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;
      const childIds = nodes.map((n) => n.id);
      const clusterNode: ClusterNode = {
        id: clusterId as NodeId,
        label: `${getDirLabel(dirPath)} (${nodes.length})`,
        type: 'module',
        filePath: dirPath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: nodes.length,
        childIds,
        clusterPath: dirPath,
      };
      visibleNodes.push(clusterNode);
      for (const n of nodes) {
        nodeIdToVisibleId.set(n.id, clusterId);
      }
    }
  }

  // Aggregate edges: merge edges between same cluster pairs
  const edgeAggregation = new Map<string, { source: string; target: string; count: number; types: Set<string> }>();

  for (const e of rawEdges) {
    const sourceVisibleId = nodeIdToVisibleId.get(e.source);
    const targetVisibleId = nodeIdToVisibleId.get(e.target);
    if (!sourceVisibleId || !targetVisibleId) continue;
    if (sourceVisibleId === targetVisibleId) continue; // intra-cluster edge, skip

    const key = `${sourceVisibleId}→${targetVisibleId}`;
    const existing = edgeAggregation.get(key);
    if (existing) {
      existing.count++;
      existing.types.add(e.type);
    } else {
      edgeAggregation.set(key, {
        source: sourceVisibleId,
        target: targetVisibleId,
        count: 1,
        types: new Set([e.type]),
      });
    }
  }

  const visibleEdges: (GraphEdge | ClusterEdge)[] = [];
  for (const [, agg] of edgeAggregation) {
    // If both endpoints are real nodes (not clusters), keep original edge
    const sourceIsCluster = agg.source.startsWith('cluster__');
    const targetIsCluster = agg.target.startsWith('cluster__');

    if (!sourceIsCluster && !targetIsCluster) {
      // Both are real nodes — find the original edge(s)
      for (const e of rawEdges) {
        if (nodeIdToVisibleId.get(e.source) === agg.source &&
            nodeIdToVisibleId.get(e.target) === agg.target) {
          visibleEdges.push(e);
        }
      }
    } else {
      // At least one cluster endpoint — create cluster edge
      const clusterEdge: ClusterEdge = {
        id: EdgeId(`clusteredge__${agg.source}__${agg.target}`),
        source: agg.source as NodeId,
        target: agg.target as NodeId,
        type: (agg.types.size === 1 ? [...agg.types][0]! : 'dependency') as GraphEdge['type'],
        properties: {},
        isCluster: true,
        aggregatedCount: agg.count,
      };
      visibleEdges.push(clusterEdge);
    }
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}

function computeFileClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedFiles: Set<string>,
): ClusterResult {
  // At file level: show all module (file) nodes, cluster function/variable/etc inside files
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  for (const n of rawNodes) {
    if (n.type === 'module') {
      // File nodes are always visible at file level
      visibleNodes.push(n);
      nodeIdToVisibleId.set(n.id, n.id);
    } else {
      // Non-module nodes: check if their parent file is expanded
      const parentFileId = n.parentId;
      if (parentFileId && expandedFiles.has(parentFileId)) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      } else {
        // Cluster into parent file
        const clusterId = parentFileId ? `filecluster__${parentFileId.replace(/[/:\\]/g, '__')}` : `filecluster__orphan`;
        nodeIdToVisibleId.set(n.id, clusterId);
      }
    }
  }

  // Create cluster nodes for files that have non-expanded children
  const fileClusterChildren = new Map<string, GraphNode[]>();
  for (const n of rawNodes) {
    if (n.type !== 'module') {
      const clusterId = nodeIdToVisibleId.get(n.id);
      if (clusterId && clusterId.startsWith('filecluster__')) {
        const list = fileClusterChildren.get(clusterId);
        if (list) list.push(n);
        else fileClusterChildren.set(clusterId, [n]);
      }
    }
  }

  for (const [clusterId, children] of fileClusterChildren) {
    const parentFileId = clusterId.replace('filecluster__', '').replace(/__/g, '/');
    const parentNode = rawNodes.find((n) => n.id === parentFileId);
    const clusterNode: ClusterNode = {
      id: clusterId as NodeId,
      label: `${parentNode?.label ?? 'unknown'} (${children.length})`,
      type: 'module',
      filePath: parentNode?.filePath ?? '',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: children.length,
      childIds: children.map((c) => c.id),
      clusterPath: parentFileId,
    };
    visibleNodes.push(clusterNode);
  }

  // Aggregate edges
  const edgeAggregation = new Map<string, { source: string; target: string; count: number; types: Set<string> }>();
  for (const e of rawEdges) {
    const sourceVisibleId = nodeIdToVisibleId.get(e.source);
    const targetVisibleId = nodeIdToVisibleId.get(e.target);
    if (!sourceVisibleId || !targetVisibleId) continue;
    if (sourceVisibleId === targetVisibleId) continue;

    const key = `${sourceVisibleId}→${targetVisibleId}`;
    const existing = edgeAggregation.get(key);
    if (existing) {
      existing.count++;
      existing.types.add(e.type);
    } else {
      edgeAggregation.set(key, {
        source: sourceVisibleId,
        target: targetVisibleId,
        count: 1,
        types: new Set([e.type]),
      });
    }
  }

  const visibleEdges: (GraphEdge | ClusterEdge)[] = [];
  for (const [, agg] of edgeAggregation) {
    const sourceIsCluster = agg.source.startsWith('filecluster__');
    const targetIsCluster = agg.target.startsWith('filecluster__');

    if (!sourceIsCluster && !targetIsCluster) {
      for (const e of rawEdges) {
        if (nodeIdToVisibleId.get(e.source) === agg.source &&
            nodeIdToVisibleId.get(e.target) === agg.target) {
          visibleEdges.push(e);
        }
      }
    } else {
      const clusterEdge: ClusterEdge = {
        id: EdgeId(`clusteredge__${agg.source}__${agg.target}`),
        source: agg.source as NodeId,
        target: agg.target as NodeId,
        type: (agg.types.size === 1 ? [...agg.types][0]! : 'dependency') as GraphEdge['type'],
        properties: {},
        isCluster: true,
        aggregatedCount: agg.count,
      };
      visibleEdges.push(clusterEdge);
    }
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}

function computeFunctionLevel(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
): ClusterResult {
  // Function level: show everything
  return { nodes: rawNodes, edges: rawEdges };
}

function computeClusteredGraph(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterLevel: ClusterLevel,
  expandedNodeIds: Set<string>,
): ClusterResult {
  switch (clusterLevel) {
    case 'directory':
      return computeDirectoryClusters(rawNodes, rawEdges, expandedNodeIds);
    case 'file':
      return computeFileClusters(rawNodes, rawEdges, expandedNodeIds);
    case 'function':
      return computeFunctionLevel(rawNodes, rawEdges);
  }
}

// ---- Store interface --------------------------------------------------------

interface GraphState {
  nodes: (GraphNode | ClusterNode)[];
  edges: (GraphEdge | ClusterEdge)[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
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
  clusterLevel: ClusterLevel;

  isLoading: boolean;
  error: string | null;
  lastUpdated: number;

  prerequisites: { codegraph: boolean; lens: boolean };
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  initMessage: string | null;
  watchEnabled: boolean;

  expandedNodeIds: Set<string>;

  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number }) => void;
  setLayout: (layout: LayoutType) => void;
  setTheme: (theme: ThemeType) => void;
  setSearchQuery: (query: string) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setHighlightedNodes: (nodeIds: NodeId[]) => void;
  setFilterType: (filter: GraphNode['type'] | 'all') => void;
  setGraphType: (graphType: GraphType) => void;
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
      clusterLevel: 'directory',
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

      setGraphData: (nodes, edges, repoId, metadata) => {
        clearLoadingFailsafe();
        const { clusterLevel, expandedNodeIds } = useGraphStore.getState();
        const result = computeClusteredGraph(nodes, edges, clusterLevel, expandedNodeIds);
        set({
          rawNodes: nodes, rawEdges: edges,
          nodes: result.nodes, edges: result.edges,
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
      setClusterLevel: (clusterLevel) => {
        const { rawNodes, rawEdges, expandedNodeIds } = useGraphStore.getState();
        const result = computeClusteredGraph(rawNodes, rawEdges, clusterLevel, expandedNodeIds);
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
        set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, truncated: false, totalNodeCount: 0, totalEdgeCount: 0 });
      },
      setPrerequisites: (prerequisites) => set({ prerequisites }),
      setInitStatus: (initStatus, initMessage = null) => set({ initStatus, initMessage }),
      setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
      expandNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIds } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.add(nodeId);
        const result = computeClusteredGraph(rawNodes, rawEdges, clusterLevel, newExpanded);
        set({ expandedNodeIds: newExpanded, nodes: result.nodes, edges: result.edges });
      },
      collapseNode: (nodeId) => {
        const { rawNodes, rawEdges, clusterLevel, expandedNodeIds } = useGraphStore.getState();
        const newExpanded = new Set(expandedNodeIds);
        newExpanded.delete(nodeId);
        const result = computeClusteredGraph(rawNodes, rawEdges, clusterLevel, newExpanded);
        set({ expandedNodeIds: newExpanded, nodes: result.nodes, edges: result.edges });
      },
      collapseAll: () => {
        const { rawNodes, rawEdges, clusterLevel } = useGraphStore.getState();
        const result = computeClusteredGraph(rawNodes, rawEdges, clusterLevel, new Set());
        set({ expandedNodeIds: new Set(), nodes: result.nodes, edges: result.edges });
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
      name: 'dsh-codegraph-visualizer/ui',
      version: 4,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
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
        if (version < 4) {
          result.clusterLevel = 'directory';
        }
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, clusterLevel: s.clusterLevel,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
      }),
    },
  ),
);
