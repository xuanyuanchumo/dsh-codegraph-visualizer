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


import fs from 'node:fs/promises';
import path from 'node:path';

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

function makeReq(method: string, body?: string, headers: Record<string, string> = {}, socketAddr?: string): IncomingMessage {
  const req = {
    method,
    headers,
    socket: socketAddr ? { remoteAddress: socketAddr } : { remoteAddress: '127.0.0.1' },
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

  it('registers all 10 routes', () => {
    registerRoutes(deps);
    expect(ctx.webServer.register).toHaveBeenCalledTimes(10);
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
    expect(JSON.parse(state.body).error).toBe('Scan failed — check codegraph installation');
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
    expect(JSON.parse(state.body).error).toBe('Initialization failed — is dsh-codegraph installed?');
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
    expect(ctx.emit).toHaveBeenCalledWith('cg-viz/watch/toggle', expect.objectContaining({ enabled: true }));
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
    expect(JSON.parse(state.body).error).toBe('Watch toggle failed');
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
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body)).toHaveProperty('nodes');
  });

  it('POST /tree-sitter returns 400 when filePath missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('required');
  });

  it('POST /tree-sitter returns 413 when content too large', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
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
    const handler = getHandler(ctx, 9);
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

  it('does not set CORS header without request origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBeUndefined();
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
    expect(ctx.on).toHaveBeenCalledWith('cg-viz/graph/data', expect.any(Function));
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

  it('truncates nodes when exceeding maxNodes and filters edges', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'function', 'b.ts', 2),
      makeNode('n3', 'C', 'function', 'c.ts', 3),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'call'),
      makeEdge('e3', 'n1', 'n3', 'call'),
    ];
    const data = makeGraphData(nodes, edges);
    const result = slimGraphData(data, 2);
    expect(result.nodes).toHaveLength(2);
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.nodeCount).toBe(2);
    expect(result.metadata.totalNodeCount).toBe(3);
    expect(result.metadata.totalEdgeCount).toBe(3);
    // Only edges between retained nodes survive
    const retainedIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      expect(retainedIds.has(edge.source)).toBe(true);
      expect(retainedIds.has(edge.target)).toBe(true);
    }
  });

  it('does not truncate when nodes fit within maxNodes', () => {
    const data = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    const result = slimGraphData(data, 10);
    expect(result.metadata.truncated).toBe(false);
  });
});

describe('POST /ast', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    // Use platform-appropriate workspace path so path.resolve/normalize checks pass
    vi.mocked(findWorkspacePath).mockReturnValue(path.resolve('D:\\test\\workspace'));
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue({ type: 'program', children: [] }),
    }) as never);
    vi.mocked(fs.readFile).mockResolvedValue('const x = 1;');
  });

  it('returns AST on success', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('type', 'program');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('returns 400 when filePath missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({})), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('filePath is required');
  });

  it('returns 400 when no workspace path configured', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('No workspace path');
  });

  it('returns 403 when path outside workspace', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: '../../../etc/passwd' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toContain('path outside workspace');
  });

  it('returns 403 when isPathAllowed returns false', async () => {
    vi.mocked(isPathAllowed).mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toContain('Access denied');
  });

  it('returns 413 when file content too large', async () => {
    const largeContent = 'x'.repeat(512 * 1024 + 1);
    vi.mocked(fs.readFile).mockResolvedValue(largeContent);
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(413);
    expect(JSON.parse(state.body).error).toContain('too large');
  });

  it('returns 500 when AST parsing returns null', async () => {
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue(null),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toContain('AST parsing failed');
  });

  it('returns 500 on file read error', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('read error'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toContain('AST parsing failed');
  });
});

