/**
 * `GET /api/v1/codegraph/query` 的契约测试（cycle-111 / N-5）。
 *
 * ## 这个文件守的是什么
 *
 * 宿主路由与它的用例之间最容易出现三种「看起来没问题」的脱节，本文件逐条钉住：
 *
 * 1. **注册了但没人验证**：`registerKeywordQueryRoute` 被 `routes.ts` 调用之后，
 *    「路由存在」与「路由行为正确」是两件事。本文件直接用 `RouteContext` 起一条真实
 *    handler，不经过 `registerRoutes`——这样断言的是**本模块**的契约，
 *    而不是「第 N 个注册项恰好是它」这种随注册顺序漂移的定位。
 *
 * 2. **校验器是死代码**（P3-R18-02 的原始形态）：五条按需路由曾经都能回 304，
 *    但 200 响应从不回写 `etag`，客户端手里永远没有可回传的值。所以这里对
 *    *同一次响应* 连做三条互斥断言：200 **带** etag → 回放该值得 304 → 篡改一位得 200。
 *    只测前两条的话，「200 从不带 etag」仍然全绿。
 *
 * 3. **校验器的身份维度缺一维 ⇒ 假 304**（P0-R16-02 家族）：`/query` 的载荷由
 *    `工作区 + q + depth + tokenBudget + 图 revision` 共同决定。任一维缺失，
 *    两个不同请求就会共用一个校验值，第二个请求收到 304 并**永久显示第一个的答案**。
 *    这里对每一维各给一条负例（换值 ⇒ 校验值必须不同），并额外用一条**正例**
 *    钉住 `depth` 的归一化方向（4 与 5 都被库钳到 3 ⇒ 载荷逐字节相同 ⇒ 校验值必须相同）：
 *    没有这条正例，「把 depth 从哈希里删掉」也能让所有负例变绿。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// 取图层：`/query` 在槽为空时回源到 `fetchMergedGraph`（与 `graph_query` 工具同一通道）。
// 真实实现会去 fork 上游工具，测试里必须替换；`createInvoke` 一并给出，
// 因为 `shared.ts` 顶层 `import { createInvoke }` 会求值它。
const mockFetchMergedGraph = vi.fn();
vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: (...args: unknown[]) => mockFetchMergedGraph(...args),
  createInvoke: vi.fn(() => vi.fn()),
}));

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
  checkPrerequisites: vi.fn(() => ({ codegraph: true, lens: true, builtin: true })),
}));

// `validateWorkspacePath` 会走 `validatePathRealpath`（真实 fs.realpath）。
// 测试里不碰磁盘：`realpath` 恒等返回，允许列表由 security 的 mock 决定。
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('not found')),
    realpath: vi.fn((p: string) => Promise.resolve(p)),
  },
}));

const {
  registerKeywordQueryRoute,
  computeQueryEtag,
  extractSubgraphFromText,
  QUERY,
} = await import('../../src/host/routes/queryRoute.ts');
const { renderSubgraphText, selectSeeds, tokenizeQuery } = await import('../../src/xuanji/query/keyword-query.ts');
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
 * 桩图：**必须**让关键词能命中，否则「200 + seeds 非空」的断言会变成
 * 「200 + 空结果」也能过。
 *
 * 刻意做成一条链 `alpha → beta → gamma`，并有 `alpha → delta` 的分叉：
 * - depth=0 只出 alpha；depth=1 出 alpha+beta+delta；depth=2 才出 gamma。
 *   于是「depth 真的生效」与「depth 被钳制」都能被同一张图区分。
 */
