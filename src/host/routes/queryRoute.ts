import { computeContentHash } from '../../shared/graphFingerprint.ts';
import { ERROR_CODES } from '../../shared/constants.ts';
import type { GraphData, GraphEdge, GraphNode, IncomingMessage, ServerResponse } from '../../types/index.ts';
import {
  tokenizeQuery,
  selectSeeds,
  renderSubgraphText,
} from '../../xuanji/query/keyword-query.ts';
import { fetchMergedGraph } from '../../tools.ts';
import { sendJson, sendError } from '../HttpHelpers.ts';
import {
  withRouteMiddleware,
  validateWorkspacePath,
  getWorkspaceScopedGraphData,
  checkEtag,
  etagHeaders,
  type RouteContext,
  log,
} from './shared.ts';

/**
 * `GET /api/v1/codegraph/query` —— 关键词图检索。
 *
 * ## 为什么需要这条路由（本轮缺口 N-5）
 *
 * 关键词检索的**算法**早就在库里了：`src/xuanji/query/keyword-query.ts` 的
 * `tokenizeQuery` / `selectSeeds` / `renderSubgraphText`，`src/tools.ts` 的
 * `graph_query` 工具也一直在用它们（graphify 研究「把图查询当成一等输出」的落地）。
 * 但 `grep -rn "keywordQuery|graph_query" src/client/` = 0 命中——这套能力**只有 LLM 面，
 * 没有人类面**。研究结论只落地了一半，而且是看不见的那一半。
 *
 * 本模块只做三件宿主该做的事：**取图 → 调库 → 序列化 + 定校验器**。
 * 算法一行都不复制：token 估算（CJK 1 字 = 1 token 的口径）、种子分级与断层截断、
 * 超预算三分支全部留在库里，工具面与界面面因此共用同一份实现，不会出现
 * 「工具说截断了、面板说没截断」这种两套口径。
 *
 * ## 响应为什么必须是结构化子图而不是纯文本
 *
 * `graph_query` 面向 LLM，文本就够。面向人则不够：**人在图上要看见高亮**。
 * 因此响应同时给出 `text`（与工具同一份渲染结果）与 `nodes` / `edges`（可画高亮），
 * 两者由同一份渲染结果派生（见 `extractSubgraphFromText`），不是两套计算。
 *
 * ## 校验器（本仓最深的坑家族，P0-R16-02 / P3-R18-02）
 *
 * 三条纪律一条都不能少：
 *   1. **身份维度必须覆盖全部会改变响应的请求参数**：`工作区 + q + depth + tokenBudget + 图 revision`。
 *      少任一维 ⇒ 两个不同请求算出同一个校验值 ⇒ 假 304 ⇒ 客户端把 A 的答案当成 B 的答案
 *      永久显示（且没有任何错误可见）。
 *   2. **200 响应也必须回写 etag**（`etagHeaders`）。只写 304 分支正是 cycle-91 的死代码缺陷：
 *      客户端手里永远没有可回传的值，304 分支可达但永不命中。
 *   3. **304 与网络失败必须区分**：本路由只回 304 或 200/4xx/5xx，客户端侧用独立旁路表达 304。
 *
 * 为什么不用 `etagGuard` / `resourceEtag`：那两兄弟的校验值来自**缓存图槽的 revision**
 * 与 `GraphEtagResource` 资源维度。`/query` 的载荷是「请求参数 + 图内容」的派生结果，
 * 与 `/dependencies`（按磁盘 manifest 内容定域）、`/churn`（按 git 输出定域）同类：
 * 校验值必须由**本路由自己**按请求内容构造，套用槽的 revision 会得到
 * 「两个不同 q 共用一个校验值」——这正是 `GraphEtagResource` 用编译期必填参数
 * 想根除的那类缺陷换了个方向。
 */
