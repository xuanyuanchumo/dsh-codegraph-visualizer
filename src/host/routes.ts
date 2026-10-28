import { TreeSitterAdapter } from '../adapters/TreeSitterAdapter.ts';
import { createRateLimiter } from './RateLimiter.ts';
import type { CorsConfig } from './HttpHelpers.ts';

export type { RouteDeps } from './routes/shared.ts';
export { slimGraphData, createInvokeUpstream, registerService } from './routes/shared.ts';

import {
  createInvokeUpstream,
  type RouteContext, type RouteDeps,
} from './routes/shared.ts';
import {
  registerStatusRoute,
  registerHealthRoute,
  registerWorkspaceRoute,
} from './routes/statusRoutes.ts';
import {
  registerDataRoute,
  registerBootstrapRoute,
  registerNodeChildrenRoute,
  registerFileOutlineRoute,
  registerSymbolASTRoute,
  registerEdgesRoute,
} from './routes/dataRoutes.ts';
import {
  registerScanRoute,
  registerInitRoute,
  registerWatchRoute,
  registerEventsRoute,
} from './routes/controlRoutes.ts';
import {
  registerDependenciesRoute,
  registerChurnRoute,
  registerDiffRoute,
  registerAstRoute,
  registerTreeSitterRoute,
} from './routes/analysisRoutes.ts';
import { registerLayoutWorkerRoute } from './routes/workerRoutes.ts';
import { resetSnapshotShrinkState } from './compat/index.ts';

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);
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
  registerBootstrapRoute(rc);
  registerNodeChildrenRoute(rc);
  registerFileOutlineRoute(rc);
  registerSymbolASTRoute(rc);
  registerEdgesRoute(rc);
  registerEventsRoute(rc);
  registerLayoutWorkerRoute(rc);
  // 变更频率（研究报告 §六 #11）刻意注册在**最后**：`registerRoutes` 的调用顺序
  // 就是 `webServer.register` 的调用顺序，而既有测试大量用「第 N 次注册」定位路由
  // （`getHandler(ctx, 3)`）。把它插在中间会让十几个无关用例整体错位一格，
  // 那种「改一个新增功能、红一片无关测试」的改动无法证明自己是对的。
  // 所有路由都是 `kind: 'exact'` 的精确路径，注册顺序不影响匹配语义。
  registerChurnRoute(rc);

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
  ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), 'codegraph: tree-sitter adapter cleanup');
  // 快照防缩水守卫的「上一轮被拒指纹」是模块级状态：必须随插件卸载清空，
  // 否则同一进程内重新加载插件（HMR / profile 重载）会继承上一轮的拒绝记录，
  // 让本该被拦下的第一次缩水写入直接以「两次确认」放行。
  ctx.effect(() => () => resetSnapshotShrinkState(), 'codegraph: snapshot shrink guard reset');
}
