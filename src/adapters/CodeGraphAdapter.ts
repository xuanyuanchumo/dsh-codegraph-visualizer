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
import { SQLITE } from '../shared/constants.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';

export type { UpstreamInvoker } from './IAdapter.ts';

const log = scoped('codegraph-adapter');

const require = createRequire(import.meta.url);

// ---- codegraph.db schema (upstream @colbymchenry/codegraph) ----------------

interface DbNodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  signature: string | null;
  docstring: string | null;
  is_exported: number;
}

interface DbEdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  line: number | null;
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

const MAX_IMPORTS_PER_SOURCE = 20;

export function mapNodeKind(kind: string): GraphNode['type'] {
  return NODE_KIND_MAP[kind] ?? 'module';
}

export function mapEdgeKind(kind: string): GraphEdge['type'] {
  return EDGE_KIND_MAP[kind] ?? 'dependency';
}

/** Locate the .codegraph/codegraph.db for a workspace path. */
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
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const nodes = db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes',
      ).all() as unknown as DbNodeRow[];
      const edges = db.prepare(
        'SELECT id, source, target, kind, line FROM edges',
      ).all() as unknown as DbEdgeRow[];
      return { nodes, edges };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readGraphFromDb failed', e);
    return null;
  }
}

export function readTopLevelNodesFromDb(dbPath: string, limit: number): { nodes: DbNodeRow[]; total: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE kind IN (\'file\', \'module\', \'import\')').get() as { cnt: number }).cnt;
      const nodes = db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE kind IN (\'file\', \'module\', \'import\') LIMIT ?',
      ).all(limit) as unknown as DbNodeRow[];
      return { nodes, total };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readTopLevelNodesFromDb failed', e);
    return null;
  }
}

export function readNodeChildrenFromDb(dbPath: string, parentId: string, cursor: number, limit: number): { nodes: DbNodeRow[]; total: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?)').get(parentId) as { cnt: number }).cnt;
      const nodes = db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = (SELECT file_path FROM nodes WHERE id = ?) AND kind NOT IN (\'file\', \'module\', \'import\') LIMIT ? OFFSET ?',
      ).all(parentId, limit, cursor) as unknown as DbNodeRow[];
      return { nodes, total };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readNodeChildrenFromDb failed', e);
    return null;
  }
}

export function readFileOutlineFromDb(dbPath: string, fileId: string): { nodes: DbNodeRow[]; total: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const filePathRow = db.prepare('SELECT file_path FROM nodes WHERE id = ?').get(fileId) as { file_path: string } | undefined;
      if (!filePathRow) return { nodes: [], total: 0 };
      const filePath = filePathRow.file_path;
      const total = (db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE file_path = ? AND kind NOT IN (\'file\', \'module\', \'import\')').get(filePath) as { cnt: number }).cnt;
      const nodes = db.prepare(
        'SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE file_path = ? AND kind NOT IN (\'file\', \'module\', \'import\')',
      ).all(filePath) as unknown as DbNodeRow[];
      return { nodes, total };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readFileOutlineFromDb failed', e);
    return null;
  }
}

export function readSymbolASTFromDb(dbPath: string, symbolId: string): { nodes: DbNodeRow[]; total: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
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
        const batchNodes = db.prepare(
          `SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes WHERE id IN (${placeholders})`,
        ).all(...batch) as unknown as DbNodeRow[];
        allNodes.push(...batchNodes);
      }
      return { nodes: allNodes, total };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readSymbolASTFromDb failed', e);
    return null;
  }
}

