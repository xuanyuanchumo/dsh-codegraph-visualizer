import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import type { CapabilityProbe, FeatureFlags } from './FeatureFlags.ts';

const log = scoped('host:compat:probe');

/**
 * Capabilities backed by a Cordis **service**: the service being registered is the evidence.
 * The names are the ones this plugin already probes elsewhere, so the probe adds no new
 * assumptions about the DSH API:
 *   - `workspaceRegistry` — src/host/prerequisites.ts:63 `ctx.get('workspaceRegistry')`
 *   - `multiWorkspace`    — same service; the multi-workspace API is that service
 *   - `sessions`          — required by this plugin's own `inject` list (src/index.ts)
 *   - `remoteWebUI`       — the host-side service behind the client `remote-web-ui` integration
 */
const SERVICE_EVIDENCE: Partial<Record<keyof FeatureFlags, readonly string[]>> = {
  workspaceRegistry: ['workspaceRegistry'],
  multiWorkspace: ['workspaceRegistry'],
  sessionsApi: ['sessions'],
  remoteWebUi: ['remoteWebUI'],
};

/**
 * Capabilities backed by an **upstream tool**: the tool being registered is the evidence.
 * `codegraph_incremental`/`codegraph_bootstrap` are the 0.2-line tools this plugin's own
 * ApiCompatLayer already maps, so probing them cannot invent a capability that does not exist.
 *
 * Note this one normally cannot fire: {@link detectHostVersion} dates a host from those very
 * tool names, so a host that has them is already classified gen2 and the flag is on. It is
 * kept as a safety net for a future line where the version string and the tool surface
 * disagree.
 */
const TOOL_EVIDENCE: Partial<Record<keyof FeatureFlags, readonly string[]>> = {
  incrementalBootstrap: ['codegraph_incremental', 'codegraph_bootstrap'],
};

/**
 * Build a {@link CapabilityProbe} over the live host.
 *
 * Only observed `true` is reported: a missing service or tool means "no evidence", never
 * "absent", so the generation default decides. That keeps the probe safe to run on every
 * host — including the current gen2 one, where it confirms nothing new — while giving an
 * unmodelled future (or a stripped-down) host a way to advertise capabilities the version
 * table could not know about.
 */
export function createHostCapabilityProbe(ctx: Context): CapabilityProbe {
  return (capability: keyof FeatureFlags): boolean | undefined => {
    const services = SERVICE_EVIDENCE[capability];
    if (services) {
      try {
        for (const service of services) {
          const resolved = ctx.get(service);
          if (resolved !== null && resolved !== undefined) {
            log.info('capability probe: service present', { capability, service });
            return true;
          }
        }
      } catch { /* service registry unavailable — treat as no evidence */ }
      return undefined;
    }

    const toolNames = TOOL_EVIDENCE[capability];
    if (toolNames) {
      try {
        for (const toolName of toolNames) {
          if (ctx.tools.get(toolName)) {
            log.info('capability probe: tool present', { capability, tool: toolName });
            return true;
          }
        }
      } catch { /* tool registry unavailable — treat as no evidence */ }
      return undefined;
    }

    return undefined; // no evidence source modelled for this capability
  };
}
