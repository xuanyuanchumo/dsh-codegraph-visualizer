import { existsSync } from 'node:fs';
import { VALIDATION, ERROR_CODES, ERROR_MESSAGES, API, METRICS } from '../../shared/constants.ts';
import { RepoId } from '../../types/index.ts';
import { fetchMergedGraph } from '../../tools.ts';
import { resolveDbPath } from '../../adapters/CodeGraphAdapter.ts';
import {
  readBody, parseJsonBody, extractStringField, extractBooleanField,
  buildCorsHeaders, sendJson, sendError, requireMethod, logRequest,
  handleCorsPreflight,
} from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveAndValidatePath, slimGraphData, resolveWorkspaceFromRequest,
  triggerBackgroundBuild, type RouteContext, log,
} from './shared.ts';

export function registerScanRoute(rc: RouteContext): void {
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
          const scanPayload = JSON.stringify({ success: true, ...cached.data });
          if (scanPayload.length > API.DATA_RESPONSE_MAX_BYTES) {
            const slimmed = slimGraphData(cached.data, API.DATA_RESPONSE_SLIM_NODES);
            const slimPayload = JSON.stringify({ success: true, ...slimmed });
            const scanHeaders = buildCorsHeaders(req, corsConfig);
            scanHeaders['content-type'] = 'application/json';
            scanHeaders['x-truncated'] = '1';
            res.writeHead(200, scanHeaders);
            res.end(slimPayload);
          } else {
            sendJson(res, 200, { success: true, ...cached.data }, req, corsConfig);
          }
          return;
        }

        const inFlight = deps.getScanInFlight(scanPath);
        if (inFlight) {
          sendJson(res, 200, { success: true, status: 'scanning', message: 'Scan already in progress' }, req, corsConfig);
          return;
        }

        const scanPromise = fetchMergedGraph(invokeUpstream, repoId, 'both')
          .then(raw => slimGraphData(raw, config.maxNodes));
        deps.setScanInFlight(scanPath, scanPromise);

        sendJson(res, 200, { success: true, status: 'scanning', message: 'Scan started, listen to SSE for completion' }, req, corsConfig);

        scanPromise.then(data => {
          if (deps.isDestroyed()) return;
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
          log.info('scan completed (background)', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
        }).catch(e => {
          log.error('scan failed (background)', e);
        }).finally(() => {
          deps.setScanInFlight(scanPath, null);
        });
      } catch (e) {
        log.error('scan route failed', e);
        sendError(res, 500, ERROR_CODES.SCAN_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: scan route');
}

export function registerInitRoute(rc: RouteContext): void {
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
        log.info('init requested (non-blocking)', { path: initPath });

        sendJson(res, 200, {
          success: true,
          status: 'initializing',
          path: initPath,
          message: 'Initialization started, listen to SSE for completion',
          timestamp: Date.now(),
        }, req, corsConfig);

        (async () => {
          try {
            const result = await invokeUpstream('codegraph_init', { path: initPath, force: true });
            if (deps.isDestroyed()) return;
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
              if (deps.isDestroyed()) return;
              const data = slimGraphData(raw, config.maxNodes);
              deps.setLastGraphData(data);
              ctx.emit('codegraph-visualizer/graph/data', {
                repoId: RepoId(repoId),
                nodes: data.nodes,
                edges: data.edges,
                timestamp: data.metadata.timestamp,
              });
              log.info('init completed (background)', { path: initPath, nodes: data.metadata.nodeCount });
            }
          } catch (e) {
            log.error('init failed (background)', e);
            const errorResult = { success: false, path: initPath, message: ERROR_MESSAGES.INIT_FAILED?.en ?? 'Initialization failed', timestamp: Date.now() };
            deps.setLastInitResult(errorResult);
            ctx.emit('codegraph-visualizer/graph/init-result', errorResult);
          }
        })();
      } catch (e) {
        log.error('init route failed', e);
        const errorResult = { success: false, path: '', message: ERROR_MESSAGES.INIT_FAILED?.en ?? 'Initialization failed', timestamp: Date.now() };
        deps.setLastInitResult(errorResult);
        sendError(res, 500, ERROR_CODES.INIT_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: init route');
}

export function registerWatchRoute(rc: RouteContext): void {
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

export function registerEventsRoute(rc: RouteContext): void {
  const { deps, corsConfig } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/events';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: (req, res) => {
      if (handleCorsPreflight(req, res, corsConfig)) return;
      if (!requireMethod(req, res, 'GET', corsConfig)) return;
      logRequest(req, routePath);

      const corsHeaders = buildCorsHeaders(req, corsConfig);
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      const sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const disposers: Array<() => boolean> = [];

      disposers.push(ctx.on('codegraph-visualizer/graph/updated', (event: { repoId?: string; nodeCount?: number; edgeCount?: number; timestamp?: number; changedFiles?: string[] }) => {
        sendEvent('graph-updated', event);
      }));
      disposers.push(ctx.on('codegraph-visualizer/graph/data', (event: { repoId?: string; nodes?: unknown[]; edges?: unknown[]; timestamp?: number; changedFiles?: string[] }) => {
        sendEvent('graph-data', event);
      }));
      // P2-21: targeted updates. Forwarded as its own event so consumers that understand deltas can
      // take the cheap path while anything that does not simply keeps listening to `graph-updated`.
      disposers.push(ctx.on('codegraph-visualizer/graph/delta', (event: { repoId?: string; delta?: unknown; timestamp?: number; changedFiles?: string[] }) => {
        sendEvent('graph-delta', event);
      }));
      disposers.push(ctx.on('codegraph-visualizer/repo/imported', (event: { repoId?: string; timestamp?: number }) => {
        sendEvent('repo-imported', event);
      }));
      disposers.push(ctx.on('codegraph-visualizer/repo/scanned', (event: { repoId?: string; timestamp?: number }) => {
        sendEvent('repo-scanned', event);
      }));
      disposers.push(ctx.on('codegraph-visualizer/graph/init-result', (event: { success?: boolean; path?: string; message?: string; timestamp?: number }) => {
        sendEvent('init-result', event);
      }));

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      const cleanup = () => {
        clearInterval(heartbeat);
        for (const dispose of disposers) {
          try { dispose(); } catch { /* already disposed */ }
        }
      };

      req.on('close', cleanup);
      req.on('error', cleanup);
    },
  }), 'codegraph: events SSE route');
}
// ── cycle-141：管理面板路由 ──────────────────────────────────────────────

