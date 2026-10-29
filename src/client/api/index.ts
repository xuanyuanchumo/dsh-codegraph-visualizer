/**
 * 客户端取数层（cycle-110 Q7 重组后的**条件请求 + 按需端点**层）。
 *
 * 重构说明（行为等价，只移动代码）：本文件原先 640 行 / band-detector 122（预算 100、上带 115）。
 * 拆成三个文件：
 *   · `requestCore.ts`   —— `withAbortGuard` / `fetchWithTimeout`（超时与中止的唯一实现）
 *   · `hostRequests.ts`  —— 引导/状态/工作区/扫描/初始化/监听/diff/churn（**不参与** 304 机制）
 *   · 本文件             —— 条件请求机制（`EtagSink` / `settleConditional` / `commitEtag`）
 *                           + 四个按需端点（children / file outline / symbol AST / edges）
 *                           + 增量整图取数（跨工作区收口的唯一入口）+ `fetchAst`
 *
 * **为什么这四个端点和 `fetchGraphDataIncremental` 必须留在本文件**：`tests/unit/etagContract.test.ts`
 * 与 `tests/unit/crossWorkspaceGuardContract.test.ts` 是**按文件**做的源码级契约扫描（切 `\n}\n` 取函数体、
 * 正则匹配签名与守卫行）。把它们搬走会让契约断言变成"在错误的位置上找"，守卫本身没错但会恒红。
 * 这不是设计结论，而是既有守卫的边界——要搬它们必须先改守卫（不在本轮写域内）。
 *
 * 公开面：`hostRequests.ts` / `requestCore.ts` 的符号在这里**原样再导出**，
 * 因此 `from './api/index.ts'` 的调用点（store slices / hooks / components）零改动。
 */
import type { GraphData, GraphNode, GraphEdge } from '../../types/index.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { coerceGraphData } from '../../shared/GraphValidator.ts';
import { isForeignRepo } from '../../shared/graphScope.ts';
import {
  etagKeyForChildren, etagKeyForOutline, etagKeyForAst, etagKeyForEdges, resolveAstBudget,
} from '../../shared/graphFingerprint.ts';
import { BOOTSTRAP } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';
import { withAbortGuard, fetchWithTimeout } from './requestCore.ts';

const log = scoped('client');

// —— 公开面保持：拆出去的符号原样再导出 ——
export { withAbortGuard, fetchWithTimeout } from './requestCore.ts';
export {
  fetchBootstrap,
  fetchStatus,
  fetchWorkspace,
  requestScan,
  requestInit,
  requestWatch,
  fetchGraphDiff,
  fetchHotspotChurn,
} from './hostRequests.ts';
export type {
  BootstrapData,
  WorkspaceInfo,
  DiffGraphData,
} from './hostRequests.ts';

/**
 * 条件请求的**结果旁路**（P3-R18-02）。
 *
 * 为什么需要它：四个按需取数函数的返回类型是 `T | null`，`null` 已经被"失败"占用。而 HTTP 304
 * 与网络失败**必须区分**——把 304 当失败会让"服务器说没变"变成"客户端当作没有数据"，
 * 面板静默清空。所以 304 走这条独立通道，而不是复用 `null`。
 *
 * 调用方**必须**在拿到结果后先读 `sink.notModified`：为真表示服务端确认本次请求键对应的载荷
 * 没有变化，store 应当保留现有状态、只更新"已加载"标记。这条约束由
 * `tests/unit/etagContract.test.ts` 的源码扫描兜底（它检查四个调用点都读了该字段）。
 *
 * 只在调用方显式传入 sink 时才写入；不传时行为与加入本机制之前完全一致（旧调用点零影响）。
 */
export interface EtagSink {
  /** 服务端在这次 200 响应里给出的校验值；无响应或无该头时为 `null`。 */
  etag: string | null;
  /** 服务端回了 304：本请求键对应的载荷未变化，`data` 为 `null` 且**不是**失败。 */
  notModified: boolean;
  /**
   * 本次请求的请求键，由取数函数填。调用方**不应**读它，只在应用完载荷后交给
   * `commitEtag()` —— 见那里的注释。
   */
  key: string | null;
}

