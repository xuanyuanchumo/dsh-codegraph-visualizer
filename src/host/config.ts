import type { DataSourceType } from '../types/index.ts';

export interface VisualizerConfig {
  dataSource: DataSourceType;
  requestTimeout: number;
  scanCacheTtl: number;
  scanCacheLimit: number;
  maxBodyBytes: number;
  prerequisiteRetryDelay: number;
  watchDebounce: number;
  maxNodes: number;
  allowedOrigins: string[];
  panelMinHeight: number;
  panelDefaultHeight: number;
}

export const DEFAULT_CONFIG: VisualizerConfig = {
  dataSource: 'auto',
  requestTimeout: 15000,
  scanCacheTtl: 30_000,
  scanCacheLimit: 4,
  maxBodyBytes: 1024 * 1024,
  prerequisiteRetryDelay: 3000,
  watchDebounce: 500,
  maxNodes: 10_000,
  allowedOrigins: ['http://localhost:3080'],
  panelMinHeight: 240,
  panelDefaultHeight: 600,
};

export function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig {
  const config: VisualizerConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const errors: string[] = [];
  if (config.dataSource !== 'auto' && config.dataSource !== 'codegraph' && config.dataSource !== 'lens' && config.dataSource !== 'tree-sitter') {
    errors.push(`dataSource must be auto|codegraph|lens|tree-sitter, got ${String(config.dataSource)}`);
  }
  const positiveFields: Array<[keyof VisualizerConfig, number]> = [
    ['requestTimeout', config.requestTimeout],
    ['scanCacheTtl', config.scanCacheTtl],
    ['scanCacheLimit', config.scanCacheLimit],
    ['maxBodyBytes', config.maxBodyBytes],
    ['prerequisiteRetryDelay', config.prerequisiteRetryDelay],
    ['watchDebounce', config.watchDebounce],
    ['maxNodes', config.maxNodes],
    ['panelMinHeight', config.panelMinHeight],
    ['panelDefaultHeight', config.panelDefaultHeight],
  ];
  for (const [field, value] of positiveFields) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${field} must be a positive finite number, got ${String(value)}`);
    }
  }
  if (config.panelDefaultHeight < config.panelMinHeight) {
    errors.push(`panelDefaultHeight (${config.panelDefaultHeight}) must be >= panelMinHeight (${config.panelMinHeight})`);
  }
  if (errors.length > 0) {
    throw new Error(`[dsh-codegraph-visualizer] invalid config: ${errors.join('; ')}`);
  }
  return config;
}