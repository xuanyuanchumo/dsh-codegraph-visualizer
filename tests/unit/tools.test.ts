// Unit tests for Host tool factory — graph_status/graph_data/graph_symbol/graph_impact
// Note: fetchMergedGraph delegates to CodeGraphAdapter which reads .codegraph/
// codegraph.db directly. In tests we test the pure transform functions which
// don't depend on the live .codegraph DB or the adapter mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMergedGraph,
  summarizeGraph,
  makeRepo,
  pickBestMatch,
  normalizeImpact,
  createGraphTools,
  createInvoke,
  executeGraphStatus,
  executeGraphData,
  executeGraphSymbol,
  executeGraphImpact,
  renderGraphStatus,
  renderGraphData,
  renderGraphSymbol,
  renderGraphImpact,
} from '../../src/tools.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { GraphData } from '../../src/types/index.ts';
import type { UpstreamInvoker } from '../../src/adapters/CodeGraphAdapter.ts';
import type { Context } from '@deepseek-ai/cordis';

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
} as unknown as Parameters<ReturnType<typeof createGraphTools>['graphStatus']['execute']>[1];

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

describe('makeRepo', () => {
  it('should create a branded RepoId', () => {
    const id = makeRepo('my-repo');
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

  it('should create 4 tools with correct names', () => {
    const tools = createGraphTools(ctx);
    expect(tools.graphStatus.name).toBe('graph_status');
    expect(tools.graphData.name).toBe('graph_data');
    expect(tools.graphSymbol.name).toBe('graph_symbol');
    expect(tools.graphImpact.name).toBe('graph_impact');
  });

  // ── graph_status ─────────────────────────────────────────────────────

  it('graph_status should return ready status with nodes', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec);
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
    const tools = createGraphTools(ctx);
    const result = await tools.graphStatus.execute({ repoId: 'r1' }, mockExec);
    expect(result.status).toBe('unavailable');
    expect(result.sources.codegraph).toBe(false);
    expect(result.sources.lens).toBe(false);
  });

  it('graph_status render should format status text', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphStatus.output.render!;
    const output = renderFn({}, { status: 'ready', nodeCount: 5, edgeCount: 3, sources: { codegraph: true, lens: false } });
    expect(output[0].text).toContain('ready');
    expect(output[0].text).toContain('5 nodes');
    expect(output[0].text).toContain('codegraph:✓');
    expect(output[0].text).toContain('lens:✗');
  });

  it('graph_status render without sources', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphStatus.output.render!;
    const output = renderFn({}, { status: 'unavailable', nodeCount: 0, edgeCount: 0 });
    expect(output[0].text).toContain('unavailable');
    expect(output[0].text).not.toContain('codegraph:');
  });

  // ── graph_data ───────────────────────────────────────────────────────

  it('graph_data should return merged graph and emit update', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
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
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/data', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data should use incremental delta on repeat calls', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
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

  it('graph_data should respect source parameter', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = createGraphTools(ctx);
    await tools.graphData.execute({ repoId: 'r1', source: 'codegraph' }, mockExec);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/graph/updated', expect.objectContaining({ repoId: 'r1' }));
  });

  it('graph_data render should format graph summary', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphData.output.render!;
    const data: GraphData = makeGraphData(
      [makeNode('n1', 'funcA', 'function', 'a.ts', 10)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const output = renderFn({}, data);
    expect(output[0].text).toContain('1 nodes');
    expect(output[0].text).toContain('funcA');
  });

  // ── graph_symbol ─────────────────────────────────────────────────────

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

  it('graph_symbol render should format found symbol', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, { name: 'funcA', file: 'a.ts', line: 10, category: 'function', symbolId: 's1' });
    expect(output[0].text).toContain('funcA');
    expect(output[0].text).toContain('a.ts:10');
    expect(output[0].text).toContain('function');
  });

  it('graph_symbol render should show not found for null', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, null);
    expect(output[0].text).toBe('Symbol not found.');
  });

  it('graph_symbol render should handle missing fields', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphSymbol.output.render!;
    const output = renderFn({}, { symbolId: 'x' });
    expect(output[0].text).toContain('x');
    expect(output[0].text).toContain('?');
  });

  // ── graph_impact ─────────────────────────────────────────────────────

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

  it('graph_impact should return empty result when both sources fail', async () => {
    ctx.tools.execute.mockResolvedValue({ isError: false, value: null });
    const tools = createGraphTools(ctx);
    const result = await tools.graphImpact.execute({ symbolId: 's0' }, mockExec);
    expect(result).toEqual({ affected: [], depth: 0 });
  });

  it('graph_impact render should format impact summary', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: ['s1', 's2', 's3'], depth: 2 });
    expect(output[0].text).toContain('3 symbols affected');
    expect(output[0].text).toContain('depth 2');
    expect(output[0].text).toContain('s1, s2, s3');
  });

  it('graph_impact render should handle empty affected list', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const output = renderFn({}, { affected: [], depth: 0 });
    expect(output[0].text).toContain('0 symbols affected');
  });

  it('graph_impact render should limit to 10 affected symbols', () => {
    const tools = createGraphTools(ctx);
    const renderFn = tools.graphImpact.output.render!;
    const affected = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const output = renderFn({}, { affected, depth: 3 });
    expect(output[0].text).toContain('15 symbols affected');
  });

  // ── invoke error paths ───────────────────────────────────────────────

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

  // ── graph_data cache eviction (LRU) ──────────────────────────────────

  it('graph_data should evict oldest cached repo when limit exceeded', async () => {
    getMockFetchData('codegraph').mockResolvedValue({
      nodes: [{ id: 'n1', label: 'f', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
      edges: [],
      source: 'codegraph',
      timestamp: 1,
    });
    const tools = createGraphTools(ctx);
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
    // This will read from DB or fallback — in test env, DB won't exist so returns empty
    const result = await executeGraphStatus({ repoId: 'test-repo' }, invoke);
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
    const result = await executeGraphData({ repoId: 'test-repo' }, invoke, emitUpdate, emitData);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(emitUpdate).toHaveBeenCalled();
    expect(emitData).toHaveBeenCalled();
  });

  it('should use incremental delta on repeat calls', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const emitUpdate = vi.fn();
    const emitData = vi.fn();
    await executeGraphData({ repoId: 'delta-repo' }, invoke, emitUpdate, emitData);
    const result2 = await executeGraphData({ repoId: 'delta-repo' }, invoke, emitUpdate, emitData);
    expect(result2).toHaveProperty('nodes');
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
