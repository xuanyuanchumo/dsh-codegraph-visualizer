import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import {
  parseDshVersion,
  probeReleaseFor,
  unknownDshVersion,
  type DshGeneration,
  type DshVersionInfo,
} from '../../shared/dshGeneration.ts';

const log = scoped('client:compat:version');

/** @deprecated alias kept for call sites; the model lives in `src/shared/dshGeneration.ts`. */
export type ClientGeneration = DshGeneration;
/** The browser half has no use for the prerelease tag, so it is dropped here. */
export type ClientVersionInfo = Omit<DshVersionInfo, 'prerelease'>;

/** Strip the host-only prerelease field so both halves report the same shape to consumers. */
function toClientVersionInfo(info: DshVersionInfo): ClientVersionInfo {
  const { raw, major, minor, patch, generation } = info;
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

/**
 * The client half runs in the browser and usually cannot read a version string, so it dates
 * the host from the service surface instead: `slots`/`sidebarRightTabs` arrived with 0.2,
 * `spotlight` is the only marker that dates back to 0.1. Order matters — the newest marker
 * wins.
 */
function detectFromApiShape(ctx: Context): string | null {
  if (safeCheck(() => {
    const tabs = (ctx as unknown as { sidebarRightTabs?: unknown }).sidebarRightTabs;
    return tabs !== null && tabs !== undefined;
  }, false)) {
    return probeReleaseFor('gen2');
  }
  if (safeCheck(() => {
    const rui = ctx.get('remoteWebUI');
    return rui !== null && rui !== undefined;
  }, false)) {
    return probeReleaseFor('gen2');
  }
  if (safeCheck(() => {
    const bs = ctx.get('betterSidebar');
    return bs !== null && bs !== undefined;
  }, false)) {
    return probeReleaseFor('gen2');
  }
  if (safeCheck(() => ctx.slots !== null && ctx.slots !== undefined, false)) {
    return probeReleaseFor('gen2');
  }
  if (safeCheck(() => {
    const sp = ctx.get('spotlight');
    return sp !== null && sp !== undefined;
  }, false)) {
    return probeReleaseFor('gen1');
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
        const info = parseDshVersion(raw);
        log.info('client version detected', { raw, generation: info.generation });
        return toClientVersionInfo(info);
      }
    } catch { /* ignore */ }
  }
  log.info('client version unknown, using feature detection only');
  return toClientVersionInfo(unknownDshVersion());
}
