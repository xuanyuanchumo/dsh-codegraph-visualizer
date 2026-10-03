export { detectHostVersion } from './HostVersionDetector.ts';
export type { HostVersionInfo, HostGeneration } from './HostVersionDetector.ts';
export {
  createFeatureFlags,
  resolveFeatureFlags,
  FEATURE_FLAGS_BY_GENERATION,
} from './FeatureFlags.ts';
export type { FeatureFlags, CapabilityProbe, FeatureFlagResolution } from './FeatureFlags.ts';
export { createHostCapabilityProbe } from './HostCapabilityProbe.ts';
export { createApiCompatLayer, createToolNameMapping, TOOL_MAPPING_BY_GENERATION } from './ApiCompatLayer.ts';
export type { ApiCompatLayer, ToolNameMapping } from './ApiCompatLayer.ts';
