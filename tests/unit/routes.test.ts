import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: vi.fn(),
  createInvoke: vi.fn(() => vi.fn()),
}));

vi.mock('../../src/host/security.ts', () => ({
  isPathAllowed: vi.fn(() => true),
}));

vi.mock('../../src/host/prerequisites.ts', () => ({
  findWorkspacePath: vi.fn(() => '/test/workspace'),
  extractWorkspacePaths: vi.fn(() => ['/test/workspace']),
  checkPrerequisites: vi.fn(() => ({ codegraph: true, lens: true })),
}));

vi.mock('../../src/adapters/DependencyAdapter.ts', () => ({
  parsePackageJson: vi.fn(() => ({ nodes: [], edges: [] })),
  parseCargoToml: vi.fn(() => ({ nodes: [], edges: [] })),
  parseGoMod: vi.fn(() => ({ nodes: [], edges: [] })),
  dependencyGraphToGraphData: vi.fn(() => ({ nodes: [], edges: [] })),
}));

vi.mock('../../src/adapters/TreeSitterAdapter.ts', () => ({
  TreeSitterAdapter: vi.fn().mockImplementation(() => ({
    parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  })),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('not found')),
  },
}));

const { registerRoutes, registerService, slimGraphData } = await import('../../src/host/routes.ts');
const { fetchMergedGraph, createInvoke } = await import('../../src/tools.ts');
const { isPathAllowed } = await import('../../src/host/security.ts');
const { findWorkspacePath, checkPrerequisites } = await import('../../src/host/prerequisites.ts');
const { TreeSitterAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');


import type { GraphData } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { VisualizerConfig } from '../../src/host/config.ts';

type MockCtx = {
  effect: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  provide: ReturnType<typeof vi.fn>;
  webServer: { register: ReturnType<typeof vi.fn> };
  tools: { get: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
};

function makeMockCtx(): MockCtx {
  return {
    effect: vi.fn((cb: () => unknown) => cb()),
    emit: vi.fn(),
    on: vi.fn(),
    provide: vi.fn(),
    webServer: { register: vi.fn() },
    tools: { get: vi.fn(), execute: vi.fn() },
  };
}

function makeConfig(overrides: Partial<VisualizerConfig> = {}): VisualizerConfig {
  return {
    dataSource: 'auto',
    requestTimeout: 5000,
    scanCacheTtl: 30000,
    scanCacheLimit: 4,
    maxBodyBytes: 1024 * 1024,
    prerequisiteRetryDelay: 3000,
    watchDebounce: 500,
    maxNodes: 10000,
    allowedOrigins: [],
    panelMinHeight: 240,
    panelDefaultHeight: 600,
    ...overrides,
  };
}

function makeReq(method: string, body?: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = {
    method,
    headers,
    on: vi.fn((event: string, cb: (chunk?: unknown) => void) => {
      if (event === 'data' && body) cb(Buffer.from(body));
      if (event === 'end') cb();
    }),
    destroy: vi.fn(),
  };
  return req as unknown as IncomingMessage;
}

type ResState = { code: number; headers: Record<string, string>; body: string; ended: boolean };

function makeRes(): { res: ServerResponse; state: ResState } {
  const state: ResState = { code: 0, headers: {}, body: '', ended: false };
  const res = {
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      state.code = code;
      if (headers) Object.assign(state.headers, headers);
    }),
    end: vi.fn((data?: string) => {
      if (data) state.body = data;
      state.ended = true;
    }),
  };
  return { res: res as unknown as ServerResponse, state };
}

function getHandler(ctx: MockCtx, index: number): (req: IncomingMessage, res: ServerResponse) => Promise<void> | void {
  const calls = ctx.webServer.register.mock.calls;
  return calls[index]![0].handler;
}

function makeDeps(ctx: MockCtx, config: VisualizerConfig) {
  const lastGraphData: { value: GraphData | null } = { value: null };
  const lastInitResult: { value: { success: boolean; path: string; message: string; timestamp: number } | null } = { value: null };
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();
  const scanInFlight = new Map<string, Promise<GraphData> | null>();
  return {
    ctx: ctx as never,
    config,
    getLastGraphData: () => lastGraphData.value,
    setLastGraphData: (data: GraphData | null) => { lastGraphData.value = data; },
    getLastInitResult: () => lastInitResult.value,
    setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => { lastInitResult.value = data; },
    getScanCache: () => scanCache,
    getScanInFlight: (p: string) => scanInFlight.get(p) ?? null,
    setScanInFlight: (p: string, promise: Promise<GraphData> | null) => { scanInFlight.set(p, promise); },
  };
}

