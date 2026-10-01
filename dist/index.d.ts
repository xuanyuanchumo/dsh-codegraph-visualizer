import { Context as Context$1 } from "@deepseek-ai/cordis";

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
  lineNumber?: number;
  properties: Record<string, unknown>;
  parentId?: NodeId;
  summary?: string;
  tags?: string[];
  complexity?: 'simple' | 'moderate' | 'complex';
  layer?: string;
}
type EdgeDirection = 'forward' | 'backward' | 'bidirectional';
interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency' | 'contains' | 'association' | 'aggregation' | 'composition';
  direction?: EdgeDirection;
  weight?: number;
  properties: Record<string, unknown>;
}
type DataSourceType = 'auto' | 'codegraph' | 'lens' | 'tree-sitter' | 'dependency';
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
  builtin: boolean;
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
  errorCode?: string;
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
    /**
     * @mode serial
     * @param event Repository imported into the workspace
     */
    'codegraph-visualizer/repo/imported'(event: RepoImportedEvent): void;
    /**
     * @mode serial
     * @param event Repository scan completed with file count
     */
    'codegraph-visualizer/repo/scanned'(event: RepoScannedEvent): void;
    /**
     * @mode serial
     * @param event Request to scan a repository at the given path
     */
    'codegraph-visualizer/repo/request-scan'(event: RepoRequestScanEvent): void;
    /**
     * @mode serial
     * @param event Graph updated with new node/edge counts
     */
    'codegraph-visualizer/graph/updated'(event: GraphUpdatedEvent): void;
    /**
     * @mode serial
     * @param event Full graph data payload for rendering
     */
    'codegraph-visualizer/graph/data'(event: GraphDataEvent): void;
    /**
     * @mode serial
     * @param event Request to open a source file at a specific line
     */
    'codegraph-visualizer/source/open'(event: SourceOpenEvent): void;
    /**
     * @mode serial
     * @param event Prerequisite service availability status changed
     */
    'codegraph-visualizer/prerequisite/status'(event: PrerequisiteStatusEvent): void;
    /**
     * @mode serial
     * @param event Request prerequisite status check
     */
    'codegraph-visualizer/prerequisite/request'(event: {
      timestamp: number;
    }): void;
    /**
     * @mode serial
     * @param event Request to initialize graph for a repository path
     */
    'codegraph-visualizer/graph/init'(event: GraphInitEvent): void;
    /**
     * @mode serial
     * @param event Graph initialization result (success/failure)
     */
    'codegraph-visualizer/graph/init-result'(event: GraphInitResultEvent): void;
    /**
     * @mode serial
     * @param event File watcher toggle state changed
     */
    'codegraph-visualizer/watch/toggle'(event: WatchToggleEvent): void;
    /**
     * @mode serial
     * @param event File watcher error occurred
     */
    'codegraph-visualizer/watch/error'(event: {
      path: string;
      message: string;
      errorCode?: string;
      timestamp: number;
    }): void;
    /**
     * @mode serial
     * @param event Architecture health score calculated
     */
    'codegraph-visualizer/health/scored'(event: HealthScoreEvent): void;
    /**
     * @mode serial
     * @param event Architecture rule violation detected
     */
    'codegraph-visualizer/rules/violation'(event: RuleViolationEvent): void;
    /**
     * @mode serial
     * @param event Shortest path found between two symbols
     */
    'codegraph-visualizer/path/found'(event: PathFoundEvent): void;
    /**
     * @mode serial
     * @param event Focus changed to a different node (or null to clear)
     */
    'codegraph-visualizer/focus/changed'(event: FocusChangedEvent): void;
  }
  interface Context {
    webServer: WebServerService;
    effect(execute: () => (() => void) | void, label?: string): () => void;
    emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void;
    on<K extends keyof Events>(name: K, listener: Events[K]): () => boolean;
    get(name: string, strict?: boolean): unknown;
    provide(name: string, service: unknown): () => void;
    inject(deps: string[], callback: (injected: Map<string, unknown>) => void): (() => void) | void;
    slots: {
      inject(slotName: string, callback: () => void): (() => void) | void;
      register(options: {
        name: string;
        id?: string;
        key?: string;
        order?: number;
        label?: () => string;
        inject?: (...args: unknown[]) => unknown;
      }, component?: unknown): (() => void) | void;
    };
    betterSidebar?: {
      version: string;
      features: string[];
      registerTab(descriptor: {
        id: string;
        title: string | (() => string);
        description?: string | (() => string);
        icon?: unknown;
        order?: number;
        single?: boolean;
        hidden?: boolean;
        badge?: () => string | number | null | undefined;
        onOpen?: (tab: unknown, scope: unknown) => void;
        onActivate?: (tab: unknown, scope: unknown) => void;
        onClose?: (tab: unknown, scope: unknown) => void;
        component: (props: {
          ctx: Context;
          store: unknown;
          scope: unknown;
          tab: {
            id: string;
            title: string;
            path?: string;
          };
          visible: boolean;
          expanded?: string[];
          revealed?: string[];
        }) => unknown;
      }): (() => void) | void;
      openTab(seed: {
        type: string;
        title?: string;
        path?: string;
        target?: 'right' | 'bottom';
      }): void;
      closeTab(tabId: string, scope?: unknown): void;
      activateTab(tabId: string, scope?: unknown): void;
      updateTab(tabId: string, patch: {
        title?: string;
        path?: string;
        meta?: unknown;
      }): void;
      subscribe(listener: () => void): () => void;
      subscribeState(listener: () => void): () => void;
      getSnapshot(): {
        sessionId: string | undefined;
        state: {
          activePane: string | null;
          bottomOpen: boolean;
          bottomHeight: number;
          expanded: string[];
          revealed: string[];
        } | undefined;
        prefs: unknown;
      };
    };
    spotlight?: {
      registerCommand(cmd: {
        id: string;
        title: string;
        handler: () => void;
      }): (() => void) | void;
    };
    sidebarRightTabs?: {
      register(definition: {
        id: string;
        kind: string;
        patterns?: string[];
        priority?: 'extension' | 'builtin' | 'fallback';
        canOpen?: (address: string) => boolean;
        title?: (address: string) => string;
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
  socket?: {
    remoteAddress?: string;
  };
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'close', handler: () => void): void;
  destroy(): void;
}
interface ServerResponse {
  writeHead(code: number, headers?: Record<string, string>): void;
  write(data: string): boolean;
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
declare class SecurityManager {
  private allowedWorkspaceRoots;
  setAllowedWorkspaceRoots(roots: string[]): void;
  isPathAllowed(path: string): boolean;
  reset(): void;
}
declare function createSecurityManager(): SecurityManager;

//#endregion
//#region src/index.d.ts
//# sourceMappingURL=security.d.ts.map
declare const name = "dsh-codegraph-visualizer";
declare const inject: string[];
declare function apply(ctx: Context$1, userConfig?: Partial<VisualizerConfig>): Promise<void>;

//#endregion
//# sourceMappingURL=index.d.ts.map

export { DEFAULT_CONFIG, PLUGIN_VERSION, SecurityManager, VisualizerConfig, apply, createSecurityManager, inject, name, resolveConfig };
//# sourceMappingURL=index.d.ts.map