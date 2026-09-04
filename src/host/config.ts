export interface VisualizerConfig {
  dataSource: 'auto' | 'codegraph' | 'lens';
  requestTimeout: number;
  scanCacheTtl: number;
  scanCacheLimit: number;
  maxBodyBytes: number;
  prerequisiteRetryDelay: number;
  watchDebounce: number;
  maxNodes: number;
}

export const DEFAULT_CONFIG: VisualizerConfig = {
  dataSource: 'auto',
  requestTimeout: 5000,
  scanCacheTtl: 30_000,
  scanCacheLimit: 4,
  maxBodyBytes: 1024 * 1024,
  prerequisiteRetryDelay: 3000,
  watchDebounce: 500,
  maxNodes: 10_000,
};

export function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig {
  const config: VisualizerConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const errors: string[] = [];
  if (config.dataSource !== 'auto' && config.dataSource !== 'codegraph' && config.dataSource !== 'lens') {
    errors.push(`dataSource must be auto|codegraph|lens, got ${String(config.dataSource)}`);
  }
  const positiveFields: Array<[keyof VisualizerConfig, number]> = [
    ['requestTimeout', config.requestTimeout],
    ['scanCacheTtl', config.scanCacheTtl],
    ['scanCacheLimit', config.scanCacheLimit],
    ['maxBodyBytes', config.maxBodyBytes],
    ['prerequisiteRetryDelay', config.prerequisiteRetryDelay],
    ['watchDebounce', config.watchDebounce],
    ['maxNodes', config.maxNodes],
  ];
  for (const [field, value] of positiveFields) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${field} must be a positive finite number, got ${String(value)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`[dsh-codegraph-visualizer] invalid config: ${errors.join('; ')}`);
  }
  return config;
}