/**
 * 宿主「命令式」端点：引导/状态/工作区/扫描/初始化/监听/版本对比/变更频率
 * （cycle-110 Q7 行为等价提取，从 `api/index.ts` 抽出）。
 *
 * 抽取契约：
 *   · 这些端点**不参与条件请求（etag/304）机制**——它们的载荷要么是命令回执，要么是一次性快照，
 *     没有「校验值 ⇒ 304」的语义。因此这里既不建 `EtagSink` 也不读 `if-none-match`；
 *     带 sink 的四个按需端点仍在 `api/index.ts`（有用例按文件+函数文本钉住，不能搬走）。
 *   · 失败语义各不相同，且是**有意的**，逐条固定：
 *       `fetchBootstrap` / `fetchWorkspace` 回落成安全的空骨架；
 *       `fetchStatus` 回落成「四个能力位全 false」（不知道 ≠ 可用，见 §61.10）；
 *       `requestScan` / `requestInit` / `fetchGraphDiff` / `fetchHotspotChurn` 回落成 `null`
 *         ——「这次没做成」必须能与「做成了但没有数据」区分，绝不用空对象冒充成功。
 *   · `workspace` 参数一律在 `!== '.'` 时才发送：`'.'` 是「未指定」的哨兵值，
 *     发出去只会让请求键分叉。
 *
 * 公开面：原本从 `api/index.ts` 导入这些符号的调用点不受影响——`api/index.ts` 原样再导出。
 */
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { coerceNode, coerceEdge } from '../../shared/GraphValidator.ts';
import type { ChurnResult } from '../../shared/churn.ts';
import { API } from '../../shared/constants.ts';
import { withAbortGuard, fetchWithTimeout } from './requestCore.ts';
import { normalizePrerequisiteStatus, type PrerequisiteStatus } from '../../shared/prerequisiteStatus.ts';

export interface BootstrapData {
  rootNodes: GraphNode[];
  topLevelNodes: GraphNode[];
  topLevelTotal: number;
  edges: GraphEdge[];
  indexStatus: 'ready' | 'building' | 'empty';
  metadata: {
    repoId: string;
    timestamp: number;
    totalNodeCount: number;
    totalEdgeCount: number;
    /**
     * 图层来源声明（cycle-130 · T2）：数据来自上游索引（'upstream'）、原生
     * 通道（'native'）还是空态（'empty'）。host /bootstrap 响应可能缺席
     * （旧版 host / 未走原生链路）——缺席时不显示来源徽章（宁缺勿造）。
     */
    graphLayer?: 'upstream' | 'native' | 'empty';
  };
}

