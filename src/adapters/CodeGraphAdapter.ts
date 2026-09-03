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
import { join } from 'node:path';
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import { scoped } from '../shared/Logger.ts';

const log = scoped('codegraph-adapter');

const require = createRequire(import.meta.url);

export type UpstreamInvoker = (tool: string, args: Record<string, unknown>) => Promise<unknown | null>;

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
  contains: 'dependency',
  dependency: 'dependency',
  depends: 'dependency',
};

export function mapNodeKind(kind: string): GraphNode['type'] {
  return NODE_KIND_MAP[kind] ?? 'module';
}

export function mapEdgeKind(kind: string): GraphEdge['type'] {
  return EDGE_KIND_MAP[kind] ?? 'dependency';
}

/** Locate the .codegraph/codegraph.db for a workspace path. */
export function resolveDbPath(workspacePath: string): string {
  const root = workspacePath && workspacePath !== '.' ? workspacePath : process.cwd();
  return join(root, '.codegraph', 'codegraph.db');
}

/** Read the whole graph from a codegraph.db. Returns null when unreadable. */
export function readGraphFromDb(dbPath: string): { nodes: DbNodeRow[]; edges: DbEdgeRow[] } | null {
  if (!existsSync(dbPath)) return null;
  try {
    // node:sqlite is available on Node >= 22.5 (project engines: >=22.19 || >=24).
    // createRequire keeps the built-in out of the ESM graph while staying sync.
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

export class CodeGraphAdapter {
  private readonly source: DataSourceType = 'codegraph';

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
    const nodes: GraphNode[] = rawFiles.map((f, i) => ({
      id: NodeId(`file:${f.path}`),
      label: f.path.split('/').pop() ?? f.path,
      type: 'module',
      filePath: f.path,
      lineNumber: 1,
      properties: { kind: 'file', language: f.language ?? null, index: i },
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
    const nodeIds = new Set(dbNodes.map((n) => n.id));

    const fileNodeIds = new Map<string, string>();
    for (const n of dbNodes) {
      if (n.kind === 'file' || n.kind === 'module') {
        fileNodeIds.set(n.file_path, n.id);
      }
    }

    const nodes: GraphNode[] = dbNodes.map((n) => {
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
      };
    });

    const edges: GraphEdge[] = dbEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        id: EdgeId(String(e.id)),
        source: NodeId(e.source),
        target: NodeId(e.target),
        type: mapEdgeKind(e.kind),
        properties: e.line != null ? { line: e.line } : {},
      }));

    return { nodes, edges, source: this.source, timestamp: Date.now() };
  }
}