/**
 * POST /api/v1/codegraph/manage/delete — 删除原生索引（cycle-141）。
 *
 * ## 幂等与错误语义（frozen contract）
 *
 * - 删掉：HTTP 200 `{ success:true, deleted:true, errorCode:null }`
 * - 不存在：HTTP 200 `{ success:false, deleted:false, errorCode:'INDEX_NOT_FOUND' }`
 *   —— 删除是幂等操作，「没有东西可删」不是服务端错误。
 * - 真失败：HTTP 500 `{ success:false, deleted:false, errorCode:'DELETE_FAILED', error }`
 *
 * 旧实现把 `catch` 也回 200 + `{success:false,error}`，把「磁盘删除失败」与「索引不存在」
 * 压成同一个 HTTP 200，客户端无法区分「再试一次」与「已经干净了」。这里按契约分开。
 *
 * ## 失效缓存与广播（不能只删文件）
 *
 * 删掉索引文件后，host 的 `scanCache` / `scanInFlightMap` 里该路径仍留着上一张图的条目：
 * 下次 `/scan` 会命中 TTL 内的缓存而**重新展示一张已经不存在的图**；在飞的扫描也会把
 * 旧数据写回槽位。所以成功删除后必须：
 *   1. `scanCache.delete(path)` + `setScanInFlight(path, null)`；
 *   2. `ctx.emit('codegraph-visualizer/graph/deleted', { repoId, path, timestamp })`
 *      让客户端丢掉陈旧状态（SSE 消费者据此清空画布）。
 * 只删文件不广播 = 用户看到一张死图。
 */
export function registerManageDeleteRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/manage/delete';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        const deletePath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
        if (deletePath === null) return;

        const { deleteNativeIndex } = await import('../../adapters/nativeIndex.ts');
        const deleted = deleteNativeIndex(deletePath);

        if (!deleted) {
          // 幂等删除：没有可删的索引不是错误，回 200 + INDEX_NOT_FOUND。
          sendJson(res, 200, {
            success: false,
            deleted: false,
            errorCode: ERROR_CODES.INDEX_NOT_FOUND,
          }, req, corsConfig);
          return;
        }

        // 删除成功后必须同时清掉 host 侧缓存，否则 TTL 内的旧图会被再次展示。
        deps.getScanCache().delete(deletePath);
        deps.setScanInFlight(deletePath, null);

        ctx.emit('codegraph-visualizer/graph/deleted', {
          repoId: RepoId(deletePath),
          path: deletePath,
          timestamp: Date.now(),
        });

        sendJson(res, 200, {
          success: true,
          deleted: true,
          errorCode: null,
        }, req, corsConfig);
      } catch (e) {
        log.error('manage delete failed', e);
        sendJson(res, 500, {
          success: false,
          deleted: false,
          errorCode: ERROR_CODES.DELETE_FAILED,
          error: e instanceof Error ? e.message : String(e),
        }, req, corsConfig);
      }
    }),
  }), 'codegraph: manage delete route');
}

