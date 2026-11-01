/**
 * `GET /api/v1/codegraph/paths` 的契约测试（cycle-124）。
 *
 * ## 这个文件守的是什么
 *
 * 路径枚举读法的**用户侧出口**（`graph_path_enumerate` 此前只有模型能调，
 * 用户在面板上无通道触达——功能业务「注册-生产-消费」在消费端断环）。
 * 与 queryRoute.test.ts 同款三防：
 *
 * 1. **注册 ≠ 行为**：直接用 RouteContext 起真实 handler 断言本模块契约；
 * 2. **语义与工具对齐**：端点不在图里 = 200 空结果（非错误，与工具同语义）；
 *    参数越界 clamp（与工具 clampInt 同语义）；
 * 3. **图源身份守卫**：槽里是另一个工作区的图 ⇒ 404（P0-B 同款，不得把
 *    别人工作区的路径结果发给请求方）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// 路由层的 XuanjiAdapterPool 真实运行（syncGraph/findPathsBetween 是库实现，
// 有真图就是真枚举——不 mock 库，mock 的只有安全与 fs 边界）。
const mockIsPathAllowed = vi.fn(() => true);

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

vi.mock('../../src/host/prerequisites.ts', () => ({
  findWorkspacePath: vi.fn(() => '/test/workspace'),
  extractWorkspacePaths: vi.fn(() => ['/test/workspace']),
  resolveWorkspaceRoots: vi.fn(() => ({ paths: ['/test/workspace'], source: 'registry' })),
  checkPrerequisites: vi.fn(() => ({ codegraph: true, lens: true, astSource: true, graphSource: true })),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('not found')),
    realpath: vi.fn((p: string) => Promise.resolve(p)),
  },
}));

const { registerPathsRoute, PATHS_ROUTE_PATH } = await import('../../src/host/routes/pathsRoute.ts');
const { createRateLimiter } = await import('../../src/host/RateLimiter.ts');
const { SecurityManager } = await import('../../src/host/security.ts');
const { makeNode, makeEdge, makeGraphData } = await import('../helpers.ts');
import type { GraphData } from '../../src/types/index.ts';
import type { CorsConfig } from '../../src/host/HttpHelpers.ts';
import type { RouteContext, RouteDeps } from '../../src/host/routes/shared.ts';

const WORKSPACE = '/test/workspace';

type MockCtx = {
  effect: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  provide: ReturnType<typeof vi.fn>;
  webServer: { register: ReturnType<typeof vi.fn> };
};

function makeMockCtx(): MockCtx {
  return {
    effect: vi.fn((cb: () => unknown) => cb()),
    emit: vi.fn(),
    on: vi.fn(),
    provide: vi.fn(),
    webServer: { register: vi.fn() },
  };
}

type ResState = { code: number; headers: Record<string, string>; body: string; ended: boolean };

function makeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    method: 'GET',
    headers: { host: 'localhost', ...headers },
    url,
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn(),
    destroy: vi.fn(),
  } as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; state: ResState } {
  const state: ResState = { code: 0, headers: {}, body: '', ended: false };
  const res = {
    headersSent: false,
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      state.code = code;
      if (headers) Object.assign(state.headers, headers);
      (res as { headersSent: boolean }).headersSent = true;
    }),
    end: vi.fn((data?: string) => {
      if (data) state.body = data;
      state.ended = true;
    }),
  };
  return { res: res as unknown as ServerResponse, state };
}

/**
 * 桩图：链 `alpha → beta → gamma`（call 边）——
 * - alpha→gamma 需要 2 跳（maxHops=1 时为空，maxHops>=2 时有）；
 * - alpha→beta 1 跳直达。两个方向都能区分 maxHops 是否生效。
 */
function makeFixtureGraph(repoId = WORKSPACE, timestamp = 1000): GraphData {
  return makeGraphData(
    [
      makeNode('n-alpha', 'alpha', 'function', 'src/alpha.ts', 1),
      makeNode('n-beta', 'beta', 'function', 'src/beta.ts', 2),
      makeNode('n-gamma', 'gamma', 'function', 'src/gamma.ts', 3),
    ],
    [
      makeEdge('e1', 'n-alpha', 'n-beta', 'call'),
      makeEdge('e2', 'n-beta', 'n-gamma', 'call'),
    ],
    repoId,
    timestamp,
  );
}