describe('registerRoutes', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('registers all 9 routes', () => {
    registerRoutes(deps);
    expect(ctx.webServer.register).toHaveBeenCalledTimes(9);
  });

  it('GET /status returns prerequisites status', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body)).toEqual({ codegraph: true, lens: true });
  });

  it('GET /status handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('GET /workspace returns current path and list', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.path).toBe('/test/workspace');
    expect(parsed.list).toEqual(['/test/workspace']);
  });

  it('GET /data returns empty graph when no lastGraphData', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('GET /data returns cached graph with etag', () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    expect(state.headers['etag']).toBe(String(graphData.metadata.timestamp));
    expect(JSON.parse(state.body).nodes).toHaveLength(1);
  });

  it('GET /data returns 304 when etag matches', () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { 'if-none-match': String(graphData.metadata.timestamp) }), res);
    expect(state.code).toBe(304);
    expect(state.headers['etag']).toBe(String(graphData.metadata.timestamp));
  });

  it('POST /scan fetches and returns graph data', async () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.nodes).toHaveLength(1);
  });

  it('POST /scan returns 403 for disallowed path', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/etc/passwd' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('Path not allowed');
  });

  it('POST /scan returns 500 on fetch error', async () => {
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('fetch failed'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Internal server error');
  });

  it('POST /scan returns cached data when within TTL', async () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res: res1, state: state1 } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res1);
    expect(state1.code).toBe(200);
    const { res: res2, state: state2 } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res2);
    expect(state2.code).toBe(200);
    expect(JSON.parse(state2.body).nodes).toHaveLength(1);
    expect(fetchMergedGraph).toHaveBeenCalledTimes(1);
  });

  it('POST /init initializes graph and returns success', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []));
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
  });

  it('POST /init returns 403 for disallowed path', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/etc' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('Path not allowed');
  });

  it('POST /init returns 500 on error', async () => {
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('init failed'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Internal server error');
  });

  it('POST /watch toggles watch mode', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: true, path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.enabled).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph/watch/toggle', expect.objectContaining({ enabled: true }));
  });

  it('POST /watch returns 403 for disallowed path', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: true, path: '/etc' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('Path not allowed');
  });

  it('POST /watch returns 500 on error', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    const req = {
      method: 'POST',
      headers: {},
      on: vi.fn((event: string, cb: (chunk?: unknown) => void) => {
        if (event === 'error') cb(new Error('req error'));
      }),
      destroy: vi.fn(),
    };
    await handler(req as unknown as IncomingMessage, res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Internal server error');
  });

  it('GET /dependencies returns empty when no workspace', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('GET /dependencies returns 403 when workspace path not allowed', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('Workspace path not allowed');
  });

  it('GET /dependencies returns dependency graph', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
  });

  it('POST /diff returns 400 when from/to missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'abc' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('required');
  });

  it('POST /diff returns 400 for invalid git ref', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'bad;ref', to: 'main' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('Invalid git ref');
  });

  it('POST /diff returns diff graph', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []));
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
  });

  it('POST /diff returns empty when no workspace', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('POST /diff returns 403 when workspace not allowed', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('Workspace path not allowed');
  });

  it('POST /tree-sitter parses content', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body)).toHaveProperty('nodes');
  });

  it('POST /tree-sitter returns 400 when filePath missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('required');
  });

  it('POST /tree-sitter returns 413 when content too large', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    const largeContent = 'x'.repeat(512 * 1024 + 1);
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: largeContent })), res);
    expect(state.code).toBe(413);
    expect(JSON.parse(state.body).error).toContain('too large');
  });

  it('POST /tree-sitter returns 500 on parse error', async () => {
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockRejectedValue(new Error('parse error')),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Internal server error');
  });
});

describe('registerRoutes - CORS', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig({ allowedOrigins: ['http://localhost:3080'] });
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('sets CORS header for matching origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { origin: 'http://localhost:3080' }), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBe('http://localhost:3080');
  });

  it('sets CORS header for single origin even without request origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBe('http://localhost:3080');
  });

  it('handles CORS preflight with matching origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS', undefined, { origin: 'http://localhost:3080' }), res);
    expect(state.code).toBe(204);
    expect(state.headers['access-control-allow-origin']).toBe('http://localhost:3080');
  });
});

describe('registerService', () => {
  it('registers graphVisualizer service', () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    registerService(deps);
    expect(ctx.provide).toHaveBeenCalledWith('graphVisualizer', expect.any(Object));
  });

  it('service.getCurrentGraph returns last graph data', () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    expect(service.getCurrentGraph()).toBe(graphData);
  });

  it('service.getGraphData fetches and returns slimmed data', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []));
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getGraphData('repo-1');
    expect(result).not.toBeNull();
    expect(result.nodes).toHaveLength(1);
  });

  it('service.getGraphData returns null on error', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('fetch failed'));
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getGraphData('repo-1');
    expect(result).toBeNull();
  });

  it('service.getSymbolDetail returns result from upstream', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue({ name: 'fn1', kind: 'function' });
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getSymbolDetail('fn1');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('name', 'fn1');
  });

  it('service.getSymbolDetail returns null when upstream returns null', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue(null);
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getSymbolDetail('nonexistent');
    expect(result).toBeNull();
  });

  it('service.getImpactAnalysis returns result with affected array', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue({ affected: ['fn1', 'fn2'], depth: 2 });
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getImpactAnalysis('fn1');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('affected', ['fn1', 'fn2']);
  });

  it('service.getImpactAnalysis returns null when result has no affected', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue({ foo: 'bar' });
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getImpactAnalysis('fn1');
    expect(result).toBeNull();
  });

  it('service.onGraphUpdate registers callback for graph data events', () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const callback = vi.fn();
    service.onGraphUpdate(callback);
    expect(ctx.on).toHaveBeenCalledWith('codegraph/graph/data', expect.any(Function));
  });
});

describe('slimGraphData (additional)', () => {
  it('preserves all node properties including exported', () => {
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { exported: true, other: 'kept' })],
      [],
    );
    const result = slimGraphData(data, 10);
    expect(result.nodes[0]!.properties.exported).toBe(true);
    expect(result.nodes[0]!.properties.other).toBe('kept');
  });
});

