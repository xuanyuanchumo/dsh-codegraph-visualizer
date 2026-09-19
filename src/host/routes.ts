import type { Context } from '@deepseek-ai/cordis';

import fs from 'node:fs/promises';
import path from 'node:path';
import { scoped } from '../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse, IGraphVisualizerService } from '../types/index.ts';
import { RepoId } from '../types/index.ts';
import { fetchMergedGraph } from '../tools.ts';
import { createInvoke } from '../tools.ts';
import { isPathAllowed } from './security.ts';
import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from './prerequisites.ts';
import type { VisualizerConfig } from './config.ts';
import { parsePackageJson, parseCargoToml, parseGoMod, dependencyGraphToGraphData } from '../adapters/DependencyAdapter.ts';
import { computeGraphDiff, diffToGraphData } from '../merger/DiffEngine.ts';
import { TreeSitterAdapter } from '../adapters/TreeSitterAdapter.ts';

const log = scoped('host');

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_DEFAULT = 60;
const RATE_LIMIT_HEAVY = 10;
const RATE_LIMIT_MAP_MAX = 10_000;
const HEAVY_ENDPOINTS = new Set(['/api/v1/codegraph/scan', '/api/v1/codegraph/init', '/api/v1/codegraph/diff', '/api/v1/codegraph/ast', '/api/v1/codegraph/tree-sitter']);

interface RateBucket { count: number; resetTime: number; }