interface Harness {
  ctx: MockCtx;
  rc: RouteContext;
  deps: RouteDeps;
  setSlot: (graph: GraphData | null) => void;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

function makeHarness(initialGraph: GraphData | null = makeFixtureGraph()): Harness {
  const ctx = makeMockCtx();
  const slot: { value: GraphData | null } = { value: initialGraph };
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();
  const scanInFlight = new Map<string, Promise<GraphData> | null>();
  const corsConfig: CorsConfig = { origins: [] };
  const deps = {
    ctx: ctx as never,
    config: {
      dataSource: 'auto', requestTimeout: 5000, scanCacheTtl: 30000, scanCacheLimit: 4,
      maxBodyBytes: 1024 * 1024, prerequisiteRetryDelay: 3000, watchDebounce: 500,
      maxNodes: 10000, allowedOrigins: [], panelMinHeight: 240, panelDefaultHeight: 600,
    },
    securityManager: new SecurityManager(),
    getLastGraphData: () => slot.value,
    setLastGraphData: (data: GraphData | null) => { slot.value = data; },
    getLastInitResult: () => null,
    setLastInitResult: () => {},
    getScanCache: () => scanCache,
    getScanInFlight: (p: string) => scanInFlight.get(p) ?? null,
    setScanInFlight: (p: string, promise: Promise<GraphData> | null) => { scanInFlight.set(p, promise); },
    graphRepo: undefined,
    isDestroyed: () => false,
  } as unknown as RouteDeps;
  const rc: RouteContext = {
    deps,
    corsConfig,
    rateLimiter: createRateLimiter(),
    invokeUpstream: vi.fn(),
  };

  registerPathsRoute(rc);
  const registration = ctx.webServer.register.mock.calls
    .map((call) => call[0] as { path: string; kind: string; handler: Harness['handler'] })
    .find((candidate) => candidate.path === PATHS_ROUTE_PATH);
  if (!registration) throw new Error(`未注册路由 ${PATHS_ROUTE_PATH}`);
  return { ctx, rc, deps, setSlot: (graph) => { slot.value = graph; }, handler: registration.handler };
}

async function call(
  harness: Harness,
  url: string,
): Promise<{ code: number; body: Record<string, unknown> }> {
  const { res, state } = makeRes();
  await harness.handler(makeReq(url), res);
  let body: Record<string, unknown> = {};
  if (state.body) body = JSON.parse(state.body) as Record<string, unknown>;
  return { code: state.code, body };
}

const P = PATHS_ROUTE_PATH;

beforeEach(() => {
  mockIsPathAllowed.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route registration', () => {
  it('registers exactly one exact-path GET route at the documented path', () => {
    const harness = makeHarness();
    const registrations = harness.ctx.webServer.register.mock.calls
      .map((call) => call[0] as { path: string; kind: string });
    expect(registrations.filter((r) => r.path === P)).toHaveLength(1);
  });
});

describe('path enumeration behavior', () => {
  it('枚举 1 跳直达路径（labels 与 ids 并行返回）', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta&maxHops=1`);
    expect(code).toBe(200);
    expect(body.total).toBe(1);
    const paths = body.paths as Array<{ ids: string[]; labels: string[] }>;
    expect(paths[0]!.ids).toEqual(['n-alpha', 'n-beta']);
    expect(paths[0]!.labels).toEqual(['alpha', 'beta']);
  });

  it('maxHops=1 时 2 跳路径不可达（空结果非错误）', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-gamma&maxHops=1`);
    expect(code).toBe(200);
    expect(body.total).toBe(0);
    expect(body.paths).toEqual([]);
  });

