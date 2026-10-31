// Unit tests for Host tool factory — graph_status/graph_data/graph_symbol/graph_impact
// Note: fetchMergedGraph delegates to CodeGraphAdapter which reads .codegraph/
// codegraph.db directly. In tests we test the pure transform functions which
// don't depend on the live .codegraph DB or the adapter mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMergedGraph,
  createGraphTools,
  createInvoke,
  createGraphToolDeps,
  executeGraphStatus,
  executeGraphData,
  executeGraphSymbol,
  executeGraphImpact,
} from '../../src/tools.ts';
import {
  summarizeGraph,
  pickBestMatch,
  normalizeImpact,
  renderGraphStatus,
  renderGraphData,
  renderGraphSymbol,
  renderGraphImpact,
} from '../../src/graphUtils.ts';
import { RepoId as makeRepoId } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { GraphData } from '../../src/types/index.ts';
import type { UpstreamInvoker } from '../../src/adapters/CodeGraphAdapter.ts';
import type { Context } from '@deepseek-ai/cordis';
import { XuanjiAdapterPool } from '../../src/shared/analysis/XuanjiAdapter.ts';

type TextOutput = Array<{ type: string; text: string }>;


// ── Mock adapters so createGraphTools doesn't hit real DB ──────────────
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
const { LensAdapter } = await import('../../src/adapters/LensAdapter.ts');

type MockCtx = Context & {
  tools: {
    register: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  effect: ReturnType<typeof vi.fn>;
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
    effect: vi.fn(),
  } as unknown as MockCtx;
}

const mockExec = {
  deferContext: vi.fn(),
  concludeTurn: vi.fn(),
} as unknown as Parameters<Awaited<ReturnType<typeof createGraphTools>>['graphStatus']['execute']>[1];

function getMockFetchData(adapter: 'codegraph' | 'lens'): ReturnType<typeof vi.fn> {
  if (adapter === 'codegraph') {
    const inst = new CodeGraphAdapter();
    return inst.fetchData as ReturnType<typeof vi.fn>;
  }
  const inst = new LensAdapter();
  return inst.fetchData as ReturnType<typeof vi.fn>;
}

// ── Pure function tests ────────────────────────────────────────────────

describe('fetchMergedGraph', () => {
  it('should return empty graph when both sources unavailable', async () => {
    const data = await fetchMergedGraph(async () => null, 'repo-1', 'both');
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(data.metadata.repoId).toBe('repo-1');
  });

  it('should fetch from codegraph only when source is codegraph', async () => {
    const invoke = vi.fn().mockImplementation(async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [{ path: 'a.ts', language: 'typescript' }];
      }
      return null;
    });
    const data = await fetchMergedGraph(invoke, 'repo-cg', 'codegraph');
    expect(data.nodes.length).toBeGreaterThanOrEqual(0);
    expect(data.metadata.repoId).toBe('repo-cg');
  });

  it('should fetch from lens only when source is lens', async () => {
    const invoke = vi.fn().mockImplementation(async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [{ id: 's1', name: 'fn', scope: 'g', file: 'a.ts', line: 1, category: 'function' }],
          references: [],
        };
      }
      return null;
    });
    const data = await fetchMergedGraph(invoke, 'repo-lens', 'lens');
    expect(data.metadata.repoId).toBe('repo-lens');
  });
});

describe('pickBestMatch', () => {
  it('should pick exact name match', () => {
    const raw = [{ name: 'multiply', kind: 'function', filePath: 'math.ts', startLine: 10 }];
    const result = pickBestMatch(raw, 'multiply');
    expect(result?.name).toBe('multiply');
  });

  it('should fall back to first result when no exact match', () => {
    const raw = [
      { name: 'add', kind: 'function', filePath: 'math.ts', startLine: 5 },
      { name: 'subtract', kind: 'function', filePath: 'math.ts', startLine: 15 },
    ];
    const result = pickBestMatch(raw, 'multiply');
    expect(result?.name).toBe('add');
  });

  it('should handle string payload', () => {
    const raw = JSON.stringify([{ name: 'foo', kind: 'function', filePath: 'x.ts', startLine: 1 }]);
    const result = pickBestMatch(raw, 'foo');
    expect(result?.name).toBe('foo');
  });

  it('should return null for empty payload', () => {
    expect(pickBestMatch(null, 'foo')).toBeNull();
    expect(pickBestMatch([], 'foo')).toBeNull();
  });

  it('should return null for invalid JSON string', () => {
    expect(pickBestMatch('not-json', 'foo')).toBeNull();
  });

  it('should match by id when name does not match', () => {
    const raw = [{ id: 'sym-123', name: 'differentName', kind: 'function', filePath: 'a.ts', startLine: 5 }];
    const result = pickBestMatch(raw, 'sym-123');
    expect(result?.symbolId).toBe('sym-123');
    expect(result?.name).toBe('differentName');
  });

  it('should use qualified_name when name is absent', () => {
    const raw = [{ qualified_name: 'ns.foo', kind: 'function', filePath: 'a.ts', startLine: 1 }];
    const result = pickBestMatch(raw, 'foo');
    expect(result?.name).toBe('ns.foo');
  });

  it('should use file_path and start_line as fallbacks', () => {
    const raw = [{ name: 'x', kind: 'function', file_path: 'b.ts', start_line: 42 }];
    const result = pickBestMatch(raw, 'x');
    expect(result?.file).toBe('b.ts');
    expect(result?.line).toBe(42);
  });

  it('should use signature when available', () => {
    const raw = [{ name: 'x', kind: 'function', filePath: 'a.ts', startLine: 1, signature: 'fn(a: int)' }];
    const result = pickBestMatch(raw, 'x');
    expect(result?.signature).toBe('fn(a: int)');
  });

  it('should handle object with results key', () => {
    const raw = { results: [{ name: 'foo', kind: 'function', filePath: 'a.ts', startLine: 1 }] };
    const result = pickBestMatch(raw, 'foo');
    expect(result?.name).toBe('foo');
  });

  it('should handle object with nodes key', () => {
    const raw = { nodes: [{ name: 'bar', kind: 'class', filePath: 'b.ts', startLine: 2 }] };
    const result = pickBestMatch(raw, 'bar');
    expect(result?.name).toBe('bar');
  });
});

