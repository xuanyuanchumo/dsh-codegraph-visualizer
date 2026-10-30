/**
 * codegraph.db 索引行 → 图节点/图边的**唯一**映射层（cycle-110 Q7 行为等价提取）。
 *
 * 抽取契约（这里是语义最重的一块，改动前必须逐条确认）：
 *   · `mapRowsToGraphNodes` / `mapRowsToGraphEdges` 是全量与增量两条取数路径**共用**的映射实现，
 *     任何一侧另写一份都会让两条路径产出的形状漂移（历史缺陷）。本文件是它们的唯一住址。
 *   · 父节点按**每个节点自己的 `file_path`** 解析（`kind` 为 file/module/import 的节点无父），
 *     不允许整批共用一个父 id。
 *   · 边的三条过滤规则（两端都在 `validNodeIds`、去自环、丢 `FILTERED_EDGE_KINDS`）与
 *     import 上限截断必须完全一致；截断前按边 id 升序排序，否则分批 IN 查询的顺序差异会改变保留集合。
 *   · `edgeOrigin` / `edgeLocatable` / `rawKind` 只写**可证明**的事实：上游 edges 表没有
 *     confidence 列，因此这里绝不产出 EXTRACTED/INFERRED 之类凭空推断的取值。
 *
 * 本文件无模块级可变状态（三张 Map 都是常量表），因此可以安全地按需重复 import。
 */
import type { GraphNode, GraphEdge, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import { CODEGRAPH_ADAPTER } from '../shared/constants.ts';

// ---- codegraph.db schema (upstream @colbymchenry/codegraph) ----------------

export interface DbNodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  signature: string | null;
  docstring: string | null;
  is_exported: number;
}

export interface DbEdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  /**
   * 上游 `edges.metadata` 列（JSON 文本，可空）。cycle-119 weight 数据面：
   * `{"confidence":0.9,"resolvedBy":"exact-match"}` 是实测形态（本仓 .codegraph
   * 6,556 条非空 / 10,869 条边）。解析为 `weight` 的规则见 {@link parseEdgeConfidence}：
   * **保守降级**——列缺失 / 非 JSON / 非数 / 越界 [0,1] 一律不产出 weight，
   * 宁可回到「无权重、DFS 序截断」，也不喂给 `'top-k-weight'` 一个编造的置信值。
   */
  metadata: string | null;
  line: number | null;
}

/**
 * edges 行的共享 SELECT 列清单（不含 WHERE/ORDER BY，调用方按需拼接）。
 *
 * 单一来源的理由：8 处 `SELECT … FROM edges` 曾各自手写列清单——cycle-119 就是因为
 * 「读侧漏了 `metadata` 列」而 `'top-k-weight'` 契约空转两轮。列变了改一处，
 * 各读取面跟着编译期报错（解构不存在的键）而不是静默丢数据。
 */
export const EDGE_ROW_COLUMNS = 'id, source, target, kind, metadata, line' as const;

/**
 * 从 `metadata` JSON 文本解析置信度（[0,1] 数值），任何不合法形态返回 `undefined`。
 *
 * 为什么不 throw：单行 metadata 损坏不该让整页边读取失败（validateEdgeRows 的
 * 「跳过坏行」是同一哲学）；也不该把 0.9 解析成 `undefined` 再被 `?? 1` 兜底成
 * 「完全可信」——所以越界值与缺失值**同型**（undefined），消费侧用
 * `weight === undefined` 显式分支，没有 `?? 默认值` 的静默兜底路径。
 */
