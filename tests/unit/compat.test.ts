/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { detectHostVersion, isGen1, isGen2, meetsMinimum } from '../../src/host/compat/HostVersionDetector.ts';
import { createFeatureFlags, hasFlag } from '../../src/host/compat/FeatureFlags.ts';
import { createApiCompatLayer, createToolNameMapping } from '../../src/host/compat/ApiCompatLayer.ts';

function makeMockContext(overrides: Record<string, unknown> = {}) {
  const tools = {
    get: vi.fn((name: string) => (name === 'codegraph_status' ? { name } : undefined)),
  };
  return { tools, ...overrides } as any;
}

describe('HostVersionDetector', () => {
  it('detects gen1 from context hostVersion', () => {
    const ctx = makeMockContext({ hostVersion: '0.1.7-rc.2' });
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen1');
    expect(info.major).toBe(0);
    expect(info.minor).toBe(1);
    expect(isGen1(info)).toBe(true);
    expect(isGen2(info)).toBe(false);
  });

  it('detects gen2 from context version', () => {
    const ctx = makeMockContext({ version: '0.2.0' });
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen2');
    expect(isGen2(info)).toBe(true);
  });

  it('detects gen2 from app.version', () => {
    const ctx = makeMockContext({ app: { version: '0.2.1' } });
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen2');
  });

  it('falls back to env variable', () => {
    process.env.DSH_HOST_VERSION = '0.1.5';
    const ctx = makeMockContext({});
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen1');
    delete process.env.DSH_HOST_VERSION;
  });

  it('falls back to tool name detection - gen2', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn((name: string) => (name === 'codegraph_incremental' ? { name } : undefined));
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen2');
  });

  it('falls back to tool name detection - gen1', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn((name: string) => (name === 'codegraph_status' ? { name } : undefined));
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen1');
  });

  it('defaults to gen2 when unknown', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen2');
  });

  it('meetsMinimum returns true when version meets minimum', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    expect(meetsMinimum(info, 0, 2)).toBe(true);
  });

  it('meetsMinimum compares versions correctly', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    expect(meetsMinimum(info, 0, 2)).toBe(true);
    expect(meetsMinimum(info, 0, 3)).toBe(false);
    expect(meetsMinimum(info, 1, 0)).toBe(false);
  });

  it('parses prerelease versions', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0-rc.1' });
    const info = detectHostVersion(ctx);
    expect(info.prerelease).toBe('rc.1');
    expect(info.generation).toBe('gen2');
  });
});

describe('FeatureFlags', () => {
  it('gen1 flags disable gen2-only features', () => {
    const ctx = makeMockContext({ hostVersion: '0.1.7' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.incrementalBootstrap).toBe(false);
    expect(flags.workspaceRegistry).toBe(false);
    expect(flags.betterSidebar).toBe(false);
    expect(flags.spotlight).toBe(false);
    expect(flags.remoteWebUi).toBe(false);
    expect(flags.multiWorkspace).toBe(false);
  });

  it('gen2 flags enable all features', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.incrementalBootstrap).toBe(true);
    expect(flags.workspaceRegistry).toBe(true);
    expect(flags.betterSidebar).toBe(true);
    expect(flags.remoteWebUi).toBe(true);
    expect(flags.multiWorkspace).toBe(true);
  });

  it('default to gen2 flags when version undetectable', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.incrementalBootstrap).toBe(true);
    expect(flags.remoteWebUi).toBe(true);
    expect(flags.betterSidebar).toBe(true);
  });

  it('hasFlag checks specific flag', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(hasFlag(flags, 'incrementalBootstrap')).toBe(true);
    expect(hasFlag(flags, 'remoteWebUi')).toBe(true);
  });
});

describe('ApiCompatLayer', () => {
  it('gen1 mapping has no bootstrap/incremental', () => {
    const ctx = makeMockContext({ hostVersion: '0.1.7' });
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.resolveToolName('codegraphBootstrap')).toBeNull();
    expect(compat.resolveToolName('codegraphIncremental')).toBeNull();
    expect(compat.resolveToolName('codegraphStatus')).toBe('codegraph_status');
  });

  it('gen2 mapping has bootstrap/incremental', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.resolveToolName('codegraphBootstrap')).toBe('codegraph_bootstrap');
    expect(compat.resolveToolName('codegraphIncremental')).toBe('codegraph_incremental');
  });

  it('getAvailableToolName returns primary when available', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    ctx.tools.get = vi.fn((name: string) => (name === 'codegraph_status' ? { name } : undefined));
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.getAvailableToolName(ctx, 'codegraphStatus')).toBe('codegraph_status');
  });

  it('getAvailableToolName falls back to alternative', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    ctx.tools.get = vi.fn((name: string) => {
      if (name === 'codegraph_graph') return { name };
      return undefined;
    });
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.getAvailableToolName(ctx, 'codegraphStatus')).toBe('codegraph_graph');
  });

  it('getAvailableToolName returns null when no tool available', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.getAvailableToolName(ctx, 'codegraphStatus')).toBeNull();
  });

  it('isToolAvailable checks ctx.tools.get', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    ctx.tools.get = vi.fn((name: string) => (name === 'codegraph_query' ? { name } : undefined));
    const info = detectHostVersion(ctx);
    const compat = createApiCompatLayer(info);
    expect(compat.isToolAvailable(ctx, 'codegraphQuery')).toBe(true);
    expect(compat.isToolAvailable(ctx, 'codegraphStatus')).toBe(false);
  });

  it('createToolNameMapping returns correct mapping for gen1', () => {
    const ctx = makeMockContext({ hostVersion: '0.1.7' });
    const info = detectHostVersion(ctx);
    const mapping = createToolNameMapping(info);
    expect(mapping.codegraphStatus).toBe('codegraph_status');
    expect(mapping.codegraphBootstrap).toBeNull();
  });
});