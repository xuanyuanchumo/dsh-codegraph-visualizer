/**
 * `GET /api/v1/codegraph/views` 的契约测试（cycle-141 / workstream E）。
 *
 * ## 这个文件守的是什么
 *
 * Π 视图划分此前只有 `graph_views` 工具能调（模型侧），用户在界面上无通道触达。
 * 本路由是它的用户侧出口，测试守四条**路由层**契约（与 `pathsRoute.test.ts` 同款三防）：
 *
 * 1. **注册 ≠ 行为**：直接用 RouteContext 起真实 handler 断言本模块契约，而不是只数注册次数；
 * 2. **降级必须显式**：没有 `commitLog` / `blameLog` 时，时序/所有权视图回
 *    `available:false` + `reason`，绝不静默补全成「结构视图」；
 * 3. **没有索引必须说「没有」**：内存槽空且索引 DB 不存在 ⇒ HTTP 200
 *    `{ success:false, errorCode:'INDEX_NOT_FOUND' }`（与 `manage/metrics` 同口径，
 *    不能报一份假的空 Π）；
 * 4. **跨工作区身份守卫**：槽里是另一个工作区的图 ⇒ 同样 `INDEX_NOT_FOUND`
 *    （P0-B 同款：不得把别人工作区的视图划分发给请求方）。
 *
 * 另外守采样契约：超过 500 节点时矩阵被截断且 `sampled:true` + `totalNodes` 如实披露。
 *
 * ## 为什么用 `String.fromCharCode` 构造 commitLog
 *
 * `git log --format=%x1e%H%x1f%ct` 的分隔符是**控制字符** 0x1E / 0x1F。直接写字面量
 * 转义（`'\\x1e'`）在不同编辑器/传输层会被解释成 4 个 ASCII 字符，导致
 * `parseCommitLog` 落空、时序视图静默变成 0——这正是本文件要防的「看起来传了、其实没解析」
 * 形态。用 `String.fromCharCode` 把码点钉死，不受任何转义层影响。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

const { registerViewsRoute, VIEWS_ROUTE_PATH, VIEWS_MATRIX_MAX_NODES } = await import('../../src/host/routes/viewsRoute.ts');
const { createRateLimiter } = await import('../../src/host/RateLimiter.ts');
const { SecurityManager } = await import('../../src/host/security.ts');
const { makeNode, makeEdge, makeGraphData } = await import('../helpers.ts');
import type { GraphData } from '../../src/types/index.ts';
import type { CorsConfig } from '../../src/host/HttpHelpers.ts';
import type { RouteContext, RouteDeps } from '../../src/host/routes/shared.ts';

const WORKSPACE = '/test/workspace';

/** `git log --format=%x1e%H%x1f%ct` 的分隔符（控制字符，见文件头注）。 */
const SEP = String.fromCharCode(0x1e);
const FIELD = String.fromCharCode(0x1f);
const NL = String.fromCharCode(10);

/** 构造一段合法的 commitLog：两个提交分别触及 alpha 与 beta。
 * 段间分隔符是「换行 + 0x1E」（`git log --format=%x1e` 的每段以换行结尾），
 * 段首不得有多余换行——否则第二个提交的头部会变成空行而被 `parseCommitLog` 跳过。 */
function makeCommitLog(): string {
  return 'abc1234' + FIELD + '1000' + NL + 'src/alpha.ts' + NL + SEP
    + 'def5678' + FIELD + '2000' + NL + 'src/beta.ts' + NL;
}

/** 构造一段合法的 `git blame --porcelain`（头部 + author + filename + 空行 + 行内容）。 */
function makeBlameLog(filename: string): string {
  return [
    '1111111 1 1 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 123',
    'author-tz +0000',
    'filename ' + filename,
    '',
    'content of line 1',
  ].join(NL);
}

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

/** 桩图：链 `alpha → beta → gamma`，三个文件分别用于时序/所有权/领域的可区分性。 */
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

  registerViewsRoute(rc);
  const registration = ctx.webServer.register.mock.calls
    .map((call) => call[0] as { path: string; kind: string; handler: Harness['handler'] })
    .find((candidate) => candidate.path === VIEWS_ROUTE_PATH);
  if (!registration) throw new Error(`未注册路由 ${VIEWS_ROUTE_PATH}`);
  return { ctx, deps, setSlot: (graph) => { slot.value = graph; }, handler: registration.handler };
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

