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
import type { DbNodeRow, DbEdgeRow } from './codeGraphRows.ts';
import { FILTERED_EDGE_KINDS, normalizeRepoPath } from './codeGraphRows.ts';
import { getDbConnection, validateNodeRows, validateEdgeRows } from './codeGraphDb.ts';

const log = scoped('codegraph-adapter');

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
      const allEdges = validateEdgeRows(db.prepare(
        'SELECT id, source, target, kind, line FROM edges WHERE source = ? OR target = ?',
      ).all(nodeId, nodeId)).filter(keep);
      const total = allEdges.length;
      const pagedEdges = allEdges.slice(cursor, cursor + limit);
      return { edges: pagedEdges, total };
    }
    const fileResult = readIncidentEdgesWithFilePathsFromDb(dbPath, nodeId, 'file');
    if (!fileResult) return null;
    const allEdges = fileResult.edges;
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
        const placeholders = batch.map(() => '?').join(',');
        const batchEdges = validateEdgeRows(db.prepare(
          `SELECT id, source, target, kind, line FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
        ).all(...batch, ...batch));
        for (const e of batchEdges) edgeMap.set(e.id, e);
      }
    } else {
      const symbolEdges = validateEdgeRows(db.prepare(
        'SELECT id, source, target, kind, line FROM edges WHERE source = ? OR target = ?',
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
    const nodeSet = new Set(nodeIds);
    const batchSize = Math.floor(SQLITE.MAX_IN_PARAMS / 2);
    for (let i = 0; i < nodeIds.length; i += batchSize) {
      const batch = nodeIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const edges = validateEdgeRows(db.prepare(
        `SELECT id, source, target, kind, line FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
      ).all(...batch, ...batch));
      for (const e of edges) {
        if (nodeSet.has(e.source) && nodeSet.has(e.target)) edgeMap.set(e.id, e);
      }
    }
    return [...edgeMap.values()];
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
      const placeholders = batch.map(() => '?').join(',');
      const rows = validateEdgeRows(db.prepare(
        `SELECT id, source, target, kind, line FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`,
      ).all(...batch, ...batch));
      for (const e of rows) edgeMap.set(e.id, e);
    }

    return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  } catch (e) {
    log.warn('readFilesFromDb failed', e);
    return null;
  }
}
