/**
 * codegraph.db 的连接池 + 行校验 + **节点侧**读取（cycle-110 Q7 行为等价提取）。
 *
 * 抽取契约：
 *   · `dbPool` 是**唯一**的连接池（模块级单例）。连接按 dbPath 复用，超过 `MAX_DB_POOL_SIZE`
 *     按最久未用淘汰；`closeAllDbConnections()` 是测试与 dispose 的唯一清池入口。
 *     把池搬走不会产生第二个池——ESM 模块实例唯一。
 *   · 所有读取函数遵循同一形状：拿不到连接返回 `null`；SQLite 抛错 catch 后 `log.warn` 并返回
 *     `null`（调用方据此回落到"整图取数"），**不抛出**。这与重构前完全一致。
 *   · 行一律经 `validateNodeRows` / `validateEdgeRows` 过滤：上游 DB 可能被半途写入，
 *     无效行只记 warn 不中断读取。
 *   · 分页游标是 base64(JSON) 的不透明串；`encodeCursor`/`decodeCursor` 不校验版本，
 *     旧游标喂给新代码由调用方（`fetchData`）自己保证不可能发生。
 *
 * 边侧读取见 `codeGraphEdgeReads.ts`，行→图映射见 `codeGraphRows.ts`。
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { scoped } from '../shared/Logger.ts';
import { SQLITE } from '../shared/constants.ts';
import { EDGE_ROW_COLUMNS, type DbNodeRow, type DbEdgeRow, NOISE_PATH_SEGMENTS_EXPORT } from './codeGraphRows.ts';

const log = scoped('codegraph-adapter');

const require = createRequire(import.meta.url);

// ---- DB connection pool ---------------------------------------------------

type SqliteDb = {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
};

const dbPool = new Map<string, SqliteDb>();
const MAX_DB_POOL_SIZE = 5;

export function getDbConnection(dbPath: string): SqliteDb | null {
  if (!existsSync(dbPath)) return null;
  const existing = dbPool.get(dbPath);
  if (existing) {
    dbPool.delete(dbPath);
    dbPool.set(dbPath, existing);
    return existing;
  }
  if (dbPool.size >= MAX_DB_POOL_SIZE) {
    const oldest = dbPool.keys().next().value;
    if (oldest !== undefined) {
      const oldDb = dbPool.get(oldest);
      dbPool.delete(oldest);
      try { oldDb?.close(); } catch { /* ignore */ }
      log.info('db pool: evicted connection', { dbPath: oldest });
    }
  }
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true }) as unknown as SqliteDb;
  dbPool.set(dbPath, db);
  log.info('db pool: opened connection', { dbPath, poolSize: dbPool.size });
  return db;
}

export function closeAllDbConnections(): void {
  for (const [, db] of dbPool.entries()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  dbPool.clear();
  log.info('db pool: all connections closed');
}

export function countEdgesInDb(dbPath: string): number {
  const db = getDbConnection(dbPath);
  if (!db) return 0;
  try {
    const result = db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number } | undefined;
    return result?.cnt ?? 0;
  } catch {
    return 0;
  }
}

function isDbNodeRow(row: unknown): row is DbNodeRow {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.kind === 'string' &&
    typeof r.name === 'string' && typeof r.file_path === 'string';
}

function isDbEdgeRow(row: unknown): row is DbEdgeRow {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  if (!(typeof r.source === 'string' && typeof r.target === 'string' &&
    typeof r.kind === 'string')) return false;
  // metadata：cycle-119 起参与 SELECT。行级校验**容忍缺失**（undefined 归一为 null）——
  // 直接喂字面量行的测试与旧 schema 的 fixture 不必同步建列；真正的列缺失会在
  // SELECT 处 throw（catch 落 null 返回），不会走到这里。
  if (r.metadata !== undefined && r.metadata !== null && typeof r.metadata !== 'string') return false;
  (r as { metadata: string | null }).metadata = r.metadata ?? null;
  return true;
}