describe('POST /tree-sitter (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue({ type: 'program' }),
    }) as never);
  });

  it('returns 400 when filePath contains ..', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: '../test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('Invalid filePath');
  });

  it('returns 400 when filePath exceeds 512 characters', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    const longPath = 'a'.repeat(513);
    await handler(makeReq('POST', JSON.stringify({ filePath: longPath, content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('Invalid filePath');
  });

  it('returns 400 when content missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('required');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('POST /scan (additional)', () => {
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

  it('returns in-flight data when a scan is already running', async () => {
    const inFlightData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    const inFlightPromise = Promise.resolve(inFlightData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    // Pre-set an in-flight promise for the workspace path
    deps.setScanInFlight('/test/workspace', inFlightPromise);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.nodes).toHaveLength(1);
    // fetchMergedGraph should NOT have been called since in-flight was used
    expect(fetchMergedGraph).not.toHaveBeenCalled();
  });

  it('uses specific path when provided (not ".")', async () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/custom/path' })), res);
    expect(state.code).toBe(200);
    expect(fetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/custom/path', 'both');
  });
});

describe('POST /init (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('returns failure result when invokeUpstream returns null', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(null);
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('Initialization failed');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('POST /watch (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('toggles watch mode off when enabled is false', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: false, path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(ctx.emit).toHaveBeenCalledWith('cg-viz/watch/toggle', expect.objectContaining({ enabled: false }));
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('POST /diff (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('returns 500 on fetch error', async () => {
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('diff fetch failed'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Graph diff failed — check git refs');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('returns 400 when both from and to missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({})), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('required');
  });

  it('rejects git ref containing ..', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main..branch', to: 'feature' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toContain('Invalid git ref');
  });
});

describe('GET /data (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('returns empty graph when if-none-match present but no cached data', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { 'if-none-match': '12345' }), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('returns full data when if-none-match is older than timestamp', () => {
    const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    // if-none-match is 0, graphData timestamp is 1, so client data is stale
    handler(makeReq('GET', undefined, { 'if-none-match': '0' }), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body).nodes).toHaveLength(1);
  });

  it('handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('GET /workspace (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('GET /dependencies (additional)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('parses go.mod when present', async () => {
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      if (String(filePath).endsWith('go.mod')) return Promise.resolve('module test');
      return Promise.reject(new Error('not found'));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
  });

  it('parses package.json and Cargo.toml when present', async () => {
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return Promise.resolve('{}');
      if (p.endsWith('Cargo.toml')) return Promise.resolve('[package]');
      return Promise.reject(new Error('not found'));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
  });

  it('returns 500 when findWorkspacePath throws', async () => {
    vi.mocked(findWorkspacePath).mockImplementation(() => {
      throw new Error('workspace error');
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('Internal server error');
  });
});

describe('registerRoutes - rate limiting', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeGraphData([], []));
    vi.mocked(isPathAllowed).mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue({ codegraph: true, lens: true });
  });

  it('returns 429 when rate limit exceeded for /status', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    // /status is not a heavy endpoint, limit is 60 req/min
    // Use a unique IP to avoid interfering with other tests
    const uniqueIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    // Send 60 requests (all should succeed)
    for (let i = 0; i < 60; i++) {
      const { res, state } = makeRes();
      handler(makeReq('GET', undefined, {}, uniqueIp), res);
      expect(state.code).toBe(200);
    }
    // 61st request should be rate limited
    const { res: resLast, state: stateLast } = makeRes();
    handler(makeReq('GET', undefined, {}, uniqueIp), resLast);
    expect(stateLast.code).toBe(429);
    expect(JSON.parse(stateLast.body).error).toBe('Rate limit exceeded');
  });
});

describe('registerRoutes - CORS (additional)', () => {
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

  it('does not set CORS header for non-matching origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { origin: 'http://evil.com' }), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not set CORS header on preflight for non-matching origin', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS', undefined, { origin: 'http://evil.com' }), res);
    expect(state.code).toBe(204);
    expect(state.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('registerService (additional)', () => {
  it('service.getImpactAnalysis returns null when upstream returns null', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue(null);
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getImpactAnalysis('fn1');
    expect(result).toBeNull();
  });

  it('service.getSymbolDetail returns null when upstream returns non-object', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    const mockInvoke = vi.fn().mockResolvedValue('not-an-object');
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const result = await service.getSymbolDetail('fn1');
    expect(result).toBeNull();
  });

  it('service.onGraphUpdate callback receives graph data event', () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    const callback = vi.fn();
    service.onGraphUpdate(callback);
    // Simulate event emission
    const eventHandler = ctx.on.mock.calls[0]![1] as (event: Record<string, unknown>) => void;
    eventHandler({
      repoId: 'test-repo',
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      edges: [],
      timestamp: 12345,
    });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      metadata: expect.objectContaining({ timestamp: 12345 }),
    }));
  });
});