export const QUERY = Object.freeze({
  /**
   * 查询串长度上限。
   *
   * 与 `VALIDATION.MAX_FILEPATH_LENGTH`（512）同值，但**刻意不复用那个常量**：它是
   * 「文件路径」的界，语义不同；共用会让将来调路径上限时静默改掉关键词上限。
   * 契约测试钉住 `<= 512`（一个查询串不该比一个路径还长）。
   */
  MAX_QUERY_LENGTH: 512,
  /** 展开跳数下界（0 = 只要种子本身）。 */
  MIN_DEPTH: 0,
  /** 调用方**允许请求**的最大跳数。 */
  MAX_DEPTH: 5,
  DEFAULT_DEPTH: 2,
  /**
   * 库实际生效的最大跳数。
   *
   * `src/xuanji/query/keyword-query.ts:232` 是 `Math.min(3, …)`，且该上界**没有被导出**。
   * 这里镜像一份，并用行为用例钉住「depth=4 与 depth=5 的载荷完全相同」——
   * 一旦库改了上界（T1 正在动那个文件），那条用例会红，提醒这里同步；
   * 这比在 route 里悄悄假设「传多少就用多少」诚实（否则 `meta.depth` 会撒谎）。
   */
  LIBRARY_MAX_DEPTH: 3,
  MIN_TOKEN_BUDGET: 50,
  MAX_TOKEN_BUDGET: 4000,
  DEFAULT_TOKEN_BUDGET: 800,
  /**
   * 种子数上限。库的缺省是 3，但界面需要「多词查询时每词保底一个」的可见性
   * （`selectSeeds` 的保底条目可以越过 maxK），因此给到 5 让用户看到更多解释。
   */
  MAX_SEEDS: 5,
  ROUTE_PATH: '/api/v1/codegraph/query',
} as const);

/** `/query` 一次请求的有效参数（已规范化）。 */
export interface KeywordQueryInput {
  readonly query: string;
  /** 调用方请求的跳数（原样回显在 `meta.depth` 之前会被钳到库上限，见 `depthEffective`）。 */
  readonly depth: number;
  /** 库实际生效的跳数。 */
  readonly depthEffective: number;
  readonly tokenBudget: number;
  readonly workspacePath: string;
}

/**
 * `/query` 的校验器（唯一构造点）。
 *
 * 五个身份维度缺一不可，且**全部参与拼接**：
 *   - `workspacePath`：宿主只有一个图槽，槽里可能是别的工作区的图；不含工作区维度时
 *     A 的校验值可以让 B 的请求收到 304（P0-R16-02 的跨工作区分支）；
 *   - `query`：换词就是换问题；
 *   - `depth`：跳数直接决定子图规模；
 *   - `tokenBudget`：预算直接决定渲染到第几个节点（同一个 q 换预算得到**不同文本**）；
 *   - `revision`：同一请求在图上变了之后必须失配，否则真实更新被静默吞掉。
 *
 * `depth` 传的是**生效值**而不是请求值：`depth=4` 与 `depth=5` 在库里被钳到 3，
 * 载荷逐字节相同，共用校验值是正确的（同一份载荷本来就该有同一个校验值）。
 * 这不是"少一维"，而是"这一维的取值域被库归一化了"——由 `depthEffective` 显式承担。
 *
 * `revision` 取图槽的 `metadata.timestamp`：它是宿主侧唯一的版本信号（`computeGraphEtag`
 * 也用它）。两个不同工作区的图理论上可能撞到同一毫秒，所以 `workspacePath` 必须一起进哈希。
 */
export function computeQueryEtag(input: {
  readonly workspacePath: string;
  readonly query: string;
  readonly depth: number;
  readonly tokenBudget: number;
  readonly revision: number;
}): string {
  // 与 `computeGraphEtag` / `computeDependenciesEtag` 同一 `W/"..."` 弱校验器形状。
  // `\u0001` 是不可见分隔符，保证「q='a\u00012' + depth=3」与「q='a' + depth=…」不会拼出同一串。
  return `W/"${computeContentHash([
    input.workspacePath,
    input.query,
    String(input.depth),
    String(input.tokenBudget),
    String(input.revision),
  ].join('\u0001'))}"`;
}

/** 解析后的子图：与渲染文本严格同集（见 `extractSubgraphFromText`）。 */
export interface RenderedSubgraphSlice {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}

