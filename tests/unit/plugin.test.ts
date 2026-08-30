// Unit tests for Host plugin entry + createGraphTools — J1/J9/J11/J13 lifecycle
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createGraphTools } from '../../src/tools.ts';

type MockCtx = Context & {
  tools: {
    register: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

function makeMockCtx(): MockCtx {
  return {
    tools: {
      register: vi.fn(),
      execute: vi.fn().mockResolvedValue({ isError: false, value: null }),
    },
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as MockCtx;
}

// Minimal ToolRunContext mock: execute(args, exec) requires a run context.
const mockExec = {
  deferContext: vi.fn(),
  concludeTurn: vi.fn(),
} as unknown as Parameters<ReturnType<typeof createGraphTools>['graphStatus']['execute']>[1];

describe('createGraphTools (J1/J9/J11)', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
  });

  it('should create 4 tools with correct names', () => {
    const tools = createGraphTools(ctx);
    expect(tools.graphStatus.name).toBe('graph_status');
    expect(tools.graphData.name).toBe('graph_data');
    expect(tools.graphSymbol.name).toBe('graph_symbol');
    expect(tools.graphImpact.name).toBe('graph_impact');
  });

  it('graph_status should report ready when data exists', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_graph') {
        return { isError: false, value: { nodes: [{ id: 'n1', name: 'f', kind: 'function', file: 'a.ts', line: 1 }], edges: [] } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec) as { status: string; nodeCount: number };
    expect(result.status).toBe('ready');
    expect(result.nodeCount).toBeGreaterThanOrEqual(1);
  });

  it('graph_status should report unavailable when no data', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec) as { status: string; nodeCount: number };
    expect(result.status).toBe('unavailable');
    expect(result.nodeCount).toBe(0);
  });

  it('graph_data should return merged graph and emit update (J9)', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_graph') {
        return { isError: false, value: { nodes: [{ id: 'n1', name: 'f', kind: 'function', file: 'a.ts', line: 1 }], edges: [] } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data should use incremental delta on repeat calls', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_graph') {
        return { isError: false, value: { nodes: [{ id: 'n1', name: 'f', kind: 'function', file: 'a.ts', line: 1 }], edges: [] } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    const result2 = await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    expect(result2).toHaveProperty('nodes');
  });

  it('graph_data should delta-merge cached nodes on repeat calls (heat-update)', async () => {
    let r0Call = 0;
    ctx.tools.execute.mockImplementation(async (req: { name: string; arguments?: { repoId?: string } }) => {
      if (req.name === 'codegraph_graph') {
        const rid = req.arguments?.repoId ?? '';
        const nodeId = rid === 'r0' ? `n-r0-${++r0Call}` : `n-${rid}`;
        return { isError: false, value: { nodes: [{ id: nodeId, name: 'f', kind: 'function', file: 'a.ts', line: 1 }], edges: [] } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const first = await tools.graphData.execute({ repoId: 'r0' }, mockExec) as { nodes: Array<{ id: string }> };
    expect(first.nodes).toHaveLength(1);
    const second = await tools.graphData.execute({ repoId: 'r0' }, mockExec) as { nodes: Array<{ id: string }> };
    // Cached n-r0-1 + fresh n-r0-2 both survive the delta merge.
    expect(second.nodes.map(n => n.id).sort()).toEqual(['n-r0-1', 'n-r0-2']);
  });

  it('graph_data should evict the oldest entry beyond the LRU cache limit (NFR-06)', async () => {
    let r0Call = 0;
    ctx.tools.execute.mockImplementation(async (req: { name: string; arguments?: { repoId?: string } }) => {
      if (req.name === 'codegraph_graph') {
        const rid = req.arguments?.repoId ?? '';
        const nodeId = rid === 'r0' ? `n-r0-${++r0Call}` : `n-${rid}`;
        return { isError: false, value: { nodes: [{ id: nodeId, name: 'f', kind: 'function', file: 'a.ts', line: 1 }], edges: [] } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);

    // Prime the cache for r0 (limit is 8), then touch r1..r8 to evict it.
    await tools.graphData.execute({ repoId: 'r0' }, mockExec);
    for (let i = 1; i <= 8; i++) {
      await tools.graphData.execute({ repoId: `r${i}` }, mockExec);
    }

    // r0 was evicted: no cached n-r0-1 can be merged back into the result.
    const again = await tools.graphData.execute({ repoId: 'r0' }, mockExec) as { nodes: Array<{ id: string }> };
    expect(again.nodes.map(n => n.id)).toEqual(['n-r0-2']);
  });

  it('graph_symbol should return symbol detail', async () => {
    ctx.tools.execute.mockImplementation(async (req: { name: string }) => {
      if (req.name === 'codegraph_symbol') {
        return { isError: false, value: { name: 'funcA', file: 'a.ts', line: 10, category: 'function' } };
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
      if (req.name === 'lens_impact') {
        return { isError: false, value: { affected: ['s1', 's2'], depth: 2 } };
      }
      return { isError: false, value: null };
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: ['s1', 's2'], depth: 2 });
  });

  it('graph_impact should return empty when lens unavailable', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: [], depth: 0 });
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
  it('should register 4 tools and 3 event listeners', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    apply(ctx);
    expect(ctx.tools.register).toHaveBeenCalledTimes(4);
    expect(ctx.on).toHaveBeenCalledTimes(3);
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/imported', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/scanned', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph/repo/request-scan', expect.any(Function));
  });
});

