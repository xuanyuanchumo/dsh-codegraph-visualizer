import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCodegraphCli,
  checkPrerequisites,
  extractWorkspacePaths,
  findWorkspacePath,
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

  it('returns both false when no tools exist', () => {
    const ctx = {
      tools: { get: vi.fn(() => undefined) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual({ codegraph: false, lens: false });
  });

  it('returns both false when ctx.tools.get throws', () => {
    const ctx = {
      tools: { get: vi.fn(() => { throw new Error('boom'); }) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual({ codegraph: false, lens: false });
  });
});

describe('extractWorkspacePaths', () => {
  it('returns paths from workspaceRegistry when available', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => [{ path: '/repo1' }, { path: '/repo2' }] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1', '/repo2']);
  });

  it('filters out undefined paths from workspaceRegistry', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => [{ path: '/repo1' }, {}, { path: undefined }] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1']);
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => [] },
      sessions: { list: () => [{ header: { cwd: '/sess1' } }, { header: { cwd: '/sess2' } }] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/sess1', '/sess2']);
  });

  it('dedupes session cwd paths', () => {
    const ctx = {
      tools: { get: vi.fn() },
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
    const ctx = { tools: { get: vi.fn() } } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when workspaceRegistry.list throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when sessions.list throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
      sessions: { list: () => [{ header: {} }, {}] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });
});

describe('findWorkspacePath', () => {
  it('returns first path from workspaceRegistry', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => [{ path: '/repo1' }, { path: '/repo2' }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/repo1');
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => [] },
      sessions: { list: () => [{ header: { cwd: '/sess1' } }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/sess1');
  });

  it('falls back to process.cwd() when nothing available', () => {
    const ctx = { tools: { get: vi.fn() } } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when workspaceRegistry throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      workspaceRegistry: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
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