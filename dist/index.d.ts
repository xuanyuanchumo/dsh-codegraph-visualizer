import { Context } from "@deepseek-ai/cordis";

//#region src/generated/version.d.ts
declare const PLUGIN_VERSION = "0.1.0";

//#endregion
//#region src/index.d.ts
//# sourceMappingURL=version.d.ts.map

declare const name = "dsh-codegraph-visualizer";
declare const inject: string[];
declare function isPathAllowed(path: string): boolean;
declare function apply(ctx: Context): void;

//#endregion
//# sourceMappingURL=index.d.ts.map

export { PLUGIN_VERSION, apply, inject, isPathAllowed, name };
//# sourceMappingURL=index.d.ts.map