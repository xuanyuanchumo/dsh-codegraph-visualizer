import type { Context } from '@deepseek-ai/cordis';
import { CallId } from '@deepseek-ai/dsh-llm';
import { scoped } from '../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse, IGraphVisualizerService } from '../types/index.ts';
import { fetchMergedGraph } from '../tools.ts';
import { isPathAllowed } from './security.ts';
import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from './prerequisites.ts';
import type { VisualizerConfig } from './config.ts';

const log = scoped('host');

export interface RouteDeps {
  ctx: Context;
  config: VisualizerConfig;
  getLastGraphData: () => GraphData | null;
  setLastGraphData: (data: GraphData | null) => void;
  getLastInitResult: () => { success: boolean; path: string; message: string; timestamp: number } | null;
  setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => void;
  getScanCache: () => Map<string, { data: GraphData; timestamp: number }>;
  getScanInFlight: () => Promise<GraphData> | null;
  setScanInFlight: (p: Promise<GraphData> | null) => void;
}

export function slimGraphData(data: GraphData, maxNodes: number): GraphData {
  const cap = maxNodes;
  const truncated = data.nodes.length > cap;
  const slimNodes = (truncated ? data.nodes.slice(0, cap) : data.nodes).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    filePath: n.filePath,
    lineNumber: n.lineNumber,
    properties: n.properties?.exported === true ? { exported: true } : {},
  }));
  const allowedIds = new Set(slimNodes.map((n) => n.id));
  const slimEdges = data.edges
    .filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      properties: {},
    }));
  return {
    nodes: slimNodes as GraphNode[],
    edges: slimEdges as GraphEdge[],
    metadata: {
      ...data.metadata,
      truncated,
      nodeCount: slimNodes.length,
      edgeCount: slimEdges.length,
      totalNodeCount: data.metadata.totalNodeCount ?? data.nodes.length,
      totalEdgeCount: data.metadata.totalEdgeCount ?? data.edges.length,
    },
  };
}

export function createInvokeUpstream(ctx: Context, config: VisualizerConfig) {
  return async (tool: string, args: Record<string, unknown>): Promise<unknown | null> => {
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
}

export function registerService(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = createInvokeUpstream(ctx, config);

  ctx.effect(() => {
    const service: IGraphVisualizerService = {
      getCurrentGraph: () => deps.getLastGraphData(),
      getGraphData: async (repoId: string) => {
        try {
          const raw = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          return slimGraphData(raw, config.maxNodes);
        } catch { return null; }
      },
      getSymbolDetail: async (symbolId: string) => {
        return invokeUpstream('codegraph_query', { search: symbolId, limit: 1 });
      },
      getImpactAnalysis: async (symbolId: string) => {
        return invokeUpstream('codegraph_impact', { symbol: symbolId, depth: 2 });
      },
      onGraphUpdate: (callback: (data: GraphData) => void) => {
        return ctx.on('codegraph/graph/data', (event) => {
          callback({
            nodes: event.nodes as GraphNode[],
            edges: event.edges as GraphEdge[],
            metadata: {
              repoId: event.repoId as GraphData['metadata']['repoId'],
              timestamp: event.timestamp,
              nodeCount: event.nodes.length,
              edgeCount: event.edges.length,
            },
          });
        });
      },
    };
    return ctx.provide('graphVisualizer', service);
  }, 'codegraph: service registration');
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', (chunk?: Buffer) => {
      if (!chunk) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJsonBody(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body || '{}');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid JSON body: expected object');
  }
  return parsed as Record<string, unknown>;
}

function extractStringField(obj: Record<string, unknown>, field: string): string | undefined {
  const v = obj[field];
  return typeof v === 'string' ? v : undefined;
}

function extractBooleanField(obj: Record<string, unknown>, field: string): boolean | undefined {
  const v = obj[field];
  return typeof v === 'boolean' ? v : undefined;
}

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = createInvokeUpstream(ctx, config);

  // GET /api/codegraph/status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/status',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens });
    },
  }), 'codegraph: status route');

  // GET /api/codegraph/workspace
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/workspace',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      const current = findWorkspacePath(ctx);
      const list = extractWorkspacePaths(ctx);
      sendJson(res, 200, { path: current, list });
    },
  }), 'codegraph: workspace route');

  // GET /api/codegraph/data
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/data',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const ifNoneMatch = req.headers['if-none-match'];
      const lastGraphData = deps.getLastGraphData();
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

  // POST /api/codegraph/scan
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/scan',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
          return;
        }
        const scanPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        const repoId = scanPath || `workspace-${Date.now()}`;
        const scanCache = deps.getScanCache();

        const cached = scanCache.get(scanPath);
        if (cached && Date.now() - cached.timestamp < config.scanCacheTtl) {
          deps.setLastGraphData(cached.data);
          sendJson(res, 200, { success: true, ...cached.data });
          return;
        }

        const inFlight = deps.getScanInFlight();
        if (inFlight) {
          const data = await inFlight;
          sendJson(res, 200, { success: true, ...data });
          return;
        }

        const scanPromise = fetchMergedGraph(invokeUpstream, repoId, 'both');
        deps.setScanInFlight(scanPromise);
        try {
          const raw = await scanPromise;
          deps.setScanInFlight(null);
          const data = slimGraphData(raw, config.maxNodes);
          deps.setLastGraphData(data);
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
          deps.setScanInFlight(null);
          throw e;
        }
      } catch (e) {
        log.error('scan failed', e);
        sendJson(res, 500, { success: false, nodes: [], edges: [], metadata: { repoId: null, timestamp: 0, nodeCount: 0, edgeCount: 0 } });
      }
    },
  }), 'codegraph: scan route');

  // POST /api/codegraph/init
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/init',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, path: '', message: 'Path not allowed', timestamp: Date.now() });
          return;
        }
        const initPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        log.info('init requested', { path: initPath });
        const result = await invokeUpstream('codegraph_init', { path: initPath, force: true });
        const success = result !== null;
        const initResult = {
          success,
          path: initPath,
          message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
          timestamp: Date.now(),
        };
        deps.setLastInitResult(initResult);
        ctx.emit('codegraph/graph/init-result', initResult);
        if (success) {
          const repoId = initPath || `workspace-${Date.now()}`;
          const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          deps.setLastGraphData(data);
          ctx.emit('codegraph/graph/data', {
            repoId,
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
        }
        sendJson(res, 200, initResult);
      } catch (e) {
        const errorResult = {
          success: false,
          path: '',
          message: e instanceof Error ? e.message : String(e),
          timestamp: Date.now(),
        };
        deps.setLastInitResult(errorResult);
        sendJson(res, 500, errorResult);
      }
    },
  }), 'codegraph: init route');

  // POST /api/codegraph/watch
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/codegraph/watch',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendJson(res, 403, { success: false, message: 'Path not allowed' });
          return;
        }
        const watchPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        ctx.emit('codegraph/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 500, { success: false, message: e instanceof Error ? e.message : String(e) });
      }
    },
  }), 'codegraph: watch route');
}