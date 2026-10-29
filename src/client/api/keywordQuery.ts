/**
 * 关键词图检索的取数层（cycle-111 / N-5）。
 *
 * ## 为什么单独成文件而不是塞进 `api/index.ts`
 *
 * `api/index.ts` 里的四个按需端点被 `tests/unit/etagContract.test.ts` 与
 * `crossWorkspaceGuardContract.test.ts` **按文件名 + 函数文本切片**做的源码契约扫描钉住；
 * 把新端点插进去会让"在错误的位置上找"这类恒红风险落在既有守卫上。新端点的契约由它
 * 自己的用例承担（`tests/unit/keywordQueryApi.test.ts`）。
 *
 * ## 为什么返回值是判别联合而不是 `T | null`
 *
 * 本仓两条最贵的教训在这里同时生效：
 *
 * 1. **304 与网络失败必须区分**：`res.ok` 对 304 是 `false`，把 304 并进 `null` 会让
 *    "服务器说没变"变成"没有数据"，面板静默清空。
 * 2. **超时与失败必须区分**（本任务的四态要求）：`fetchWithTimeout` 的 AbortError 与真正的
 *    网络错误在异常层面同形，而用户可见的下一步动作不同（超时建议重试/缩小范围，
 *    失败要看到服务端错误）。
 *
 * 因此 `KeywordQueryOutcome` 把"是哪一种"交给类型系统回答，而不是让调用方数三个可空字段猜。
 *
 * ## 校验值为什么必须走 `api/index.ts` 的同一张表
 *
 * 关键词检索是第五个参与条件请求的端点。若它自建一张 etag 表，两侧的容量上限与淘汰策略
 * 会分叉，而 `clearEtagCache()` 只能清一半——「整图替换后旧校验值必须失效」这条纪律就出现
 * 一个静默的逃逸口。因此读写都复用 `etagForRequestKey` / `rememberEtag`。
 */
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { coerceNode, coerceEdge } from '../../shared/GraphValidator.ts';
import { scoped } from '../../shared/Logger.ts';
import { fetchWithTimeout } from './requestCore.ts';
import { conditionalHeaders, etagForRequestKey, rememberEtag } from './index.ts';

const log = scoped('client');

/** `/query` 的种子（与宿主响应逐字段对齐）。 */
export interface KeywordSeed {
  id: string;
  label: string;
  score: number;
  matchedTerms: string[];
}

/** `/query` 的一次成功响应（宿主 `buildPayload` 的形状）。 */
export interface KeywordQueryResult {
  query: string;
  terms: string[];
  seeds: KeywordSeed[];
  /** 可画高亮的子图节点（与 `text` **同集**，由同一份渲染结果派生）。 */
  nodes: GraphNode[];
  edges: GraphEdge[];
  text: string;
  tokens: number;
  /** 是否被 token 预算截断（graphify 原则：截断必须可见）。 */
  truncated: boolean;
  /** 截断形态：`'fits'` 完整 / `'nodes-only'` 边被省略 / `'truncated'` 节点被截断。 */
  reason: string;
  meta: {
    depth: number;
    depthEffective: number;
    tokenBudget: number;
    source: 'slot' | 'fetched';
    revision: number;
    reason: string;
  };
}

/** 四分支结果：让"是哪一种"由类型回答。 */
export type KeywordQueryOutcome =
  | { kind: 'data'; data: KeywordQueryResult; requestKey: string; etag: string | null }
  /** 服务端确认本请求键对应的载荷未变 —— **不是**失败。 */
  | { kind: 'not-modified' }
  /** 请求超时（本地预算用尽），与网络失败分开。 */
  | { kind: 'timeout' }
  /** 网络/解析/非 2xx 失败。 */
  | { kind: 'failed'; status?: number };

export interface KeywordQueryParams {
  q: string;
  depth?: number;
  tokenBudget?: number;
  /** 只在 `!== '.'` 时才发送（`'.'` 是"未指定"的哨兵值，发出去只会让请求键分叉）。 */
  workspace?: string;
}

/**
 * 条件请求的请求键（与宿主 `computeQueryEtag` 的**参数域**对齐）。
 *
 * 客户端**不参与**校验值的构造——宿主的是 `W/"v1:<hash64(工作区,q,depth,budget,revision)>"`，
 * 含 revision 维度，客户端无从推导，只能原样保存、原样回传。这个键只回答"给哪个请求
 * 记住哪个值"，因此它必须覆盖所有会改变载荷的请求参数：少一维 ⇒ 换了词还能命中上一次的
 * 校验值 ⇒ 客户端发出一个与当前 URL 不对应的 `if-none-match` ⇒ 服务端判 304 ⇒
 * 用户看到的永远是上一个查询的答案。
 */
export function keywordQueryCacheKey(params: KeywordQueryParams): string {
  const depth = params.depth ?? 2;
  const tokenBudget = params.tokenBudget ?? 800;
  const workspace = params.workspace && params.workspace !== '.' ? params.workspace : '';
  // `\u0001` 与宿主一致：不可见分隔符，防止 `q='a\u00012'` 与 `q='a'` 拼出同一串。
  return ['query', workspace, params.q, String(depth), String(tokenBudget)].join('\u0001');
}

/**
 * 拉取一次关键词检索。
 *
 * `signal` 仅用于调用方主动取消（组件卸载 / 新请求取代旧请求）；超时预算由
 * `fetchWithTimeout` 的内部控制器负责。两者产物同为 AbortError，故用「外部 signal 是否已
 * aborted」把"用户取消/被取代"与"超时"分开：取消时**不**当作错误——调用方会因请求令牌
 * 不匹配而丢弃它，而把它误记成失败会在用户连续按 Enter 时闪出一条假错误。
 */
