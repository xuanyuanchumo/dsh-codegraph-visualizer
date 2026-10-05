import type { Context } from '@deepseek-ai/cordis';

import path from 'node:path';
import { scoped } from '../../shared/Logger.ts';
import { ERROR_CODES } from '../../shared/constants.ts';
import { computeGraphEtag, computeGraphFingerprint } from '../../shared/graphFingerprint.ts';
import type { GraphEtagResource } from '../../shared/graphFingerprint.ts';
import type { GraphData, GraphNode, GraphEdge, IncomingMessage, ServerResponse, IGraphVisualizerService } from '../../types/index.ts';
import { RepoId, NodeId, EdgeId } from '../../types/index.ts';
import { fetchMergedGraph } from '../../tools.ts';
import { createInvoke } from '../../tools.ts';
import type { UpstreamInvoker } from '../../adapters/IAdapter.ts';
import { SecurityManager } from '../security.ts';
import type { WorkspaceRootSource } from '../security.ts';
import { findWorkspacePath, resolveWorkspaceRoots } from '../prerequisites.ts';
import type { VisualizerConfig } from '../config.ts';
import type { ApiCompatLayer, FeatureFlags } from '../compat/index.ts';
import { createRateLimiter } from '../RateLimiter.ts';
import type { GraphRepository } from '../db/GraphRepository.ts';
import {
  validatePathRealpath, buildCorsHeaders, handleCorsPreflight,
  sendError, requireMethod, checkRate, logRequest,
  type CorsConfig,
} from '../HttpHelpers.ts';

export const log = scoped('host');

/**
 * Shape check for a caller-supplied *relative* path. Both separators are accepted on every
 * platform: `path.normalize()` rewrites `/` to `\` on win32, so comparing its output against the
 * raw input rejected perfectly valid forward-slash paths (`src/App.tsx`) while the sibling `/ast`
 * route accepted them. What must stay rejected is traversal and anything absolute.
 */
export function isSafeRelativePath(value: string, maxLength: number): boolean {
  if (!value || value.length > maxLength || value.includes('\0')) return false;
  if (path.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('\\\\')) return false;
  const normalized = path.normalize(value);
  return !normalized.startsWith('..') && !path.isAbsolute(normalized);
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export function withRouteMiddleware(
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
    try {
      await handler(req, res);
    } catch (e) {
      log.error('route handler error', { routePath, error: e });
      if (!res.headersSent) {
        sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
      }
    }
  };
}

export interface WorkspaceRootsRefresh {
  /** Roots the security manager now accepts (raw paths). */
  roots: string[];
  /** Which host source produced the newly resolved roots. */
  source: WorkspaceRootSource;
  /** The roots resolved for this request, regardless of de-duplication. */
  resolved: string[];
}

/**
 * Re-resolve and widen the allowlist before validating a path.
 *
 * The allowlist used to be computed once in `apply()` (`src/index.ts`) and frozen, so a workspace
 * the host registered later — or a registry that was still empty at boot — denied every file route
 * with a bare 403 and no diagnostic (`docs/需求分析.md` §31.7). Roots only ever come from host
 * services (`workspaceRegistry` / `sessions` / the host's own cwd), never from the request, which is
 * why growing the list here cannot be used to read an arbitrary path.
 */
export function ensureWorkspaceRootsAllowed(ctx: Context, deps: RouteDeps): WorkspaceRootsRefresh {
  let resolved: string[] = [];
  let source: WorkspaceRootSource = 'unknown';
  try {
    const resolution = resolveWorkspaceRoots(ctx);
    resolved = resolution.paths;
    source = resolution.source;
    deps.securityManager.addAllowedWorkspaceRoots(resolved, source);
  } catch (e) {
    log.warn('ensureWorkspaceRootsAllowed failed', e);
  }
  const roots = deps.securityManager.getSnapshot().roots;
  return { roots, source, resolved };
}

