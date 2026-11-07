import { findWorkspacePath, extractWorkspacePaths, checkPrerequisites } from '../prerequisites.ts';
import { sendJson } from '../HttpHelpers.ts';
import { computeGraphFingerprint } from '../../shared/graphFingerprint.ts';
import { isGraphServiceHealthy, diagnosePrerequisiteStatus } from '../../shared/prerequisiteStatus.ts';
import { withRouteMiddleware, ensureWorkspaceRootsAllowed, type RouteContext } from './shared.ts';
import { registrySummary, probeRegistry, countLive } from '../registry/businessRegistry.ts';

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
        // 「AST 分析通道」与「图数据通道」是两个不同的能力位（docs/需求分析.md §61.10）。
        // 客户端据此决定空态是否显示降级提示，宿主据此决定 `/health` 的 healthy。
        astSource: status.astSource,
        graphSource: status.graphSource,
        // Diagnostics only: the generation-dated capability record resolved at boot. Runtime
        // behaviour is decided by which upstream tools are actually available, not by these flags.
        compat: deps.featureFlags ?? null,
        // cycle-116 可观测性：注册-生产-消费矩阵摘要（四面计数 + 断链清单）。
        // additive 字段：旧客户端不读无影响；运维/测试用它白盒检查业务连通性。
        registry: { ...registrySummary(), liveCounts: countLive(probeRegistry(deps)) },
        // cycle-146 T146-2：诊断四态 + 稳定问题码（ready/degraded/disabled/not-selected）。
        // additive 字段：管理面板按 code 渲染修复指引；旧客户端不读无影响。
        diagnosis: diagnosePrerequisiteStatus(status),
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
        // 修前是 `codegraph || lens || builtin`，而 `builtin` 被硬编码为 `true` ⇒ 恒 healthy，
        // 「degraded」这条分支从未在任何宿主上出现过。`astSource` 刻意不参与判定：
        // 「能做 AST 分析」不等于「能画出一张图」，把两者当成一件事正是旧实现恒真的原因。
        const healthy = isGraphServiceHealthy(status);
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? 'healthy' : 'degraded',
          codegraph: status.codegraph,
          lens: status.lens,
          // 两个内置能力位都上报（判定只用了 graphSource），这样 503 时能一眼看出
          // 「是 AST 有、图没有」还是「两个都没有」。
          astSource: status.astSource,
          graphSource: status.graphSource,
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