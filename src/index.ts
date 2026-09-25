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

export { PLUGIN_VERSION };
export { resolveConfig, DEFAULT_CONFIG } from './host/config.ts';
export type { VisualizerConfig } from './host/config.ts';
export { SecurityManager, createSecurityManager } from './host/security.ts';

const log = scoped('host');

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools', 'webServer', 'sessions', 'workspaceRegistry'];

export async function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>) {
  const config = resolveConfig(userConfig);
  const securityManager = createSecurityManager();
  securityManager.setAllowedWorkspaceRoots(extractWorkspacePaths(ctx));

  const { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphHealth, graphRulesCheck, graphFocus } = await createGraphTools(ctx, { requestTimeout: config.requestTimeout });

  ctx.effect(() => {
    const d1 = ctx.tools.register(graphStatus);
    const d2 = ctx.tools.register(graphData);
    const d3 = ctx.tools.register(graphSymbol);
    const d4 = ctx.tools.register(graphImpact);
    const d5 = ctx.tools.register(graphPathFind);
    const d6 = ctx.tools.register(graphHealth);
    const d7 = ctx.tools.register(graphRulesCheck);
    const d8 = ctx.tools.register(graphFocus);
    return () => { d1(); d2(); d3(); d4(); d5(); d6(); d7(); d8(); };
  }, 'codegraph: tool registrations');

  let lastGraphData: GraphData | null = null;
  let lastInitResult: { success: boolean; path: string; message: string; timestamp: number } | null = null;
  const scanInFlightMap = new Map<string, Promise<GraphData>>();
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();

  const invokeUpstream = createInvokeUpstream(ctx, config);

  const routeDeps = {
    ctx,
    config,
    securityManager,
    invokeUpstream,
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
  };

  registerService(routeDeps);
  registerRoutes(routeDeps);


  let lastStatus = '';
  const emitPrereqStatus = () => {
    const status = checkPrerequisites(ctx);
    const statusKey = `${status.codegraph}:${status.lens}`;
    ctx.emit('codegraph-visualizer/prerequisite/status', {
      codegraph: status.codegraph,
      lens: status.lens,
      timestamp: Date.now(),
    });
    if (statusKey !== lastStatus) {
      log.info('prerequisite status', status);
      lastStatus = statusKey;
    }
  };
  emitPrereqStatus();
  ctx.effect(() => {
    const prereqTimer = setInterval(() => {
      const status = checkPrerequisites(ctx);
      const statusKey = `${status.codegraph}:${status.lens}`;
      ctx.emit('codegraph-visualizer/prerequisite/status', {
        codegraph: status.codegraph,
        lens: status.lens,
        timestamp: Date.now(),
      });
      if (statusKey !== lastStatus) {
        log.info('prerequisite status', status);
        lastStatus = statusKey;
      }
      if (status.codegraph && status.lens) clearInterval(prereqTimer);
    }, config.prerequisiteRetryDelay);
    return () => clearInterval(prereqTimer);
  }, 'codegraph: prereq re-check timer');

  ctx.effect(() => ctx.on('codegraph-visualizer/prerequisite/request', () => {
    emitPrereqStatus();
  }), 'codegraph: prerequisite request listener');

  registerEventListeners(ctx, invokeUpstream);
  registerWatcher(ctx, config, invokeUpstream);

  const mcpServer = new McpServer();
  ctx.effect(() => {
    mcpServer.start(() => lastGraphData);
    return () => mcpServer.stop();
  }, 'codegraph: MCP server');

  ctx.effect(() => {
    return () => {
      scanCache.clear();
      scanInFlightMap.clear();
      lastGraphData = null;
      lastInitResult = null;
      securityManager.reset();
    };
  }, 'codegraph: state cleanup');

  return () => {};
}
