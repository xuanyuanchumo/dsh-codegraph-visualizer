import type { Context } from '@deepseek-ai/cordis';

import fs from 'node:fs/promises';
import path from 'node:path';
import { scoped } from '../shared/Logger.ts';
import { VALIDATION, AST } from '../shared/constants.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse, IGraphVisualizerService } from '../types/index.ts';
import { RepoId } from '../types/index.ts';
import { fetchMergedGraph } from '../tools.ts';
import { createInvoke } from '../tools.ts';
import { SecurityManager } from './security.ts';
import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from './prerequisites.ts';
import type { VisualizerConfig } from './config.ts';
import { parsePackageJson, parseCargoToml, parseGoMod, dependencyGraphToGraphData } from '../adapters/DependencyAdapter.ts';
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

export interface RouteDeps {
  ctx: Context;
  config: VisualizerConfig;
  securityManager: SecurityManager;
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
    id: n.id,
    label: n.label,
    type: n.type,
    filePath: n.filePath,
    lineNumber: n.lineNumber,
    properties: n.properties ?? {},
  }));
  const allowedIds = new Set(slimNodes.map((n) => n.id));
  const slimEdges = data.edges
    .filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target) && e.source !== e.target)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
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
  const invokeUpstream = createInvokeUpstream(ctx, config);

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
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens }, req, corsConfig);
    },
  }), 'codegraph: status route');
}

function registerHealthRoute(rc: RouteContext): void {
  const { deps, corsConfig } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/health';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);
      try {
        const status = checkPrerequisites(ctx);
        const mem = process.memoryUsage();
        const hasGraphData = deps.getLastGraphData() !== null;
        const healthy = status.codegraph;
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? 'healthy' : 'degraded',
          codegraph: status.codegraph,
          lens: status.lens,
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
    },
  }), 'codegraph: health route');
}

function registerWorkspaceRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/workspace';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      const current = findWorkspacePath(ctx);
      const list = extractWorkspacePaths(ctx);
      sendJson(res, 200, { path: current, list }, req, corsConfig);
    },
  }), 'codegraph: workspace route');
}

function registerDataRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/data';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      const ifNoneMatch = req.headers['if-none-match'];
      const lastGraphData = deps.getLastGraphData();
      if (ifNoneMatch && lastGraphData) {
        const clientTimestamp = parseInt(String(ifNoneMatch), 10);
        if (clientTimestamp >= lastGraphData.metadata.timestamp) {
          const corsHeaders = buildCorsHeaders(req, corsConfig);
          corsHeaders['etag'] = String(lastGraphData.metadata.timestamp);
          res.writeHead(304, corsHeaders);
          res.end();
          return;
        }
      }
      if (lastGraphData) {
        const dataHeaders = buildCorsHeaders(req, corsConfig);
        dataHeaders['content-type'] = 'application/json';
        dataHeaders['etag'] = String(lastGraphData.metadata.timestamp);
        res.writeHead(200, dataHeaders);
        res.end(JSON.stringify(lastGraphData));
      } else {
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
      }
    },
  }), 'codegraph: data route');
}

function registerScanRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/scan';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'POST', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const scanPathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        if (scanPathInput && scanPathInput !== '.' && !deps.securityManager.isPathAllowed(scanPathInput)) {
          sendError(res, 403, 'Path not allowed', req, corsConfig);
          return;
        }
        const scanPath = scanPathInput && scanPathInput !== '.' ? scanPathInput : findWorkspacePath(ctx);
        if (scanPath && scanPath !== '.' && !deps.securityManager.isPathAllowed(scanPath)) {
          sendError(res, 403, 'Workspace path not allowed', req, corsConfig);
          return;
        }
        if (scanPath && scanPath !== '.' && !await validatePathRealpath(scanPath, deps.securityManager)) {
          sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
          return;
        }
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
          deps.setScanInFlight(scanPath, null);
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
          sendJson(res, 200, { success: true, ...data }, req, corsConfig);
        } catch (e) {
          deps.setScanInFlight(scanPath, null);
          throw e;
        }
      } catch (e) {
        log.error('scan failed', e);
        sendError(res, 500, 'Scan failed — check codegraph installation', req, corsConfig);
      }
    },
  }), 'codegraph: scan route');
}

function registerInitRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/init';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'POST', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        if (pathInput && pathInput !== '.' && !deps.securityManager.isPathAllowed(pathInput)) {
          sendError(res, 403, 'Path not allowed', req, corsConfig);
          return;
        }
        const initPath = pathInput && pathInput !== '.' ? pathInput : findWorkspacePath(ctx);
        if (initPath && initPath !== '.' && !deps.securityManager.isPathAllowed(initPath)) {
          sendError(res, 403, 'Path not allowed', req, corsConfig);
          return;
        }
        if (initPath && initPath !== '.' && !await validatePathRealpath(initPath, deps.securityManager)) {
          sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
          return;
        }
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
        const errorResult = { success: false, path: '', message: 'Initialization failed', timestamp: Date.now() };
        deps.setLastInitResult(errorResult);
        sendError(res, 500, 'Initialization failed — is dsh-codegraph installed?', req, corsConfig);
      }
    },
  }), 'codegraph: init route');
}

function registerWatchRoute(rc: RouteContext): void {
  const { deps, corsConfig } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/watch';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'POST', corsConfig)) return;
      logRequest(req, routePath);
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        if (pathInput && pathInput !== '.' && !deps.securityManager.isPathAllowed(pathInput)) {
          sendError(res, 403, 'Path not allowed', req, corsConfig);
          return;
        }
        const watchPath = pathInput && pathInput !== '.' ? pathInput : findWorkspacePath(ctx);
        if (watchPath && watchPath !== '.' && !deps.securityManager.isPathAllowed(watchPath)) {
          sendError(res, 403, 'Path not allowed', req, corsConfig);
          return;
        }
        if (watchPath && watchPath !== '.' && !await validatePathRealpath(watchPath, deps.securityManager)) {
          sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
          return;
        }
        ctx.emit('codegraph-visualizer/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true, enabled: !!enabled, path: watchPath }, req, corsConfig);
      } catch (e) {
        log.warn('watch route failed', e);
        sendError(res, 500, 'Watch toggle failed', req, corsConfig);
      }
    },
  }), 'codegraph: watch route');
}

function registerDependenciesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/dependencies';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      try {
        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }
        if (!deps.securityManager.isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed', req, corsConfig);
          return;
        }
        if (!await validatePathRealpath(workspacePath, deps.securityManager)) {
          sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
          return;
        }

        const allDepNodes: ReturnType<typeof dependencyGraphToGraphData>['nodes'] = [];
        const allDepEdges: ReturnType<typeof dependencyGraphToGraphData>['edges'] = [];

        const packageJsonPath = path.join(workspacePath, 'package.json');
        try {
          const content = await fs.readFile(packageJsonPath, 'utf-8');
          const depGraph = parsePackageJson(content);
          const converted = dependencyGraphToGraphData(depGraph);
          allDepNodes.push(...converted.nodes);
          allDepEdges.push(...converted.edges);
        } catch { /* no package.json */ }

        const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
        try {
          const content = await fs.readFile(cargoTomlPath, 'utf-8');
          const depGraph = parseCargoToml(content);
          const converted = dependencyGraphToGraphData(depGraph);
          allDepNodes.push(...converted.nodes);
          allDepEdges.push(...converted.edges);
        } catch { /* no Cargo.toml */ }

        const goModPath = path.join(workspacePath, 'go.mod');
        try {
          const content = await fs.readFile(goModPath, 'utf-8');
          const depGraph = parseGoMod(content);
          const converted = dependencyGraphToGraphData(depGraph);
          allDepNodes.push(...converted.nodes);
          allDepEdges.push(...converted.edges);
        } catch { /* no go.mod */ }

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
        sendError(res, 500, 'Internal server error', req, corsConfig);
      }
    },
  }), 'codegraph: dependencies route');
}

function registerDiffRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/diff';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'POST', corsConfig)) return;
      logRequest(req, routePath);
      if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
      try {
        const body = await readBody(req, deps.config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const fromCommit = extractStringField(parsed, 'from', VALIDATION.MAX_GIT_REF_LENGTH);
        const toCommit = extractStringField(parsed, 'to', VALIDATION.MAX_GIT_REF_LENGTH);
        if (!fromCommit || !toCommit) {
          sendError(res, 400, 'from and to commits are required', req, corsConfig);
          return;
        }
        if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
          sendError(res, 400, 'Invalid git ref format', req, corsConfig);
          return;
        }

        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }
        if (!deps.securityManager.isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed', req, corsConfig);
          return;
        }
        if (!await validatePathRealpath(workspacePath, deps.securityManager)) {
          sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
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
        sendError(res, 500, 'Graph diff failed — check git refs', req, corsConfig);
      }
    },
  }), 'codegraph: diff route');
}

function registerAstRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/ast';

  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (handleCorsPreflight(req, res, corsConfig)) return;
        if (!requireMethod(req, res, 'POST', corsConfig)) return;
        logRequest(req, routePath);
        if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath', VALIDATION.MAX_FILEPATH_LENGTH);
          if (!filePath) {
            sendError(res, 400, 'filePath is required', req, corsConfig);
            return;
          }
          const workspacePath = findWorkspacePath(ctx);
          if (!workspacePath) {
            sendError(res, 400, 'No workspace path configured', req, corsConfig);
            return;
          }
          const fullPath = path.resolve(workspacePath, filePath);
          const normalizedWorkspace = path.normalize(workspacePath);
          if (!fullPath.startsWith(normalizedWorkspace + path.sep) && fullPath !== normalizedWorkspace) {
            sendError(res, 403, 'Access denied: path outside workspace', req, corsConfig);
            return;
          }
          const realPath = await fs.realpath(fullPath);
          const realWorkspace = await fs.realpath(normalizedWorkspace);
          if (!realPath.startsWith(realWorkspace + path.sep) && realPath !== realWorkspace) {
            sendError(res, 403, 'Access denied: symlink escape', req, corsConfig);
            return;
          }
          if (!deps.securityManager.isPathAllowed(realPath)) {
            sendError(res, 403, 'Access denied', req, corsConfig);
            return;
          }
          const content = await fs.readFile(realPath, 'utf-8');
          const MAX_AST_CONTENT = AST.MAX_CONTENT_BYTES;
          if (content.length > MAX_AST_CONTENT) {
            sendError(res, 413, `File too large for AST parsing (max ${MAX_AST_CONTENT} bytes)`, req, corsConfig);
            return;
          }
          const astRoot = await sharedTreeSitterAdapter.parseToAst(filePath, content);
          if (!astRoot) {
            sendError(res, 500, `AST parsing failed: parseToAst returned null for ${filePath}`, req, corsConfig);
            return;
          }
          sendJson(res, 200, astRoot, req, corsConfig);
        } catch (e) {
          log.error('ast route failed', e);
          sendError(res, 500, `AST parsing failed: ${e instanceof Error ? e.message : String(e)}`, req, corsConfig);
        }
      },
    });
  }, 'codegraph: ast route');
}

function registerTreeSitterRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/tree-sitter';

  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (handleCorsPreflight(req, res, corsConfig)) return;
        if (!requireMethod(req, res, 'POST', corsConfig)) return;
        logRequest(req, routePath);
        if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          const content = extractStringField(parsed, 'content');
          if (!filePath || !content) {
            sendError(res, 400, 'filePath and content are required', req, corsConfig);
            return;
          }
          if (filePath.includes('..') || filePath.length > VALIDATION.MAX_FILEPATH_LENGTH) {
            sendError(res, 400, 'Invalid filePath', req, corsConfig);
            return;
          }
          const MAX_TREE_SITTER_CONTENT = AST.MAX_TREE_SITTER_CONTENT_BYTES;
          if (content.length > MAX_TREE_SITTER_CONTENT) {
            sendError(res, 413, `Content too large for tree-sitter parsing (max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length})`, req, corsConfig);
            return;
          }
          const result = await sharedTreeSitterAdapter.parseFile(filePath, content);
          sendJson(res, 200, result, req, corsConfig);
        } catch (e) {
          log.error('tree-sitter route failed', e);
          sendError(res, 500, 'Internal server error', req, corsConfig);
        }
      },
    });
  }, 'codegraph: tree-sitter route');
}

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = createInvokeUpstream(ctx, config);
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

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
  ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), 'codegraph: tree-sitter adapter cleanup');
}