export async function fetchKeywordQuery(
  params: KeywordQueryParams,
  signal?: AbortSignal,
): Promise<KeywordQueryOutcome> {
  const search = new URLSearchParams();
  search.set('q', params.q);
  if (params.depth !== undefined) search.set('depth', String(params.depth));
  if (params.tokenBudget !== undefined) search.set('tokenBudget', String(params.tokenBudget));
  if (params.workspace && params.workspace !== '.') search.set('workspace', params.workspace);

  const requestKey = keywordQueryCacheKey(params);
  const options: RequestInit = { headers: conditionalHeaders(etagForRequestKey(requestKey)) };
  if (signal) options.signal = signal;

  let res: Response;
  try {
    res = await fetchWithTimeout(`/api/v1/codegraph/query?${search.toString()}`, options);
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    log.warn('fetchKeywordQuery failed', {
      aborted,
      externalAborted: signal?.aborted === true,
      error: e instanceof Error ? e.message : String(e),
    });
    // 外部 signal 已 aborted ⇒ 调用方主动放弃；否则是本地超时预算用尽。
    if (aborted && signal?.aborted !== true) return { kind: 'timeout' };
    return { kind: 'failed' };
  }

  // 304 必须在 `!res.ok` **之前**判定：`res.ok` 对 304 是 false。
  if (res.status === 304) return { kind: 'not-modified' };
  if (!res.ok) return { kind: 'failed', status: res.status };

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (e) {
    // 非 JSON 响应（旧宿主 404 文本、反向代理错误页）绝不能伪装成"没有结果"：
    // 那会把一次基础设施故障说成「图里没有这个符号」。
    log.warn('fetchKeywordQuery: non-JSON body', { error: e instanceof Error ? e.message : String(e) });
    return { kind: 'failed', status: res.status };
  }

  // **刻意不在这里登记校验值**：载荷还没被应用。调用方写入 store 之后调
  // `commitKeywordQueryEtag` —— 否则"拿到 200 但因令牌过期丢弃载荷"会让下次请求
  // 命中 304，而客户端从未拥有过那份数据（面板永久空白且无错误可见）。
  return { kind: 'data', data: normalizeKeywordResult(payload), requestKey, etag: res.headers?.get?.('etag') ?? null };
}

/**
 * 载荷应用**之后**登记校验值。
 *
 * 这是本机制唯一的正确性支点，理由见 `api/index.ts` 里 `commitEtag` 的注释：校验值只能
 * 描述"客户端确实持有的那份载荷"。
 */
export function commitKeywordQueryEtag(outcome: KeywordQueryOutcome): void {
  if (outcome.kind !== 'data') return;
  rememberEtag(outcome.requestKey, outcome.etag);
}

/**
 * 把宿主响应归一成 `KeywordQueryResult`。
 *
 * 归一而不是直接 `as`：`nodes` / `edges` 会进 `setGraphData` 的同一套装配管线，脏数据在
 * 那里会以"节点渲染不出来"的形式出现，根因完全不可见。用 `coerceNode` / `coerceEdge`
 * （与 `/data`、`/bootstrap` 同一条归一通道）把字段问题挡在边界上。
 *
 * 缺 `truncated` 时按 `false` 处理是**刻意的**：合法来源只有"旧宿主"，而把"不知道是否
 * 截断"渲染成"已截断"会给每个用户一条假警告。两条独立判据取"或"
 * （`truncated === true || reason !== 'fits'`）：偏向"报告被截断"是安全方向
 * （多一条提示 = 多一次沟通），反过来会静默丢掉用户以为看全了的那部分。
 */
export function normalizeKeywordResult(payload: unknown): KeywordQueryResult {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const seeds: KeywordSeed[] = Array.isArray(raw.seeds)
    ? raw.seeds
        .filter((seed): seed is Record<string, unknown> => !!seed && typeof seed === 'object')
        .map((seed) => ({
          id: typeof seed.id === 'string' ? seed.id : '',
          label: typeof seed.label === 'string' ? seed.label : '',
          score: typeof seed.score === 'number' && Number.isFinite(seed.score) ? seed.score : 0,
          matchedTerms: Array.isArray(seed.matchedTerms)
            ? seed.matchedTerms.filter((term): term is string => typeof term === 'string')
            : [],
        }))
        .filter((seed) => seed.id.length > 0)
    : [];
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((node, index) => coerceNode(node, index))
        .filter((node): node is GraphNode => node !== null)
    : [];
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map((edge, index) => coerceEdge(edge, index))
        .filter((edge): edge is GraphEdge => edge !== null)
    : [];
  const meta = (raw.meta && typeof raw.meta === 'object' ? raw.meta : {}) as Record<string, unknown>;
  const reason = typeof raw.reason === 'string' ? raw.reason : 'fits';
  return {
    query: typeof raw.query === 'string' ? raw.query : '',
    terms: Array.isArray(raw.terms) ? raw.terms.filter((term): term is string => typeof term === 'string') : [],
    seeds,
    nodes,
    edges,
    text: typeof raw.text === 'string' ? raw.text : '',
    tokens: typeof raw.tokens === 'number' && Number.isFinite(raw.tokens) ? raw.tokens : 0,
    truncated: raw.truncated === true || reason !== 'fits',
    reason,
    meta: {
      depth: typeof meta.depth === 'number' ? meta.depth : 0,
      depthEffective: typeof meta.depthEffective === 'number' ? meta.depthEffective : 0,
      tokenBudget: typeof meta.tokenBudget === 'number' ? meta.tokenBudget : 0,
      source: meta.source === 'fetched' ? 'fetched' : 'slot',
      revision: typeof meta.revision === 'number' ? meta.revision : 0,
      reason: typeof meta.reason === 'string' ? meta.reason : reason,
    },
  };
}
