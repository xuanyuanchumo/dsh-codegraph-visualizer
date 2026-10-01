export { detectHostVersion, isGen1, isGen2, isGen3, meetsMinimum } from './HostVersionDetector.ts';
export type { HostVersionInfo, HostGeneration } from './HostVersionDetector.ts';
export { createFeatureFlags, hasFlag } from './FeatureFlags.ts';
export type { FeatureFlags } from './FeatureFlags.ts';
export { createApiCompatLayer, createToolNameMapping } from './ApiCompatLayer.ts';
export type { ApiCompatLayer, ToolNameMapping } from './ApiCompatLayer.ts';