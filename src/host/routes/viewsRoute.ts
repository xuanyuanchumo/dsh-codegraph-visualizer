/**
 * `GET /api/v1/codegraph/views?workspace=<abs>` — Π 视图划分的用户侧出口（cycle-141 / workstream E）。
 *
 * ## 它解决什么
 *
 * `graph_views` 工具（`src/tools.ts`）此前只有模型能调：Π: V ∪ E → 2^{V_view}
 * 的正式实现存在，但用户在界面上没有任何通道看到「每个节点属于哪些正交视图」。
 * 「功能业务注册-生产-消费」在消费端断环——工具注册了、测试覆盖了，唯独没有人能看到。
 *
 * 本路由把这条划分**原样搬到 HTTP 面**：结构视图恒属；时序/所有权视图在缺少
 * 原始 git 输入（`commitLog` / `blameLog`）时**显式降级**（`available: false` + `reason`），
 * 绝不静默补全；领域视图用 Louvain 现算（与工具同一个 `computeDomainLabels`）。
 *
 * ## 图源与「没有索引」的语义
 *
 * 优先读宿主**内存图槽**（`getWorkspaceScopedGraphData`，工作区限定——跨工作区
 * 防护与 `/bootstrap` 等五条路由共用同一判据）；槽空时回落到索引 DB（上游
 * `.codegraph/codegraph.db` 或原生 `.codegraph-visualizer/native-index.db`）。
 * 两者都拿不到 ⇒ HTTP 200 `{ success:false, errorCode:'INDEX_NOT_FOUND' }`。
 * 这与 `manage/metrics` 的口径一致：**没有索引必须说「没有」，不能报一份假的空 Π**。
 *
 * ## 截断必须如实披露
 *
 * `nodeViewMatrix` 采样到最多 500 个节点（UI 表格的可用性护栏），响应同时给出
 * `totalNodes` / `totalEdges` 与 `sampled`——客户端据此显示「已采样 / 共 N 个」，
 * 而不是让用户以为表格就是全图。采样按图内顺序取前 500，**确定性**（同一输入
 * 永远同一张表格）。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { ERROR_CODES, VALIDATION } from '../../shared/constants.ts';
import { RepoId } from '../../types/index.ts';
import type { GraphData, GraphNode } from '../../types/index.ts';
import { resolveDbPath } from '../../adapters/CodeGraphAdapter.ts';
import type { DbNodeRow, DbEdgeRow } from '../../adapters/codeGraphRows.ts';
import { partitionByView, serializeViewPartition } from '../../shared/views.ts';
import type { ViewName } from '../../shared/views.ts';
import { computeDomainLabels } from '../../shared/domain.ts';
import { parseCommitLog, filterSlices, type CommitRange } from '../../shared/temporal.ts';
import { parseGitBlamePorcelain, groupBlameByFile, buildOwnershipMap } from '../../shared/ownership.ts';
import { collectGitRawInput } from '../gitViewsCollector.ts';
import { sendJson, sendError } from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveWorkspaceFromRequest, getWorkspaceScopedGraphData,
  type RouteContext, log,
} from './shared.ts';

/** 路由路径（客户端与测试共用）。 */
export const VIEWS_ROUTE_PATH = '/api/v1/codegraph/views';

/** `nodeViewMatrix` 的采样上限（UI 表格护栏）。 */
export const VIEWS_MATRIX_MAX_NODES = 500;

/**
 * 查询参数里原始 git 日志（`commitLog` / `blameLog`）的字符上限。
 *
 * 这两个参数可能非常大（一次全仓 `git log --name-only` 可达数 MB）。URL 传参没有
 * 服务器侧的天然上界，所以这里显式设限：**超限判为「未提供」而不是截断**——
 * 截断会让解析器拿到半截 git 输出，产生一份看似合法、其实错乱的视图归属。
 */
const VIEWS_RAW_LOG_MAX_CHARS = VALIDATION.MAX_GIT_REF_LENGTH * 64;

