/**
 * 原生 SQLite 索引写侧（cycle-128）。
 *
 * ## 设计决定：复用上游 schema
 *
 * 上游 dsh-codegraph 的读侧契约（src/adapters/codeGraphRows.ts）是：
 *   nodes(id TEXT, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER,
 *         signature TEXT, docstring TEXT, is_exported INTEGER)
 *   edges(source TEXT, target TEXT, kind TEXT, metadata TEXT, line INTEGER)
 *
 * 原生索引**逐列复用**这个 schema（DDL 见 NATIVE_MIGRATION_SQL）。收益：
 * 既有读侧函数（readGraphFromDbPaged / readTopLevelNodesFromDb /
 * readNodeChildrenFromDb / readFileOutlineFromDb / readSymbolASTFromDb /
 * readEdgesFromDb / readEdgesForNodesFromDb / readFilesFromDb）在原生库上
 * **零改动可用**——「实现兼容代码图谱」不是复制上游实现，而是共享数据契约。
 *
 * ## 与 GraphRepository 的关系
 *
 * GraphRepository（同目录 viz.db）存的是可视化产物（快照/分析/偏好），
 * 本模块存的是**索引本体**（图数据）。同库不同表，一次打开两用。
 *
 * ## 指纹去重
 *
 * `index_meta` 表记录每个 workspace 的 (fingerprint, node_count, edge_count,
 * indexed_at)。同一指纹重复扫描零写入（与 graph_snapshots 的去重语义一致）。
 * fingerprint 由调用方传入（computeGraphFingerprint 的结构指纹）——本模块
 * 不感知指纹算法。
 *
 * ## 失败语义（与 codeGraphDb.ts 一致）
 *
 * 所有写函数不抛出：失败 log.warn 并返回 false。索引写失败不阻塞图返回
 * （图来自内存 batchScan；索引只是缓存层）。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge } from '../types/index.ts';

const log = scoped('native-index');

const require = createRequire(import.meta.url);

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

/**
 * 原生索引 DDL——**逐列复用上游 schema**（见模块头注）。
 * `edges.id` 刻意不建主键：上游 edges 的 id 是 INTEGER 自增，而本插件的
 * GraphEdge.id 是字符串（`tsedge:` 前缀等）。为了「同列名同语义」，原生库的
 * edges 用与上游相同的列布局，但 source+target+kind 联合去重由写侧保证，
 * 自增 id 仅作行标识（读侧 EDGE_ROW_COLUMNS 会 SELECT id，上游行是数字自增、
 * 原生行也是数字自增——同型）。
 */
