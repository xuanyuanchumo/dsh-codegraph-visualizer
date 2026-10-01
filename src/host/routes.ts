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
  registerDiffRoute,
  registerAstRoute,
  registerTreeSitterRoute,
} from './routes/analysisRoutes.ts';

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

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
  ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), 'codegraph: tree-sitter adapter cleanup');
}
