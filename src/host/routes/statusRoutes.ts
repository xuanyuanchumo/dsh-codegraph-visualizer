import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from '../prerequisites.ts';
import { sendJson } from '../HttpHelpers.ts';
import { computeGraphFingerprint } from '../../shared/graphFingerprint.ts';
import { withRouteMiddleware, ensureWorkspaceRootsAllowed, type RouteContext } from './shared.ts';

export function registerStatusRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/status';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const status = checkPrerequisites(ctx, deps.apiCompat);
      sendJson(res, 200, {
        codegraph: status.codegraph,
        lens: status.lens,
        builtin: status.builtin,
        // Diagnostics only: the generation-dated capability record resolved at boot. Runtime
        // behaviour is decided by which upstream tools are actually available, not by these flags.
        compat: deps.featureFlags ?? null,
      }, req, corsConfig);
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
        const status = checkPrerequisites(ctx, deps.apiCompat);
        const mem = process.memoryUsage();
        const lastGraph = deps.getLastGraphData();
        const hasGraphData = lastGraph !== null;
        const healthy = status.codegraph || status.lens || status.builtin;
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? 'healthy' : 'degraded',
          codegraph: status.codegraph,
          lens: status.lens,
          builtin: status.builtin,
          hasGraphData,
          // P0-6: the current structural fingerprint, so an operator can tell whether the graph
          // in memory actually changed without diffing nodes/edges by hand.
          fingerprint: lastGraph ? computeGraphFingerprint(lastGraph) : null,
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
      // Observability for docs/需求分析.md §31.7: a rejected file route used to be diagnosable only
      // by reading the process's memory. The allowlist is local-only (host-provided roots).
      const refresh = ensureWorkspaceRootsAllowed(ctx, deps);
      sendJson(res, 200, {
        path: current,
        list,
        allowedRoots: refresh.roots,
        rootSource: refresh.source,
        resolvedFrom: refresh.resolved,
      }, req, corsConfig);
    }),
  }), 'codegraph: workspace route');
}