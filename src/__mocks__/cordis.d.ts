// Type declarations for @deepseek-cordis/plugin mock
declare module '@deepseek-cordis/plugin' {
  export type CordisEventMap = Record<string, unknown>;

  export interface CordisContext {
    effect: (fn: () => void | (() => void)) => () => void;
    on: <E extends keyof CordisEventMap>(
      event: E,
      handler: (data: CordisEventMap[E]) => void
    ) => () => void;
    registerTool: <T extends Record<string, unknown>>(
      name: string,
      tool: T
    ) => () => void;
    registerService: <T>(name: string, service: T) => () => void;
    broadcast: (event: string, data: unknown) => void;
    tools: {
      invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
    };
  }

  export interface CordisPlugin {
    (ctx: CordisContext, options?: Record<string, unknown>): void | (() => void);
    name?: string;
  }

  export const createContext: () => CordisContext;
  export const definePlugin: (plugin: CordisPlugin) => CordisPlugin;
}