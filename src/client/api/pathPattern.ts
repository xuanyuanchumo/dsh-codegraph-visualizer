/**
 * 璇玑图 ρ（边类型序列正则）的取数层（cycle-135）。
 *
 * ## 为什么单独成文件而不是塞进 `api/index.ts`
 *
 * `api/index.ts` 里的端点被 `tests/unit/etagContract.test.ts` 与
 * `crossWorkspaceGuardContract.test.ts` 按**文件名 + 函数文本切片**做源码契约扫描。
 * 更关键的是：宿主路由 `/api/v1/codegraph/paths` 在 cycle-124 的头部注释里明确
 * **刻意不加 etag**（消费面不存在 + 请求键维度爆炸 + 计算成本已被池化抵消），
 * 而 `api/index.ts` 是「参与条件请求的端点」的集合。把这条不挂校验值的路由塞进
 * 那堆 `fetchWithTimeout + conditionalHeaders + rememberEtag` 的同构代码里，
 * 会凭空多出一份「这里该挂校验值」的暗示，也会让「两条数据路径共享一个实现」
 * 变成「两条数据路径长得一样」。
 *
 * 因此这里刻意保持**最小形状**：只用 `fetchWithTimeout` 拿超时守卫，不碰
 * `conditionalHeaders` / `etagForRequestKey` / `rememberEtag`。契约由本文件自己的
 * 用例承担（`tests/unit/pathPatternApi.test.ts`）。
 *
 * ## 返回值为什么是判别联合
 *
 * ρ 的失败形态比关键词检索**多一种**，而且多出的那一种正是本任务的核心不变量：
 *
 * | 宿主响应 | 含义 | 客户端终态 |
 * | --- | --- | --- |
 * | 200 + `paths: []` + `unknownEdgeTypes: []` | 合法零结果 | `empty`（没有匹配） |
 * | 200 + `paths: []` + `unknownEdgeTypes: ['calls']` | **用户拼错了类型名** | `unknown-types` |
 * | 400 + `error: 'invalid-pattern'` | ρ 语法错误 | `invalid`（带 ^ 诊断） |
 * | 200 + `reason: 'no-graph-data'` | 没有图可查 | `not-found` |
 * | 超时 | 本地预算用尽 | `timeout` |
 * | 其它非 2xx / 非 JSON | 网络或服务端故障 | `failed` |
 *
 * 把「拼错类型名」与「合法零结果」都归进 `empty`，用户会看到一句「没有匹配」，
 * 于是永远不知道是自己打错了 `calls` 而不是图上真的没有 call 边——这正是
 * `src/shared/analysis/XuanjiAdapter.ts` 在 cycle-135 单独加 `unknownEdgeTypes`
 * 字段的原因。判别联合把「是哪一种」交给类型系统回答，而不是让调用方数可空字段。
 *
 * ## 与 `keywordQuery.ts` 的差异（刻意不复制的部分）
 *
 * `keywordQuery.ts` 复用 `conditionalHeaders` / `etagForRequestKey` / `commitEtag`，
 * 因为它走条件请求。本路由明确**不**挂校验值（见上），所以这里不 import 那些符号——
 * 少一个 import 就是少一处「这里应该也做条件请求」的暗示。
 */
import { scoped } from '../../shared/Logger.ts';
import { fetchWithTimeout } from './requestCore.ts';

const log = scoped('client');

/** 一条被枚举出来的路径：`ids` 是节点 id 序列，`labels` 是同序的展示名。 */
export interface PathPatternPath {
  ids: string[];
  labels: string[];
}