/** 构造一个空 sink；调用方先建后传，取数函数负责填充。 */
export function createEtagSink(): EtagSink {
  return { etag: null, notModified: false, key: null };
}

/**
 * 把本次 200 响应的校验值登记进缓存 —— **必须在载荷真正被应用之后调用**。
 *
 * 这是本机制唯一的正确性支点：`settleConditional` 刻意**不**自动登记。若它在收到 200 时就登记，
 * 那么"拿到 200 但调用方因代际过期/令牌过期而丢弃载荷"这条路径会把校验值留在缓存里，
 * 下一次请求带上它就得到 304 —— 而客户端从未应用过那份数据，节点会**永久空白**，
 * 且没有任何错误可见。校验值只能描述"客户端确实持有的那份载荷"。
 */
export function commitEtag(sink: EtagSink): void {
  if (sink.notModified || !sink.key) return;
  rememberEtag(sink.key, sink.etag);
}

/**
 * 条件请求头：有校验值时带上 `if-none-match`，否则不带（首次取数）。
 *
 * 校验值只能**原样回传**，不能由客户端按时间戳拼——host 的校验值含资源维度与请求键维度
 * （见 `computeGraphEtag`），客户端无从推导。
 *
 * 导出给同目录的 `keywordQuery.ts`：关键词检索是第五个参与条件请求的端点，它必须复用
 * **同一套**头构造与同一个校验值缓存。复制一份的代价不是重复代码，而是两侧的缓存上限/
 * 淘汰策略悄悄分叉，最后表现为「某个请求永远拿不到 304」，或更糟——假 304。
 */
export function conditionalHeaders(clientEtag: string | null | undefined): Record<string, string> {
  return clientEtag ? { 'if-none-match': clientEtag } : {};
}

/**
 * 每个请求键上一次拿到的校验值。
 *
 * **不需要显式失效**，这是本设计的关键性质：校验值自身编码了 `(资源, 工作区, 版本, 请求键)`，
 * 换工作区或图变了，缓存里的旧值发出去只会**不匹配**并收到 200——即"多传一次"这个安全方向；
 * 它绝不可能匹配上新版本，因此不存在"假 304 静默吞掉一次真实更新"。因此这个缓存不参与
 * `disposeStore` / 工作区切换的清空清单，也不会成为跨工作区污染的通道。
 *
 * 有界：键含 `nodeId`/`cursor`/`limit`，长时间浏览会累积，故按插入顺序淘汰最旧的条目。
 */
const etagByRequestKey = new Map<string, string>();
const MAX_ETAG_ENTRIES = 256;

/**
 * 登记某个请求键的校验值（条件请求的写入侧）。
 *
 * 与 `etagForRequestKey` 成对，两者一起导出给 `keywordQuery.ts`：第五个参与条件请求的
 * 端点必须读写**同一张表**。若它自建一张，两侧的容量上限与淘汰策略会分叉，且
 * `clearEtagCache()` 只能清一半 ——「整图替换后旧校验值必须失效」这条纪律就会出现
 * 一个静默的逃逸口（重新展开会带着旧值拿到 304，而客户端已经没有那份载荷）。
 */
export function rememberEtag(key: string, etag: string | null): void {
  if (!etag) return;
  // 重新插入以把它移到"最新"位置（Map 保序，最旧的在头部）。
  etagByRequestKey.delete(key);
  etagByRequestKey.set(key, etag);
  while (etagByRequestKey.size > MAX_ETAG_ENTRIES) {
    const oldest = etagByRequestKey.keys().next();
    if (oldest.done) break;
    etagByRequestKey.delete(oldest.value);
  }
}

/**
 * 取某个请求键上一次拿到的校验值（条件请求的读取侧）。
 *
 * 与 `rememberEtag` 成对存在，导出给 `keywordQuery.ts`：第五个参与条件请求的端点必须
 * 读写同一张表。若它自己建一张，两侧的淘汰策略会分叉，且 `clearEtagCache()` 只能清一半 ——
 * 「整图替换后旧校验值必须失效」这条纪律就会出现一个逃逸口。
 */
