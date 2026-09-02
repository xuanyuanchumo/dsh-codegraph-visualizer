export type Branded<T, Brand> = T & {
    __brand: Brand;
};
export type RepoId = Branded<string, 'RepoId'>;
export type SymbolId = Branded<string, 'SymbolId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;
export declare const RepoId: (id: string) => RepoId;
export declare const SymbolId: (id: string) => SymbolId;
export declare const NodeId: (id: string) => NodeId;
export declare const EdgeId: (id: string) => EdgeId;
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
export interface WebServerRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface WebServerService {
    register(route: WebServerRoute): () => void;
    registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void;
}
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
interface ModuleLoader {
    load(registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }): void;
}
declare const __ModuleLoader__: ModuleLoader | undefined;
//# sourceMappingURL=index.d.ts.map
