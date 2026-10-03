import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCodegraphCli,
  checkPrerequisites,
  extractWorkspacePaths,
  findWorkspacePath,
  resolveWorkspaceRoots,
} from '../../src/host/prerequisites.ts';
import type { Context } from '@deepseek-ai/cordis';

type MockCtx = Context & {
  tools: { get: ReturnType<typeof vi.fn> };
};

describe('checkPrerequisites', () => {
  it('returns codegraph true when codegraph_status tool exists', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_status' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
    expect(result.lens).toBe(false);
  });

  it('returns codegraph true when codegraph_graph tool exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_graph' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
  });

  it('returns codegraph true when codegraph_query tool exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_query' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
  });

  it('returns lens true when lens_analyze tool exists', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'lens_analyze' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.lens).toBe(true);
    expect(result.codegraph).toBe(false);
  });

  it('returns lens true when only lens_impact exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'lens_impact' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.lens).toBe(true);
    expect(result.codegraph).toBe(false);
  });

  it('detects the upstream plugin through the tool it actually contributes', () => {
    // dsh-codegraph@0.1.3 declares exactly one tool in dsh.plugin.json: contributes.tools =
    // ["mcp__codegraph__codegraph_explore"]. Keying presence off codegraph_status alone
    // reported "prerequisite missing" on a host that had the plugin installed (J0 finding).
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'mcp__codegraph__codegraph_explore' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
    expect(result.lens).toBe(false);
  });

  it('prefers the name resolved by the compat layer', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_status' ? {} : undefined)) },
    } as unknown as MockCtx;
    const apiCompat = {
      getAvailableToolName: vi.fn((_ctx: unknown, key: string) => (key === 'codegraphStatus' ? 'codegraph_status' : null)),
    } as unknown as NonNullable<Parameters<typeof checkPrerequisites>[1]>;
    const result = checkPrerequisites(ctx, apiCompat);
    expect(result.codegraph).toBe(true);
    expect(apiCompat.getAvailableToolName).toHaveBeenCalledWith(ctx, 'codegraphStatus');
  });

  it('falls back to the evidence list when the compat layer resolves nothing', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'mcp__codegraph__codegraph_explore' ? {} : undefined)) },
    } as unknown as MockCtx;
    const apiCompat = {
      getAvailableToolName: vi.fn(() => null),
    } as unknown as NonNullable<Parameters<typeof checkPrerequisites>[1]>;
    const result = checkPrerequisites(ctx, apiCompat);
    expect(result.codegraph).toBe(true);
  });

  it('returns both false when no tools exist', () => {
    const ctx = {
      tools: { get: vi.fn(() => undefined) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual({ codegraph: false, lens: false, builtin: true });
  });

  it('returns both false when ctx.tools.get throws', () => {
    const ctx = {
      tools: { get: vi.fn(() => { throw new Error('boom'); }) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual({ codegraph: false, lens: false, builtin: true });
  });
});

describe('extractWorkspacePaths', () => {
  it('returns paths from workspaceRegistry when available', () => {
    const wsr = { list: () => [{ path: '/repo1' }, { path: '/repo2' }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1', '/repo2']);
  });

  it('filters out undefined paths from workspaceRegistry', () => {
    const wsr = { list: () => [{ path: '/repo1' }, {}, { path: undefined }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1']);
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const wsr = { list: () => [] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }, { header: { cwd: '/sess2' } }] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/sess1', '/sess2']);
  });

  it('dedupes session cwd paths', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [
        { header: { cwd: '/sess1' } },
        { header: { cwd: '/sess1' } },
        { header: { cwd: '/sess2' } },
      ] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/sess1', '/sess2']);
  });

  it('falls back to process.cwd() when no workspace or sessions', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when workspaceRegistry.list throws', () => {
    const wsr = { list: () => { throw new Error('boom'); } };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('resolveWorkspaceRoots reports which branch produced the roots (§31.7 observability)', () => {
    const wsr = { list: () => [{ path: '/repo1' }] };
    const fromRegistry = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromRegistry)).toEqual({ paths: ['/repo1'], source: 'registry' });

    const emptyRegistry = { list: () => [] };
    const fromSessions = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? emptyRegistry : undefined),
      workspaceRegistry: emptyRegistry,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }] },
    } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromSessions)).toEqual({ paths: ['/sess1'], source: 'sessions' });

    const fromCwd = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromCwd)).toEqual({ paths: [process.cwd()], source: 'cwd' });
  });

  it('extractWorkspacePaths stays a thin wrapper over resolveWorkspaceRoots', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(extractWorkspacePaths(ctx)).toEqual(resolveWorkspaceRoots(ctx).paths);
  });

  it('falls back to process.cwd() when sessions.list throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [{ header: {} }, {}] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });
});

describe('findWorkspacePath', () => {
  it('returns first path from workspaceRegistry', () => {
    const wsr = { list: () => [{ path: '/repo1' }, { path: '/repo2' }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/repo1');
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const wsr = { list: () => [] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/sess1');
  });

  it('falls back to process.cwd() when nothing available', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when workspaceRegistry throws', () => {
    const wsr = { list: () => { throw new Error('boom'); } };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [{ header: {} }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });
});

describe('detectCodegraphCli', () => {
  it('returns a boolean indicating whether codegraph CLI is available', async () => {
    const result = await detectCodegraphCli();
    expect(typeof result).toBe('boolean');
  });
});