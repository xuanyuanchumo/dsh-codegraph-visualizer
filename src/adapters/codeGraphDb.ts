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
import { collapseRepeatedBackslashes } from './nativeIndex.ts';

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
    // 存量脏库兼容：修复前写入的行 id/file_path 带双反斜杠——返回前折叠，保证
    // bootstrap 下发的 id 与后续 children/edges 查询参数同域（单形态）。
    for (const row of nodes) {
      (row as { id: string }).id = collapseRepeatedBackslashes(row.id);
      (row as { file_path: string }).file_path = collapseRepeatedBackslashes(row.file_path);
    }
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
    // cycle-141 第六轮（dsh-anic 真机复现：展开 src 目录 total=0）：**dir: 目录节点
    // 走 contains 边语义**。原生索引的目录树是 dir→dir / dir→file 的 contains 边
    //（FileSystemAdapter 生成），现有「file_path = 父.file_path AND kind NOT IN 顶层」
    // 语义只为上游索引的 file→符号 设计——对 dir: 节点该查询恒返回 0（实测：
    // dir 节点 existing children semantics = 0，而 contains 边有 3 条）。
    // dir: 分支按 contains 边读孩子（分页 + 与文件符号同分页语义）；file: 分支
    // 保持原语义逐字节不变（上游行为零改动）。
    //
    // 存量脏库兼容（collapseRepeatedBackslashes 的对称问题）：修复前写入的库
    // id/边端点带**双反斜杠**（真机 dsh-anic 实测），而修复后客户端拿到的 bootstrap id
    // 是折叠后的单反斜杠——直接用单形态查双形态库必落空。查询参数与脏库值同时
    // 归一到「原样」域做不到（不知道库是哪个形态），所以做**双形态查询**：
    // 先按调用方形态查，0 命中且 parentId 含反斜杠时**扩展成双反斜杠**再查一次
    //（单→双是脏库方向：脏库每个分隔符都是两个字符）。写侧已消毒，新库恒单形态、
    // 第一查必命中，双查是纯存量兼容路径。
    if (parentId.startsWith('dir:')) {
      const expandBackslashes = (s: string) => s.replace(/\\/g, '\\\\');
      const probe = (id: string) =>
        (db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE source = ? AND kind = \'contains\'').get(id) as { cnt: number }).cnt;
      let effectiveId = parentId;
      if (probe(parentId) === 0 && parentId.includes('\\')) {
        const expanded = expandBackslashes(parentId);
        if (probe(expanded) > 0) effectiveId = expanded;
      }
      const total = (db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE source = ? AND kind = \'contains\'').get(effectiveId) as { cnt: number }).cnt;
      const rows = cursor
        ? db.prepare(
          'SELECT e.target AS target FROM edges e WHERE e.source = ? AND e.kind = \'contains\' AND e.target > ? ORDER BY e.target LIMIT ?',
        ).all(effectiveId, cursor, limit) as { target: string }[]
        : db.prepare(
          'SELECT e.target AS target FROM edges e WHERE e.source = ? AND e.kind = \'contains\' ORDER BY e.target LIMIT ?',
        ).all(effectiveId, limit) as { target: string }[];
      if (rows.length === 0) return { nodes: [], total };
      const targets = rows.map((r) => r.target);
      const placeholders = targets.map(() => '?').join(',');
      const nodes = validateNodeRows(db.prepare(
        `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE id IN (${placeholders})`,
      ).all(...targets));
      // 脏库行 id 也是双形态：随行返回（客户端可见）前折叠——bootstrap 与 children
      // 的 id 域必须一致，否则客户端展开后挂不上树。
      for (const row of nodes) {
        (row as { id: string }).id = collapseRepeatedBackslashes(row.id);
        (row as { file_path: string }).file_path = collapseRepeatedBackslashes(row.file_path);
      }
      // 按 target id 排序（IN 的返回顺序不保证稳定——分页游标语义要求与 ORDER BY target 一致）。
      const order = new Map(targets.map((t, i) => [t, i]));
      nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      // 返回形状与 file: 分支一致（{nodes, total}）：cursor 推进由调用方用
      // 「本页最后一条 id」判定（dataRoutes /children 的既有约定），不在此引入第二套游标语义。
      return { nodes, total };
    }
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\')').get(resolveNodeIdForQuery(db, parentId)) as { cnt: number }).cnt;
    const effectiveParent = resolveNodeIdForQuery(db, parentId);
    const nodes = cursor
      ? validateNodeRows(db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\') AND id > ? ORDER BY id LIMIT ?',
      ).all(effectiveParent, cursor, limit))
      : validateNodeRows(db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\') ORDER BY id LIMIT ?',
      ).all(effectiveParent, limit));
    // 脏库行折叠（与 dir: 分支同一理由）：返回 id 与 bootstrap 域一致。
    for (const row of nodes) {
      (row as { id: string }).id = collapseRepeatedBackslashes(row.id);
      (row as { file_path: string }).file_path = collapseRepeatedBackslashes(row.file_path);
    }
    return { nodes, total };
  } catch (e) {
    log.warn('readNodeChildrenFromDb failed', e);
    return null;
  }
}

