import type { HostVersionInfo } from './HostVersionDetector.ts';
import { scoped } from '../../shared/Logger.ts';
import type { DshGeneration } from '../../shared/dshGeneration.ts';

const log = scoped('host:compat');

/**
 * Host capability matrix. Every entry must describe something **the host provides**: the flag
 * gates behaviour that degrades when the host lacks the capability.
 *
 * Deliberately absent: `treeSitterWasm`. Parsing runs in this plugin's own host process off its
 * own dependency (`tree-sitter-wasm`, resolved by `getWasmPath`), so the host cannot grant or
 * withhold it; the capability was declared `true` on every generation and read by nobody.
 * Round 7 removed it rather than leaving a flag that claims a host capability the plugin never
 * consumes (see `docs/需求分析.md` §31.6 / FR-33).
 */
export interface FeatureFlags {
  incrementalBootstrap: boolean;
  workspaceRegistry: boolean;
  sessionsApi: boolean;
  betterSidebar: boolean;
  spotlight: boolean;
  remoteWebUi: boolean;
  mcpServer: boolean;
  rateLimiting: boolean;
  healthScore: boolean;
  rulesCheck: boolean;
  multiWorkspace: boolean;
  aiAssist: boolean;
  crossRepo: boolean;
  desktopPlatform: boolean;
}

const GEN1_FLAGS: FeatureFlags = {
  incrementalBootstrap: false,
  workspaceRegistry: false,
  sessionsApi: true,
  betterSidebar: false,
  spotlight: false,
  remoteWebUi: false,
  mcpServer: true,
  rateLimiting: true,
  healthScore: true,
  rulesCheck: true,
  multiWorkspace: false,
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: false,
};

const GEN2_FLAGS: FeatureFlags = {
  incrementalBootstrap: true,
  workspaceRegistry: true,
  sessionsApi: true,
  betterSidebar: true,
  spotlight: true,
  remoteWebUi: true,
  mcpServer: true,
  rateLimiting: true,
  healthScore: true,
  rulesCheck: true,
  multiWorkspace: true,
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: true,
};

const GEN3_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  // gen3 (v0.3.0+) reserved flags — enable when v0.3.0 confirms these features.
  // Identical to gen2 on purpose: an unreleased line must not be handed capabilities
  // nobody has verified. Runtime probes (below) are how a real gen3 host gets them.
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: true,
};

/** Conservative baseline for "the version could not be determined". */
const UNKNOWN_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  incrementalBootstrap: false,
  remoteWebUi: false,
};

/**
 * The generation → capability matrix, keyed by every generation the model can report.
 * Exported so exhaustiveness is asserted instead of assumed (tests/unit/dshGeneration.test.ts).
 */
export const FEATURE_FLAGS_BY_GENERATION: Record<DshGeneration, FeatureFlags> = {
  gen1: GEN1_FLAGS,
  gen2: GEN2_FLAGS,
  gen3: GEN3_FLAGS,
  unknown: UNKNOWN_FLAGS,
};

/**
 * Runtime capability probe. `true` = the capability was observed on this host,
 * `false`/`null`/`undefined` = no usable evidence (absence is not proof of absence).
 */
export type CapabilityProbe = (capability: keyof FeatureFlags) => boolean | null | undefined;

/** Capabilities a probe upgraded over the generation default, for logging/telemetry. */
export interface FeatureFlagResolution {
  flags: FeatureFlags;
  source: 'generation' | 'generation+probe';
  probedUpgrades: (keyof FeatureFlags)[];
}

/**
 * Resolve the capability set for a host.
 *
 * Generation defaults alone would misprice two situations the plugin must survive:
 * a host newer than the model (`unknown`/future line that does have a capability) and a
 * host older than its own line (a 0.2 build without the upstream codegraph plugin).
 * A probe fixes both, but **only additively**: a probe may switch a capability on, never
 * off. Probing is heuristic, so a false negative would silently remove working behaviour,
 * whereas a false positive only restores something the version model already granted on
 * a neighbouring generation.
 */
export function resolveFeatureFlags(info: HostVersionInfo, probe?: CapabilityProbe): FeatureFlagResolution {
  const base = FEATURE_FLAGS_BY_GENERATION[info.generation];
  if (!probe) {
    return { flags: base, source: 'generation', probedUpgrades: [] };
  }

  const flags: FeatureFlags = { ...base };
  const probedUpgrades: (keyof FeatureFlags)[] = [];
  for (const capability of Object.keys(base) as (keyof FeatureFlags)[]) {
    if (flags[capability]) continue; // never probe away a granted capability
    let observed: boolean | null | undefined;
    try {
      observed = probe(capability);
    } catch {
      observed = undefined;
    }
    if (observed === true) {
      flags[capability] = true;
      probedUpgrades.push(capability);
    }
  }
  return {
    flags,
    source: probedUpgrades.length > 0 ? 'generation+probe' : 'generation',
    probedUpgrades,
  };
}

export function createFeatureFlags(info: HostVersionInfo, probe?: CapabilityProbe): FeatureFlags {
  const { flags, source, probedUpgrades } = resolveFeatureFlags(info, probe);
  log.info('feature flags resolved', { generation: info.generation, source, probedUpgrades, flags });
  return flags;
}