function createRateLimiter() {
  const rateLimitMap = new Map<string, RateBucket>();
  let lastCleanup = Date.now();

  function check(ip: string, routePath: string): boolean {
    const key = `${ip}:${routePath}`;
    const limit = HEAVY_ENDPOINTS.has(routePath) ? RATE_LIMIT_HEAVY : RATE_LIMIT_DEFAULT;
    const now = Date.now();
    if (now - lastCleanup > RATE_LIMIT_WINDOW_MS) {
      for (const [k, b] of rateLimitMap) {
        if (now > b.resetTime) rateLimitMap.delete(k);
      }
      lastCleanup = now;
    }
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      const oldestKey = rateLimitMap.keys().next().value;
      if (oldestKey !== undefined) rateLimitMap.delete(oldestKey);
    }
    const bucket = rateLimitMap.get(key);
    if (!bucket || now > bucket.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  function reset(): void {
    rateLimitMap.clear();
    lastCleanup = Date.now();
  }

  return { check, reset };
}

function getClientIp(req: IncomingMessage): string {
  const socketAddr = req.socket?.remoteAddress;
  return socketAddr ?? 'unknown';
}

export interface RouteDeps {
  ctx: Context;
  config: VisualizerConfig;
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
  const slimNodes = (truncated ? data.nodes.slice(0, cap) : data.nodes).map((n) => ({
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
        return ctx.on('cg-viz/graph/data', (event) => {
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


function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', (chunk?: Buffer) => {
      if (!chunk) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        req.destroy();
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


const GIT_REF_PATTERN = /^[a-zA-Z0-9._/-]+$/;

function isSafeGitRef(ref: string): boolean {
  if (!GIT_REF_PATTERN.test(ref)) return false;
  if (ref.includes('..')) return false;
  return true;
}

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = createInvokeUpstream(ctx, config);
  const origins = config.allowedOrigins;
  const rateLimiter = createRateLimiter();


  const sendJson = (res: ServerResponse, code: number, data: unknown, req?: IncomingMessage): void => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match',
      'access-control-max-age': '86400',
      'vary': 'Origin',
    };
    if (origins.length > 0) {
      const reqOrigin = req?.headers?.['origin'];
      if (typeof reqOrigin === 'string' && origins.includes(reqOrigin)) {
        headers['access-control-allow-origin'] = reqOrigin;
      }
    }
    res.writeHead(code, headers);
    res.end(JSON.stringify(data));
  };

  const sendError = (res: ServerResponse, code: number, message: string, req?: IncomingMessage): void => {
    sendJson(res, code, { success: false, error: message }, req);
  };

  const checkRate = (req: IncomingMessage, res: ServerResponse, routePath: string): boolean => {
    if (!rateLimiter.check(getClientIp(req), routePath)) {
      sendError(res, 429, 'Rate limit exceeded', req);
      return false;
    }
    return true;
  };

  const handleCorsPreflight = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'OPTIONS') return false;
    const headers: Record<string, string> = {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match',
      'access-control-max-age': '86400',
      'vary': 'Origin',
    };
    if (origins.length > 0) {
      const reqOrigin = req.headers?.['origin'];
      if (typeof reqOrigin === 'string' && origins.includes(reqOrigin)) {
        headers['access-control-allow-origin'] = reqOrigin;
      }
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  };

  const requireMethod = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (req.method === method) return true;
    sendError(res, 405, `Method ${req.method} not allowed; expected ${method}`, req);
    return false;
  };

  const logRequest = (req: IncomingMessage, routePath: string): void => {
    log.info('request', { method: req.method, path: routePath, ip: getClientIp(req) });
  };

  // GET /api/v1/codegraph/status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/status',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'GET')) return;
      logRequest(req, '/api/v1/codegraph/status');

      if (!checkRate(req, res, '/api/v1/codegraph/status')) return;
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens }, req);
    },
  }), 'codegraph: status route');

  // GET /api/v1/codegraph/health
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/health',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'GET')) return;
      logRequest(req, '/api/v1/codegraph/health');
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
          memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
          },
          timestamp: Date.now(),
        }, req);
      } catch (e) {
        sendJson(res, 503, {
          status: 'unhealthy',
          error: e instanceof Error ? e.message : String(e),
          timestamp: Date.now(),
        }, req);
      }
    },
  }), 'codegraph: health route');

  // GET /api/v1/codegraph/workspace
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/workspace',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'GET')) return;
      logRequest(req, '/api/v1/codegraph/workspace');
      if (!checkRate(req, res, '/api/v1/codegraph/workspace')) return;
      const current = findWorkspacePath(ctx);
      const list = extractWorkspacePaths(ctx);
      sendJson(res, 200, { path: current, list }, req);
    },
  }), 'codegraph: workspace route');

  // GET /api/v1/codegraph/data
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/data',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'GET')) return;
      logRequest(req, '/api/v1/codegraph/data');
      if (!checkRate(req, res, '/api/v1/codegraph/data')) return;
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
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req);
      }
    },
  }), 'codegraph: data route');

  // POST /api/v1/codegraph/scan
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/scan',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'POST')) return;
      logRequest(req, '/api/v1/codegraph/scan');
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed', req);
          return;
        }
        const scanPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        if (scanPath && scanPath !== '.' && !isPathAllowed(scanPath)) {
          sendError(res, 403, 'Workspace path not allowed', req);
          return;
        }
        const repoId = scanPath || `workspace-${Date.now()}`;
        const scanCache = deps.getScanCache();

        const cached = scanCache.get(scanPath);
        if (cached && Date.now() - cached.timestamp < config.scanCacheTtl) {
          deps.setLastGraphData(cached.data);
          sendJson(res, 200, { success: true, ...cached.data }, req);
          return;
        }

        const inFlight = deps.getScanInFlight(scanPath);
        if (inFlight) {
          const data = await inFlight;
          sendJson(res, 200, { success: true, ...data }, req);
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
          ctx.emit('cg-viz/graph/updated', {
            repoId: RepoId(repoId),
            nodeCount: data.metadata.nodeCount,
            edgeCount: data.metadata.edgeCount,
            timestamp: data.metadata.timestamp,
          });
          ctx.emit('cg-viz/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
          log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
          sendJson(res, 200, { success: true, ...data }, req);
        } catch (e) {
          deps.setScanInFlight(scanPath, null);
          throw e;
        }
      } catch (e) {
        log.error('scan failed', e);
        sendError(res, 500, 'Scan failed — check codegraph installation', req);
      }
    },
  }), 'codegraph: scan route');

  // POST /api/v1/codegraph/init
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/init',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'POST')) return;
      logRequest(req, '/api/v1/codegraph/init');
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed', req);
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
        ctx.emit('cg-viz/graph/init-result', initResult);
        if (success) {
          const repoId = initPath || `workspace-${Date.now()}`;
          const raw = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          const data = slimGraphData(raw, config.maxNodes);
          deps.setLastGraphData(data);
          ctx.emit('cg-viz/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
        }
        sendJson(res, 200, initResult, req);
      } catch (e) {
        log.error('init route failed', e);
        const errorResult = {
          success: false,
          path: '',
          message: 'Initialization failed',
          timestamp: Date.now(),
        };
        deps.setLastInitResult(errorResult);
        sendError(res, 500, 'Initialization failed — is dsh-codegraph installed?', req);
      }
    },
  }), 'codegraph: init route');

  // POST /api/v1/codegraph/watch
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/watch',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'POST')) return;
      logRequest(req, '/api/v1/codegraph/watch');
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed', req);
          return;
        }
        const watchPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        ctx.emit('cg-viz/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true, enabled: !!enabled, path: watchPath }, req);
      } catch (e) {
        log.warn('watch route failed', e);
        sendError(res, 500, 'Watch toggle failed', req);
      }
    },
  }), 'codegraph: watch route');

  // GET /api/v1/codegraph/dependencies — FR-21 第三方依赖图谱
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/dependencies',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'GET')) return;
      logRequest(req, '/api/v1/codegraph/dependencies');
      if (!checkRate(req, res, '/api/v1/codegraph/dependencies')) return;
      try {
        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req);
          return;
        }
        if (!isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed', req);
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
        }, req);
      } catch (e) {
        log.error('dependencies route failed', e);
        sendError(res, 500, 'Internal server error', req);
      }
    },
  }), 'codegraph: dependencies route');

  // POST /api/v1/codegraph/diff — FR-24 版本对比图谱
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/diff',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      if (!requireMethod(req, res, 'POST')) return;
      logRequest(req, '/api/v1/codegraph/diff');
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const fromCommit = extractStringField(parsed, 'from');
        const toCommit = extractStringField(parsed, 'to');
        if (!fromCommit || !toCommit) {
          sendError(res, 400, 'from and to commits are required', req);
          return;
        }
        if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
          sendError(res, 400, 'Invalid git ref format', req);
          return;
        }

        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req);
          return;
        }
        if (!isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed', req);
          return;
        }

        const beforeGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${fromCommit}`, 'both');
        const afterGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${toCommit}`, 'both');

        const diff = computeGraphDiff(beforeGraph.nodes, beforeGraph.edges, afterGraph.nodes, afterGraph.edges);
        const { nodes, edges } = diffToGraphData(diff);

        sendJson(res, 200, {
          nodes,
          edges,
          metadata: {
            repoId: RepoId(workspacePath),
            timestamp: Date.now(),
            nodeCount: nodes.length,
            edgeCount: edges.length,
          },
        }, req);
      } catch (e) {
        log.error('diff route failed', e);
        sendError(res, 500, 'Graph diff failed — check git refs', req);
      }
    },
  }), 'codegraph: diff route');

  const sharedTreeSitterAdapter = new TreeSitterAdapter();

  // POST /api/v1/codegraph/ast — 获取文件 AST（用于微观图谱：CFG/流程图/时序图）
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/api/v1/codegraph/ast',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (handleCorsPreflight(req, res)) return;
        if (!requireMethod(req, res, 'POST')) return;
        logRequest(req, '/api/v1/codegraph/ast');
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          if (!filePath) {
            sendError(res, 400, 'filePath is required', req);
            return;
          }
          const workspacePath = findWorkspacePath(ctx);
          if (!workspacePath) {
            sendError(res, 400, 'No workspace path configured', req);
            return;
          }
          const fullPath = path.resolve(workspacePath, filePath);
          const normalizedWorkspace = path.normalize(workspacePath);
          if (!fullPath.startsWith(normalizedWorkspace + path.sep) && fullPath !== normalizedWorkspace) {
            sendError(res, 403, 'Access denied: path outside workspace', req);
            return;
          }
          const realPath = await fs.realpath(fullPath);
          const realWorkspace = await fs.realpath(normalizedWorkspace);
          if (!realPath.startsWith(realWorkspace + path.sep) && realPath !== realWorkspace) {
            sendError(res, 403, 'Access denied: symlink escape', req);
            return;
          }
          if (!isPathAllowed(realPath)) {
            sendError(res, 403, 'Access denied', req);
            return;
          }
          const content = await fs.readFile(realPath, 'utf-8');
          const MAX_AST_CONTENT = 512 * 1024;
          if (content.length > MAX_AST_CONTENT) {
            sendError(res, 413, `File too large for AST parsing (max ${MAX_AST_CONTENT} bytes)`, req);
            return;
          }
          const astRoot = await sharedTreeSitterAdapter.parseToAst(filePath, content);
          if (!astRoot) {
            sendError(res, 500, `AST parsing failed: parseToAst returned null for ${filePath}`, req);
            return;
          }
          sendJson(res, 200, astRoot, req);
        } catch (e) {
          log.error('ast route failed', e);
          sendError(res, 500, `AST parsing failed: ${e instanceof Error ? e.message : String(e)}`, req);
        }
      },
    });
  }, 'codegraph: ast route');

  // POST /api/v1/codegraph/tree-sitter — FR-20 Tree-sitter 多语言解析
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: '/api/v1/codegraph/tree-sitter',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (handleCorsPreflight(req, res)) return;
        if (!requireMethod(req, res, 'POST')) return;
        logRequest(req, '/api/v1/codegraph/tree-sitter');
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          const content = extractStringField(parsed, 'content');
          if (!filePath || !content) {
            sendError(res, 400, 'filePath and content are required', req);
            return;
          }
          if (filePath.includes('..') || filePath.length > 512) {
            sendError(res, 400, 'Invalid filePath', req);
            return;
          }
          const MAX_TREE_SITTER_CONTENT = 512 * 1024;
          if (content.length > MAX_TREE_SITTER_CONTENT) {
            sendError(res, 413, `Content too large for tree-sitter parsing (max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length})`, req);
            return;
          }
          const result = await sharedTreeSitterAdapter.parseFile(filePath, content);
          sendJson(res, 200, result, req);
        } catch (e) {
          log.error('tree-sitter route failed', e);
          sendError(res, 500, 'Internal server error', req);
        }
      },
    });
  }, 'codegraph: tree-sitter route');

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
}