/**
 * GET /api/v1/codegraph/manage/metrics?workspace=<abs> — 图指标（数学模型）。
 *
 * ## 为什么必须双重上界（P0 可用性）
 *
 * 旧实现的循环条件只界节点（`allDbNodes.length < 10000`），边侧完全没有界：只要节点数
 * 没到上限，循环就把**全库边**读进内存。代码图谱的边数通常是节点数的 2–5 倍，一个
 * 9 千节点 / 4 万边的仓库就足以让这条路由 OOM。节点与边是**同一处内存护栏的两半**，
 * 缺一即回到旧缺陷。
 *
 * ## 没有索引就必须说「没有」，不能报「健康空图」
 *
 * 旧实现在两个 DB 路径都不存在时照样走 `computeGraphMetrics([], [])`，回
 * `{success:true, metrics:{nodeCount:0,...}}`——面板据此显示「密度 0、PageRank 齐全」的
 * **假健康空图**，用户以为索引正常。现在两个路径都不存在时回
 * `INDEX_NOT_FOUND`（HTTP 200，`metrics:null, truncation:null`）。
 *
 * ## 截断必须如实披露
 *
 * `nodesTotal`/`edgesTotal` 取分页器 `page.stats` 累计到的库内行数；
 * `nodesSampled`/`edgesSampled` 是**实际映射进图**的节点/边数（映射层会过滤噪音路径与
 * 无效行，二者可以不等）。`truncated` 单独给出「没有读到库尾」与「部分行被过滤」两种
 * 采样情形——客户端据此知道这不是全量图。
 */
export function registerManageMetricsRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/manage/metrics';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
        if (!workspacePath) {
          sendJson(res, 200, {
            success: false,
            errorCode: ERROR_CODES.INDEX_NOT_FOUND,
            metrics: null,
            truncation: null,
          }, req, corsConfig);
          return;
        }

        // 内联 DB 路径解析：优先上游 DB，不存在则回落原生索引。
        // 两者都不存在 ⇒ 没有索引，必须如实报 INDEX_NOT_FOUND（见函数头）。
        let dbPath: string | null = null;
        const upstreamDbPath = resolveDbPath(workspacePath);
        if (existsSync(upstreamDbPath)) {
          dbPath = upstreamDbPath;
        } else {
          try {
            const { resolveNativeIndexPath } = await import('../../adapters/nativeIndex.ts');
            const nativePath = resolveNativeIndexPath(workspacePath);
            if (existsSync(nativePath)) dbPath = nativePath;
          } catch (e) {
            log.warn('manage metrics: native index path rejected', e);
          }
        }
        if (!dbPath) {
          sendJson(res, 200, {
            success: false,
            errorCode: ERROR_CODES.INDEX_NOT_FOUND,
            metrics: null,
            truncation: null,
          }, req, corsConfig);
          return;
        }

        const { readGraphFromDbPaged } = await import('../../adapters/codeGraphDb.ts');
        const { mapRowsToGraphNodes, mapRowsToGraphEdges } = await import('../../adapters/codeGraphRows.ts');

        // 双重上界：节点与边各自设上限（见 METRICS 常量注释）。
        const MAX_NODES = METRICS.MAX_NODES;
        const MAX_EDGES = METRICS.MAX_EDGES;
        const PAGE = METRICS.PAGE_SIZE;
        let cursor: string | null = null;
        const allDbNodes = [];
        const allDbEdges = [];
        let nodesTotal = 0;
        let edgesTotal = 0;
        let readExhausted = false;
        for (;;) {
          const page = readGraphFromDbPaged(dbPath, cursor, PAGE);
          // DB 文件在场却读不出一页 = 真实失败（索引损坏 / 连接被拒），不是「空索引」。
          // 若在这里 `break`，就会退化成旧实现的「假健康空图」——正是本路由要消灭的形态。
          if (!page) throw new Error('index database unreadable');
          allDbNodes.push(...page.nodes);
          allDbEdges.push(...page.edges);
          // page.stats 是分页器累计到的库内行数（不是采样子集），用于披露 totals。
          nodesTotal = page.stats.nodeCount;
          edgesTotal = page.stats.edgeCount;
          if (page.nextCursor === null) {
            readExhausted = true;
            break;
          }
          if (allDbNodes.length >= MAX_NODES || allDbEdges.length >= MAX_EDGES) break;
          cursor = page.nextCursor;
        }

        const nodes = mapRowsToGraphNodes(allDbNodes);
        const validNodeIds = new Set(nodes.map((n) => n.id));
        const edges = mapRowsToGraphEdges(allDbEdges, validNodeIds);

        // 重计算必须计时（客户端据此判断指标是否过期）。
        const startedAt = Date.now();
        const { computeGraphMetrics } = await import('../../xuanji/analysis/graphMetrics.ts');
        const metrics = computeGraphMetrics(nodes, edges);
        const computeMs = Date.now() - startedAt;

        const nodesSampled = nodes.length;
        const edgesSampled = edges.length;
        const truncated = !readExhausted
          || nodesTotal !== nodesSampled
          || edgesTotal !== edgesSampled;

        sendJson(res, 200, {
          success: true,
          errorCode: null,
          metrics: {
            nodeCount: metrics.nodeCount,
            edgeCount: metrics.edgeCount,
            density: metrics.density,
            avgClustering: metrics.avgClustering,
            degreeDistribution: metrics.degreeDistribution,
            topBetweenness: metrics.topBetweenness,
            topPageRank: metrics.topPageRank,
            components: metrics.components,
            articulationPoints: metrics.articulationPoints,
            diameter: metrics.diameter,
            avgShortestPath: metrics.avgShortestPath,
            modularity: metrics.modularity,
            cyclomaticNumber: metrics.cyclomaticNumber,
            kCore: metrics.kCore,
            pageRankMass: metrics.pageRankMass,
          },
          truncation: {
            nodesTotal,
            nodesSampled,
            edgesTotal,
            edgesSampled,
            truncated,
            sampled: truncated,
            computeMs,
          },
          computedAt: Date.now(),
        }, req, corsConfig);
      } catch (e) {
        log.error('manage metrics failed', e);
        sendJson(res, 500, {
          success: false,
          errorCode: ERROR_CODES.METRICS_FAILED,
          error: e instanceof Error ? e.message : String(e),
        }, req, corsConfig);
      }
    }),
  }), 'codegraph: manage metrics route');
}

