import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client:compat');

export type SidebarIntegrationMode = 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating';

export interface ClientFeatureFlags {
  sidebarRightTabs: boolean;
  betterSidebar: boolean;
  spotlight: boolean;
  slots: boolean;
}

export interface ClientCompatLayer {
  mode: SidebarIntegrationMode;
  flags: ClientFeatureFlags;
  detectMode(ctx: Context): SidebarIntegrationMode;
  detectFlags(ctx: Context): ClientFeatureFlags;
  hasFlag(key: keyof ClientFeatureFlags): boolean;
}

function safeCheck<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createClientCompatLayer(): ClientCompatLayer {
  let _mode: SidebarIntegrationMode = 'floating';
  let _flags: ClientFeatureFlags = {
    sidebarRightTabs: false,
    betterSidebar: false,
    spotlight: false,
    slots: false,
  };

  const detectMode = (ctx: Context): SidebarIntegrationMode => {
    if (safeCheck(() => {
      const tabs = (ctx as unknown as { sidebarRightTabs?: unknown }).sidebarRightTabs;
      return tabs !== null && tabs !== undefined;
    }, false)) {
      _mode = 'sidebar-right';
      return _mode;
    }
    if (safeCheck(() => {
      const bs = ctx.get('betterSidebar');
      return bs !== null && bs !== undefined;
    }, false)) {
      _mode = 'better-sidebar';
      return _mode;
    }
    if (safeCheck(() => ctx.slots !== null && ctx.slots !== undefined, false)) {
      _mode = 'slot';
      return _mode;
    }
    _mode = 'floating';
    return _mode;
  };

  const detectFlags = (ctx: Context): ClientFeatureFlags => {
    _flags = {
      sidebarRightTabs: safeCheck(() => {
        const tabs = (ctx as unknown as { sidebarRightTabs?: unknown }).sidebarRightTabs;
        return tabs !== null && tabs !== undefined;
      }, false),
      betterSidebar: safeCheck(() => {
        const bs = ctx.get('betterSidebar');
        return bs !== null && bs !== undefined;
      }, false),
      spotlight: safeCheck(() => {
        const sp = ctx.get('spotlight');
        return sp !== null && sp !== undefined;
      }, false),
      slots: safeCheck(() => ctx.slots !== null && ctx.slots !== undefined, false),
    };
    log.info('client feature flags resolved', { flags: _flags, mode: _mode });
    return _flags;
  };

  const hasFlag = (key: keyof ClientFeatureFlags): boolean => _flags[key];

  return {
    get mode() { return _mode; },
    get flags() { return _flags; },
    detectMode,
    detectFlags,
    hasFlag,
  };
}