/** ρ 枚举的一次成功响应（与宿主 `runPatternBranch` 的形状逐字段对齐）。 */
export interface PathPatternData {
  /** 回显的原始 ρ（调用方可断言「我拿到的确实是这条模式的结果」）。 */
  pattern: string;
  /** ρ 里出现过的边类型（含拼错的；诊断用）。 */
  patternEdgeTypes: string[];
  /** 编译后的 NFA 状态数（预算/性能诊断用）。 */
  stateCount: number;
  /**
   * ρ 里出现、但不在 Σ（`GraphEdge.type` 取值域）里的类型名（cycle-135）。
   *
   * 非空时 `paths` 必为空，且**不是语法错误**——是「用户拼错了类型名」。
   * 调用方必须据此区分它与「图上确实没有这种边」（后者 `unknownEdgeTypes: []`）。
   */
  unknownEdgeTypes: string[];
  paths: PathPatternPath[];
  /** 是否因 `limit` 截断。 */
  truncated: boolean;
  /** 本页条数。 */
  total: number;
  /** 下一页游标；`null` 表示没有更多。 */
  nextCursor: number | null;
  /**
   * 宿主给的图元信息。刻意**不是**可空：宿主在任何分支都给出 `metadata`
   * （`no-graph-data` 分支被提前分流，走不到归一化）。若归一化把它写成 `null`，
   * 调用方就要写 `metadata?.repoId ?? ''`，而「缺字段」与「没有图」在类型上
   * 就分不开了。缺字段时回落空串/0，比 null 更安全（面板宁可显示空 repo 也不猜）。
   */
  metadata: { repoId: string; edgeCount: number };
}

/** 一次 ρ 枚举的五分支结果：让「是哪一种」由类型回答。 */
export type PathPatternOutcome =
  | { kind: 'data'; data: PathPatternData }
  /** ρ 语法错误（宿主 400 `error: 'invalid-pattern'`）。 */
  | { kind: 'invalid'; error: string; diagnostic: string }
  /** 没有图可查（宿主 200 `reason: 'no-graph-data'`）。 */
  | { kind: 'not-found' }
  /** 请求超时（本地预算用尽），与网络失败分开。 */
  | { kind: 'timeout' }
  /** 网络/解析/非 2xx 失败。 */
  | { kind: 'failed'; status?: number };

export interface PathPatternParams {
  /** ρ 文本（必填）。 */
  pattern: string;
  /** 起点节点 id；限定后只从该点出发（缩小起点，不是过滤结果）。 */
  startNode?: string;
  /** 终点节点 id；作为 ρ 之外的附加终点谓词。 */
  endNode?: string;
  minHops?: number;
  maxHops?: number;
  limit?: number;
  /** 翻页游标（已返回条数）。 */
  cursor?: number;
  /** 是否闭合（环形态的 ρ）。 */
  closed?: boolean;
  /**
   * 只在 `!== '.'` 时才发送（`'.'` 是「未指定」的哨兵值，发出去只会让宿主的
   * 请求键分叉）。与 `keywordQuery.ts` 的同一约定。
   */
  workspace?: string;
}

/**
 * 把宿主响应归一成 `PathPatternData`。
 *
 * 归一而不是直接 `as`：ρ 的诊断完全依赖字段的**存在性**（`unknownEdgeTypes`
 * 缺一条就会让面板把「拼错」显示成「没有匹配」）。用逐字段判定把脏数据挡在
 * 边界上，而不是让它以「面板显示错文案」的形式在别处爆炸。
 */
export function normalizePathPatternData(payload: unknown): PathPatternData {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const paths: PathPatternPath[] = Array.isArray(raw.paths)
    ? raw.paths
        .filter((path): path is Record<string, unknown> => !!path && typeof path === 'object')
        .map((path) => ({
          ids: Array.isArray(path.ids) ? path.ids.filter((id): id is string => typeof id === 'string') : [],
          labels: Array.isArray(path.labels) ? path.labels.filter((label): label is string => typeof label === 'string') : [],
        }))
        .filter((path) => path.ids.length > 0)
    : [];
  const patternEdgeTypes = Array.isArray(raw.patternEdgeTypes)
    ? raw.patternEdgeTypes.filter((type): type is string => typeof type === 'string')
    : [];
  const unknownEdgeTypes = Array.isArray(raw.unknownEdgeTypes)
    ? raw.unknownEdgeTypes.filter((type): type is string => typeof type === 'string')
    : [];
  const meta = (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) as
    { repoId?: unknown; edgeCount?: unknown };
  const nextCursor = typeof raw.nextCursor === 'number' && Number.isFinite(raw.nextCursor) ? raw.nextCursor : null;
  return {
    pattern: typeof raw.pattern === 'string' ? raw.pattern : '',
    patternEdgeTypes,
    stateCount: typeof raw.stateCount === 'number' && Number.isFinite(raw.stateCount) ? raw.stateCount : 0,
    unknownEdgeTypes,
    paths,
    truncated: raw.truncated === true,
    total: typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : paths.length,
    nextCursor,
    metadata: {
      repoId: typeof meta.repoId === 'string' ? meta.repoId : '',
      edgeCount: typeof meta.edgeCount === 'number' && Number.isFinite(meta.edgeCount) ? meta.edgeCount : 0,
    },
  };
}

