/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { detectHostVersion } from '../../src/host/compat/HostVersionDetector.ts';
import { createFeatureFlags } from '../../src/host/compat/FeatureFlags.ts';
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

  });

  it('detects gen2 from context version', () => {
    const ctx = makeMockContext({ version: '0.2.0' });
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen2');

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

  it('defaults to unknown when version undetectable', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('unknown');
  });


  it('parses prerelease versions', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0-rc.1' });
    const info = detectHostVersion(ctx);
    expect(info.prerelease).toBe('rc.1');
    expect(info.generation).toBe('gen2');
  });

  // --- gen3 support (added) ---
  it('parseVersion returns gen3 for 1.0.0', () => {
    const ctx = makeMockContext({ hostVersion: '1.0.0' });
    const info = detectHostVersion(ctx);
    expect(info.major).toBe(1);
    expect(info.minor).toBe(0);
    expect(info.patch).toBe(0);
    expect(info.generation).toBe('gen3');
  });

  it('parseVersion returns gen3 for 0.3.0 (v0.3.x = gen3)', () => {
    const ctx = makeMockContext({ hostVersion: '0.3.0' });
    const info = detectHostVersion(ctx);
    expect(info.major).toBe(0);
    expect(info.minor).toBe(3);
    expect(info.generation).toBe('gen3');
  });

  it('parseVersion returns gen3 for 0.3.0-rc.1', () => {
    const ctx = makeMockContext({ hostVersion: '0.3.0-rc.1' });
    const info = detectHostVersion(ctx);
    expect(info.prerelease).toBe('rc.1');
    expect(info.generation).toBe('gen3');
  });


  it('parses gen3 prerelease versions', () => {
    const ctx = makeMockContext({ hostVersion: '1.2.3-rc.1' });
    const info = detectHostVersion(ctx);
    expect(info.prerelease).toBe('rc.1');
    expect(info.generation).toBe('gen3');
  });

  it('detects gen3 from app.version', () => {
    const ctx = makeMockContext({ app: { version: '2.5.0' } });
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('gen3');
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
    expect(flags.multiWorkspace).toBe(false);
  });

  it('gen2 flags enable all features', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.incrementalBootstrap).toBe(true);
    expect(flags.workspaceRegistry).toBe(true);
    expect(flags.betterSidebar).toBe(true);
    expect(flags.multiWorkspace).toBe(true);
  });

  it('default to conservative flags when version undetectable', () => {
    const ctx = makeMockContext({});
    ctx.tools.get = vi.fn(() => undefined);
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.incrementalBootstrap).toBe(false);
    expect(flags.betterSidebar).toBe(true);
  });


  // --- gen3 feature flags (added) ---
  it('gen3 flags include desktopPlatform, aiAssist/crossRepo are placeholder false', () => {
    const ctx = makeMockContext({ hostVersion: '1.0.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.desktopPlatform).toBe(true);
    // aiAssist/crossRepo are placeholder false until v0.3.0 confirms these APIs
    expect(flags.aiAssist).toBe(false);
    expect(flags.crossRepo).toBe(false);
  });

  it('createFeatureFlags returns correct gen3 flags (superset of gen2)', () => {
    const ctx = makeMockContext({ hostVersion: '1.0.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    // inherited from gen2
    expect(flags.incrementalBootstrap).toBe(true);
    expect(flags.workspaceRegistry).toBe(true);
    expect(flags.betterSidebar).toBe(true);
    expect(flags.multiWorkspace).toBe(true);
    expect(flags.sessionsApi).toBe(true);
    expect(flags.mcpServer).toBe(true);
    // gen3-only additions (placeholder until v0.3.0 confirms)
    expect(flags.desktopPlatform).toBe(true);
    expect(flags.aiAssist).toBe(false);
    expect(flags.crossRepo).toBe(false);
  });

  it('gen2 flags do not include aiAssist/crossRepo', () => {
    const ctx = makeMockContext({ hostVersion: '0.2.0' });
    const info = detectHostVersion(ctx);
    const flags = createFeatureFlags(info);
    expect(flags.aiAssist).toBe(false);
    expect(flags.crossRepo).toBe(false);
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