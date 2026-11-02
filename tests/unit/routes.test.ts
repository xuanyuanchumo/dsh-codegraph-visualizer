import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: vi.fn(),
  createInvoke: vi.fn(() => vi.fn()),
}));

const mockIsPathAllowed = vi.fn(() => true);

/**
 * `setAstSourceProbe` 的 spy —— 只观察调用，**真实实现照跑**（委托给 `importOriginal`）。
 * 直接用 `vi.fn()` 替换会让探针永远登记不上，于是所有 `/health` 用例都跑在
 * "AST 通道不存在" 的世界里：它们仍然会绿，但测的不是真实接线。
 */
const setAstProbeSpy = vi.hoisted(() => ({ setAstSourceProbe: vi.fn() }));

vi.mock('../../src/host/security.ts', () => ({
  SecurityManager: class {
    isPathAllowed = mockIsPathAllowed;
    setAllowedWorkspaceRoots = vi.fn();
    addAllowedWorkspaceRoots = vi.fn();
    getSnapshot = vi.fn(() => ({ roots: ['/test/workspace'], source: 'registry' }));
    reset = vi.fn();
  },
  createSecurityManager: () => new (class {
    isPathAllowed = mockIsPathAllowed;
    setAllowedWorkspaceRoots = vi.fn();
    addAllowedWorkspaceRoots = vi.fn();
    getSnapshot = vi.fn(() => ({ roots: ['/test/workspace'], source: 'registry' }));
    reset = vi.fn();
  })(),
}));

// 用 `importOriginal` 只覆盖 `checkPrerequisites`，其余导出（`setAstSourceProbe` 等）保持真实。
//
// 写成**整体替换**的工厂（`() => ({ … })`）会在有人给 `prerequisites.ts` 加一个导出时
// 立刻炸成「No "X" export is defined on the mock」—— 本轮就踩了一次：`registerRoutes`
// 新增了对 `setAstSourceProbe` 的调用，于是 184 个用例一起红，而它们与能力位毫无关系。
// 这是 CLAUDE.md 里已经记录过的形态，正确的默认是"只换被测函数"。
vi.mock('../../src/host/prerequisites.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/prerequisites.ts')>();
  setAstProbeSpy.setAstSourceProbe.mockImplementation(
    (...args: Parameters<typeof actual.setAstSourceProbe>) => actual.setAstSourceProbe(...args),
  );
  return {
    ...actual,
    setAstSourceProbe: setAstProbeSpy.setAstSourceProbe,
    findWorkspacePath: vi.fn(() => '/test/workspace'),
    extractWorkspacePaths: vi.fn(() => ['/test/workspace']),
    resolveWorkspaceRoots: vi.fn(() => ({ paths: ['/test/workspace'], source: 'registry' })),
    checkPrerequisites: vi.fn(() => makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true })),
  };
});

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
    realpath: vi.fn((p: string) => Promise.resolve(p)),
  },
}));

// `/churn` 会在宿主侧 fork 一个 git 子进程。路由测试**绝不能**真的跑 git：
// 一是慢（每例几百毫秒到数秒），二是结果取决于本机仓库状态，测试会随环境变红。
// 只替换 `collectGitChurn`，`clearChurnCache` 等其余导出保持真实。
const mockCollectGitChurn = vi.fn();
vi.mock('../../src/host/gitChurn.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/gitChurn.ts')>();
  return { ...actual, collectGitChurn: (...args: unknown[]) => mockCollectGitChurn(...args) };
});

// `/diff` 同样会在宿主侧 fork git（`git diff --raw`）。与 `/churn` 同一条理由：
// 路由测试绝不能真的跑 git——慢，且结果取决于本机仓库状态。
// 只替换 `collectGitFileDiff`；`clearGitDiffCache` 保持真实（其它用例可能要清缓存）。
const mockCollectGitFileDiff = vi.fn();
vi.mock('../../src/host/gitDiff.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/gitDiff.ts')>();
  return { ...actual, collectGitFileDiff: (...args: unknown[]) => mockCollectGitFileDiff(...args) };
});

const mockReadEdgesFromDb = vi.fn();
const mockReadFileOutlineFromDb = vi.fn();
const mockReadSymbolASTFromDb = vi.fn();
const mockReadEdgesForNodesFromDb = vi.fn();
const mockReadIncidentEdgesWithFilePathsFromDb = vi.fn();

vi.mock('../../src/adapters/CodeGraphAdapter.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/CodeGraphAdapter.ts')>();
  // Default: delegate to real implementation. Tests override via mockReturnValue.
  mockReadEdgesFromDb.mockImplementation((...args: Parameters<typeof actual.readEdgesFromDb>) => actual.readEdgesFromDb(...args));
  mockReadFileOutlineFromDb.mockImplementation((...args: Parameters<typeof actual.readFileOutlineFromDb>) => actual.readFileOutlineFromDb(...args));
  mockReadSymbolASTFromDb.mockImplementation((...args: Parameters<typeof actual.readSymbolASTFromDb>) => actual.readSymbolASTFromDb(...args));
  mockReadEdgesForNodesFromDb.mockImplementation((...args: Parameters<typeof actual.readEdgesForNodesFromDb>) => actual.readEdgesForNodesFromDb(...args));
  mockReadIncidentEdgesWithFilePathsFromDb.mockImplementation(
    (...args: Parameters<typeof actual.readIncidentEdgesWithFilePathsFromDb>) => actual.readIncidentEdgesWithFilePathsFromDb(...args),
  );
  return {
    ...actual,
    readEdgesFromDb: mockReadEdgesFromDb,
    readFileOutlineFromDb: mockReadFileOutlineFromDb,
    readSymbolASTFromDb: mockReadSymbolASTFromDb,
    readEdgesForNodesFromDb: mockReadEdgesForNodesFromDb,
    readIncidentEdgesWithFilePathsFromDb: mockReadIncidentEdgesWithFilePathsFromDb,
  };
});

const { registerRoutes, registerService, slimGraphData } = await import('../../src/host/routes.ts');
const { fetchMergedGraph, createInvoke } = await import('../../src/tools.ts');
const { SecurityManager } = await import('../../src/host/security.ts');
const { findWorkspacePath, checkPrerequisites } = await import('../../src/host/prerequisites.ts');
const { TreeSitterAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');


import fs from 'node:fs/promises';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { GraphData, GraphNode, GraphEdge } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData, makePrerequisiteStatus } from '../helpers.ts';
import type { VisualizerConfig } from '../../src/host/config.ts';
import { isSafeRelativePath, triggerBackgroundBuild } from '../../src/host/routes/shared.ts';
import { GraphRepository } from '../../src/host/db/GraphRepository.ts';
import { FINGERPRINT, VALIDATION, SYMBOL_AST, EDGES_AGGREGATION } from '../../src/shared/constants.ts';
import {
  computeGraphEtag,
  etagKeyForOutline,
  etagKeyForAst,
  etagKeyForEdges,
  resolveAstBudget,
} from '../../src/shared/graphFingerprint.ts';

/**
 * 图槽 fixture：`metadata.repoId` 必须等于宿主解析出的工作区路径。
 *
 * 生产里 `triggerBackgroundBuild()` 用 `repoId = workspacePath` 落槽（`src/host/routes/shared.ts:491`），
 * 所以「槽里是 `/test/workspace` 的图」与「请求 `/test/workspace`」本来就是同源。
 * 早期 fixture 一律写死 `'test-repo'`，这在本轮 P0-B（内存回落按工作区限定）之后会变成
 * **跨工作区**——那不是测试抓到的缺陷，而是 fixture 编造了一个生产不可能出现的状态。
 * 因此这里统一取 `findWorkspacePath()` 的返回值，让默认场景天然同源；
 * 需要构造「外来工作区」的用例必须显式传第 3 个参数。
 */
function makeScopedGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  repoId: string = WORKSPACE_PATH,
  timestamp = 1,
): GraphData {
  return makeGraphData(nodes, edges, repoId, timestamp);
}

const WORKSPACE_PATH = '/test/workspace';

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