describe('normalizeImpact', () => {
  it('should normalize codegraph_impact payload', () => {
    const raw = { affected: ['foo', 'bar'], depth: 3 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['foo', 'bar']);
    expect(result?.depth).toBe(3);
  });

  it('should normalize with affectedNodes alias', () => {
    const raw = { affectedNodes: [{ name: 'x' }, { name: 'y' }], depth: 2 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['x', 'y']);
  });

  it('should normalize with nodes alias', () => {
    const raw = { nodes: ['a', 'b'], depth: 1 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['a', 'b']);
  });

  it('should handle string payload', () => {
    const raw = JSON.stringify({ affected: ['a', 'b'], depth: 1 });
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['a', 'b']);
  });

  it('should return null for invalid payload', () => {
    expect(normalizeImpact(null)).toBeNull();
    expect(normalizeImpact({})).toBeNull();
  });

  it('should return null for invalid JSON string', () => {
    expect(normalizeImpact('not-json')).toBeNull();
  });

  it('should return null for non-object raw', () => {
    expect(normalizeImpact(42)).toBeNull();
    expect(normalizeImpact('')).toBeNull();
  });

  it('should default depth to 2 when not specified', () => {
    const raw = { affected: ['a'] };
    const result = normalizeImpact(raw);
    expect(result?.depth).toBe(2);
  });

  it('should handle affected items with id instead of name', () => {
    const raw = { affected: [{ id: 'node-1' }, { id: 'node-2' }], depth: 1 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['node-1', 'node-2']);
  });

  it('should handle affected items that are objects without name or id', () => {
    const raw = { affected: [{ foo: 'bar' }], depth: 1 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['?']);
  });
});

describe('summarizeGraph (additional)', () => {
  it('should include edge relations in summary', () => {
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [
        makeEdge('e1', 'n1', 'n2', 'call'),
        makeEdge('e2', 'n1', 'n3', 'import'),
      ],
    );
    const summary = summarizeGraph(data);
    expect(summary).toContain('call:1');
    expect(summary).toContain('import:1');
  });

  it('should show top edges up to 10', () => {
    const edges = Array.from({ length: 12 }, (_, i) => makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'call'));
    const data = makeGraphData([], edges);
    const summary = summarizeGraph(data);
    expect(summary).toContain('12 edges');
  });

  it('should include top nodes in summary', () => {
    const data = makeGraphData(
      [makeNode('n1', 'funcA', 'function', 'a.ts', 10)],
      [],
    );
    const summary = summarizeGraph(data);
    expect(summary).toContain('funcA');
    expect(summary).toContain('a.ts:10');
  });

  it('should include top edges in summary', () => {
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'function', 'b.ts', 2)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const summary = summarizeGraph(data);
    expect(summary).toContain('n1');
    expect(summary).toContain('call');
    expect(summary).toContain('n2');
  });
});

describe('makeRepoId', () => {
  it('should create a branded RepoId', () => {
    const id = makeRepoId('my-repo');
    expect(id).toBe('my-repo');
    expect(typeof id).toBe('string');
  });
});

// ── createGraphTools tests ─────────────────────────────────────────────

describe('createGraphTools', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
    getMockFetchData('codegraph').mockClear();
    getMockFetchData('lens').mockClear();
  });

  it('should create 11 tools with correct names', async () => {
    const tools = await createGraphTools(ctx);
    expect(tools.graphStatus.name).toBe('graph_status');
    expect(tools.graphData.name).toBe('graph_data');
    expect(tools.graphSymbol.name).toBe('graph_symbol');
    expect(tools.graphImpact.name).toBe('graph_impact');
    expect(tools.graphPathFind.name).toBe('graph_path_find');
    expect(tools.graphPathEnumerate.name).toBe('graph_path_enumerate');
    expect(tools.graphCycles.name).toBe('graph_cycles');
    expect(tools.graphHealth.name).toBe('graph_health');
    expect(tools.graphRulesCheck.name).toBe('graph_rules_check');
    expect(tools.graphFocus.name).toBe('graph_focus');
    // GF-P0-2：关键词查询工具（graphify P0-2）
    expect(tools.graphQuery.name).toBe('graph_query');
    // 数量也要钉住：只断言「每个名字对」时，漏掉一个工具不会有任何断言变红。
    expect(Object.keys(tools).filter((key) => key !== 'dispose')).toHaveLength(11);
  });

  // ── graph_status ─────────────────────────────────────────────────────

  it('graph_status should return ready status with nodes', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec) as {
      status: string; nodeCount: number; edgeCount: number;
      sources: { codegraph: boolean; lens: boolean };
    };
    expect(result.status).toBe('ready');
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.sources.codegraph).toBe(true);
  });

  it('graph_status should return unavailable status when no nodes', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    getMockFetchData('lens').mockResolvedValue({
      nodes: [],
      edges: [],
      source: 'lens',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec) as {
      status: string; nodeCount: number; edgeCount: number;
      sources: { codegraph: boolean; lens: boolean };
    };
    expect(result.status).toBe('unavailable');
    expect(result.sources.codegraph).toBe(false);
    expect(result.sources.lens).toBe(false);
  });

  it('graph_status render should format status text', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphStatus.output.render!;
    const output = renderFn({}, { status: 'ready', nodeCount: 5, edgeCount: 3, sources: { codegraph: true, lens: false } }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('ready');
    expect(output[0]!.text).toContain('5 nodes');
    expect(output[0]!.text).toContain('codegraph:✓');
    expect(output[0]!.text).toContain('lens:✗');
  });

  it('graph_status render without sources', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphStatus.output.render!;
    const output = renderFn({}, { status: 'unavailable', nodeCount: 0, edgeCount: 0 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('unavailable');
    expect(output[0]!.text).not.toContain('codegraph:');
  });

  // ── graph_data ───────────────────────────────────────────────────────

  it('graph_data should return merged graph and emit update', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
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
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/data', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data should use incremental delta on repeat calls', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
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

  it('graph_data should respect source parameter', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    await tools.graphData.execute({ repoId: 'r1', source: 'codegraph' }, mockExec);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/graph/updated', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data render should format graph summary', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphData.output.render!;
    const data: GraphData = makeGraphData(
      [makeNode('n1', 'funcA', 'function', 'a.ts', 10)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const output = renderFn({}, data as never) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('1 nodes');
    expect(output[0]!.text).toContain('funcA');
  });

  // ── graph_symbol ─────────────────────────────────────────────────────

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

  it('graph_symbol render should format found symbol', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, { name: 'funcA', file: 'a.ts', line: 10, category: 'function', symbolId: 's1' }) as TextOutput;
    expect(output[0]!.text).toContain('funcA');
    expect(output[0]!.text).toContain('a.ts:10');
    expect(output[0]!.text).toContain('function');
  });

  it('graph_symbol render should show not found for null', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, null) as TextOutput;
    expect(output[0]!.text).toBe('Symbol not found.');
  });

  it('graph_symbol render should handle missing fields', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, { symbolId: 'x' }) as TextOutput;
    expect(output[0]!.text).toContain('x');
    expect(output[0]!.text).toContain('?');
  });

  // ── graph_impact ─────────────────────────────────────────────────────

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

  it('graph_impact should return empty result when both sources fail', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: [], depth: 0 });
  });

  it('graph_impact render should format impact summary', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: ['s1', 's2', 's3'], depth: 2 }) as TextOutput;
    expect(output[0]!.text).toContain('3 symbols affected');
    expect(output[0]!.text).toContain('depth 2');
    expect(output[0]!.text).toContain('s1, s2, s3');
  });

  it('graph_impact render should handle empty affected list', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: [], depth: 0 }) as TextOutput;
    expect(output[0]!.text).toContain('0 symbols affected');
  });

  it('graph_impact render should limit to 10 affected symbols', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const affected = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const output = renderFn({}, { affected, depth: 3 }) as TextOutput;
    expect(output[0]!.text).toContain('15 symbols affected');
  });

  // ── invoke error paths ───────────────────────────────────────────────

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

  // ── graph_data cache eviction (LRU) ──────────────────────────────────

  it('graph_data should evict oldest cached repo when limit exceeded', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    for (let i = 0; i < 10; i++) {
      await tools.graphData.execute({ repoId: `repo-${i}` }, mockExec);
    }
    expect(ctx.emit).toHaveBeenCalled();
  });
});

