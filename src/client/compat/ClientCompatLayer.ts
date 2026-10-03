import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import { detectClientVersion, type ClientVersionInfo, type ClientGeneration } from './ClientVersionDetector.ts';

const log = scoped('client:compat');

export type SidebarIntegrationMode = 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating' | 'remote-web-ui' | 'conversation-view';

export interface ClientFeatureFlags {
  sidebarRightTabs: boolean;
  betterSidebar: boolean;
  spotlight: boolean;
  slots: boolean;
  remoteWebUi: boolean;
  conversationView: boolean;
  desktopPlatform: boolean;
}

export interface ClientCompatLayer {
  mode: SidebarIntegrationMode;
  flags: ClientFeatureFlags;
  versionInfo: ClientVersionInfo;
  generation: ClientGeneration;
  detectMode(ctx: Context): SidebarIntegrationMode;
  detectFlags(ctx: Context): ClientFeatureFlags;
  detectVersion(ctx: Context): ClientVersionInfo;
  hasFlag(key: keyof ClientFeatureFlags): boolean;
  isGen1(): boolean;
  isGen2(): boolean;
  isGen3(): boolean;
}

export function createClientCompatLayer(): ClientCompatLayer {
  let _mode: SidebarIntegrationMode = 'floating';
  let _flags: ClientFeatureFlags = {
    sidebarRightTabs: false,
    betterSidebar: false,
    spotlight: false,
    slots: false,
    remoteWebUi: false,
    conversationView: false,
    desktopPlatform: false,
  };
  let _versionInfo: ClientVersionInfo = { raw: 'unknown', major: 0, minor: 0, patch: 0, generation: 'unknown' };

  const detectVersion = (ctx: Context): ClientVersionInfo => {
    _versionInfo = detectClientVersion(ctx);
    return _versionInfo;
  };

  const detectMode = (ctx: Context): SidebarIntegrationMode => {
    if (safeCheck(() => {
      const slots = ctx.slots;
      if (!slots) return false;
      return typeof slots.inject === 'function' && typeof slots.register === 'function';
    }, false)) {
      _mode = 'conversation-view';
      return _mode;
    }
    if (safeCheck(() => {
      const tabs = ctx.get('sidebarRightTabs');
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
    if (safeCheck(() => {
      const rui = ctx.get('remoteWebUI');
      return rui !== null && rui !== undefined;
    }, false)) {
      _mode = 'remote-web-ui';
      return _mode;
    }
    _mode = 'floating';
    return _mode;
  };

  const detectFlags = (ctx: Context): ClientFeatureFlags => {
    _flags = {
      sidebarRightTabs: safeCheck(() => {
        const tabs = ctx.get('sidebarRightTabs');
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
      remoteWebUi: safeCheck(() => {
        const rui = ctx.get('remoteWebUI');
        return rui !== null && rui !== undefined;
      }, false),
      conversationView: safeCheck(() => {
        const slots = ctx.slots;
        if (!slots) return false;
        return typeof slots.inject === 'function' && typeof slots.register === 'function';
      }, false),
      desktopPlatform: safeCheck(() => {
        const profiles = ctx.get('desktopProfiles');
        return profiles !== null && profiles !== undefined;
      }, false),
    };
    log.info('client feature flags resolved', { flags: _flags, mode: _mode, generation: _versionInfo.generation });
    return _flags;
  };

  const hasFlag = (key: keyof ClientFeatureFlags): boolean => _flags[key];
  const isGen1 = (): boolean => _versionInfo.generation === 'gen1';
  // gen3 is a forward-compatible superset of gen2 (mirrors the Host-side
  // ApiCompatLayer GEN3_MAPPING = { ...GEN2_MAPPING } strategy).
  const isGen2 = (): boolean => _versionInfo.generation === 'gen2' || _versionInfo.generation === 'gen3';
  const isGen3 = (): boolean => _versionInfo.generation === 'gen3';

  return {
    get mode() { return _mode; },
    get flags() { return _flags; },
    get versionInfo() { return _versionInfo; },
    get generation() { return _versionInfo.generation; },
    detectMode,
    detectFlags,
    detectVersion,
    hasFlag,
    isGen1,
    isGen2,
    isGen3,
  };
}