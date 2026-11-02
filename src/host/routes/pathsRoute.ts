/**
 * `GET /api/v1/codegraph/paths` —— 路径枚举读法的**用户侧出口**（cycle-124）。
 *
 * ## 缺口：璇玑图最强读法只有模型能调
 *
 * `graph_path_enumerate`（`src/tools.ts`）自 cycle-107 起就是璇玑图路径规则读法的
 * 真实调用方，但它是纯模型工具（ctx.tools.register）——**用户在面板上没有任何
 * 通道触达它**。功能业务的「注册-生产-消费」闭环在消费端断了一环：库有、工具
 * 有、路由无、UI 无。本路由补「路由无」这一环（UI 下一轮）。
 *
 * ## 与工具面的关系（同一份实现，不是第二份）
 *
 * 读取算法**只有一份**：`XuanjiAdapter.findPathsBetween`（XJ-03 的 `readPathPage`
 * 组装、Ω 惰性输出、分页）。本路由与工具的差异只在**供图方式**：
 * - 工具面：`fetchMergedGraph`（上游索引 + lens 三源合并，带缓存基线与增量）；
 * - 本路由：`lastGraphData` 槽（P0-B 身份守卫限定）→ DB 回落——客户端画布上
 *   已经是哪张图，路径枚举就在哪张图上跑，**所见即所查**。
 *
 * 图空间池化：模块级 `XuanjiAdapterPool`（按 repoId LRU），`syncGraph` 的
 * `'none'` 快路径让重复请求零物化成本。
 *
 * ## 安全面
 *
 * 与全部只读路由同款：工作区解析（query 参数 + 允许列表 + realpath）、限流、
 * CORS、输入 clamp。参数与工具 schema 对齐（minHops/maxHops/limit/cursor/
 * pageSize/edgeTypes/truncation），越界一律夹紧不报错（与工具行为一致）。
 *
 * ## etag 裁决（cycle-124 收口轮，显式决策登记）
 *
 * **刻意不加 etag。** 三条理由，全部成立才维持此决策：
 * 1. **消费面不存在**：客户端 PathBar 是用户驱动的即时查询，无「同参重试」场景；
 *    挂 etag 而无 If-None-Match 消费方 = 死代码（cycle-91「校验器可达 ≠ 校验值
 *    有用」教训的直接应用）；
 * 2. **请求键维度爆炸**：paths 结果由 workspace+source+target+minHops+maxHops+
 *    limit+cursor+pageSize+edgeTypes+truncation+图 revision 共 11 维决定，任何
 *    一维漏哈希就是假 304（P0-R16-02 家族），而 11 维全哈希的维护成本 > 收益；
 * 3. **计算成本已被池化抵消**：syncGraph 的 'none' 快路径让重复请求零物化成本，
 *    etag 省下的只有枚举本身的计算——而枚举有 maxPaths 上界，非无界开销。
 * 若未来客户端需要条件请求（如结果订阅），必须先补齐全部 11 维请求键并加
 * 双向守卫测试（参照 computeQueryEtag 的五维先例）。
 */
import { resolveWorkspaceFromRequest, getWorkspaceScopedGraphData, withRouteMiddleware, type RouteContext } from './shared.ts';
import { sendJson, sendError } from '../HttpHelpers.ts';
import { existsSync } from 'node:fs';
import type { GraphData } from '../../types/index.ts';
import { ERROR_CODES } from '../../shared/constants.ts';
import { XuanjiAdapterPool, formatPatternError, checkPatternSyntax, KNOWN_ADAPTER_EDGE_TYPES, type AdapterEdgeType, DEFAULT_PATH_EDGE_TYPES } from '../../shared/analysis/XuanjiAdapter.ts';

/** 路由面独立池（与工具面 xuanjiPool 隔离——工具面的缓存基线语义不同）。 */
const routePool = new XuanjiAdapterPool(2);

