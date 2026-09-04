import { Context } from "@deepseek-ai/cordis";

//#region src/generated/version.d.ts
declare const PLUGIN_VERSION = "0.1.0";

//#endregion
//#region src/host/config.d.ts
//# sourceMappingURL=version.d.ts.map
interface VisualizerConfig {
  dataSource: 'auto' | 'codegraph' | 'lens';
  requestTimeout: number;
  scanCacheTtl: number;
  scanCacheLimit: number;
  maxBodyBytes: number;
  prerequisiteRetryDelay: number;
  watchDebounce: number;
  maxNodes: number;
}
declare const DEFAULT_CONFIG: VisualizerConfig;
declare function resolveConfig(userConfig?: Partial<VisualizerConfig>): VisualizerConfig;

//#endregion
//#region src/host/security.d.ts
//# sourceMappingURL=config.d.ts.map
declare function setAllowedWorkspaceRoots(roots: string[]): void;
declare function isPathAllowed(path: string): boolean;

//#endregion
//#region src/index.d.ts
//# sourceMappingURL=security.d.ts.map

declare const name = "dsh-codegraph-visualizer";
declare const inject: string[];
declare function apply(ctx: Context, userConfig?: Partial<VisualizerConfig>): void;

//#endregion
//# sourceMappingURL=index.d.ts.map

export { DEFAULT_CONFIG, PLUGIN_VERSION, VisualizerConfig, apply, inject, isPathAllowed, name, resolveConfig, setAllowedWorkspaceRoots };
//# sourceMappingURL=index.d.ts.map