export function readEdgesFromDb(dbPath: string, nodeId: string, scope: 'file' | 'symbol', cursor: number, limit: number): { edges: DbEdgeRow[]; total: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (scope === 'symbol') {
        const total = (db.prepare('SELECT COUNT(*) as cnt FROM edges WHERE source = ? OR target = ?').get(nodeId, nodeId) as { cnt: number }).cnt;
        const edges = db.prepare(
          'SELECT id, source, target, kind, line FROM edges WHERE source = ? OR target = ? LIMIT ? OFFSET ?',
        ).all(nodeId, nodeId, limit, cursor) as unknown as DbEdgeRow[];
        return { edges, total };
      }
      const filePathResult = db.prepare('SELECT file_path FROM nodes WHERE id = ?').get(nodeId) as { file_path: string } | undefined;
      if (!filePathResult) return { edges: [], total: 0 };
      const filePath = filePathResult.file_path;
      const nodeIds = db.prepare('SELECT id FROM nodes WHERE file_path = ?').all(filePath) as { id: string }[];
      const idList = nodeIds.map(n => n.id);
      if (idList.length === 0) return { edges: [], total: 0 };
      const batchSize = SQLITE.MAX_IN_PARAMS;
      let total = 0;
      const allEdges: DbEdgeRow[] = [];
      for (let i = 0; i < idList.length; i += batchSize) {
        const batch = idList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const batchTotal = (db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`).get(...batch, ...batch) as { cnt: number }).cnt;
        total += batchTotal;
        const batchEdges = db.prepare(
          `SELECT id, source, target, kind, line FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders}) LIMIT ? OFFSET ?`,
        ).all(...batch, ...batch, limit, cursor) as unknown as DbEdgeRow[];
        allEdges.push(...batchEdges);
      }
      return { edges: allEdges, total };
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readEdgesFromDb failed', e);
    return null;
  }
}

export function readEdgesForNodesFromDb(dbPath: string, nodeIds: string[]): DbEdgeRow[] {
  if (!existsSync(dbPath) || nodeIds.length === 0) return [];
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const allEdges: DbEdgeRow[] = [];
      const batchSize = SQLITE.MAX_IN_PARAMS;
      for (let i = 0; i < nodeIds.length; i += batchSize) {
        const batch = nodeIds.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const edges = db.prepare(
          `SELECT id, source, target, kind, line FROM edges WHERE (source IN (${placeholders}) AND target IN (${placeholders}))`,
        ).all(...batch, ...batch) as unknown as DbEdgeRow[];
        allEdges.push(...edges);
      }
      return allEdges;
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('readEdgesForNodesFromDb failed', e);
    return [];
  }
}

export class CodeGraphAdapter implements IDataAdapter {
  readonly source: DataSourceType = 'codegraph';

  async fetchData(repoId: string, invoke: UpstreamInvoker): Promise<AdapterResult> {
    // Primary: direct SQLite read of the upstream index (single O(N+E) query).
    const dbRows = readGraphFromDb(resolveDbPath(repoId));
    if (dbRows && dbRows.nodes.length > 0) {
      return this.toAdapterResult(dbRows.nodes, dbRows.edges);
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

    const fileNodeIds = new Map<string, string>();
    for (const n of dbNodes) {
      if (n.kind === 'file' || n.kind === 'module') {
        fileNodeIds.set(n.file_path, n.id);
      }
    }

    const nodes: GraphNode[] = dbNodes
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
        },
        ...(parentId ? { parentId: NodeId(parentId) } : {}),
        layer: inferLayerFromPath(n.file_path),
      };
    });

    const validNodeIds = new Set<string>(nodes.map((n) => n.id as string));
    const filteredEdges = dbEdges.filter((e) =>
      validNodeIds.has(e.source) && validNodeIds.has(e.target) &&
      e.source !== e.target &&
      !FILTERED_EDGE_KINDS.has(e.kind),
    );

    const importCountBySource = new Map<string, number>();
    const edges: GraphEdge[] = [];
    for (const e of filteredEdges) {
      const mappedType = mapEdgeKind(e.kind);
      if (mappedType === 'import') {
        const count = importCountBySource.get(e.source) ?? 0;
        if (count >= MAX_IMPORTS_PER_SOURCE) continue;
        importCountBySource.set(e.source, count + 1);
      }
      edges.push({
        id: EdgeId(String(e.id)),
        source: NodeId(e.source),
        target: NodeId(e.target),
        type: mappedType,
        properties: e.line !== null && e.line !== undefined ? { line: e.line } : {},
      });
    }

    return { nodes, edges, source: this.source, timestamp: Date.now() };
  }
}
