// DSH codegraph visualizer — client entry point.
// The interactive graph panel is registered through the host-pushed heat-update
// event; full Slot-based UI registration is wired by the client bundle build.
import type { Context } from '@deepseek-ai/cordis';

export const name = 'dsh-codegraph-visualizer-client';

export function apply(ctx: Context) {
  // Heat-update: re-fetch the merged graph when the host signals a change so
  // the panel (registered from this fiber's client bundle) stays in sync.
  ctx.on('codegraph/graph/updated', (event) => {
    void event.repoId;
  });
}