/**
 * codegraph.db 的**边侧**读取（cycle-110 Q7 行为等价提取）。
 *
 * 抽取契约（每条都对应一条历史缺陷，改动前逐条确认）：
 *   · 分批 IN 查询只用于规避 SQLite 参数上限（`SQLITE.MAX_IN_PARAMS`）；**绝不在分批内使用
 *     LIMIT/OFFSET**——OFFSET 作用于整个结果集而非单个批次（CLAUDE.md 记录的既有教训）。
 *     因此凡是需要分页的路径，都是「先读全集、再在内存里 slice」。
 *   · 过滤顺序：先过滤（自环 + `FILTERED_EDGE_KINDS`）**再**切片。`total` 是过滤后的计数，
 *     调用方按返回页长度推进游标；先切后滤会让 `total` 永远追不上、每页重复读同一批行。
 *   · `readIncidentEdgesWithFilePathsFromDb` 刻意**不接受** cursor/limit：文件对聚合必须在分页
 *     之前完成（否则同一个文件对会被拆到多页里，每页各自聚合看起来都对、合并结果是错的）。
 *     它同时会把跨文件边的远端补查进 `filePathByNodeId`——否则远端会全部塌进 `'?'` 这个假文件对。
 *   · 返回 `null` = 索引读不到（调用方回落到全量取数）；返回空数组 = 读到了但没有数据。
 *     这两者绝不能合并（同 `readFilesFromDb` 的 `null` 语义）。
 */
import { scoped } from '../shared/Logger.ts';
import { SQLITE, INCREMENTAL } from '../shared/constants.ts';
import { EDGE_ROW_COLUMNS, FILTERED_EDGE_KINDS, mapEdgeKind, normalizeRepoPath, type DbNodeRow, type DbEdgeRow } from './codeGraphRows.ts';
import { getDbConnection, validateNodeRows, validateEdgeRows } from './codeGraphDb.ts';
import { collapseRepeatedBackslashes } from './nativeIndex.ts';

const log = scoped('codegraph-adapter');

/**
 * file 域边列表的 kind 分组排序（cycle-139 / 需求分析 §82）。
 *
 * ## 它解决什么
 *
 * `/edges` 的 file 域返回「某文件的全部邻接边」。SQLite 无 ORDER BY（id 序返回），
 * 客户端拿到的边顺序是**索引插入序**——call/import/contains 混排，用户在边列表里
 * 找「谁调用了这个文件」要在几百条杂序边里翻。分组排序后同 kind 的边相邻，
 * 边列表呈现为可扫读的段（call 段 → import 段 → …）。
 *
 * ## 契约
 *
 * - **组序**：call → import → extend → implement → contains → dependency，
 *   未知/其他 kind 按 `mapEdgeKind` 归并后的字母序殿后（新 kind 不需要改本表，
   *   但会排到已知段之后——确定、可预期）。
 * - **组内序**：`(source, target, id)` 字典序——纯确定序，与 DB 返回序无关。
 * - **排序在过滤之后、切片之前**：与「先过滤再切片」既有契约同位（total 是过滤后
 *   计数；排序改变的是序不是集合，不改变 total）。
 * - **两条数据路径共用**：DB-first（`readEdgesFromDb` file 域 / 聚合路径的未切片全集）
 *   与内存回退各自调用本函数，不各写一份（「同语义共享一份实现」纪律）。
 *   组键兼容 `DbEdgeRow.kind` 与 `GraphEdge.type` 两种来源（见函数注）。
 */
const EDGE_KIND_GROUP_ORDER: readonly string[] = ['call', 'import', 'extend', 'implement', 'contains', 'dependency'];

/**
 * 组键取值：`DbEdgeRow.kind`（DB 侧原始 kind）**或** `GraphEdge.type`（内存回落侧
 * 已映射的图类型）。两条路径的字段名不同——只读其一会让另一条路径的全部边落进
 * dependency 组、排序静默退化为坐标序（本轮实测踩坑：测试当场抓住）。
 */
