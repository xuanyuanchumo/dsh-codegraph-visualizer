// Branded types and graph data structures shared across the Host/Client boundary.
// Graph heat-update events are declared here via Cordis declaration merging.

export type Branded<T, Brand> = T & { __brand: Brand };

export type RepoId = Branded<string, 'RepoId'>;
export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;

export const RepoId = (id: string): RepoId => id as RepoId;
export const NodeId = (id: string): NodeId => id as NodeId;
export const EdgeId = (id: string): EdgeId => id as EdgeId;

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

export interface GraphNode {
  id: NodeId;
  label: string;
  type: 'function' | 'class' | 'variable' | 'module' | 'interface' | 'type';
  filePath: string;
  lineNumber?: number;
  properties: Record<string, unknown>;
  parentId?: NodeId;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency' | 'contains' | 'association' | 'aggregation' | 'composition';
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

export type DataSourceType = 'auto' | 'codegraph' | 'lens' | 'tree-sitter';

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
    'codegraph-visualizer/repo/imported'(event: RepoImportedEvent): void;
    'codegraph-visualizer/repo/scanned'(event: RepoScannedEvent): void;
    'codegraph-visualizer/repo/request-scan'(event: RepoRequestScanEvent): void;
    'codegraph-visualizer/graph/updated'(event: GraphUpdatedEvent): void;
    'codegraph-visualizer/graph/data'(event: GraphDataEvent): void;
    'codegraph-visualizer/source/open'(event: SourceOpenEvent): void;
    'codegraph-visualizer/prerequisite/status'(event: PrerequisiteStatusEvent): void;
    'codegraph-visualizer/prerequisite/request'(event: { timestamp: number }): void;
    'codegraph-visualizer/graph/init'(event: GraphInitEvent): void;
    'codegraph-visualizer/graph/init-result'(event: GraphInitResultEvent): void;
    'codegraph-visualizer/watch/toggle'(event: WatchToggleEvent): void;
    'codegraph-visualizer/watch/error'(event: { path: string; message: string; timestamp: number }): void;
    'codegraph-visualizer/health/scored'(event: HealthScoreEvent): void;
    'codegraph-visualizer/rules/violation'(event: RuleViolationEvent): void;
    'codegraph-visualizer/path/found'(event: PathFoundEvent): void;
    'codegraph-visualizer/focus/changed'(event: FocusChangedEvent): void;
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
      register(options: { name: string; id: string; order?: number; label?: () => string }, component?: unknown): (() => void) | void;
    };
    betterSidebar?: {
      registerTab(descriptor: {
        id: string;
        title: string | (() => string);
        icon?: unknown;
        order?: number;
        single?: boolean;
        component: (props: { visible: boolean }) => unknown;
      }): () => void;
      openTab(seed: { type: string }): void;
    };
    spotlight?: {
      registerCommand(cmd: { id: string; title: string; handler: () => void }): (() => void) | void;
    };

    workspaceRegistry?: {
      list?(): Array<{ path?: string }>;
    };
  }
}

// ---- DSH WebServer service (Host-side HTTP route registration) -----------

export interface IGraphVisualizerService {
  getCurrentGraph(): GraphData | null;
  getGraphData(repoId: string): Promise<GraphData | null>;
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
  destroy(): void;
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