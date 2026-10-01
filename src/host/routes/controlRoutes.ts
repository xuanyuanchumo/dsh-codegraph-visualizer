import { VALIDATION, ERROR_CODES, ERROR_MESSAGES, API } from '../../shared/constants.ts';
import { RepoId } from '../../types/index.ts';
import { fetchMergedGraph } from '../../tools.ts';
import {
  readBody, parseJsonBody, extractStringField, extractBooleanField,
  buildCorsHeaders, sendJson, sendError, requireMethod, logRequest,
  handleCorsPreflight,
} from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveAndValidatePath, slimGraphData,
  type RouteContext, log,
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