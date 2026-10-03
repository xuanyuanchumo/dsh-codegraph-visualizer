import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import {
  parseDshVersion,
  probeReleaseFor,
  unknownDshVersion,
  type DshGeneration,
  type DshVersionInfo,
} from '../../shared/dshGeneration.ts';

const log = scoped('host:compat');

/** @deprecated alias kept for call sites; the model lives in `src/shared/dshGeneration.ts`. */
export type HostGeneration = DshGeneration;
export type HostVersionInfo = DshVersionInfo;

function detectFromContext(ctx: Context): string | null {
  const candidates = [
    () => ctx.hostVersion,
    () => ctx.version,
    () => ctx.app?.version,
    () => ctx.runtime?.version,
  ];
  for (const fn of candidates) {
    try {
      const v = fn();
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return null;
}

function detectFromEnv(): string | null {
  const envKeys = ['DSH_HOST_VERSION', 'DSH_VERSION', 'CODEARTS_HOST_VERSION'];
  for (const key of envKeys) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  return null;
}

/**
 * Last resort: infer the generation from the upstream tool surface. `codegraph_incremental`/
 * `codegraph_bootstrap` only ever shipped from the 0.2 line, so their presence dates the host.
 * Returns a representative release (see DSH_GENERATION_PROBES) rather than a measured version.
 */
function detectFromToolNames(ctx: Context): string | null {
  try {
    const tools = ctx.tools;
    const hasGen2OnlyTool = tools.get('codegraph_incremental') ?? tools.get('codegraph_bootstrap');
    if (hasGen2OnlyTool) return probeReleaseFor('gen2');
    const hasGen1Tool = tools.get('codegraph_status') ?? tools.get('codegraph_graph');
    if (hasGen1Tool) return probeReleaseFor('gen1');
  } catch { /* ignore */ }
  return null;
}

/**
 * Resolve the running DSH generation. Every source is a heuristic (DSH exposes no stable
 * version API on the plugin context), so a miss degrades to `unknown` — which the adapter
 * layers answer with the conservative capability set plus runtime probes, never with a crash.
 */
export function detectHostVersion(ctx: Context): HostVersionInfo {
  const sources = [
    () => detectFromContext(ctx),
    () => detectFromEnv(),
    () => detectFromToolNames(ctx),
  ];
  for (const fn of sources) {
    try {
      const raw = fn();
      if (raw) {
        const info = parseDshVersion(raw);
        log.info('host version detected', { raw, generation: info.generation });
        return info;
      }
    } catch { /* ignore */ }
  }
  log.info('host version unknown, using conservative flags');
  return unknownDshVersion();
}