// ── Direct execute/render function tests ───────────────────────────────

describe('createInvoke', () => {
  it('should create an invoke function that calls ctx.tools.execute', async () => {
    const ctx = makeMockCtx();
    ctx.tools.execute.mockResolvedValue({ isError: false, value: 'result' });
    const invoke = createInvoke(ctx);
    const result = await invoke('codegraph_query', { search: 'foo' });
    expect(result).toBe('result');
    expect(ctx.tools.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'codegraph_query' }));
  });

  it('should return null when result.isError', async () => {
    const ctx = makeMockCtx();
    ctx.tools.execute.mockResolvedValue({ isError: true, value: null });
    const invoke = createInvoke(ctx);
    const result = await invoke('codegraph_query', { search: 'foo' });
    expect(result).toBeNull();
  });

  it('should return null on error', async () => {
    const ctx = makeMockCtx();
    ctx.tools.execute.mockRejectedValue(new Error('timeout'));
    const invoke = createInvoke(ctx);
    const result = await invoke('codegraph_query', { search: 'foo' });
    expect(result).toBeNull();
  });

  it('should return null when value is undefined', async () => {
    const ctx = makeMockCtx();
    ctx.tools.execute.mockResolvedValue({ isError: false, value: undefined });
    const invoke = createInvoke(ctx);
    const result = await invoke('codegraph_query', { search: 'foo' });
    expect(result).toBeNull();
  });
});

describe('renderGraphStatus', () => {
  it('should format status with sources', () => {
    const output = renderGraphStatus({}, { status: 'ready', nodeCount: 5, edgeCount: 3, sources: { codegraph: true, lens: false } });
    expect(output[0]).toHaveProperty('text');
    expect((output[0] as { text: string }).text).toContain('ready');
    expect((output[0] as { text: string }).text).toContain('codegraph:✓');
    expect((output[0] as { text: string }).text).toContain('lens:✗');
  });

  it('should format status without sources', () => {
    const output = renderGraphStatus({}, { status: 'unavailable', nodeCount: 0, edgeCount: 0 });
    expect((output[0] as { text: string }).text).toContain('unavailable');
    expect((output[0] as { text: string }).text).not.toContain('codegraph:');
  });
});