export async function fetchBootstrap(signal?: AbortSignal, workspace?: string): Promise<BootstrapData | null> {
  return withAbortGuard('fetchBootstrap', async () => {
    const params = new URLSearchParams();
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const qs = params.toString();
    const res = await fetchWithTimeout(`/api/v1/codegraph/bootstrap${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const data = await res.json() as BootstrapData;
    return {
      rootNodes: data.rootNodes ?? [],
      topLevelNodes: data.topLevelNodes ?? [],
      topLevelTotal: data.topLevelTotal ?? 0,
      edges: data.edges ?? [],
      indexStatus: data.indexStatus ?? 'empty',
      metadata: data.metadata ?? { repoId: '', timestamp: 0, totalNodeCount: 0, totalEdgeCount: 0 },
    };
  }, null);
}

/**
 * 取能力位。
 *
 * 回落方向都被 `normalizePrerequisiteStatus` 统一处理，这里不再自己拼一遍字段：
 *   · **新宿主**：四个位齐全，原样采纳；
 *   · **缺字段 / 请求失败**：全 `false`（cycle-118 起 `builtin` 别名已移除，
 *     旧宿主残缺载荷同样按「不知道」处理，不再从别名推导）。
 *
 * 修前的失败回落写的是 `builtin: true` —— 那正是 §61.10 的假叙事在客户端的镜像：
 * 宿主根本没应答，客户端却断言"内置通道可用"。**不知道**必须是 `false`：它会让空态不显示
 * 「降级模式」（因为确实无法确认有降级手段），而这比承诺一个不存在的通道更接近真相。
 */
export async function fetchStatus(): Promise<PrerequisiteStatus> {
  const failure = normalizePrerequisiteStatus({});
  return withAbortGuard('fetchStatus', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/status');
    if (!res.ok) return normalizePrerequisiteStatus({});
    const data = await res.json();
    return normalizePrerequisiteStatus(data);
  }, failure, { url: '/api/v1/codegraph/status' });
}

export interface WorkspaceInfo {
  path: string;
  list: string[];
  /** Diagnostics (docs/需求分析.md §31.7): which host source produced the allowed roots. */
  rootSource?: string;
  allowedRoots?: string[];
  resolvedFrom?: string[];
}

export async function fetchWorkspace(): Promise<WorkspaceInfo> {
  return withAbortGuard('fetchWorkspace', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/workspace');
    if (!res.ok) return { path: '.', list: [] };
    const data = await res.json() as Partial<WorkspaceInfo>;
    const info: WorkspaceInfo = { path: data.path ?? '.', list: data.list ?? [] };
    // Diagnostics are optional: an older host does not send them.
    if (data.rootSource !== undefined) info.rootSource = data.rootSource;
    if (data.allowedRoots !== undefined) info.allowedRoots = data.allowedRoots;
    if (data.resolvedFrom !== undefined) info.resolvedFrom = data.resolvedFrom;
    return info;
  }, { path: '.', list: [] });
}

export async function requestScan(path: string, maxNodes?: number): Promise<{ success: boolean; nodes: unknown[]; edges: unknown[]; metadata?: Record<string, unknown> } | null> {
  return withAbortGuard('requestScan', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, maxNodes }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  }, null);
}

export async function requestInit(path: string): Promise<{ success: boolean; message: string } | null> {
  return withAbortGuard('requestInit', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.json();
  }, null);
}

/**
 * 版本对比（diff）请求的结果。
 *
 * `nodes` / `edges` 是**只含变更项**的子图（宿主 `diffToGraphData` 已把 `diffStatus`
 * 写进每个元素的 `properties`），不是完整图。刻意不复用 `GraphData` 类型：把它当完整图交给
 * `setGraphData` 会把画布替换成「只有变更项」的残图——这正是本接口返回一个独立类型的原因，
 * 调用方只能把它交给 `applyDiffResult`，不可能误当作整图负载。
 */
export interface DiffGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 请求所用的基线引用（原样回显，供面板显示「main → feature」）。 */
  from: string;
  to: string;
  /**
   * 本次 diff 的粒度（cycle-105 P0-D 修复后新增）。
   *
   * `'file'` 表示「只对比到文件级」：`codegraph.db` 没有 revision 维度，符号级 diff
   * 在数据面上不可实现，宿主改用 `git diff --raw` 给出变更文件清单。面板必须据此把
   * 文案从「结构变更」改成「文件变更」，否则用户会以为符号级也对比过了。
   *
   * 缺省 `'file'`：多代宿主里更老的版本可能不带这个字段，而它们实际给的都是文件级
   * 粒度（或空 diff）。把缺省值取成更保守的那个，比取成「假装做到了符号级」安全。
   */
  granularity: 'file';
  /**
   * 是否被宿主的上限截断（`GIT_DIFF.MAX_FILES`）。
   *
   * 一份被截断的清单看起来与完整清单一模一样，用户会以为「只改了这些文件」。
   * 面板必须能显式说明「只覆盖前 N 个文件」。
   */
  truncated: boolean;
}

/**
 * 请求两个 git 引用之间的图差异（`POST /api/v1/codegraph/diff`）。
 *
 * 研究报告 §六 #13 指出：数据层早已存在（`DiffEngine.diffToGraphData` + `/diff` 路由），
 * 但客户端从未调用过它——这条能力长期只有出口没有入口。本函数补上入口。
 *
 * 返回 `null` 表示**请求失败或宿主不可用**（上游 codegraph 缺失、git 引用非法、网络错误）。
 * 刻意不返回「空 diff」来冒充成功：面板必须能区分「两版本完全相同」与「这次对比根本没做成」，
 * 否则用户会把一次失败读成「没有任何变更」。
 */
export async function fetchGraphDiff(
  from: string,
  to: string,
  signal?: AbortSignal,
  workspace?: string,
): Promise<DiffGraphData | null> {
  return withAbortGuard('fetchGraphDiff', async () => {
    const body: Record<string, string> = { from, to };
    // 与其它按需路由同形：`workspace` 只在非默认值时才发，避免给「当前工作区」这一
    // 最常见路径附加一个无意义的参数（也就不会因为参数拼写差异导致缓存键分叉）。
    if (workspace && workspace !== '.') body.workspace = workspace;
    const options: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout('/api/v1/codegraph/diff', options);
    if (!res.ok) return null;
    const payload = await res.json() as {
      nodes?: unknown;
      edges?: unknown;
      granularity?: unknown;
      truncated?: unknown;
    };
    // 复用与整图同一套字段归一化：`diffStatus` 落在 `properties` 里，因此这里不需要
    // 单独解析它——但必须经过 `coerceNode`/`coerceEdge`，否则上游给的裸 `from`/`to`
    // 字段名不会被归一化成 `source`/`target`，边的端点会全部丢失。
    const nodes = Array.isArray(payload.nodes)
      ? payload.nodes.map(coerceNode).filter((n): n is GraphNode => n !== null)
      : [];
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = Array.isArray(payload.edges)
      ? payload.edges
        .map(coerceEdge)
        .filter((e): e is GraphEdge => e !== null)
        // 与整图路径同一条约束：端点不在本次负载里的边无法渲染，留着只会让
        // cytoscape 抛「edge endpoint not found」。
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      : [];
    return {
      nodes,
      edges,
      from,
      to,
      // 多代宿主兼容：`granularity` 不是合法值（缺失 / 未知字符串）时取 `'file'`——
      // 这是唯一有实现的粒度，也是更保守的那个（不会假装做到了符号级）。
      granularity: 'file',
      // 只有**明确**是布尔 `true` 才算截断。字符串 `"true"`、数字 1 都不算：
      // 把「不确定」判成截断会让面板常驻一条警告，而漏报截断只是少一条提示。
      truncated: payload.truncated === true,
    };
  }, null, { from, to });
}

export async function requestWatch(enabled: boolean, path: string): Promise<boolean> {
  return withAbortGuard('requestWatch', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, path }),
    });
    return res.ok;
  }, false);
}

/**
 * 请求工作区的 git 变更频率（`GET /api/v1/codegraph/churn`，研究报告 §六 #11）。
 *
 * 返回 `null` 表示**这次请求没做成**（网络错误 / 宿主不可用 / 非 2xx）。
 * 返回一个 `available: false` 的对象表示**宿主答复了，但它也没拿到 git 数据**
 * （目录不是仓库、git 未安装、超时）。这两种情况都必须与「真的 0 次变更」区分开：
 * 前者面板显示「无法获取」，后者显示「未获取到变更频率（仅按依赖关系排序）」。
 *
 * 刻意**不**把失败归一成 `{ byFile: {} }`：那会让热点排序看起来正常，
 * 而用户完全不知道支撑这份排序的变更频率其实是空的。
 */
export async function fetchHotspotChurn(
  signal?: AbortSignal,
  workspace?: string,
): Promise<ChurnResult | null> {
  return withAbortGuard('fetchHotspotChurn', async () => {
    const params = new URLSearchParams();
    // 与其它按工作区寻址的接口同形：`'.'` 是"未指定"的哨兵值，不发送。
    if (workspace && workspace !== '.') params.set('workspace', workspace);
    const qs = params.toString();
    const options: RequestInit = {};
    if (signal) options.signal = signal;
    const res = await fetchWithTimeout(`/api/v1/codegraph/churn${qs ? `?${qs}` : ''}`, options);
    if (!res.ok) return null;
    const payload = await res.json() as Partial<ChurnResult>;
    // 逐字段归一：老宿主可能没有 `error`，也可能把 `byFile` 发成 `null`。
    // 缺 `available` 时按 `false` 处理——「不知道是否拿到数据」绝不能当成「拿到了」。
    const byFile: Record<string, number> = {};
    if (payload.byFile && typeof payload.byFile === 'object') {
      for (const [key, value] of Object.entries(payload.byFile)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) byFile[key] = value;
      }
    }
    return {
      byFile,
      commitCount: typeof payload.commitCount === 'number' ? payload.commitCount : 0,
      revision: typeof payload.revision === 'string' ? payload.revision : null,
      truncated: payload.truncated === true,
      available: payload.available === true,
      error: typeof payload.error === 'string' ? payload.error : null,
    };
  }, null, { workspace });
}


/** 注册矩阵看板载荷（cycle-117）。宿主 `/registry` 路由的响应形状（客户端只消费摘要 + live）。 */
export interface RegistryBoard {
  version: number;
  total: number;
  byFace: Record<string, number>;
  brokenLinks: string[];
  lifecycleCounts: Record<string, number>;
  liveCounts?: Record<string, number>;
  entries: { id: string; face: string; produces: string; consumers: string[]; lifecycle: string; registeredAt: string }[];
  live?: { id: string; face: string; live: string; basis: string }[];
}

/**
 * 拉注册-生产-消费矩阵（cycle-117 可观测性看板）。
 *
 * 失败语义：回落 `null`——「这次没拉到」与「拉到了但矩阵为空」必须可区分；
 * 看板对 `null` 显示「矩阵不可达」，绝不用空对象冒充成功。
 */
export async function fetchRegistryBoard(): Promise<RegistryBoard | null> {
  const failure: RegistryBoard | null = null;
  return withAbortGuard('fetchRegistryBoard', async () => {
    const res = await fetchWithTimeout('/api/v1/codegraph/registry');
    if (!res.ok) return null;
    return (await res.json()) as RegistryBoard;
  }, failure, { url: '/api/v1/codegraph/registry' });
}

/** `/paths` 路由的单条路径（ids 与 labels 并行，客户端免二次查表）。 */
export interface PathEnumerationItem {
  ids: string[];
  labels: string[];
}

/** `/paths` 路由的响应（cycle-124：璇玑图路径枚举读法的用户侧出口）。 */
export interface PathEnumerationResponse {
  paths: PathEnumerationItem[];
  truncated: boolean;
  total: number;
  nextCursor: string | number | null;
  reason?: string;
  metadata?: { repoId: string; source: string; target: string; edgeCount: number };
}

/**
 * 路径枚举（`GET /api/v1/codegraph/paths`，cycle-124）。
 *
 * 与 `fetchGraphDiff` 同款纪律：**刻意不返回「空路径」冒充成功**——404（槽空/身份
 * 不符）返回 null，面板据此区分「两符号之间没有路径」与「这次查询根本没做成」。
 * 端点不在图里是 200 + `reason: 'endpoint-not-in-graph'`（与工具同语义）。
 */
export async function fetchPathEnumerate(
  source: string,
  target: string,
  options: { maxHops?: number; limit?: number; edgeTypes?: string; signal?: AbortSignal; workspace?: string } = {},
): Promise<PathEnumerationResponse | null> {
  const params = new URLSearchParams({ source, target });
  if (options.maxHops !== undefined) params.set('maxHops', String(options.maxHops));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.edgeTypes) params.set('edgeTypes', options.edgeTypes);
  if (options.workspace && options.workspace !== '.') params.set('workspace', options.workspace);
  const failure: PathEnumerationResponse | null = null;
  return withAbortGuard('fetchPathEnumerate', async () => {
    const res = await fetchWithTimeout(`/api/v1/codegraph/paths?${params.toString()}`, { signal: options.signal });
    if (!res.ok) return null;
    return (await res.json()) as PathEnumerationResponse;
  }, failure, { url: '/api/v1/codegraph/paths' });
}