export function sortEdgesByKindGroup<T extends { source: string; target: string; id: string | number; kind?: string; type?: string }>(edges: readonly T[]): T[] {
  const groupOf = (e: T): string => mapEdgeKind(e.kind ?? e.type ?? 'dependency');
  const groupRank = new Map<string, number>();
  EDGE_KIND_GROUP_ORDER.forEach((kind, i) => groupRank.set(kind, i));
  return [...edges].sort((a, b) => {
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) {
      const ra = groupRank.get(ga);
      const rb = groupRank.get(gb);
      // 已知组按表序；未知组殿后并按字母序（两者都缺省时字典序兜底）。
      if (ra !== undefined || rb !== undefined) return (ra ?? EDGE_KIND_GROUP_ORDER.length) - (rb ?? EDGE_KIND_GROUP_ORDER.length);
      return ga < gb ? -1 : ga > gb ? 1 : 0;
    }
    const sa = String(a.source);
    const sb = String(b.source);
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ta = String(a.target);
    const tb = String(b.target);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ia = String(a.id);
    const ib = String(b.id);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/**
 * Paged read of a node's incident edges, already filtered by the shared edge
 * policy (`FILTERED_EDGE_KINDS` + self-loops).
 *
 * The filter MUST run before slicing: `total` is the filtered count and the
 * caller advances its cursor by the returned page length, so filtering after
 * the slice would make `total` unreachable and re-read rows on every page.
 * `CodeGraphAdapter.fetchData` applies the same policy to `dbEdges`.
 */
export function readEdgesFromDb(dbPath: string, nodeId: string, scope: 'file' | 'symbol', cursor: number, limit: number): { edges: DbEdgeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  const keep = (e: DbEdgeRow): boolean => e.source !== e.target && !FILTERED_EDGE_KINDS.has(e.kind);
  try {
    if (scope === 'symbol') {
      // symbol 域保持 id 序（节点邻接边数量小，kind 混排可读性问题不突出；
      // 引入分组会改变既有消费方的翻页快照序——刻意不动，契约变化最小化）。
      const allEdges = validateEdgeRows(db.prepare(
        `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE source = ? OR target = ?`,
      ).all(nodeId, nodeId)).filter(keep);
      const total = allEdges.length;
      const pagedEdges = allEdges.slice(cursor, cursor + limit);
      return { edges: pagedEdges, total };
    }
    const fileResult = readIncidentEdgesWithFilePathsFromDb(dbPath, nodeId, 'file');
    if (!fileResult) return null;
    // cycle-139：file 域全集先分组排序再切片——同 kind 相邻，且翻页序稳定
    //（与 DB 返回序解耦：索引重排/重扫后同一请求翻出的页序不变）。
    const allEdges = sortEdgesByKindGroup(fileResult.edges);
    const total = allEdges.length;
    const pagedEdges = allEdges.slice(cursor, cursor + limit);
    return { edges: pagedEdges, total };
  } catch (e) {
    log.warn('readEdgesFromDb failed', e);
    return null;
  }
}

/**
 * 一次性读回某节点（或其所在文件）的全部邻接边，**不切片**，并附上每个端点所属文件。
 *
 * 供「文件对聚合」使用：聚合必须在分页之前完成（否则每页各自聚合，
 * 同一个文件对会被拆到多页里），所以聚合路径需要未切片的全集。
 * 调用方拿到结果后自行决定聚合还是切片，因此这里刻意不接受 cursor/limit。
 *
 * 遵守与 `readEdgesFromDb` 相同的约束：分批 IN 查询只用于规避 SQLite 参数上限，
 * 绝不在分批内使用 LIMIT/OFFSET（OFFSET 作用于整个结果集而非单个批次）。
 */
export function readIncidentEdgesWithFilePathsFromDb(
  dbPath: string,
  nodeId: string,
  scope: 'file' | 'symbol',
): { edges: DbEdgeRow[]; filePathByNodeId: Map<string, string> } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  const keep = (e: DbEdgeRow): boolean => e.source !== e.target && !FILTERED_EDGE_KINDS.has(e.kind);
  try {
    const filePathByNodeId = new Map<string, string>();
    const edgeMap = new Map<number, DbEdgeRow>();
    const batchSize = Math.floor(SQLITE.MAX_IN_PARAMS / 2);

    if (scope === 'file') {
      const filePathResult = db.prepare('SELECT file_path FROM nodes WHERE id = ?').get(nodeId) as { file_path: string } | undefined;
      if (!filePathResult) return { edges: [], filePathByNodeId };
      const filePath = filePathResult.file_path;
      const nodeIds = db.prepare('SELECT id FROM nodes WHERE file_path = ?').all(filePath) as { id: string }[];
      const idList = nodeIds.map((n) => n.id);
      if (idList.length === 0) return { edges: [], filePathByNodeId };
      for (const id of idList) filePathByNodeId.set(id, filePath);
      for (let i = 0; i < idList.length; i += batchSize) {
        const batch = idList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(', ');
        const batchEdges = validateEdgeRows(db.prepare(
          `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
        ).all(...batch, ...batch));
        for (const e of batchEdges) edgeMap.set(e.id, e);
      }
    } else {
      const symbolEdges = validateEdgeRows(db.prepare(
        `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE source = ? OR target = ?`,
      ).all(nodeId, nodeId));
      for (const e of symbolEdges) edgeMap.set(e.id, e);
    }

    const edges = [...edgeMap.values()].filter(keep);

    // 解析尚未知文件的端点（跨文件边的远端）。文件作用域下只有本文件内的节点
    // 预先有映射，远端必须回查，否则它们会被归到 '?' 这一个假文件对里。
    const unresolved = new Set<string>();
    for (const e of edges) {
      if (!filePathByNodeId.has(e.source)) unresolved.add(e.source);
      if (!filePathByNodeId.has(e.target)) unresolved.add(e.target);
    }
    const unresolvedList = [...unresolved];
    for (let i = 0; i < unresolvedList.length; i += batchSize) {
      const batch = unresolvedList.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, file_path FROM nodes WHERE id IN (${placeholders})`,
      ).all(...batch) as { id: string; file_path: string }[];
      for (const r of rows) filePathByNodeId.set(r.id, r.file_path);
    }

    return { edges, filePathByNodeId };
  } catch (e) {
    log.warn('readIncidentEdgesWithFilePathsFromDb failed', e);
    return null;
  }
}

export function readEdgesForNodesFromDb(dbPath: string, nodeIds: string[]): DbEdgeRow[] {
  if (nodeIds.length === 0) return [];
  const db = getDbConnection(dbPath);
  if (!db) return [];
  try {
    const edgeMap = new Map<number, DbEdgeRow>();
    // 存量脏库兼容（cycle-141 第六轮）：修复前写入的边端点带**双反斜杠**，调用方传
    // 的是折叠后的单形态 id——查询集合同时包含两种拼写（Set 天然去重），双形态
    // 库与消毒后的新库都能命中。返回行的端点原样返回；bootstrap 的
    // mapDbEdgesToGraphEdges 端点过滤用同一个双形态集合，闭环成立。
    const nodeSet = new Set<string>();
    for (const id of nodeIds) {
      nodeSet.add(id);
      // 脏库方向是「扩展」：单形态 → 双形态（脏库每个分隔符都是两个字符）。
      const expanded = id.replace(/\\/g, '\\\\');
      if (expanded !== id) nodeSet.add(expanded);
    }
    const batchSize = Math.floor(SQLITE.MAX_IN_PARAMS / 2);
    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const queryBatch = batch.flatMap((id) => {
        const expanded = id.replace(/\\/g, '\\\\');
        return expanded !== id ? [id, expanded] : [id];
      });
      const placeholders = queryBatch.map(() => '?').join(', ');
      const edges = validateEdgeRows(db.prepare(
        `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
      ).all(...queryBatch, ...queryBatch));
      for (const e of edges) {
        if (nodeSet.has(e.source) && nodeSet.has(e.target)) edgeMap.set(e.id, e);
      }
    }
    // 端点折叠（与节点行的 sanitizeDirtyRows 同一出口纪律）：查询集合允许双形态
    // 是为了命中脏库，但**返回行必须与调用方的 id 域一致**——调用方传的是折叠后的
    // 单形态（节点行已消毒），边端点若原样返回（双形态），同一次响应里边端点与
    // 节点 id 不同域，客户端聚类聚合的 nodeIdToVisibleId 映射不上，边全丢
    //（真机复现：bootstrap 边 41 条全被聚合丢弃，画布 0 边）。
    const result = [...edgeMap.values()];
    for (const e of result) {
      (e as { source: string }).source = collapseRepeatedBackslashes(e.source);
      (e as { target: string }).target = collapseRepeatedBackslashes(e.target);
    }
    return result;
  } catch (e) {
    log.warn('readEdgesForNodesFromDb failed', e);
    return [];
  }
}

/**
 * Read the nodes of a set of changed files plus every edge that touches one of them (P2-21).
 *
 * Both separator spellings of each path are tried, and a changed *directory* is matched by prefix so
 * that a file added under a new folder still pulls that folder's rows.
 *
 * Edges are returned when **either** endpoint is in the touched node set, not only when both are: an
 * edge from a changed file into an unchanged one is exactly the kind of edge a re-scan can add or
 * remove, and filtering it out here would make it invisible to the caller. The caller is responsible
 * for dropping edges whose far endpoint no longer exists in the resulting graph.
 *
 * Returns `null` when the index cannot be read at all, which callers treat as "fall back to a full
 * fetch"; an empty result means the index was read and holds nothing for those paths.
 */
export function readFilesFromDb(dbPath: string, filePaths: string[]): { nodes: DbNodeRow[]; edges: DbEdgeRow[] } | null {
  if (filePaths.length === 0) return { nodes: [], edges: [] };
  const db = getDbConnection(dbPath);
  if (!db) return null;

  try {
    const wanted = new Set<string>();
    for (const raw of filePaths) {
      const normalized = normalizeRepoPath(raw);
      if (!normalized) continue;
      wanted.add(normalized);
      wanted.add(normalized.replace(/\//g, '\\'));
    }
    const candidates = [...wanted];
    if (candidates.length === 0) return { nodes: [], edges: [] };

    const batchSize = Math.min(INCREMENTAL.MAX_FILE_BATCH, Math.floor(SQLITE.MAX_IN_PARAMS / 2));
    const nodeMap = new Map<string, DbNodeRow>();
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const exact = batch.map(() => '?').join(',');
      const prefix = batch.map(() => "file_path LIKE ? ESCAPE '\\'").join(' OR ');
      const prefixArgs = batch.map((p) => `${p.replace(/[%_\\]/g, '\\$&')}/%`);
      const rows = validateNodeRows(db.prepare(
        `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes
         WHERE file_path IN (${exact}) OR ${prefix}`,
      ).all(...batch, ...prefixArgs));
      for (const n of rows) nodeMap.set(n.id, n);
    }

    if (nodeMap.size === 0) return { nodes: [], edges: [] };

    const nodeIds = [...nodeMap.keys()];
    const edgeMap = new Map<number, DbEdgeRow>();
    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(', ');
      const rows = validateEdgeRows(db.prepare(
        `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
      ).all(...batch, ...batch));
      for (const e of rows) edgeMap.set(e.id, e);
    }

    return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  } catch (e) {
    log.warn('readFilesFromDb failed', e);
    return null;
  }
}