describe('renderGraphData', () => {
  it('should format graph summary', () => {
    const data: GraphData = makeGraphData(
      [makeNode('n1', 'funcA', 'function', 'a.ts', 10)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const output = renderGraphData({}, data);
    expect((output[0] as { text: string }).text).toContain('1 nodes');
    expect((output[0] as { text: string }).text).toContain('funcA');
  });
});

describe('renderGraphSymbol', () => {
  it('should format found symbol', () => {
    const output = renderGraphSymbol({}, { name: 'funcA', file: 'a.ts', line: 10, category: 'function', symbolId: 's1' });
    expect((output[0] as { text: string }).text).toContain('funcA');
    expect((output[0] as { text: string }).text).toContain('a.ts:10');
  });

  it('should show not found for null', () => {
    const output = renderGraphSymbol({}, null);
    expect((output[0] as { text: string }).text).toBe('Symbol not found.');
  });

  it('should handle missing fields', () => {
    const output = renderGraphSymbol({}, { symbolId: 'x' });
    expect((output[0] as { text: string }).text).toContain('x');
  });
});

describe('renderGraphImpact', () => {
  it('should format impact summary', () => {
    const output = renderGraphImpact({}, { affected: ['s1', 's2', 's3'], depth: 2 });
    expect((output[0] as { text: string }).text).toContain('3 symbols affected');
    expect((output[0] as { text: string }).text).toContain('depth 2');
  });

  it('should handle empty affected list', () => {
    const output = renderGraphImpact({}, { affected: [], depth: 0 });
    expect((output[0] as { text: string }).text).toContain('0 symbols affected');
  });

  it('should limit to 10 affected symbols in display', () => {
    const affected = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const output = renderGraphImpact({}, { affected, depth: 3 });
    expect((output[0] as { text: string }).text).toContain('15 symbols affected');
  });
});

describe('executeGraphStatus', () => {
  it('should return ready status with nodes', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const deps = await createGraphToolDeps();
    const result = await executeGraphStatus({ repoId: 'test-repo' }, invoke, deps);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('nodeCount');
    expect(result).toHaveProperty('edgeCount');
    expect(result).toHaveProperty('sources');
  });
});

describe('executeGraphData', () => {
  it('should return merged graph and call emit functions', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    const graphCache = new Map<string, GraphData>();
    const deps = await createGraphToolDeps();
    const result = await executeGraphData({ repoId: 'test-repo' }, invoke, emitUpdate, emitData, graphCache, deps);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(emitUpdate).toHaveBeenCalled();
    expect(emitData).toHaveBeenCalled();
  });

  it('should use incremental delta on repeat calls', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    const graphCache = new Map<string, GraphData>();
    const deps = await createGraphToolDeps();
    await executeGraphData({ repoId: 'delta-repo' }, invoke, emitUpdate, emitData, graphCache, deps);
    const result2 = await executeGraphData({ repoId: 'delta-repo' }, invoke, emitUpdate, emitData, graphCache, deps);
    expect(result2).toHaveProperty('nodes');
  });

  // ── XJ-11 消费端收口（cycle-122）：增量引擎健康面贯通到工具返回值 ──
  // 缺口现场：pool.applyDelta 的返回值（applied/addedPaths/degradedRules/I4）
  // 在 executeGraphData 里被整行丢弃——「不可观测的降级等于没有降级」。
  it('XJ-11: 无缓存基线（全量重建）→ metadata.xuanji 缺席（undefined ≠ skipped 的显式区分）', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    const graphCache = new Map<string, GraphData>();
    const deps = await createGraphToolDeps();
    const result = await executeGraphData(
      { repoId: 'full-rebuild' }, invoke, emitUpdate, emitData, graphCache, deps,
      new XuanjiAdapterPool(),
    ) as unknown as GraphData;
    expect('xuanji' in result.metadata).toBe(false);
  });

  it('XJ-11: 增量合并 → metadata.xuanji.applied 布尔 + skipped 不带 addedPaths（假量化防线）', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    const graphCache = new Map<string, GraphData>();
    const deps = await createGraphToolDeps();
    const pool = new XuanjiAdapterPool();
    // 首次：全量建基线（xuanji 缺席）
    await executeGraphData({ repoId: 'signal-repo' }, invoke, emitUpdate, emitData, graphCache, deps, pool);
    // 第二次：走增量分支（pool 里该 repo 无 adapter ⇒ applied=false 的 skipped 信号）
    const result2 = await executeGraphData(
      { repoId: 'signal-repo' }, invoke, emitUpdate, emitData, graphCache, deps, pool,
    ) as unknown as GraphData;
    expect(result2.metadata.xuanji).toBeDefined();
    expect(result2.metadata.xuanji!.applied).toBe(false);
    // skipped 时不得带 addedPaths：引擎没跑，0 是假量化
    expect('addedPaths' in (result2.metadata.xuanji!)).toBe(false);
    // 无降级时不带 degradedRules 键（诚实缺省：空数组冒充「体检过」是本仓反复出现的形态）
    expect('degradedRules' in (result2.metadata.xuanji!)).toBe(false);
  });

  it('XJ-11: applied=true 路径携带 addedPaths 量化值（引擎真实产出）', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    const graphCache = new Map<string, GraphData>();
    const deps = await createGraphToolDeps();
    const pool = new XuanjiAdapterPool();
    // 时序约束：executeGraphData 的「无缓存基线」分支会 invalidate 预装 adapter
    // （正确行为——没有基线就不能把两版图混在一起）。因此先跑一次建立 graphCache
    // 基线，再预装载 adapter（装载与 fetchMergedGraph 同源的空图），第三次调用
    // 才能同时满足「有缓存基线」+「adapter 已装载」⇒ applied=true。
    await executeGraphData({ repoId: 'loaded-repo' }, invoke, emitUpdate, emitData, graphCache, deps, pool);
    const adapter = pool.get('loaded-repo');
    adapter.loadGraph({ nodes: [], edges: [], metadata: { timestamp: 0 } });
    const result = await executeGraphData(
      { repoId: 'loaded-repo' }, invoke, emitUpdate, emitData, graphCache, deps, pool,
    ) as unknown as GraphData;
    expect(result.metadata.xuanji).toBeDefined();
    expect(result.metadata.xuanji!.applied).toBe(true);
    expect(typeof result.metadata.xuanji!.addedPaths).toBe('number');
  });
});

describe('executeGraphSymbol', () => {
  it('should return symbol detail', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_query') {
        return [{ name: 'funcA', kind: 'function', filePath: 'a.ts', startLine: 10 }];
      }
      return null;
    };
    const result = await executeGraphSymbol({ symbolId: 'funcA' }, invoke);
    expect(result).toHaveProperty('name', 'funcA');
  });

  it('should return null when not found', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const result = await executeGraphSymbol({ symbolId: 'missing' }, invoke);
    expect(result).toBeNull();
  });
});

describe('executeGraphImpact', () => {
  it('should return affected symbols from codegraph_impact', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_impact') {
        return { affected: ['s1', 's2'], depth: 2 };
      }
      return null;
    };
    const result = await executeGraphImpact({ symbolId: 's0' }, invoke);
    expect(result).toEqual({ affected: ['s1', 's2'], depth: 2 });
  });

  it('should fall back to lens_impact', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_impact') return null;
      if (tool === 'lens_impact') return { affected: ['l1'], depth: 1 };
      return null;
    };
    const result = await executeGraphImpact({ symbolId: 's0' }, invoke);
    expect(result).toEqual({ affected: ['l1'], depth: 1 });
  });

  it('should return empty result when both fail', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const result = await executeGraphImpact({ symbolId: 's0' }, invoke);
    expect(result).toEqual({ affected: [], depth: 0 });
  });
});

