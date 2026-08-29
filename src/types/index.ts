// Branded types and graph data structures shared across the Host/Client boundary.
// Graph heat-update events are declared here via Cordis declaration merging.

export type Branded<T, Brand> = T & { __brand: Brand };

export type RepoId = Branded<string, 'RepoId'>;
export type SymbolId = Branded<string, 'SymbolId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;

export const RepoId = (id: string): RepoId => id as RepoId;
export const SymbolId = (id: string): SymbolId => id as SymbolId;
export const NodeId = (id: string): NodeId => id as NodeId;
export const EdgeId = (id: string): EdgeId => id as EdgeId;

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

export type DataSourceType = 'codegraph' | 'lens';

export interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: DataSourceType;
  timestamp: number;
}

// ---- Graph heat-update event payloads -------------------------------------

export interface GraphUpdatedEvent {
  repoId: string;
  nodeCount: number;
  edgeCount: number;
  timestamp: number;
}

export interface RepoImportedEvent {
  repoId: string;
  path: string;
  timestamp: number;
}

export interface RepoScannedEvent {
  repoId: string;
  fileCount: number;
  timestamp: number;
}

// ---- Cordis event declaration merging ------------------------------------
// These are emitted by the host plugin; Client/host listeners subscribe via
// `ctx.on(...)`. Keep them writer-only so consumers never redefine the contract.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'codegraph/repo/imported'(event: RepoImportedEvent): void;
    'codegraph/repo/scanned'(event: RepoScannedEvent): void;
    'codegraph/graph/updated'(event: GraphUpdatedEvent): void;
  }
}