export function validateNodeRows(rows: unknown[]): DbNodeRow[] {
  const valid: DbNodeRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isDbNodeRow(row)) valid.push(row);
    else skipped++;
  }
  if (skipped > 0) log.warn('db node rows: skipped invalid rows', { skipped, total: rows.length });
  return valid;
}

export function validateEdgeRows(rows: unknown[]): DbEdgeRow[] {
  const valid: DbEdgeRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isDbEdgeRow(row)) valid.push(row);
    else skipped++;
  }
  if (skipped > 0) log.warn('db edge rows: skipped invalid rows', { skipped, total: rows.length });
  return valid;
}

/** Read the whole graph from a codegraph.db. Returns null when unreadable. */
export function readGraphFromDb(dbPath: string): { nodes: DbNodeRow[]; edges: DbEdgeRow[] } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const nodes = validateNodeRows(db.prepare(
      'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes',
    ).all());
    const edges = validateEdgeRows(db.prepare(
      `SELECT ${EDGE_ROW_COLUMNS} FROM edges`,
    ).all());
    return { nodes, edges };
  } catch (e) {
    log.warn('readGraphFromDb failed', e);
    return null;
  }
}

export type GraphPageCursor = string;

export interface GraphPageResult {
  nodes: DbNodeRow[];
  edges: DbEdgeRow[];
  nextCursor: GraphPageCursor | null;
  done: boolean;
  stats: { nodeCount: number; edgeCount: number; phase: 'nodes' | 'edges' | 'done' };
}

interface CursorState {
  phase: 'nodes' | 'edges';
  nodeCursor: string | null;
  edgeCursor: number | null;
  totalNodes: number;
  totalEdges: number;
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
}

function decodeCursor(cursor: string): CursorState {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as CursorState;
}

export function readGraphFromDbPaged(
  dbPath: string,
  cursor: GraphPageCursor | null,
  limit: number,
): GraphPageResult | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;

  const state: CursorState = cursor
    ? decodeCursor(cursor)
    : { phase: 'nodes', nodeCursor: null, edgeCursor: null, totalNodes: 0, totalEdges: 0 };

  try {
    if (state.phase === 'nodes') {
      const nodes = validateNodeRows(db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE id > ? ORDER BY id LIMIT ?',
      ).all(state.nodeCursor ?? '', limit));
      state.totalNodes += nodes.length;

      if (nodes.length < limit) {
        state.phase = 'edges';
        state.nodeCursor = null;
        const edges = validateEdgeRows(db.prepare(
          `SELECT ${EDGE_ROW_COLUMNS} FROM edges ORDER BY id LIMIT ?`,
        ).all(limit));
        state.totalEdges += edges.length;
        state.edgeCursor = edges.length > 0 ? edges[edges.length - 1]!.id : null;
        const done = edges.length < limit;
        return {
          nodes, edges,
          nextCursor: done ? null : encodeCursor(state),
          done,
          stats: { nodeCount: state.totalNodes, edgeCount: state.totalEdges, phase: done ? 'done' : 'edges' },
        };
      }

      state.nodeCursor = nodes[nodes.length - 1]!.id;
      return {
        nodes, edges: [],
        nextCursor: encodeCursor(state),
        done: false,
        stats: { nodeCount: state.totalNodes, edgeCount: 0, phase: 'nodes' },
      };
    }

    const edges = validateEdgeRows(db.prepare(
      `SELECT ${EDGE_ROW_COLUMNS} FROM edges WHERE id > ? ORDER BY id LIMIT ?`,
    ).all(state.edgeCursor ?? 0, limit));
    state.totalEdges += edges.length;
    const done = edges.length < limit;
    state.edgeCursor = edges.length > 0 ? edges[edges.length - 1]!.id : null;
    return {
      nodes: [], edges,
      nextCursor: done ? null : encodeCursor(state),
      done,
      stats: { nodeCount: state.totalNodes, edgeCount: state.totalEdges, phase: done ? 'done' : 'edges' },
    };
  } catch (e) {
    log.warn('readGraphFromDbPaged failed', e);
    return null;
  }
}

