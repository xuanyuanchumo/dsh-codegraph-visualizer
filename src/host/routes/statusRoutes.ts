import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from '../prerequisites.ts';
import { sendJson } from '../HttpHelpers.ts';
import { withRouteMiddleware, type RouteContext } from './shared.ts';

export function registerStatusRoute(rc: RouteContext): void {
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

export function registerHealthRoute(rc: RouteContext): void {
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

export function registerWorkspaceRoute(rc: RouteContext): void {
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