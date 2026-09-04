import { Context } from "@deepseek-ai/cordis";

//#region src/generated/version.d.ts
declare const PLUGIN_VERSION = "0.1.0";

//#endregion
//#region src/index.d.ts
//# sourceMappingURL=version.d.ts.map

declare const name = "dsh-codegraph-visualizer";
declare const inject: string[];
interface VisualizerConfig {
  /** Preferred data source for tool-side merges. */
  dataSource: 'auto' | 'codegraph' | 'lens';
  /** Upstream tool call timeout in ms. */
  requestTimeout: number;
  /** Scan result cache TTL in ms. */
  scanCacheTtl: number;
  /** Maximum scan-cache entries (bounded memory). */
  scanCacheLimit: number;
  /** HTTP request body limit in bytes. */
  maxBodyBytes: number;
  /** Delay before re-checking prerequisites, in ms. */
  prerequisiteRetryDelay: number;
  /** File-watcher debounce window in ms. */
  watchDebounce: number;
  /** Default maxNodes cap for scans. */
  maxNodes: number;
}
declare const DEFAULT_CONFIG: VisualizerConfig;
/** Merge user config over defaults and reject invalid values at load time. */
declare function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig;
declare function setAllowedWorkspaceRoots(roots: string[]): void;
declare function isPathAllowed(path: string): boolean;
declare function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>): void; //#endregion

//# sourceMappingURL=index.d.ts.map
export { DEFAULT_CONFIG, PLUGIN_VERSION, VisualizerConfig, apply, inject, isPathAllowed, name, resolveConfig, setAllowedWorkspaceRoots };
//# sourceMappingURL=index.d.ts.map