// cycle-141：噪音路径 SQL 过滤——在 LIMIT 之前排除非源码目录。
// 必须在 SQL 侧过滤而非映射侧：LIMIT 50 会选出前 50 行，如果 .cycles/
// 归档目录（字母序 . < s）先被索引，映射阶段再过滤就只剩不到 50 个节点。
function buildNoiseWhereClause(): string {
  const segments = NOISE_PATH_SEGMENTS_EXPORT;
  const filters = segments.map((seg) => "REPLACE(file_path, '\\', '/') NOT LIKE '%/" + seg + "%'");
  return filters.join(' AND ');
}
export function readTopLevelNodesFromDb(dbPath: string, limit: number): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const noiseWhere = buildNoiseWhereClause();
    const kindWhere = "kind IN ('file', 'module', 'import')";
    // 【P0-R19-02】优先选出 dir:/file: 节点——避免 1777 个<import_statement>伪节点被 id 字母序挤出顶层（dsh-anic 真机症结）
    // 排序键：dir: > file: > import_statement module；次按长度再 id，保证稳定顺序
    const topLevelOrderBy = [
      "CASE WHEN REPLACE(id,'\\','/') LIKE 'dir:%' THEN 1 WHEN REPLACE(id,'\\','/') LIKE 'file:%' THEN 2 ELSE 3 END",
      "LENGTH(file_path)",
      "id"
    ].join(', ');
    
    const whereClause = noiseWhere ? kindWhere + ' AND ' + noiseWhere : kindWhere;
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE ' + whereClause).get() as { cnt: number }).cnt;
    const nodes = validateNodeRows(db.prepare(
      `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported 
       FROM nodes WHERE ${whereClause} ORDER BY ${topLevelOrderBy} LIMIT ?`,
    ).all(limit));
    return { nodes, total };
  } catch (e) {
    log.warn('readTopLevelNodesFromDb failed', e);
    return null;
  }
}

export function readNodeChildrenFromDb(dbPath: string, parentId: string, cursor: string | null, limit: number): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\')').get(parentId) as { cnt: number }).cnt;
    const nodes = cursor
      ? validateNodeRows(db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\') AND id > ? ORDER BY id LIMIT ?',
      ).all(parentId, cursor, limit))
      : validateNodeRows(db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\') ORDER BY id LIMIT ?',
      ).all(parentId, limit));
    return { nodes, total };
  } catch (e) {
    log.warn('readNodeChildrenFromDb failed', e);
    return null;
  }
}

export function readFileOutlineFromDb(dbPath: string, fileId: string): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const nodes = validateNodeRows(db.prepare(
      `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN ('file', 'module', 'import')`,
    ).all(fileId));
    return { nodes, total: nodes.length };
  } catch (e) {
    log.warn('readFileOutlineFromDb failed', e);
    return null;
  }
}

export function readSymbolASTFromDb(dbPath: string, symbolId: string): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const symbolRow = db.prepare('SELECT file_path, start_line FROM nodes WHERE id = ?').get(symbolId) as { file_path: string; start_line: number } | undefined;
    if (!symbolRow) return { nodes: [], total: 0 };
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE source = ?').get(symbolId) as { cnt: number }).cnt;
    const calleeIds = db.prepare('SELECT target FROM edges WHERE source = ?').all(symbolId) as { target: string }[];
    if (calleeIds.length === 0) return { nodes: [], total: 0 };
    const idList = calleeIds.map(r => r.target);
    const allNodes: DbNodeRow[] = [];
    const batchSize = SQLITE.MAX_IN_PARAMS;
    for (let i = 0; i < idList.length; i += batchSize) {
      const batch = idList.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const batchNodes = validateNodeRows(db.prepare(
        `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE id IN (${placeholders})`,
      ).all(...batch));
      allNodes.push(...batchNodes);
    }
    return { nodes: allNodes, total };
  } catch (e) {
    log.warn('readSymbolASTFromDb failed', e);
    return null;
  }
}
