import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools } from './tools.ts';
import { scoped } from './shared/Logger.ts';
import type { GraphData } from './types/index.ts';
import { PLUGIN_VERSION } from './generated/version.ts';
import { resolveConfig } from './host/config.ts';
import type { VisualizerConfig } from './host/config.ts';
import { createSecurityManager } from './host/security.ts';
import { extractWorkspacePaths, checkPrerequisites } from './host/prerequisites.ts';
import { createInvokeUpstream, registerRoutes, registerService } from './host/routes.ts';
import { registerWatcher, registerEventListeners } from './host/watcher.ts';
import { McpServer } from './host/McpServer.ts';
import { closeAllDbConnections } from './adapters/CodeGraphAdapter.ts';
import { detectHostVersion, createFeatureFlags, createApiCompatLayer, createHostCapabilityProbe } from './host/compat/index.ts';
import { GraphRepository } from './host/db/GraphRepository.ts';
import { contributeGraphSkill } from './host/skills.ts';


export { PLUGIN_VERSION };
export { resolveConfig, DEFAULT_CONFIG } from './host/config.ts';
export type { VisualizerConfig } from './host/config.ts';
export { SecurityManager, createSecurityManager } from './host/security.ts';

const log = scoped('host');

export const name = 'dsh-codegraph-visualizer';
// Required services only. `workspaceRegistry` is a gen2-only (DSH >=0.2) capability;
// declaring it here would make the whole plugin INACTIVE on gen1/minimal hosts
// (Cordis fiber inject must be fully satisfied). It is probed optionally at runtime
// via ctx.get() in host/prerequisites.ts.
export const inject = ['tools', 'webServer', 'sessions'];

