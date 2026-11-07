import Schema from '@deepseek-ai/schemastery';
import type { DataSourceType } from '../types/index.ts';
import { ERROR_CODES } from '../shared/constants.ts';

const VALID_DATA_SOURCES = new Set<DataSourceType>(['auto', 'codegraph', 'lens', 'tree-sitter', 'dependency']);
const ORIGIN_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/;

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
  maxNodes: 500_000,
  allowedOrigins: ['http://localhost:3080'],
  panelMinHeight: 240,
  panelDefaultHeight: 600,
};

/**
 * Schemastery schema（cycle-146 T146-1）——与 `VisualizerConfig` 同形状的**加载时**校验器。
 *
 * ## 为什么必须有它
 *
 * 旧实现只导出 `resolveConfig`/`DEFAULT_CONFIG`：插件没有 Standard Schema 接口，于是
 * ① cordis.yml 的 config 行没有声明式校验（错误要等 apply 内手动校验才报）；
 * ② 宿主设置 UI 无法渲染行内表单（dsh-context/dsh-ops 双插件的 `Config` 导出模式）。
 *
 * 官方规范（docs/user/develop/basic/config.md）：插件导出 `Config` 类型 + 同名 Schemastery
 * schema，默认值直接写在 schema 中；cordis 在插件加载时通过 schema 校验配置并填默认值。
 *
 * ## 约束：与 resolveConfig 的单一真源关系
 *
 * `resolveConfig` 的手写校验（正数/origin 模式/高度下界）保留——它是运行时防线，错误
 * 信息更具体；schema 是加载时防线。两者必须同形状：`configSchemaContract.test.ts`
 * 断言「schema 声明的默认值 === DEFAULT_CONFIG 字段值」，防止两处漂移。
 */
export const Config = Schema.object({
  dataSource: Schema.union(['auto', 'codegraph', 'lens', 'tree-sitter', 'dependency'])
    .description('Graph data source: auto (degradation chain) / codegraph / lens / tree-sitter / dependency')
    .default('auto'),
  requestTimeout: Schema.number().min(1000).description('Upstream request timeout (ms)').default(DEFAULT_CONFIG.requestTimeout),
  scanCacheTtl: Schema.number().min(1000).description('Scan cache TTL (ms)').default(DEFAULT_CONFIG.scanCacheTtl),
  scanCacheLimit: Schema.number().min(1).description('Max concurrent scan cache entries').default(DEFAULT_CONFIG.scanCacheLimit),
  maxBodyBytes: Schema.number().min(1024).description('Max HTTP request body size (bytes)').default(DEFAULT_CONFIG.maxBodyBytes),
  prerequisiteRetryDelay: Schema.number().min(500).description('Prerequisite re-probe interval (ms)').default(DEFAULT_CONFIG.prerequisiteRetryDelay),
  watchDebounce: Schema.number().min(100).description('File watcher debounce (ms)').default(DEFAULT_CONFIG.watchDebounce),
  maxNodes: Schema.number().min(100).description('Max nodes rendered in the graph').default(DEFAULT_CONFIG.maxNodes),
  allowedOrigins: Schema.array(Schema.string().pattern(/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/))
    .description('Allowed CORS origins for cross-origin clients')
    .default(DEFAULT_CONFIG.allowedOrigins),
  panelMinHeight: Schema.number().min(120).description('Minimum panel height (px)').default(DEFAULT_CONFIG.panelMinHeight),
  panelDefaultHeight: Schema.number().min(120).description('Default panel height (px)').default(DEFAULT_CONFIG.panelDefaultHeight),
});

export function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig {
  const config: VisualizerConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const errors: string[] = [];
  if (!VALID_DATA_SOURCES.has(config.dataSource)) {
    errors.push(`dataSource must be auto|codegraph|lens|tree-sitter, got ${String(config.dataSource)}`);
  }
  for (const origin of config.allowedOrigins) {
    if (!ORIGIN_PATTERN.test(origin)) {
      errors.push(`allowedOrigins contains invalid origin: ${origin} (expected http(s)://host[:port])`);
    }
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
    throw new Error(`${ERROR_CODES.INVALID_CONFIG}: ${errors.join('; ')}`);
  }
  return config;
}