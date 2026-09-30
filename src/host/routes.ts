import type { Context } from '@deepseek-ai/cordis';

import fs from 'node:fs/promises';
import path from 'node:path';
import { scoped } from '../shared/Logger.ts';
import { VALIDATION, AST, ERROR_CODES, ERROR_MESSAGES, BOOTSTRAP, EDGES_AGGREGATION, API } from '../shared/constants.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse, IGraphVisualizerService } from '../types/index.ts';
import { RepoId, NodeId, EdgeId } from '../types/index.ts';
import { fetchMergedGraph } from '../tools.ts';
import { createInvoke } from '../tools.ts';
import type { UpstreamInvoker } from '../adapters/IAdapter.ts';
import { SecurityManager } from './security.ts';
import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from './prerequisites.ts';
import type { VisualizerConfig } from './config.ts';
import type { ApiCompatLayer, FeatureFlags } from './compat/index.ts';
import { parsePackageJson, parseCargoToml, parseGoMod, dependencyGraphToGraphData } from '../adapters/DependencyAdapter.ts';
import { resolveDbPath, readTopLevelNodesFromDb, readNodeChildrenFromDb, readFileOutlineFromDb, readSymbolASTFromDb, readEdgesFromDb, readEdgesForNodesFromDb, countEdgesInDb, mapNodeKind, mapEdgeKind, isNoisePath, FILTERED_EDGE_KINDS } from '../adapters/CodeGraphAdapter.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import { computeGraphDiff, diffToGraphData } from '../merger/DiffEngine.ts';
import { TreeSitterAdapter } from '../adapters/TreeSitterAdapter.ts';
import { createRateLimiter } from './RateLimiter.ts';
import {
  readBody, parseJsonBody, extractStringField, extractBooleanField,
  isSafeGitRef, validatePathRealpath, buildCorsHeaders, handleCorsPreflight,
  sendJson, sendError, requireMethod, checkRate, logRequest,
  type CorsConfig,
} from './HttpHelpers.ts';

const log = scoped('host');

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

function withRouteMiddleware(
  method: string,
  routePath: string,
  corsConfig: CorsConfig,
  rateLimiter: ReturnType<typeof createRateLimiter>,
  handler: RouteHandler,
): RouteHandler {
  return async (req, res) => {
    if (handleCorsPreflight(req, res, corsConfig)) return;
    if (!requireMethod(req, res, method, corsConfig)) return;
    logRequest(req, routePath);
    if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
    await handler(req, res);
  };
}

async function resolveAndValidatePath(
  pathInput: string | undefined,
  ctx: Context,
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
): Promise<string | null> {
  if (pathInput && pathInput !== '.' && !deps.securityManager.isPathAllowed(pathInput)) {
    sendError(res, 403, ERROR_CODES.PATH_NOT_ALLOWED, req, corsConfig);
    return null;
  }
  const resolved = pathInput && pathInput !== '.' ? pathInput : findWorkspacePath(ctx);
  if (resolved && resolved !== '.' && !deps.securityManager.isPathAllowed(resolved)) {
    sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
    return null;
  }
  if (resolved && resolved !== '.' && !await validatePathRealpath(resolved, deps.securityManager)) {
    sendError(res, 403, ERROR_CODES.SYMLINK_ESCAPE, req, corsConfig);
    return null;
  }
  return resolved;
}

async function resolveAndValidateRelativePath(
  relativePath: string,
  ctx: Context,
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
): Promise<string | null> {
  const workspacePath = findWorkspacePath(ctx);
  if (!workspacePath) {
    sendError(res, 400, ERROR_CODES.NO_WORKSPACE_PATH, req, corsConfig);
    return null;
  }
  const fullPath = path.resolve(workspacePath, relativePath);
  const normalizedWorkspace = path.normalize(workspacePath);
  if (!fullPath.startsWith(normalizedWorkspace + path.sep) && fullPath !== normalizedWorkspace) {
    sendError(res, 403, ERROR_CODES.PATH_OUTSIDE_WORKSPACE, req, corsConfig);
    return null;
  }
  if (!await validatePathRealpath(fullPath, deps.securityManager)) {
    sendError(res, 403, ERROR_CODES.SYMLINK_ESCAPE, req, corsConfig);
    return null;
  }
  return fullPath;
}