/**
 * clamp 到 [min,max]，非数回退 default。
 *
 * P-1（测试先行抓出）：URLSearchParams.get 返回**字符串**，`typeof v === 'number'`
 * 恒 false ⇒ 所有数值参数被静默替换成 default（`maxHops=1` 变 5，2 跳路径在
 * 「不可达」用例里冒出来）。query string 的入参必须先 Number 化再判有限——
 * 这是「参数加了、类型没对」家族在路由面的新形态。
 */
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v)
    ? Math.floor(v)
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Math.floor(Number(v))
      : NaN;
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/**
 * 索引库直读回落（cycle-134，仅 `slot` 为空时使用）。
 *
 * 复用 `/bootstrap` 与四个按需路由的同一条读侧链（`resolveIndexDbPath` →
 * `readGraphFromDb` → `mapRowsToGraph*`），**不新建第二份图**——这是本仓
 * 「两个数据路径共享一个实现」纪律的直接应用。
 *
 * 与 `CodeGraphAdapter` 的区别只在「要不要聚类/过滤」：路径枚举需要**完整**图
 * （否则一段合法路径可能因为中间节点被过滤而断裂），因此这里不做噪声路径过滤。
 * 过滤与否会改变「图上有没有这条路径」这个答案，属语义差异，不是性能优化。
 *
 * 失败一律返回 `null`，由调用方走 `no-graph-data` 分支——索引是缓存层，
 * 读失败不该让路由 500。
 */
