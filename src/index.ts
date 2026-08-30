// DSH codegraph visualizer plugin — host entry point.
// Compliant bundle plugin shape: `name` + `inject` + `apply(ctx)`.
import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools, fetchMergedGraph } from './tools.ts';
import { scoped } from './client/services/Logger.ts';

const log = scoped('host');

export const name = 'dsh-codegraph-visualizer';
export const inject = ['tools'];

export function apply(ctx: Context) {
  const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx);

  // Tool registration is owned by the plugin fiber and auto-removed on unload.
  ctx.tools.register(graphStatus);
  ctx.tools.register(graphData);
  ctx.tools.register(graphSymbol);
  ctx.tools.register(graphImpact);

  // Heat-update (push): after an upstream scan/import, broadcast a graph-update
  // signal so attached client panels re-fetch without a manual tool call.
  ctx.on('codegraph/repo/imported', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });
  ctx.on('codegraph/repo/scanned', (event) => {
    ctx.emit('codegraph/graph/updated', { repoId: event.repoId, nodeCount: 0, edgeCount: 0, timestamp: event.timestamp });
  });

  // Auto-import: when the client requests a repo scan (via Ctrl+I → Repo tab or
  // automatic workspace detection), fetch the merged graph and push the full
  // data back to the client via codegraph/graph/data.
  ctx.on('codegraph/repo/request-scan', async (event) => {
    log.info('scan requested', { path: event.path });
    try {
      const repoId = event.path || `workspace-${Date.now()}`;
      const data = await fetchMergedGraph(
        async (tool, args) => {
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
        },
        repoId,
        'both',
      );
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
  });
}
