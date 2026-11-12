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
    closeAllDbConnections: vi.fn(),
  };
});

vi.mock('../../src/adapters/LensAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
    source: 'lens' as const,
    timestamp: 1,
  });
  return {
    LensAdapter: vi.fn().mockImplementation(() => ({
      fetchData: mockFetchData,
      source: 'lens' as const,
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
  provide: ReturnType<typeof vi.fn>;
  webServer: {
    register: ReturnType<typeof vi.fn>;
    registerFallback: ReturnType<typeof vi.fn>;
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
    provide: vi.fn().mockReturnValue(() => {}),
    webServer: {
      register: vi.fn().mockReturnValue(() => {}),
      registerFallback: vi.fn().mockReturnValue(() => {}),
    },
  } as unknown as MockCtx;
}

// Minimal ToolRunContext mock: execute(args, exec) requires a run context.
const mockExec = {
  deferContext: vi.fn(),
  concludeTurn: vi.fn(),
} as unknown as Parameters<Awaited<ReturnType<typeof createGraphTools>>['graphStatus']['execute']>[1];

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

  it('should create 4 tools with correct names', async () => {
    const tools = await createGraphTools(ctx);
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
    const tools = await createGraphTools(ctx);
    const result = await tools.graphData.execute({ repoId: 'r1' }, mockExec);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data should use incremental delta on repeat calls', async () => {
    getMockFetchData().mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
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
    const tools = await createGraphTools(ctx);
    const result = await tools.graphSymbol.execute({ symbolId: 's1' }, mockExec);
    expect(result).toHaveProperty('name', 'funcA');
  });

  it('graph_symbol should return null when symbol not found', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = await createGraphTools(ctx);
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
    const tools = await createGraphTools(ctx);
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
    const tools = await createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: ['l1'], depth: 1 });
  });

  it('invoke should return null on upstream error', async () => {
    ctx.tools.execute.mockRejectedValue(new Error('timeout'));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: [], depth: 0 });
  });

  it('invoke should return null when result.isError', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: true, value: null });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphSymbol.execute({ symbolId: 's0' }, mockExec);
    expect(result).toBeNull();
  });
});

