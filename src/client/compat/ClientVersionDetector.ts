import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';

const log = scoped('client:compat:version');

export type ClientGeneration = 'gen1' | 'gen2' | 'gen3' | 'unknown';

export interface ClientVersionInfo {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  generation: ClientGeneration;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/;

function parseVersion(raw: string): ClientVersionInfo {
  const match = raw.match(VERSION_PATTERN);
  if (!match) {
    return { raw, major: 0, minor: 0, patch: 0, generation: 'unknown' };
  }
  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patch = parseInt(match[3]!, 10);
  let generation: ClientGeneration = 'unknown';
  if (major === 0 && minor >= 1 && minor < 2) generation = 'gen1';
  else if (major === 0 && minor >= 2 && minor < 3) generation = 'gen2';
  else if (major === 0 && minor >= 3) generation = 'gen3';
  else if (major >= 1) generation = 'gen3';
  return { raw, major, minor, patch, generation };
}

function detectFromContext(ctx: Context): string | null {
  const candidates = [
    () => (ctx as unknown as { hostVersion?: string }).hostVersion,
    () => (ctx as unknown as { version?: string }).version,
    () => (ctx as unknown as { app?: { version?: string } }).app?.version,
    () => (ctx as unknown as { runtime?: { version?: string } }).runtime?.version,
  ];
  for (const fn of candidates) {
    try {
      const v = fn();
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return null;
}

function detectFromApiShape(ctx: Context): string | null {
  if (safeCheck(() => {
    const tabs = (ctx as unknown as { sidebarRightTabs?: unknown }).sidebarRightTabs;
    return tabs !== null && tabs !== undefined;
  }, false)) {
    return '0.2.0';
  }
  if (safeCheck(() => {
    const rui = ctx.get('remoteWebUI');
    return rui !== null && rui !== undefined;
  }, false)) {
    return '0.2.0';
  }
  if (safeCheck(() => {
    const bs = ctx.get('betterSidebar');
    return bs !== null && bs !== undefined;
  }, false)) {
    return '0.2.0';
  }
  if (safeCheck(() => ctx.slots !== null && ctx.slots !== undefined, false)) {
    return '0.2.0';
  }
  if (safeCheck(() => {
    const sp = ctx.get('spotlight');
    return sp !== null && sp !== undefined;
  }, false)) {
    return '0.1.7';
  }
  return null;
}

export function detectClientVersion(ctx: Context): ClientVersionInfo {
  const sources = [
    () => detectFromContext(ctx),
    () => detectFromApiShape(ctx),
  ];
  for (const fn of sources) {
    try {
      const raw = fn();
      if (raw) {
        const info = parseVersion(raw);
        log.info('client version detected', { raw, generation: info.generation });
        return info;
      }
    } catch { /* ignore */ }
  }
  log.info('client version unknown, using feature detection only');
  return { raw: 'unknown', major: 0, minor: 0, patch: 0, generation: 'unknown' };
}