export function etagForRequestKey(key: string): string | null {
  return etagByRequestKey.get(key) ?? null;
}

/** 仅供测试：清空校验值缓存，避免用例之间互相影响。 */
export function clearEtagCache(): void {
  etagByRequestKey.clear();
}

/**
 * 把一次响应落到 sink 上，并回填校验值缓存。返回 `true` 表示已处理（调用方应停止继续解析）。
 *
 * 304 与网络失败必须分开：`res.ok` 对 304 是 `false`，若沿用 `if (!res.ok) return null`，
 * "服务器说没变"就会被当成"没有数据"，面板静默清空。
 */
function settleConditional(res: Response, key: string, sink: EtagSink | undefined): boolean {
  if (res.status === 304) {
    // 304 也带 etag（`checkEtag` 写了），保留原值即可；没有就沿用缓存里的。
    if (sink) {
      sink.etag = res.headers?.get?.('etag') ?? etagByRequestKey.get(key) ?? null;
      sink.notModified = true;
      sink.key = key;
    }
    return true;
  }
  if (sink) {
    sink.etag = res.headers?.get?.('etag') ?? null;
    sink.notModified = false;
    // 刻意不在此处登记：载荷还没被应用，登记会产生"客户端没有数据却拿到 304"的死角。
    sink.key = key;
  } else {
    // 未传 sink 的旧调用点没有"应用完成"的回调点，只能就地登记，行为与加入本机制前一致。
    rememberEtag(key, res.headers?.get?.('etag') ?? null);
  }
  return false;
}

export interface NodeChildrenData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cursor: string | null;
  total: number;
}

