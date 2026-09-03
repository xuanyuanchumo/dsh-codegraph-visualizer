// DSH codegraph visualizer plugin — host entry point.
// Compliant bundle plugin shape: `name` + `inject` + `apply(ctx)`.
import { spawnSync } from 'node:child_process';
import type { Context } from '@deepseek-ai/cordis';
import { watch } from 'node:fs';
import { normalize, isAbsolute } from 'node:path';
import { createGraphTools, fetchMergedGraph } from './tools.ts';
import { CallId } from '@deepseek-ai/dsh-llm';
import { scoped } from './shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse } from './types/index.ts';
import { PLUGIN_VERSION } from './generated/version.ts';

export { PLUGIN_VERSION };

const log = scoped('host');

interface ContextWithSessions {
  sessions?: { list?: () => Array<{ header?: { cwd?: string } }> };
  workspaceRegistry?: { list?: () => Array<{ path?: string }> };
}

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools', 'webServer', 'sessions', 'workspaceRegistry'];

// ── Plugin config (red line 9: explicit config, misconfiguration fails loud) ──
// Deployment-varying tunables are validated fields, changeable from
// cordis.yml via the bundle patch. Protocol/security invariants stay fixed.

export interface VisualizerConfig {
  /** Preferred data source for tool-side merges. */
  dataSource: 'auto' | 'codegraph' | 'lens';
  /** Upstream tool call timeout in ms. */
  requestTimeout: number;
  /** Scan result cache TTL in ms. */
  scanCacheTtl: number;
  /** Maximum scan-cache entries (bounded memory). */
  scanCacheLimit: number;
  /** HTTP request body limit in bytes. */
  maxBodyBytes: number;
  /** Delay before re-checking prerequisites, in ms. */
  prerequisiteRetryDelay: number;
  /** File-watcher debounce window in ms. */
  watchDebounce: number;
  /** Default maxNodes cap for scans. */
  maxNodes: number;
}

export const DEFAULT_CONFIG: VisualizerConfig = {
  dataSource: 'auto',
  requestTimeout: 5000,
  scanCacheTtl: 30_000,
  scanCacheLimit: 4,
  maxBodyBytes: 1024 * 1024,
  prerequisiteRetryDelay: 3000,
  watchDebounce: 500,
  maxNodes: 10_000,
};

/** Merge user config over defaults and reject invalid values at load time. */
export function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig {
  const config: VisualizerConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const errors: string[] = [];
  if (config.dataSource !== 'auto' && config.dataSource !== 'codegraph' && config.dataSource !== 'lens') {
    errors.push(`dataSource must be auto|codegraph|lens, got ${String(config.dataSource)}`);
  }
  const positiveFields: Array<[keyof VisualizerConfig, number]> = [
    ['requestTimeout', config.requestTimeout],
    ['scanCacheTtl', config.scanCacheTtl],
    ['scanCacheLimit', config.scanCacheLimit],
    ['maxBodyBytes', config.maxBodyBytes],
    ['prerequisiteRetryDelay', config.prerequisiteRetryDelay],
    ['watchDebounce', config.watchDebounce],
    ['maxNodes', config.maxNodes],
  ];
  for (const [field, value] of positiveFields) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${field} must be a positive finite number, got ${String(value)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`[dsh-codegraph-visualizer] invalid config: ${errors.join('; ')}`);
  }
  return config;
}

let allowedWorkspaceRoots: string[] = [];

export function isPathAllowed(path: string): boolean {
  if (!path || path === '.') return true;
  const normalized = normalize(path);
  if (!isAbsolute(normalized)) return false;
  if (normalized.includes('..')) return false;
  if (allowedWorkspaceRoots.length === 0) return true;
  return allowedWorkspaceRoots.some((root) => normalized === root || normalized.startsWith(root + '\\') || normalized.startsWith(root + '/'));
}

// Debounced file watcher for hot-update (host-side fs.watch).
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let activeWatcher: { close: () => void } | null = null;

/** Detect the codegraph CLI on PATH (cheap, cached per apply). */
function detectCodegraphCli(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000, shell: process.platform === 'win32' });
    return r.status === 0;
  } catch (e) {
    log.warn('detectCodegraphCli failed', e);
    return false;
  }
}

function checkPrerequisites(ctx: Context): { codegraph: boolean; lens: boolean } {
  try {
    // dsh-codegraph registers codegraph_status (core surface); older builds
    // exposed codegraph_graph — accept either. The CLI alone is enough for
    // the SQLite direct-read path, so it also satisfies the prerequisite.
    const cg = ctx.tools.get('codegraph_status') ?? ctx.tools.get('codegraph_graph') ?? ctx.tools.get('codegraph_query');
    const lens = ctx.tools.get('lens_analyze');
    return { codegraph: !!cg || detectCodegraphCli(), lens: !!lens };
  } catch (e) {
    log.warn('checkPrerequisites failed', e);
    return { codegraph: detectCodegraphCli(), lens: false };
  }
}

