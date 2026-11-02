/**
 * 领域视图（研究方案 §4 的 $\Pi_{\text{dom}}$ 维）与**统一切片接口** `graphSlice`。
 *
 * ## 领域视图
 *
 * 通过社区发现把结构图投影到功能域/业务域：复用 `GraphologyAdapter` 已有的 Louvain
 * 检测，把每个节点映射到一个领域标签。标签用**规范序**（按社区内最小 nodeId 字典序
 * 编号 `domain-0`、`domain-1` …）而不是 Louvain 的内部编号，因此同一输入无论
 * Louvain 内部如何编号都得到稳定标签——否则可视化每次刷新都会换色。
 *
 * ## 统一切片接口 `graphSlice(view, granularity, focus?)`
 *
 * 研究方案 §7.1 把它列为 6 个核心工具之一。它把四个正交视图收敛成**一个**入口：
 *
 * - `structural`：AST 符号与静态关系（结构视图 $\mathcal{V}_{\text{struct}}$）；
 * - `temporal`：commit 切片 + 边挥发度（时序视图 $\mathcal{T}$，见 `temporal.ts`）；
 * - `ownership`：git blame 作者归属 + bus factor（所有权视图 $\Pi_{\text{own}}$）；
 * - `domain`：Louvain 社区 → 领域标签（领域视图 $\Pi_{\text{dom}}$）。
 *
 * 三个维度正交组合：`view` 决定**标注什么**，`granularity` 决定**聚合到哪一层**
 * （`repo` 原样 / `file` 折叠成文件节点 / `symbol` 符号级），`focus` 决定**切哪一块**
 * （按 nodeId/label 取 1 跳邻域，或按文件路径取整文件）。
 *
 * **失败必须可见**：`available: false` + `reason`，而不是返回一份看起来完整、
 * 其实缺了时序/作者维度的图。`metadata.viewDataAvailable` 单独标记「视图专属数据」
 * 是否到位，因为「图切出来了」与「标注齐了」是两件事。
 *
 * @module shared/domain
 */

import type { GraphData, GraphEdge, GraphNode } from '../types/index.ts';
import { EdgeId, NodeId } from '../types/index.ts';
import { GraphologyAdapter } from './GraphologyAdapter.ts';
import { normalizeChurnPath } from './churn.ts';
import { commitSliceGraph, edgeVolatility, type CommitHistory, type TemporalSliceResult } from './temporal.ts';
import { buildOwnershipMap, type BlameLine } from './ownership.ts';
import { scoped } from './Logger.ts';

const log = scoped('domain');

/** 视图类型。 */
export type GraphSliceView = 'structural' | 'temporal' | 'ownership' | 'domain';

/** 聚合粒度。 */
export type GraphSliceGranularity = 'repo' | 'file' | 'symbol';

/** `graphSlice` 的请求。 */
export interface GraphSliceRequest {
  view: GraphSliceView;
  granularity?: GraphSliceGranularity;
  /** nodeId / label（取 1 跳邻域）或文件路径（取整文件）。 */
  focus?: string;
  /** 时序视图所需的 commit 历史。 */
  commitHistory?: CommitHistory | null;
  /** 所有权视图所需的 blame 分组。 */
  blameByFile?: Readonly<Record<string, BlameLine[]>> | null;
  /** 参考时间（unix 毫秒）。 */
  now?: number;
  /** focus 邻域的节点上限（防御高扇出节点把整张图拉进来）。 */
  maxNeighbors?: number;
}

/** `graphSlice` 的结果。 */
export interface GraphSliceResult {
  view: GraphSliceView;
  granularity: GraphSliceGranularity;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** nodeId → 视图标签（作者名 / 领域名 / 变更次数）。 */
  labels: Record<string, string>;
  /** 切片本身是否切出来了。 */
  available: boolean;
  /** 视图专属标注是否到位（区别于「图切出来了」）。 */
  viewDataAvailable: boolean;
  metadata: Record<string, unknown>;
  reason?: string;
}

