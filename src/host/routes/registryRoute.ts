import { sendJson } from '../HttpHelpers.ts';
import { withRouteMiddleware, type RouteContext } from './shared.ts';
import { registrySummary } from '../registry/businessRegistry.ts';

/**
 * 业务注册-生产-消费矩阵路由（cycle-116 可观测性主轴）。
 *
 * 返回四面（tools/routes/entries/skill）全量清单 + 断链判定 + 生命周期五态计数。
 * 白盒透明化：任何「注册了但没人消费」的业务在这里直接可见（brokenLinks 非空即断链）。
 * 该路由本身也登记进 ROUTE_ENTRIES？不——看板不观测自己（自引用会造出无限清单），
 * 本路由由 routes.test.ts 的注册数守卫覆盖。
 */
export function registerRegistryRoute(rc: RouteContext): void {
  const { corsConfig, rateLimiter } = rc;
  const { ctx } = rc.deps;
  const routePath = '/api/v1/codegraph/registry';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      sendJson(res, 200, registrySummary(), req, corsConfig);
    }),
  }), 'codegraph: registry route');
}