/** `NODE <id> <label...>` / `EDGE <src> -> <tgt> (<type>)` 两行形状（库的文本契约）。 */
const NODE_LINE_RE = /^NODE (\S+)(?: (.*))?$/;
const EDGE_LINE_RE = /^EDGE (\S+) -> (\S+) \(([^)]+)\)$/;

/**
 * 从**库自己渲染出的文本**里取回 id 集合，再映射成完整节点/边对象。
 *
 * ## 为什么不重算一遍 BFS
 *
 * 「种子 → 有界 BFS → 按跳数/度数排序 → 预算内截断」全部住在
 * `renderSubgraphText` 里。在 route 里再走一遍 BFS 就是**复制实现**：两份一旦漂移，
 * 面板高亮的节点与文本里列出的节点会不一致，而且没有任何测试会红（两边各自自洽）。
 * 文本是库对外的唯一输出契约，解析它得到的就是「库认为该显示的集合」——
 * 与工具面读到的完全同一份。
 *
 * ## 稳健性
 *
 * 解析结果必须与 `RenderedSubgraph.nodeCount` / `edgeCount` 相等，这条由
 * `tests/unit/queryRoute.test.ts` 钉死：库的文本格式一旦变了，用例立刻红，
 * 而不是面板静默少画几个高亮（那在画面上与"本来就没有这些节点"无法区分）。
 * 解析不出完整节点（id 不在图里）时**丢弃该行**而不是编造对象——
 * 宁少不多，因为编造出来的节点 id 在画布上选不中。
 */
export function extractSubgraphFromText(text: string, graph: GraphData): RenderedSubgraphSlice {
  const nodeIds: string[] = [];
  const edgeTriples: Array<{ source: string; target: string; type: string }> = [];
  for (const line of text.split('\n')) {
    const nodeMatch = NODE_LINE_RE.exec(line);
    if (nodeMatch) {
      const id = nodeMatch[1];
      if (id && id !== 'none') nodeIds.push(id);
      continue;
    }
    const edgeMatch = EDGE_LINE_RE.exec(line);
    if (edgeMatch) {
      const [, source, target, type] = edgeMatch;
      if (source && target && type) edgeTriples.push({ source, target, type });
    }
  }

  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id as string, node);
  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const node = byId.get(id);
    if (node) nodes.push(node);
  }

  // 边按 (source, target, type) 三元组回查：文本里没有边 id，而同一对端点之间
  // 可以有多条不同类型的边（call + import），所以三维都要参与匹配。
  const edges: GraphEdge[] = [];
  for (const triple of edgeTriples) {
    const match = graph.edges.find(
      (edge) =>
        (edge.source as string) === triple.source &&
        (edge.target as string) === triple.target &&
        (edge.type as string) === triple.type,
    );
    if (match) edges.push(match);
  }
  return { nodes, edges };
}

