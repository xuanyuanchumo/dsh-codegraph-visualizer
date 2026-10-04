// Unit tests for the incremental update layer (P2-21).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildIncrementalUpdate } from '../../src/host/incrementalUpdate.ts';
import { closeAllDbConnections } from '../../src/adapters/CodeGraphAdapter.ts';
import { mapDbNodesToGraphNodes, mapDbEdgesToGraphEdges } from '../../src/host/DbMapper.ts';
import { RepoId } from '../../src/types/index.ts';
import type { GraphData } from '../../src/types/index.ts';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  line: number;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  line: number;
}

const IS_EXPORTED = 1;

/**
 * Build a workspace whose index holds exactly the rows given. The workspace root is the temp dir so
 * `resolveDbPath` finds `.codegraph/codegraph.db` under it.
 */
function createWorkspace(dir: string, nodes: NodeRow[], edges: EdgeRow[] = []): string {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const codegraphDir = join(dir, '.codegraph');
  mkdirSync(codegraphDir, { recursive: true });
  const db = new DatabaseSync(join(codegraphDir, 'codegraph.db'));
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
  `);
  const insertNode = db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)');
  for (const n of nodes) insertNode.run(n.id, n.kind, n.name, n.filePath, n.line, IS_EXPORTED);
  const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?)');
  for (const e of edges) insertEdge.run(e.id, e.source, e.target, e.kind, e.line);
  db.close();
  return dir;
}

/**
 * Build the "current" graph the way the bootstrap path would. Running the fixtures through the same
 * mappers matters: they add `layer` and `properties.exported`, and a hand-written node would then
 * differ from the index's node for reasons that have nothing to do with the change under test.
 */
function graphFrom(nodes: NodeRow[], edges: EdgeRow[] = [], repoId = 'ws', timestamp = 1): GraphData {
  const graphNodes = mapDbNodesToGraphNodes(nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    file_path: n.filePath,
    start_line: n.line,
    signature: null,
    docstring: null,
    is_exported: IS_EXPORTED,
  })));
  const graphEdges = mapDbEdgesToGraphEdges(edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    line: e.line,
  })));
  return {
    nodes: graphNodes,
    edges: graphEdges,
    metadata: {
      repoId: RepoId(repoId),
      timestamp,
      nodeCount: graphNodes.length,
      edgeCount: graphEdges.length,
    },
  };
}

const A1: NodeRow = { id: 'a1', kind: 'function', name: 'alpha', filePath: 'src/a.ts', line: 1 };
const A2: NodeRow = { id: 'a2', kind: 'class', name: 'Alpha', filePath: 'src/a.ts', line: 20 };
const B1: NodeRow = { id: 'b1', kind: 'function', name: 'beta', filePath: 'src/b.ts', line: 5 };

const EMPTY_DELTA = {
  addedNodes: [], removedNodes: [], modifiedNodes: [],
  addedEdges: [], removedEdges: [], modifiedEdges: [],
};

describe('buildIncrementalUpdate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-incr-'));
  });

  afterEach(() => {
    closeAllDbConnections();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no file changed', () => {
    createWorkspace(tempDir, [A1]);
    const current = graphFrom([A1]);
    expect(buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: [], current })).toBeNull();
  });

  it('returns null when too many files changed to make a targeted read worthwhile', () => {
    createWorkspace(tempDir, [A1]);
    const current = graphFrom([A1]);
    const changedFiles = Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`);
    expect(buildIncrementalUpdate({ workspacePath: tempDir, changedFiles, current })).toBeNull();
  });

  it('returns null when the index cannot be read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'cg-incr-none-'));
    try {
      const current = graphFrom([A1]);
      expect(buildIncrementalUpdate({ workspacePath: empty, changedFiles: ['src/a.ts'], current })).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('reports an added symbol as an added node', () => {
    createWorkspace(tempDir, [A1, A2]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result).not.toBeNull();
    expect(result!.delta.addedNodes.map((n) => n.id)).toEqual(['a2']);
    expect(result!.delta.removedNodes).toEqual([]);
    expect(result!.delta.modifiedNodes).toEqual([]);
    expect(result!.next.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2']);
  });

  it('reports a symbol that left the index as a removed node', () => {
    createWorkspace(tempDir, [A1]);
    const current = graphFrom([A1, A2]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result).not.toBeNull();
    expect(result!.delta.removedNodes.map((n) => n.id)).toEqual(['a2']);
    expect(result!.next.nodes.map((n) => n.id)).toEqual(['a1']);
  });

  it('reports a changed signature line as a modified node', () => {
    createWorkspace(tempDir, [{ ...A1, line: 42, name: 'alphaRenamed' }]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result!.delta.modifiedNodes.map((n) => n.id)).toEqual(['a1']);
    expect(result!.next.nodes[0]!.label).toBe('alphaRenamed');
    expect(result!.next.nodes[0]!.lineNumber).toBe(42);
  });

  // The diff is scoped to the changed files, so a node in an untouched file can never be reported
  // as removed just because the targeted read did not return it.
  it('never reports a node from an untouched file as removed', () => {
    createWorkspace(tempDir, [A1]);
    const current = graphFrom([A1, B1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result!.delta.removedNodes).toEqual([]);
    expect(result!.next.nodes.map((n) => n.id).sort()).toEqual(['a1', 'b1']);
  });

  it('yields an empty delta when the changed file produced no structural change', () => {
    createWorkspace(tempDir, [A1]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result).not.toBeNull();
    expect(result!.delta).toEqual(EMPTY_DELTA);
  });

  it('carries added edges and drops edges the index no longer reports', () => {
    createWorkspace(tempDir, [A1, A2], [{ id: 1, source: 'a1', target: 'a2', kind: 'call', line: 3 }]);
    const current = graphFrom([A1, A2], [{ id: 9, source: 'a1', target: 'a2', kind: 'dependency', line: 1 }]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result!.delta.addedEdges.map((e) => e.id)).toEqual(['1']);
    expect(result!.delta.removedEdges.map((e) => e.id)).toEqual(['9']);
    expect(result!.next.edges.map((e) => e.id)).toEqual(['1']);
    expect(result!.next.edges[0]!.type).toBe('call');
  });

  it('accepts a backslash-separated watcher path', () => {
    createWorkspace(tempDir, [A1, A2]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src\\a.ts'], current });
    expect(result!.delta.addedNodes.map((n) => n.id)).toEqual(['a2']);
  });

  it('targets every file below a changed directory', () => {
    createWorkspace(tempDir, [A1, B1]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src'], current });
    expect(result!.delta.addedNodes.map((n) => n.id)).toEqual(['b1']);
  });

  it('recomputes the revision metadata from the folded arrays', () => {
    createWorkspace(tempDir, [A1, A2]);
    const current = graphFrom([A1], [], 'ws', 111);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current, timestamp: 999 });
    expect(result!.next.metadata.timestamp).toBe(999);
    expect(result!.next.metadata.nodeCount).toBe(2);
    expect(result!.next.metadata.edgeCount).toBe(0);
    expect(result!.next.metadata.totalNodeCount).toBe(2);
    expect(result!.next.metadata.totalEdgeCount).toBe(0);
    expect(result!.next.metadata.repoId).toBe('ws');
  });

  it('reports how many index rows the targeted read pulled back', () => {
    createWorkspace(tempDir, [A1, A2], [{ id: 1, source: 'a1', target: 'a2', kind: 'call', line: 3 }]);
    const current = graphFrom([A1]);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(result!.scanned).toEqual({ nodes: 2, edges: 1 });
  });

  it('leaves the caller-supplied graph untouched', () => {
    createWorkspace(tempDir, [A1, A2]);
    const current = graphFrom([A1]);
    buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
    expect(current.nodes).toHaveLength(1);
  });
});