export async function fetchNodeChildren(
  nodeId: string,
  cursor?: string,
  limit?: number,
  signal?: AbortSignal,
  workspace?: string,
  sink?: EtagSink,
): Promise<NodeChildrenData | null> {
  return withAbortGuard('fetchNodeChildren', async () => {
    const resolvedLimit = limit ?? BOOTSTRAP.CHILDREN_PAGE_SIZE;
    const params = new URLSearchParams();
    params.set('nodeId', nodeId);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(resolvedLimit));
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    // 请求键必须与 host 用同一个构造函数产出：`children` 的载荷随 nodeId/cursor/limit 变化，
    // 少任一维度都会让不同响应共用一个校验值（假 304）。
    const requestKey = etagKeyForChildren(nodeId, cursor ?? null, resolvedLimit);
    const options: RequestInit = { headers: conditionalHeaders(etagByRequestKey.get(requestKey)) };
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/children?${params}`, options);
    if (settleConditional(res, requestKey, sink)) return null;
    if (!res.ok) return null;
    return await res.json() as NodeChildrenData;
  }, null, { nodeId });
}

/**
 * `fetchGraphDataIncremental` 的返回：图负载 + 服务端在这次 200 响应里给出的校验值。
 *
 * 校验值必须**原样**回传（`if-none-match`），不能由客户端自己按时间戳拼：host 的校验值是
 * `W/"<revision>-<hash64(资源 + 工作区)>"`（见 `computeGraphEtag`），含身份与资源维度，
 * 客户端无从推导。
 */
export interface IncrementalGraphResult {
  data: GraphData;
  etag: string | null;
}

/**
 * 读取 host 单槽里的图（`/api/v1/codegraph/data`，增量语义：带 `if-none-match` 走 304 短路）。
 *
 * P0 跨工作区污染防护的**唯一收口点**：该端点既不接受 `workspace` 参数、也不做任何过滤，返回的
 * 永远是 host `lastGraphData` 那一个槽里的内容。因此响应必须在这里就与调用方的作用域身份比对，
 * 外来工作区的负载直接丢弃，绝不交给调用方去 `setGraphData`。
 *
 * `scopeRepoId` 是**必填**参数而非可选：任何新增调用点都会被类型检查强制回答"我期望哪个工作区"，
 * 而不是默默继承一个不设防的默认值。这正是 Round 15 遗留 SSE `graph-updated` 漏网的成因——
 * 当时守卫只写在调用点，新增通道时被漏掉。
 *
 * `clientEtag` 同样必填，但**允许为 `null`**（首次取数、或刚切过工作区）。这里刻意不再复用
 * `store.lastUpdated`：那个字段是 `Date.now()`（客户端时钟）与 `metadata.timestamp`（服务端时钟）
 * 混写的展示字段，拿它当校验器会让 304 要么永不命中（每次都全量重取），要么**假命中并静默吞掉
 * 一次真实更新**。校验值域与展示时钟域必须分开。
 */
export async function fetchGraphDataIncremental(
  clientEtag: string | null | undefined,
  scopeRepoId: string | null | undefined,
): Promise<IncrementalGraphResult | null> {
  return withAbortGuard('fetchGraphDataIncremental', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/data', {
      headers: clientEtag ? { 'if-none-match': clientEtag } : {},
    });
    if (res.status === 304) return null;
    if (!res.ok) return null;
    const data = coerceGraphData(await res.json());
    if (!data) return null;
    // host 只保留一个槽：槽里可能装着别的工作区的图，按作用域身份丢弃。
    if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {
      log.info('incremental graph fetch ignored for another workspace', {
        repoId: data.metadata.repoId,
        activeRepoId: scopeRepoId,
      });
      return null;
    }
    // 校验值与负载一起返回，调用方必须**同一次** `_set` 落库：两者分开写会出现
    // "画布已是新版、校验值还是旧版"的窗口，下一次请求就会假 304。
    return { data, etag: res.headers?.get('etag') ?? null };
  }, null, { url: '/api/v1/codegraph/data' });
}

export interface FileOutlineData {
  symbols: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchFileOutline(
  nodeId: string,
  signal?: AbortSignal,
  workspace?: string,
  sink?: EtagSink,
): Promise<FileOutlineData | null> {
  return withAbortGuard('fetchFileOutline', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    // `outline` 的载荷只随 nodeId 变化（工作区已在 repoId 维度里）。
    const requestKey = etagKeyForOutline(nodeId);
    const options: RequestInit = { headers: conditionalHeaders(etagByRequestKey.get(requestKey)) };
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/files/${encodeURIComponent(nodeId)}/outline${qs ? `?${qs}` : ''}`, options);
    if (settleConditional(res, requestKey, sink)) return null;
    if (!res.ok) return null;
    const data = await res.json() as FileOutlineData;
    return {
      symbols: data.symbols ?? [],
      edges: data.edges ?? [],
    };
  }, null, { nodeId });
}

export interface SymbolASTData {
  astNodes: GraphNode[];
  astEdges: GraphEdge[];
  sourceLines: string[];
  /** Total AST node count the server holds for this symbol, before the page cut. */
  total: number;
  /** Offset to send as `cursor` to fetch the next page. */
  cursor: number;
  /**
   * `true` when the server cut the AST at the single-symbol budget
   * (`SYMBOL_AST.MAX_NODES`) and more nodes remain. The caller must disclose
   * this and offer segmented loading, otherwise the folded part is lost
   * silently — see `docs/图谱按需加载.md` 「超限时显示…分段加载」.
   */
  hasMore: boolean;
}