const P = VIEWS_ROUTE_PATH;

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
    expect(registrations.find((r) => r.path === P)?.kind).toBe('exact');
  });
});

describe('GET /views: 无索引', () => {
  it('内存槽空且索引 DB 不存在 ⇒ 200 success:false + INDEX_NOT_FOUND', async () => {
    const harness = makeHarness(null);
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}`);
    expect(code).toBe(200);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('INDEX_NOT_FOUND');
    expect(body.views).toBeNull();
  });

  it('槽属于另一个工作区 ⇒ 同样 INDEX_NOT_FOUND（身份守卫拒绝供图）', async () => {
    const harness = makeHarness(makeFixtureGraph('/other/workspace', 2000));
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}`);
    expect(code).toBe(200);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('INDEX_NOT_FOUND');
  });
});

describe('GET /views: 结构视图恒属 + 显式降级', () => {
  it('没有 commitLog/blameLog 时：结构视图覆盖全图，时序/所有权显式降级', async () => {
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}`);
    expect(code).toBe(200);
    expect(body.success).toBe(true);

    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.structural).toEqual({ nodeCount: 3, edgeCount: 2 });
    expect(views.temporal).toMatchObject({ nodeCount: 0, available: false });
    expect(views.temporal!.reason).toBeTruthy();
    expect(views.ownership).toMatchObject({ nodeCount: 0, available: false });
    expect(views.ownership!.reason).toBeTruthy();

    // 每个采样节点都至少属于结构视图（Π 的基图恒属）。
    const matrix = body.nodeViewMatrix as Array<{ id: string; label: string; views: string[] }>;
    expect(matrix).toHaveLength(3);
    for (const row of matrix) {
      expect(row.views).toContain('structural');
    }
    expect(body.totalNodes).toBe(3);
    expect(body.totalEdges).toBe(2);
    expect(body.sampled).toBe(false);
  });

  it('带 commitLog：被触及文件的节点标为时序视图', async () => {
    const harness = makeHarness();
    const { code, body } = await call(
      harness,
      `${P}?workspace=${encodeURIComponent(WORKSPACE)}&commitLog=${encodeURIComponent(makeCommitLog())}`,
    );
    expect(code).toBe(200);
    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.temporal).toMatchObject({ nodeCount: 2, available: true, reason: null });

    const matrix = body.nodeViewMatrix as Array<{ id: string; views: string[] }>;
    const alpha = matrix.find((r) => r.id === 'n-alpha')!;
    const gamma = matrix.find((r) => r.id === 'n-gamma')!;
    expect(alpha.views).toContain('temporal');
    expect(gamma.views).not.toContain('temporal');
  });

  it('带 blameLog：有 blame 记录的节点标为所有权视图', async () => {
    const harness = makeHarness();
    const { code, body } = await call(
      harness,
      `${P}?workspace=${encodeURIComponent(WORKSPACE)}&blameLog=${encodeURIComponent(makeBlameLog('src/alpha.ts'))}`,
    );
    expect(code).toBe(200);
    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.ownership).toMatchObject({ nodeCount: 1, available: true, reason: null });

    const matrix = body.nodeViewMatrix as Array<{ id: string; views: string[] }>;
    const alpha = matrix.find((r) => r.id === 'n-alpha')!;
    expect(alpha.views).toContain('ownership');
  });
});

describe('GET /views: 宿主自动采集（cycle-144）', () => {
  it('无显式传参时自动采集：非 git 工作区降级原因变为采集器的可读文本，且 gitSources 披露 source=auto', async () => {
    // WORKSPACE=/test/workspace 不是 git 仓库 —— 采集器 available:false，
    // 路由继续走诚实降级，但 reason 不再是「未提供 commitLog」而是采集器的真实原因。
    const harness = makeHarness();
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}`);
    expect(code).toBe(200);
    expect(body.success).toBe(true);

    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.temporal).toMatchObject({ available: false });
    expect(views.ownership).toMatchObject({ available: false });
    // 降级原因来自采集器（不再是无采集时的「未提供」）——auto 采集真实发生了。
    expect(String(views.temporal!.reason)).not.toContain('未提供');
    expect(String(views.ownership!.reason)).not.toContain('未提供');

    // gitSources 白盒披露：两条通道都是 auto 来源且不可用（非 git 目录）。
    const gs = body.gitSources as Record<string, Record<string, unknown>>;
    expect(gs.commitLog).toMatchObject({ source: 'auto', available: false });
    expect(gs.blameLog).toMatchObject({ source: 'auto', available: false });
    expect(gs.commitLog!.reason).toBeTruthy();
  });

  it('显式传参优先：查询串给了 commitLog 时不触发采集（source=query）', async () => {
    const harness = makeHarness();
    const { code, body } = await call(
      harness,
      `${P}?workspace=${encodeURIComponent(WORKSPACE)}&commitLog=${encodeURIComponent(makeCommitLog())}`,
    );
    expect(code).toBe(200);
    const views = body.views as Record<string, Record<string, unknown>>;
    // 显式输入生效：时序视图可用（与 cycle-141 契约一致）。
    expect(views.temporal).toMatchObject({ available: true, reason: null });
    // blameLog 未传 → 自动采集（非 git 目录 → 不可用）；commitLog 走 query。
    const gs = body.gitSources as Record<string, Record<string, unknown>>;
    expect(gs.commitLog).toMatchObject({ source: 'query', available: true });
    expect(gs.blameLog).toMatchObject({ source: 'auto', available: false });
  });

  it('部分显式：只给 blameLog 时 commitLog 走 auto，两者互不干扰', async () => {
    const harness = makeHarness();
    const { code, body } = await call(
      harness,
      `${P}?workspace=${encodeURIComponent(WORKSPACE)}&blameLog=${encodeURIComponent(makeBlameLog('src/alpha.ts'))}`,
    );
    expect(code).toBe(200);
    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.ownership).toMatchObject({ available: true });
    const gs = body.gitSources as Record<string, Record<string, unknown>>;
    expect(gs.blameLog).toMatchObject({ source: 'query', available: true });
    expect(gs.commitLog).toMatchObject({ source: 'auto', available: false });
  });
});

