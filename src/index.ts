// DSH codegraph visualizer plugin — host entry point.
// Compliant bundle plugin shape: `name` + `inject` + `apply(ctx)`.
import type { Context } from '@deepseek-ai/cordis';
import { watch } from 'node:fs';
import { createGraphTools, fetchMergedGraph } from './tools.ts';
import { scoped } from './shared/Logger.ts';

const log = scoped('host');

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools'];

// Debounced file watcher for hot-update (host-side fs.watch).
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let activeWatcher: { close: () => void } | null = null;

function checkPrerequisites(ctx: Context): { codegraph: boolean; lens: boolean } {
  try {
    const cg = ctx.tools.get('codegraph_graph');
    const lens = ctx.tools.get('lens_analyze');
    return { codegraph: !!cg, lens: !!lens };
  } catch {
    return { codegraph: false, lens: false };
  }
}

export function apply(ctx: Context) {
  const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx);

  ctx.tools.register(graphStatus);
  ctx.tools.register(graphData);
  ctx.tools.register(graphSymbol);
  ctx.tools.register(graphImpact);

  // ── Prerequisite check ─────────────────────────────────────────────
  // Detect whether dsh-codegraph (codegraph_graph) or dsh-tool-lens
  // (lens_analyze) are registered. Emit status so the client can show
  // a guidance banner when data sources are missing.
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
  // Re-check after a delay — upstream plugins may register later.
  const prereqTimer = setTimeout(emitPrereqStatus, 3000);
  ctx.effect(() => () => clearTimeout(prereqTimer), 'codegraph: prereq re-check timer');

  // ── Heat-update (push) ─────────────────────────────────────────────
  ctx.on('codegraph/repo/imported', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });
  ctx.on('codegraph/repo/scanned', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });

  // ── Auto-import: scan workspace on request ─────────────────────────
  const invokeUpstream = async (tool: string, args: Record<string, unknown>): Promise<unknown | null> => {
    try {
      const result = await ctx.tools.execute({
        callId: `codegraph:${tool}` as never,
        name: tool,
        arguments: args,
        signal: AbortSignal.timeout(5000),
      });
      if (result.isError) return null;
      return result.value ?? null;
    } catch {
      return null;
    }
  };

  const scanAndPush = async (path: string) => {
    log.info('scan requested', { path });
    try {
      const repoId = path || `workspace-${Date.now()}`;
      const data = await fetchMergedGraph(invokeUpstream, repoId, 'both');
      ctx.emit('codegraph/graph/updated', {
        repoId,
        nodeCount: data.metadata.nodeCount,
        edgeCount: data.metadata.edgeCount,
        timestamp: data.metadata.timestamp,
      });
      ctx.emit('codegraph/graph/data', {
        repoId,
        nodes: data.nodes,
        edges: data.edges,
        timestamp: data.metadata.timestamp,
      });
      log.info('scan completed', { repoId, nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount });
    } catch (e) {
      log.error('scan failed', e);
    }
  };

  ctx.on('codegraph/repo/request-scan', async (event) => {
    await scanAndPush(event.path);
  });

  // ── Graph initialization ──────────────────────────────────────────
  // Trigger upstream codegraph_graph to generate/refresh the .codegraph DB.
  ctx.on('codegraph/graph/init', async (event) => {
    log.info('init requested', { path: event.path });
    try {
      const result = await invokeUpstream('codegraph_graph', { path: event.path, action: 'init' });
      const success = result !== null;
      ctx.emit('codegraph/graph/init-result', {
        success,
        path: event.path,
        message: success ? 'Graph initialized successfully' : 'Initialization failed — is dsh-codegraph installed?',
        timestamp: Date.now(),
      });
      if (success) {
        await scanAndPush(event.path);
      }
    } catch (e) {
      ctx.emit('codegraph/graph/init-result', {
        success: false,
        path: event.path,
        message: e instanceof Error ? e.message : String(e),
        timestamp: Date.now(),
      });
    }
  });

  // ── File watcher for hot-update ────────────────────────────────────
  ctx.on('codegraph/watch/toggle', (event) => {
    // Close existing watcher
    if (activeWatcher) {
      try { activeWatcher.close(); } catch { /* best-effort */ }
      activeWatcher = null;
    }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }

    if (!event.enabled) {
      log.info('watch disabled');
      return;
    }

    log.info('watch enabled', { path: event.path });
    try {

      const watcher = watch(event.path, { recursive: true }, (_eventType: string, filename: string | null) => {
        // Ignore .codegraph internal changes to avoid feedback loops
        if (filename && filename.includes('.codegraph')) return;
        if (filename && filename.includes('node_modules')) return;
        if (filename && filename.includes('.git')) return;

        // Debounce 500ms — batch rapid file saves into one re-scan
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          log.info('file changed, re-scanning', { filename });
          scanAndPush(event.path).catch((e) => log.error('watch re-scan failed', e));
        }, 500);
      });
      activeWatcher = watcher;
      ctx.effect(() => () => {
        try { watcher.close(); } catch { /* best-effort */ }
        if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
      }, 'codegraph: file watcher');
    } catch (e) {
      log.error('watch setup failed', e);
    }
  });
}