async function readIndexGraph(workspacePath: string): Promise<GraphData | null> {
  try {
    const [{ resolveDbPath }, { readGraphFromDb }, rows, native] = await Promise.all([
      import('../../adapters/CodeGraphAdapter.ts'),
      import('../../adapters/codeGraphDb.ts'),
      import('../../adapters/codeGraphRows.ts'),
      import('../../adapters/nativeIndex.ts'),
    ]);
    let dbPath = resolveDbPath(workspacePath);
    if (!existsSync(dbPath)) {
      try {
        dbPath = native.resolveNativeIndexPath(workspacePath);
      } catch {
        return null;
      }
    }
    const raw = readGraphFromDb(dbPath);
    if (!raw) return null;
    const nodes = rows.mapRowsToGraphNodes(raw.nodes);
    // 边映射需要合法节点集（否则会产出悬空边，路径枚举里表现为「一步都走不通」）。
    const validNodeIds = new Set(nodes.map((n) => String(n.id)));
    const edges = rows.mapRowsToGraphEdges(raw.edges, validNodeIds);
    if (nodes.length === 0) return null;
    return {
      nodes,
      edges,
      metadata: {
        repoId: workspacePath as GraphData['metadata']['repoId'],
        timestamp: Date.now(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  } catch {
    return null;
  }
}

/** 解析逗号分隔的边类型（与工具同语义：未知类型丢弃，全未知回缺省）。 */
function parseEdgeTypes(raw: unknown): AdapterEdgeType[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const mapped = parts.filter((p): p is AdapterEdgeType => (DEFAULT_PATH_EDGE_TYPES as readonly string[]).includes(p));
  return mapped.length > 0 ? mapped : null;
}

/** 文档化路径常量（测试按路径定位，不按注册索引）。 */
export const PATHS_ROUTE_PATH = '/api/v1/codegraph/paths';

/**
 * ρ 语法预检路由（cycle-135）：`GET /api/v1/codegraph/path-pattern/syntax?pattern=...`
 *
 * ## 为什么单独一条路由而不是让客户端自己解析
 *
 * `parsePathPattern` 在 `src/xuanji/core/path-pattern.ts`，它依赖的是 `EdgeType`
 * 类型与 NFA 构造——把它打进客户端 bundle 会让「库的边界」在 bundle 层面消失
 * （`tests/unit/xuanji/libraryBoundary.test.ts` 断言 `src/xuanji` 零宿主依赖，
 * 但反过来客户端依赖库同样会让 Host/Client 隔离的**意图**落空）。
 * 更硬的理由：语法与类型名的合法集（Σ）是**宿主侧事实**——Σ 由 `GraphEdge.type`
 * 决定，客户端不应复制一份（复制就会静默分叉，本仓反复记录过）。
 *
 * ## 为什么预检**不**返回 unknownEdgeTypes
 *
 * 拼错类型名（`calls`）**语法合法**（它是一个合法的 type token），只有**枚举**
 * 时才能发现它不在 Σ 里。预检只回答「ρ 能不能被解析」，不回答「类型名对不对」——
 * 后者的答案依赖图上实际存在哪些边，那是 `/paths?pattern=` 的职责。
 * 把两件事混在一条路由上会让「语法对但类型错」被误报成语法错。
 */
export const PATH_PATTERN_SYNTAX_ROUTE_PATH = '/api/v1/codegraph/path-pattern/syntax';

/**
 * 语法预检 handler —— 返回 `true` 表示已写响应。
 *
 * 只做 parse（`checkPatternSyntax`），不编译、不碰图：预检的语义是「这条 ρ
 * 文本能否被解析」，与图的状态无关。因此它**不需要**工作区解析（没有图可查），
 * 这让它能在宿主还没建索引时就可用——这正是界面逐键校验需要的。
 */
function runSyntaxBranch(
  res: Parameters<typeof sendJson>[0],
  pattern: string,
  req: Parameters<typeof sendJson>[3],
  corsConfig: Parameters<typeof sendJson>[4],
): boolean {
  const check = checkPatternSyntax(pattern);
  if (check.ok) {
    // 额外透出 Σ（合法类型名全集），让客户端能做「输入提示 / 自动补全」而不必
    // 复制一份类型名列表（复制即分叉）。
    sendJson(res, 200, {
      ok: true,
      pattern,
      edgeTypes: [...KNOWN_ADAPTER_EDGE_TYPES].sort(),
    }, req, corsConfig);
    return true;
  }
  sendJson(res, 200, {
    ok: false,
    pattern,
    error: check.error instanceof Error ? check.error.message : String(check.error),
    diagnostic: formatPatternError(pattern, check.error),
    edgeTypes: [...KNOWN_ADAPTER_EDGE_TYPES].sort(),
  }, req, corsConfig);
  return true;
}

/**
 * `pattern`（ρ）分支的具体求值——cycle-134。
 *
 * 抽成独立函数而不是内联进 handler：`registerPathsRoute` 的 handler 复杂度已经很高
 * （参数解析 + 工作区解析 + 图槽回落 + 分页 + label 映射），把 ρ 分支塞进去会让
 * 单函数分支数超预算（band-detector 口径 ≤ 100）。这里的分支自成一体，
 * 也只有它能返回「已经发过响应」这个第三种结果。
 *
 * @returns `true` = 已经写过响应（调用方直接 return）；`false` = 未处理（不该发生）
 */
function runPatternBranch(
  // 两套 HTTP 类型（node:http 与 src/types 的 electron 兼容别名）在本仓共存，
  // 而 sendJson 接受的是 node:http 那一套。辅助函数只转调 sendJson，因此这里用
  // 结构化最小面 + 一次 cast，而不是把两套类型都引进来（那会污染调用点）。
  res: Parameters<typeof sendJson>[0],
  graph: GraphData,
  workspacePath: string,
  pattern: string,
  url: URL,
  req: Parameters<typeof sendJson>[3],
  corsConfig: Parameters<typeof sendJson>[4],
): boolean {
  const adapter = routePool.get(workspacePath);
  adapter.syncGraph(graph);
  try {
    const result = adapter.pathsByPattern(pattern, {
      ...(url.searchParams.get('startNode') ? { startNode: url.searchParams.get('startNode')! } : {}),
      ...(url.searchParams.get('endNode') ? { endNode: url.searchParams.get('endNode')! } : {}),
      minHops: clampInt(url.searchParams.get('minHops'), 0, 12, 0),
      maxHops: clampInt(url.searchParams.get('maxHops'), 0, 12, 8),
      limit: clampInt(url.searchParams.get('limit'), 1, 50, 20),
      cursor: clampInt(url.searchParams.get('cursor'), 0, Number.MAX_SAFE_INTEGER, 0),
      pageSize: url.searchParams.get('pageSize') !== null
        ? clampInt(url.searchParams.get('pageSize'), 1, 50, 20)
        : undefined,
      ...(url.searchParams.get('closed') === '1' ? { closed: true } : {}),
      ...(url.searchParams.get('truncation') === 'top-k-weight' ? { truncation: 'top-k-weight' as const } : {}),
    });
    const labelOf = new Map<string, string>(graph.nodes.map((n) => [String(n.id), n.label]));
    sendJson(res, 200, {
      pattern: result.pattern,
      patternEdgeTypes: result.patternEdgeTypes,
      stateCount: result.stateCount,
      /**
       * 拼错诊断（cycle-135）：ρ 里出现但不在 Σ 里的类型名。
       * 与 `paths: []` 一起返回时，客户端据此区分「我写错了」与「图上没有这种边」——
       * 两者都是空结果，但用户下一步动作完全不同。
       */
      unknownEdgeTypes: result.unknownEdgeTypes,
      paths: result.paths.map((p) => ({ ids: p, labels: p.map((id) => labelOf.get(id) ?? id) })),
      truncated: result.truncated,
      total: result.total,
      nextCursor: result.nextCursor ?? null,
      metadata: { repoId: graph.metadata.repoId, edgeCount: graph.edges.length },
    }, req, corsConfig);
    return true;
  } catch (e) {
    // ρ 语法错误与「没有匹配」**必须**在返回面上可区分（与工具面同语义）：
    // 400 + 带 ^ 指位的诊断，而不是 200 + 空数组。
    // 若不是 PathPatternError（真正的内部故障），照常上抛给统一错误处理。
    const isPatternError = e instanceof Error && e.name === 'PathPatternError';
    if (!isPatternError) throw e;
    sendJson(res, 400, {
      paths: [],
      truncated: false,
      total: 0,
      nextCursor: null,
      error: 'invalid-pattern',
      message: e instanceof Error ? e.message : String(e),
      diagnostic: formatPatternError(pattern, e),
    }, req, corsConfig);
    return true;
  }
}

export function registerPathsRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = PATHS_ROUTE_PATH;

  ctx.effect(() => ctx.webServer!.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      // 0) 工作区解析（同款安全链：query 参数 + 允许列表 + realpath）。
      const workspacePath = await resolveWorkspaceFromRequest(req, deps.ctx, deps);

      // 1) 图源：lastGraphData 槽（身份守卫）优先——所见即所查。
      //
      // cycle-134 真机发现的缺口：宿主 fresh 启动、或用户从未触发过 `/data` 时，
      // 槽是空的，而 `/bootstrap` 早已从**索引库**读出 2193 个节点、面板上图画得好好的。
      // 于是「所见即所查」在这条路径上退化成「所见 ≠ 所查」——路径枚举在用户看得见图的
      // 情况下报 `no-graph-data`。这与本文件的头注设计意图直接矛盾。
      //
      // 修法：槽空时回落**索引库直读**（与 `/bootstrap` 同一数据面，不是第二份图）。
      // 只在槽空时才走，因此槽在场时的行为逐字节不变。
      let graph = getWorkspaceScopedGraphData(deps, workspacePath);
      if (!graph || graph.nodes.length === 0) {
        graph = await readIndexGraph(workspacePath);
      }
      if (!graph || graph.nodes.length === 0) {
        // 槽空（宿主 fresh 启动 / 索引未建）≠ 工作区不允许：真机冒烟发现 404
        // WORKSPACE_PATH_NOT_ALLOWED 有误导性（会让 API 消费方以为是权限问题）。
        // 与「端点不在图」同语义：200 + reason，客户端据此提示「先扫描/等索引」。
        sendJson(res, 200, {
          paths: [], truncated: false, total: 0, nextCursor: null,
          reason: 'no-graph-data',
        }, req, corsConfig);
        return;
      }

      // 2) 解析查询参数（query string；全部 clamp）。
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const sourceSymbol = url.searchParams.get('source') ?? '';
      const targetSymbol = url.searchParams.get('target') ?? '';
      /**
       * `pattern`（cycle-134）：路径模式 ρ —— 与 `source`/`target` **互斥**的两条分支。
       *
       * 为什么互斥而不是叠加：两者是**不同的查询形态**。
       * - `source`+`target` ⇒ 「这两点之间的路径」（端点已知，ρ 未定）；
       * - `pattern` ⇒ 「图上哪些路径符合这个形状」（形状已知，端点未知）。
       * 同时给出时语义可以定义（「两点之间且符合 ρ」），但会让参数组合爆炸
       * （`pattern` + `source` + `target` + `endNode` 四种子集各有不同含义），
       * 而调用方真正需要的那种组合用 `pattern` + `startNode`/`endNode` 已能表达。
       * 因此这里明确分支，并在同时给出时返回 400 —— 不含糊。
       */
      const pattern = url.searchParams.get('pattern') ?? '';

      if (pattern) {
        if (sourceSymbol || targetSymbol) {
          sendError(res, 400, ERROR_CODES.INVALID_CONFIG, req, corsConfig,
            'pattern is mutually exclusive with source/target — use pattern with optional startNode/endNode');
          return;
        }
        const patternResult = runPatternBranch(res, graph, workspacePath, pattern, url, req, corsConfig);
        if (patternResult) return;
        return;
      }

      if (!sourceSymbol || !targetSymbol) {
        sendError(res, 400, ERROR_CODES.INVALID_CONFIG, req, corsConfig, 'source and target query params are required');
        return;
      }
      const nodeIds = new Set(graph.nodes.map((n) => n.id as string));
      if (!nodeIds.has(sourceSymbol) || !nodeIds.has(targetSymbol)) {
        // 与工具同语义：端点不在图里 = 空结果（不是错误——graph_query 先定位）。
        sendJson(res, 200, { paths: [], truncated: false, total: 0, nextCursor: null, reason: 'endpoint-not-in-graph' }, req, corsConfig);
        return;
      }

      // 3) 图空间池化 + 同步（'none' 快路径让重复请求零物化成本）。
      const adapter = routePool.get(workspacePath);
      adapter.syncGraph(graph);

      // 4) 路径枚举（参数与工具 schema 对齐，越界夹紧）。
      const result = adapter.findPathsBetween(sourceSymbol, targetSymbol, {
        minHops: clampInt(url.searchParams.get('minHops'), 1, 10, 1),
        maxHops: clampInt(url.searchParams.get('maxHops'), 1, 10, 5),
        limit: clampInt(url.searchParams.get('limit'), 1, 50, 10),
        cursor: clampInt(url.searchParams.get('cursor'), 0, Number.MAX_SAFE_INTEGER, 0),
        pageSize: url.searchParams.get('pageSize') !== null
          ? clampInt(url.searchParams.get('pageSize'), 1, 50, 10)
          : undefined,
        ...(parseEdgeTypes(url.searchParams.get('edgeTypes'))
          ? { edgeTypes: parseEdgeTypes(url.searchParams.get('edgeTypes'))! }
          : {}),
        ...(url.searchParams.get('truncation') === 'top-k-weight' ? { truncation: 'top-k-weight' as const } : {}),
      });

      // 5) 路径 id → label（客户端渲染直接用，免二次查表）。
      const labelOf = new Map(graph.nodes.map((n) => [n.id as string, n.label]));
      const pathsWithLabels = result.paths.map((p) => ({
        ids: p,
        labels: p.map((id) => labelOf.get(id) ?? id),
      }));

      sendJson(res, 200, {
        paths: pathsWithLabels,
        truncated: result.truncated,
        total: result.total,
        nextCursor: 'nextCursor' in result ? (result as { nextCursor?: number | null }).nextCursor ?? null : null,
        metadata: {
          repoId: graph.metadata.repoId,
          source: sourceSymbol,
          target: targetSymbol,
          edgeCount: graph.edges.length,
        },
      }, req, corsConfig);
    }),
  }), 'codegraph: paths route');

  // cycle-135：ρ 语法预检路由。无图、无工作区解析——语法与 Σ 是宿主侧事实，
  // 且预检的语义不依赖图的状态，因此宿主还没建索引时它就能工作（界面逐键校验需要）。
  ctx.effect(() => ctx.webServer!.register({
    kind: 'exact',
    path: PATH_PATTERN_SYNTAX_ROUTE_PATH,
    handler: withRouteMiddleware('GET', PATH_PATTERN_SYNTAX_ROUTE_PATH, corsConfig, rateLimiter, async (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const pattern = url.searchParams.get('pattern') ?? '';
      runSyntaxBranch(res, pattern, req, corsConfig);
    }),
  }), 'codegraph: path-pattern syntax route');

  void routePool;
}