function makeReq(method: string, body?: string, headers: Record<string, string> = {}, socketAddr?: string, url?: string): IncomingMessage {
  const req = {
    method,
    headers,
    url: url ?? '/',
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
  const securityManager = new SecurityManager();
  return {
    ctx: ctx as never,
    config,
    securityManager,
    getLastGraphData: () => lastGraphData.value,
    setLastGraphData: (data: GraphData | null) => { lastGraphData.value = data; },
    getLastInitResult: () => lastInitResult.value,
    setLastInitResult: (data: { success: boolean; path: string; message: string; timestamp: number } | null) => { lastInitResult.value = data; },
    getScanCache: () => scanCache,
    getScanInFlight: (p: string) => scanInFlight.get(p) ?? null,
    setScanInFlight: (p: string, promise: Promise<GraphData> | null) => { scanInFlight.set(p, promise); },
    // Optional persistence hook. Tests that assert snapshot/fingerprint behaviour inject a real repo.
    graphRepo: undefined as GraphRepository | undefined,
    isDestroyed: () => false,
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
    setAstProbeSpy.setAstSourceProbe.mockClear();
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockCollectGitFileDiff.mockReset();
    // 默认返回「成功但无变更」：让不关心 diff 内容的用例（缺参数 / 非法引用 /
    // 工作区拒绝）走到各自的早退分支，而不是被 git mock 的返回值绊倒。
    mockCollectGitFileDiff.mockResolvedValue({
      changes: [], available: true, error: null, truncated: false,
      revisions: { from: 'main', to: 'feature' },
    });
  });

  it('registers all 22 routes', () => {
    registerRoutes(deps);
    // 22 = 升级前的 18 条 + `/churn` + `/query` + `/registry`
    //   + cycle-124 的 `/paths`（路径枚举的用户侧出口）。
    // 这条断言的价值不在数字本身，而在「新增一条路由必须显式面对它」——
    // 否则漏注册一条路由不会有任何测试变红（`ctx.effect` 的 disposer 一样能过）。
    expect(ctx.webServer.register).toHaveBeenCalledTimes(22);
  });

  it('serves the layout worker bundle from the plugin HTTP surface', () => {
    // The browser loads a Worker from a URL, and DSH exposes no asset route for plugin files, so
    // this path has to be served by the plugin itself (see workerRoutes.ts).
    registerRoutes(deps);
    const registration = ctx.webServer.register.mock.calls[17]![0];
    expect(registration.kind).toBe('exact');
    expect(registration.path).toBe('/api/v1/codegraph/worker/layoutWorker.js');

    const { res, state } = makeRes();
    registration.handler(makeReq('GET', undefined, {}, undefined, registration.path), res);
    // Either the bundle is built (200 with JavaScript) or the route says so honestly (404).
    if (state.code === 200) {
      expect(state.headers['content-type']).toContain('text/javascript');
      expect(state.body.length).toBeGreaterThan(0);
    } else {
      expect(state.code).toBe(404);
      expect(JSON.parse(state.body).error).toBe('WORKER_NOT_BUILT');
    }
  });

  it('registers an AST source probe so the capability bit reflects the adapter', () => {
    // `checkPrerequisites(ctx)` 是同步签名，拿不到 `registerRoutes` 里构造的适配器实例，
    // 所以那条路径靠一个模块级探针槽位（`setAstSourceProbe`）传递真实状态。
    // 这条用例钉的是**接线本身**：路由注册完成后探针必须已经登记，否则 `astSource`
    // 会永远停在 `false` —— 一个不会让任何界面断言变红的假阴性。
    const { setAstSourceProbe } = setAstProbeSpy;
    registerRoutes(deps);
    expect(setAstSourceProbe).toHaveBeenCalledTimes(1);
    // 登记进去的必须是一个真函数（不是 `null` 复位，也不是漏了参数）。
    expect(typeof setAstSourceProbe.mock.calls[0]![0]).toBe('function');
  });

  it('GET /status returns prerequisites status', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toEqual({
      codegraph: true, lens: true, astSource: true, graphSource: true, compat: null,
      // cycle-116：registry 摘要字段（additive）。断言形状而非全量内容——矩阵内容由
      // registryContract.test.ts 守卫，这里只钉「字段存在且四面计数齐全」。
      registry: expect.objectContaining({
        total: expect.any(Number),
        // cycle-134：tools 12 → 13（+graph_path_pattern）；cycle-135：→ 14（+graph_slice）。
        // 这个数字是「矩阵登记数」，与「真实注册数」的一致性由 registryContract.test.ts
        // 的集合相等守卫负责。
        byFace: expect.objectContaining({ tools: 14, routes: 21, entries: 4, skill: 1 }),
        brokenLinks: [],
      }),
    });
  });

  it('GET /status handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('GET /workspace reports the current path and list', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.path).toBe('/test/workspace');
    expect(parsed.list).toEqual(['/test/workspace']);
  });

  it('GET /workspace reports the allowed roots and which source produced them (§31.7 observability)', () => {
    // A rejected file route used to be diagnosable only from inside the process: the response said
    // 403 and nothing else. These fields make "everything is denied" readable from the browser.
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.allowedRoots).toEqual(['/test/workspace']);
    expect(parsed.rootSource).toBe('registry');
    expect(parsed.resolvedFrom).toEqual(['/test/workspace']);
  });

  it('GET /data returns empty graph when no lastGraphData', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('GET /data returns cached graph with etag', () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    // P0-R16-02：校验值不再是裸时间戳，而是带身份 + 资源维度的弱校验器。
    expect(state.headers['etag']).toBe(
      computeGraphEtag(graphData.metadata.repoId, graphData.metadata.timestamp, 'graph'),
    );
    expect(JSON.parse(state.body).nodes).toHaveLength(1);
  });

  it('GET /data returns 304 when etag matches', () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    const etag = computeGraphEtag(graphData.metadata.repoId, graphData.metadata.timestamp, 'graph');
    handler(makeReq('GET', undefined, { 'if-none-match': etag }), res);
    expect(state.code).toBe(304);
    expect(state.headers['etag']).toBe(etag);
  });

  // 校验值按资源定域：`/data` 的校验值不能替别的端点回答 304，否则调用方拿到的是
  // "这个资源没变"的假结论，而实际请求的是另一个资源。
  it('GET /data does not accept another resource\'s etag', () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    const wrongResource = computeGraphEtag(graphData.metadata.repoId, graphData.metadata.timestamp, 'children');
    handler(makeReq('GET', undefined, { 'if-none-match': wrongResource }), res);
    expect(state.code).toBe(200);
  });

  // 同一个 revision 但身份不同 ⇒ 必须回 200。假 304 会让客户端把旧工作区的图当成当前版本，
  // 这正是跨工作区污染的另一条路径（P0-R16-02）。
  it('GET /data does not accept the same revision from another workspace', () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    const foreign = computeGraphEtag('/repo/other', graphData.metadata.timestamp, 'graph');
    handler(makeReq('GET', undefined, { 'if-none-match': foreign }), res);
    expect(state.code).toBe(200);
  });

  it('POST /scan starts background scan and returns scanning status', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('scanning');
  });

  it('POST /scan returns 403 for disallowed path', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/etc/passwd' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('PATH_NOT_ALLOWED');
  });

  it('POST /scan returns 200 with scanning status (non-blocking)', async () => {
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('fetch failed'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('scanning');
  });

  it('POST /scan returns cached data when within TTL', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res: res1, state: state1 } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res1);
    expect(state1.code).toBe(200);
    expect(JSON.parse(state1.body).status).toBe('scanning');
    // Wait for background scan to complete
    await vi.waitFor(() => {
      expect(deps.getLastGraphData()).not.toBeNull();
    });
    const { res: res2, state: state2 } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res2);
    expect(state2.code).toBe(200);
    expect(JSON.parse(state2.body).nodes).toHaveLength(1);
    expect(fetchMergedGraph).toHaveBeenCalledTimes(1);
  });

  it('POST /init returns initializing status (non-blocking)', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []));
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('initializing');
  });

  it('POST /init returns 403 for disallowed path', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/etc' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('PATH_NOT_ALLOWED');
  });

  it('POST /init returns 200 with initializing status (non-blocking)', async () => {
    vi.mocked(fetchMergedGraph).mockRejectedValue(new Error('init failed'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('initializing');
  });

  it('POST /watch toggles watch mode', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: true, path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.enabled).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/watch/toggle', expect.objectContaining({ enabled: true }));
  });

  it('POST /watch returns 403 for disallowed path', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: true, path: '/etc' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('PATH_NOT_ALLOWED');
  });

  it('POST /watch returns 500 on error', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
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
    expect(JSON.parse(state.body).error).toBe('WATCH_TOGGLE_FAILED');
  });

  it('GET /dependencies returns empty when no workspace', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('GET /dependencies returns 403 when workspace path not allowed', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('WORKSPACE_PATH_NOT_ALLOWED');
  });

  it('GET /dependencies returns dependency graph', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
  });

  it('POST /diff returns 400 when from/to missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'abc' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('COMMITS_REQUIRED');
  });

  it('POST /diff returns 400 for invalid git ref', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'bad;ref', to: 'main' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_GIT_REF');
  });

  it('POST /diff returns file-level diff nodes in the canvas id namespace', async () => {
    // cycle-105 P0-D：旧实现把 `workspace@ref` 当仓库路径查 DB，路径永不存在 ⇒
    // 恒返回空 diff 且 HTTP 200（假成功）。现在数据面改成 git 的变更文件清单，
    // 节点 id 必须是 `file:<相对路径>`——与画布上文件节点同一命名空间，
    // 否则 `HighlightController.applyDiffMarkers` 的 getElementById 一个都命中不了。
    mockCollectGitFileDiff.mockResolvedValue({
      changes: [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'src/new.ts', status: 'added' },
        { path: 'src/gone.ts', status: 'removed' },
      ],
      available: true,
      error: null,
      truncated: false,
      revisions: { from: 'HEAD~1', to: 'HEAD' },
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'HEAD~1', to: 'HEAD' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(3);
    // 断言的是**具体的 id 拼法**，不是「有 3 个节点」——后者对任何实现都成立。
    expect(parsed.nodes.map((n: { id: string }) => n.id).sort()).toEqual([
      'file:src/a.ts', 'file:src/gone.ts', 'file:src/new.ts',
    ]);
    // `diffStatus` 必须落在 properties 里：`readDiffStatus` 只读那个位置，
    // 写到顶层会被整条忽略（标记不出现且无报错）。
    expect(parsed.nodes[0].properties.diffStatus).toBe('modified');
    // 文件级 diff 不产边：`git diff --raw` 不给「哪两个文件之间新增了依赖」，
    // 硬编一条边等于编造数据。
    expect(parsed.edges).toEqual([]);
    // 粒度必须显式回传，面板据此把文案写成「文件变更」。
    expect(parsed.granularity).toBe('file');
    expect(parsed.truncated).toBe(false);
  });

  it('POST /diff accepts git relative refs like HEAD~1 and HEAD^', async () => {
    // cycle-105 P0-C：`GIT_REF_PATTERN` 曾把 `~`/`^` 排除在外，而 DiffPanel 的两个
    // 默认值正是 `HEAD~1` / `HEAD` ⇒ 默认路径 100% 被 400 拒绝，用户必须手输 SHA。
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    for (const ref of ['HEAD~1', 'HEAD^', 'HEAD~3', 'main@{1}', 'HEAD~1^2']) {
      const { res, state } = makeRes();
      await handler(makeReq('POST', JSON.stringify({ from: ref, to: 'HEAD' })), res);
      expect(state.code, `ref ${ref} should be accepted`).toBe(200);
    }
  });

  it('POST /diff honours the workspace sent in the body, not the host default', async () => {
    // cycle-105 P0-E：客户端把 workspace 放在 JSON body，而宿主只读 query ⇒
    // 回落到宿主列表第一个工作区。真机实测请求 A 仓库却拿到 B 仓库的 repoId。
    // 这里断言**传给 git 的工作区**，而不是响应里的 repoId——后者可以来自任何地方。
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    const bodyWorkspace = '/test/other-workspace';
    await handler(makeReq('POST', JSON.stringify({ from: 'HEAD~1', to: 'HEAD', workspace: bodyWorkspace })), res);
    expect(state.code).toBe(200);
    expect(mockCollectGitFileDiff).toHaveBeenCalledWith(bodyWorkspace, 'HEAD~1', 'HEAD');
  });

  it('POST /diff prefers the query workspace over the body workspace', async () => {
    // 成对用例的反面：两处都给了参数时必须有一个确定的优先级（query 优先，
    // 保持既有 GET 路由的行为不变）。只测 body 生效的话，「body 永远覆盖 query」
    // 这个实现也能通过。
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    const queryWorkspace = '/test/query-workspace';
    const bodyWorkspace = '/test/body-workspace';
    await handler(
      makeReq('POST', JSON.stringify({ from: 'HEAD~1', to: 'HEAD', workspace: bodyWorkspace }), {}, undefined, `/api/v1/codegraph/diff?workspace=${encodeURIComponent(queryWorkspace)}`),
      res,
    );
    expect(state.code).toBe(200);
    expect(mockCollectGitFileDiff).toHaveBeenCalledWith(queryWorkspace, 'HEAD~1', 'HEAD');
  });

  it('POST /diff returns 500 (not an empty 200) when git collection fails', async () => {
    // 假成功是这条路由历史上最严重的失效形态：失败被渲染成「两版本没有差异」。
    // 失败必须可见——500 + 原因，而不是空节点 + 200。
    mockCollectGitFileDiff.mockResolvedValue({
      changes: [], available: false, error: 'fatal: bad revision \'nope\'',
      truncated: false, revisions: { from: 'nope', to: 'HEAD' },
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'nope', to: 'HEAD' })), res);
    expect(state.code).toBe(500);
    const parsed = JSON.parse(state.body);
    expect(parsed.error).toBe('GRAPH_DIFF_FAILED');
    // 原因要原样带回：只说「失败」而不说为什么，真机上无从排查。
    expect(parsed.message).toContain('bad revision');
  });

  it('POST /diff passes through the truncation flag when the list was capped', async () => {
    mockCollectGitFileDiff.mockResolvedValue({
      changes: [{ path: 'src/a.ts', status: 'modified' }],
      available: true, error: null, truncated: true,
      revisions: { from: 'HEAD~1', to: 'HEAD' },
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'HEAD~1', to: 'HEAD' })), res);
    expect(state.code).toBe(200);
    // 被截断的清单与完整清单一模一样，标志位丢了用户就永远不知道还有更多。
    expect(JSON.parse(state.body).truncated).toBe(true);
  });

  it('POST /diff returns empty when no workspace', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('POST /diff returns 403 when workspace not allowed', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('WORKSPACE_PATH_NOT_ALLOWED');
  });

  it('POST /tree-sitter parses content', async () => {

    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body)).toHaveProperty('nodes');
  });

  it('POST /tree-sitter returns 400 when filePath missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('FILEPATH_AND_CONTENT_REQUIRED');
  });

  it('POST /tree-sitter returns 413 when content too large', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    const largeContent = 'x'.repeat(512 * 1024 + 1);
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: largeContent })), res);
    expect(state.code).toBe(413);
    expect(JSON.parse(state.body).error).toBe('CONTENT_TOO_LARGE');
  });

  it('POST /tree-sitter returns 500 on parse error', async () => {
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockRejectedValue(new Error('parse error')),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('INTERNAL_ERROR');
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
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
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerService(deps);
    const service = ctx.provide.mock.calls[0]![1];
    expect(service.getCurrentGraph()).toBe(graphData);
  });

  it('service.getGraphData fetches and returns slimmed data', async () => {
    const ctx = makeMockCtx();
    const config = makeConfig();
    const deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []));
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
    expect(ctx.on).toHaveBeenCalledWith('codegraph-visualizer/graph/data', expect.any(Function));
  });
});

