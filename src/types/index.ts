// Branded types and graph data structures shared across the Host/Client boundary.
// Graph heat-update events are declared here via Cordis declaration merging.

export type Branded<T, Brand> = T & { __brand: Brand };

export type RepoId = Branded<string, 'RepoId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;

export const RepoId = (id: string): RepoId => {
  if (!id || id.length === 0) throw new Error('RepoId: id must not be empty');
  return id as RepoId;
};
export const NodeId = (id: string): NodeId => {
  if (!id || id.length === 0) throw new Error('NodeId: id must not be empty');
  return id as NodeId;
};
export const EdgeId = (id: string): EdgeId => {
  if (!id || id.length === 0) throw new Error('EdgeId: id must not be empty');
  return id as EdgeId;
};

const NODE_TYPES = ['function', 'class', 'variable', 'module', 'interface', 'type'] as const;

export function isNodeType(value: unknown): value is GraphNode['type'] {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

export function safeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export type HeatmapMode = 'none' | 'instability' | 'lines' | 'complexity';
export type TodoMarkerMode = 'none' | 'todo' | 'fixme' | 'all';

export interface GraphNode {
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

export type EdgeDirection = 'forward' | 'backward' | 'bidirectional';

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency' | 'contains' | 'association' | 'aggregation' | 'composition';
  direction?: EdgeDirection;
  weight?: number;
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
  layers?: Layer[];
}

export interface Layer {
  id: string;
  name: string;
  description?: string;
  nodeIds: NodeId[];
  color?: string;
}

export type ViewMode = 'code' | 'dependencies' | 'inheritance' | 'callgraph' | 'package' | 'class' | 'cfg' | 'flowchart' | 'sequence';


export interface InheritanceNodeProperties {
  depth: number;
  isRoot: boolean;
  parentCount: number;
  childCount: number;
  descendantCount: number;
  isAbstract: boolean;
}

export interface CallGraphNodeProperties {
  depth: number;
  isEntry: boolean;
  entryType: 'export' | 'handler' | 'event' | 'cli' | 'test' | 'none';
  inDegree: number;
  outDegree: number;
  isRecursive: boolean;
}

export type DataSourceType = 'auto' | 'codegraph' | 'lens' | 'tree-sitter' | 'dependency';

export interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: DataSourceType;
  timestamp: number;
  error?: string;
}

// ---- Graph heat-update event payloads -------------------------------------

export interface GraphUpdatedEvent {
  repoId: RepoId;
  nodeCount: number;
  edgeCount: number;
  timestamp: number;
}

export interface GraphDataEvent {
  repoId: RepoId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  timestamp: number;
}

export interface RepoImportedEvent {
  repoId: RepoId;
  path: string;
  timestamp: number;
}

export interface RepoScannedEvent {
  repoId: RepoId;
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
  builtin: boolean;
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
  errorCode?: string;
  timestamp: number;
}

export interface WatchToggleEvent {
  enabled: boolean;
  path: string;
  timestamp: number;
}

export interface HealthScoreEvent {
  repoId: RepoId;
  score: HealthScore;
  timestamp: number;
}

export interface RuleViolationEvent {
  violations: RuleViolation[];
  timestamp: number;
}

export interface PathFoundEvent {
  path: PathResult;
  timestamp: number;
}

export interface FocusChangedEvent {
  nodeId: NodeId | null;
  depth: number;
  timestamp: number;
}

export interface HealthScore {
  coupling: number;
  cohesion: number;
  cyclicDependencyRate: number;
  modularity: number;
  overall: number;
}

export type RuleType = 'forbidden-edge' | 'required-edge' | 'max-indegree' | 'max-outdegree' | 'cross-layer-call';

export interface RuleDefinition {
  id: string;
  name: string;
  type: RuleType;
  params: Record<string, unknown>;
  severity: 'error' | 'warning';
  enabled: boolean;
}

export interface RuleViolation {
  ruleId: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  message: string;
  severity: 'error' | 'warning';
}

export interface PathResult {
  source: NodeId;
  target: NodeId;
  path: NodeId[];
  length: number;
}

// ---- Cordis event declaration merging ------------------------------------
// These are emitted by the host plugin; Client/host listeners subscribe via
// `ctx.on(...)`. Keep them writer-only so consumers never redefine the contract.
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
    'codegraph-visualizer/prerequisite/request'(event: { timestamp: number }): void;
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
    'codegraph-visualizer/watch/error'(event: { path: string; message: string; errorCode?: string; timestamp: number }): void;
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
      register(options: { name: string; id?: string; key?: string; order?: number; label?: () => string; inject?: (...args: unknown[]) => unknown }, component?: unknown): (() => void) | void;
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
          tab: { id: string; title: string; path?: string };
          visible: boolean;
          expanded?: string[];
          revealed?: string[];
        }) => unknown;
      }): (() => void) | void;
      openTab(seed: { type: string; title?: string; path?: string; target?: 'right' | 'bottom' }): void;
      closeTab(tabId: string, scope?: unknown): void;
      activateTab(tabId: string, scope?: unknown): void;
      updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void;
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
      registerCommand(cmd: { id: string; title: string; handler: () => void }): (() => void) | void;
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
      list?(): Array<{ path?: string }>;
    };
  }
}

// ---- DSH WebServer service (Host-side HTTP route registration) -----------

export interface IGraphVisualizerService {
  getCurrentGraph(): GraphData | null;
  getGraphData(repoId: RepoId): Promise<GraphData | null>;
  getSymbolDetail(symbolId: string): Promise<Record<string, unknown> | null>;
  getImpactAnalysis(symbolId: string): Promise<{ affected: string[]; depth: number } | null>;
  onGraphUpdate(callback: (data: GraphData) => void): () => void;
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

// Minimal Node.js HTTP types (avoid pulling in @types/node for client builds)
export interface IncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'close', handler: () => void): void;
  destroy(): void;
}

export interface ServerResponse {
  writeHead(code: number, headers?: Record<string, string>): void;
  write(data: string): boolean;
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