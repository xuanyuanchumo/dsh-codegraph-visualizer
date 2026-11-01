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
import { ERROR_CODES } from '../../shared/constants.ts';
import { XuanjiAdapterPool, type AdapterEdgeType, DEFAULT_PATH_EDGE_TYPES } from '../../shared/analysis/XuanjiAdapter.ts';

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

/** 解析逗号分隔的边类型（与工具同语义：未知类型丢弃，全未知回缺省）。 */
function parseEdgeTypes(raw: unknown): AdapterEdgeType[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const mapped = parts.filter((p): p is AdapterEdgeType => (DEFAULT_PATH_EDGE_TYPES as readonly string[]).includes(p));
  return mapped.length > 0 ? mapped : null;
}

/** 文档化路径常量（测试按路径定位，不按注册索引）。 */
export const PATHS_ROUTE_PATH = '/api/v1/codegraph/paths';

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
      const graph = getWorkspaceScopedGraphData(deps, workspacePath);
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

  void routePool;
}
