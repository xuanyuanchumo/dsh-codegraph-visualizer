import type { HostVersionInfo } from './HostVersionDetector.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('host:compat');

export interface FeatureFlags {
  incrementalBootstrap: boolean;
  workspaceRegistry: boolean;
  sessionsApi: boolean;
  betterSidebar: boolean;
  spotlight: boolean;
  remoteWebUi: boolean;
  mcpServer: boolean;
  rateLimiting: boolean;
  treeSitterWasm: boolean;
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
  treeSitterWasm: true,
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
  treeSitterWasm: true,
  healthScore: true,
  rulesCheck: true,
  multiWorkspace: true,
  aiAssist: false,
  crossRepo: false,
  desktopPlatform: true,
};

const GEN3_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  // gen3 (v0.3.0+) reserved flags — enable when v0.3.0 confirms these features
  aiAssist: false, // placeholder: enable when v0.3.0 confirms AI assist API
  crossRepo: false, // placeholder: enable when v0.3.0 confirms cross-repo API
  desktopPlatform: true,
};

const UNKNOWN_FLAGS: FeatureFlags = {
  ...GEN2_FLAGS,
  incrementalBootstrap: false,
  remoteWebUi: false,
};

export function createFeatureFlags(info: HostVersionInfo): FeatureFlags {
  const flags = info.generation === 'gen1' ? GEN1_FLAGS
    : info.generation === 'gen2' ? GEN2_FLAGS
    : info.generation === 'gen3' ? GEN3_FLAGS
    : UNKNOWN_FLAGS;
  log.info('feature flags resolved', { generation: info.generation, flags });
  return flags;
}

