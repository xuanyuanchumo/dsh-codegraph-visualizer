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
    truncated?: boolean;
    totalNodeCount?: number;
    totalEdgeCount?: number;
  };
}

export type DataSourceType = 'codegraph' | 'lens';

export interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: DataSourceType;
  timestamp: number;
  error?: string;
}

// ---- Graph heat-update event payloads -------------------------------------

export interface GraphUpdatedEvent {
  repoId: string;
  nodeCount: number;
  edgeCount: number;
  timestamp: number;
}

export interface GraphDataEvent {
  repoId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
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

export interface RepoRequestScanEvent {
  path: string;
  timestamp: number;
}

export interface SourceOpenEvent {
  filePath: string;
  lineNumber: number;
}

export interface PrerequisiteStatusEvent {
  codegraph: boolean;
  lens: boolean;
  timestamp: number;
}

export interface GraphInitEvent {
  path: string;
  timestamp: number;
}

export interface GraphInitResultEvent {
  success: boolean;
  path: string;
  message: string;
  timestamp: number;
}

export interface WatchToggleEvent {
  enabled: boolean;
  path: string;
  timestamp: number;
}

// ---- Cordis event declaration merging ------------------------------------
// These are emitted by the host plugin; Client/host listeners subscribe via
// `ctx.on(...)`. Keep them writer-only so consumers never redefine the contract.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'codegraph/repo/imported'(event: RepoImportedEvent): void;
    'codegraph/repo/scanned'(event: RepoScannedEvent): void;
    'codegraph/repo/request-scan'(event: RepoRequestScanEvent): void;
    'codegraph/graph/updated'(event: GraphUpdatedEvent): void;
    'codegraph/graph/data'(event: GraphDataEvent): void;
    'codegraph/source/open'(event: SourceOpenEvent): void;
    'codegraph/prerequisite/status'(event: PrerequisiteStatusEvent): void;
    'codegraph/prerequisite/request'(event: { timestamp: number }): void;
    'codegraph/graph/init'(event: GraphInitEvent): void;
    'codegraph/graph/init-result'(event: GraphInitResultEvent): void;
    'codegraph/watch/toggle'(event: WatchToggleEvent): void;
  }
  interface Context {
    webServer: WebServerService;
    effect(execute: () => (() => void) | void, label?: string): () => void;
    emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void;
    on<K extends keyof Events>(name: K, listener: Events[K]): () => boolean;
    get(name: string, strict?: boolean): unknown;
  }
}

// ---- DSH WebServer service (Host-side HTTP route registration) -----------
export interface WebServerRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface WebServerService {
  register(route: WebServerRoute): () => void;
  registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void;
}

// Minimal Node.js HTTP types (avoid pulling in @types/node for client builds)
export interface IncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
}

export interface ServerResponse {
  writeHead(code: number, headers?: Record<string, string>): void;
  end(data?: string): void;
}

// ---- DSH Module Loader (runtime global) ----------------------------------
// Injected by the DSH web app boot script. Client bundles register themselves
// via __ModuleLoader__.load({ id, factory }) so the shell can wire them into
// the page (slots, overlays, etc.). The factory receives a `require` function
// for resolving platform externals (react, react-dom, cordis, etc.).
interface ModuleLoader {
  load(registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }): void;
}

declare const __ModuleLoader__: ModuleLoader | undefined;