describe('apply() plugin entry (J13 lifecycle)', () => {
  it('should register 15 tools and 6 event listeners', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    // cycle-132：+graph_integrity（璇玑图白盒可观测）。
    // cycle-134：+graph_path_pattern（路径模式 ρ 读法）。
    // cycle-135：+graph_slice（多维视图切片）。
    // cycle-138：+graph_views（Π 视图划分函数）。
    expect(ctx.tools.register).toHaveBeenCalledTimes(15);
    expect(ctx.on).toHaveBeenCalledTimes(6);
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/repo/imported', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/repo/scanned', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/repo/request-scan', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/graph/init', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/watch/toggle', expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/prerequisite/request', expect.any(Function));
  });

  // 「createGraphTools 返回了工具」≠「插件注册了它」：入口是手写解构 + 逐条
  // register，漏一条就是永不执行的死工具，而 tools.test.ts 直接调 execute()
  // 永远发现不了。这条用例用「返回集合 == 注册集合」钉住两边同时改。
  it('should register exactly the tools that createGraphTools returns (no dead tool)', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);

    const registeredNames = ctx.tools.register.mock.calls
      .map((call) => (call[0] as { name?: string }).name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
    expect(new Set(registeredNames).size).toBe(registeredNames.length);

    const toolsCtx = makeMockCtx();
    const tools = await createGraphTools(toolsCtx);
    const returnedNames = Object.entries(tools)
      .filter(([key]) => key !== 'dispose')
      .map(([, tool]) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === 'string')
      .sort();

    expect(registeredNames).toEqual(returnedNames);
    expect(registeredNames).toContain('graph_path_enumerate');
    expect(registeredNames).toContain('graph_cycles');
    // GF-P0-2：新工具必须同时在「工厂返回」与「入口注册」两侧出现——只改一侧就是
    // cycle-107 的死工具（工厂返回了、入口没解构，/tools 里永远看不到）。
    expect(registeredNames).toContain('graph_query');
    expect(returnedNames).toContain('graph_query');
    // cycle-132：graph_integrity 同样两侧都必须出现（白盒可观测工具）。
    expect(registeredNames).toContain('graph_integrity');
    expect(returnedNames).toContain('graph_integrity');
    // cycle-134：graph_path_pattern（ρ 序列读法）同样两侧都必须出现。
    expect(registeredNames).toContain('graph_path_pattern');
    expect(returnedNames).toContain('graph_path_pattern');
    // cycle-135：graph_slice（多维视图切片）同样两侧都必须出现。
    expect(registeredNames).toContain('graph_slice');
    expect(returnedNames).toContain('graph_slice');
    // cycle-138：graph_views（Π 视图划分函数）同样两侧都必须出现。
    expect(registeredNames).toContain('graph_views');
    expect(returnedNames).toContain('graph_views');
    // 计数式断言的补充：集合相等 + 唯一性已由上面两行钉住，这里再钉「数量确实是 15」，
    // 否则「工厂和入口同时漏掉同一个工具」仍然满足集合相等。
    expect(registeredNames).toHaveLength(15);
  });


  it('should forward repo imported/scanned events as graph updated events', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);

    handlers.get('codegraph-visualizer/repo/imported')!({ repoId: 'r1', path: '/x', timestamp: 123 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: 'r1' }));

    handlers.get('codegraph-visualizer/repo/scanned')!({ repoId: 'r2', fileCount: 3, timestamp: 456 });
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: 'r2' }));
  });

  it('request-scan should emit graph updated + graph data with merged counts', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    handlers.get('codegraph-visualizer/repo/request-scan')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/data', expect.objectContaining({ repoId: '/tmp/repo' }));
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
    await apply(ctx);
    handlers.get('codegraph-visualizer/graph/init')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/init-result', expect.objectContaining({ success: true }));
    });
  });

  it('graph init failure should emit failed init-result', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    handlers.get('codegraph-visualizer/graph/init')!({ path: '/tmp/repo', timestamp: 1 });
    await vi.waitFor(() => {
      expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/init-result', expect.objectContaining({ success: false }));
    });
  });

  it('should emit prerequisite status on apply', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/prerequisite/status', expect.objectContaining({
      codegraph: expect.any(Boolean),
      lens: expect.any(Boolean),
    }));
  });

  it('watch toggle should close existing watcher when disabled', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    handlers.get('codegraph-visualizer/watch/toggle')!({ enabled: false, path: '/tmp/repo', timestamp: 1 });
    expect(ctx.emit).not.toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: '/tmp/repo' }));
  });

  it('watch toggle should start watching when enabled', async () => {
    const ctx = makeMockCtx();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    ctx.on.mockImplementation((name: string, fn: (e: unknown) => void) => { handlers.set(name, fn as (e: Record<string, unknown>) => void); });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    handlers.get('codegraph-visualizer/watch/toggle')!({ enabled: true, path: '/tmp/repo', timestamp: 1 });
  });

  it('should register effect for cleanup', async () => {
    const ctx = makeMockCtx();
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    expect(ctx.effect).toHaveBeenCalled();
  });

  // cycle-150：崩溃安全注册——单个 register 抛出（同名冲突/宿主校验拒绝）绝不能
  // 拖垮其余 14 个工具。借鉴 dsh-ops 静默降级模式：跳过失败项、其余照常注册。
  it('crash-safe registration: one failing register must not block the other 14', async () => {
    const ctx = makeMockCtx();
    let calls = 0;
    ctx.tools.register.mockImplementation(() => {
      calls++;
      if (calls === 3) throw new Error('duplicate tool name');
      return () => {};
    });
    const { apply } = await import('../../src/index.ts');
    await expect(apply(ctx)).resolves.toBeUndefined();
    expect(ctx.tools.register).toHaveBeenCalledTimes(15);
    // 14 个成功注册 + 1 个失败降级：白盒结果必须可查询而非只进日志。
    const outcome = (globalThis as Record<string, unknown>).__cgvRegistrationOutcome as { registered: number; failed: string[] };
    expect(outcome.registered).toBe(14);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]).toContain('graph_symbol');
    expect(outcome.failed[0]).toContain('duplicate tool name');
  });

  it('crash-safe registration: register returning a non-function must be recorded as failed', async () => {
    const ctx = makeMockCtx();
    ctx.tools.register.mockImplementation(() => undefined);
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    const outcome = (globalThis as Record<string, unknown>).__cgvRegistrationOutcome as { registered: number; failed: string[] };
    expect(outcome.registered).toBe(0);
    expect(outcome.failed).toHaveLength(15);
  });

  it('crash-safe registration: disposer tolerates individual unregister failures (hot reload)', async () => {
    const ctx = makeMockCtx();
    const disposeCalls: number[] = [];
    ctx.tools.register.mockImplementation(() => () => {
      disposeCalls.push(1);
      if (disposeCalls.length === 2) throw new Error('already unregistered');
    });
    const { apply } = await import('../../src/index.ts');
    await apply(ctx);
    // 找到工具注册 effect 的收口函数并执行——单个撤销失败不得影响其余。
    const effectCalls = ctx.effect.mock.calls as Array<[() => () => void, string]>;
    const regEffect = effectCalls.find(([, label]) => label === 'codegraph: tool registrations');
    expect(regEffect).toBeTruthy();
    const dispose = regEffect![0]();
    expect(() => dispose()).not.toThrow();
    expect(disposeCalls).toHaveLength(15);
  });
});
