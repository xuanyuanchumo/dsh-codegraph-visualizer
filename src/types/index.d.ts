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
export interface IGraphVisualizerService {
    getGraphData(repoId: RepoId): Promise<GraphData>;
    subscribeGraphUpdate(repoId: RepoId, callback: (data: GraphData) => void): () => void;
    searchSymbol(repoId: RepoId, query: string): Promise<GraphNode[]>;
    getSymbolDetails(symbolId: SymbolId): Promise<GraphNode | null>;
    exportGraph(repoId: RepoId, format: 'png' | 'svg' | 'json'): Promise<Blob>;
}
export type DataSourceType = 'codegraph' | 'lens';
export interface AdapterResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    source: DataSourceType;
    timestamp: number;
}
//# sourceMappingURL=index.d.ts.map