describe('createGraphTools - additional tools', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
    getMockFetchData('codegraph').mockClear();
    getMockFetchData('lens').mockClear();
  });

  it('graph_path_find should find shortest path', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathFind.execute({ repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n3' }, mockExec) as { path: string[]; length: number };
    expect(result.path).toEqual(['n1', 'n2', 'n3']);
    expect(result.length).toBe(2);
  });

  it('graph_path_find should return null when source not in graph', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathFind.execute({ repoId: 'r1', sourceSymbol: 'missing', targetSymbol: 'n1' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_path_find should return null when no path exists', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
      ],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathFind.execute({ repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n2' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_path_find render should show path', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphPathFind.output.render!;
    const output = renderFn({}, { path: ['n1', 'n2'], length: 1 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('n1');
    expect(output[0]!.text).toContain('n2');
  });

  it('graph_path_find render should show no path message', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphPathFind.output.render!;
    const output = renderFn({}, null) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('No path');
  });

  // ── graph_path_enumerate (Xuanji path-rule reader) ───────────────────

  it('graph_path_enumerate should enumerate every simple path between two symbols', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
        { id: 'n4', label: 'D', type: 'function', filePath: 'd.ts', lineNumber: 4, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n1', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n2', target: 'n4', type: 'call', properties: {} },
        { id: 'e4', source: 'n3', target: 'n4', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n4' },
      mockExec,
    ) as { paths: string[][]; truncated: boolean; total: number };
    expect(result.total).toBe(2);
    expect(result.paths.map((p) => p.join('>')).sort()).toEqual(['n1>n2>n4', 'n1>n3>n4']);
  });

  it('graph_path_enumerate should return null when an endpoint is missing', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'ghost' },
      mockExec,
    );
    expect(result).toBeNull();
  });

  it('graph_path_enumerate should clamp hop budget and honour edge-type filter', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'import', properties: {} },
        { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const all = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n3', maxHops: 99 },
      mockExec,
    ) as { total: number };
    expect(all.total).toBe(1);

    const callOnly = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n3', edgeTypes: 'call' },
      mockExec,
    ) as { total: number };
    expect(callOnly.total).toBe(0);

    const oneHop = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n3', maxHops: 1 },
      mockExec,
    ) as { total: number };
    expect(oneHop.total).toBe(0);
  });

  it('graph_path_enumerate should report truncation when limit is hit', async () => {
    const nodes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id, i) => ({
      id, label: id, type: 'function' as const, filePath: `${id}.ts`, lineNumber: i + 1, properties: {},
    }));
    getMockFetchData('codegraph').mockResolvedValue({
      nodes,
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n1', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n2', target: 'n6', type: 'call', properties: {} },
        { id: 'e4', source: 'n3', target: 'n6', type: 'call', properties: {} },
        { id: 'e5', source: 'n1', target: 'n4', type: 'call', properties: {} },
        { id: 'e6', source: 'n4', target: 'n6', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n6', limit: 2 },
      mockExec,
    ) as { total: number; truncated: boolean };
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
  });

  // cycle-119：truncation 参数透传契约（修复前 schema 暴露但 execute 从未传给
  // findPathsBetween——「参数加了、没人传」家族）。菱形图：低权重路径 DFS 序先到，
  // top-k-weight 必须返回高权重路径，两者结果**必须不同**——相同则透传是死的。
  it('graph_path_enumerate truncation=top-k-weight keeps the highest-weight path (passthrough contract)', async () => {
    const nodes = ['n1', 'n2', 'n3', 'n4'].map((id, i) => ({
      id, label: id, type: 'function' as const, filePath: `${id}.ts`, lineNumber: i + 1, properties: {},
    }));
    // 菱形：n1→n2→n4（权重 0.1+0.1=0.2，DFS 先到）vs n1→n3→n4（权重 0.8+0.8=1.6）。
    // 权重必须落在 GraphEdge.weight 的 [0,1] 契约内（GraphValidator autoFix 会把 >1 钳成 1，
    // 越界 fixture 会把「高权重」拍平成同分——那是夹具违约，不是产品缺陷）。
    const getMockData = getMockFetchData('codegraph');
    getMockData.mockResolvedValue({
      nodes,
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', weight: 0.1, properties: {} },
        { id: 'e2', source: 'n2', target: 'n4', type: 'call', weight: 0.1, properties: {} },
        { id: 'e3', source: 'n1', target: 'n3', type: 'call', weight: 0.8, properties: {} },
        { id: 'e4', source: 'n3', target: 'n4', type: 'call', weight: 0.8, properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const dfsResult = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n4', maxHops: 2, limit: 1 },
      mockExec,
    ) as { paths: string[][] };
    const topkResult = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n4', maxHops: 2, limit: 1, truncation: 'top-k-weight' },
      mockExec,
    ) as { paths: string[][] };
    // DFS 序先发现 n2（低权重）；top-k-weight 必须保留 n3（高权重）。
    expect(dfsResult.paths[0]).toEqual(['n1', 'n2', 'n4']);
    expect(topkResult.paths[0]).toEqual(['n1', 'n3', 'n4']);
  });

  it('graph_path_enumerate render should list paths and truncation', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphPathEnumerate.output.render!;
    const output = renderFn({}, { paths: [['n1', 'n2']], truncated: true, total: 1 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('n1 → n2');
    expect(output[0]!.text).toContain('truncated');
  });

  it('graph_path_enumerate render should show no-path message', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphPathEnumerate.output.render!;
    const output = renderFn({}, { paths: [], truncated: false, total: 0 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('No path');
  });

  // ── XJ-03：Ω（labels）与分页必须在**工具返回面**上真的存在 ────────────
  // 只在库内单测里读 labels/nextCursor 是不够的：适配层与工具层都可以把它们丢掉
  // （本项目历史上「返回值里某个字段被中间层丢弃」踩过多次），所以断言落在 execute 的返回值上。

  it('graph_path_enumerate 分页：nextCursor 可翻页、页间不重复、labels 与当前页一一对应', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id, i) => ({
        id, label: id, type: 'function' as const, filePath: `${id}.ts`, lineNumber: i + 1, properties: {},
      })),
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n1', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n2', target: 'n6', type: 'call', properties: {} },
        { id: 'e4', source: 'n3', target: 'n6', type: 'call', properties: {} },
        { id: 'e5', source: 'n1', target: 'n4', type: 'call', properties: {} },
        { id: 'e6', source: 'n4', target: 'n6', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);

    type Page = { paths: string[][]; labels?: unknown[]; nextCursor?: number | null; truncated: boolean };
    const first = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n6', limit: 2, pageSize: 2 },
      mockExec,
    ) as Page;
    expect(first.paths).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    // Ω 输出长度必须等于当前页条目数（不是全部条目数，也不是 0）
    expect(first.labels).toHaveLength(2);
    // 适配层两条内联读法的 output 是恒等映射：labels[i] 就是 paths[i] 的快照
    expect(first.labels![0]).toEqual(first.paths[0]);

    const second = await tools.graphPathEnumerate.execute(
      { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n6', limit: 2, pageSize: 2, cursor: first.nextCursor! },
      mockExec,
    ) as Page;
    expect(second.paths).toHaveLength(1);
    expect(second.labels).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    // 两页不重复
    const seen = new Set([...first.paths, ...second.paths].map((path) => path.join('>')));
    expect(seen.size).toBe(3);
  });

  it('graph_path_enumerate render 会写出 nextCursor（否则调用方无从翻页）', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphPathEnumerate.output.render!;
    const output = renderFn({}, { paths: [['n1', 'n2']], truncated: true, total: 2, nextCursor: 2 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('nextCursor=2');
  });

  it('graph_cycles 同样暴露 nextCursor（环读法的分页面）', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({
        id, label: id, type: 'function' as const, filePath: `${id}.ts`, lineNumber: i + 1, properties: {},
      })),
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'call', properties: {} },
        { id: 'e2', source: 'b', target: 'a', type: 'call', properties: {} },
        { id: 'e3', source: 'c', target: 'd', type: 'call', properties: {} },
        { id: 'e4', source: 'd', target: 'c', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphCycles.execute(
      { repoId: 'r1', limit: 1, pageSize: 1 },
      mockExec,
    ) as { total: number; truncated: boolean; nextCursor?: number | null; labels?: unknown[] };
    expect(result.total).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBe(1);
    expect(result.labels).toHaveLength(1);
  });


  // ── graph_cycles (Xuanji closed-path reader) ─────────────────────────

  const cycleGraph = (edges: Array<[string, string, string]>) => ({
    nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({
      id, label: id, type: 'function' as const, filePath: `${id}.ts`, lineNumber: i + 1, properties: {},
    })),
    edges: edges.map(([source, target, type], i) => ({ id: `e${i}`, source, target, type, properties: {} })),
    source: 'codegraph',
    timestamp: 1,
  });

  it('graph_cycles should report a triangle once (canonical rotation dedup)', async () => {
    getMockFetchData('codegraph').mockResolvedValue(cycleGraph([
      ['a', 'b', 'call'],
      ['b', 'c', 'call'],
      ['c', 'a', 'call'],
    ]));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphCycles.execute({ repoId: 'r1' }, mockExec) as {
      paths: string[][]; truncated: boolean; total: number;
    };
    expect(result.total).toBe(1);
    const cycle = result.paths[0]!;
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle).size).toBe(3);
  });

  it('graph_cycles should detect two independent cycles and a self-loop', async () => {
    getMockFetchData('codegraph').mockResolvedValue(cycleGraph([
      ['a', 'b', 'call'],
      ['b', 'a', 'call'],
      ['c', 'd', 'call'],
      ['d', 'c', 'call'],
      ['a', 'a', 'call'],
    ]));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphCycles.execute({ repoId: 'r1' }, mockExec) as { total: number };
    expect(result.total).toBe(3);
  });

  it('graph_cycles should honour maxLength (cycle too long is not reported)', async () => {
    getMockFetchData('codegraph').mockResolvedValue(cycleGraph([
      ['a', 'b', 'call'],
      ['b', 'c', 'call'],
      ['c', 'd', 'call'],
      ['d', 'a', 'call'],
    ]));
    const tools = await createGraphTools(ctx);
    const short = await tools.graphCycles.execute({ repoId: 'r1', maxLength: 3 }, mockExec) as { total: number };
    expect(short.total).toBe(0);
    const long = await tools.graphCycles.execute({ repoId: 'r1', maxLength: 4 }, mockExec) as { total: number };
    expect(long.total).toBe(1);
  });

  it('graph_cycles should clamp limit and report truncation', async () => {
    getMockFetchData('codegraph').mockResolvedValue(cycleGraph([
      ['a', 'b', 'call'],
      ['b', 'a', 'call'],
      ['c', 'd', 'call'],
      ['d', 'c', 'call'],
    ]));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphCycles.execute({ repoId: 'r1', limit: 1 }, mockExec) as {
      total: number; truncated: boolean;
    };
    expect(result.total).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('graph_cycles should honour edge-type filter', async () => {
    getMockFetchData('codegraph').mockResolvedValue(cycleGraph([
      ['a', 'b', 'import'],
      ['b', 'a', 'import'],
    ]));
    const tools = await createGraphTools(ctx);
    const callOnly = await tools.graphCycles.execute({ repoId: 'r1', edgeTypes: 'call' }, mockExec) as { total: number };
    expect(callOnly.total).toBe(0);
    const importOnly = await tools.graphCycles.execute({ repoId: 'r1', edgeTypes: 'import' }, mockExec) as { total: number };
    expect(importOnly.total).toBe(1);
  });

  it('graph_cycles should return null for an empty graph', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [], edges: [], source: 'codegraph', timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphCycles.execute({ repoId: 'r1' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_cycles render should list cycles and the no-cycle message', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphCycles.output.render!;
    const withCycles = renderFn({}, { paths: [['a', 'b', 'a']], truncated: false, total: 1 }) as Array<{ type: string; text: string }>;
    expect(withCycles[0]!.text).toContain('a → b → a');
    const none = renderFn({}, { paths: [], truncated: false, total: 0 }) as Array<{ type: string; text: string }>;
    expect(none[0]!.text).toContain('No dependency cycles');
  });

  it('graph_health should return health score', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'src/mod1/a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'src/mod1/b.ts', lineNumber: 2, properties: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphHealth.execute({ repoId: 'r1' }, mockExec) as { overall: number };
    expect(result).toHaveProperty('overall');
    expect(result).toHaveProperty('coupling');
  });

  it('graph_health should return null for empty graph', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphHealth.execute({ repoId: 'r1' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_health render should format score', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphHealth.output.render!;
    const output = renderFn({}, { overall: 80, coupling: 90, cohesion: 85, cyclicDependencyRate: 70, modularity: 75 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('80');
    expect(output[0]!.text).toContain('Coupling');
  });

  it('graph_health render should show insufficient data', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphHealth.output.render!;
    const output = renderFn({}, null) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('Insufficient');
  });

  it('graph_rules_check should return violations', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphRulesCheck.execute({ repoId: 'r1', maxIndegree: 5, maxOutdegree: 5 }, mockExec);
    expect(Array.isArray(result)).toBe(true);
  });

  it('graph_rules_check should return null for empty graph', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphRulesCheck.execute({ repoId: 'r1' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_rules_check render should show no violations', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphRulesCheck.output.render!;
    const output = renderFn({}, []) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('No rule violations');
  });

  it('graph_rules_check render should show violations', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphRulesCheck.output.render!;
    const output = renderFn({}, [
      { severity: 'warning', message: 'indegree too high', nodeId: 'n1', ruleId: 'max-indegree' },
      { severity: 'warning', message: 'outdegree too high', nodeId: 'n2', ruleId: 'max-outdegree' },
    ]) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('2 rule violations');
  });

  it('graph_focus should return neighbors', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n3', target: 'n1', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphFocus.execute({ repoId: 'r1', symbolId: 'n1' }, mockExec) as { neighbors: string[]; symbolId: string };
    expect(result.symbolId).toBe('n1');
    expect(result.neighbors).toContain('n2');
    expect(result.neighbors).toContain('n3');
  });

  it('graph_focus should return null for unknown symbol', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = await createGraphTools(ctx);
    const result = await tools.graphFocus.execute({ repoId: 'r1', symbolId: 'missing' }, mockExec);
    expect(result).toBeNull();
  });

  it('graph_focus render should show neighbors', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphFocus.output.render!;
    const output = renderFn({}, { symbolId: 'n1', neighbors: ['n2', 'n3'] }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('n1');
    expect(output[0]!.text).toContain('2');
  });

  it('graph_focus render should show not found', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphFocus.output.render!;
    const output = renderFn({}, null) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('not found');
  });

  // ── graph_query (GF-P0-2 关键词查询：种子 → 子图 → 预算内文本) ────────

  function queryGraph(nodes: Array<{ id: string; label: string; filePath?: string }>, edges: Array<[string, string, string]> = []) {
    return {
      nodes: nodes.map((node, i) => ({
        id: node.id,
        label: node.label,
        ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
        type: 'function' as const,
        lineNumber: i + 1,
        properties: {},
      })),
      edges: edges.map(([source, target, type], i) => ({ id: `e${i}`, source, target, type, properties: {} })),
      source: 'codegraph',
      timestamp: 1,
    };
  }

  type QueryResult = {
    query: string;
    terms: string[];
    seeds: Array<{ id: string; label: string; score: number; matchedTerms: string[] }>;
    text: string;
    tokens: number;
    truncated: boolean;
    reason: string;
    nodeCount: number;
    edgeCount: number;
  };

  it('graph_query 按关键词选种子并渲染子图（精确 > 前缀 > 子串 > 路径）', async () => {
    getMockFetchData('codegraph').mockResolvedValue(queryGraph(
      [
        { id: 'n1', label: 'graphStore', filePath: 'src/client/store/graphStore.ts' },
        { id: 'n2', label: 'GraphStoreBuilder', filePath: 'src/store/builder.ts' },
        { id: 'n3', label: 'unrelatedThing', filePath: 'src/other.ts' },
      ],
      [
        ['n1', 'n2', 'call'],
        ['n2', 'n3', 'call'],
      ],
    ));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphQuery.execute(
      { repoId: 'r1', query: 'graphstore', maxSeeds: 3 },
      mockExec,
    ) as QueryResult;

    expect(result.terms).toEqual(['graphstore']);
    expect(result.seeds[0]!.id).toBe('n1');
    expect(result.seeds[0]!.score).toBe(1000);
    // 子图渲染：种子节点必须出现（NODE 行），邻边出现（EDGE 行）
    expect(result.text).toContain('NODE n1');
    expect(result.text).toContain('EDGE n1 -> n2');
    expect(result.reason).toBe('fits');
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('graph_query 支持中文关键词（整段 + 单字都要能命中）', async () => {
    getMockFetchData('codegraph').mockResolvedValue(queryGraph(
      [
        { id: 'c1', label: '依赖环检测', filePath: 'src/analysis/cycles.ts' },
        { id: 'c2', label: 'graphStore', filePath: 'src/store.ts' },
      ],
    ));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphQuery.execute(
      { repoId: 'r1', query: '依赖环' },
      mockExec,
    ) as QueryResult;

    // tokenizeQuery 会给出整段词 + 三个单字词
    expect(result.terms).toEqual(['依赖环', '依', '赖', '环']);
    expect(result.seeds.map((seed) => seed.id)).toContain('c1');
    expect(result.text).toContain('NODE c1');
  });

  it('graph_query 无命中时返回明确的空结果（不编造种子、不渲染空壳）', async () => {
    getMockFetchData('codegraph').mockResolvedValue(queryGraph([{ id: 'n1', label: 'alpha' }]));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphQuery.execute(
      { repoId: 'r1', query: 'zzzzzz' },
      mockExec,
    ) as QueryResult;

    expect(result.seeds).toEqual([]);
    expect(result.nodeCount).toBe(0);
    expect(result.text).toContain('No seed matched');
    expect(result.truncated).toBe(false);
  });

  it('graph_query 的 token 预算真的会截断（预算不足时不得谎报完整）', async () => {
    const leaves = Array.from({ length: 40 }, (_, i) => ({ id: `leaf${i}`, label: `leafFunction${i}` }));
    const edges: Array<[string, string, string]> = leaves.map((leaf) => ['hub', leaf.id, 'call']);
    getMockFetchData('codegraph').mockResolvedValue(queryGraph(
      [{ id: 'hub', label: 'hub' }, ...leaves],
      edges,
    ));
    const tools = await createGraphTools(ctx);
    const result = await tools.graphQuery.execute(
      { repoId: 'r1', query: 'hub', tokenBudget: 50, maxSeeds: 3, depth: 1 },
      mockExec,
    ) as QueryResult;

    // hub 精确命中 ⇒ 唯一保底种子；depth=1 把 40 个叶子都拉进子图 ⇒ 50 token 装不下。
    expect(result.seeds.map((seed) => seed.id)).toEqual(['hub']);
    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(50);
    expect(result.text).toContain('[!]');
  });

  it('graph_query render 会显示种子与预算信息，null 时给出未命中提示', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphQuery.output.render!;
    const output = renderFn(
      {},
      { text: 'NODE n1 graphStore', seeds: [{ id: 'n1', label: 'graphStore', score: 1000 }], tokens: 12, truncated: false },
    ) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('graphStore(1000)');
    expect(output[0]!.text).toContain('12 tokens');

    const empty = renderFn({}, null) as Array<{ type: string; text: string }>;
    expect(empty[0]!.text).toContain('No seed matched');
  });
});