describe('slimGraphData (additional)', () => {
  it('preserves all node properties including exported', () => {
    const data = makeScopedGraphData(
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
    const data = makeScopedGraphData(nodes, edges);
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
    const data = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    // Use platform-appropriate workspace path so path.resolve/normalize checks pass
    vi.mocked(findWorkspacePath).mockReturnValue(path.resolve('D:\\test\\workspace'));
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue({ type: 'program', children: [] }),
    }) as never);
    vi.mocked(fs.readFile).mockResolvedValue('const x = 1;');
  });

  it('returns AST on success', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('type', 'program');
  });

  it('refreshes the allowed workspace roots before validating a path (no boot-time freeze)', async () => {
    // §31.7: the allowlist used to be computed once in apply(). Re-resolving per request is what
    // keeps a workspace that the host registers later — or a registry that was briefly empty —
    // from turning every file request into a bare 403.
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(200);
    expect(vi.mocked(deps.securityManager.addAllowedWorkspaceRoots)).toHaveBeenCalledWith(['/test/workspace'], 'registry');
  });

  it('resolves filePath against the workspace named in ?workspace=', async () => {
    const otherWorkspace = path.resolve('D:\\test\\other');
    const readFile = vi.mocked(fs.readFile);
    readFile.mockClear();
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    const url = `/api/v1/codegraph/ast?workspace=${encodeURIComponent(otherWorkspace)}`;
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/a.ts' }), { host: 'localhost' }, undefined, url), res);
    expect(state.code).toBe(200);
    expect(readFile).toHaveBeenCalledWith(path.join(otherWorkspace, 'src/a.ts'), 'utf-8');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('returns 400 when filePath missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({})), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('FILEPATH_REQUIRED');
  });

  it('returns 400 when no workspace path configured', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue('');
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('NO_WORKSPACE_PATH');
  });

  it('returns 403 when path outside workspace', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: '../../../etc/passwd' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('PATH_OUTSIDE_WORKSPACE');
  });

  it('returns 403 when isPathAllowed returns false', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('SYMLINK_ESCAPE');
  });

  it('returns 413 when file content too large', async () => {
    const largeContent = 'x'.repeat(512 * 1024 + 1);
    vi.mocked(fs.readFile).mockResolvedValue(largeContent);
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(413);
    expect(JSON.parse(state.body).error).toBe('FILE_TOO_LARGE');
  });

  it('returns 500 when AST parsing returns null', async () => {
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue(null),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('AST_PARSE_FAILED');
  });

  it('returns 500 on file read error', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('read error'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 9);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('AST_PARSE_FAILED');
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      parseToAst: vi.fn().mockResolvedValue({ type: 'program' }),
    }) as never);
  });

  it('returns 400 when filePath contains ..', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: '../test.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_FILEPATH');
  });

  it('accepts a forward-slash relative path, matching the sibling /ast route', async () => {
    const parseFile = vi.fn().mockResolvedValue({ nodes: [{ id: 'n1' }], edges: [] });
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile,
      parseToAst: vi.fn().mockResolvedValue({ type: 'program' }),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/App.tsx', content: 'export const A = () => <p/>;' })), res);
    expect(state.code).toBe(200);
    // The path must reach the adapter verbatim: no separator rewriting, no rejection.
    expect(parseFile).toHaveBeenCalledWith('src/App.tsx', 'export const A = () => <p/>;');
  });

  it('accepts a nested backslash relative path', async () => {
    const parseFile = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
    vi.mocked(TreeSitterAdapter).mockImplementation(() => ({
      parseFile,
      parseToAst: vi.fn().mockResolvedValue({ type: 'program' }),
    }) as never);
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src\\host\\app.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(200);
    expect(parseFile).toHaveBeenCalledWith('src\\host\\app.ts', 'const x = 1;');
  });

  it.each([
    ['posix absolute', '/etc/passwd'],
    ['windows drive absolute', 'C:\\Windows\\System32\\drivers\\etc\\hosts'],
    ['UNC absolute', '\\\\server\\share\\a.ts'],
    ['parent traversal with backslash', '..\\secrets.ts'],
  ])('returns 400 INVALID_FILEPATH for %s', async (_label, filePath) => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath, content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_FILEPATH');
  });

  it('rejects an embedded NUL filePath before the shape guard runs', async () => {
    // extractStringField (src/host/HttpHelpers.ts:44) drops NUL-bearing strings, so the field reads
    // as missing; isSafeRelativePath keeps its own NUL check as defence in depth.
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/a\0b.ts', content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('FILEPATH_AND_CONTENT_REQUIRED');
  });

  it('returns 400 when filePath exceeds 512 characters', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    const longPath = 'a'.repeat(513);
    await handler(makeReq('POST', JSON.stringify({ filePath: longPath, content: 'const x = 1;' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_FILEPATH');
  });

  it('returns 400 when content missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'test.ts' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('FILEPATH_AND_CONTENT_REQUIRED');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  // P0-6: the parse response carries the content hash, so an identical payload is recognisable
  // without re-parsing and the client can key a cache entry on it.
  it('returns a stable contentHash for identical content', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);
    const payload = JSON.stringify({ filePath: 'src/a.ts', content: 'const x = 1;' });

    const first = makeRes();
    await handler(makeReq('POST', payload), first.res);
    expect(first.state.code).toBe(200);
    const firstHash = JSON.parse(first.state.body).contentHash;
    expect(firstHash).toMatch(/^v\d+:[0-9a-f]{16}$/);

    const second = makeRes();
    await handler(makeReq('POST', payload), second.res);
    expect(JSON.parse(second.state.body).contentHash).toBe(firstHash);
  });

  it('returns a different contentHash when the content changes', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);

    const first = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/a.ts', content: 'const x = 1;' })), first.res);
    const second = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/a.ts', content: 'const x = 2;' })), second.res);

    expect(JSON.parse(second.state.body).contentHash).not.toBe(JSON.parse(first.state.body).contentHash);
  });

  it('ignores the filePath when hashing content', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 10);

    const first = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/a.ts', content: 'const x = 1;' })), first.res);
    const second = makeRes();
    await handler(makeReq('POST', JSON.stringify({ filePath: 'src/b.ts', content: 'const x = 1;' })), second.res);

    expect(JSON.parse(second.state.body).contentHash).toBe(JSON.parse(first.state.body).contentHash);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('returns scanning status when a scan is already running (non-blocking)', async () => {
    const inFlightData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    const inFlightPromise = Promise.resolve(inFlightData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    deps.setScanInFlight('/test/workspace', inFlightPromise);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('scanning');
    expect(fetchMergedGraph).not.toHaveBeenCalled();
  });

  it('uses specific path when provided (not ".")', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('returns initializing status when invokeUpstream returns null (non-blocking)', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(null);
    vi.mocked(createInvoke).mockReturnValue(mockInvoke);
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe('initializing');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('toggles watch mode off when enabled is false', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: false, path: '.' })), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.success).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(ctx.emit).toHaveBeenCalledWith('codegraph-visualizer/watch/toggle', expect.objectContaining({ enabled: false }));
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockCollectGitFileDiff.mockReset();
    mockCollectGitFileDiff.mockResolvedValue({
      changes: [], available: true, error: null, truncated: false,
      revisions: { from: 'main', to: 'feature' },
    });
  });

  it('returns 500 when the git collector itself throws', async () => {
    // cycle-105 P0-D 之后 `/diff` 的数据面是 `collectGitFileDiff`，它内部吞掉所有异常
    // 并返回 `available: false`。但「采集器自己抛了」仍必须被路由的 catch 兜住 ——
    // 否则一次意外异常会变成未处理的 rejection，客户端拿到的是连接中断而不是 500。
    mockCollectGitFileDiff.mockRejectedValue(new Error('diff collector exploded'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main', to: 'feature' })), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('GRAPH_DIFF_FAILED');
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });

  it('returns 400 when both from and to missing', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({})), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('COMMITS_REQUIRED');
  });

  it('rejects git ref containing ..', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 8);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ from: 'main..branch', to: 'feature' })), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_GIT_REF');
  });
});