/** focus 邻域默认上限。 */
const DEFAULT_MAX_NEIGHBORS = 200;

/** 构造一个「没切出来」的结果：`available: false` + 原因，不编造图。 */
function emptyResult(view: GraphSliceView, granularity: GraphSliceGranularity, reason: string): GraphSliceResult {
  return {
    view,
    granularity,
    nodes: [],
    edges: [],
    labels: {},
    available: false,
    viewDataAvailable: false,
    metadata: { nodeCount: 0, edgeCount: 0 },
    reason,
  };
}

/** 建无向邻接表（focus 邻域用；与 `AdjacencyList` 的有向版不同，这里双向）。 */
function buildUndirectedAdjacency(edges: readonly GraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const s = String(edge.source);
    const t = String(edge.target);
    const sBucket = adjacency.get(s);
    if (sBucket) { if (!sBucket.includes(t)) sBucket.push(t); } else adjacency.set(s, [t]);
    const tBucket = adjacency.get(t);
    if (tBucket) { if (!tBucket.includes(s)) tBucket.push(s); } else adjacency.set(t, [s]);
  }
  return adjacency;
}

/** 按 keep 集合过滤边（两端都在集合内才保留）。 */
function filterEdgesByIds(edges: readonly GraphEdge[], keep: ReadonlySet<string>): GraphEdge[] {
  return edges.filter((edge) => keep.has(String(edge.source)) && keep.has(String(edge.target)));
}

/**
 * 按 `focus` 取子图。
 *
 * 优先把 focus 当作 nodeId/label：命中则取该节点 + 1 跳邻域（受 `maxNeighbors` 上限
 * 保护，否则一个 hub 会把整张图拉进来）。没命中再当作文件路径：取该文件下全部节点。
 * 两者都没命中 → 空结果（原因由调用方写）。
 */
function focusNeighborhood(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  focus: string | undefined,
  maxNeighbors: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!focus) return { nodes: [...nodes], edges: [...edges] };

  const matched = nodes.filter((node) => String(node.id) === focus || node.label === focus);
  if (matched.length > 0) {
    const adjacency = buildUndirectedAdjacency(edges);
    const keep = new Set<string>();
    for (const node of matched) {
      if (keep.size >= maxNeighbors) break;
      keep.add(String(node.id));
      for (const neighbor of adjacency.get(String(node.id)) ?? []) {
        if (keep.size >= maxNeighbors) break;
        keep.add(neighbor);
      }
    }
    return { nodes: nodes.filter((node) => keep.has(String(node.id))), edges: filterEdgesByIds(edges, keep) };
  }

  const normalized = normalizeChurnPath(focus);
  const inFile = nodes.filter((node) => normalizeChurnPath(node.filePath) === normalized);
  if (inFile.length === 0) return { nodes: [], edges: [] };
  const keep = new Set(inFile.map((node) => String(node.id)));
  return { nodes: nodes.filter((node) => keep.has(String(node.id))), edges: filterEdgesByIds(edges, keep) };
}

/**
 * 把符号图折叠成文件级图：每个文件一个 `module` 节点，跨文件边聚合成一条
 * `dependency` 边（同向去重）。这是「文件级语义缩放」的最小实现。
 */
function collapseToFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byFile = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = normalizeChurnPath(node.filePath) || String(node.id);
    const bucket = byFile.get(key);
    if (bucket) bucket.push(node);
    else byFile.set(key, [node]);
  }

  const idByFile = new Map<string, NodeId>();
  const fileNodes: GraphNode[] = [];
  for (const [file, members] of byFile) {
    const id = NodeId(`file:${file}`);
    idByFile.set(file, id);
    fileNodes.push({
      id,
      label: file,
      type: 'module',
      filePath: file,
      properties: { memberCount: members.length },
    });
  }

  const nodeToFile = new Map<string, string>();
  for (const [file, members] of byFile) {
    for (const member of members) nodeToFile.set(String(member.id), file);
  }

  const seen = new Set<string>();
  const fileEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const sourceFile = nodeToFile.get(String(edge.source));
    const targetFile = nodeToFile.get(String(edge.target));
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue;
    const key = `${sourceFile}->${targetFile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fileEdges.push({
      id: EdgeId(`fileedge:${sourceFile}->${targetFile}`),
      source: idByFile.get(sourceFile) as NodeId,
      target: idByFile.get(targetFile) as NodeId,
      type: 'dependency',
      properties: {},
    });
  }

  return { nodes: fileNodes, edges: fileEdges };
}

/** 取一个文件路径的顶层目录（领域名的人类可读来源）。 */
function topDirectory(filePath: string): string {
  const normalized = normalizeChurnPath(filePath);
  const slash = normalized.indexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : normalized;
}

/** 字典序最小的字符串（用于社区规范排序，与 Louvain 内部编号无关）。 */
function minString(values: readonly string[]): string {
  let min = '';
  for (const value of values) {
    if (min === '' || value < min) min = value;
  }
  return min;
}

/**
 * 用 Louvain 把节点映射到领域标签。
 *
 * 标签编号按「社区内最小 nodeId」字典序规范重排，因此**不依赖 Louvain 的内部编号**；
 * 没有被 Louvain 覆盖到的孤立节点各自成一个领域，保证「每个节点都有标签」。
 */
async function computeDomainLabels(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Promise<{ labels: Record<string, string>; domainNames: Record<string, string>; domainCount: number }> {
  const labels: Record<string, string> = {};
  const domainNames: Record<string, string> = {};
  if (nodes.length === 0) return { labels, domainNames, domainCount: 0 };

  const adapter = new GraphologyAdapter();
  await adapter.buildGraph([...nodes], [...edges]);
  const communities = await adapter.detectCommunities();
  adapter.clear();

  const groups = new Map<number, string[]>();
  for (const record of communities) {
    const bucket = groups.get(record.community);
    if (bucket) bucket.push(record.nodeId);
    else groups.set(record.community, [record.nodeId]);
  }

  const ordered = [...groups.entries()].sort((a, b) => minString(a[1] ?? []).localeCompare(minString(b[1] ?? [])));

  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  ordered.forEach(([, members], index) => {
    const label = `domain-${index}`;
    const representative = members.map((id) => nodeById.get(id)).find((node) => node !== undefined);
    domainNames[label] = representative ? topDirectory(representative.filePath) : 'unknown';
    for (const member of members) labels[member] = label;
  });

  // 孤立节点（Louvain 可能不覆盖）各自成一个领域，避免出现无标签节点。
  let next = ordered.length;
  for (const node of nodes) {
    const id = String(node.id);
    if (labels[id] !== undefined) continue;
    const label = `domain-${next}`;
    domainNames[label] = topDirectory(node.filePath);
    labels[id] = label;
    next += 1;
  }

  log.debug('domains computed', { nodes: nodes.length, domainCount: next });
  return { labels, domainNames, domainCount: next };
}

/** 计算时序视图的节点标注：每个节点 = 其文件在历史中被触及的提交数。 */
function temporalNodeLabels(nodes: readonly GraphNode[], history: CommitHistory): Record<string, string> {
  const churn = new Map<string, number>();
  for (const slice of history.slices) {
    for (const file of slice.files) churn.set(file, (churn.get(file) ?? 0) + 1);
  }
  const labels: Record<string, string> = {};
  for (const node of nodes) {
    labels[String(node.id)] = String(churn.get(normalizeChurnPath(node.filePath)) ?? 0);
  }
  return labels;
}

/**
 * 统一切片接口。
 *
 * 流程：`focus` 取邻域 → 时序视图先做 commit 切片 → `granularity` 折叠 →
 * 按 `view` 计算标注。任一步的数据缺失都走**显式降级**（`available` /
 * `viewDataAvailable` / `reason`），绝不静默返回缺维度的图。
 */
export async function graphSlice(
  data: Pick<GraphData, 'nodes' | 'edges'>,
  request: GraphSliceRequest,
): Promise<GraphSliceResult> {
  const view = request.view;
  const granularity = request.granularity ?? 'symbol';
  const maxNeighbors = request.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS;

  let base = focusNeighborhood(data.nodes, data.edges, request.focus, maxNeighbors);
  if (base.nodes.length === 0) {
    return emptyResult(view, granularity, request.focus ? `focus "${request.focus}" 未命中任何节点` : '图为空');
  }

  // 时序视图先做 commit 切片；把切片结果留到后面写 metadata（from/to/sliceCount）。
  let temporalSlice: TemporalSliceResult | null = null;
  if (view === 'temporal') {
    const slice = commitSliceGraph(base, { now: request.now }, request.commitHistory ?? null);
    if (!slice.available) {
      return emptyResult(view, granularity, slice.reason ?? 'commit 历史不可用');
    }
    base = { nodes: slice.nodes, edges: slice.edges };
    temporalSlice = slice;
  }

  const collapsed = granularity === 'file' ? collapseToFiles(base.nodes, base.edges) : base;

  const metadata: Record<string, unknown> = {
    nodeCount: collapsed.nodes.length,
    edgeCount: collapsed.edges.length,
  };
  let labels: Record<string, string> = {};
  let viewDataAvailable = true;
  let reason: string | undefined;

  if (view === 'temporal') {
    const history = request.commitHistory;
    if (history && history.available) {
      labels = temporalNodeLabels(collapsed.nodes, history);
      const nodeFiles: Record<string, string> = {};
      for (const node of collapsed.nodes) nodeFiles[String(node.id)] = node.filePath;
      metadata.volatility = edgeVolatility(collapsed.edges, history, nodeFiles);
      metadata.commitRange = { from: temporalSlice?.from ?? null, to: temporalSlice?.to ?? null };
      metadata.sliceCount = temporalSlice?.sliceCount ?? history.slices.length;
      metadata.truncated = temporalSlice?.truncated ?? false;
    } else {
      viewDataAvailable = false;
      reason = 'commit 历史不可用：时序标注缺失（图本身仍按结构切出）';
    }
  } else if (view === 'ownership') {
    const report = buildOwnershipMap(collapsed.nodes, request.blameByFile ?? null);
    labels = report.nodeLabels;
    metadata.authorCount = report.authorCount;
    metadata.attributedCount = report.attributedCount;
    if (!report.available) {
      viewDataAvailable = false;
      reason = report.reason ?? 'git blame 数据不可用：作者标注缺失';
    } else if (report.attributedCount < collapsed.nodes.length) {
      reason = `${collapsed.nodes.length - report.attributedCount} 个节点在 blame 中无记录`;
    }
  } else if (view === 'domain') {
    const domain = await computeDomainLabels(collapsed.nodes, collapsed.edges);
    labels = domain.labels;
    metadata.domainCount = domain.domainCount;
    metadata.domainNames = domain.domainNames;
  }

  return {
    view,
    granularity,
    nodes: collapsed.nodes,
    edges: collapsed.edges,
    labels,
    available: true,
    viewDataAvailable,
    metadata,
    ...(reason === undefined ? {} : { reason }),
  };
}

/** 四个视图的合法集合（供工具参数校验与文档生成共用，避免两处字面量漂移）。 */
export const GRAPH_SLICE_VIEWS: readonly GraphSliceView[] = ['structural', 'temporal', 'ownership', 'domain'] as const;

/** 三个粒度的合法集合。 */
export const GRAPH_SLICE_GRANULARITIES: readonly GraphSliceGranularity[] = ['repo', 'file', 'symbol'] as const;