/**
 * 存量脏库的 id 归一查询（cycle-141 第六轮）。
 *
 * 修复前写入的库 id 带双反斜杠（真机 dsh-anic 实测），而修复后调用方传的是折叠
 * 后的单形态 id——按单形态查脏库必落空。策略：先按调用方原样查（新库恒命中）；
 * 0 命中且 id 含反斜杠时**扩展成双反斜杠**再查一次（单→双是脏库方向：脏库每个
 * 分隔符都是两个字符）。命中则返回扩展形态——调用方用它做实际查询。
 */
function resolveNodeIdForQuery(db: SqliteDb, nodeId: string): string {
  const exists = db.prepare('SELECT 1 AS ok FROM nodes WHERE id = ?').get(nodeId);
  if (exists) return nodeId;
  if (!nodeId.includes('\\')) return nodeId;
  const expanded = nodeId.replace(/\\/g, '\\\\');
  const existsExpanded = db.prepare('SELECT 1 AS ok FROM nodes WHERE id = ?').get(expanded);
  return existsExpanded ? expanded : nodeId;
}

/**
 * 脏库行消毒：id/file_path 折叠回单形态再返回给调用方。
 *
 * 返回行是客户端可见的数据面——bootstrap（本文件顶层读取）与 children/outline
 * 的 id 域必须一致，否则客户端展开后挂不上树（真机 "Projects (50)" 家族的
 * 第二形态：不是查不到数据，而是两批数据的 id 域不同）。
 */
function sanitizeDirtyRows(rows: DbNodeRow[]): DbNodeRow[] {
  for (const row of rows) {
    (row as { id: string }).id = collapseRepeatedBackslashes(row.id);
    (row as { file_path: string }).file_path = collapseRepeatedBackslashes(row.file_path);
  }
  return rows;
}

export function readFileOutlineFromDb(dbPath: string, fileId: string): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const effectiveId = resolveNodeIdForQuery(db, fileId);
    const nodes = sanitizeDirtyRows(validateNodeRows(db.prepare(
      `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN ('file', 'module', 'import')`,
    ).all(effectiveId)));
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
    const effectiveId = resolveNodeIdForQuery(db, symbolId);
    const symbolRow = db.prepare('SELECT file_path, start_line FROM nodes WHERE id = ?').get(effectiveId) as { file_path: string; start_line: number } | undefined;
    if (!symbolRow) return { nodes: [], total: 0 };
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE source = ?').get(effectiveId) as { cnt: number }).cnt;
    const calleeIds = db.prepare('SELECT target FROM edges WHERE source = ?').all(effectiveId) as { target: string }[];
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
    return { nodes: sanitizeDirtyRows(allNodes), total };
  } catch (e) {
    log.warn('readSymbolASTFromDb failed', e);
    return null;
  }
}