function makeFixtureGraph(repoId = WORKSPACE, timestamp = 1000): GraphData {
  return makeGraphData(
    [
      makeNode('n-alpha', 'alpha', 'function', 'src/alpha.ts', 1),
      makeNode('n-beta', 'beta', 'function', 'src/beta.ts', 2),
      makeNode('n-gamma', 'gamma', 'function', 'src/gamma.ts', 3),
      makeNode('n-delta', 'delta', 'function', 'src/delta.ts', 4),
      makeNode('n-unrelated', 'unrelatedSymbol', 'function', 'src/other.ts', 5),
    ],
    [
      makeEdge('e1', 'n-alpha', 'n-beta', 'call'),
      makeEdge('e2', 'n-beta', 'n-gamma', 'call'),
      makeEdge('e3', 'n-alpha', 'n-delta', 'call'),
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

  registerKeywordQueryRoute(rc);
  // 按**路径**定位，不按索引：`registerRoutes` 的注册顺序会被后续任何一条新路由推翻，
  // 索引断言是"下一轮任何人加路由就打红"的脆弱形态（Lead 明确要求）。
  const registration = ctx.webServer.register.mock.calls
    .map((call) => call[0] as { path: string; kind: string; handler: Harness['handler'] })
    .find((candidate) => candidate.path === QUERY.ROUTE_PATH);
  if (!registration) throw new Error(`未注册路由 ${QUERY.ROUTE_PATH}`);
  return { ctx, rc, deps, setSlot: (graph) => { slot.value = graph; }, handler: registration.handler };
}

/** 发一次请求，返回状态码 / 头 / 解析后的 body。 */
async function call(
  harness: Harness,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ code: number; etag: string | undefined; body: Record<string, unknown>; raw: ResState }> {
  const { res, state } = makeRes();
  await harness.handler(makeReq(url, headers), res);
  let body: Record<string, unknown> = {};
  if (state.body) body = JSON.parse(state.body) as Record<string, unknown>;
  return { code: state.code, etag: state.headers['etag'], body, raw: state };
}

const q = (params: Record<string, string | number>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `${QUERY.ROUTE_PATH}?${search.toString()}`;
};

beforeEach(() => {
  mockFetchMergedGraph.mockReset();
  mockFetchMergedGraph.mockResolvedValue(makeFixtureGraph());
  mockIsPathAllowed.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route registration', () => {
  it('registers exactly one exact-path GET route at the documented path', () => {
    const harness = makeHarness();
    // 按路径断言（不是索引）：`registerRoutes` 里的注册顺序会被下一轮任何新路由推翻，
    // 而索引断言是"别人加一条路由就打红"的脆弱形态。这里的 `registerKeywordQueryRoute`
    // 只注册一条，所以 `toHaveBeenCalledTimes(1)` 断言的是**本模块**的行为，不涉全局顺序。
    expect(harness.ctx.webServer.register).toHaveBeenCalledTimes(1);
    const registration = harness.ctx.webServer.register.mock.calls[0]![0] as { kind: string; path: string };
    expect(registration.kind).toBe('exact');
    expect(registration.path).toBe('/api/v1/codegraph/query');
    // 反向自检：换一个路径必须找不到——证明上面的定位真的按路径匹配，而不是"总能找到"。
    expect(
      harness.ctx.webServer.register.mock.calls
        .map((call) => (call[0] as { path: string }).path)
        .includes('/api/v1/codegraph/queries'),
    ).toBe(false);
  });

  it('declares its route path through the exported QUERY constants (single source)', () => {
    expect(QUERY.ROUTE_PATH).toBe('/api/v1/codegraph/query');
    // 边界自洽：契约要求 q 上限 ≤ 512；跳数与预算的上下界必须同向。
    expect(QUERY.MAX_QUERY_LENGTH).toBeLessThanOrEqual(512);
    expect(QUERY.MIN_DEPTH).toBeLessThanOrEqual(QUERY.DEFAULT_DEPTH);
    expect(QUERY.DEFAULT_DEPTH).toBeLessThanOrEqual(QUERY.MAX_DEPTH);
    expect(QUERY.MIN_TOKEN_BUDGET).toBeLessThan(QUERY.DEFAULT_TOKEN_BUDGET);
    expect(QUERY.DEFAULT_TOKEN_BUDGET).toBeLessThan(QUERY.MAX_TOKEN_BUDGET);
    // 库的跳数上限被镜像在 route 里；镜像值超过请求上界就永远走不到，属于死常量。
    expect(QUERY.LIBRARY_MAX_DEPTH).toBeLessThanOrEqual(QUERY.MAX_DEPTH);
  });
});

describe('parameter validation', () => {
  let harness: Harness;
  beforeEach(() => { harness = makeHarness(); });

  it('rejects a missing q with 400 and never queries the graph', async () => {
    const result = await call(harness, QUERY.ROUTE_PATH);
    expect(result.code).toBe(400);
    expect(result.body.error).toBe('FILEPATH_REQUIRED');
    // 参数非法时连图都不该取：一次注定被拒绝的请求去 fork 上游只是浪费。
    expect(mockFetchMergedGraph).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only q (trim before the emptiness check)', async () => {
    const result = await call(harness, q({ q: '   ' }));
    expect(result.code).toBe(400);
  });

  it('rejects a q longer than MAX_QUERY_LENGTH', async () => {
    const result = await call(harness, q({ q: 'a'.repeat(QUERY.MAX_QUERY_LENGTH + 1) }));
    expect(result.code).toBe(400);
    expect(result.body.error).toBe('CONTENT_TOO_LARGE');
  });

  it('accepts a q of exactly MAX_QUERY_LENGTH characters', async () => {
    // 边界必须从两侧钉：只测"超一个字符被拒"无法区分 `>` 与 `>=`。
    const result = await call(harness, q({ q: 'a'.repeat(QUERY.MAX_QUERY_LENGTH) }));
    expect(result.code).toBe(200);
  });

  it('rejects an out-of-range depth and a non-integer depth', async () => {
    for (const depth of [String(QUERY.MAX_DEPTH + 1), String(QUERY.MIN_DEPTH - 1), 'abc']) {
      const result = await call(harness, q({ q: 'alpha', depth }));
      expect(result.code, `depth=${depth} 应被拒绝`).toBe(400);
      expect(result.body.error).toBe('INVALID_CONFIG');
    }
  });

  it('accepts the depth boundaries (0 and MAX_DEPTH)', async () => {
    for (const depth of [QUERY.MIN_DEPTH, QUERY.MAX_DEPTH]) {
      const result = await call(harness, q({ q: 'alpha', depth }));
      expect(result.code, `depth=${depth} 应被接受`).toBe(200);
    }
  });

  it('rejects an out-of-range tokenBudget and a non-integer tokenBudget', async () => {
    for (const budget of [String(QUERY.MAX_TOKEN_BUDGET + 1), String(QUERY.MIN_TOKEN_BUDGET - 1), '1.5']) {
      const result = await call(harness, q({ q: 'alpha', tokenBudget: budget }));
      expect(result.code, `tokenBudget=${budget} 应被拒绝`).toBe(400);
      expect(result.body.error).toBe('INVALID_CONFIG');
    }
  });

  it('accepts the tokenBudget boundaries', async () => {
    for (const budget of [QUERY.MIN_TOKEN_BUDGET, QUERY.MAX_TOKEN_BUDGET]) {
      const result = await call(harness, q({ q: 'alpha', tokenBudget: budget }));
      expect(result.code, `tokenBudget=${budget} 应被接受`).toBe(200);
    }
  });

  it('rejects a workspace that is not on the allowlist (403, not a silent fallback)', async () => {
    // 允许列表拒绝时必须 403。若静默回落到宿主默认工作区，用户会拿到**另一个仓库**的答案，
    // 而画面上没有任何错误（P0-E 的形态）。
    const harnessDenied = makeHarness();
    mockIsPathAllowed.mockReturnValue(false);
    const result = await call(harnessDenied, q({ q: 'alpha', workspace: '/evil/workspace' }));
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('WORKSPACE_PATH_NOT_ALLOWED');
  });
});

describe('200 payload shape', () => {
  let harness: Harness;
  beforeEach(() => { harness = makeHarness(); });

  it('returns every field the client needs to draw a highlight (not just text)', async () => {
    const result = await call(harness, q({ q: 'alpha', depth: 1 }));
    expect(result.code).toBe(200);
    for (const key of ['query', 'terms', 'seeds', 'nodes', 'edges', 'text', 'tokens', 'truncated', 'reason', 'meta']) {
      expect(result.body, `响应缺字段 ${key}`).toHaveProperty(key);
    }
    expect(result.body.query).toBe('alpha');
    expect(Array.isArray(result.body.terms)).toBe(true);
    const seeds = result.body.seeds as Array<Record<string, unknown>>;
    expect(seeds.length).toBeGreaterThan(0);
    // 种子必须带 matchedTerms：面板要显示"为什么它被选中"，否则用户无法解释命中。
    expect(seeds[0]).toHaveProperty('id');
    expect(seeds[0]).toHaveProperty('label');
    expect(seeds[0]).toHaveProperty('score');
    expect(Array.isArray(seeds[0]!.matchedTerms)).toBe(true);
  });

  it('returns nodes/edges that are a real subset of the graph (drawable, not invented)', async () => {
    const result = await call(harness, q({ q: 'alpha', depth: 1 }));
    const nodes = result.body.nodes as Array<{ id: string }>;
    const edges = result.body.edges as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    // 每个返回的节点 id 必须真实存在于缓存图槽里，否则画布上选不中它。
    const fixtureIds = new Set(makeFixtureGraph().nodes.map((node) => node.id as string));
    for (const node of nodes) expect(fixtureIds.has(node.id)).toBe(true);
    for (const edge of edges) {
      expect(fixtureIds.has(edge.source as string)).toBe(true);
      expect(fixtureIds.has(edge.target as string)).toBe(true);
    }
    // 文本里给出的种子行也要在图上（`text` 与 `nodes` 必须同集）。
    expect(typeof result.body.text).toBe('string');
    expect((result.body.text as string)).toContain('NODE n-alpha');
  });

  it('reports meta with depth / depthEffective / tokenBudget / source / revision', async () => {
    const result = await call(harness, q({ q: 'alpha', depth: 5, tokenBudget: 400 }));
    const meta = result.body.meta as Record<string, unknown>;
    expect(meta.depth).toBe(5);
    // 库的上界是 3：请求 5 跳时 `meta.depth` 老实回显 5，`depthEffective` 说清实际用了 3。
    expect(meta.depthEffective).toBe(QUERY.LIBRARY_MAX_DEPTH);
    expect(meta.tokenBudget).toBe(400);
    expect(meta.source).toBe('slot');
    expect(meta.revision).toBe(1000);
  });

  it('marks a no-term query explicitly instead of pretending there were no matches', async () => {
    // 单个 ASCII 字符会被库的 MIN_TERM_LENGTH 丢弃：这不是「图上没有」，而是「这串问不出东西」。
    const result = await call(harness, q({ q: 'a' }));
    expect(result.code).toBe(200);
    expect(result.body.seeds).toEqual([]);
    expect(result.body.nodes).toEqual([]);
    expect((result.body.meta as Record<string, unknown>).reason).toBe('no-term');
  });

  it('reports truncated explicitly when the token budget cannot fit the subgraph', async () => {
    // graphify 原则：截断必须可见。用最小预算 + 深跳数把图撑爆。
    const result = await call(harness, q({ q: 'alpha', depth: 3, tokenBudget: QUERY.MIN_TOKEN_BUDGET }));
    expect(result.code).toBe(200);
    expect(result.body.truncated).toBe(true);
    expect(result.body.reason).not.toBe('fits');
    expect((result.body.text as string)).toMatch(/\[!\]/);
  });

  it('defaults depth=2 and tokenBudget=800 when the parameters are omitted', async () => {
    const result = await call(harness, q({ q: 'alpha' }));
    const meta = result.body.meta as Record<string, unknown>;
    expect(meta.depth).toBe(QUERY.DEFAULT_DEPTH);
    expect(meta.tokenBudget).toBe(QUERY.DEFAULT_TOKEN_BUDGET);
  });
});

describe('etag: the validator is reachable AND the value is reachable', () => {
  let harness: Harness;
  beforeEach(() => { harness = makeHarness(); });

  it('writes the validator on the 200 response (otherwise 304 is dead code)', async () => {
    const first = await call(harness, q({ q: 'alpha' }));
    expect(first.code).toBe(200);
    expect(first.etag, '200 响应必须带 etag：只写 304 分支会让客户端永远没有可回传的值').toBeTruthy();
    expect(first.etag).toMatch(/^W\/"/);
  });

  it('answers 304 when the same validator is replayed, and echoes it back', async () => {
    const first = await call(harness, q({ q: 'alpha' }));
    const replay = await call(harness, q({ q: 'alpha' }), { 'if-none-match': first.etag! });
    expect(replay.code).toBe(304);
    expect(replay.raw.ended).toBe(true);
    // 304 也要回写 etag：客户端可能用它刷新本地缓存（`checkEtag` 的行为）。
    expect(replay.raw.headers['etag']).toBe(first.etag);
  });

  it('answers 200 when the validator is tampered by one character', async () => {
    // 第三条互斥断言。没有它，「永远回 304」的实现也能通过前两条。
    const etag = (await call(harness, q({ q: 'alpha' }))).etag!;
    // 只改倒数第二个字符（校验器主体里的最后一位），保留 `W/"…"` 的合法形状：
    // 若整串改坏，`checkEtag` 因为字符串不等也会回 200，那这条断言就退化成
    // "任何非法值都 200"，看不出它真的在比较内容。
    const at = etag.length - 2;
    const flipped = `${etag.slice(0, at)}${etag[at] === 'a' ? 'b' : 'a'}${etag.slice(at + 1)}`;
    expect(flipped).not.toBe(etag);
    expect(flipped.length).toBe(etag.length);
    const result = await call(harness, q({ q: 'alpha' }), { 'if-none-match': flipped });
    expect(result.code).toBe(200);
  });

  it('changes the validator when the graph revision changes', async () => {
    const first = await call(harness, q({ q: 'alpha' }));
    harness.setSlot(makeFixtureGraph(WORKSPACE, 2000));
    const second = await call(harness, q({ q: 'alpha' }), { 'if-none-match': first.etag! });
    expect(second.code).toBe(200);
    expect(second.etag).not.toBe(first.etag);
  });

  describe('request-key negative cases (each dimension must participate)', () => {
    it('a different q yields a different validator', async () => {
      const alpha = await call(harness, q({ q: 'alpha' }));
      const beta = await call(harness, q({ q: 'beta' }));
      expect(beta.etag).not.toBe(alpha.etag);
      // 更强的形式：拿 alpha 的校验值去问 beta，必须 200 而不是 304。
      // 假 304 会把 alpha 的答案当成 beta 的答案永久显示。
      const crossTalk = await call(harness, q({ q: 'beta' }), { 'if-none-match': alpha.etag! });
      expect(crossTalk.code, 'alpha 的校验值不得让 beta 收到 304').toBe(200);
      expect(crossTalk.body.query).toBe('beta');
    });

    it('a different depth yields a different validator', async () => {
      const shallow = await call(harness, q({ q: 'alpha', depth: 1 }));
      const deep = await call(harness, q({ q: 'alpha', depth: 2 }));
      expect(deep.etag).not.toBe(shallow.etag);
      const crossTalk = await call(harness, q({ q: 'alpha', depth: 2 }), { 'if-none-match': shallow.etag! });
      expect(crossTalk.code).toBe(200);
    });

    it('a different tokenBudget yields a different validator', async () => {
      const small = await call(harness, q({ q: 'alpha', tokenBudget: 200 }));
      const large = await call(harness, q({ q: 'alpha', tokenBudget: 900 }));
      expect(large.etag).not.toBe(small.etag);
      const crossTalk = await call(harness, q({ q: 'alpha', tokenBudget: 900 }), { 'if-none-match': small.etag! });
      expect(crossTalk.code).toBe(200);
    });

    it('a different workspace yields a different validator', async () => {
      const local = await call(harness, q({ q: 'alpha' }));
      mockFetchMergedGraph.mockResolvedValue(makeFixtureGraph('/other/workspace', 1000));
      const foreign = await call(harness, q({ q: 'alpha', workspace: '/other/workspace' }));
      expect(foreign.code).toBe(200);
      expect(foreign.etag).not.toBe(local.etag);
      const crossTalk = await call(
        harness,
        q({ q: 'alpha', workspace: '/other/workspace' }),
        { 'if-none-match': local.etag! },
      );
      expect(crossTalk.code, '一个工作区的校验值不得让另一个工作区收到 304').toBe(200);
    });

    it('depth values the library clamps to the same effective depth share a validator', async () => {
      // 正例：depth=4 与 depth=5 都被库钳到 3，载荷逐字节相同 ⇒ 校验值**必须**相同。
      // 这条与上面的负例成对存在：只有负例时，"把 depth 从哈希里删掉"也能全绿。
      const four = await call(harness, q({ q: 'alpha', depth: 4 }));
      const five = await call(harness, q({ q: 'alpha', depth: 5 }));
      expect(four.etag).toBe(five.etag);
      expect(four.body.text).toBe(five.body.text);
      const replay = await call(harness, q({ q: 'alpha', depth: 5 }), { 'if-none-match': four.etag! });
      expect(replay.code).toBe(304);
    });
  });

  it('computeQueryEtag is deterministic and single-dimension sensitive (pure-function matrix)', () => {
    const base = { workspacePath: WORKSPACE, query: 'alpha', depth: 2, tokenBudget: 800, revision: 1000 };
    const etag = computeQueryEtag(base);
    expect(etag).toMatch(/^W\/"/);
    expect(computeQueryEtag(base)).toBe(etag);
    // 五个维度逐一带外，每一个都必须改变校验值。
    expect(computeQueryEtag({ ...base, workspacePath: '/other' })).not.toBe(etag);
    expect(computeQueryEtag({ ...base, query: 'beta' })).not.toBe(etag);
    expect(computeQueryEtag({ ...base, depth: 3 })).not.toBe(etag);
    expect(computeQueryEtag({ ...base, tokenBudget: 801 })).not.toBe(etag);
    expect(computeQueryEtag({ ...base, revision: 1001 })).not.toBe(etag);
    // 分隔符防碰撞：`q='a\u00012'` 与 `q='a'` 不得拼出同一串。
    expect(computeQueryEtag({ ...base, query: 'a\u00012' })).not.toBe(computeQueryEtag({ ...base, query: 'a' }));
  });
});

describe('graph source: slot first, upstream only when empty', () => {
  it('uses the cached slot and does not go upstream', async () => {
    const harness = makeHarness();
    const result = await call(harness, q({ q: 'alpha' }));
    expect((result.body.meta as Record<string, unknown>).source).toBe('slot');
    expect(mockFetchMergedGraph).not.toHaveBeenCalled();
  });

  it('falls back to fetchMergedGraph with the requested workspace when the slot is empty', async () => {
    const harness = makeHarness(null);
    const result = await call(harness, q({ q: 'alpha' }));
    expect(result.code).toBe(200);
    expect((result.body.meta as Record<string, unknown>).source).toBe('fetched');
    expect(mockFetchMergedGraph).toHaveBeenCalledTimes(1);
    // 与 `graph_query` 同一通道：repoId = 请求工作区，source = 'auto'。
    expect(mockFetchMergedGraph.mock.calls[0]![1]).toBe(WORKSPACE);
    expect(mockFetchMergedGraph.mock.calls[0]![2]).toBe('auto');
  });

  it('ignores a slot that belongs to another workspace (P0-B: never answer with a foreign graph)', async () => {
    // 槽里是另一个工作区的图时，`getWorkspaceScopedGraphData` 必须拒绝它并回落取图——
    // 否则 B 工作区的关键词检索会返回 A 工作区的节点，一个静默的错误答案。
    const harness = makeHarness(makeFixtureGraph('/some/other/repo', 1000));
    const result = await call(harness, q({ q: 'alpha' }));
    expect(result.code).toBe(200);
    expect((result.body.meta as Record<string, unknown>).source).toBe('fetched');
    expect(mockFetchMergedGraph).toHaveBeenCalledTimes(1);
  });

  it('answers 503 (not an empty 200) when the upstream fetch fails', async () => {
    // 「失败伪装成没有数据」是本仓反复记录的形态：空结果在界面上与
    // 「图里确实没有这个关键词」完全一样，用户会得出错误结论。
    const harness = makeHarness(null);
    mockFetchMergedGraph.mockRejectedValue(new Error('upstream unavailable'));
    const result = await call(harness, q({ q: 'alpha' }));
    expect(result.code).toBe(503);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toBe('SCAN_FAILED');
  });
});

describe('extractSubgraphFromText: the parse must equal what the library rendered', () => {
  it('parses back exactly nodeCount nodes and edgeCount edges', () => {
    // 这是「从库的文本反解高亮集合」这一实现路径的唯一安全网：
    // 库的文本格式一旦变化，解析会悄悄少收几行，而画面上与「本来就没有这些节点」
    // 完全无法区分。所以直接拿库自己的 nodeCount/edgeCount 对账。
    const graph = makeFixtureGraph();
    for (const depth of [0, 1, 2, 3]) {
      const terms = tokenizeQuery('alpha');
      const seeds = selectSeeds(
        graph.nodes.map((node) => ({ id: node.id, label: node.label, filePath: node.filePath })),
        terms,
        { maxK: QUERY.MAX_SEEDS },
      );
      const rendered = renderSubgraphText(
        {
          nodes: graph.nodes.map((node) => ({ id: node.id, label: node.label, filePath: node.filePath })),
          edges: graph.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
        },
        seeds,
        { depth, tokenBudget: 4000 },
      );
      const slice = extractSubgraphFromText(rendered.text, graph);
      expect(slice.nodes.length, `depth=${depth}: 解析出的节点数必须等于 nodeCount`).toBe(rendered.nodeCount);
      expect(slice.edges.length, `depth=${depth}: 解析出的边数必须等于 edgeCount`).toBe(rendered.edgeCount);
    }
  });

  it('drops lines whose node id is absent from the graph instead of inventing one', () => {
    // 「宁少不多」：编造出来的 id 在画布上选不中，点了没反应。
    const graph = makeFixtureGraph();
    const slice = extractSubgraphFromText('NODE n-alpha alpha\nNODE ghost ghost', graph);
    expect(slice.nodes.map((node) => node.id)).toEqual(['n-alpha']);
  });

  it('does not treat the seeds header or the over-budget notice as NODE/EDGE lines', () => {
    const graph = makeFixtureGraph();
    const text = [
      'seeds=n-alpha',
      'NODE n-alpha alpha *',
      'NODE n-beta beta',
      'EDGE n-alpha -> n-beta (call)',
      '[!] over budget: edges omitted (token_budget=50, full=999)',
    ].join('\n');
    const slice = extractSubgraphFromText(text, graph);
    expect(slice.nodes.map((node) => node.id)).toEqual(['n-alpha', 'n-beta']);
    expect(slice.edges).toHaveLength(1);
  });
});
