import { Context } from "@deepseek-ai/cordis";

//#region src/generated/version.d.ts
declare const PLUGIN_VERSION = "0.2.0";

//#endregion
//#region src/types/index.d.ts
//# sourceMappingURL=version.d.ts.map
type Branded<T, Brand> = T & {
  __brand: Brand;
};
type RepoId = Branded<string, 'RepoId'>;
type NodeId = Branded<string, 'NodeId'>;
type EdgeId = Branded<string, 'EdgeId'>;
declare const RepoId: (id: string) => RepoId;
declare const NodeId: (id: string) => NodeId;
declare const EdgeId: (id: string) => EdgeId;
interface GraphNode {
  id: NodeId;
  label: string;
  type: 'function' | 'class' | 'variable' | 'module' | 'interface' | 'type';
  filePath: string;
  lineNumber: number;
  properties: Record<string, unknown>;
  parentId?: NodeId;
}
interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency';
  properties: Record<string, unknown>;
}
type DataSourceType = 'auto' | 'codegraph' | 'lens' | 'tree-sitter';
interface GraphUpdatedEvent {
  repoId: RepoId;
  nodeCount: number;
  edgeCount: number;
  timestamp: number;
}
interface GraphDataEvent {
  repoId: RepoId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  timestamp: number;
}
interface RepoImportedEvent {
  repoId: RepoId;
  path: string;
  timestamp: number;
}
interface RepoScannedEvent {
  repoId: RepoId;
  fileCount: number;
  timestamp: number;
}
interface RepoRequestScanEvent {
  path: string;
  timestamp: number;
}
interface SourceOpenEvent {
  filePath: string;
  lineNumber: number;
}
interface PrerequisiteStatusEvent {
  codegraph: boolean;
  lens: boolean;
  timestamp: number;
}
interface GraphInitEvent {
  path: string;
  timestamp: number;
}
interface GraphInitResultEvent {
  success: boolean;
  path: string;
  message: string;
  timestamp: number;
}
interface WatchToggleEvent {
  enabled: boolean;
  path: string;
  timestamp: number;
}
interface HealthScoreEvent {
  repoId: RepoId;
  score: HealthScore;
  timestamp: number;
}
interface RuleViolationEvent {
  violations: RuleViolation[];
  timestamp: number;
}
interface PathFoundEvent {
  path: PathResult;
  timestamp: number;
}
interface FocusChangedEvent {
  nodeId: NodeId | null;
  depth: number;
  timestamp: number;
}
interface HealthScore {
  coupling: number;
  cohesion: number;
  cyclicDependencyRate: number;
  modularity: number;
  overall: number;
}
interface RuleViolation {
  ruleId: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  message: string;
  severity: 'error' | 'warning';
}
interface PathResult {
  source: NodeId;
  target: NodeId;
  path: NodeId[];
  length: number;
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    'codegraph/repo/imported'(event: RepoImportedEvent): void;
    'codegraph/repo/scanned'(event: RepoScannedEvent): void;
    'codegraph/repo/request-scan'(event: RepoRequestScanEvent): void;
    'codegraph/graph/updated'(event: GraphUpdatedEvent): void;
    'codegraph/graph/data'(event: GraphDataEvent): void;
    'codegraph/source/open'(event: SourceOpenEvent): void;
    'codegraph/prerequisite/status'(event: PrerequisiteStatusEvent): void;
    'codegraph/prerequisite/request'(event: {
      timestamp: number;
    }): void;
    'codegraph/graph/init'(event: GraphInitEvent): void;
    'codegraph/graph/init-result'(event: GraphInitResultEvent): void;
    'codegraph/watch/toggle'(event: WatchToggleEvent): void;
    'codegraph/health/scored'(event: HealthScoreEvent): void;
    'codegraph/rules/violation'(event: RuleViolationEvent): void;
    'codegraph/path/found'(event: PathFoundEvent): void;
    'codegraph/focus/changed'(event: FocusChangedEvent): void;
  }
  interface Context {
    webServer: WebServerService;
    effect(execute: () => (() => void) | void, label?: string): () => void;
    emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void;
    on<K extends keyof Events>(name: K, listener: Events[K]): () => boolean;
    get(name: string, strict?: boolean): unknown;
    provide(name: string, service: unknown): () => void;
    slots: {
      inject(slotName: string, callback: () => void): void;
      register(options: {
        name: string;
        id: string;
        order?: number;
        label?: () => string;
      }, component?: unknown): (() => void) | void;
    };
    betterSidebar?: {
      registerTab(descriptor: {
        id: string;
        title: string | (() => string);
        icon?: unknown;
        order?: number;
        single?: boolean;
        component: (props: {
          visible: boolean;
        }) => unknown;
      }): () => void;
      openTab(seed: {
        type: string;
      }): void;
    };
    spotlight?: {
      registerCommand(cmd: {
        id: string;
        title: string;
        handler: () => void;
      }): (() => void) | void;
    };
    workspaceRegistry?: {
      list?(): Array<{
        path?: string;
      }>;
    };
  }
}
interface WebServerRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
interface WebServerService {
  register(route: WebServerRoute): () => void;
  registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): () => void;
}
interface IncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  destroy(): void;
}
interface ServerResponse {
  writeHead(code: number, headers?: Record<string, string>): void;
  end(data?: string): void;
} //#endregion
//#region src/host/config.d.ts

//# sourceMappingURL=index.d.ts.map
interface VisualizerConfig {
  dataSource: DataSourceType;
  requestTimeout: number;
  scanCacheTtl: number;
  scanCacheLimit: number;
  maxBodyBytes: number;
  prerequisiteRetryDelay: number;
  watchDebounce: number;
  maxNodes: number;
  allowedOrigins: string[];
  panelMinHeight: number;
  panelDefaultHeight: number;
}
declare const DEFAULT_CONFIG: VisualizerConfig;
declare function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig;

//#endregion
//#region src/host/security.d.ts
//# sourceMappingURL=config.d.ts.map
declare function setAllowedWorkspaceRoots(roots: string[]): void;
declare function isPathAllowed(path: string): boolean;

//#endregion
//#region src/index.d.ts
declare const name = "dsh-codegraph-visualizer";
declare const inject: string[];
declare function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>): () => void;

//#endregion
//# sourceMappingURL=index.d.ts.map

export { DEFAULT_CONFIG, PLUGIN_VERSION, VisualizerConfig, apply, inject, isPathAllowed, name, resolveConfig, setAllowedWorkspaceRoots };
//# sourceMappingURL=index.d.ts.map