/**
 * 拉取一次 ρ 路径模式枚举。
 *
 * `signal` 仅用于调用方主动取消（组件卸载 / 新请求取代旧请求）；超时预算由
 * `fetchWithTimeout` 的内部控制器负责。两者产物同为 AbortError，故用「外部 signal
 * 是否已 aborted」把「用户取消/被取代」与「超时」分开：取消时**不**当作错误——
 * 调用方会因请求令牌不匹配而丢弃它，而把它误记成失败会在用户连续按 Enter 时
 * 闪出一条假错误（与 `keywordQuery.ts` 同一取舍）。
 */
export async function fetchPathsByPattern(
  params: PathPatternParams,
  signal?: AbortSignal,
): Promise<PathPatternOutcome> {
  const search = new URLSearchParams();
  search.set('pattern', params.pattern);
  if (params.startNode) search.set('startNode', params.startNode);
  if (params.endNode) search.set('endNode', params.endNode);
  if (params.minHops !== undefined) search.set('minHops', String(params.minHops));
  if (params.maxHops !== undefined) search.set('maxHops', String(params.maxHops));
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor !== undefined) search.set('cursor', String(params.cursor));
  if (params.closed === true) search.set('closed', '1');
  if (params.workspace && params.workspace !== '.') search.set('workspace', params.workspace);

  const options: RequestInit = {};
  if (signal) options.signal = signal;

  let res: Response;
  try {
    res = await fetchWithTimeout(`/api/v1/codegraph/paths?${search.toString()}`, options);
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    log.warn('fetchPathsByPattern failed', {
      aborted,
      externalAborted: signal?.aborted === true,
      error: e instanceof Error ? e.message : String(e),
    });
    // 外部 signal 已 aborted ⇒ 调用方主动放弃；否则是本地超时预算用尽。
    if (aborted && signal?.aborted !== true) return { kind: 'timeout' };
    return { kind: 'failed' };
  }

  // ρ 语法错误走 400，**必须**在通用 `!res.ok` 之前判出来：它的 body 里带着
  // `error: 'invalid-pattern'` 与 `^` 指位诊断，而通用失败分支会把它说成「网络故障」。
  if (res.status === 400) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // 400 但响应不是 JSON（反向代理的错误页）：不伪装成语法错误，退化成通用失败。
      return { kind: 'failed', status: res.status };
    }
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const errorCode = typeof record.error === 'string' ? record.error : 'invalid-pattern';
    const diagnostic = typeof record.diagnostic === 'string' ? record.diagnostic
      : typeof record.message === 'string' ? record.message
        : '';
    log.warn('fetchPathsByPattern: invalid pattern', { errorCode, diagnostic });
    return { kind: 'invalid', error: errorCode, diagnostic };
  }

  if (!res.ok) return { kind: 'failed', status: res.status };

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (e) {
    // 非 JSON 响应（旧宿主 404 文本、反向代理错误页）绝不能伪装成"没有结果"：
    // 那会把一次基础设施故障说成「图里没有这条路径」。
    log.warn('fetchPathsByPattern: non-JSON body', { error: e instanceof Error ? e.message : String(e) });
    return { kind: 'failed', status: res.status };
  }

  // 无图数据是 200 + `reason`，不是 4xx——它是「当前没有可查的图」，不是故障。
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (record.reason === 'no-graph-data') return { kind: 'not-found' };

  return { kind: 'data', data: normalizePathPatternData(payload) };
}

