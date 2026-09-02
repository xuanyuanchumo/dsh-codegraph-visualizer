// DSH codegraph visualizer plugin — host entry point.
// Compliant bundle plugin shape: `name` + `inject` + `apply(ctx)`.
import { spawnSync } from 'node:child_process';
import type { Context } from '@deepseek-ai/cordis';
import { watch } from 'node:fs';
import { resolve, normalize, isAbsolute } from 'node:path';
import { createGraphTools, fetchMergedGraph } from './tools.ts';
import { CallId } from '@deepseek-ai/dsh-llm';
import { scoped } from './shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse } from './types/index.ts';
import { PLUGIN_VERSION } from './generated/version.ts';

export { PLUGIN_VERSION };

const log = scoped('host');

interface ContextWithSessions {
  sessions?: { list?: () => Array<{ header?: { cwd?: string } }> };
}

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools', 'webServer'];

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

export function apply(ctx: Context) {
  const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx);

  ctx.tools.register(graphStatus);
  ctx.tools.register(graphData);
  ctx.tools.register(graphSymbol);
  ctx.tools.register(graphImpact);

  // ── HTTP routes for Host-Client communication ──────────────────────
  // The client (browser) communicates with the Host via HTTP fetch()
  // calls to these routes, registered on the DSH webServer.
  // ctx.emit/ctx.on is local-only (same process) and cannot cross the
  // Host-Client boundary. The webServer service provides the only
  // reliable channel for Host-Client data exchange.

  let lastGraphData: GraphData | null = null;
  let lastScanPath: string | null = null;
  let lastInitResult: { success: boolean; path: string; message: string; timestamp: number } | null = null;
  let scanInFlight: Promise<GraphData> | null = null;
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();
  const SCAN_CACHE_TTL = 30000;

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
        signal: AbortSignal.timeout(5000),
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
      const sessions = (ctx as ContextWithSessions).sessions;
      if (sessions?.list) {
        const all = sessions.list();
        for (const session of all) {
          const cwd = session?.header?.cwd;
          if (cwd) return cwd;
        }
      }
    } catch { /* best-effort */ }
    return process.cwd();
  };

  const readBody = (req: IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk?: Buffer) => { if (chunk) body += chunk.toString(); });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
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

  // GET /api/codegraph/workspace — get current DSH workspace path
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/workspace',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      const wsPath = findWorkspacePath();
      sendJson(res, 200, { path: wsPath });
    },
  }), 'codegraph: workspace route');

  // GET /api/codegraph/data — get cached graph data
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/data',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      if (lastGraphData) {
        sendJson(res, 200, lastGraphData);
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
        const { path } = JSON.parse(body || '{}') as { path?: string };
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
          return;
        }
        const scanPath = path && path !== '.' ? path : findWorkspacePath();
        lastScanPath = scanPath;
        const repoId = scanPath || `workspace-${Date.now()}`;

        const cached = scanCache.get(scanPath);
        if (cached && Date.now() - cached.timestamp < SCAN_CACHE_TTL) {
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
          if (scanCache.size > 4) {
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
        sendJson(res, 200, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
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
        const { path } = JSON.parse(body || '{}') as { path?: string };
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
        sendJson(res, 200, errorResult);
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
        const { enabled, path } = JSON.parse(body || '{}') as { enabled?: boolean; path?: string };
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, message: 'Path not allowed' });
          return;
        }
        const watchPath = path && path !== '.' ? path : findWorkspacePath();
        ctx.emit('codegraph/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 200, { success: false, message: e instanceof Error ? e.message : String(e) });
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
  const prereqTimer = setTimeout(emitPrereqStatus, 3000);
  ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

  // Client can request a re-check (e.g. after installing a prerequisite plugin).
  ctx.on('codegraph/prerequisite/request', () => {
    emitPrereqStatus();
  });

  // ── Heat-update (push) ─────────────────────────────────────────────
  ctx.on('codegraph/repo/imported', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });
  ctx.on('codegraph/repo/scanned', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });

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

  ctx.on('codegraph/repo/request-scan', async (event) => {
    await scanAndPush(event.path);
  });

  // ── Graph initialization ──────────────────────────────────────────
  // Trigger upstream codegraph_init (dsh-codegraph surface) to generate the
  // .codegraph DB; then scan and push the fresh graph to the client.
  ctx.on('codegraph/graph/init', async (event) => {
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
  });

  // ── File watcher for hot-update ────────────────────────────────────
  ctx.on('codegraph/watch/toggle', (event) => {
    // Close existing watcher
    if (activeWatcher) {
      try { activeWatcher.close(); } catch { /* best-effort */ }
      activeWatcher = null;
    }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }

    if (!event.enabled) {
      log.info('watch disabled');
      return;
    }

    log.info('watch enabled', { path: event.path });
    try {

      const watcher = watch(event.path, { recursive: true }, (_eventType: string, filename: string | null) => {
        // Ignore .codegraph internal changes to avoid feedback loops
        if (filename && filename.includes('.codegraph')) return;
        if (filename && filename.includes('node_modules')) return;
        if (filename && filename.includes('.git')) return;

        // Debounce 500ms — batch rapid file saves into one re-scan
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          log.info('file changed, syncing + re-scanning', { filename });
          // Sync the upstream index first so the fresh read reflects the change.
          invokeUpstream('codegraph_sync', { path: event.path })
            .then(() => scanAndPush(event.path))
            .catch((e) => log.error('watch re-scan failed', e));
        }, 500);
      });
      activeWatcher = watcher;
      ctx.effect(() => () => {
        try { watcher.close(); } catch { /* best-effort */ }
        if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
      }, 'codegraph: file watcher');
    } catch (e) {
      log.error('watch setup failed', e);
    }
  });
}
