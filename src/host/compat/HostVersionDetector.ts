import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('host:compat');

export type HostGeneration = 'gen1' | 'gen2' | 'gen3' | 'unknown';

export interface HostVersionInfo {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  generation: HostGeneration;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/;

function parseVersion(raw: string): HostVersionInfo {
  const match = raw.match(VERSION_PATTERN);
  if (!match) {
    return { raw, major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
  }
  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patch = parseInt(match[3]!, 10);
  const prerelease = match[4] ?? null;
  let generation: HostGeneration = 'unknown';
  if (major === 0 && minor >= 1 && minor < 2) generation = 'gen1';
  else if (major === 0 && minor >= 2) generation = 'gen2';
  else if (major >= 1) generation = 'gen3';
  return { raw, major, minor, patch, prerelease, generation };
}

function detectFromContext(ctx: Context): string | null {
  const candidates = [
    () => ctx.hostVersion,
    () => ctx.version,
    () => ctx.app?.version,
    () => ctx.runtime?.version,
  ];
  for (const fn of candidates) {
    try {
      const v = fn();
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return null;
}

function detectFromEnv(): string | null {
  const envKeys = ['DSH_HOST_VERSION', 'DSH_VERSION', 'CODEARTS_HOST_VERSION'];
  for (const key of envKeys) {
    const v = process.env[key];
    if (v && v.length > 0) return v;
  }
  return null;
}

function detectFromToolNames(ctx: Context): string | null {
  try {
    const tools = ctx.tools;
    const hasGen2OnlyTool = tools.get('codegraph_incremental') ?? tools.get('codegraph_bootstrap');
    if (hasGen2OnlyTool) return '0.2.0';
    const hasGen1Tool = tools.get('codegraph_status') ?? tools.get('codegraph_graph');
    if (hasGen1Tool) return '0.1.7';
  } catch { /* ignore */ }
  return null;
}

export function detectHostVersion(ctx: Context): HostVersionInfo {
  const sources = [
    () => detectFromContext(ctx),
    () => detectFromEnv(),
    () => detectFromToolNames(ctx),
  ];
  for (const fn of sources) {
    try {
      const raw = fn();
      if (raw) {
        const info = parseVersion(raw);
        log.info('host version detected', { raw, generation: info.generation });
        return info;
      }
    } catch { /* ignore */ }
  }
  log.info('host version unknown, using conservative flags');
  return { raw: 'unknown', major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
}