/**
 * POST /api/v1/codegraph/manage/update — 增量更新（codegraph_sync → 重扫）。
 *
 * ## 为什么不能只是 `/scan`
 *
 * 面板的「更新」按钮此前直接调 `/scan`，那是**全量重建**：上游已有索引时白白重扫一遍。
 * 增量路径是 `codegraph_sync`（只同步变更文件）→ 触发一次重扫（`triggerBackgroundBuild`）。
 *
 * ## 契约
 *
 * - 成功：HTTP 200 `{ success:true, errorCode:null, synced:true, scanned:boolean }`
 * - 上游同步不可用/失败：HTTP 200
 *   `{ success:false, errorCode:'SYNC_FAILED', synced:false, scanned:boolean, error? }`
 *   —— `createInvoke` 把任何异常归一成 `null`，所以「上游没装」「工具报错」都表现为
 *   `synced:false`；路由仍尽力触发一次重扫（`scanned` 如实反映是否真的起了扫描），
 *   让用户能看到宿主侧已有图的最新状态。
 */
export function registerManageUpdateRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/manage/update';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const pathInput = extractStringField(parsed, 'path', VALIDATION.MAX_PATH_LENGTH);
        const updatePath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
        if (updatePath === null) return;

        const syncResult = await invokeUpstream('codegraph_sync', { path: updatePath });
        const synced = syncResult !== null;

        // 无论同步成功与否都触发一次重扫：同步失败可能是「上游没装」，
        // 但宿主侧已有的图仍然值得刷新一次（幂等）。
        triggerBackgroundBuild(deps, invokeUpstream, updatePath);
        const scanned = deps.getScanInFlight(updatePath) !== null;

        if (!synced) {
          sendJson(res, 200, {
            success: false,
            errorCode: ERROR_CODES.SYNC_FAILED,
            synced: false,
            scanned,
            error: 'codegraph_sync unavailable or failed',
          }, req, corsConfig);
          return;
        }

        sendJson(res, 200, {
          success: true,
          errorCode: null,
          synced: true,
          scanned,
        }, req, corsConfig);
      } catch (e) {
        log.error('manage update failed', e);
        sendJson(res, 500, {
          success: false,
          errorCode: ERROR_CODES.SYNC_FAILED,
          synced: false,
          scanned: false,
          error: e instanceof Error ? e.message : String(e),
        }, req, corsConfig);
      }
    }),
  }), 'codegraph: manage update route');
}