const NATIVE_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL DEFAULT '',
    start_line INTEGER NOT NULL DEFAULT 0,
    signature TEXT,
    docstring TEXT,
    is_exported INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT,
    line INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_native_nodes_kind ON nodes(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_native_nodes_file ON nodes(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_native_edges_source ON edges(source)`,
  `CREATE INDEX IF NOT EXISTS idx_native_edges_target ON edges(target)`,
  `CREATE TABLE IF NOT EXISTS index_meta (
    workspace TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`,
] as const;

/** 原生索引写连接（每工作区一个；与 codeGraphDb 的只读池隔离）。 */
const writePool = new Map<string, SqliteDb>();

export function resolveNativeIndexPath(workspacePath: string): string {
  const root = workspacePath && workspacePath !== '.' ? workspacePath : process.cwd();
  const normalized = normalize(root);
  if (normalized.includes('..')) {
    throw new Error(`Invalid workspace path: ${workspacePath}`);
  }
  return join(normalized, '.codegraph-visualizer', 'native-index.db');
}

function getWriteDb(indexPath: string): SqliteDb | null {
  const existing = writePool.get(indexPath);
  if (existing) return existing;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    mkdirSync(join(indexPath, '..'), { recursive: true });
    const db = new DatabaseSync(indexPath) as unknown as SqliteDb;
    for (const ddl of NATIVE_MIGRATION_SQL) db.exec(ddl);
    writePool.set(indexPath, db);
    return db;
  } catch (e) {
    log.warn('native index open failed', { indexPath, error: String(e) });
    return null;
  }
}

/** 关闭全部写连接（dispose/测试清池；与 closeAllDbConnections 同型）。 */
export function closeNativeIndexConnections(): void {
  for (const db of writePool.values()) {
    try { db.close(); } catch { /* 已关闭 */ }
  }
  writePool.clear();
}

/**
 * 把原生批扫描的图数据写入索引（事务批量写 + 指纹去重）。
 *
 * @returns 是否真的写入（false = 同指纹已索引 / 打库失败 / 写失败）。
 * 上游行契约映射：
 *   GraphNode → nodes 行：kind=node.type（'function'|'class'|…，与上游 kind 词表
 *   同域——TreeSitter 的 SymbolKind 映射（TreeSitterAdapter.ts:119-186）产出的
 *   就是这四个值），is_exported 取 properties.isExported/is_exported 的布尔投影。
 *   GraphEdge → edges 行：kind=edge.type（'contains'|'extend'|…），line 取
 *   properties.line（AST 行号），metadata 恒 null（原生通道无 confidence 数据，
 *   不编造——parseEdgeConfidence 的保守降级哲学）。
 */
export function writeNativeIndex(
  workspacePath: string,
  fingerprint: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): boolean {
  let indexPath: string;
  try {
    indexPath = resolveNativeIndexPath(workspacePath);
  } catch (e) {
    log.warn('native index path rejected', { error: String(e) });
    return false;
  }
  const db = getWriteDb(indexPath);
  if (!db) return false;

  try {
    const meta = db.prepare('SELECT fingerprint, node_count, edge_count FROM index_meta WHERE workspace = ?').get(workspacePath) as
      | { fingerprint: string; node_count: number; edge_count: number }
      | undefined;
    if (meta && meta.fingerprint === fingerprint && meta.node_count === nodes.length && meta.edge_count === edges.length) {
      return false; // 同指纹同规模：零写入
    }

    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM nodes');
      db.exec('DELETE FROM edges');
      const insertNode = db.prepare(
        'INSERT OR REPLACE INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const n of nodes) {
        const props = (n.properties ?? {}) as Record<string, unknown>;
        const exported = props.isExported === true || props.is_exported === 1 || props.is_exported === true;
        insertNode.run(
          String(n.id),
          n.type,
          n.label,
          n.filePath ?? '',
          n.lineNumber ?? 0,
          typeof props.signature === 'string' ? props.signature : null,
          typeof props.docstring === 'string' ? props.docstring : null,
          exported ? 1 : 0,
        );
      }
      const insertEdge = db.prepare(
        'INSERT INTO edges (source, target, kind, metadata, line) VALUES (?, ?, ?, NULL, ?)',
      );
      for (const e of edges) {
        const props = (e.properties ?? {}) as Record<string, unknown>;
        const line = typeof props.line === 'number' && Number.isFinite(props.line) ? Math.round(props.line) : null;
        insertEdge.run(String(e.source), String(e.target), e.type, line);
      }
      db.prepare(
        'INSERT OR REPLACE INTO index_meta (workspace, fingerprint, node_count, edge_count, indexed_at) VALUES (?, ?, ?, ?, ?)',
      ).run(workspacePath, fingerprint, nodes.length, edges.length, Date.now());
      db.exec('COMMIT');
      log.info('native index written', { workspacePath, nodes: nodes.length, edges: edges.length, fingerprint: fingerprint.slice(0, 12) });
      return true;
    } catch (inner) {
      db.exec('ROLLBACK');
      throw inner;
    }
  } catch (e) {
    log.warn('native index write failed', { error: String(e) });
    return false;
  }
}

/** 读取某工作区的索引元数据（null = 未索引 / 读失败）。 */
export function readNativeIndexMeta(workspacePath: string): { fingerprint: string; nodeCount: number; edgeCount: number; indexedAt: number } | null {
  let indexPath: string;
  try {
    indexPath = resolveNativeIndexPath(workspacePath);
  } catch {
    return null;
  }
  if (!existsSync(indexPath)) return null;
  const db = getWriteDb(indexPath);
  if (!db) return null;
  try {
    const row = db.prepare('SELECT fingerprint, node_count, edge_count, indexed_at FROM index_meta WHERE workspace = ?').get(workspacePath) as
      | { fingerprint: string; node_count: number; edge_count: number; indexed_at: number }
      | undefined;
    if (!row) return null;
    return { fingerprint: row.fingerprint, nodeCount: row.node_count, edgeCount: row.edge_count, indexedAt: row.indexed_at };
  } catch (e) {
    log.warn('native index meta read failed', { error: String(e) });
    return null;
  }
}

/**
 * 定向更新（cycle-129 · T3）：把改动文件的旧行删除、新行写入——watcher 增量
 * 路径的索引侧。与 writeNativeIndex 的「全量 DELETE+INSERT」相对，这里只触碰
 * 改动文件的 nodes 行与**端点涉及这些节点**的 edges 行（增量读侧 readFilesFromDb
 * 的对称操作）。
 *
 * @param changedFiles repo 相对路径（与 watcher 的 changedFiles 同域）。
 * @returns 是否真的更新（false = 未索引过 / 无变化 / 失败）。
 *
 * 匹配语义与读侧 readFilesFromDb 一致：`file_path IN (改动文件)` 或
 * `file_path LIKE '改动目录/%'`（目录级变更）。注意 file_path 列存的是
 * GraphNode.filePath 原样（TreeSitter 产出为 repo 相对 posix 路径）。
 */
export function updateFilesForNativeIndex(
  workspacePath: string,
  changedFiles: readonly string[],
  newNodes: readonly GraphNode[],
  newEdges: readonly GraphEdge[],
  newFingerprint: string,
): boolean {
  if (changedFiles.length === 0) return false;
  let indexPath: string;
  try {
    indexPath = resolveNativeIndexPath(workspacePath);
  } catch (e) {
    log.warn('native index path rejected', { error: String(e) });
    return false;
  }
  if (!existsSync(indexPath)) return false; // 未索引过：让调用方走全量回写
  const db = getWriteDb(indexPath);
  if (!db) return false;

  try {
    // 改动文件的规整集合（与 readFilesFromDb 同域：posix 保留 + 反斜杠变体）。
    const wanted = new Set<string>();
    for (const raw of changedFiles) {
      const normalized = raw.replace(/\\/g, '/');
      if (!normalized) continue;
      wanted.add(normalized);
    }
    if (wanted.size === 0) return false;

    // ① 找出改动文件涉及的**旧节点 id**（含目录前缀命中——目录变更时其下文件
    //    的符号节点 file_path 以目录为前缀，但节点自身的 file_path 是文件路径；
    //    这里按节点 file_path 精确匹配 + 目录前缀两层都要删）。
    const placeholders = [...wanted].map(() => '?').join(',');
    const prefixConds = [...wanted].map(() => "file_path LIKE ? ESCAPE '\\'").join(' OR ');
    const prefixArgs = [...wanted].map((p) => `${p.replace(/[%_\\]/g, '\\$&')}/%`);
    const staleNodes = db.prepare(
      `SELECT id FROM nodes WHERE file_path IN (${placeholders}) OR ${prefixConds}`,
    ).all(...wanted, ...prefixArgs) as Array<{ id: string }>;
    if (staleNodes.length === 0) return false;

    db.exec('BEGIN');
    try {
      // ② 删除旧边（端点涉及任一旧节点 id）。
      const staleIds = staleNodes.map((r) => r.id);
      for (let i = 0; i < staleIds.length; i += 500) {
        const batch = staleIds.slice(i, i + 500);
        const ph = batch.map(() => '?').join(',');
        db.prepare(`DELETE FROM edges WHERE source IN (${ph}) OR target IN (${ph})`).run(...batch, ...batch);
      }
      // ③ 删除旧节点。
      for (let i = 0; i < staleIds.length; i += 500) {
        const batch = staleIds.slice(i, i + 500);
        const ph = batch.map(() => '?').join(',');
        db.prepare(`DELETE FROM nodes WHERE id IN (${ph})`).run(...batch);
      }
      // ④ 写入新节点/新边（与 writeNativeIndex 同映射）。
      const insertNode = db.prepare(
        'INSERT OR REPLACE INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const n of newNodes) {
        const props = (n.properties ?? {}) as Record<string, unknown>;
        const exported = props.isExported === true || props.is_exported === 1 || props.is_exported === true;
        insertNode.run(
          String(n.id), n.type, n.label, n.filePath ?? '', n.lineNumber ?? 0,
          typeof props.signature === 'string' ? props.signature : null,
          typeof props.docstring === 'string' ? props.docstring : null,
          exported ? 1 : 0,
        );
      }
      const insertEdge = db.prepare(
        'INSERT INTO edges (source, target, kind, metadata, line) VALUES (?, ?, ?, NULL, ?)',
      );
      for (const e of newEdges) {
        const props = (e.properties ?? {}) as Record<string, unknown>;
        const line = typeof props.line === 'number' && Number.isFinite(props.line) ? Math.round(props.line) : null;
        insertEdge.run(String(e.source), String(e.target), e.type, line);
      }
      // ⑤ meta 前移（规模重算：旧规模 − 旧节点数 + 新节点数；指纹由调用方给）。
      const prev = db.prepare('SELECT node_count, edge_count FROM index_meta WHERE workspace = ?').get(workspacePath) as
        | { node_count: number; edge_count: number } | undefined;
      const removedEdges = db.prepare(
        'SELECT changes() as c',
      ).get() as { c: number } | undefined;
      void removedEdges;
      const counts = db.prepare('SELECT (SELECT COUNT(*) FROM nodes) as n, (SELECT COUNT(*) FROM edges) as e').get() as { n: number; e: number };
      db.prepare(
        'INSERT OR REPLACE INTO index_meta (workspace, fingerprint, node_count, edge_count, indexed_at) VALUES (?, ?, ?, ?, ?)',
      ).run(workspacePath, newFingerprint, counts.n, counts.e, Date.now());
      void prev;
      db.exec('COMMIT');
      log.info('native index updated (targeted)', { workspacePath, changedFiles: changedFiles.length, staleNodes: staleIds.length, newNodes: newNodes.length, newEdges: newEdges.length });
      return true;
    } catch (inner) {
      db.exec('ROLLBACK');
      throw inner;
    }
  } catch (e) {
    log.warn('native index targeted update failed', { error: String(e) });
    return false;
  }
}

/**
 * 删除原生索引（cycle-141 管理面板）。
 *
 * 删除索引 DB 文件本身（.codegraph-visualizer/native-index.db），
 * 让下次构建重新生成。幂等：DB 不存在时返回 false 而非抛错。
 *
 * 注意：只删原生索引，不删上游 DB（.codegraph/codegraph.db）——
 * 上游 DB 是 codegraph 工具的产物，由 codegraph 自己管理。
 */
export function deleteNativeIndex(workspacePath: string): boolean {
  let indexPath: string;
  try {
    indexPath = resolveNativeIndexPath(workspacePath);
  } catch (e) {
    log.warn('native index path rejected', { error: String(e) });
    return false;
  }
  if (!existsSync(indexPath)) return false;
  try {
    // 先关闭写连接（如果池里有），再删文件。
    const db = writePool.get(indexPath);
    if (db) {
      try { db.close(); } catch { /* 已关闭 */ }
      writePool.delete(indexPath);
    }
    rmSync(indexPath);
    log.info('native index deleted', { indexPath });
    return true;
  } catch (e) {
    log.warn('native index delete failed', { error: String(e) });
    return false;
  }
}
