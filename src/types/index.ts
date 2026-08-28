// Branded types for DSH plugin safety
export type Branded<T, Brand> = T & { __brand: Brand };

export type RepoId = Branded<string, 'RepoId'>;
export type SymbolId = Branded<string, 'SymbolId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;

export const RepoId = (id: string): RepoId => id as RepoId;
export const SymbolId = (id: string): SymbolId => id as SymbolId;
export const NodeId = (id: string): NodeId => id as NodeId;
export const EdgeId = (id: string): EdgeId => id as EdgeId;

// Graph data structures
export interface GraphNode {
  id: NodeId;
  label: string;
  type: 'function' | 'class' | 'variable' | 'module' | 'interface' | 'type';
  filePath: string;
  lineNumber: number;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency';
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    repoId: RepoId;
    timestamp: number;
    nodeCount: number;
    edgeCount: number;
  };
}

// Service Definition
export interface IGraphVisualizerService {
  getGraphData(repoId: RepoId): Promise<GraphData>;
  subscribeGraphUpdate(repoId: RepoId, callback: (data: GraphData) => void): () => void;
  searchSymbol(repoId: RepoId, query: string): Promise<GraphNode[]>;
  getSymbolDetails(symbolId: SymbolId): Promise<GraphNode | null>;
  exportGraph(repoId: RepoId, format: 'png' | 'svg' | 'json'): Promise<Blob>;
}

// Data source types
export type DataSourceType = 'codegraph' | 'lens';

export interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: DataSourceType;
  timestamp: number;
}