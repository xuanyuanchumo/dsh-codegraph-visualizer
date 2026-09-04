import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools } from './tools.ts';
import { scoped } from './shared/Logger.ts';
import type { GraphData } from './types/index.ts';
import { PLUGIN_VERSION } from './generated/version.ts';
import { resolveConfig } from './host/config.ts';
import type { VisualizerConfig } from './host/config.ts';
import { setAllowedWorkspaceRoots } from './host/security.ts';
import { extractWorkspacePaths, checkPrerequisites } from './host/prerequisites.ts';
import { createInvokeUpstream, registerRoutes, registerService } from './host/routes.ts';
import { registerWatcher, registerEventListeners } from './host/watcher.ts';

export { PLUGIN_VERSION };
export { resolveConfig, DEFAULT_CONFIG } from './host/config.ts';
export type { VisualizerConfig } from './host/config.ts';
export { isPathAllowed, setAllowedWorkspaceRoots } from './host/security.ts';

const log = scoped('host');

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools', 'webServer', 'sessions', 'workspaceRegistry'];

export function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>) {
  const config = resolveConfig(userConfig);
  setAllowedWorkspaceRoots(extractWorkspacePaths(ctx));

  const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx, { requestTimeout: config.requestTimeout });

  ctx.effect(() => {
    const d1 = ctx.tools.register(graphStatus);
    const d2 = ctx.tools.register(graphData);
    const d3 = ctx.tools.register(graphSymbol);
    const d4 = ctx.tools.register(graphImpact);
    return () => { d1(); d2(); d3(); d4(); };
  }, 'codegraph: tool registrations');

  let lastGraphData: GraphData | null = null;
  let lastInitResult: { success: boolean; path: string; message: string; timestamp: number } | null = null;
  let scanInFlight: Promise<GraphData> | null = null;
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();

  const routeDeps = {
    ctx,
    config,
    getLastGraphData: () => lastGraphData,
    setLastGraphData: (data: GraphData | null) => { lastGraphData = data; },
    getLastInitResult: () => lastInitResult,
    setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => { lastInitResult = data; },
    getScanCache: () => scanCache,
    getScanInFlight: () => scanInFlight,
    setScanInFlight: (p: Promise<GraphData> | null) => { scanInFlight = p; },
  };

  registerService(routeDeps);
  registerRoutes(routeDeps);

  const invokeUpstream = createInvokeUpstream(ctx, config);

  const emitPrereqStatus = () => {
    const status = checkPrerequisites(ctx);
    ctx.emit('codegraph/prerequisite/status', {
      codegraph: status.codegraph,
      lens: status.lens,
      timestamp: Date.now(),
    });
    log.info('prerequisite status', status);
  };
  emitPrereqStatus();
  const prereqTimer = setTimeout(emitPrereqStatus, config.prerequisiteRetryDelay);
  ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

  ctx.effect(() => ctx.on('codegraph/prerequisite/request', () => {
    emitPrereqStatus();
  }), 'codegraph: prerequisite request listener');

  registerEventListeners(ctx, invokeUpstream);
  registerWatcher(ctx, config, invokeUpstream);
}