describe('GET /churn (研究报告 §六 #11)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  // `/churn` 注册在 `registerRoutes` 的最后一条（索引 18）。
  // 这条索引断言本身就是一道守卫：若有人把它挪到中间，会连带影响所有
  // 「第 N 次注册」的用例——那种红一片的改动无法自证正确，所以这里显式钉住。
  const CHURN_INDEX = 18;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockCollectGitChurn.mockReset();
    mockCollectGitChurn.mockResolvedValue({
      byFile: { 'src/a.ts': 3 },
      commitCount: 7,
      revision: 'deadbeef',
      truncated: false,
      available: true,
      error: null,
    });
  });

  it('注册在最后一个位置（索引 18）', () => {
    registerRoutes(deps);
    const calls = ctx.webServer.register.mock.calls;
    expect(calls[CHURN_INDEX]![0].path).toBe('/api/v1/codegraph/churn');
  });

  it('返回采集结果原样，且带 etag 响应头', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, CHURN_INDEX);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.available).toBe(true);
    expect(body.byFile).toEqual({ 'src/a.ts': 3 });
    expect(body.commitCount).toBe(7);
    // 校验器必须出现在 200 响应里，否则客户端永远没有值可以回送
    // （CLAUDE.md 记过「校验器可达但值不可达」这个死代码形态）。
    expect(state.headers.etag).toBeTruthy();
  });

  it('采集失败时仍返回 200 且 available=false，错误原因可见', async () => {
    // 采集失败**不是** HTTP 错误：宿主答复了，只是它也没拿到 git 数据。
    // 若这里返回 5xx，客户端只能显示「请求失败」，用户无法区分
    // 「插件没连上宿主」与「这个目录不是 git 仓库」。
    mockCollectGitChurn.mockResolvedValue({
      byFile: {}, commitCount: 0, revision: null, truncated: false,
      available: false, error: 'not a git repository',
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, CHURN_INDEX);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.available).toBe(false);
    expect(body.error).toBe('not a git repository');
  });

  it('命中 if-none-match 时返回 304', async () => {
    registerRoutes(deps);
    const first = makeRes();
    await getHandler(ctx, CHURN_INDEX)(makeReq('GET'), first.res);
    const etag = first.state.headers.etag!;
    expect(etag).toBeTruthy();

    const second = makeRes();
    await getHandler(ctx, CHURN_INDEX)(makeReq('GET', undefined, { 'if-none-match': etag }), second.res);
    expect(second.state.code).toBe(304);
    // 304 不应重复发送正文。
    expect(second.state.body).toBe('');
  });

  it('校验器随 HEAD 变化：换提交后同一个 if-none-match 必须拿到 200', async () => {
    // 这是「校验器与被校验资源无关」家族缺陷的反向用例：
    // 若 etag 里没有 revision 维度，新提交会被假 304 永久吞掉。
    registerRoutes(deps);
    const first = makeRes();
    await getHandler(ctx, CHURN_INDEX)(makeReq('GET'), first.res);
    const oldEtag = first.state.headers.etag!;

    mockCollectGitChurn.mockResolvedValue({
      byFile: { 'src/a.ts': 4 }, commitCount: 8, revision: 'cafebabe',
      truncated: false, available: true, error: null,
    });
    const second = makeRes();
    await getHandler(ctx, CHURN_INDEX)(makeReq('GET', undefined, { 'if-none-match': oldEtag }), second.res);
    expect(second.state.code).toBe(200);
    expect(JSON.parse(second.state.body).revision).toBe('cafebabe');
  });

  it('校验器随工作区变化：不同工作区的同一个 if-none-match 必须拿到 200', async () => {
    registerRoutes(deps);
    const first = makeRes();
    await getHandler(ctx, CHURN_INDEX)(makeReq('GET', undefined, {}, undefined, '/?workspace=/test/workspace'), first.res);
    const wsAEtag = first.state.headers.etag!;

    // 换一个工作区请求；revision 相同，但工作区维度必须让校验器不同。
    vi.mocked(findWorkspacePath).mockReturnValue('/other/workspace');
    const second = makeRes();
    await getHandler(ctx, CHURN_INDEX)(
      makeReq('GET', undefined, { 'if-none-match': wsAEtag }, undefined, '/?workspace=/other/workspace'),
      second.res,
    );
    expect(second.state.code).toBe(200);
  });

  it('无工作区时返回 available=false 且 error=no workspace', async () => {
    vi.mocked(findWorkspacePath).mockReturnValue(undefined as unknown as string);
    registerRoutes(deps);
    const handler = getHandler(ctx, CHURN_INDEX);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.available).toBe(false);
    expect(body.error).toBe('no workspace');
    // 没有工作区就不该白跑一次 git 子进程。
    expect(mockCollectGitChurn).not.toHaveBeenCalled();
  });

  it('工作区路径被拒时返回 403，且不调用采集器', async () => {
    mockIsPathAllowed.mockReturnValue(false);
    registerRoutes(deps);
    const handler = getHandler(ctx, CHURN_INDEX);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(403);
    expect(mockCollectGitChurn).not.toHaveBeenCalled();
  });

  it('处理 CORS 预检', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, CHURN_INDEX);
    const { res, state } = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('returns empty graph when if-none-match present but no cached data', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { 'if-none-match': '12345' }), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.nodes).toHaveLength(0);
  });

  it('returns full data when if-none-match is older than timestamp', () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
    const { res, state } = makeRes();
    // if-none-match is 0, graphData timestamp is 1, so client data is stale
    handler(makeReq('GET', undefined, { 'if-none-match': '0' }), res);
    expect(state.code).toBe(200);
    expect(JSON.parse(state.body).nodes).toHaveLength(1);
  });

  it('handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 3);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 2);
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('handles CORS preflight', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
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
    const handler = getHandler(ctx, 7);
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
    const handler = getHandler(ctx, 7);
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
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('INTERNAL_ERROR');
  });

  // ---- P3-R27-04 决策矩阵：/dependencies 的内容校验器（cycle-100） ----
  // 校验器身份 = 请求方工作区 + manifest 原始内容，刻意**不**取缓存图槽（resourceEtag）——
  // /dependencies 的载荷来自磁盘 manifest，与 lastGraphData 槽不是同一份资源（P0-R16-02 家族）。

  it('carries a content etag on 200 and answers 304 for an unchanged manifest set', async () => {
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return Promise.resolve('{"name":"cg"}');
      return Promise.reject(new Error('not found'));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET'), first.res);
    expect(first.state.code).toBe(200);
    const etag = first.state.headers['etag'];
    // 200 必须回写校验值——「校验器可达 ≠ 校验值可达」正是 cycle-91 的原始缺陷形状。
    expect(etag, '200 response must carry the etag header').toMatch(/^W\/"/);
    // 回放：同一 manifest 内容 ⇒ 304，且 304 分支也回写同一校验值。
    const replay = makeRes();
    await handler(makeReq('GET', undefined, { 'if-none-match': etag! }), replay.res);
    expect(replay.state.code).toBe(304);
    expect(replay.state.headers['etag']).toBe(etag);
  });

  it('changes the etag when manifest content changes (extra 200 is the safe direction)', async () => {
    let pkg = '{"name":"cg"}';
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return Promise.resolve(pkg);
      return Promise.reject(new Error('not found'));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET'), first.res);
    const etag1 = first.state.headers['etag'];
    expect(etag1).toBeTruthy();
    pkg = '{"name":"cg","version":"2.0.0"}';
    const second = makeRes();
    await handler(makeReq('GET', undefined, { 'if-none-match': etag1! }), second.res);
    expect(second.state.code).toBe(200);
    expect(second.state.headers['etag']).not.toBe(etag1);
  });

  it('scopes the validator by workspace identity (foreign workspace must not answer 304)', async () => {
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return Promise.resolve('{"name":"cg"}');
      return Promise.reject(new Error('not found'));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET'), first.res);
    const etag = first.state.headers['etag'];
    expect(etag).toBeTruthy();
    // 相同 manifest 内容、不同工作区 ⇒ 校验值必须不同，否则 A 工作区的校验值能让 B 工作区
    // 收到 304，客户端静默保留 A 的依赖图（P0-R16-02 家族的跨工作区变体）。
    vi.mocked(findWorkspacePath).mockReturnValue('/other/workspace');
    const foreign = makeRes();
    await handler(makeReq('GET', undefined, { 'if-none-match': etag! }), foreign.res);
    expect(foreign.state.code).toBe(200);
    expect(foreign.state.headers['etag']).not.toBe(etag);
  });

  it('changes the etag when a manifest file appears (ENOENT is part of the identity)', async () => {
    let cargoPresent = false;
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('package.json')) return Promise.resolve('{"name":"cg"}');
      if (p.endsWith('Cargo.toml') && cargoPresent) return Promise.resolve('[package]');
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET'), first.res);
    const etag1 = first.state.headers['etag'];
    expect(etag1).toBeTruthy();
    cargoPresent = true;
    const second = makeRes();
    await handler(makeReq('GET', undefined, { 'if-none-match': etag1! }), second.res);
    // 新文件出现 ⇒ 响应载荷会变 ⇒ 旧校验值必须失效。
    expect(second.state.code).toBe(200);
    expect(second.state.headers['etag']).not.toBe(etag1);
  });
});

// ---- CO-3 跨源条件请求闭环（cycle-101）----
// J0 真机已证明（127.0.0.1:3080 页面 → localhost:3080 API）：跨源 200 的 etag 可读
// （expose-headers 生效）、if-none-match 触发的预检通过（allow-headers 含 if-none-match）、
// 跨源 304 的 etag 仍可读、白名单外 origin 被浏览器拦截。这里把同一契约钉进单测：
// 若 checkEtag 的 304 分支或 sendJson 的 200 分支丢掉 buildCorsHeaders，跨源消费方
// （desktop 壳之外的一切嵌入方）会静默失去条件请求能力，而现有测试全绿——
// 「校验器可达 ≠ 校验值可达」的跨源变体：CORS 头可达 ≠ JS 可读。
describe('cross-origin conditional requests (CO-3)', () => {
  const ALLOWED = 'http://localhost:3080';
  const FOREIGN = 'http://evil.example';
  let ctx: MockCtx;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    // 白名单与生产同形（cordis.patch.yml 注入 localhost + 127.0.0.1）。
    deps = makeDeps(ctx, makeConfig({ allowedOrigins: [ALLOWED] }));
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    vi.mocked(fs.readFile).mockImplementation((filePath: unknown) => {
      if (String(filePath).endsWith('package.json')) return Promise.resolve('{"name":"cg"}');
      return Promise.reject(new Error('not found'));
    });
  });

  it('200 echoes allow-origin and exposes etag for an allowlisted origin (sendJson merge)', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { origin: ALLOWED }), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBe(ALLOWED);
    // etag 不在 CORS 安全响应头清单里：没有 expose-headers，跨源 JS 读到的就是 null。
    expect(state.headers['access-control-expose-headers']).toContain('etag');
    expect(state.headers['etag']).toMatch(/^W\/"/);
  });

  it('200 omits allow-origin for a foreign origin (whitelist is exact match)', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { origin: FOREIGN }), res);
    expect(state.code).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('304 carries the CORS echo, expose-headers and the etag itself (checkEtag branch)', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET', undefined, { origin: ALLOWED }), first.res);
    const etag = first.state.headers['etag'];
    expect(etag).toMatch(/^W\/"/);
    // 回放：304 分支必须带全套 CORS 头。丢了它们，跨源客户端的缓存回放会在浏览器层
    // 被判为失败，条件请求整个机制对跨源消费方静默死亡（CO-3 的核心回归点）。
    const replay = makeRes();
    await handler(makeReq('GET', undefined, { origin: ALLOWED, 'if-none-match': etag! }), replay.res);
    expect(replay.state.code).toBe(304);
    expect(replay.state.headers['etag']).toBe(etag);
    expect(replay.state.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(replay.state.headers['access-control-expose-headers']).toContain('etag');
  });

  it('304 omits the echo for a foreign origin but still answers 304 (defense is browser-side)', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const first = makeRes();
    await handler(makeReq('GET'), first.res);
    const etag = first.state.headers['etag'];
    // 服务端语义不受白名单影响（仍是 304），但没有 allow-origin 时浏览器会拦截 JS 读取——
    // 防线在浏览器，不在服务端 4xx 化。
    const replay = makeRes();
    await handler(makeReq('GET', undefined, { origin: FOREIGN, 'if-none-match': etag! }), replay.res);
    expect(replay.state.code).toBe(304);
    expect(replay.state.headers['etag']).toBe(etag);
    expect(replay.state.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight echoes allow-origin and allows if-none-match (conditional GET needs the preflight)', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 7);
    const { res, state } = makeRes();
    // if-none-match 不在 CORS 安全请求头清单里：跨源条件 GET 会先发预检，
    // 预检拒绝 = 条件请求对跨源消费方整个不可用。
    await handler(makeReq('OPTIONS', undefined, {
      origin: ALLOWED,
      'access-control-request-headers': 'if-none-match',
    }), res);
    expect(state.code).toBe(204);
    expect(state.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(state.headers['access-control-allow-headers']).toContain('if-none-match');
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
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
    expect(JSON.parse(stateLast.body).error).toBe('RATE_LIMIT_EXCEEDED');
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
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
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

describe('validatePathRealpath security', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    vi.mocked(fs.realpath).mockResolvedValue('/test/workspace');
  });

  it('POST /scan returns 403 when realpath fails (symlink escape)', async () => {
    vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/test/workspace' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('SYMLINK_ESCAPE');
  });

  it('POST /init returns 403 when realpath fails (symlink escape)', async () => {
    vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/test/workspace' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('SYMLINK_ESCAPE');
  });

  it('POST /watch returns 403 when realpath fails (symlink escape)', async () => {
    vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));
    registerRoutes(deps);
    const handler = getHandler(ctx, 6);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ enabled: true, path: '/test/workspace' })), res);
    expect(state.code).toBe(403);
    expect(JSON.parse(state.body).error).toBe('SYMLINK_ESCAPE');
  });

  it('POST /scan succeeds when realpath resolves normally', async () => {
    vi.mocked(fs.realpath).mockResolvedValue('/test/workspace');
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: '/test/workspace' })), res);
    expect(state.code).toBe(200);
  });
});

