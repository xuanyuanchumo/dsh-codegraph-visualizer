// CodeGraphAdapter - adapter for the optional dsh-codegraph data source.
//
// Primary path: read the .codegraph/codegraph.db SQLite index directly
// (node:sqlite, Node >= 22.5). One O(N+E) query returns the whole graph —
// no N+1 tool calls, works even when dsh-codegraph's tool surface is 'core'
// (which exposes no full-graph query tool).
//
// Fallback path: upstream tools (codegraph_query / codegraph_callers /
// codegraph_callees) when the DB cannot be read (e.g. remote sandboxed fs).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, normalize } from 'node:path';
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import { scoped } from '../shared/Logger.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import { SQLITE, CODEGRAPH_ADAPTER, INCREMENTAL } from '../shared/constants.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';

export type { UpstreamInvoker } from './IAdapter.ts';

const log = scoped('codegraph-adapter');

const require = createRequire(import.meta.url);

// ---- DB connection pool ---------------------------------------------------

type SqliteDb = {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
};

const dbPool = new Map<string, SqliteDb>();
const MAX_DB_POOL_SIZE = 5;

function getDbConnection(dbPath: string): SqliteDb | null {
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
  line: number | null;
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
  return typeof r.source === 'string' && typeof r.target === 'string' &&
    typeof r.kind === 'string';
}

function validateNodeRows(rows: unknown[]): DbNodeRow[] {
  const valid: DbNodeRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isDbNodeRow(row)) valid.push(row);
    else skipped++;
  }
  if (skipped > 0) log.warn('db node rows: skipped invalid rows', { skipped, total: rows.length });
  return valid;
}

function validateEdgeRows(rows: unknown[]): DbEdgeRow[] {
  const valid: DbEdgeRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isDbEdgeRow(row)) valid.push(row);
    else skipped++;
  }
  if (skipped > 0) log.warn('db edge rows: skipped invalid rows', { skipped, total: rows.length });
  return valid;
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
    edges.push({
      id: EdgeId(String(e.id)),
      source: NodeId(e.source),
      target: NodeId(e.target),
      type: mapEdgeKind(e.kind),
      properties: {
        ...(e.line !== null && e.line !== undefined ? { line: e.line } : {}),
        ...(opts.source ? { __source: opts.source } : {}),
      },
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
 * Locate the .codegraph/codegraph.db for a workspace path.
 * Callers MUST validate workspacePath via resolveWorkspaceFromRequest or
 * validateWorkspacePath before calling this function.
 */
export function resolveDbPath(workspacePath: string): string {
  const root = workspacePath && workspacePath !== '.' ? workspacePath : process.cwd();
  const normalized = normalize(root);
  if (normalized.includes('..')) {
    throw new Error(`Invalid workspace path: ${workspacePath}`);
  }
  return join(normalized, '.codegraph', 'codegraph.db');
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
      'SELECT id, source, target, kind, line FROM edges',
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
          'SELECT id, source, target, kind, line FROM edges ORDER BY id LIMIT ?',
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
      'SELECT id, source, target, kind, line FROM edges WHERE id > ? ORDER BY id LIMIT ?',
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

export function readTopLevelNodesFromDb(dbPath: string, limit: number): { nodes: DbNodeRow[]; total: number } | null {
  const db = getDbConnection(dbPath);
  if (!db) return null;
  try {
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE kind IN (\'file\', \'module\', \'import\')').get() as { cnt: number }).cnt;
    const nodes = validateNodeRows(db.prepare(
      'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE kind IN (\'file\', \'module\', \'import\') LIMIT ?',
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
 * Normalize a repo-relative path for comparison against the index's own `file_path` values.
 *
 * The watcher reports platform separators while the indexer stores whatever it was handed, so the
 * two forms have to be reconciled before any lookup. Callers that need both spellings should ask
 * for them explicitly rather than relying on the index to pick one.
 */
export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
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

/** The `source` every row this adapter produces is attributed to. */
export const CODEGRAPH_SOURCE: DataSourceType = 'codegraph';

export class CodeGraphAdapter implements IDataAdapter {
  readonly source: DataSourceType = CODEGRAPH_SOURCE;

  async fetchData(repoId: string, invoke: UpstreamInvoker): Promise<AdapterResult> {
    // Primary: paged SQLite read of the upstream index (avoids OOM on large repos).
    const dbPath = resolveDbPath(repoId);
    let cursor: GraphPageCursor | null = null;
    const allNodes: DbNodeRow[] = [];
    const allEdges: DbEdgeRow[] = [];
    const PAGE = 500;
    do {
      const page = readGraphFromDbPaged(dbPath, cursor, PAGE);
      if (!page) { allNodes.length = 0; break; }
      allNodes.push(...page.nodes);
      allEdges.push(...page.edges);
      cursor = page.nextCursor;
    } while (cursor !== null);

    if (allNodes.length > 0) {
      return this.toAdapterResult(allNodes, allEdges);
    }

    // Fallback (DB unreadable): assemble a file-structure skeleton from the
    // upstream `codegraph_files` tool so the panel at least shows the project
    // layout. No relations — the full graph needs the DB.
    const files = await invoke('codegraph_files', { path: repoId, format: 'flat' });
    if (!files || typeof files !== 'object') {
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };
    }
    const rawFiles = this.extractFileList(files);
    const nodes: GraphNode[] = rawFiles
      .filter((f) => !isNoisePath(f.path))
      .map((f, i) => ({
      id: NodeId(`file:${f.path}`),
      label: f.path.split('/').pop() ?? f.path,
      type: 'module',
      filePath: f.path,
      lineNumber: 1,
      properties: { kind: 'file', language: f.language ?? null, index: i },
      layer: inferLayerFromPath(f.path),
    }));
    return { nodes, edges: [], source: this.source, timestamp: Date.now() };
  }

  private extractFileList(files: unknown): Array<{ path: string; language?: string }> {
    // codegraph_files --json returns either an array of file records or an
    // object with a files/files[] key, depending on CLI version.
    if (Array.isArray(files)) {
      return files.flatMap((f) => {
        if (typeof f === 'string') return [{ path: f }];
        const rec = f as Record<string, unknown>;
        if (typeof rec.path === 'string') return [{ path: rec.path, language: rec.language as string | undefined }];
        return [];
      });
    }
    const obj = files as Record<string, unknown>;
    const inner = obj?.files ?? obj?.items;
    return Array.isArray(inner) ? this.extractFileList(inner) : [];
  }

  private toAdapterResult(dbNodes: DbNodeRow[], dbEdges: DbEdgeRow[]): AdapterResult {
    // 节点/边的映射与过滤全部委托给共享实现，增量路径走同一份逻辑（见 mapRowsToGraphNodes /
    // mapRowsToGraphEdges）。这里不传 `source`：`__source` 由 GraphDataMerger.merge 统一打标。
    const nodes = mapRowsToGraphNodes(dbNodes);
    const validNodeIds = new Set<string>(nodes.map((n) => n.id as string));
    const edges = mapRowsToGraphEdges(dbEdges, validNodeIds);
    return { nodes, edges, source: this.source, timestamp: Date.now() };
  }
}
