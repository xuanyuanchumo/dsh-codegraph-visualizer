// DSH codegraph visualizer plugin — host entry point.
// Compliant bundle plugin shape: `name` + `inject` + `apply(ctx)`.
import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools } from './tools.ts';

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
}
