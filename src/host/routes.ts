import { TreeSitterAdapter, isTreeSitterRuntimePresent } from '../adapters/TreeSitterAdapter.ts';
import { setAstSourceProbe } from './prerequisites.ts';
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
  registerManageDeleteRoute,
  registerManageMetricsRoute,
  registerManageUpdateRoute,
} from './routes/controlRoutes.ts';
import {
  registerDependenciesRoute,
  registerChurnRoute,
  registerDiffRoute,
  registerAstRoute,
  registerTreeSitterRoute,
} from './routes/analysisRoutes.ts';
import { registerLayoutWorkerRoute } from './routes/workerRoutes.ts';
import { registerKeywordQueryRoute } from './routes/queryRoute.ts';
import { registerPathsRoute } from './routes/pathsRoute.ts';
import { registerRegistryRoute } from './routes/registryRoute.ts';
import { registerViewsRoute } from './routes/viewsRoute.ts';
import { resetSnapshotShrinkState } from './compat/index.ts';

export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config } = deps;
  const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);
  const corsConfig: CorsConfig = { origins: config.allowedOrigins };
  const rateLimiter = createRateLimiter();
  const sharedTreeSitterAdapter = new TreeSitterAdapter();

  /**
   * 把「AST 分析通道是否可用」接进能力位（`docs/需求分析.md` §61.10）。
   *
   * 能力位由 `checkPrerequisites(ctx)` 在**每次请求**里同步计算，而它拿不到适配器实例 ——
   * 所以这里把探针登记到模块级槽位，让那条同步路径能读到这个实例的真实状态。
   * 判据是「已初始化 **或** 运行时包可解析」：只用 `isAvailable()` 会在启动后很长一段时间
   * 恒为 false（初始化发生在第一次解析时），见 `isTreeSitterRuntimePresent` 的注释。
   *
   * 探针失败必须落到 `false` 而不是 `true`：这里任何异常都不该冒泡进 `checkPrerequisites`
   * 的 `catch` 分支（那会把 `codegraph` / `lens` 的真实探测结果一起丢掉）。
   */
  const probeAstSource = (): boolean => {
    try {
      return sharedTreeSitterAdapter.isAvailable() || isTreeSitterRuntimePresent();
    } catch {
      return false;
    }
  };
  ctx.effect(() => setAstSourceProbe(probeAstSource), 'codegraph: ast source capability probe');

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
  registerManageDeleteRoute(rc);
  registerManageMetricsRoute(rc);
  registerLayoutWorkerRoute(rc);
  // 变更频率（研究报告 §六 #11）刻意注册在**最后**：`registerRoutes` 的调用顺序
  // 就是 `webServer.register` 的调用顺序，而既有测试大量用「第 N 次注册」定位路由
  // （`getHandler(ctx, 3)`）。把它插在中间会让十几个无关用例整体错位一格，
  // 那种「改一个新增功能、红一片无关测试」的改动无法证明自己是对的。
  // 所有路由都是 `kind: 'exact'` 的精确路径，注册顺序不影响匹配语义。
  registerChurnRoute(rc);
  // 关键词图检索（cycle-111 / N-5）追加在 churn **之后**，理由同上：
  // 既有用例最高只引到 churn 这一格（索引 20），把新路由放在它前面会让 churn 变成 21，
  // 而 `getHandler(ctx, 20)` 一类断言就会错位。追加是唯一「零错位」的位置——
  // 代价是新路由的索引依赖 churn 先注册，因此两行必须保持相邻（下面有守卫测试）。
  registerKeywordQueryRoute(rc);
  registerPathsRoute(rc);
  // cycle-116 可观测性主轴：注册-生产-消费矩阵看板（四面全量清单 + 断链判定）。
  registerRegistryRoute(rc);
  // cycle-141：管理面板「更新」路由（codegraph_sync → 重扫）。
  // 刻意追加在**最后**：既有测试大量用「第 N 次注册」定位路由（`getHandler(ctx, N)`），
  // 插在中间会让一大片无关用例整体错位一格。所有路由都是 `kind: 'exact'` 的精确路径，
  // 注册顺序不影响匹配语义。代价是本路由的索引（24）依赖前面所有路由先注册。
  registerManageUpdateRoute(rc);
  // cycle-141 workstream E：Π 视图划分的用户侧出口（`/api/v1/codegraph/views`）。
  // 同样刻意追加在**最后**：既有测试用「第 N 次注册」定位路由（`getHandler(ctx, N)`），
  // 插在中间会让一大片无关用例整体错位一格。所有路由都是 `kind: 'exact'` 的精确路径，
  // 注册顺序不影响匹配语义。代价是本路由的索引（25）依赖前面所有路由先注册。
  registerViewsRoute(rc);

  ctx.effect(() => () => rateLimiter.reset(), 'codegraph: rate limiter cleanup');
  ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), 'codegraph: tree-sitter adapter cleanup');
  // 快照防缩水守卫的「上一轮被拒指纹」是模块级状态：必须随插件卸载清空，
  // 否则同一进程内重新加载插件（HMR / profile 重载）会继承上一轮的拒绝记录，
  // 让本该被拦下的第一次缩水写入直接以「两次确认」放行。
  ctx.effect(() => () => resetSnapshotShrinkState(), 'codegraph: snapshot shrink guard reset');
}