/**
 * 回落到索引 DB 时的读取上界。与 `METRICS` 同族：节点与边是**同一处内存护栏的两半**，
 * 只界节点会让边侧无界（代码图谱边数通常是节点数的 2–5 倍）。
 */
const VIEWS_DB = {
  MAX_NODES: 2000,
  MAX_EDGES: 8000,
  PAGE_SIZE: 500,
} as const;

/** 响应里单个视图的摘要（结构视图恒可用；时序/所有权显式降级）。 */
export interface ViewSummary {
  structural: { nodeCount: number; edgeCount: number };
  temporal: { nodeCount: number; edgeCount: number; available: boolean; reason: string | null };
  ownership: { nodeCount: number; edgeCount: number; available: boolean; reason: string | null };
  domain: { nodeCount: number; edgeCount: number; domainCount: number; nodeCounts: Record<string, number> };
}

/** 采样后的节点视图矩阵行。 */
export interface NodeViewRow {
  id: string;
  label: string;
  views: string[];
}

/** 成功响应。 */
export interface ViewsSuccessResponse {
  success: true;
  errorCode: null;
  views: ViewSummary;
  totalNodes: number;
  totalEdges: number;
  nodeViewMatrix: NodeViewRow[];
  sampled: boolean;
  computedAt: number;
  /** git 输入来源披露（cycle-144）：auto=宿主采集，query=调用方显式传参。 */
  gitSources: {
    commitLog: GitSourceInfo;
    blameLog: GitSourceInfo;
  };
}

/** 单条 git 输入通道的来源与采集元数据。 */
interface GitSourceInfo {
  source: 'auto' | 'query';
  available: boolean;
  durationMs: number | null;
  truncated: boolean;
  reason: string | null;
}

/** 失败响应（无索引 / 无工作区）。 */
export interface ViewsErrorResponse {
  success: false;
  errorCode: string;
  views: null;
  error: string;
}

/**
 * 把节点 filePath 投影为 git 相对路径（cycle-146 L2）。
 *
 * 原生扫描图的 filePath 是「工作区绝对路径」域（`D:\…\repo\src\a.ts`），git 输出与
 * 消费端查表键都在「仓库相对路径」域。规则：
 * - 绝对路径且位于 workspacePath 下 → 剥前缀 + 反斜杠归一；
 * - 已经是相对域（上游索引 / DB 图）→ 原样返回（投影是幂等的安全操作）；
 * - 绝对但不在工作区下（异常图）→ 原样返回，让「查表落空」保持现状而不是编造。
 */