/** 解析并规范化查询参数；非法时已回 400 并返回 `null`。 */
function parseQueryParams(
  req: IncomingMessage,
  res: ServerResponse,
  rc: RouteContext,
): Omit<KeywordQueryInput, 'workspacePath'> | null {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);

  // `q` 必填：没有查询串就没有"检索"，回一份空结果会让用户以为「图里什么都没有」。
  const rawQuery = url.searchParams.get('q');
  const query = (rawQuery ?? '').trim();
  if (query.length === 0) {
    sendError(res, 400, ERROR_CODES.FILEPATH_REQUIRED, req, rc.corsConfig, 'q is required');
    return null;
  }
  if (query.length > QUERY.MAX_QUERY_LENGTH) {
    sendError(res, 400, ERROR_CODES.CONTENT_TOO_LARGE, req, rc.corsConfig, `q exceeds ${QUERY.MAX_QUERY_LENGTH} chars`);
    return null;
  }

  // `depth` / `tokenBudget`：**越界一律 400，不做静默钳制**。
  // 静默钳制会让用户以为「我要了 5 跳，拿到的是 5 跳」——这正是本仓反复记录的
  // 「降级默认必须拒绝，不能许诺」；唯一例外是库自身的 3 跳上限（没有可选余地），
  // 那一条通过 `meta.depthEffective` 显式披露。
  const rawDepth = url.searchParams.get('depth');
  const depth = rawDepth === null ? QUERY.DEFAULT_DEPTH : Number(rawDepth);
  if (!Number.isInteger(depth) || depth < QUERY.MIN_DEPTH || depth > QUERY.MAX_DEPTH) {
    sendError(res, 400, ERROR_CODES.INVALID_CONFIG, req, rc.corsConfig,
      `depth must be an integer in [${QUERY.MIN_DEPTH}, ${QUERY.MAX_DEPTH}]`);
    return null;
  }

  const rawBudget = url.searchParams.get('tokenBudget');
  const tokenBudget = rawBudget === null ? QUERY.DEFAULT_TOKEN_BUDGET : Number(rawBudget);
  if (!Number.isInteger(tokenBudget) || tokenBudget < QUERY.MIN_TOKEN_BUDGET || tokenBudget > QUERY.MAX_TOKEN_BUDGET) {
    sendError(res, 400, ERROR_CODES.INVALID_CONFIG, req, rc.corsConfig,
      `tokenBudget must be an integer in [${QUERY.MIN_TOKEN_BUDGET}, ${QUERY.MAX_TOKEN_BUDGET}]`);
    return null;
  }

  return {
    query,
    depth,
    depthEffective: Math.min(depth, QUERY.LIBRARY_MAX_DEPTH),
    tokenBudget,
  };
}

/**
 * 取本次请求的图：**优先缓存图槽，槽为空才回源**。
 *
 * 槽的读取必须走 `getWorkspaceScopedGraphData`，不能裸读 `deps.getLastGraphData()`：
 * 宿主只有一个图槽，槽里可能装着另一个工作区的图（P0-B）。裸读会让 B 工作区的关键词
 * 检索返回 A 工作区的节点——一个**静默的错误答案**，比空结果危险得多。
 *
 * 回源走 `fetchMergedGraph(rc.invokeUpstream, repoId, 'auto')`，与 `graph_query` 工具同一
 * 数据通道（研究结论要求「不要另造数据通道」：两条通道一旦语义不同，
 * 工具说查得到、面板说查不到，而谁也不知道哪条是对的）。
 */
async function resolveGraph(
  rc: RouteContext,
  workspacePath: string,
): Promise<{ graph: GraphData; source: 'slot' | 'fetched' } | null> {
  const slot = getWorkspaceScopedGraphData(rc.deps, workspacePath);
  if (slot) return { graph: slot, source: 'slot' };
  try {
    const fetched = await fetchMergedGraph(rc.invokeUpstream, workspacePath, 'auto');
    return { graph: fetched, source: 'fetched' };
  } catch (e) {
    log.error('query route: upstream graph fetch failed', e);
    return null;
  }
}

