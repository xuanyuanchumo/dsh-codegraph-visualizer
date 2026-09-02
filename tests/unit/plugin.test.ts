// Unit tests for Host plugin entry + createGraphTools — J1/J9/J11/J13 lifecycle
// Note: tools now delegate to dsh-codegraph's codegraph_query/codegraph_impact/
// codegraph_init/codegraph_status. Tests mock the adapter class so results
// are deterministic regardless of the live .codegraph DB.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools } from '../../src/tools.ts';

// Mock the CodeGraphAdapter class — factory runs at module load time so we
// define the mock inline rather than referencing a later variable.
vi.mock('../../src/adapters/CodeGraphAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
    source: 'codegraph' as const,
    timestamp: 1,
  });
  return {
    CodeGraphAdapter: vi.fn().mockImplementation(() => ({
      fetchData: mockFetchData,
      source: 'codegraph' as const,
    })),
  };
});

const { CodeGraphAdapter } = await import('../../src/adapters/CodeGraphAdapter.ts');

type MockCtx = Context & {
  tools: {
    register: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  effect: ReturnType<typeof vi.fn>;
  webServer: {
    register: ReturnType<typeof vi.fn>;
  };
};

function makeMockCtx(): MockCtx {
  return {
    tools: {
      register: vi.fn(),
      execute: vi.fn().mockResolvedValue({ isError: false, value: null }),
      get: vi.fn().mockReturnValue(undefined),
    },
    on: vi.fn(),
    emit: vi.fn(),
    effect: vi.fn((fn: () => unknown) => { fn(); return () => {}; }),
    webServer: {
      register: vi.fn().mockReturnValue(() => {}),
    },
  } as unknown as MockCtx;
}

// Minimal ToolRunContext mock: execute(args, exec) requires a run context.
const mockExec = {
  deferContext: vi.fn(),
  concludeTurn: vi.fn(),
} as unknown as Parameters<ReturnType<typeof createGraphTools>['graphStatus']['execute']>[1];

function getMockFetchData() {
  const adapter = new CodeGraphAdapter();
  return adapter.fetchData as ReturnType<typeof vi.fn>;
}

describe('createGraphTools (J1/J9/J11)', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
    getMockFetchData().mockClear();
  });

  it('should create 4 tools with correct names', () => {
    const tools = createGraphTools(ctx);
    expect(tools.graphStatus.name).toBe('graph_status');
    expect(tools.graphData.name).toBe('graph_data');
    expect(tools.graphSymbol.name).toBe('graph_symbol');
    expect(tools.graphImpact.name).toBe('graph_impact');
  });

  it('graph_data should return merged graph and emit update (J9)', async () => {
    getMockFetchData().mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data should use incremental delta on repeat calls', async () => {
    getMockFetchData().mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = createGraphTools(ctx);
    await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    const result2 = await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    expect(result2).toHaveProperty('nodes');
  });

  it('graph_symbol should return symbol detail', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_query') {
        return { isError: false, value: [{ name: 'funcA', kind: 'function', filePath: 'a.ts', startLine: 10 }] };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphSymbol.execute({ symbolId: 's1' }, mockExec);
    expect(result).toHaveProperty('name', 'funcA');
  });

  it('graph_symbol should return null when symbol not found', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = createGraphTools(ctx);
    const result = await tools.graphSymbol.execute({ symbolId: 'missing' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_impact should return affected symbols', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_impact') {
        return { isError: false, value: { affected: ['s1', 's2'], depth: 2 } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: ['s1', 's2'], depth: 2 });
  });

  it('graph_impact should fall back to lens_impact when codegraph_impact unavailable', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_impact') {
        return { isError: false, value: null };
      }
      if (req.name === 'lens_impact') {
        return { isError: false, value: { affected: ['l1'], depth: 1 } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: ['l1'], depth: 1 });
  });

  it('invoke should return null on upstream error', async () => {
    ctx.tools.execute.mockRejectedValue(new Error('timeout'));
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: [], depth: 0 });
  });

  it('invoke should return null when result.isError', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: true, value: null });
    const tools = createGraphTools(ctx);
    const result = await tools.graphSymbol.execute({ symbolId: 's0' }, mockExec);
    expect(result).toBeNull();
  });
});

describe('apply() plugin entry (J13 lifecycle)', () => {
  it('should register 4 tools and 6 event listeners', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    expect(ctx.tools.register).toHaveBeenCalledTimes(4);
    expect(ctx.on).toHaveBeenCalledTimes(6);
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/imported', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/scanned', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/request-scan', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/graph/init', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/watch/toggle', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/prerequisite/request', expect.any(Function));
  });


  it('should forward repo imported/scanned events as graph updated events', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);

    handlers.get('codegraph/repo/imported')!({ repoId: 'r1', path: '/x', timestamp: 123 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: 'r1' }));

    handlers.get('codegraph/repo/scanned')!({ repoId: 'r2', fileCount: 3, timestamp: 456 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: 'r2' }));
  });

  it('request-scan should emit graph updated + graph data with merged counts', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    handlers.get('codegraph/repo/request-scan')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/data', expect.objectContaining({ repoId: '/tmp/repo' }));
    });
  });

  it('graph init success should emit init-result + trigger scan', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_init') {
        return { isError: false, value: 'initialized' };
      }
      return { isError: false, value: null };
    });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    handlers.get('codegraph/graph/init')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/init-result', expect.objectContaining({ success: true }));
    });
  });

  it('graph init failure should emit failed init-result', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    handlers.get('codegraph/graph/init')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/init-result', expect.objectContaining({ success: false }));
    });
  });

  it('should emit prerequisite status on apply', () => {
    const ctx = makeMockCtx();
    const { apply } = require('../../src/index.ts');
    apply(ctx);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/prerequisite/status', expect.objectContaining({
      codegraph: expect.any(Boolean),
      lens: expect.any(Boolean),
    }));
  });

  it('watch toggle should close existing watcher when disabled', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    handlers.get('codegraph/watch/toggle')!({ enabled: false, path: '/tmp/repo', timestamp: 1 });
    expect(ctx.emit).not.toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: '/tmp/repo' }));
  });

  it('watch toggle should start watching when enabled', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    handlers.get('codegraph/watch/toggle')!({ enabled: true, path: '/tmp/repo', timestamp: 1 });
  });

  it('should register effect for cleanup', () => {
    const ctx = makeMockCtx();
    const { apply } = require('../../src/index.ts');
    apply(ctx);
    expect(ctx.effect).toHaveBeenCalled();
  });
});
