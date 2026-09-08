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
    .filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target))
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
        } catch { return null; }
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
        return ctx.on('codegraph/graph/data', (event) => {
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
  return GIT_REF_PATTERN.test(ref);
}

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = createInvokeUpstream(ctx, config);
  const origins = config.allowedOrigins;

  const sendJson = (res: ServerResponse, code: number, data: unknown, req?: IncomingMessage): void => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match',
    };
    if (origins.length > 0) {
      const reqOrigin = req?.headers?.['origin'];
      if (typeof reqOrigin === 'string' && origins.includes(reqOrigin)) {
        headers['access-control-allow-origin'] = reqOrigin;
      } else if (origins.length === 1) {
        headers['access-control-allow-origin'] = origins[0]!;
      }
    }
    res.writeHead(code, headers);
    res.end(JSON.stringify(data));
  };

  const sendError = (res: ServerResponse, code: number, message: string, req?: IncomingMessage): void => {
    sendJson(res, code, { success: false, error: message }, req);
  };

  const handleCorsPreflight = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'OPTIONS') return false;
    const headers: Record<string, string> = {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match',
    };
    if (origins.length > 0) {
      const reqOrigin = req.headers?.['origin'];
      if (typeof reqOrigin === 'string' && origins.includes(reqOrigin)) {
        headers['access-control-allow-origin'] = reqOrigin;
      } else if (origins.length === 1) {
        headers['access-control-allow-origin'] = origins[0]!;
      }
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  };

  // GET /api/v1/codegraph/status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/status',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      const status = checkPrerequisites(ctx);
      sendJson(res, 200, { codegraph: status.codegraph, lens: status.lens });
    },
  }), 'codegraph: status route');

  // GET /api/v1/codegraph/workspace
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/workspace',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      const current = findWorkspacePath(ctx);
      const list = extractWorkspacePaths(ctx);
      sendJson(res, 200, { path: current, list });
    },
  }), 'codegraph: workspace route');

  // GET /api/v1/codegraph/data
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/data',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
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
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } });
      }
    },
  }), 'codegraph: data route');

  // POST /api/v1/codegraph/scan
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/scan',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed');
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

        const inFlight = deps.getScanInFlight(scanPath);
        if (inFlight) {
          const data = await inFlight;
          sendJson(res, 200, { success: true, ...data });
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
          ctx.emit('codegraph/graph/updated', {
            repoId: RepoId(repoId),
            nodeCount: data.metadata.nodeCount,
            edgeCount: data.metadata.edgeCount,
            timestamp: data.metadata.timestamp,
          });
          ctx.emit('codegraph/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
          log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
          sendJson(res, 200, { success: true, ...data });
        } catch (e) {
          deps.setScanInFlight(scanPath, null);
          throw e;
        }
      } catch (e) {
        log.error('scan failed', e);
        sendError(res, 500, 'Internal server error');
      }
    },
  }), 'codegraph: scan route');

  // POST /api/v1/codegraph/init
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/init',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed');
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
          const raw = await fetchMergedGraph(invokeUpstream, repoId, 'both');
          const data = slimGraphData(raw, config.maxNodes);
          deps.setLastGraphData(data);
          ctx.emit('codegraph/graph/data', {
            repoId: RepoId(repoId),
            nodes: data.nodes,
            edges: data.edges,
            timestamp: data.metadata.timestamp,
          });
        }
        sendJson(res, 200, initResult);
      } catch (e) {
        log.error('init route failed', e);
        const errorResult = {
          success: false,
          path: '',
          message: 'Initialization failed',
          timestamp: Date.now(),
        };
        deps.setLastInitResult(errorResult);
        sendError(res, 500, 'Internal server error');
      }
    },
  }), 'codegraph: init route');

  // POST /api/v1/codegraph/watch
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/watch',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const enabled = extractBooleanField(parsed, 'enabled');
        const path = extractStringField(parsed, 'path');
        if (path && path !== '.' && !isPathAllowed(path)) {
          sendError(res, 403, 'Path not allowed');
          return;
        }
        const watchPath = path && path !== '.' ? path : findWorkspacePath(ctx);
        ctx.emit('codegraph/watch/toggle', { enabled: !!enabled, path: watchPath, timestamp: Date.now() });
        sendJson(res, 200, { success: true, enabled: !!enabled, path: watchPath });
      } catch {
        sendError(res, 500, 'Internal server error');
      }
    },
  }), 'codegraph: watch route');

  // GET /api/v1/codegraph/dependencies — FR-21 第三方依赖图谱
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/dependencies',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      try {
        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } });
          return;
        }
        if (!isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed');
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

        sendJson(res, 200, {
          nodes: allDepNodes,
          edges: allDepEdges,
          metadata: {
            repoId: RepoId(workspacePath),
            timestamp: Date.now(),
            nodeCount: allDepNodes.length,
            edgeCount: allDepEdges.length,
          },
        });
      } catch (e) {
        log.error('dependencies route failed', e);
        sendError(res, 500, 'Internal server error');
      }
    },
  }), 'codegraph: dependencies route');

  // POST /api/v1/codegraph/diff — FR-24 版本对比图谱
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/codegraph/diff',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (handleCorsPreflight(req, res)) return;
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const fromCommit = extractStringField(parsed, 'from');
        const toCommit = extractStringField(parsed, 'to');
        if (!fromCommit || !toCommit) {
          sendError(res, 400, 'from and to commits are required');
          return;
        }
        if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
          sendError(res, 400, 'Invalid git ref format');
          return;
        }

        const workspacePath = findWorkspacePath(ctx);
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } });
          return;
        }
        if (!isPathAllowed(workspacePath)) {
          sendError(res, 403, 'Workspace path not allowed');
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
        });
      } catch (e) {
        log.error('diff route failed', e);
        sendError(res, 500, 'Internal server error');
      }
    },
  }), 'codegraph: diff route');

  // POST /api/v1/codegraph/tree-sitter — FR-20 Tree-sitter 多语言解析
  ctx.effect(() => {
    const treeSitterAdapter = new TreeSitterAdapter();
    return ctx.webServer.register({
      kind: 'exact',
      path: '/api/v1/codegraph/tree-sitter',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (handleCorsPreflight(req, res)) return;
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          const content = extractStringField(parsed, 'content');
          if (!filePath || !content) {
            sendError(res, 400, 'filePath and content are required');
            return;
          }
          const MAX_TREE_SITTER_CONTENT = 512 * 1024;
          if (content.length > MAX_TREE_SITTER_CONTENT) {
            sendError(res, 413, `Content too large for tree-sitter parsing (max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length})`);
            return;
          }
          const result = await treeSitterAdapter.parseFile(filePath, content);
          sendJson(res, 200, result);
        } catch (e) {
          log.error('tree-sitter route failed', e);
          sendError(res, 500, 'Internal server error');
        }
      },
    });
  }, 'codegraph: tree-sitter route');
}