export function parseEdgeConfidence(metadata: string | null | undefined): number | undefined {
  if (typeof metadata !== 'string' || metadata.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const confidence = (parsed as Record<string, unknown>).confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  if (confidence < 0 || confidence > 1) return undefined;
  return confidence;
}

const NODE_KIND_MAP: Record<string, GraphNode['type']> = {
  function: 'function',
  method: 'function',
  class: 'class',
  interface: 'interface',
  type_alias: 'type',
  constant: 'variable',
  variable: 'variable',
  property: 'variable',
  file: 'module',
  import: 'module',
  module: 'module',
};

const EDGE_KIND_MAP: Record<string, GraphEdge['type']> = {
  call: 'call',
  calls: 'call',
  import: 'import',
  imports: 'import',
  extend: 'extend',
  extends: 'extend',
  implement: 'implement',
  implements: 'implement',
  contains: 'contains',
  dependency: 'dependency',
  depends: 'dependency',
};

export const FILTERED_EDGE_KINDS = new Set([
  'uses_var',
  'func_imports_local',
]);

const NOISE_PATH_SEGMENTS = [
  'node_modules', '.git', 'vendor', '__pycache__', '.venv', 'dist', 'build',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', '.pytest_cache',
];

export function isNoisePath(filePath: string): boolean {
  const segments = filePath.split(/[\\/]/);
  for (const seg of NOISE_PATH_SEGMENTS) {
    if (segments.includes(seg)) return true;
  }
  return false;
}

/**
 * 索引行 → 图节点。这是**唯一**的节点映射实现：全量路径（`toAdapterResult`）与增量路径
 * （`buildIncrementalUpdate`）都必须走这里，否则两条路径产出的节点形状会漂移。
 *
 * 父节点按**每个节点自己的 `file_path`** 解析（`kind` 为 file/module/import 的节点本身没有父），
 * 而不是整批共用一个父 id —— 增量定向读会一次拿回多个文件的节点，整批单父会把它们全挂到同一个
 * 文件下。
 *
 * `source` 给出时给 `properties.__source` 打标记，取值必须与 `GraphDataMerger.merge` 用的一致；
 * 增量路径必须打（它要和已经过 merger 的 `current` 逐字段比对），全量路径不打（merger 会打，
 * 打了也只是重复覆盖同一个值，但会让 adapter 的原始输出测试多出一个字段）。
 */
export function mapRowsToGraphNodes(dbNodes: DbNodeRow[], source?: DataSourceType): GraphNode[] {
  const fileNodeIds = new Map<string, string>();
  for (const n of dbNodes) {
    if (n.kind === 'file' || n.kind === 'module') {
      fileNodeIds.set(n.file_path, n.id);
    }
  }

  return dbNodes
    .filter((n) => n.name && n.file_path && !isNoisePath(n.file_path))
    .map((n) => {
      const parentId = (n.kind !== 'file' && n.kind !== 'module' && n.kind !== 'import')
        ? fileNodeIds.get(n.file_path) ?? undefined
        : undefined;
      return {
        id: NodeId(n.id),
        label: n.name,
        type: mapNodeKind(n.kind),
        filePath: n.file_path,
        lineNumber: n.start_line ?? 1,
        properties: {
          kind: n.kind,
          ...(n.signature ? { signature: n.signature } : {}),
          ...(n.docstring ? { docstring: n.docstring } : {}),
          exported: n.is_exported === 1,
          ...(source ? { __source: source } : {}),
        },
        ...(parentId ? { parentId: NodeId(parentId) } : {}),
        layer: inferLayerFromPath(n.file_path),
      };
    });
}

/**
 * 索引行 → 图边。同样是唯一的边映射实现，全量/增量两条路径共用。
 *
 * 三条过滤规则必须和全量路径完全一致，否则增量路径会把全量路径早已丢弃的边重新塞回图里：
 * 两端都必须存在于 `validNodeIds`、丢弃自环、丢弃 `FILTERED_EDGE_KINDS`，最后按**每个来源**
 * 截断到 import 上限条 import 边。
 *
 * 截断前先按边 id 升序排序：全量路径的边来自 `ORDER BY id` 的分页读，增量路径的边来自
 * 分批 IN 查询（SQL 不保证顺序），不排序的话同一个来源保留下来的 20 条会不一样。
 *
 * `keptImportIds` 是增量路径必须提供的东西，也是这里唯一不显然的地方。一次定向读只拿回**某个
 * 来源的部分** import 边：改动的是 `b.ts` 时，`a.ts -> b.ts` 这条边会因为"目标在改动集合内"被
 * 返回，但 `a.ts` 自己的 57 条 import 里哪些进了前 20 名，局部集合根本看不出来。若只对局部集合
 * 数到 20，这条本应被全量路径丢弃的边就会当成新边加进图里（实测本仓库多出 10 条）。
 *
 * 因此截断要在"当前图里该来源已保留的 import 边 id" ∪ "本次读回的 import 边 id" 上做：边 id 随
 * 插入单调递增，所以两者的并集按 id 排序后取前 `cap` 条，就是全量路径会保留的那一批。来源在改动
 * 集合内时局部集合本就是完整的（并集不变）；来源不在改动集合内时，当前图里已有 20 条、新边的 id
 * 更大，自然落选 —— 这正是想要的结论。
 */
export function mapRowsToGraphEdges(
  dbEdges: DbEdgeRow[],
  validNodeIds: Set<string>,
  opts: { source?: DataSourceType; importCap?: number; keptImportIds?: Map<string, number[]> } = {},
): GraphEdge[] {
  const importCap = opts.importCap ?? CODEGRAPH_ADAPTER.MAX_IMPORTS_PER_SOURCE;
  const kept = dbEdges
    .filter((e) =>
      validNodeIds.has(e.source) && validNodeIds.has(e.target) &&
      e.source !== e.target &&
      !FILTERED_EDGE_KINDS.has(e.kind))
    .sort((a, b) => a.id - b.id);

  const importIdsBySource = new Map<string, number[]>();
  for (const e of kept) {
    if (mapEdgeKind(e.kind) !== 'import') continue;
    const list = importIdsBySource.get(e.source);
    if (list) list.push(e.id);
    else importIdsBySource.set(e.source, [e.id]);
  }

  const admittedImportIds = new Set<number>();
  for (const [src, ids] of importIdsBySource) {
    const merged = [...new Set([...(opts.keptImportIds?.get(src) ?? []), ...ids])].sort((a, b) => a - b);
    for (const id of merged.slice(0, importCap)) admittedImportIds.add(id);
  }

  const edges: GraphEdge[] = [];
  for (const e of kept) {
    if (mapEdgeKind(e.kind) === 'import' && !admittedImportIds.has(e.id)) continue;
    // 边来源归因：只写**可证明**的三件事，不写置信度。
    //
    // 上游 `codegraph.db` 的 edges 表只有 `id/source/target/kind/line`，**没有 confidence 列**
    // （`DbEdgeRow` 是本文件对它的逐字段转写）。因此这里刻意**不**产出 `EXTRACTED`/`INFERRED`
    // 之类的取值 —— 那会是凭空编造的证据。能证明的只有：
    //   - `edgeOrigin: 'db'`：这条边来自 SQLite 索引的 edges 行。`ast` 档位（同一条 `contains`
    //     边由语法树父子关系直接给出）现在由 `TreeSitterAdapter` 生产（cycle-111 P1-N4）。
    //     两个档位互斥：本文件只写 `db`，**不冒充** `ast`；
    //   - `edgeLocatable`：这一行有没有 `line`。有 line 才能回溯到源码位置，`null` 只能信其存在；
    //   - `rawKind`：被 `EDGE_KIND_MAP` 压平**之前**的上游 kind。`type` 已经丢失了这个信息
    //     （未知 kind 一律压成 `dependency`），而冲突裁决需要区分"具体关系"与兜底值。
    // 消费者必须以 `type` 判断关系语义，`rawKind` 只用于归因与裁决（两者可能不一致，
    // 例如 `uses_var` 在过滤前被丢弃，而 `calls` 会压平成 `call`）。
    const locatable = typeof e.line === 'number';
    edges.push({
      id: EdgeId(String(e.id)),
      source: NodeId(e.source),
      target: NodeId(e.target),
      type: mapEdgeKind(e.kind),
      properties: {
        ...(locatable ? { line: e.line } : {}),
        ...(opts.source ? { __source: opts.source } : {}),
        edgeOrigin: 'db',
        edgeLocatable: locatable,
        rawKind: e.kind,
      },
      // cycle-119 weight 数据面（§62.6 #4 / X-07 数据侧）：`edges.metadata.confidence`
      // → `GraphEdge.weight`。解析失败/越界/缺失 → undefined → 键不产出（保守降级：
      // 消费侧 `'top-k-weight'` 见到无权重边按 DFS 序兜底，绝不把编造值当真）。
      // 注意：weight 在 GraphEdge 顶层而不在 properties 里——`graphFingerprint` 对
      // 两者都计入哈希（指纹影响见交付清单的 re-fingerprint 披露），但 XuanjiAdapter
      // 的 `xjEdge` 与 GraphologyAdapter 只读顶层 `edge.weight`。
      ...(parseEdgeConfidence(e.metadata) !== undefined
        ? { weight: parseEdgeConfidence(e.metadata) }
        : {}),
    });
  }
  return edges;
}

export function mapNodeKind(kind: string): GraphNode['type'] {
  return NODE_KIND_MAP[kind] ?? 'module';
}

export function mapEdgeKind(kind: string): GraphEdge['type'] {
  return EDGE_KIND_MAP[kind] ?? 'dependency';
}

/**
 * Normalize a repo-relative path for comparison against the index's own `file_path` values.
 *
 * The watcher reports platform separators while the indexer stores whatever it was handed, so the
 * two forms have to be reconciled before any lookup. Callers that need both spellings should ask
 * for them explicitly rather than relying on the index to pick one.
 */
export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