export async function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>) {
  closeAllDbConnections();
  const config = resolveConfig(userConfig);
  const securityManager = createSecurityManager();
  securityManager.setAllowedWorkspaceRoots(extractWorkspacePaths(ctx));

  const hostVersionInfo = detectHostVersion(ctx);
  // The probe only ever switches capabilities ON (see resolveFeatureFlags), so a host whose
  // generation we cannot date still gets the capabilities it visibly advertises.
  const featureFlags = createFeatureFlags(hostVersionInfo, createHostCapabilityProbe(ctx));
  const apiCompat = createApiCompatLayer(hostVersionInfo);

  const workspacePaths = extractWorkspacePaths(ctx);
  const primaryWorkspace = workspacePaths[0] ?? process.cwd();
  const graphRepo = new GraphRepository(primaryWorkspace);
  const repoReady = graphRepo.init();
  if (!repoReady) { log.warn('graph repository init failed, persistence disabled'); }

  const { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphPathEnumerate, graphPathPattern, graphCycles, graphHealth, graphRulesCheck, graphFocus, graphQuery, graphIntegrity, dispose: disposeGraphTools } = await createGraphTools(ctx, { requestTimeout: config.requestTimeout, apiCompat, nativeWorkspaceRoot: primaryWorkspace });

  ctx.effect(() => {
    const d1 = ctx.tools.register(graphStatus);
    const d2 = ctx.tools.register(graphData);
    const d3 = ctx.tools.register(graphSymbol);
    const d4 = ctx.tools.register(graphImpact);
    const d5 = ctx.tools.register(graphPathFind);
    const d6 = ctx.tools.register(graphHealth);
    const d7 = ctx.tools.register(graphRulesCheck);
    const d8 = ctx.tools.register(graphFocus);
    const d9 = ctx.tools.register(graphPathEnumerate);
    const d10 = ctx.tools.register(graphCycles);
    const d11 = ctx.tools.register(graphQuery);
    const d12 = ctx.tools.register(graphIntegrity);
    // cycle-134：路径模式 ρ 读法（序列约束的图谱查询）。
    const d13 = ctx.tools.register(graphPathPattern);
    return () => { d1(); d2(); d3(); d4(); d5(); d6(); d7(); d8(); d9(); d10(); d11(); d12(); d13(); };
  }, 'codegraph: tool registrations');

  let lastGraphData: GraphData | null = null;
  let lastInitResult: { success: boolean; path: string; message: string; timestamp: number } | null = null;
  const scanInFlightMap = new Map<string, Promise<GraphData>>();
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();
  let destroyed = false;

  const invokeUpstream = createInvokeUpstream(ctx, config, apiCompat);

  const routeDeps = {
    ctx,
    config,
    securityManager,
    invokeUpstream,
    apiCompat,
    featureFlags,
    getLastGraphData: () => lastGraphData,
    setLastGraphData: (data: GraphData | null) => { lastGraphData = data; },
    getLastInitResult: () => lastInitResult,
    setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => { lastInitResult = data; },
    getScanCache: () => scanCache,
    getScanInFlight: (path: string) => scanInFlightMap.get(path) ?? null,
    setScanInFlight: (path: string, p: Promise<GraphData> | null) => {
      if (p === null) scanInFlightMap.delete(path);
      else scanInFlightMap.set(path, p);
    },
    graphRepo: repoReady ? graphRepo : undefined,
    isDestroyed: () => destroyed,
  };

  registerService(routeDeps);
  registerRoutes(routeDeps);

  // 把 11 个 graph_* 工具注册成一条运行时 Skill（`ctx.skills.register`）。
  //
  // 为什么放在这里而不是放进静态 `inject`：`skills` 是可选服务，写进静态 inject 会让
  // 「宿主没挂 skill 子系统」的 profile 把**整个插件**置为 INACTIVE —— 拿一条可选指令换
  // 插件不加载是不可接受的（与客户端 `betterSidebar`/`commandUi` 的处置同源）。
  // `contributeGraphSkill` 内部用响应式 `ctx.inject(['skills'], …)`，依赖不到齐只是
  // 静默不贡献，不影响工具与路由。
  //
  // 返回值刻意不丢：它是「模型侧到底有没有这条指令」的唯一证据，也是失败时唯一的原因来源。
  const skillContribution = contributeGraphSkill(ctx);
  ctx.effect(() => () => {
    // Skill 的 disposer 由 contributeGraphSkill 内部的 scope.effect 管理，
    // 这里只做一次状态收尾（没有要撤销的外部资源，保留钩子是为了将来加审计）。
    if (!skillContribution.registered) {
      log.info('codegraph skill not active on this host', { reason: skillContribution.reason });
    }
  }, 'codegraph: skill contribution summary');


  let lastStatus = '';
  /**
   * 变化检测键。包含**四个**位：`astSource` / `graphSource` 是独立能力，只看 codegraph/lens
   * 会让"通道位翻转了但日志一声不响"，而那条 `prerequisite status` 日志是排查
   * `docs/需求分析.md` §61.10 那类假叙事时唯一的线索。
   */
  const prereqStatusKey = (s: ReturnType<typeof checkPrerequisites>): string =>
    `${s.codegraph}:${s.lens}:${s.astSource}:${s.graphSource}`;
  const emitPrereqStatus = () => {
    const status = checkPrerequisites(ctx, apiCompat);
    ctx.emit('codegraph-visualizer/prerequisite/status', {
      codegraph: status.codegraph,
      lens: status.lens,
      astSource: status.astSource,
      graphSource: status.graphSource,
      timestamp: Date.now(),
    });
    const statusKey = prereqStatusKey(status);
    if (statusKey !== lastStatus) {
      log.info('prerequisite status', status);
      lastStatus = statusKey;
    }
  };
  emitPrereqStatus();
  ctx.effect(() => {
    let pollCount = 0;
    const MAX_POLLS = 6;
    const prereqTimer = setInterval(() => {
      pollCount++;
      const status = checkPrerequisites(ctx, apiCompat);
      ctx.emit('codegraph-visualizer/prerequisite/status', {
        codegraph: status.codegraph,
        lens: status.lens,
        astSource: status.astSource,
        graphSource: status.graphSource,
        timestamp: Date.now(),
      });
      const statusKey = prereqStatusKey(status);
      if (statusKey !== lastStatus) {
        log.info('prerequisite status', status);
        lastStatus = statusKey;
      }
      if (status.codegraph || status.lens || pollCount >= MAX_POLLS) clearInterval(prereqTimer);
    }, config.prerequisiteRetryDelay);
    return () => clearInterval(prereqTimer);
  }, 'codegraph: prereq re-check timer');

  ctx.effect(() => ctx.on('codegraph-visualizer/prerequisite/request', () => {
    emitPrereqStatus();
  }), 'codegraph: prerequisite request listener');

  registerEventListeners(ctx, invokeUpstream, {
    getLastGraphData: () => lastGraphData,
    setLastGraphData: (data) => { lastGraphData = data; },
  });
  registerWatcher(ctx, config, invokeUpstream, {
    getLastGraphData: () => lastGraphData,
    setLastGraphData: (data) => { lastGraphData = data; },
  });

  const mcpServer = new McpServer();
  ctx.effect(() => {
    mcpServer.start(() => lastGraphData);
    return () => mcpServer.stop();
  }, 'codegraph: MCP server');

  ctx.effect(() => {
    return () => {
      destroyed = true;
      scanCache.clear();
      scanInFlightMap.clear();
      lastGraphData = null;
      lastInitResult = null;
      securityManager.reset();
      disposeGraphTools();
      closeAllDbConnections();
      // cycle-128：原生索引写连接池同步清理（与只读池同处置）。
      void import('./adapters/nativeIndex.ts').then(({ closeNativeIndexConnections }) => closeNativeIndexConnections());
      graphRepo.close();
    };
  }, 'codegraph: state cleanup');


}