describe('render functions', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
  });

  it('renderGraphSymbol should format symbol detail', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, { name: 'myFunc', category: 'function', file: 'a.ts', line: 10 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('myFunc');
    expect(output[0]!.text).toContain('a.ts:10');
  });

  it('renderGraphSymbol should show not found for null', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, null) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('not found');
  });

  it('renderGraphImpact should format impact', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: ['s1', 's2'], depth: 2 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('2 symbols');
    expect(output[0]!.text).toContain('s1');
  });

  it('renderGraphImpact should handle empty affected', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: [], depth: 0 }) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('0 symbols');
  });

  it('renderGraphData should format graph summary', async () => {
    const tools = await createGraphTools(ctx);
    const renderFn = tools.graphData.output.render!;
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const output = renderFn({}, data as never) as Array<{ type: string; text: string }>;
    expect(output[0]!.text).toContain('Graph');
  });
});

// ── Tool presentation callbacks (presentCall / presentResult) ──────────
// defineTool wraps BOTH callbacks in an argument-validation gate
// (node_modules/@deepseek-ai/dsh-tools/lib/index.js:838-887): when the args
// violate the parameter schema the wrapper returns undefined WITHOUT ever
// calling the user callback. Every case below therefore passes schema-valid
// args, and one case pins the gate itself.