describe('GET /health', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('returns 200 and healthy status when codegraph is available', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('healthy');
    expect(parsed.codegraph).toBe(true);
    expect(parsed.lens).toBe(true);
    expect(parsed).toHaveProperty('hasGraphData');
    expect(parsed).toHaveProperty('uptime');
    expect(parsed).toHaveProperty('memory');
    expect(parsed).toHaveProperty('timestamp');
  });

  // ── `/health` 的 healthy 判定（cycle-111 / P0-N3）────────────────────────────
  //
  // 修前 `healthy = codegraph || lens || builtin`，而 `builtin` 在
  // `src/host/prerequisites.ts` 里是**硬编码 `true`** ⇒ 这个表达式恒真，「degraded」
  // 在任何宿主上都从未出现过。既有用例（`codegraph:false, lens:false, builtin:true`
  // ⇒ 期望 healthy）不仅没抓到它，还把这种恒真当成正确行为写进了断言。
  //
  // 下面四条合起来覆盖「判定只由图数据通道决定」：
  //   1. 只有 codegraph  ⇒ healthy
  //   2. 只有 graphSource ⇒ healthy（内置 manifest 依赖图是真实的图数据通道）
  //   3. 只有 astSource  ⇒ **degraded**（AST 可用 ≠ 画得出图 —— 旧实现就在这一步出错）
  //   4. 什么都没有      ⇒ degraded
  // 第 3 条是本轮的核心断言：把 `healthy` 改回 `|| builtin` 或 `|| astSource` 它就会红。

  it('returns 200 and healthy when only codegraph is available', () => {
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true }));
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('healthy');
    expect(parsed.graphSource).toBe(false);
    expect(parsed.astSource).toBe(false);
  });

  it('returns 200 and healthy when only the built-in graph source is available', () => {
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ graphSource: true }));
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('healthy');
    expect(parsed.codegraph).toBe(false);
    expect(parsed.lens).toBe(false);
    expect(parsed.graphSource).toBe(true);
  });

  // 旅程覆盖：J49（能力位诚实可见 —— AST 通道可用 ≠ 画得出图）。
  it('J49: returns 503 and degraded when ONLY the AST source is available', () => {
    // §61.10 的核心：AST 分析通道（`/ast`、`/outline`）真实可用，但它**产不出图**。
    // 旧的 `builtin` 位同时代表这两件事，于是这里会错误地报 healthy。
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ astSource: true }));
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(503);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('degraded');
    expect(parsed.astSource).toBe(true);
    expect(parsed.graphSource).toBe(false);
  });

  it('returns 503 and degraded when nothing at all is available', () => {
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus());
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(503);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('degraded');
    expect(parsed.astSource).toBe(false);
    expect(parsed.graphSource).toBe(false);
  });

  it('returns 503 and unhealthy status on error', () => {
    vi.mocked(checkPrerequisites).mockImplementation(() => {
      throw new Error('check failed');
    });
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('GET'), res);
    expect(state.code).toBe(503);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('unhealthy');
    expect(parsed.error).toBe('check failed');
  });

  it('handles CORS preflight', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 1);
    const { res, state } = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(state.code).toBe(204);
  });
});

describe('readBody - body too large', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig({ maxBodyBytes: 10 });
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('POST /scan returns 500 when request body exceeds maxBodyBytes', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', 'x'.repeat(100)), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('SCAN_FAILED');
  });

  it('POST /init returns 500 when request body exceeds maxBodyBytes', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 5);
    const { res, state } = makeRes();
    await handler(makeReq('POST', 'x'.repeat(100)), res);
    expect(state.code).toBe(500);
    expect(JSON.parse(state.body).error).toBe('INIT_FAILED');
  });
});

describe('parseJsonBody - invalid body', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('POST /scan returns 500 when JSON body is an array', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', '[1,2,3]'), res);
    expect(state.code).toBe(500);
  });

  it('POST /scan returns 500 when JSON body is a primitive string', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', '"hello"'), res);
    expect(state.code).toBe(500);
  });

  it('POST /scan returns 500 when JSON body is a number', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', '42'), res);
    expect(state.code).toBe(500);
  });
});

describe('extractStringField - boundary tests', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('POST /scan falls back to workspace when path contains null byte', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: 'test\0path' })), res);
    expect(state.code).toBe(200);
    // extractStringField returns undefined for null byte, so falls back to workspace
    expect(fetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/test/workspace', 'both');
  });

  it('POST /scan falls back to workspace when path exceeds maxLength', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 4);
    const { res, state } = makeRes();
    await handler(makeReq('POST', JSON.stringify({ path: 'a'.repeat(4097) })), res);
    expect(state.code).toBe(200);
    expect(fetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/test/workspace', 'both');
  });
});

describe('rate limiter - cleanup logic', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('cleans up expired buckets after RATE_LIMIT_WINDOW_MS', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    registerRoutes(deps);
    const handler = getHandler(ctx, 0); // /status route

    // Exhaust rate limit for a unique IP
    const uniqueIp = '10.1.1.1';
    for (let i = 0; i < 60; i++) {
      const { res, state } = makeRes();
      handler(makeReq('GET', undefined, {}, uniqueIp), res);
      expect(state.code).toBe(200);
    }
    // 61st request should be rate limited
    const { res: resLimited, state: stateLimited } = makeRes();
    handler(makeReq('GET', undefined, {}, uniqueIp), resLimited);
    expect(stateLimited.code).toBe(429);

    // Advance time past RATE_LIMIT_WINDOW_MS (60000ms)
    vi.advanceTimersByTime(61000);

    // After cleanup, the same IP should be able to make requests again
    const { res: resAfter, state: stateAfter } = makeRes();
    handler(makeReq('GET', undefined, {}, uniqueIp), resAfter);
    expect(stateAfter.code).toBe(200);

    vi.useRealTimers();
  });

  it('evicts oldest entry when RATE_LIMIT_MAP_MAX is exceeded', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 0); // /status route

    // Exhaust ip1's rate limit (60 requests)
    const ip1 = '10.0.0.1';
    for (let i = 0; i < 60; i++) {
      const { res, state } = makeRes();
      handler(makeReq('GET', undefined, {}, ip1), res);
      expect(state.code).toBe(200);
    }
    // 61st request from ip1 should be rate limited
    const { res: resLimited, state: stateLimited } = makeRes();
    handler(makeReq('GET', undefined, {}, ip1), resLimited);
    expect(stateLimited.code).toBe(429);

    // Fill rateLimitMap with RATE_LIMIT_MAP_MAX (10000) entries
    // ip1 is already in the map, so we need 9999 more unique IPs
    for (let i = 2; i <= 10000; i++) {
      const { res, state } = makeRes();
      handler(makeReq('GET', undefined, {}, `10.0.0.${i}`), res);
    }

    // rateLimitMap now has 10000 entries (including ip1)
    // Send request from a new IP - should evict ip1's bucket (oldest)
    const { res: resNew, state: stateNew } = makeRes();
    handler(makeReq('GET', undefined, {}, '10.0.0.10001'), resNew);
    expect(stateNew.code).toBe(200);

    // ip1's bucket was evicted, so it can make requests again
    const { res: res1Again, state: state1Again } = makeRes();
    handler(makeReq('GET', undefined, {}, ip1), res1Again);
    expect(state1Again.code).toBe(200);
  });
});

describe('bootstrap route', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('GET /bootstrap returns building status when no graph data', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 11);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.rootNodes).toEqual([]);
    expect(body.topLevelNodes).toEqual([]);
    expect(body.indexStatus).toBe('building');
  });

  it('GET /bootstrap returns root nodes when graph data exists', async () => {
    const nodes = [
      makeNode('root1', 'Root 1', 'module', '/src', 1),
      makeNode('root2', 'Root 2', 'module', '/lib', 1),
      makeNode('child1', 'Child 1', 'function', '/src/main.ts', 1, {}, 'root1'),
    ];
    const edges = [makeEdge('e1', 'root1', 'root2', 'dependency')];
    deps.setLastGraphData(makeScopedGraphData(nodes, edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 11);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.rootNodes).toHaveLength(2);
    expect(body.topLevelNodes).toHaveLength(2);
    expect(body.topLevelTotal).toBe(2);
    expect(body.indexStatus).toBe('ready');
    expect(body.metadata.totalNodeCount).toBe(3);
  });

  // ── P0-B：内存回落必须按请求方工作区限定 ──────────────────────────────────────
  //
  // 宿主只有一个图槽，客户端却可以在同一次会话里浏览多个工作区。此前这五条路由
  // （bootstrap / children / outline / ast / edges）的内存回落分支全都无条件读那个槽。
  //
  // 这里刻意写**正向 + 反向成对**的用例：只断言「同源时能拿到数据」会被一个
  // `getWorkspaceScopedGraphData` 直接返回槽的实现骗过；只有反向用例
  // （外来工作区必须拿不到）才能证明这道防护在做实事。CLAUDE.md 里
  // 「on/off 标记必须有反向断言」说的就是这个形态。
  it('GET /bootstrap ignores the in-memory slot when it belongs to another workspace', async () => {
    deps.setLastGraphData(makeScopedGraphData(
      [makeNode('root1', 'Root 1', 'module', '/src', 1)],
      [],
      '/some/other/workspace',
    ));
    registerRoutes(deps);
    const handler = getHandler(ctx, 11);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    // 关键：不能把别的工作区的顶层节点发给本客户端……
    expect(body.topLevelNodes).toEqual([]);
    // ……也不能把它的 repoId 塞进响应（那会让客户端把外来身份写进 store）。
    expect(body.metadata.repoId).toBe(WORKSPACE_PATH);
    // 槽里有图但这个工作区没有 ⇒ 表现为「索引正在构建」，触发后台构建。
    expect(body.indexStatus).toBe('building');
  });

  it('GET /bootstrap still serves the slot when it belongs to the requested workspace', async () => {
    // 正向配对：证明上一条的「空」不是被实现无条件返回空导致的。
    deps.setLastGraphData(makeScopedGraphData(
      [makeNode('root1', 'Root 1', 'module', '/src', 1)],
      [],
    ));
    registerRoutes(deps);
    const handler = getHandler(ctx, 11);
    const { res, state } = makeRes();
    await handler(makeReq('GET'), res);
    const body = JSON.parse(state.body);
    expect(body.topLevelNodes).toHaveLength(1);
    expect(body.indexStatus).toBe('ready');
    expect(body.metadata.repoId).toBe(WORKSPACE_PATH);
  });
});

describe('node children route', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('GET /children returns children of specified node', async () => {
    const parentNode = makeNode('parent', 'Parent', 'module', '/src', 1);
    const child1 = makeNode('child1', 'Child 1', 'function', '/src/a.ts', 1, {}, 'parent');
    const child2 = makeNode('child2', 'Child 2', 'class', '/src/b.ts', 1, {}, 'parent');
    const otherNode = makeNode('other', 'Other', 'function', '/lib/c.ts', 1, {}, 'different-parent');

    deps.setLastGraphData(makeScopedGraphData([parentNode, child1, child2, otherNode], []));

    registerRoutes(deps);
    const handler = getHandler(ctx, 12);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/children?nodeId=parent'), res);
    expect(state.code).toBe(200);
  });
});