export async function resolveWorkspaceFromRequest(req: IncomingMessage, ctx: Context, deps: RouteDeps): Promise<string> {
  ensureWorkspaceRootsAllowed(ctx, deps);
  try {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const wsParam = url.searchParams.get('workspace');
    if (wsParam && wsParam !== '.' && deps.securityManager.isPathAllowed(wsParam)) {
      if (await validatePathRealpath(wsParam, deps.securityManager)) {
        return wsParam;
      }
    }
  } catch { /* ignore */ }
  return findWorkspacePath(ctx);
}

export async function resolveAndValidatePath(
  pathInput: string | undefined,
  ctx: Context,
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
): Promise<string | null> {
  ensureWorkspaceRootsAllowed(ctx, deps);
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

export async function resolveAndValidateRelativePath(
  relativePath: string,
  ctx: Context,
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
): Promise<string | null> {
  // Request-scoped: honours `?workspace=<path>` so a caller can address the workspace it is
  // actually looking at instead of whichever workspace the host happens to list first.
  const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
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

export async function validateWorkspacePath(
  ctx: Context,
  deps: RouteDeps,
  req?: IncomingMessage,
): Promise<string | null> {
  let workspacePath: string;
  if (req) {
    workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
  } else {
    ensureWorkspaceRootsAllowed(ctx, deps);
    workspacePath = findWorkspacePath(ctx);
  }
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

/**
 * 304 短路：客户端带来的校验值与 `serverEtag` 完全一致时回 304 并返回 `true`。
 *
 * 本函数只负责"比较并回包"，**不负责决定校验值是什么**——校验值的构造必须由调用方通过
 * `returnIfEtagMatch` 传入身份与资源维度，否则就会退化成"校验器与被校验资源无关"。
 */
export function checkEtag(
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

/**
 * 用**资源身份**（repoId + revision）与**资源维度**构造校验值，再交给 `checkEtag` 比较。
 *
 * `resource` 是必填参数，理由见 `computeGraphEtag`：缺少资源维度，"拿 `/data` 的校验值让 `/children`
 * 回 304"就重新成立——同一条"校验器与被校验资源无关"的缺陷换了个形状。
 *
 * `repoId` 传**请求方声明的工作区**（`resolveWorkspaceFromRequest()` 的结果）。这样校验值对
 * `(工作区, 版本, 资源)` 三元组单射：两个不同的请求永远不会算出同一个校验值。调用方必须先解析工作区、
 * 再调本函数（顺序反了就等于把身份维度丢掉一半）。
 *
 * `repoId` 省略时回落到槽自身的 `metadata.repoId`——`/data` 返回的就是这个槽，没有请求方工作区可言。
 *
 * 为什么身份维度可以取"请求方声明的工作区"，而 revision 必须取槽的：这两类错误的代价不对称。校验值
 * 多算一次不匹配，只是多回一次 200、少省一次传输；而假 304 会让客户端保留过期数据并**静默丢弃一次
 * 真实更新**（P0-R16-01 的同类机理）。取请求方工作区只会让校验值更难撞上，方向是安全的。
 */
export function returnIfEtagMatch(
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: CorsConfig,
  deps: RouteDeps,
  resource: GraphEtagResource,
  repoId?: string | null | undefined,
): boolean {
  const cachedData = deps.getLastGraphData();
  if (!cachedData) return false;
  const etag = computeGraphEtag(repoId ?? cachedData.metadata.repoId, cachedData.metadata.timestamp, resource);
  return checkEtag(req, res, corsConfig, etag);
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
  graphRepo?: GraphRepository | undefined;
  isDestroyed: () => boolean;
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

export function createInvokeUpstream(ctx: Context, config: VisualizerConfig, apiCompat?: ApiCompatLayer) {
  return createInvoke(ctx, config.requestTimeout, apiCompat);
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

export interface RouteContext {
  deps: RouteDeps;
  corsConfig: CorsConfig;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  invokeUpstream: ReturnType<typeof createInvokeUpstream>;
}

export function triggerBackgroundBuild(
  deps: RouteDeps,
  invokeUpstream: ReturnType<typeof createInvokeUpstream>,
  workspacePath: string,
): void {
  const existing = deps.getScanInFlight(workspacePath);
  if (existing) return;

  const cached = deps.getScanCache().get(workspacePath);
  if (cached && Date.now() - cached.timestamp < deps.config.scanCacheTtl) return;

  const repoId = workspacePath || `workspace-${Date.now()}`;

  // Prefer a bootstrap-capable upstream tool when the host actually exposes one. This used to be
  // gated on the generation-derived `incrementalBootstrap` flag, which can only produce a false
  // negative: DSH exposes no host-version API (see docs/research/dsh-0.2.0-插件API权威基线.md),
  // sibling tools mount after our own apply() runs, and the live 0.2.0-rc.2 host resolves to
  // `unknown` (J0). `getAvailableToolName` already applies the per-generation mapping plus the
  // `codegraph_init` fallback chain, so tool availability is the honest signal here.
  const bootstrapTool = deps.apiCompat
    ? deps.apiCompat.getAvailableToolName(deps.ctx, 'codegraphBootstrap')
    : null;

  let scanPromise: Promise<GraphData>;
  if (bootstrapTool) {
    log.info('background build: upstream bootstrap tool available', { tool: bootstrapTool, workspace: workspacePath });
    scanPromise = invokeUpstream(bootstrapTool, { path: workspacePath })
      .then(() => fetchMergedGraph(invokeUpstream, repoId, 'both'))
      .then(raw => slimGraphData(raw, deps.config.maxNodes));
  } else {
    scanPromise = fetchMergedGraph(invokeUpstream, repoId, 'both')
      .then(raw => slimGraphData(raw, deps.config.maxNodes));
  }

  deps.setScanInFlight(workspacePath, scanPromise);

  scanPromise.then(data => {
    if (deps.isDestroyed()) return;
    deps.setLastGraphData(data);
    deps.getScanCache().set(workspacePath, { data, timestamp: Date.now() });
    // P0-6: key snapshots by structural fingerprint, never by timestamp. The old
    // `${nodeCount}:${edgeCount}:${timestamp}` hash changed on every scan, so the
    // idx_snapshots_repo_hash UNIQUE constraint could never fire and pruneSnapshots was the only
    // bound on table growth. An unchanged graph now short-circuits the write entirely.
    const fingerprint = computeGraphFingerprint(data);
    const graphRepo = deps.graphRepo;
    if (graphRepo?.isReady()) {
      try {
        const previous = graphRepo.getLatestSnapshot(repoId);
        if (previous?.snapshotHash !== fingerprint) {
          const serialized = Buffer.from(JSON.stringify({ nodes: data.nodes, edges: data.edges, metadata: data.metadata }), 'utf-8');
          graphRepo.saveSnapshot(repoId, fingerprint, data.metadata.nodeCount, data.metadata.edgeCount, serialized);
        } else {
          log.debug('snapshot unchanged, skipping write', { repoId, fingerprint });
        }
      } catch (e) { log.warn('snapshot save failed', e); }
    }
    const { ctx } = deps;
    ctx.emit('codegraph-visualizer/graph/updated', {
      repoId: RepoId(repoId),
      nodeCount: data.metadata.nodeCount,
      edgeCount: data.metadata.edgeCount,
      timestamp: data.metadata.timestamp,
      fingerprint,
    });
    ctx.emit('codegraph-visualizer/graph/data', {
      repoId: RepoId(repoId),
      nodes: data.nodes,
      edges: data.edges,
      timestamp: data.metadata.timestamp,
      fingerprint,
    });
    log.info('background build completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount, fingerprint });
  }).catch(e => {
    log.error('background build failed', e);
  }).finally(() => {
    deps.setScanInFlight(workspacePath, null);
  });
}