type GraphTools = Awaited<ReturnType<typeof createGraphTools>>;
type PresentableKey = Exclude<keyof GraphTools, 'dispose'>;

type CallView = { card?: string; title?: string; kind?: string; rawInput?: unknown };
type ResultView = { card?: string; title?: string };

/** Narrow one tool to its two presenter callbacks without fighting the union. */
function presenters(tools: GraphTools, key: PresentableKey): {
  presentCall?: (args: unknown) => CallView | undefined;
  presentResult?: (args: unknown, result: { content: unknown[]; isError: boolean }) => ResultView | undefined;
} {
  return tools[key] as unknown as {
    presentCall?: (args: unknown) => CallView | undefined;
    presentResult?: (args: unknown, result: { content: unknown[]; isError: boolean }) => ResultView | undefined;
  };
}

const VALID_ARGS: Record<PresentableKey, Record<string, unknown>> = {
  graphStatus: { repoId: 'repo-1' },
  graphData: { repoId: 'repo-1', source: 'codegraph' },
  graphSymbol: { symbolId: 'sym-1' },
  graphImpact: { symbolId: 'sym-1' },
  graphPathFind: { repoId: 'repo-1', sourceSymbol: 'sym-a', targetSymbol: 'sym-b' },
  graphPathEnumerate: { repoId: 'repo-1', sourceSymbol: 'sym-a', targetSymbol: 'sym-b' },
  graphCycles: { repoId: 'repo-1' },
  graphHealth: { repoId: 'repo-1' },
  graphRulesCheck: { repoId: 'repo-1', maxIndegree: 7, maxOutdegree: 9 },
  graphFocus: { repoId: 'repo-1', symbolId: 'sym-1' },
  graphQuery: { repoId: 'repo-1', query: 'graphStore' },
};