describe('file outline route (index 13)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('GET /files/{nodeId}/outline returns 404 for invalid path', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/files/invalid'), res);
    expect(state.code).toBe(404);
  });

  it('GET /files/{nodeId}/outline returns 404 for empty nodeId in path', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/files//outline'), res);
    expect(state.code).toBe(404);
  });

  it('GET /files/{nodeId}/outline returns symbols from cached data', async () => {
    const fileNode = makeNode('file1', 'main.ts', 'module', '/src/main.ts', 1);
    const sym1 = makeNode('sym1', 'foo', 'function', '/src/main.ts', 10, {}, 'file1');
    const sym2 = makeNode('sym2', 'bar', 'class', '/src/main.ts', 20, {}, 'file1');
    const otherSym = makeNode('sym3', 'baz', 'function', '/src/other.ts', 5, {}, 'file2');
    const edges = [makeEdge('e1', 'sym1', 'sym2', 'call')];
    deps.setLastGraphData(makeScopedGraphData([fileNode, sym1, sym2, otherSym], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.symbols).toHaveLength(2);
    expect(body.symbols[0].id).toBe('sym1');
    expect(body.symbols[1].id).toBe('sym2');
    expect(body.edges).toHaveLength(1);
  });

  it('GET /files/{nodeId}/outline returns empty when no cached data', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.symbols).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  // 注意 `await`：修正反序后，`returnIfEtagMatch` 必须在 `resolveWorkspaceFromRequest()` 之后
  // 才可能回 304，因此 304 不再在 handler 的同步段里写出。
  it('GET /files/{nodeId}/outline returns 304 when etag matches', async () => {
    const graphData = makeScopedGraphData([makeNode('file1', 'main.ts', 'module', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    // 校验值按「请求方声明的工作区 + 资源 + 请求键」定域；`findWorkspacePath` 被 mock 成 '/test/workspace'。
    // 请求键是 P3-R18-02 的第二个支点：资源维度只区分端点，节点维度才区分"同一端点的哪一次请求"。
    const etag = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'outline',
      etagKeyForOutline('file1'),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': etag }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(304);
    // 304 分支也必须回写校验值，否则客户端手里永远没有可回传的值（正是 P3-R18-02 的原始形状）。
    expect(state.headers['etag']).toBe(etag);
  });

  // 同一个 revision 下，`file1` 的 outline 校验值不得让 `file2` 的 outline 回 304。
  // 少了请求键维度，客户端拿 file1 的值问 file2 就会收到"没变"，而它手上没有 file2 的符号 ⇒
  // file2 永远展开不出来，且没有任何错误可见。这与"校验器与被校验资源无关"是同一类缺陷的深一层。
  it('GET /files/{nodeId}/outline rejects a validator for a different node', async () => {
    const graphData = makeScopedGraphData([makeNode('file1', 'main.ts', 'module', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    const otherNode = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'outline',
      etagKeyForOutline('file2'),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': otherNode }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
  });

  // 没有请求键的裸校验值（改动前的形状）必须不再匹配任何一条按需路由：否则"带键"与"不带键"
  // 两条构造路径会同时存在，其中一个必然算错。
  it('GET /files/{nodeId}/outline rejects a key-less validator', async () => {
    const graphData = makeScopedGraphData([makeNode('file1', 'main.ts', 'module', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    const keyless = computeGraphEtag('/test/workspace', graphData.metadata.timestamp, 'outline');
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': keyless }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
    // 200 必须带上真正的校验值，客户端才有东西可回传。
    expect(state.headers['etag']).toBeTruthy();
    expect(state.headers['etag']).not.toBe(keyless);
  });

  // 反序（先校验 ETag、后解析工作区）会让校验值缺少身份维度：`?workspace=` 还没被读，
  // 请求方声明的工作区被忽略，另一个工作区的校验值也能让本请求回 304。
  it('GET /files/{nodeId}/outline rejects an etag scoped to another workspace', async () => {
    const graphData = makeScopedGraphData([makeNode('file1', 'main.ts', 'module', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    const foreign = computeGraphEtag(
      '/test/other',
      graphData.metadata.timestamp,
      'outline',
      etagKeyForOutline('file1'),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': foreign }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
  });
});

describe('symbol AST route (index 14)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('GET /symbols/{nodeId}/ast returns 404 for invalid path', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/invalid'), res);
    expect(state.code).toBe(404);
  });

  it('GET /symbols/{nodeId}/ast returns 404 for empty nodeId in path', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols//ast'), res);
    expect(state.code).toBe(404);
  });

  it('GET /symbols/{nodeId}/ast returns AST nodes from cached data', async () => {
    const symNode = makeNode('sym1', 'foo', 'function', '/src/main.ts', 1);
    const ast1 = makeNode('ast1', 'var1', 'variable', '/src/main.ts', 10, {}, 'sym1');
    const ast2 = makeNode('ast2', 'var2', 'variable', '/src/main.ts', 20, {}, 'sym1');
    const otherAst = makeNode('ast3', 'var3', 'variable', '/src/other.ts', 5, {}, 'sym2');
    const edges = [makeEdge('e1', 'ast1', 'ast2', 'call')];
    deps.setLastGraphData(makeScopedGraphData([symNode, ast1, ast2, otherAst], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.astNodes).toHaveLength(2);
    expect(body.astNodes[0].id).toBe('ast1');
    expect(body.astNodes[1].id).toBe('ast2');
    expect(body.astEdges).toHaveLength(1);
  });

  it('GET /symbols/{nodeId}/ast pages through the AST budget with cursor', async () => {
    const symNode = makeNode('sym1', 'foo', 'function', '/src/main.ts', 1);
    const astNodes = Array.from({ length: 5 }, (_, i) =>
      makeNode(`ast${i}`, `var${i}`, 'variable', '/src/main.ts', 10 + i, {}, 'sym1'),
    );
    deps.setLastGraphData(makeScopedGraphData([symNode, ...astNodes], []));

    registerRoutes(deps);
    const handler = getHandler(ctx, 14);

    const first = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=2'), first.res);
    expect(first.state.code).toBe(200);
    const firstBody = JSON.parse(first.state.body);
    expect(firstBody.astNodes.map((n: { id: string }) => n.id)).toEqual(['ast0', 'ast1']);
    expect(firstBody.total).toBe(5);
    expect(firstBody.cursor).toBe(2);
    expect(firstBody.hasMore).toBe(true);

    const second = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=2&cursor=2'), second.res);
    const secondBody = JSON.parse(second.state.body);
    expect(secondBody.astNodes.map((n: { id: string }) => n.id)).toEqual(['ast2', 'ast3']);
    expect(secondBody.cursor).toBe(4);
    expect(secondBody.hasMore).toBe(true);

    const third = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=2&cursor=4'), third.res);
    const thirdBody = JSON.parse(third.state.body);
    expect(thirdBody.astNodes.map((n: { id: string }) => n.id)).toEqual(['ast4']);
    expect(thirdBody.cursor).toBe(5);
    expect(thirdBody.hasMore).toBe(false);
  });

  it('GET /symbols/{nodeId}/ast caps budget at SYMBOL_AST.MAX_NODES and clamps negative cursor', async () => {
    const symNode = makeNode('sym1', 'foo', 'function', '/src/main.ts', 1);
    const astNodes = Array.from({ length: 3 }, (_, i) =>
      makeNode(`ast${i}`, `var${i}`, 'variable', '/src/main.ts', 10 + i, {}, 'sym1'),
    );
    deps.setLastGraphData(makeScopedGraphData([symNode, ...astNodes], []));

    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, `/api/v1/codegraph/symbols/sym1/ast?budget=99999&cursor=-3`), res);
    const body = JSON.parse(state.body);
    // budget 被夹到 MAX_NODES（远大于 3，故全返回）；cursor 被夹到 0。
    expect(body.astNodes).toHaveLength(3);
    expect(body.cursor).toBe(3);
    expect(body.hasMore).toBe(false);
    expect(SYMBOL_AST.MAX_NODES).toBe(800);
  });

  it('GET /symbols/{nodeId}/ast returns empty when no cached data', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.astNodes).toEqual([]);
    expect(body.astEdges).toEqual([]);
    expect(body.sourceLines).toEqual([]);
  });

  it('GET /symbols/{nodeId}/ast returns 304 when etag matches', async () => {
    const graphData = makeScopedGraphData([makeNode('sym1', 'foo', 'function', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    // 请求键含 cursor 与 budget：客户端从不发 budget，故两侧都经 `resolveAstBudget(null)` 算出
    // `SYMBOL_AST.MAX_NODES`——这个"相等"必须算出来而不是两边各写常量（否则 host 改预算时静默分叉）。
    const etag = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'ast',
      etagKeyForAst('sym1', 0, resolveAstBudget(null)),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': etag }, undefined, '/api/v1/codegraph/symbols/sym1/ast'), res);
    expect(state.code).toBe(304);
    expect(state.headers['etag']).toBe(etag);
  });

  // 同一个 revision 下，第一页的校验值不得让第二页请求回 304：cursor 是载荷的一部分。
  it('GET /symbols/{nodeId}/ast rejects a validator for a different page', async () => {
    const graphData = makeScopedGraphData([makeNode('sym1', 'foo', 'function', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    const firstPage = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'ast',
      etagKeyForAst('sym1', 0, resolveAstBudget(null)),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': firstPage }, undefined, '/api/v1/codegraph/symbols/sym1/ast?cursor=800'), res);
    expect(state.code).toBe(200);
  });

  // 同一个 revision 下，`/outline` 的校验值不得让 `/ast` 回 304。
  it('GET /symbols/{nodeId}/ast does not accept another resource\'s etag', async () => {
    const graphData = makeScopedGraphData([makeNode('sym1', 'foo', 'function', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    const wrongResource = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'outline',
      etagKeyForOutline('sym1'),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': wrongResource }, undefined, '/api/v1/codegraph/symbols/sym1/ast'), res);
    expect(state.code).toBe(200);
  });

  // `?budget=-5` 曾原样穿过 `parsed || MAX`（它只挡 NaN 与 0），于是 `slice(cursor, cursor + budget)`
  // 得到空页，且请求键里出现负数——一个所有负数请求共用的校验值。负预算没有合法语义，须回落。
  it('GET /symbols/{nodeId}/ast treats a negative budget as absent', async () => {
    const graphData = makeScopedGraphData([makeNode('sym1', 'foo', 'function', '/src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=-5'), res);
    expect(state.code).toBe(200);
    // 关键：回写的是"按 MAX_NODES 算出来"的校验值，而不是负数版本。
    const clamped = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'ast',
      etagKeyForAst('sym1', 0, resolveAstBudget(null)),
    );
    expect(state.headers['etag']).toBe(clamped);
    expect(resolveAstBudget('-5')).toBe(resolveAstBudget(null));
  });
});

describe('edges route (index 15)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
  });

  it('GET /edges returns 400 when fromId is missing', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges'), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_FILEPATH');
  });

  it('GET /edges returns 400 when fromId exceeds max length', () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    const longFrom = 'a'.repeat(4097);
    handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, `/api/v1/codegraph/edges?from=${longFrom}`), res);
    expect(state.code).toBe(400);
    expect(JSON.parse(state.body).error).toBe('INVALID_FILEPATH');
  });

  it('GET /edges returns empty edges when no cached data', async () => {
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=somefile.ts'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  it('GET /edges returns edges with scope=file from cached data', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const node2 = makeNode('n2', 'B', 'function', 'src/main.ts', 10);
    const node3 = makeNode('n3', 'C', 'function', 'lib/util.ts', 5);
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n3', 'call'),
      makeEdge('e3', 'n2', 'n3', 'call'),
    ];
    deps.setLastGraphData(makeScopedGraphData([node1, node2, node3], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });

  it('GET /edges returns edges with scope=symbol from cached data', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const node2 = makeNode('n2', 'B', 'function', 'src/main.ts', 10);
    const node3 = makeNode('n3', 'C', 'function', 'lib/util.ts', 5);
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n3', 'call'),
      makeEdge('e3', 'n2', 'n3', 'call'),
    ];
    deps.setLastGraphData(makeScopedGraphData([node1, node2, node3], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=n1&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBeGreaterThan(0);
    // scope=symbol filters edges where source or target equals fromId
    expect(body.total).toBe(2); // e1 (n1->n2) and e2 (n1->n3)
  });

  it('GET /edges returns 304 when etag matches', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    // 请求键含 from/scope/cursor/limit/detail：`detail` 决定这一页是聚合摘要还是原始边，
    // 少算这一维就会用聚合页的校验值让明细请求收 304（客户端拿到的是"摘要没变"，而它要的是明细）。
    // 无 cursor 时 host 解析成 0，无 limit 时用 `EDGES_AGGREGATION.PAGE_SIZE` 兜底。
    const etag = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'edges',
      etagKeyForEdges('src/main.ts', 'file', 0, EDGES_AGGREGATION.PAGE_SIZE, false),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': etag }, undefined, '/api/v1/codegraph/edges?from=src/main.ts'), res);
    expect(state.code).toBe(304);
    expect(state.headers['etag']).toBe(etag);
  });

  // 明细请求（`detail=1`）不得被聚合页的校验值命中：两者的载荷完全不同。
  it('GET /edges rejects a validator built for the aggregated view', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    const aggregated = computeGraphEtag(
      '/test/workspace',
      graphData.metadata.timestamp,
      'edges',
      etagKeyForEdges('src/main.ts', 'file', 0, EDGES_AGGREGATION.PAGE_SIZE, false),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': aggregated }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&detail=1'), res);
    expect(state.code).toBe(200);
  });

  // `/children` 与 `/edges` 曾经先校验 ETag、后解析工作区：`?workspace=` 还没被读，
  // 校验值因此缺少身份维度，另一个工作区的校验值也能让本请求回 304。
  it('GET /edges rejects an etag scoped to another workspace', async () => {
    const graphData = makeScopedGraphData([makeNode('n1', 'A', 'function', 'src/main.ts', 1)], []);
    deps.setLastGraphData(graphData);
    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    const foreign = computeGraphEtag(
      '/test/other',
      graphData.metadata.timestamp,
      'edges',
      etagKeyForEdges('src/main.ts', 'file', 0, EDGES_AGGREGATION.PAGE_SIZE, false),
    );
    await handler(makeReq('GET', undefined, { host: 'localhost', 'if-none-match': foreign }, undefined, '/api/v1/codegraph/edges?from=src/main.ts'), res);
    expect(state.code).toBe(200);
  });

  it('GET /edges supports pagination with cursor and limit', async () => {
    // Use fewer than 20 edges to avoid aggregation
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 15; i++) {
      nodes.push(makeNode(`n${i}`, `N${i}`, 'function', 'src/main.ts', i));
    }
    for (let i = 0; i < 14; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'call'));
    }
    deps.setLastGraphData(makeScopedGraphData(nodes, edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file&cursor=0&limit=10'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBe(10);
    expect(body.hasMore).toBe(true);
    expect(body.cursor).toBe(10);
  });

  it('GET /edges returns aggregated edges when count exceeds threshold', async () => {
    // Create enough edges to exceed EDGES_AGGREGATION.THRESHOLD (20)
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    // Nodes in the same file
    for (let i = 0; i < 25; i++) {
      nodes.push(makeNode(`n${i}`, `N${i}`, 'function', 'src/main.ts', i));
    }
    // Nodes in a different file
    for (let i = 25; i < 50; i++) {
      nodes.push(makeNode(`n${i}`, `N${i}`, 'function', 'lib/util.ts', i));
    }
    // Create 25 edges from src/main.ts nodes to lib/util.ts nodes
    for (let i = 0; i < 25; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 25}`, 'call'));
    }
    deps.setLastGraphData(makeScopedGraphData(nodes, edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.aggregated).toBe(true);
    expect(body.hasMore).toBe(false);
    expect(body.edges.length).toBeGreaterThan(0);
    // Aggregated edges should have aggregated: true in properties
    expect(body.edges[0].properties.aggregated).toBe(true);
  });

  it('GET /edges does not aggregate when aggregated=1 is set', async () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 25; i++) {
      nodes.push(makeNode(`n${i}`, `N${i}`, 'function', 'src/main.ts', i));
    }
    for (let i = 25; i < 50; i++) {
      nodes.push(makeNode(`n${i}`, `N${i}`, 'function', 'lib/util.ts', i));
    }
    for (let i = 0; i < 25; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 25}`, 'call'));
    }
    deps.setLastGraphData(makeScopedGraphData(nodes, edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file&aggregated=1'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.aggregated).toBeUndefined();
    expect(body.edges.length).toBe(25);
  });

  it('GET /edges returns empty when fromId matches no nodes (scope=file)', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const node2 = makeNode('n2', 'B', 'function', 'lib/util.ts', 5);
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    deps.setLastGraphData(makeScopedGraphData([node1, node2], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nonexistent.ts&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('GET /edges returns empty when fromId matches no nodes (scope=symbol)', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    deps.setLastGraphData(makeScopedGraphData([node1], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nonexistent&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('GET /edges uses default scope=file when scope not specified', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const node2 = makeNode('n2', 'B', 'function', 'src/main.ts', 10);
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    deps.setLastGraphData(makeScopedGraphData([node1, node2], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('GET /edges matches by node id when fromId equals a node id (scope=file)', async () => {
    const node1 = makeNode('n1', 'A', 'function', 'src/main.ts', 1);
    const node2 = makeNode('n2', 'B', 'function', 'src/main.ts', 10);
    const node3 = makeNode('n3', 'C', 'function', 'lib/util.ts', 5);
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'call'),
    ];
    deps.setLastGraphData(makeScopedGraphData([node1, node2, node3], edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=n1&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBeGreaterThan(0);
  });
});

describe('edges route - DB fallback paths (index 15)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockReadEdgesFromDb.mockClear();
    mockReadEdgesFromDb.mockReturnValue(null);
    mockReadFileOutlineFromDb.mockReturnValue(null);
    mockReadSymbolASTFromDb.mockReturnValue(null);
    mockReadEdgesForNodesFromDb.mockReturnValue([]);
    mockReadIncidentEdgesWithFilePathsFromDb.mockClear();
    mockReadIncidentEdgesWithFilePathsFromDb.mockReturnValue(null);
  });

  it('GET /edges returns edges from DB when no cached data', async () => {
    mockReadEdgesFromDb.mockReturnValue({
      edges: [
        { id: 1, source: 'nodeA', target: 'nodeB', kind: 'call', line: 5 },
        { id: 2, source: 'nodeB', target: 'nodeC', kind: 'import', line: null },
      ],
      total: 2,
    });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nodeA&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.edges[0].source).toBe('nodeA');
    expect(body.edges[0].target).toBe('nodeB');
    expect(body.edges[0].type).toBe('call');
  });

  it('GET /edges filters self-loops and filtered edge kinds from DB', async () => {
    mockReadEdgesFromDb.mockReturnValue({
      edges: [
        { id: 1, source: 'nodeA', target: 'nodeA', kind: 'call', line: 5 },  // self-loop
        { id: 2, source: 'nodeA', target: 'nodeB', kind: 'uses_var', line: 3 },  // filtered kind
        { id: 3, source: 'nodeA', target: 'nodeC', kind: 'call', line: null },
      ],
      total: 3,
    });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nodeA&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges.length).toBe(1);
    expect(body.edges[0].source).toBe('nodeA');
    expect(body.edges[0].target).toBe('nodeC');
  });

  it('GET /edges returns empty when DB returns null and no cached data', async () => {
    mockReadEdgesFromDb.mockReturnValue(null);

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nodeA&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.edges).toEqual([]);
    expect(body.total).toBe(0);
  });

  // --- P1-3: the DB-first path must aggregate too -----------------------------
  // Round 18 made /edges DB-first, but aggregation only lived in the in-memory
  // fallback, so on any workspace with a readable DB the file-pair summary was
  // unreachable. These cases pin the DB branch's aggregate behaviour.

  it('GET /edges aggregates dense neighbourhoods on the DB path', async () => {
    const edges = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, source: `n${i}`, target: `n${i + 25}`, kind: 'calls', line: i + 1,
    }));
    const filePathByNodeId = new Map<string, string>();
    for (let i = 0; i < 25; i++) filePathByNodeId.set(`n${i}`, 'src/main.ts');
    for (let i = 25; i < 50; i++) filePathByNodeId.set(`n${i}`, 'lib/util.ts');
    mockReadIncidentEdgesWithFilePathsFromDb.mockReturnValue({ edges, filePathByNodeId });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.aggregated).toBe(true);
    expect(body.hasMore).toBe(false);
    // One synthetic edge for the single file pair, not 25 raw edges.
    expect(body.edges.length).toBe(1);
    expect(body.total).toBe(1);
    expect(body.edges[0].properties.aggregated).toBe(true);
    expect(body.edges[0].properties.count).toBe(25);
    // `pairKey` orders the two files lexicographically, so 'lib/util.ts' comes first.
    expect(body.edges[0].properties.filePair).toBe('lib/util.ts\0src/main.ts');
    expect(body.edges[0].target).toBe('lib/util.ts');
    // The aggregate path never falls through to the paged reader.
    expect(mockReadEdgesFromDb).not.toHaveBeenCalled();
  });

  it('GET /edges pages the DB path unaggregated when below the threshold', async () => {
    const edges = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1, source: `n${i}`, target: `n${i + 3}`, kind: 'calls', line: i + 1,
    }));
    const filePathByNodeId = new Map<string, string>();
    for (let i = 0; i < 3; i++) filePathByNodeId.set(`n${i}`, 'src/main.ts');
    for (let i = 3; i < 6; i++) filePathByNodeId.set(`n${i}`, 'lib/util.ts');
    mockReadIncidentEdgesWithFilePathsFromDb.mockReturnValue({ edges, filePathByNodeId });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file&limit=2'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.aggregated).toBeUndefined();
    expect(body.edges.length).toBe(2);
    expect(body.total).toBe(3);
    expect(body.hasMore).toBe(true);
    expect(body.cursor).toBe(2);
  });

  it('GET /edges skips aggregation on the DB path when detail=1', async () => {
    const edges = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, source: `n${i}`, target: `n${i + 25}`, kind: 'calls', line: i + 1,
    }));
    mockReadEdgesFromDb.mockReturnValue({ edges, total: edges.length });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file&detail=1'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    // The aggregate was explicitly refused, so the raw edges must come back.
    expect(body.aggregated).toBeUndefined();
    expect(body.edges.length).toBe(25);
    expect(body.total).toBe(25);
    expect(body.hasMore).toBe(false);
    // detail=1 must not touch the aggregate reader at all.
    expect(mockReadIncidentEdgesWithFilePathsFromDb).not.toHaveBeenCalled();
  });

  it('GET /edges never aggregates symbol scope even past the threshold', async () => {
    const nodes = [makeNode('nodeA', 'A', 'function', 'src/main.ts', 1)];
    const edges = Array.from({ length: 25 }, (_, i) => makeEdge(`e${i}`, 'nodeA', `n${i}`, 'call'));
    deps.setLastGraphData(makeScopedGraphData(nodes, edges));

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nodeA&scope=symbol'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.aggregated).toBeUndefined();
    expect(body.edges.length).toBe(25);
  });

  it('GET /edges ignores the DB aggregate reader when scope is symbol', async () => {
    // The aggregate reader must not even be consulted for symbol scope: it exists
    // to resolve file pairs, which symbol scope does not use.
    mockReadIncidentEdgesWithFilePathsFromDb.mockReturnValue({ edges: [], filePathByNodeId: new Map() });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=nodeA&scope=symbol'), res);
    expect(state.code).toBe(200);
    expect(mockReadIncidentEdgesWithFilePathsFromDb).not.toHaveBeenCalled();
  });

  it('GET /edges threshold is exclusive: exactly THRESHOLD edges stay unaggregated', async () => {
    const edges = Array.from({ length: EDGES_AGGREGATION.THRESHOLD }, (_, i) => ({
      id: i + 1, source: `n${i}`, target: `n${i + EDGES_AGGREGATION.THRESHOLD}`, kind: 'calls', line: i + 1,
    }));
    const filePathByNodeId = new Map<string, string>();
    for (let i = 0; i < EDGES_AGGREGATION.THRESHOLD; i++) filePathByNodeId.set(`n${i}`, 'src/main.ts');
    for (let i = EDGES_AGGREGATION.THRESHOLD; i < EDGES_AGGREGATION.THRESHOLD * 2; i++) filePathByNodeId.set(`n${i}`, 'lib/util.ts');
    mockReadIncidentEdgesWithFilePathsFromDb.mockReturnValue({ edges, filePathByNodeId });

    registerRoutes(deps);
    const handler = getHandler(ctx, 15);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/edges?from=src/main.ts&scope=file'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    // `> THRESHOLD`, not `>=`: the boundary itself is still a normal page.
    expect(body.aggregated).toBeUndefined();
    expect(body.edges.length).toBe(EDGES_AGGREGATION.THRESHOLD);
  });
});