/** 渲染 + 组装响应体（200 与 304 都不需要它以外的东西）。 */
function buildPayload(
  input: KeywordQueryInput,
  graph: GraphData,
  source: 'slot' | 'fetched',
): Record<string, unknown> {
  const terms = tokenizeQuery(input.query);

  // 查询串里没有任何可检索词（例如单个 ASCII 字符，被库的 `MIN_TERM_LENGTH` 丢弃）：
  // 这不是错误，是「这一串问不出东西」，必须与「问了但图上没有」区分开。
  if (terms.length === 0) {
    return {
      query: input.query,
      terms,
      seeds: [],
      nodes: [],
      edges: [],
      text: 'No searchable term in query (need at least one letter/digit or CJK character).',
      tokens: 0,
      truncated: false,
      reason: 'fits',
      meta: {
        depth: input.depth,
        depthEffective: input.depthEffective,
        tokenBudget: input.tokenBudget,
        source,
        revision: graph.metadata.timestamp,
        reason: 'no-term',
      },
    };
  }

  const seeds = selectSeeds(
    graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
    })),
    terms,
    { maxK: QUERY.MAX_SEEDS },
  );

  // 刻意**不写类型注解** `: RenderedSubgraph`：`tests/unit/xuanjiReachability.test.ts`
  // 的双向守卫把「生产代码显式 import 库类型名」当作可达性信号，写注解会逼着那边删掉
  // 一条豁免（那是 T1 的写域），而让类型推断推出同一形状就没有这个副作用。
  const rendered = renderSubgraphText(
    {
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
      })),
      edges: graph.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
    },
    seeds,
    { depth: input.depthEffective, tokenBudget: input.tokenBudget },
  );

  // 高亮集合直接由库的渲染结果派生（见 `extractSubgraphFromText` 的注释）。
  const slice = extractSubgraphFromText(rendered.text, graph);

  return {
    query: input.query,
    terms,
    seeds: seeds.map((seed) => ({
      id: seed.id,
      label: seed.label,
      score: seed.score,
      matchedTerms: [...seed.matchedTerms],
    })),
    nodes: slice.nodes,
    edges: slice.edges,
    // 截断必须显式：`reason` 与 `truncated` 都由库给出，route 不重新判定。
    // 面板据此渲染「这不是完整结果」，与 graphify「截断必须显式到不可能被误读」同一条。
    text: rendered.text,
    tokens: rendered.tokens,
    truncated: rendered.truncated,
    reason: rendered.reason,
    meta: {
      depth: input.depth,
      depthEffective: input.depthEffective,
      tokenBudget: input.tokenBudget,
      source,
      revision: graph.metadata.timestamp,
      reason: seeds.length === 0 ? 'no-seed' : rendered.reason,
    },
  };
}

/**
 * 注册 `GET /api/v1/codegraph/query`。
 *
 * 调用方：`src/host/routes.ts` 的 `registerRoutes`（本轮由 Lead 接线，见任务报告）。
 * 建议插在 `registerChurnRoute(rc)` **之前**：`registerRoutes` 的调用顺序就是
 * `webServer.register` 的调用顺序，既有用例大量用「第 N 次注册」（`getHandler(ctx, N)`）定位，
 * 插在中间会让十几条无关用例整体错位一格；churn 之前是"末尾附近且不改变 churn 的语义位置"。
 */
export function registerKeywordQueryRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = QUERY.ROUTE_PATH;

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const parsed = parseQueryParams(req, res, rc);
      if (!parsed) return;

      // 工作区解析必须在算校验值**之前**（否则身份维度里工作区还是空的，
      // 切到别的工作区会因槽里留着旧图而收到假 304——`dataRoutes` 的 children 路由
      // 在同一位置有同样的注释与顺序要求）。
      const workspacePath = await validateWorkspacePath(ctx, deps, req);
      if (workspacePath === '__denied__') {
        sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
        return;
      }
      if (!workspacePath) {
        sendError(res, 400, ERROR_CODES.NO_WORKSPACE_PATH, req, corsConfig);
        return;
      }

      const input: KeywordQueryInput = { ...parsed, workspacePath };
      const resolved = await resolveGraph(rc, workspacePath);
      if (!resolved) {
        // 取图失败必须是**服务端错误**，不能回空结果：空结果在界面上与
        // 「图里确实没有这个关键词」完全一样（本仓反复记录的「失败伪装成没有数据」）。
        sendError(res, 503, ERROR_CODES.SCAN_FAILED, req, corsConfig, 'upstream graph fetch failed');
        return;
      }

      const { graph, source } = resolved;

      // 校验值的身份维度见 `computeQueryEtag`。生效跳数（`depthEffective`）参与定域，
      // 因为深度 4/5 在库里被钳到 3，载荷与 3 逐字节相同。
      const etag = computeQueryEtag({
        workspacePath,
        query: input.query,
        depth: input.depthEffective,
        tokenBudget: input.tokenBudget,
        revision: graph.metadata.timestamp,
      });
      if (checkEtag(req, res, corsConfig, etag)) return;

      const payload = buildPayload(input, graph, source);
      // 200 必须回写校验值：只写 304 分支会让客户端永远没有可回传的值，
      // 304 分支因此变成「可达但永不命中」的死代码（P3-R18-02）。
      sendJson(res, 200, payload, req, corsConfig, etagHeaders(etag));
    }),
  }), 'codegraph: keyword query route');
}