describe('GET /views: 领域视图（Louvain）', () => {
  it('全量用例：四视图齐备，领域分解按社区给出节点计数', async () => {
    const harness = makeHarness();
    const { code, body } = await call(
      harness,
      `${P}?workspace=${encodeURIComponent(WORKSPACE)}` +
        `&commitLog=${encodeURIComponent(makeCommitLog())}` +
        `&blameLog=${encodeURIComponent(makeBlameLog('src/alpha.ts'))}`,
    );
    expect(code).toBe(200);
    expect(body.success).toBe(true);

    const views = body.views as Record<string, Record<string, unknown>>;
    expect(views.structural).toMatchObject({ nodeCount: 3, edgeCount: 2 });
    expect(views.temporal).toMatchObject({ nodeCount: 2, available: true, reason: null });
    expect(views.ownership).toMatchObject({ nodeCount: 1, available: true, reason: null });
    expect(views.domain).toHaveProperty('domainCount');
    expect(views.domain).toHaveProperty('nodeCounts');

    // 领域节点计数之和 = 全图节点数（每个节点恰好属于一个社区）。
    const nodeCounts = views.domain!.nodeCounts as Record<string, number>;
    const sum = Object.values(nodeCounts).reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(3);
  });
});

describe('GET /views: 采样截断', () => {
  it('超过矩阵上限时采样并如实披露 sampled + totalNodes', async () => {
    // 501 个节点：比上限多 1，足以触发采样。
    const nodes = [];
    for (let i = 0; i < VIEWS_MATRIX_MAX_NODES + 1; i += 1) {
      nodes.push(makeNode(`n-${i}`, `node-${i}`, 'function', `src/f${i}.ts`, 1));
    }
    const edges = [
      makeEdge('e0', 'n-0', 'n-1', 'call'),
      makeEdge('e1', 'n-1', 'n-2', 'call'),
    ];
    const graph = makeGraphData(nodes, edges, WORKSPACE, 1000);
    const harness = makeHarness(graph);
    const { code, body } = await call(harness, `${P}?workspace=${encodeURIComponent(WORKSPACE)}`);
    expect(code).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sampled).toBe(true);
    expect(body.totalNodes).toBe(VIEWS_MATRIX_MAX_NODES + 1);
    const matrix = body.nodeViewMatrix as unknown[];
    expect(matrix).toHaveLength(VIEWS_MATRIX_MAX_NODES);
  });
});