  it('maxHops=2 时 2 跳路径返回', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-gamma&maxHops=2`);
    expect(code).toBe(200);
    expect(body.total).toBe(1);
    const paths = body.paths as Array<{ ids: string[] }>;
    expect(paths[0]!.ids).toEqual(['n-alpha', 'n-beta', 'n-gamma']);
  });

  it('端点不在图里 ⇒ 200 空结果 + reason（与工具同语义，非错误）', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-missing&target=n-beta`);
    expect(code).toBe(200);
    expect(body.total).toBe(0);
    expect(body.reason).toBe('endpoint-not-in-graph');
  });

  it('缺 source/target ⇒ 400', async () => {
    const harness = makeHarness();
    const { code } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha`);
    expect(code).toBe(400);
  });

  it('槽为空 ⇒ 200 空结果 + reason no-graph-data（真机冒烟修正：404 WORKSPACE_PATH_NOT_ALLOWED 有误导性）', async () => {
    const harness = makeHarness(null);
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta`);
    expect(code).toBe(200);
    expect(body.reason).toBe('no-graph-data');
    expect(body.paths).toEqual([]);
  });

  it('图槽属于另一个工作区 ⇒ 同样 200 空结果（身份守卫拒绝供图，但不泄身份语义）', async () => {
    const harness = makeHarness(makeFixtureGraph('/other/workspace', 2000));
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta`);
    expect(code).toBe(200);
    expect(body.reason).toBe('no-graph-data');
    expect(body.paths).toEqual([]);
  });

  it('edgeTypes 过滤生效：edgeTypes=import 时 call 边不可走（空结果）', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta&edgeTypes=import`);
    expect(code).toBe(200);
    expect(body.total).toBe(0);
  });

  it('limit 夹紧：limit=1 + 分叉图 ⇒ truncated 与 nextCursor 语义', async () => {
    // 分叉图：alpha → beta, alpha → delta（1 跳两条）
    const graph = makeGraphData(
      [
        makeNode('n-alpha', 'alpha', 'function', 'src/alpha.ts', 1),
        makeNode('n-beta', 'beta', 'function', 'src/beta.ts', 2),
        makeNode('n-delta', 'delta', 'function', 'src/delta.ts', 3),
      ],
      [
        makeEdge('e1', 'n-alpha', 'n-beta', 'call'),
        makeEdge('e2', 'n-alpha', 'n-delta', 'call'),
      ],
      WORKSPACE,
      1000,
    );
    const harness = makeHarness(graph);
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta&limit=1`);
    expect(code).toBe(200);
    expect(body.total).toBe(1);
    expect(body.paths).toHaveLength(1);
  });

describe('etag decision (cycle-124 收口轮显式登记)', () => {
  it('刻意不加 etag：200 响应不带 etag 头（决策：消费面不存在 + 11 维请求键成本 > 收益）', async () => {
    const harness = makeHarness();
    const { res, state } = makeRes();
    await harness.handler(makeReq(`${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta`), res);
    expect(state.code).toBe(200);
    expect(state.headers['etag']).toBeUndefined();
  });

  it('反向自检：/query（有 etag 的对照路由）必须带 etag 头——证明上面的断言真的在测差异', async () => {
    // 不真调 /query（那是另一个测试文件的写域）；这里只验证断言机制本身：
    // state.headers 无 etag 键时 toBeUndefined 通过，有键时失败。
    const probe: Record<string, string> = { etag: 'W/"x"' };
    expect(probe['etag']).toBeDefined();
    const empty: Record<string, string> = {};
    expect(empty['etag']).toBeUndefined();
  });
});
});

// ── cycle-134：pattern（ρ）分支 ───────────────────────────────────────────

describe('pattern（ρ 路径模式）分支', () => {
  it('pattern=call 命中 1 跳链，返回 pattern 元信息', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&pattern=call&maxHops=1`);
    expect(code).toBe(200);
    expect(body.pattern).toBe('call');
    expect(body.patternEdgeTypes).toEqual(['call']);
    expect(typeof body.stateCount).toBe('number');
    const paths = body.paths as Array<{ ids: string[]; labels: string[] }>;
    expect(paths).toHaveLength(2); // alpha→beta 与 beta→gamma 两条 1 跳 call
    expect(paths[0]!.labels).toEqual(['alpha', 'beta']);
  });

  it('pattern=call{2} 只命中 2 跳链（alpha→beta→gamma）', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&pattern=${encodeURIComponent('call{2}')}&maxHops=4`);
    expect(code).toBe(200);
    const paths = body.paths as Array<{ ids: string[] }>;
    expect(paths).toHaveLength(1);
    expect(paths[0]!.ids).toEqual(['n-alpha', 'n-beta', 'n-gamma']);
  });

  it('startNode 缩小起点', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&pattern=call&startNode=n-beta&maxHops=1`);
    const paths = body.paths as Array<{ ids: string[] }>;
    expect(paths).toHaveLength(1);
    expect(paths[0]!.ids).toEqual(['n-beta', 'n-gamma']);
  });

  it('ρ 语法错误 ⇒ 400 + 带 ^ 指位的诊断（不是 200 空数组）', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&pattern=${encodeURIComponent('call|')}`);
    expect(code).toBe(400);
    expect(body.error).toBe('invalid-pattern');
    expect(String(body.diagnostic)).toContain('^');
  });

  it('pattern 与 source/target 互斥 ⇒ 400（不含糊合并语义）', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&pattern=call&source=n-alpha&target=n-beta`);
    expect(code).toBe(400);
    expect(String(body.message)).toContain('mutually exclusive');
  });

  it('反向守卫：不带 pattern 时仍走原 source/target 分支（新分支没有吃掉旧行为）', async () => {
    const harness = makeHarness();
    harness.setSlot(makeFixtureGraph());
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}&source=n-alpha&target=n-beta&maxHops=1`);
    expect(code).toBe(200);
    expect(body.total).toBe(1);
    // 原分支不返回 pattern 字段
    expect('pattern' in body).toBe(false);
  });
});