export async function fetchSymbolAST(
  nodeId: string,
  signal?: AbortSignal,
  workspace?: string,
  cursor?: number,
  sink?: EtagSink,
): Promise<SymbolASTData | null> {
  return withAbortGuard('fetchSymbolAST', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const resolvedCursor = cursor !== undefined && cursor > 0 ? cursor : 0;
    if (resolvedCursor > 0) params.set('cursor', String(resolvedCursor));
    // 客户端不发 `budget`，两侧都用 `resolveAstBudget(null)` 算出同一个值——**不能**各自写常量，
    // 否则 host 一旦改动预算语义，请求键就静默分叉、校验值永远匹配不上。
    const requestKey = etagKeyForAst(nodeId, resolvedCursor, resolveAstBudget(null));
    const options: RequestInit = { headers: conditionalHeaders(etagByRequestKey.get(requestKey)) };
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/symbols/${encodeURIComponent(nodeId)}/ast${qs ? `?${qs}` : ''}`, options);
    if (settleConditional(res, requestKey, sink)) return null;
    if (!res.ok) return null;
    const data = await res.json() as SymbolASTData;
    const astNodes = data.astNodes ?? [];
    return {
      astNodes,
      astEdges: data.astEdges ?? [],
      sourceLines: data.sourceLines ?? [],
      total: typeof data.total === 'number' ? data.total : astNodes.length,
      cursor: typeof data.cursor === 'number' ? data.cursor : astNodes.length,
      hasMore: data.hasMore === true,
    };
  }, null, { nodeId });
}

/**
 * POST /api/v1/codegraph/ast, carrying the caller's selected workspace.
 *
 * The route resolves `filePath` against a workspace, and used to always pick whichever workspace the
 * host listed first (`findWorkspacePath`). Sending `?workspace=` makes the request address the
 * workspace the user is actually looking at, the same way `fetchBootstrap` / `fetchFileOutline` /
 * `fetchSymbolAST` / `fetchEdges` already do.
 *
 * 留在本文件的原因：`tests/unit/workspacePathContract.test.ts` 扫描 `src/client` 下所有含
 * `/api/v1/codegraph/ast` 的文件并要求**恰好两个**（本文件与 `diagram/index.ts`）。
 * 搬到第三个文件会让这条契约变红——那是守卫的边界，不是缺陷。
 */
export async function fetchAst(filePath: string, signal?: AbortSignal, workspace?: string): Promise<ASTNode | null> {
  return withAbortGuard('fetchAst', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const qs = params.toString();
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    };
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/ast${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    return await res.json() as ASTNode;
  }, null, { filePath });
}

export interface EdgesData {
  edges: GraphEdge[];
  total: number;
  cursor: number;
  hasMore: boolean;
  /**
   * Present and `true` when the server collapsed a dense neighbourhood into
   * one synthetic edge per file pair (`/edges` returns this instead of paging
   * when the unaggregated edge count exceeds `EDGES_AGGREGATION.THRESHOLD`).
   */
  aggregated?: boolean;
}

/**
 * 拉取某节点的邻接边。
 *
 * `detail` 为 `true` 时请求**未聚合**的原始边（服务端收到 `detail=1` 会跳过文件对聚合）。
 * 用于详情面板的「展开明细」：默认请求会被服务端折叠成每文件对一条合成边，
 * 用户要看真实连接就必须显式声明。
 */
export async function fetchEdges(fromId: string, scope: 'file' | 'symbol' = 'file', cursor?: number, limit?: number, signal?: AbortSignal, workspace?: string, detail?: boolean, sink?: EtagSink): Promise<EdgesData | null> {
  return withAbortGuard('fetchEdges', async () => {
    const params = new URLSearchParams();
    params.set('from', fromId);
    params.set('scope', scope);
    const resolvedCursor = cursor ?? 0;
    const resolvedLimit = limit ?? 500;
    if (cursor !== undefined) params.set('cursor', String(cursor));
    params.set('limit', String(resolvedLimit));
    // 只在需要明细时才发参数：默认（聚合）请求保持原有 URL 形状不变。
    if (detail === true) params.set('detail', '1');
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    // `detail` 也进请求键：同一节点的聚合页与明细页是两份不同载荷，共用一个校验值会假 304。
    const requestKey = etagKeyForEdges(fromId, scope, resolvedCursor, resolvedLimit, detail === true);
    const options: RequestInit = { headers: conditionalHeaders(etagByRequestKey.get(requestKey)) };
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/edges?${params}`, options);
    if (settleConditional(res, requestKey, sink)) return null;
    if (!res.ok) return null;
    return await res.json() as EdgesData;
  }, null, { fromId, scope });
}
