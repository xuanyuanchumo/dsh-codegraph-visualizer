// Mock for @deepseek-cordis/plugin
// This mock provides the core Cordis types and interfaces needed for development

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

export const createContext = (): CordisContext => {
  const effects: Array<() => void> = [];
  const listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  const tools = new Map<string, unknown>();

  return {
    effect: (fn) => {
      const disposer = fn() as void | (() => void);
      if (typeof disposer === 'function') {
        effects.push(disposer);
      }
      return () => {
        if (typeof disposer === 'function') {
          disposer();
        }
      };
    },
    on: (event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      const handlers = listeners.get(event)!;
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    registerTool: (name, tool) => {
      tools.set(name, tool);
      return () => tools.delete(name);
    },
    registerService: (_name, _service) => {
      return () => {};
    },
    broadcast: (event, data) => {
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    },
    tools: {
      invoke: async (_tool, _args) => null,
    },
  };
};

export const definePlugin = (plugin: CordisPlugin) => plugin;