export function toGitRelative(filePath: string, workspacePath: string): string {
  const fp = String(filePath ?? '').trim();
  if (fp === '' || !isAbsolute(fp)) return fp;
  const root = resolve(workspacePath);
  const norm = fp.replace(/\//g, sep);
  const resolved = resolve(norm);
  if (resolved === root || !resolved.toLowerCase().startsWith(root.toLowerCase() + sep)) return fp;
  return resolved.slice(root.length + 1).replace(/\\/g, '/');
}

/**
 * 从索引 DB 读一张有界图。
 *
 * 读不到任何一页视为真实失败（索引损坏），抛错由路由的 `catch` 转成 500；
 * 这与 `manage/metrics` 的口径一致——**不能**在文件在场却读不出时退化成「空索引」。
 */
async function readGraphFromIndex(workspacePath: string): Promise<GraphData | null> {
  let dbPath: string | null = null;
  const upstreamDbPath = resolveDbPath(workspacePath);
  if (existsSync(upstreamDbPath)) {
    dbPath = upstreamDbPath;
  } else {
    try {
      const { resolveNativeIndexPath } = await import('../../adapters/nativeIndex.ts');
      const nativePath = resolveNativeIndexPath(workspacePath);
      if (existsSync(nativePath)) dbPath = nativePath;
    } catch (e) {
      // 原生索引路径解析失败不是「没有索引」的同义词：记录后继续回落内存槽。
      log.warn('views route: native index path rejected', e);
    }
  }
  if (!dbPath) return null;

  const { readGraphFromDbPaged } = await import('../../adapters/codeGraphDb.ts');
  const { mapRowsToGraphNodes, mapRowsToGraphEdges } = await import('../../adapters/codeGraphRows.ts');

  let cursor: string | null = null;
  const allDbNodes: DbNodeRow[] = [];
  const allDbEdges: DbEdgeRow[] = [];
  for (;;) {
    const page = readGraphFromDbPaged(dbPath, cursor, VIEWS_DB.PAGE_SIZE);
    if (!page) throw new Error('index database unreadable');
    allDbNodes.push(...page.nodes);
    allDbEdges.push(...page.edges);
    if (page.nextCursor === null) break;
    if (allDbNodes.length >= VIEWS_DB.MAX_NODES || allDbEdges.length >= VIEWS_DB.MAX_EDGES) break;
    cursor = page.nextCursor;
  }

  const nodes = mapRowsToGraphNodes(allDbNodes);
  const validNodeIds = new Set(nodes.map((n) => n.id));
  const edges = mapRowsToGraphEdges(allDbEdges, validNodeIds);
  return {
    nodes,
    edges,
    metadata: {
      repoId: RepoId(workspacePath),
      timestamp: Date.now(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

/** 从请求 URL 取一个可选的长文本查询参数（commitLog / blameLog 体积可能很大，故设上限）。 */
function queryLongParam(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  // 超长输入直接判为「未提供」而不是截断：截断会让解析器拿到半截 git 输出，
  // 产生一份看似合法、其实错乱的视图归属。宁可显式降级。
  if (raw.length > VIEWS_RAW_LOG_MAX_CHARS) return undefined;
  return raw;
}

/**
 * 计算单个视图的摘要。
 *
 * 时序视图：`commitLog` 存在且非空时，解析出 commit 切片触及的文件集合；
 * 缺失时 `available:false` + 中文原因。所有权视图同理（`blameLog`）。
 */
function buildTemporalFact(
  nodes: readonly GraphNode[],
  commitLog: string | undefined,
  range: CommitRange,
  /** 采集失败时的可读原因（cycle-144）：覆盖默认的「未提供」——用户能看到真实失败原因。 */
  failureReason?: string | null,
): { files: Set<string> | undefined; available: boolean; reason: string | null } {
  if (commitLog === undefined || commitLog.trim() === '') {
    return { files: undefined, available: false, reason: failureReason ?? '未提供 commitLog：时序视图不可用' };
  }
  const history = { slices: parseCommitLog(commitLog), head: null, available: true };
  const { slices } = filterSlices(history, range);
  const files = new Set<string>();
  for (const slice of slices) for (const file of slice.files) files.add(file);
  return { files, available: true, reason: null };
}

function buildOwnershipFact(
  nodes: readonly GraphNode[],
  blameLog: string | undefined,
  failureReason?: string | null,
): { ids: Set<string> | undefined; available: boolean; reason: string | null } {
  if (blameLog === undefined || blameLog.trim() === '') {
    return { ids: undefined, available: false, reason: failureReason ?? '未提供 blameLog：所有权视图不可用' };
  }
  const ownership = buildOwnershipMap(nodes, groupBlameByFile(parseGitBlamePorcelain(blameLog)));
  return { ids: new Set(Object.keys(ownership.nodeLabels)), available: true, reason: null };
}

export function registerViewsRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VIEWS_ROUTE_PATH,
    handler: withRouteMiddleware('GET', VIEWS_ROUTE_PATH, corsConfig, rateLimiter, async (req, res) => {
      try {
        const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
        if (!workspacePath) {
          const body: ViewsErrorResponse = {
            success: false,
            errorCode: ERROR_CODES.INDEX_NOT_FOUND,
            views: null,
            error: ERROR_CODES.INDEX_NOT_FOUND,
          };
          sendJson(res, 200, body, req, corsConfig);
          return;
        }

        // 图源：内存槽（当前图，工作区限定）优先；槽空回落索引 DB。
        const slot = getWorkspaceScopedGraphData(deps, workspacePath);
        const graph = slot ?? await readGraphFromIndex(workspacePath);
        if (!graph || graph.nodes.length === 0) {
          const body: ViewsErrorResponse = {
            success: false,
            errorCode: ERROR_CODES.INDEX_NOT_FOUND,
            views: null,
            error: ERROR_CODES.INDEX_NOT_FOUND,
          };
          sendJson(res, 200, body, req, corsConfig);
          return;
        }

        const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
        const commitLog = queryLongParam(url, 'commitLog');
        const blameLog = queryLongParam(url, 'blameLog');
        const range: CommitRange = {
          ...(typeof url.searchParams.get('days') === 'string' && Number.isFinite(Number(url.searchParams.get('days')))
            ? { days: Number(url.searchParams.get('days')) }
            : {}),
          ...(url.searchParams.get('from') ? { from: url.searchParams.get('from') as string } : {}),
          ...(url.searchParams.get('to') ? { to: url.searchParams.get('to') as string } : {}),
        };

        // 领域事实：Louvain 社区（与 `graph_views` 工具同一个实现）。
        const domain = await computeDomainLabels(graph.nodes, graph.edges);
        const domainByNodeId = new Map<string, string>();
        for (const [id, label] of Object.entries(domain.labels)) {
          if (label) domainByNodeId.set(id, label);
        }

        // 时序/所有权事实。显式传参优先（查询串里的 commitLog/blameLog）；
        // 缺省时宿主自动采集（cycle-144 T2）——此前「支持传参但无人传」让两个视图
        // 恒为不可用（真机用户旅程实证）。采集失败（非 git 仓库/超时）时返回 null，
        // buildTemporalFact/buildOwnershipFact 走既有的「available:false + 原因」诚实路径。
        // cycle-146 两层修复（真机 dsh-anic 实证）：
        //   L1 采集墙时间：blame 传图节点文件集，采集量与图规模成正比
        //      （全仓 1056 文件逐文件 blame 77s > 客户端 30s 预算 → 面板必然失败）；
        //   L2 键域错位：原生扫描图的 filePath 是「工作区绝对路径」域
        //      （如 D:\…\dsh-anic\.dsh\skills\…），而 git 输出与消费端查表键
        //      （partitionByView / buildOwnershipMap 的 normalizeChurnPath）都在
        //      「仓库相对路径」域 ⇒ 不投影就永不命中，temporal/ownership 恒 0。
        //      这里把节点 filePath 投影为相对域后再传两侧（采集器文件集 + 事实构建）。
        const relNodes: GraphNode[] = graph.nodes.map((n) => {
          const fp = typeof n.filePath === 'string' ? n.filePath : '';
          const rel = toGitRelative(fp, workspacePath);
          return rel === fp ? n : { ...n, filePath: rel };
        });
        const nodeFileSet = new Set(
          relNodes.map((n) => n.filePath).filter((p): p is string => typeof p === 'string' && p.trim() !== ''),
        );
        const collectedCommit = commitLog === undefined
          ? await collectGitRawInput(workspacePath, 'commitLog')
          : null;
        const collectedBlame = blameLog === undefined
          ? await collectGitRawInput(workspacePath, 'blameLog', nodeFileSet)
          : null;
        const temporal = buildTemporalFact(relNodes, commitLog ?? collectedCommit?.text ?? undefined, range, collectedCommit?.reason ?? undefined);
        const ownership = buildOwnershipFact(relNodes, blameLog ?? collectedBlame?.text ?? undefined, collectedBlame?.reason ?? undefined);
        // 采集元数据随响应披露（白盒：用户能看到「这次划分的 git 输入从哪来、花了多久」）。
        const gitSources = {
          commitLog: collectedCommit
            ? { source: 'auto' as const, available: collectedCommit.available, durationMs: collectedCommit.durationMs, truncated: collectedCommit.truncated, reason: collectedCommit.reason }
            : { source: 'query' as const, available: commitLog !== undefined && commitLog.trim() !== '', durationMs: null, truncated: false, reason: null },
          blameLog: collectedBlame
            ? { source: 'auto' as const, available: collectedBlame.available, durationMs: collectedBlame.durationMs, truncated: collectedBlame.truncated, reason: collectedBlame.reason }
            : { source: 'query' as const, available: blameLog !== undefined && blameLog.trim() !== '', durationMs: null, truncated: false, reason: null },
        };

        // 正式的 Π 函数。cycle-146：data 必须用投影后的 relNodes——temporal 按
        // filePath 匹配（相对域），ownership/domain 按节点 id 匹配（投影不改 id），
        // 用原始 graph 会让 temporal 恒 0 而 ownership 正常（真机分叉实证）。
        const partition = partitionByView({
          data: { ...graph, nodes: relNodes },
          temporalFiles: temporal.files,
          attributedNodeIds: ownership.ids,
          domainByNodeId,
        });

        // 领域节点计数（供面板的「领域分布」使用）。
        const domainNodeCounts: Record<string, number> = {};
        for (const node of graph.nodes) {
          const label = domain.labels[String(node.id)];
          if (label) domainNodeCounts[label] = (domainNodeCounts[label] ?? 0) + 1;
        }
        // 领域视图的节点/边数：节点 = 被分配到社区的节点（Louvain 保证每个节点都有标签，
        // 即等于全图节点数）；边 = 两端点在同一社区的边（跨社区「桥」边不属于任何领域）。
        const domainNodeCount = Object.values(domainNodeCounts).reduce((acc, n) => acc + n, 0);

        // 采样：按图内顺序取前 500，确定性。
        const sampled = graph.nodes.length > VIEWS_MATRIX_MAX_NODES;
        const nodeViewMatrix: NodeViewRow[] = graph.nodes.slice(0, VIEWS_MATRIX_MAX_NODES).map((node) => {
          const views = partition.nodeViews.get(String(node.id));
          return {
            id: String(node.id),
            label: node.label,
            views: views ? [...views].sort() : ['structural'],
          };
        });

        // `serializeViewPartition` 保留给「需要逐边视图」的消费者；本路由只暴露矩阵，
        // 但仍走同一个序列化器以避免两处各写一份视图名排序。
        const serialized = serializeViewPartition(partition);

        const body: ViewsSuccessResponse = {
          success: true,
          errorCode: null,
          views: {
            structural: {
              nodeCount: serialized.viewCounts.structural ?? 0,
              edgeCount: serialized.edgeViewCounts.structural ?? 0,
            },
            temporal: {
              nodeCount: serialized.viewCounts.temporal ?? 0,
              edgeCount: serialized.edgeViewCounts.temporal ?? 0,
              available: temporal.available,
              reason: temporal.reason,
            },
            ownership: {
              nodeCount: serialized.viewCounts.ownership ?? 0,
              edgeCount: serialized.edgeViewCounts.ownership ?? 0,
              available: ownership.available,
              reason: ownership.reason,
            },
            domain: {
              nodeCount: domainNodeCount,
              edgeCount: serialized.edgeViewCounts.domain ?? 0,
              domainCount: domain.domainCount,
              nodeCounts: domainNodeCounts,
            },
          },
          totalNodes: graph.nodes.length,
          totalEdges: graph.edges.length,
          nodeViewMatrix,
          sampled,
          computedAt: Date.now(),
          gitSources,
        };
        sendJson(res, 200, body, req, corsConfig);
      } catch (e) {
        log.error('views route failed', e);
        sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
      }
    }),
  }), 'codegraph: views route');
}

/** 便于测试与复用的「视图名 → 摘要 key」映射（面板按同一顺序渲染四张卡片）。 */
export const VIEW_SUMMARY_KEYS: readonly ViewName[] = ['structural', 'temporal', 'ownership', 'domain'];