const CALL_VIEWS: Array<{ key: PresentableKey; title: string; kind: string; rawInput: unknown }> = [
  { key: 'graphStatus', title: 'Check graph status', kind: 'other', rawInput: { repoId: 'repo-1' } },
  { key: 'graphData', title: 'Fetch code graph', kind: 'fetch', rawInput: { repoId: 'repo-1', source: 'codegraph' } },
  { key: 'graphSymbol', title: 'Resolve symbol', kind: 'search', rawInput: { symbolId: 'sym-1' } },
  { key: 'graphImpact', title: 'Analyze impact', kind: 'search', rawInput: { symbolId: 'sym-1' } },
  { key: 'graphPathFind', title: 'Find call path', kind: 'search', rawInput: { from: 'sym-a', to: 'sym-b' } },
  { key: 'graphPathEnumerate', title: 'Enumerate paths', kind: 'search', rawInput: { from: 'sym-a', to: 'sym-b' } },
  { key: 'graphCycles', title: 'Enumerate dependency cycles', kind: 'search', rawInput: { repoId: 'repo-1' } },
  { key: 'graphHealth', title: 'Calculate health score', kind: 'other', rawInput: { repoId: 'repo-1' } },
  { key: 'graphRulesCheck', title: 'Check architecture rules', kind: 'other', rawInput: { repoId: 'repo-1', maxIndegree: 7, maxOutdegree: 9 } },
  { key: 'graphFocus', title: 'Focus on symbol', kind: 'search', rawInput: { symbolId: 'sym-1' } },
  { key: 'graphQuery', title: 'Query graph', kind: 'search', rawInput: { repoId: 'repo-1', query: 'graphStore' } },
];

const RESULT_TITLES: Array<{ key: PresentableKey; ok: string; fail: string }> = [
  { key: 'graphStatus', ok: 'Graph status', fail: 'Graph status failed' },
  { key: 'graphData', ok: 'Code graph fetched', fail: 'Graph fetch failed' },
  { key: 'graphSymbol', ok: 'Symbol resolved', fail: 'Symbol resolution failed' },
  { key: 'graphImpact', ok: 'Impact analyzed', fail: 'Impact analysis failed' },
  { key: 'graphPathFind', ok: 'Call path', fail: 'Path search failed' },
  { key: 'graphPathEnumerate', ok: 'Paths enumerated', fail: 'Path enumeration failed' },
  { key: 'graphCycles', ok: 'Dependency cycles', fail: 'Cycle enumeration failed' },
  { key: 'graphHealth', ok: 'Health score', fail: 'Health scoring failed' },
  { key: 'graphRulesCheck', ok: 'Rules checked', fail: 'Rules check failed' },
  { key: 'graphFocus', ok: 'Symbol neighborhood', fail: 'Focus failed' },
  { key: 'graphQuery', ok: 'Graph query result', fail: 'Graph query failed' },
];

describe('createGraphTools presentation callbacks', () => {
  let ctx: MockCtx;

  beforeEach(() => {
    ctx = makeMockCtx();
  });

  it.each(CALL_VIEWS)('$key presentCall renders the "$title" call view', async ({ key, title, kind, rawInput }) => {
    const tools = await createGraphTools(ctx);
    const view = presenters(tools, key).presentCall!(VALID_ARGS[key]);
    expect(view).toEqual({ card: 'generic', title, kind, rawInput });
  });

  it.each(RESULT_TITLES)('$key presentResult renders success and failure titles', async ({ key, ok, fail }) => {
    const tools = await createGraphTools(ctx);
    const presentResult = presenters(tools, key).presentResult!;

    expect(presentResult(VALID_ARGS[key], { content: [], isError: false })).toEqual({ card: 'generic', title: ok });
    expect(presentResult(VALID_ARGS[key], { content: [], isError: true })).toEqual({ card: 'generic', title: fail });
  });

  it('graph_data presentCall defaults source to "both" when omitted', async () => {
    const tools = await createGraphTools(ctx);
    const view = presenters(tools, 'graphData').presentCall!({ repoId: 'repo-1' });
    expect(view).toEqual({ card: 'generic', title: 'Fetch code graph', kind: 'fetch', rawInput: { repoId: 'repo-1', source: 'both' } });
  });

  it('graph_rules_check presentCall defaults maxIndegree/maxOutdegree when omitted', async () => {
    const tools = await createGraphTools(ctx);
    const view = presenters(tools, 'graphRulesCheck').presentCall!({ repoId: 'repo-1' });
    expect(view).toEqual({
      card: 'generic',
      title: 'Check architecture rules',
      kind: 'other',
      rawInput: { repoId: 'repo-1', maxIndegree: 10, maxOutdegree: 15 },
    });
  });

  // Pins the defineTool validation gate: an invalid arg must short-circuit to
  // undefined instead of reaching the user callback.
  it('presentCall returns undefined for schema-invalid args', async () => {
    const tools = await createGraphTools(ctx);
    expect(presenters(tools, 'graphStatus').presentCall!({})).toBeUndefined();
    expect(presenters(tools, 'graphSymbol').presentCall!({ symbolId: 42 })).toBeUndefined();
    expect(presenters(tools, 'graphData').presentCall!({ repoId: 'repo-1', source: 'not-a-source' })).toBeUndefined();
  });

  it('presentResult returns undefined for schema-invalid args', async () => {
    const tools = await createGraphTools(ctx);
    expect(presenters(tools, 'graphHealth').presentResult!({}, { content: [], isError: false })).toBeUndefined();
  });
});

describe('createGraphTools dispose', () => {
  it('dispose should clear graphCache without throwing', async () => {
    const ctx = makeMockCtx();
    const tools = await createGraphTools(ctx);
    expect(typeof tools.dispose).toBe('function');
    expect(() => tools.dispose()).not.toThrow();
  });
});