async function validateWorkspacePath(
  ctx: Context,
  deps: RouteDeps,
): Promise<string | null> {
  const workspacePath = findWorkspacePath(ctx);
  if (!workspacePath) {
    return null;
  }
  if (!deps.securityManager.isPathAllowed(workspacePath)) {
    return '__denied__';
  }
  if (!await validatePathRealpath(workspacePath, deps.securityManager)) {
    return '__denied__';
  }
  return workspacePath;
}

function checkEtag(
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
  serverEtag: string,
): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  if (!ifNoneMatch) return false;
  const clientEtag = String(ifNoneMatch);
  if (clientEtag !== serverEtag) return false;
  const corsHeaders = buildCorsHeaders(req, corsConfig);
  corsHeaders['etag'] = serverEtag;
  res.writeHead(304, corsHeaders);
  res.end();
  return true;
}

export interface RouteDeps {
  ctx: Context;
  config: VisualizerConfig;
  securityManager: SecurityManager;
  invokeUpstream?: UpstreamInvoker;
  apiCompat?: ApiCompatLayer;
  featureFlags?: FeatureFlags;
  getLastGraphData: () => GraphData | null;
  setLastGraphData: (data: GraphData | null) => void;
  getLastInitResult: () => { success: boolean; path: string; message: string; timestamp: number } | null;
  setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => void;
  getScanCache: () => Map<string, { data: GraphData; timestamp: number }>;
  getScanInFlight: (path: string) => Promise<GraphData> | null;
  setScanInFlight: (path: string, p: Promise<GraphData> | null) => void;
}

export function slimGraphData(data: GraphData, maxNodes: number): GraphData {
  const cap = maxNodes;
  const truncated = data.nodes.length > cap;
  let selectedNodes: typeof data.nodes;

  if (truncated) {
    const degreeMap = new Map<string, number>();
    for (const n of data.nodes) degreeMap.set(n.id, 0);
    for (const e of data.edges) {
      if (e.source === e.target) continue;
      const s = degreeMap.get(e.source);
      const t = degreeMap.get(e.target);
      if (s !== undefined) degreeMap.set(e.source, s + 1);
      if (t !== undefined) degreeMap.set(e.target, t + 1);
    }
    const sorted = [...data.nodes].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0));
    selectedNodes = sorted.slice(0, cap);
  } else {
    selectedNodes = data.nodes;
  }

  const slimNodes = selectedNodes.map((n) => ({
    id: NodeId(n.id),
    label: n.label,
    type: n.type,
    filePath: n.filePath,
    lineNumber: n.lineNumber,
    properties: n.properties ?? {},
    ...(n.parentId ? { parentId: NodeId(n.parentId) } : {}),
    ...(n.layer ? { layer: n.layer } : {}),
  }));
  const allowedIds = new Set(slimNodes.map((n) => n.id));
  const slimEdges = data.edges
    .filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target) && e.source !== e.target)
    .map((e) => ({
      id: EdgeId(e.id),
      source: NodeId(e.source),
      target: NodeId(e.target),
      type: e.type,
      properties: e.properties ?? {},
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
  return createInvoke(ctx, config.requestTimeout);
}

export function registerService(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);

  ctx.effect(() => {
    const service: IGraphVisualizerService = {
      getCurrentGraph: () => deps.getLastGraphData(),
      getGraphData: async (repoId: string) => {
        try {
          const raw = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          return slimGraphData(raw, config.maxNodes);
        } catch (e) { log.warn('getGraphData failed', e); return null; }
      },
      getSymbolDetail: async (symbolId: string) => {
        const result = await invokeUpstream('codegraph_query', { search: symbolId, limit: 1 });
        if (result && typeof result === 'object') return result as Record<string, unknown>;
        return null;
      },
      getImpactAnalysis: async (symbolId: string) => {
        const result = await invokeUpstream('codegraph_impact', { symbol: symbolId, depth: 2 });
        if (result && typeof result === 'object' && 'affected' in result) {
          return result as { affected: string[]; depth: number };
        }
        return null;
      },
      onGraphUpdate: (callback: (data: GraphData) => void) => {
        return ctx.on('codegraph-visualizer/graph/data', (event) => {
          callback({
            nodes: event.nodes as GraphNode[],
            edges: event.edges as GraphEdge[],
            metadata: {
              repoId: RepoId(event.repoId),
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

interface RouteContext {
  deps: RouteDeps;
  corsConfig: CorsConfig;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  invokeUpstream: ReturnType<typeof createInvokeUpstream>;
}

function registerStatusRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/status';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens, builtin: status.builtin }, req, corsConfig);
    }),
  }), 'codegraph: status route');
}

function registerHealthRoute(rc: RouteContext): void {
  const { deps, corsConfig } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/health';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rc.rateLimiter, (req, res) => {
      try {
        const status = checkPrerequisites(ctx);
        const mem = process.memoryUsage();
        const hasGraphData = deps.getLastGraphData() !== null;
        const healthy = status.codegraph || status.lens || status.builtin;
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? 'healthy' : 'degraded',
          codegraph: status.codegraph,
          lens: status.lens,
          builtin: status.builtin,
          hasGraphData,
          uptime: process.uptime(),
          memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
          timestamp: Date.now(),
        }, req, corsConfig);
      } catch (e) {
        sendJson(res, 503, {
          status: 'unhealthy',
          error: e instanceof Error ? e.message : String(e),
          timestamp: Date.now(),
        }, req, corsConfig);
      }
    }),
  }), 'codegraph: health route');
}

function registerWorkspaceRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/workspace';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const current = findWorkspacePath(ctx);
      const list = extractWorkspacePaths(ctx);
      sendJson(res, 200, { path: current, list }, req, corsConfig);
    }),
  }), 'codegraph: workspace route');
}

function registerDataRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/data';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData && checkEtag(req, res, corsConfig, String(lastGraphData.metadata.timestamp))) {
        return;
      }
      if (lastGraphData) {
        const payload = JSON.stringify(lastGraphData);
        if (payload.length > API.DATA_RESPONSE_MAX_BYTES) {
          const slimmed = slimGraphData(lastGraphData, API.DATA_RESPONSE_SLIM_NODES);
          const slimPayload = JSON.stringify(slimmed);
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = String(lastGraphData.metadata.timestamp);
          dataHeaders['x-truncated'] = '1';
          res.writeHead(200, dataHeaders);
          res.end(slimPayload);
        } else {
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = String(lastGraphData.metadata.timestamp);
          res.writeHead(200, dataHeaders);
          res.end(payload);
        }
      } else {
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
      }
    }),
  }), 'codegraph: data route');
}

function registerScanRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/scan';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const scanPathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        const scanPath = await resolveAndValidatePath(scanPathInput, ctx, deps, req, res, corsConfig);
        if (scanPath === null) return;
        const repoId = scanPath || `workspace-${Date.now()}`;
        const scanCache = deps.getScanCache();

        const cached = scanCache.get(scanPath);
        if (cached && Date.now() - cached.timestamp < config.scanCacheTtl) {
          deps.setLastGraphData(cached.data);
          sendJson(res, 200, { success: true, ...cached.data }, req, corsConfig);
          return;
        }

        const inFlight = deps.getScanInFlight(scanPath);
        if (inFlight) {
          const data = await inFlight;
          sendJson(res, 200, { success: true, ...data }, req, corsConfig);
          return;
        }

        const scanPromise = fetchMergedGraph(invokeUpstream, repoId, 'both')
          .then(raw => slimGraphData(raw, config.maxNodes));
        deps.setScanInFlight(scanPath, scanPromise);
        try {
          const data = await scanPromise;

          deps.setLastGraphData(data);
          scanCache.set(scanPath, { data, timestamp: Date.now() });
          if (scanCache.size > config.scanCacheLimit) {
            const oldest = scanCache.keys().next().value;
            if (oldest !== undefined) scanCache.delete(oldest);
          }
          ctx.emit('codegraph-visualizer/graph/updated', {
            repoId: RepoId(repoId),
            nodeCount: data.metadata.nodeCount,
            edgeCount: data.metadata.edgeCount,
            timestamp: data.metadata.timestamp,
          });
          ctx.emit('codegraph-visualizer/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
          log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
          const scanPayload = JSON.stringify({ success: true, ...data });
          if (scanPayload.length > API.DATA_RESPONSE_MAX_BYTES) {
            const slimmed = slimGraphData(data, API.DATA_RESPONSE_SLIM_NODES);
            const slimPayload = JSON.stringify({ success: true, ...slimmed });
            const scanHeaders = buildCorsHeaders(req, corsConfig);
            scanHeaders['content-type'] = 'application/json';
            scanHeaders['x-truncated'] = '1';
            res.writeHead(200, scanHeaders);
            res.end(slimPayload);
          } else {
            sendJson(res, 200, { success: true, ...data }, req, corsConfig);
          }

        } finally {
          deps.setScanInFlight(scanPath, null);
        }
      } catch (e) {
        log.error('scan failed', e);
        sendError(res, 500, ERROR_CODES.SCAN_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: scan route');
}


function registerInitRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/init';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        const initPath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
        if (initPath === null) return;
        log.info('init requested', { path: initPath });
        const result = await invokeUpstream('codegraph_init', { path: initPath, force: true });
        const success = result !== null;
        const initResult = {
          success,
          path: initPath,
          message: success ? 'Graph initialized successfully' : (ERROR_MESSAGES.INIT_FAILED?.en ?? 'Initialization failed'),
          timestamp: Date.now(),
        };
        deps.setLastInitResult(initResult);
        ctx.emit('codegraph-visualizer/graph/init-result', initResult);
        if (success) {
          const repoId = initPath || `workspace-${Date.now()}`;
          const raw = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          const data = slimGraphData(raw, config.maxNodes);
          deps.setLastGraphData(data);
          ctx.emit('codegraph-visualizer/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
        }
        sendJson(res, 200, initResult, req, corsConfig);
      } catch (e) {
        log.error('init route failed', e);
        const errorResult = { success: false, path: '', message: ERROR_MESSAGES.INIT_FAILED?.en ?? 'Initialization failed', timestamp: Date.now() };
        deps.setLastInitResult(errorResult);
        sendError(res, 500, ERROR_CODES.INIT_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: init route');
}

function registerWatchRoute(rc: RouteContext): void {
  const { deps, corsConfig } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/watch';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rc.rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        const watchPath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
        if (watchPath === null) return;
        ctx.emit('codegraph-visualizer/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true, enabled: !!enabled, path: watchPath }, req, corsConfig);
      } catch (e) {
        log.warn('watch route failed', e);
        sendError(res, 500, ERROR_CODES.WATCH_TOGGLE_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: watch route');
}

function registerDependenciesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/dependencies';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const workspacePath = await validateWorkspacePath(ctx, deps);
        if (workspacePath === '__denied__') {
          sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
          return;
        }
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }

        const allDepNodes: ReturnType<typeof dependencyGraphToGraphData>['nodes'] = [];
        const allDepEdges: ReturnType<typeof dependencyGraphToGraphData>['edges'] = [];

        const depFiles: Array<{ filename: string; parser: (content: string) => ReturnType<typeof parsePackageJson> }> = [
          { filename: 'package.json', parser: parsePackageJson },
          { filename: 'Cargo.toml', parser: parseCargoToml },
          { filename: 'go.mod', parser: parseGoMod },
        ];

        for (const { filename, parser } of depFiles) {
          try {
            const filePath = path.join(workspacePath, filename);
            const content = await fs.readFile(filePath, 'utf-8');
            const depGraph = parser(content);
            const converted = dependencyGraphToGraphData(depGraph);
            allDepNodes.push(...converted.nodes);
            allDepEdges.push(...converted.edges);
          } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Failed to read ${filename}:`, e); }
        }

        const dedupNodes = new Map<string, typeof allDepNodes[number]>();
        for (const n of allDepNodes) dedupNodes.set(n.id, n);
        const dedupEdges = new Map<string, typeof allDepEdges[number]>();
        for (const e of allDepEdges) {
          if (e.source !== e.target) dedupEdges.set(e.id, e);
        }

        sendJson(res, 200, {
          nodes: [...dedupNodes.values()],
          edges: [...dedupEdges.values()],
          metadata: {
            repoId: RepoId(workspacePath),
            timestamp: Date.now(),
            nodeCount: allDepNodes.length,
            edgeCount: allDepEdges.length,
          },
        }, req, corsConfig);
      } catch (e) {
        log.error('dependencies route failed', e);
        sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
      }
    }),
  }), 'codegraph: dependencies route');
}

function registerDiffRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/diff';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, deps.config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const fromCommit = extractStringField(parsed, 'from', VALIDATION.MAX_GIT_REF_LENGTH);
        const toCommit = extractStringField(parsed, 'to', VALIDATION.MAX_GIT_REF_LENGTH);
        if (!fromCommit || !toCommit) {
          sendError(res, 400, ERROR_CODES.COMMITS_REQUIRED, req, corsConfig);
          return;
        }
        if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
          sendError(res, 400, ERROR_CODES.INVALID_GIT_REF, req, corsConfig);
          return;
        }

        const workspacePath = await validateWorkspacePath(ctx, deps);
        if (workspacePath === '__denied__') {
          sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
          return;
        }
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }

        const beforeGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${fromCommit}`, 'both');
        const afterGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${toCommit}`, 'both');

        const diff = computeGraphDiff(beforeGraph.nodes, beforeGraph.edges, afterGraph.nodes, afterGraph.edges);
        const { nodes, edges } = diffToGraphData(diff);

        sendJson(res, 200, {
          nodes, edges,
          metadata: { repoId: RepoId(workspacePath), timestamp: Date.now(), nodeCount: nodes.length, edgeCount: edges.length },
        }, req, corsConfig);
      } catch (e) {
        log.error('diff route failed', e);
        sendError(res, 500, ERROR_CODES.GRAPH_DIFF_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: diff route');
}

function registerAstRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/ast';

  ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath', VALIDATION.MAX_FILEPATH_LENGTH);
          if (!filePath) {
            sendError(res, 400, ERROR_CODES.FILEPATH_REQUIRED, req, corsConfig);
            return;
          }
          const realPath = await resolveAndValidateRelativePath(filePath, ctx, deps, req, res, corsConfig);
          if (!realPath) return;
          const content = await fs.readFile(realPath, 'utf-8');
          const MAX_AST_CONTENT = AST.MAX_CONTENT_BYTES;
          if (content.length > MAX_AST_CONTENT) {
            sendError(res, 413, ERROR_CODES.FILE_TOO_LARGE, req, corsConfig, `max ${MAX_AST_CONTENT} bytes`);
            return;
          }
          const astRoot = await sharedTreeSitterAdapter.parseToAst(filePath, content);
          if (!astRoot) {
            sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, `parseToAst returned null for ${filePath}`);
            return;
          }
          sendJson(res, 200, astRoot, req, corsConfig);
        } catch (e) {
          log.error('ast route failed', e);
          sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, e instanceof Error ? e.message : String(e));
        }
      }),
    }), 'codegraph: ast route');
}

function registerTreeSitterRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/tree-sitter';

  ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          const content = extractStringField(parsed, 'content');
          if (!filePath || !content) {
            sendError(res, 400, ERROR_CODES.FILEPATH_AND_CONTENT_REQUIRED, req, corsConfig);
            return;
          }
          if (filePath.includes('..') || filePath.length > VALIDATION.MAX_FILEPATH_LENGTH) {
            sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
            return;
          }
          const MAX_TREE_SITTER_CONTENT = AST.MAX_TREE_SITTER_CONTENT_BYTES;
          if (content.length > MAX_TREE_SITTER_CONTENT) {
            sendError(res, 413, ERROR_CODES.CONTENT_TOO_LARGE, req, corsConfig, `max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length}`);
            return;
          }
          const result = await sharedTreeSitterAdapter.parseFile(filePath, content);
          sendJson(res, 200, result, req, corsConfig);
        } catch (e) {
          log.error('tree-sitter route failed', e);
          sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
        }
      }),
    }), 'codegraph: tree-sitter route');
}

function registerBootstrapRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/bootstrap';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const workspacePath = findWorkspacePath(ctx);

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      // P0-1: DB-first — try SQLite direct read for true sharded query
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readTopLevelNodesFromDb(dbPath, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
        if (dbResult && dbResult.nodes.length > 0) {
          const topLevelNodes = dbResult.nodes
            .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
            .map((n) => ({
              id: NodeId(n.id),
              label: n.name,
              type: mapNodeKind(n.kind),
              filePath: n.file_path,
              lineNumber: n.start_line ?? 1,
              properties: {
                kind: n.kind,
                ...(n.signature ? { signature: n.signature } : {}),
                ...(n.docstring ? { docstring: n.docstring } : {}),
                exported: n.is_exported === 1,
              },
              layer: inferLayerFromPath(n.file_path),
            }));
          const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...topLevelIds]);
          const rootEdges = dbEdges.map((e) => ({
            id: EdgeId(String(e.id)),
            source: NodeId(e.source),
            target: NodeId(e.target),
            type: mapEdgeKind(e.kind),
            properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
          }));
          sendJson(res, 200, {
            rootNodes: topLevelNodes,
            topLevelNodes,
            topLevelTotal: dbResult.total,
            edges: rootEdges,
            indexStatus: 'ready',
            metadata: {
              repoId: RepoId(workspacePath),
              timestamp: Date.now(),
              totalNodeCount: dbResult.total,
              totalEdgeCount: countEdgesInDb(dbPath),
            },
          }, req, corsConfig);
          return;
        }
      }

      // Memory cache acceleration — only if DB was unavailable
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        const allRootNodes = lastGraphData.nodes.filter((n) => !n.parentId);
        const topLevelNodes = allRootNodes.slice(0, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
        const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
        const rootEdges = lastGraphData.edges.filter(
          (e) => topLevelIds.has(e.source) && topLevelIds.has(e.target),
        );

        sendJson(res, 200, {
          rootNodes: topLevelNodes,
          topLevelNodes,
          topLevelTotal: allRootNodes.length,
          edges: rootEdges,
          indexStatus: 'ready',
          metadata: {
            repoId: lastGraphData.metadata.repoId,
            timestamp: lastGraphData.metadata.timestamp,
            totalNodeCount: lastGraphData.metadata.totalNodeCount ?? lastGraphData.nodes.length,
            totalEdgeCount: lastGraphData.metadata.totalEdgeCount ?? lastGraphData.edges.length,
          },
        }, req, corsConfig);
        return;
      }

      // P0-2: No data available — return skeleton immediately, do NOT block on upstream fetch
      sendJson(res, 200, {
        rootNodes: [],
        topLevelNodes: [],
        topLevelTotal: 0,
        edges: [],
        indexStatus: 'building',
        metadata: {
          repoId: RepoId(workspacePath ?? 'empty'),
          timestamp: Date.now(),
          totalNodeCount: 0,
          totalEdgeCount: 0,
        },
      }, req, corsConfig);
    }),
  }), 'codegraph: bootstrap route');
}

function registerNodeChildrenRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/children';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const nodeId = url.searchParams.get('nodeId');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0;
      const limit = parseInt(url.searchParams.get('limit') ?? String(BOOTSTRAP.CHILDREN_PAGE_SIZE), 10) || BOOTSTRAP.CHILDREN_PAGE_SIZE;

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      // P0-1: DB-first — try SQLite direct read for true sharded query
      const workspacePath = findWorkspacePath(ctx);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readNodeChildrenFromDb(dbPath, nodeId, cursor, limit);
        if (dbResult && dbResult.nodes.length > 0) {
          const page = dbResult.nodes
            .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
            .map((n) => ({
              id: NodeId(n.id),
              label: n.name,
              type: mapNodeKind(n.kind),
              filePath: n.file_path,
              lineNumber: n.start_line ?? 1,
              properties: {
                kind: n.kind,
                ...(n.signature ? { signature: n.signature } : {}),
                ...(n.docstring ? { docstring: n.docstring } : {}),
                exported: n.is_exported === 1,
              },
              parentId: NodeId(nodeId),
              layer: inferLayerFromPath(n.file_path),
            }));
          const childIds = page.map((n) => n.id);
          const dbEdges = readEdgesForNodesFromDb(dbPath, childIds);
          const childEdges = dbEdges.map((e) => ({
            id: EdgeId(String(e.id)),
            source: NodeId(e.source),
            target: NodeId(e.target),
            type: mapEdgeKind(e.kind),
            properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
          }));
          sendJson(res, 200, {
            nodes: page,
            edges: childEdges,
            cursor: cursor + page.length < dbResult.total ? String(cursor + page.length) : null,
            total: dbResult.total,
          }, req, corsConfig);
          return;
        }
      }

      // Memory cache acceleration — only if DB was unavailable
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        const children = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
        const page = children.slice(cursor, cursor + limit);
        const childIds = new Set(page.map((n) => n.id));
        const childEdges = lastGraphData.edges.filter(
          (e) => childIds.has(e.source) && childIds.has(e.target),
        );

        sendJson(res, 200, {
          nodes: page,
          edges: childEdges,
          cursor: cursor + page.length < children.length ? String(cursor + page.length) : null,
          total: children.length,
        }, req, corsConfig);
        return;
      }

      sendJson(res, 200, { nodes: [], edges: [], cursor: null, total: 0 }, req, corsConfig);
    }),
  }), 'codegraph: node children route');
}

function registerFileOutlineRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/files';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const match = url.pathname.match(/^\/api\/v1\/codegraph\/files\/([^/]+)\/outline$/);
      if (!match) {
        sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }
      const nodeId = decodeURIComponent(match[1] ?? '');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      // DB-first: try SQLite direct read
      const workspacePath = findWorkspacePath(ctx);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readFileOutlineFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const symbols = dbResult.nodes
            .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
            .map((n) => ({
              id: NodeId(n.id),
              label: n.name,
              type: mapNodeKind(n.kind),
              filePath: n.file_path,
              lineNumber: n.start_line ?? 1,
              properties: {
                kind: n.kind,
                ...(n.signature ? { signature: n.signature } : {}),
                ...(n.docstring ? { docstring: n.docstring } : {}),
                exported: n.is_exported === 1,
              },
              parentId: NodeId(nodeId),
              layer: inferLayerFromPath(n.file_path),
            }));
          const symbolIds = new Set(symbols.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...symbolIds]);
          const symbolEdges = dbEdges.map((e) => ({
            id: EdgeId(String(e.id)),
            source: NodeId(e.source),
            target: NodeId(e.target),
            type: mapEdgeKind(e.kind),
            properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
          }));
          sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig);
          return;
        }
      }

      // Memory cache fallback
      const lastGraphData = deps.getLastGraphData();
      if (!lastGraphData) {
        sendJson(res, 200, { symbols: [], edges: [] }, req, corsConfig);
        return;
      }

      const symbols = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
      const symbolIds = new Set(symbols.map((n) => n.id));
      const symbolEdges = lastGraphData.edges.filter(
        (e) => symbolIds.has(e.source) && symbolIds.has(e.target),
      );

      sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig);
    }),
  }), 'codegraph: file outline route');
}

function registerSymbolASTRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/symbols';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const match = url.pathname.match(/^\/api\/v1\/codegraph\/symbols\/([^/]+)\/ast$/);
      if (!match) {
        sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }
      const nodeId = decodeURIComponent(match[1] ?? '');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      // DB-first: try SQLite direct read
      const workspacePath = findWorkspacePath(ctx);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readSymbolASTFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const astNodes = dbResult.nodes
            .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
            .map((n) => ({
              id: NodeId(n.id),
              label: n.name,
              type: mapNodeKind(n.kind),
              filePath: n.file_path,
              lineNumber: n.start_line ?? 1,
              properties: {
                kind: n.kind,
                ...(n.signature ? { signature: n.signature } : {}),
                ...(n.docstring ? { docstring: n.docstring } : {}),
                exported: n.is_exported === 1,
              },
              parentId: NodeId(nodeId),
              layer: inferLayerFromPath(n.file_path),
            }));
          const astNodeIds = new Set(astNodes.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...astNodeIds]);
          const astEdges = dbEdges.map((e) => ({
            id: EdgeId(String(e.id)),
            source: NodeId(e.source),
            target: NodeId(e.target),
            type: mapEdgeKind(e.kind),
            properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
          }));
          sendJson(res, 200, { astNodes, astEdges, sourceLines: [] }, req, corsConfig);
          return;
        }
      }

      // Memory cache fallback
      const lastGraphData = deps.getLastGraphData();
      if (!lastGraphData) {
        sendJson(res, 200, { astNodes: [], astEdges: [], sourceLines: [] }, req, corsConfig);
        return;
      }

      const astNodes = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
      const astNodeIds = new Set(astNodes.map((n) => n.id));
      const astEdges = lastGraphData.edges.filter(
        (e) => astNodeIds.has(e.source) && astNodeIds.has(e.target),
      );

      sendJson(res, 200, { astNodes, astEdges, sourceLines: [] }, req, corsConfig);
    }),
  }), 'codegraph: symbol AST route');
}

function registerEdgesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/edges';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const fromId = url.searchParams.get('from') ?? '';
      const scope = url.searchParams.get('scope') ?? 'file';
      const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? String(EDGES_AGGREGATION.PAGE_SIZE), 10), EDGES_AGGREGATION.PAGE_SIZE);
      const aggregated = url.searchParams.get('aggregated') === '1';

      if (!fromId || fromId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      // DB-first — try SQLite direct read, consistent with other routes
      const workspacePath = findWorkspacePath(ctx);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readEdgesFromDb(dbPath, fromId, scope as 'file' | 'symbol', cursor, limit);
        if (dbResult) {
          const pagedEdges = dbResult.edges
            .filter((e) => e.source !== e.target && !FILTERED_EDGE_KINDS.has(e.kind))
            .map((e) => ({
              id: EdgeId(String(e.id)),
              source: NodeId(e.source),
              target: NodeId(e.target),
              type: mapEdgeKind(e.kind),
              properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
            }));
          sendJson(res, 200, {
            edges: pagedEdges,
            total: dbResult.total,
            cursor: cursor + pagedEdges.length,
            hasMore: cursor + limit < dbResult.total,
          }, req, corsConfig);
          return;
        }
      }

      // Memory cache fallback — only if DB was unavailable
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        let filteredEdges: GraphEdge[];
        if (scope === 'symbol') {
          filteredEdges = lastGraphData.edges.filter((e) => e.source === fromId || e.target === fromId);
        } else {
          const nodeIds = new Set<string>();
          const nodeFilePaths = new Map<string, string>();
          for (const n of lastGraphData.nodes) {
            if (n.filePath === fromId || n.id === fromId) {
              nodeIds.add(n.id);
              nodeFilePaths.set(n.id, n.filePath);
            }
          }
          filteredEdges = lastGraphData.edges.filter(
            (e) => nodeIds.has(e.source) || nodeIds.has(e.target),
          );

          // P1-3: Aggregate cross-file edges when count exceeds threshold
          if (!aggregated && filteredEdges.length > EDGES_AGGREGATION.THRESHOLD) {
            const filePairCounts = new Map<string, number>();
            for (const e of filteredEdges) {
              const srcFile = nodeFilePaths.get(e.source) ?? lastGraphData.nodes.find(n => n.id === e.source)?.filePath ?? '?';
              const tgtFile = nodeFilePaths.get(e.target) ?? lastGraphData.nodes.find(n => n.id === e.target)?.filePath ?? '?';
              const pairKey = srcFile < tgtFile ? `${srcFile}→${tgtFile}` : `${tgtFile}→${srcFile}`;
              filePairCounts.set(pairKey, (filePairCounts.get(pairKey) ?? 0) + 1);
            }
            const aggregatedEdges = [...filePairCounts.entries()].map(([pairKey, count]) => {
              const [fileA, fileB] = pairKey.split('→');
              return {
                id: EdgeId(`agg:${pairKey}`),
                source: NodeId(fromId),
                target: NodeId(fileA === fromId ? (fileB ?? fromId) : (fileA ?? fromId)),
                type: 'dependency' as const,
                properties: { aggregated: true, count, filePair: pairKey },
              };
            });
            sendJson(res, 200, {
              edges: aggregatedEdges,
              total: aggregatedEdges.length,
              cursor: 0,
              hasMore: false,
              aggregated: true,
            }, req, corsConfig);
            return;
          }
        }

        const total = filteredEdges.length;
        const pagedEdges = filteredEdges.slice(cursor, cursor + limit);
        const hasMore = cursor + limit < total;

        sendJson(res, 200, { edges: pagedEdges, total, cursor: cursor + limit, hasMore }, req, corsConfig);
        return;
      }

      sendJson(res, 200, { edges: [], total: 0, cursor: 0, hasMore: false }, req, corsConfig);
    }),
  }), 'codegraph: edges route');
}

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);
  const corsConfig: CorsConfig = { origins: config.allowedOrigins };
  const rateLimiter = createRateLimiter();
  const sharedTreeSitterAdapter = new TreeSitterAdapter();

  const rc: RouteContext = { deps, corsConfig, rateLimiter, invokeUpstream };

  registerStatusRoute(rc);
  registerHealthRoute(rc);
  registerWorkspaceRoute(rc);
  registerDataRoute(rc);
  registerScanRoute(rc);
  registerInitRoute(rc);
  registerWatchRoute(rc);
  registerDependenciesRoute(rc);
  registerDiffRoute(rc);
  registerAstRoute(rc, sharedTreeSitterAdapter);
  registerTreeSitterRoute(rc, sharedTreeSitterAdapter);
  registerBootstrapRoute(rc);
  registerNodeChildrenRoute(rc);
  registerFileOutlineRoute(rc);
  registerSymbolASTRoute(rc);
  registerEdgesRoute(rc);

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
  ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), 'codegraph: tree-sitter adapter cleanup');
}