export function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>) {
  // Red line 9: explicit config — deployment-varying tunables are validated
  // Config fields, changeable from cordis.yml; misconfiguration fails loud.
  const config = resolveConfig(userConfig);
  const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx, { requestTimeout: config.requestTimeout });

  ctx.effect(() => {
    const d1 = ctx.tools.register(graphStatus);
    const d2 = ctx.tools.register(graphData);
    const d3 = ctx.tools.register(graphSymbol);
    const d4 = ctx.tools.register(graphImpact);
    return () => { d1(); d2(); d3(); d4(); };
  }, 'codegraph: tool registrations');

  // ── HTTP routes for Host-Client communication ──────────────────────
  // The client (browser) communicates with the Host via HTTP fetch()
  // calls to these routes, registered on the DSH webServer.
  // ctx.emit/ctx.on is local-only (same process) and cannot cross the
  // Host-Client boundary. The webServer service provides the only
  // reliable channel for Host-Client data exchange.

  let lastGraphData: GraphData | null = null;

  let lastInitResult: { success: boolean; path: string; message: string; timestamp: number } | null = null;
  let scanInFlight: Promise<GraphData> | null = null;
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();


  function slimGraphData(data: GraphData): GraphData {
    const slimNodes = data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      filePath: n.filePath,
      lineNumber: n.lineNumber,
      properties: n.properties?.exported === true ? { exported: true } : {},
    }));
    const slimEdges = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      properties: {},
    }));
    return {
      nodes: slimNodes as GraphNode[],
      edges: slimEdges as GraphEdge[],
      metadata: data.metadata,
    };
  }

  const invokeUpstream = async (tool: string, args: Record<string, unknown>): Promise<unknown | null> => {
    try {
      const result = await ctx.tools.execute({
        callId: CallId(`codegraph:${tool}`),
        name: tool,
        arguments: args,
        signal: AbortSignal.timeout(config.requestTimeout),
      });
      if (result.isError) return null;
      return result.value ?? null;
    } catch (e) {
      log.warn('invokeUpstream failed', { tool, error: e });
      return null;
    }
  };

  const sendJson = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const findWorkspacePath = (): string => {
    try {
      const wsr = (ctx as unknown as ContextWithSessions).workspaceRegistry;
      if (wsr?.list) {
        const workspaces = wsr.list();
        if (workspaces.length > 0 && workspaces[0]?.path) {
          return workspaces[0].path;
        }
      }
    } catch (e) { log.warn('findWorkspacePath: workspaceRegistry failed', e); }
    try {
      const sessions = (ctx as unknown as ContextWithSessions).sessions;
      if (sessions?.list) {
        const all = sessions.list();
        for (const session of all) {
          const cwd = session?.header?.cwd;
          if (cwd) return cwd;
        }
      }
    } catch (e) { log.warn('findWorkspacePath: sessions failed', e); }
    return process.cwd();
  };

  const listWorkspacePaths = (): string[] => {
    try {
      const wsr = (ctx as unknown as ContextWithSessions).workspaceRegistry;
      if (wsr?.list) {
        const workspaces = wsr.list();
        const paths = workspaces.map((w) => w.path).filter((p): p is string => !!p);
        if (paths.length > 0) return paths;
      }
    } catch (e) { log.warn('listWorkspacePaths: workspaceRegistry failed', e); }
    try {
      const sessions = (ctx as unknown as ContextWithSessions).sessions;
      if (sessions?.list) {
        const all = sessions.list();
        const seen = new Set<string>();
        const paths: string[] = [];
        for (const session of all) {
          const cwd = session?.header?.cwd;
          if (cwd && !seen.has(cwd)) {
            seen.add(cwd);
            paths.push(cwd);
          }
        }
        if (paths.length > 0) return paths;
      }
    } catch (e) { log.warn('listWorkspacePaths: sessions failed', e); }
    return [process.cwd()];
  };


  const MAX_BODY_BYTES = config.maxBodyBytes;

  const readBody = (req: IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
      let body = '';
      let totalBytes = 0;
      req.on('data', (chunk?: Buffer) => {
        if (!chunk) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          reject(new Error('Request body too large'));

          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  };

  const parseJsonBody = (body: string): Record<string, unknown> => {
    const parsed = JSON.parse(body || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid JSON body: expected object');
    }
    return parsed as Record<string, unknown>;
  };

  const extractStringField = (obj: Record<string, unknown>, field: string): string | undefined => {
    const v = obj[field];
    return typeof v === 'string' ? v : undefined;
  };

  const extractBooleanField = (obj: Record<string, unknown>, field: string): boolean | undefined => {
    const v = obj[field];
    return typeof v === 'boolean' ? v : undefined;
  };

  // GET /api/codegraph/status — prerequisite check
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/status',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens });
    },
  }), 'codegraph: status route');

  // GET /api/codegraph/workspace — get current DSH workspace + all workspace list
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/workspace',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      const current = findWorkspacePath();
      const list = listWorkspacePaths();
      sendJson(res, 200, { path: current, list });
    },
  }), 'codegraph: workspace route');

  // GET /api/codegraph/data — get cached graph data (supports incremental via If-None-Match)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/data',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && lastGraphData) {
        const clientTimestamp = parseInt(String(ifNoneMatch), 10);
        if (clientTimestamp >= lastGraphData.metadata.timestamp) {
          res.writeHead(304, { 'etag': String(lastGraphData.metadata.timestamp) });
          res.end();
          return;
        }
      }
      if (lastGraphData) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'etag': String(lastGraphData.metadata.timestamp),
        });
        res.end(JSON.stringify(lastGraphData));
      } else {
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
      }
    },
  }), 'codegraph: data route');


  // POST /api/codegraph/scan — trigger a workspace scan
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/scan',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
          return;
        }
        const scanPath = path && path !== '.' ? path : findWorkspacePath();

        const repoId = scanPath || `workspace-${Date.now()}`;

        const cached = scanCache.get(scanPath);
        if (cached && Date.now() - cached.timestamp < config.scanCacheTtl) {
          lastGraphData = cached.data;
          sendJson(res, 200, { success: true, ...cached.data });
          return;
        }

        if (scanInFlight) {
          const data = await scanInFlight;
          sendJson(res, 200, { success: true, ...data });
          return;
        }

        scanInFlight = fetchMergedGraph(invokeUpstream, repoId, 'both');
        try {
          const raw = await scanInFlight;
          scanInFlight = null;
          const data = slimGraphData(raw);
          lastGraphData = data;
          scanCache.set(scanPath, { data, timestamp: Date.now() });
          if (scanCache.size > config.scanCacheLimit) {
            const oldest = scanCache.keys().next().value;
            if (oldest !== undefined) scanCache.delete(oldest);
          }
          ctx.emit('codegraph/graph/updated', {
            repoId,
            nodeCount: data.metadata.nodeCount,
            edgeCount: data.metadata.edgeCount,
            timestamp: data.metadata.timestamp,
          });
          ctx.emit('codegraph/graph/data', {
            repoId,
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
          log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
          sendJson(res, 200, { success: true, ...data });
        } catch (e) {
          scanInFlight = null;
          throw e;
        }
      } catch (e) {
        log.error('scan failed', e);
        sendJson(res, 500, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
      }
    },
  }), 'codegraph: scan route');

  // POST /api/codegraph/init — initialize the graph
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/init',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, path: '', message: 'Path not allowed', timestamp: Date.now() });
          return;
        }
        const initPath = path && path !== '.' ? path : findWorkspacePath();
        log.info('init requested', { path: initPath });
        const result = await invokeUpstream('codegraph_init', { path: initPath, force: true });
        const success = result !== null;
        lastInitResult = {
          success,
          path: initPath,
          message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
          timestamp: Date.now(),
        };
        ctx.emit('codegraph/graph/init-result', lastInitResult);
        if (success) {
          const repoId = initPath || `workspace-${Date.now()}`;
          const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          lastGraphData = data;
          ctx.emit('codegraph/graph/data', {
            repoId,
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
        }
        sendJson(res, 200, lastInitResult);
      } catch (e) {
        const errorResult = {
          success: false,
          path: '',
          message: e instanceof Error ? e.message : String(e),
          timestamp: Date.now(),
        };
        lastInitResult = errorResult;
        sendJson(res, 500, errorResult);
      }
    },
  }), 'codegraph: init route');

  // POST /api/codegraph/watch — toggle file watching
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/watch',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, message: 'Path not allowed' });
          return;
        }
        const watchPath = path && path !== '.' ? path : findWorkspacePath();
        ctx.emit('codegraph/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 500, { success: false, message: e instanceof Error ? e.message : String(e) });
      }
    },
  }), 'codegraph: watch route');

  // ── Prerequisite check ─────────────────────────────────────────────
  // Detect whether dsh-codegraph (codegraph_graph) or dsh-tool-lens
  // (lens_analyze) are registered. Emit status so the client can show
  // a guidance banner when data sources are missing.
  const emitPrereqStatus = () => {
    const status = checkPrerequisites(ctx);
    ctx.emit('codegraph/prerequisite/status', {
      codegraph: status.codegraph,
      lens: status.lens,
      timestamp: Date.now(),
    });
    log.info('prerequisite status', status);
  };
  emitPrereqStatus();
  // Re-check after a delay — upstream plugins may register later.
  const prereqTimer = setTimeout(emitPrereqStatus, config.prerequisiteRetryDelay);
  ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

  // Client can request a re-check (e.g. after installing a prerequisite plugin).
  ctx.effect(() => ctx.on('codegraph/prerequisite/request', () => {
    emitPrereqStatus();
  }), 'codegraph: prerequisite request listener');

  // ── Heat-update (push) ─────────────────────────────────────────────
  ctx.effect(() => ctx.on('codegraph/repo/imported', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo imported listener');

  ctx.effect(() => ctx.on('codegraph/repo/scanned', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  }), 'codegraph: repo scanned listener');

  // ── Auto-import: scan workspace on request ─────────────────────────

  const scanAndPush = async (path: string) => {
    log.info('scan requested', { path });
    try {
      const repoId = path || `workspace-${Date.now()}`;
      const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
      ctx.emit('codegraph/graph/updated', {
        repoId,
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        timestamp: data.metadata.timestamp,
      });
      ctx.emit('codegraph/graph/data', {
        repoId,
        nodes: data.nodes,
        edges: data.edges,
        timestamp: data.metadata.timestamp,
      });
      log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
    } catch (e) {
      log.error('scan failed', e);
    }
  };

  ctx.effect(() => ctx.on('codegraph/repo/request-scan', async (event) => {
    await scanAndPush(event.path);
  }), 'codegraph: repo request-scan listener');

  // ── Graph initialization ──────────────────────────────────────────
  // Trigger upstream codegraph_init (dsh-codegraph surface) to generate the
  // .codegraph DB; then scan and push the fresh graph to the client.
  ctx.effect(() => ctx.on('codegraph/graph/init', async (event) => {
    log.info('init requested', { path: event.path });
    try {
      const result = await invokeUpstream('codegraph_init', { path: event.path, force: true });
      const success = result !== null;
      ctx.emit('codegraph/graph/init-result', {
        success,
        path: event.path,
        message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
        timestamp: Date.now(),
      });
      if (success) {
        await scanAndPush(event.path);
      }
    } catch (e) {
      ctx.emit('codegraph/graph/init-result', {
        success: false,
        path: event.path,
        message: e instanceof Error ? e.message : String(e),
        timestamp: Date.now(),
      });
    }
  }), 'codegraph: graph init listener');

  // ── File watcher for hot-update ────────────────────────────────────
  // One fiber-level effect owns the toggle listener AND the active watcher,
  // so switching watch on/off never accumulates effect entries and plugin
  // unload always closes the live watcher (red line 1: register-as-effect).
  const closeActiveWatcher = (): void => {
    if (activeWatcher) {
      try { activeWatcher.close(); } catch { /* best-effort */ }
      activeWatcher = null;
    }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  };
  ctx.effect(() => {
    const dispose = ctx.on('codegraph/watch/toggle', (event) => {
      closeActiveWatcher();

      if (!event.enabled) {
        log.info('watch disabled');
        return;
      }

      log.info('watch enabled', { path: event.path });
      try {
        activeWatcher = watch(event.path, { recursive: true }, (_eventType: string, filename: string | null) => {
          // Ignore .codegraph internal changes to avoid feedback loops
          if (filename && filename.includes('.codegraph')) return;
          if (filename && filename.includes('node_modules')) return;
          if (filename && filename.includes('.git')) return;

          // Debounce — batch rapid file saves into one re-scan
          if (watchTimer) clearTimeout(watchTimer);
          watchTimer = setTimeout(() => {
            watchTimer = null;
            log.info('file changed, syncing + re-scanning', { filename });
            // Sync the upstream index first so the fresh read reflects the change.
            invokeUpstream('codegraph_sync', { path: event.path })
              .then(() => scanAndPush(event.path))
              .catch((e) => log.error('watch re-scan failed', e));
          }, config.watchDebounce);
        });
      } catch (e) {
        log.error('watch setup failed', e);
      }
    });
    return () => {
      dispose();
      closeActiveWatcher();
    };
  }, 'codegraph: watch toggle listener');
}