describe('file outline route - DB fallback (index 13)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockReadFileOutlineFromDb.mockReturnValue(null);
    mockReadEdgesForNodesFromDb.mockReturnValue([]);
  });

  it('GET /files/{nodeId}/outline returns symbols from DB', async () => {
    mockReadFileOutlineFromDb.mockReturnValue({
      nodes: [
        { id: 'sym1', kind: 'function', name: 'foo', file_path: 'src/main.ts', start_line: 10, signature: 'foo()', docstring: null, is_exported: 1 },
        { id: 'sym2', kind: 'class', name: 'Bar', file_path: 'src/main.ts', start_line: 20, signature: null, docstring: 'A class', is_exported: 0 },
      ],
      total: 2,
    });
    mockReadEdgesForNodesFromDb.mockReturnValue([
      { id: 1, source: 'sym1', target: 'sym2', kind: 'call', line: 15 },
    ]);

    registerRoutes(deps);
    const handler = getHandler(ctx, 13);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/files/file1/outline'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.symbols.length).toBe(2);
    expect(body.symbols[0].id).toBe('sym1');
    expect(body.symbols[0].label).toBe('foo');
    expect(body.symbols[0].properties.signature).toBe('foo()');
    expect(body.symbols[0].properties.exported).toBe(true);
    expect(body.symbols[1].properties.docstring).toBe('A class');
    expect(body.symbols[1].properties.exported).toBe(false);
    expect(body.edges.length).toBe(1);
  });
});