/**
 * ρ 语法预检的结果。
 *
 * 刻意用**单形状**而不是判别联合：宿主用 **200** 表达「语法对/错」（不是 400），
 * 于是调用方（尤其面板的逐键校验）总是先读 `ok`，失败时再读 `diagnostic`。
 * 判别联合会让「非 2xx / 非 JSON」这种没有 `ok` 的分支与有 `ok` 的分支并存，
 * 调用方每读一个字段都要先收窄类型——而调用方真正需要的是「**先知道能不能解析**」。
 *
 * `kind` 是给「网络/解析失败」的额外判别位（`ok: false` 且 `kind: 'failed'`），
 * 与语法错（`ok: false` 且无 `kind`）区分开；`kind` 在语法对/错分支上刻意缺省，
 * 因此 `toEqual({ok:true, pattern, edgeTypes})` 这类形状断言不会被多余的判别位破坏。
 */
export interface PathPatternSyntaxOutcome {
  /** ρ 能否被解析。语法对/错都用 200 表达，所以它总是存在。 */
  ok: boolean;
  /** 仅在失败分支给出：`'failed'`（网络/非 2xx/非 JSON）或 `'timeout'`。 */
  kind?: 'failed' | 'timeout';
  /** 回显的 ρ。 */
  pattern: string;
  /** 语法错时的错误码（如 `invalid-pattern`）。 */
  error?: string;
  /** 语法错时的 `^` 指位诊断。 */
  diagnostic?: string;
  /** 宿主回显的 Σ 全集（客户端不复制类型名列表）。 */
  edgeTypes: string[];
  /** 失败分支的 HTTP 状态码。 */
  status?: number;
}

/**
 * 拉取一次 ρ 语法预检（`GET /api/v1/codegraph/path-pattern/syntax`）。 *
 * 宿主回显 Σ（合法边类型全集），客户端**不复制**这份列表——复制就会静默分叉。
 * 预检只回答「ρ 能不能被解析」，不回答「类型名对不对」（后者依赖图上的边，
 * 是 `/paths?pattern=` 的职责）。
 */
export async function fetchPathPatternSyntax(
  pattern: string,
  signal?: AbortSignal,
): Promise<PathPatternSyntaxOutcome> {
  const search = new URLSearchParams();
  search.set('pattern', pattern);

  const options: RequestInit = {};
  if (signal) options.signal = signal;

  let res: Response;
  try {
    res = await fetchWithTimeout(`/api/v1/codegraph/path-pattern/syntax?${search.toString()}`, options);
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    log.warn('fetchPathPatternSyntax failed', {
      aborted,
      externalAborted: signal?.aborted === true,
      error: e instanceof Error ? e.message : String(e),
    });
    // 语法预检没有「图」可查，超时/取消没有额外语义：一律归为 `failed`。
    return { ok: false, kind: 'failed', pattern, edgeTypes: [] };
  }

  if (!res.ok) return { ok: false, kind: 'failed', pattern, edgeTypes: [], status: res.status };

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (e) {
    log.warn('fetchPathPatternSyntax: non-JSON body', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, kind: 'failed', pattern, edgeTypes: [], status: res.status };
  }

  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const echoed = typeof record.pattern === 'string' ? record.pattern : pattern;
  const edgeTypes = Array.isArray(record.edgeTypes)
    ? record.edgeTypes.filter((type): type is string => typeof type === 'string')
    : [];
  if (record.ok === true) {
    return { ok: true, pattern: echoed, edgeTypes };
  }
  return {
    ok: false,
    pattern: echoed,
    error: typeof record.error === 'string' ? record.error : '',
    diagnostic: typeof record.diagnostic === 'string' ? record.diagnostic
      : typeof record.message === 'string' ? record.message
        : '',
    edgeTypes,
  };
}