describe('symbol AST route - DB fallback (index 14)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
    mockIsPathAllowed.mockReturnValue(true);
    vi.mocked(findWorkspacePath).mockReturnValue('/test/workspace');
    vi.mocked(checkPrerequisites).mockReturnValue(makePrerequisiteStatus({ codegraph: true, lens: true, astSource: true, graphSource: true }));
    mockReadSymbolASTFromDb.mockReturnValue(null);
    mockReadEdgesForNodesFromDb.mockReturnValue([]);
  });

  it('GET /symbols/{nodeId}/ast returns AST nodes from DB', async () => {
    mockReadSymbolASTFromDb.mockReturnValue({
      nodes: [
        { id: 'ast1', kind: 'variable', name: 'var1', file_path: 'src/main.ts', start_line: 10, signature: null, docstring: null, is_exported: 0 },
        { id: 'ast2', kind: 'variable', name: 'var2', file_path: 'src/main.ts', start_line: 20, signature: null, docstring: null, is_exported: 0 },
      ],
      total: 2,
    });
    mockReadEdgesForNodesFromDb.mockReturnValue([
      { id: 1, source: 'ast1', target: 'ast2', kind: 'call', line: 15 },
    ]);

    registerRoutes(deps);
    const handler = getHandler(ctx, 14);
    const { res, state } = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast'), res);
    expect(state.code).toBe(200);
    const body = JSON.parse(state.body);
    expect(body.astNodes.length).toBe(2);
    expect(body.astNodes[0].id).toBe('ast1');
    expect(body.astNodes[0].label).toBe('var1');
    expect(body.astNodes[0].parentId).toBe('sym1');
    expect(body.astEdges.length).toBe(1);
  });

  it('GET /symbols/{nodeId}/ast pages the DB path with cursor and reports total', async () => {
    mockReadSymbolASTFromDb.mockReturnValue({
      nodes: Array.from({ length: 3 }, (_, i) => ({
        id: `ast${i}`, kind: 'variable', name: `var${i}`, file_path: 'src/main.ts',
        start_line: 10 + i, signature: null, docstring: null, is_exported: 0,
      })),
      total: 3,
    });
    mockReadEdgesForNodesFromDb.mockReturnValue([]);

    registerRoutes(deps);
    const handler = getHandler(ctx, 14);

    const first = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=2'), first.res);
    const firstBody = JSON.parse(first.state.body);
    expect(firstBody.astNodes.map((n: { id: string }) => n.id)).toEqual(['ast0', 'ast1']);
    expect(firstBody.total).toBe(3);
    expect(firstBody.cursor).toBe(2);
    expect(firstBody.hasMore).toBe(true);

    const second = makeRes();
    await handler(makeReq('GET', undefined, { host: 'localhost' }, undefined, '/api/v1/codegraph/symbols/sym1/ast?budget=2&cursor=2'), second.res);
    const secondBody = JSON.parse(second.state.body);
    expect(secondBody.astNodes.map((n: { id: string }) => n.id)).toEqual(['ast2']);
    expect(secondBody.cursor).toBe(3);
    expect(secondBody.hasMore).toBe(false);
  });
});

describe('isSafeRelativePath (host path-shape guard)', () => {
  const max = VALIDATION.MAX_FILEPATH_LENGTH;

  it.each([
    'src/app.ts',
    'src/App.tsx',
    'src\\host\\app.ts',
    'a/b/c/d.ts',
    './src/app.ts',
  ])('accepts %s', (value) => {
    expect(isSafeRelativePath(value, max)).toBe(true);
  });

  it.each([
    '',
    '..',
    '../app.ts',
    '..\\app.ts',
    'src/../../etc/passwd',
    '/app.ts',
    '/etc/passwd',
    'C:\\app.ts',
    'c:/app.ts',
    '\\\\server\\share\\app.ts',
    'a\0b.ts',
  ])('rejects %s', (value) => {
    expect(isSafeRelativePath(value, max)).toBe(false);
  });

  it('rejects a path longer than the configured maximum', () => {
    expect(isSafeRelativePath('a'.repeat(max), max)).toBe(true);
    expect(isSafeRelativePath('a'.repeat(max + 1), max)).toBe(false);
  });
});

describe('triggerBackgroundBuild snapshot fingerprint (P0-6)', () => {
  let ctx: MockCtx;
  let config: VisualizerConfig;
  let deps: ReturnType<typeof makeDeps>;
  let workspace: string;
  let graphRepo: GraphRepository;

  beforeEach(() => {
    ctx = makeMockCtx();
    config = makeConfig();
    deps = makeDeps(ctx, config);
    workspace = mkdtempSync(path.join(tmpdir(), 'cgroutes-'));
    graphRepo = new GraphRepository(workspace);
    graphRepo.init();
    deps.graphRepo = graphRepo;
    vi.mocked(fetchMergedGraph).mockClear();
    vi.mocked(fetchMergedGraph).mockResolvedValue(makeScopedGraphData([], []));
  });

  afterEach(() => {
    graphRepo.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  const repoId = () => workspace;

  function settle(): Promise<void> {
    // triggerBackgroundBuild fires and forgets; flush the microtask queue until the write lands.
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('stores one snapshot for the first build', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(graphRepo.countSnapshots(repoId())).toBe(1);
    expect(graphRepo.getLatestSnapshot(repoId())?.snapshotHash).toMatch(/^v\d+:[0-9a-f]{16}$/);
  });

  // The regression that motivated P0-6: the old `${nodes}:${edges}:${timestamp}` key meant every
  // build minted a fresh row, so the UNIQUE(repo_id, snapshot_hash) index could never fire.
  it('does not add a second snapshot when the content is unchanged', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();
    const firstHash = graphRepo.getLatestSnapshot(repoId())?.snapshotHash;

    // A fresh cache window (no in-flight promise, no cache hit) forces a real second build.
    deps.setScanInFlight(workspace, null);
    deps.getScanCache().clear();
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(graphRepo.countSnapshots(repoId())).toBe(1);
    expect(graphRepo.getLatestSnapshot(repoId())?.snapshotHash).toBe(firstHash);
  });

  // The UNIQUE index alone would also absorb a duplicate write, so count alone cannot prove the
  // short-circuit works. Spy on saveSnapshot to assert the redundant write never happens at all.
  it('skips the repository write entirely when the fingerprint is unchanged', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    const saveSpy = vi.spyOn(graphRepo, 'saveSnapshot');
    deps.setScanInFlight(workspace, null);
    deps.getScanCache().clear();
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(graphRepo.countSnapshots(repoId())).toBe(1);
    saveSpy.mockRestore();
  });

  it('writes the snapshot again when the fingerprint changed', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    const saveSpy = vi.spyOn(graphRepo, 'saveSnapshot');
    vi.mocked(fetchMergedGraph).mockResolvedValue(
      makeScopedGraphData([makeNode('a', 'alpha', 'function', 'src/a.ts', 1)], []),
    );
    deps.setScanInFlight(workspace, null);
    deps.getScanCache().clear();
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0]![0]).toBe(repoId());
    expect(saveSpy.mock.calls[0]![1]).toMatch(/^v\d+:[0-9a-f]{16}$/);
    saveSpy.mockRestore();
  });

  it('stores a new snapshot when the graph content changed', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();
    const firstHash = graphRepo.getLatestSnapshot(repoId())?.snapshotHash;

    vi.mocked(fetchMergedGraph).mockResolvedValue(
      makeScopedGraphData([makeNode('a', 'alpha', 'function', 'src/a.ts', 1)], []),
    );
    deps.setScanInFlight(workspace, null);
    deps.getScanCache().clear();
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    const latest = graphRepo.getLatestSnapshot(repoId());
    expect(latest?.snapshotHash).not.toBe(firstHash);
    expect(latest?.nodeCount).toBe(1);
  });

  it('ignores a changed metadata.timestamp when the content is identical', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(
      makeScopedGraphData([makeNode('a', 'alpha', 'function', 'src/a.ts', 1)], [], 'test-repo', 111),
    );
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();
    const firstHash = graphRepo.getLatestSnapshot(repoId())?.snapshotHash;

    vi.mocked(fetchMergedGraph).mockResolvedValue(
      makeScopedGraphData([makeNode('a', 'alpha', 'function', 'src/a.ts', 1)], [], 'test-repo', 999_999),
    );
    deps.setScanInFlight(workspace, null);
    deps.getScanCache().clear();
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(graphRepo.countSnapshots(repoId())).toBe(1);
    expect(graphRepo.getLatestSnapshot(repoId())?.snapshotHash).toBe(firstHash);
  });

  it('emits the fingerprint on both graph events', async () => {
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    const emitted = ctx.emit.mock.calls.map(([name]) => name);
    expect(emitted).toContain('codegraph-visualizer/graph/updated');
    expect(emitted).toContain('codegraph-visualizer/graph/data');
    const updated = ctx.emit.mock.calls.find(([name]) => name === 'codegraph-visualizer/graph/updated')?.[1];
    const data = ctx.emit.mock.calls.find(([name]) => name === 'codegraph-visualizer/graph/data')?.[1];
    expect((updated as { fingerprint: string }).fingerprint).toMatch(/^v\d+:[0-9a-f]{16}$/);
    expect((data as { fingerprint: string }).fingerprint).toBe((updated as { fingerprint: string }).fingerprint);
    expect((updated as { fingerprint: string }).fingerprint).toBe(
      graphRepo.getLatestSnapshot(repoId())?.snapshotHash,
    );
  });

  it('keeps at most FINGERPRINT.SNAPSHOT_KEEP distinct snapshots per repo', async () => {
    for (let i = 0; i < FINGERPRINT.SNAPSHOT_KEEP + 2; i++) {
      vi.mocked(fetchMergedGraph).mockResolvedValue(
        makeScopedGraphData([makeNode('a', 'alpha', 'function', `src/a${i}.ts`, 1)], []),
      );
      deps.setScanInFlight(workspace, null);
      deps.getScanCache().clear();
      triggerBackgroundBuild(deps, vi.fn() as never, workspace);
      await settle();
    }

    expect(graphRepo.countSnapshots(repoId())).toBe(FINGERPRINT.SNAPSHOT_KEEP);
  });

  it('still builds and emits when no repository is wired', async () => {
    deps.graphRepo = undefined;
    triggerBackgroundBuild(deps, vi.fn() as never, workspace);
    await settle();

    expect(ctx.emit.mock.calls.map(([name]) => name)).toContain('codegraph-visualizer/graph/data');
  });
});

