// Unit tests for the incremental update layer (P2-21).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildIncrementalUpdate } from '../../src/host/incrementalUpdate.ts';
import { closeAllDbConnections } from '../../src/adapters/CodeGraphAdapter.ts';
import { mapRowsToGraphNodes, mapRowsToGraphEdges } from '../../src/adapters/CodeGraphAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
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
 * Build the "current" graph the way the bootstrap path would.
 *
 * This has to run through the **same pipeline as production** — `mapRowsToGraphNodes` /
 * `mapRowsToGraphEdges` followed by `GraphDataMerger.merge` — because the merge step is what stamps
 * `properties.__source`. A hand-written node would differ from the index's node for reasons that have
 * nothing to do with the change under test, and a fixture that skipped the merger would hide exactly
 * the drift the parity cases below exist to catch.
 */
/**
 * The repoId every fixture graph is stamped with. It has to track `tempDir` (the workspace the tests
 * pass as `workspacePath`) because the update layer refuses to diff a graph against a workspace it
 * does not belong to — that guard is the regression lock for the cross-workspace corruption fixed in
 * this round, so a fixture whose repoId drifted from `tempDir` would silently stop exercising the
 * incremental path at all.
 */
let activeRepoId = 'ws';

function graphFrom(nodes: NodeRow[], edges: EdgeRow[] = [], repoId = activeRepoId, timestamp = 1): GraphData {
  const graphNodes = mapRowsToGraphNodes(nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    file_path: n.filePath,
    start_line: n.line,
    signature: null,
    docstring: null,
    is_exported: IS_EXPORTED,
  })));
  const validIds = new Set<string>(graphNodes.map((n) => n.id as string));
  const graphEdges = mapRowsToGraphEdges(edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    line: e.line,
  })), validIds);
  const merged = new GraphDataMerger().merge(
    [{ nodes: graphNodes, edges: graphEdges, source: 'codegraph', timestamp }],
    RepoId(repoId),
  );
  return { ...merged, metadata: { ...merged.metadata, timestamp } };
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
    activeRepoId = tempDir;
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
    const current = graphFrom([A1], [], tempDir, 111);
    const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current, timestamp: 999 });
    expect(result!.next.metadata.timestamp).toBe(999);
    expect(result!.next.metadata.nodeCount).toBe(2);
    expect(result!.next.metadata.edgeCount).toBe(0);
    expect(result!.next.metadata.totalNodeCount).toBe(2);
    expect(result!.next.metadata.totalEdgeCount).toBe(0);
    expect(result!.next.metadata.repoId).toBe(tempDir);
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

  // The cases below are parity guards: the incremental path must produce nodes/edges that are
  // byte-for-byte what the full fetch would have produced. Every one of them passed against a
  // hand-built `current` and failed against the real index before the shared row→graph conversion
  // was extracted, so they exist to keep the two paths from drifting apart again.
  describe('parity with the full fetch path', () => {
    const FILE_A: NodeRow = { id: 'f_a', kind: 'file', name: 'a.ts', filePath: 'src/a.ts', line: 1 };

    it('stamps properties.__source so an unchanged file is not reported as modified', () => {
      createWorkspace(tempDir, [A1]);
      const current = graphFrom([A1]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result).not.toBeNull();
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    it('carries properties.__source on nodes the incremental read introduces', () => {
      createWorkspace(tempDir, [A1]);
      const current = graphFrom([]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta.addedNodes.map((n) => n.id)).toEqual(['a1']);
      expect(result!.delta.addedNodes[0]!.properties.__source).toBe('codegraph');
    });

    // Same marker on edges: `keptImportIds` is rebuilt from `properties.__source`, so an edge published
    // without it stops counting towards the import cap on the following tick.
    it('carries properties.__source on edges the incremental read introduces', () => {
      createWorkspace(tempDir, [A1, B1], [{ id: 1, source: 'a1', target: 'b1', kind: 'calls', line: 3 }]);
      const current = graphFrom([A1, B1]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta.addedEdges.map((e) => e.id)).toEqual(['1']);
      expect(result!.delta.addedEdges[0]!.properties.__source).toBe('codegraph');
    });

    // A targeted read returns nodes from several files at once, so the parent must come from each
    // node's own file_path. A single "parent for the whole batch" would hang every node under whichever
    // file row happened to be first, which the full path never does.
    it('resolves parentId per file_path rather than assigning one parent to the whole batch', () => {
      const FILE_B: NodeRow = { id: 'f_b', kind: 'file', name: 'b.ts', filePath: 'src/b.ts', line: 1 };
      createWorkspace(tempDir, [FILE_A, FILE_B, A1, B1]);
      const current = graphFrom([FILE_A, FILE_B, A1, B1]);
      expect(current.nodes.find((n) => n.id === 'a1')?.parentId).toBe('f_a');
      expect(current.nodes.find((n) => n.id === 'b1')?.parentId).toBe('f_b');

      const result = buildIncrementalUpdate({
        workspacePath: tempDir, changedFiles: ['src/a.ts', 'src/b.ts'], current,
      });
      expect(result!.delta).toEqual(EMPTY_DELTA);
      expect(current.nodes.find((n) => n.id === 'f_a')?.parentId).toBeUndefined();
      expect(current.nodes.find((n) => n.id === 'f_b')?.parentId).toBeUndefined();
    });

    it('caps import edges per source exactly like the full fetch', () => {
      const deps: NodeRow[] = Array.from({ length: 25 }, (_, i) => ({
        id: `t${i + 1}`, kind: 'function', name: `dep${i + 1}`, filePath: `src/dep${i + 1}.ts`, line: 1,
      }));
      const importEdges: EdgeRow[] = deps.map((d, i) => ({
        id: i + 1, source: 'a1', target: d.id, kind: 'imports', line: 1,
      }));
      createWorkspace(tempDir, [A1, ...deps], importEdges);
      const current = graphFrom([A1, ...deps], importEdges);
      // The full path already truncated this source to the cap, so a re-read must agree with it.
      expect(current.edges.filter((e) => e.type === 'import')).toHaveLength(20);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    it('drops self-loop edges exactly like the full fetch', () => {
      createWorkspace(tempDir, [A1, A2], [
        { id: 1, source: 'a1', target: 'a1', kind: 'call', line: 1 },
        { id: 2, source: 'a1', target: 'a2', kind: 'call', line: 3 },
      ]);
      const current = graphFrom([A1, A2], [{ id: 2, source: 'a1', target: 'a2', kind: 'call', line: 3 }]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    it('drops FILTERED_EDGE_KINDS exactly like the full fetch', () => {
      createWorkspace(tempDir, [A1, A2], [
        { id: 1, source: 'a1', target: 'a2', kind: 'uses_var', line: 1 },
        { id: 2, source: 'a1', target: 'a2', kind: 'call', line: 3 },
      ]);
      const current = graphFrom([A1, A2], [{ id: 2, source: 'a1', target: 'a2', kind: 'call', line: 3 }]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    // A targeted read returns edges whose *far* endpoint sits in an untouched file. Treating only the
    // touched nodes as the valid universe would report that still-live edge as removed.
    it('keeps an edge that crosses into an untouched file', () => {
      createWorkspace(tempDir, [A1, B1], [{ id: 1, source: 'a1', target: 'b1', kind: 'call', line: 3 }]);
      const current = graphFrom([A1, B1], [{ id: 1, source: 'a1', target: 'b1', kind: 'call', line: 3 }]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result!.delta.removedEdges).toEqual([]);
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    // The full path drops edges whose endpoint is absent from the node set. Without the same filter
    // the delta would fail `canApplyGraphDelta` and force a whole-graph refetch on every tick.
    it('drops an edge whose endpoint is missing from the index instead of falling back to a full fetch', () => {
      createWorkspace(tempDir, [A1], [{ id: 5, source: 'a1', target: 'ghost', kind: 'call', line: 1 }]);
      const current = graphFrom([A1]);
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result).not.toBeNull();
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    // The import cap cannot be counted on the targeted read's own slice. Changing `src/b.ts` pulls back
    // the single edge `a1 -> b1` (its target is in the changed file), so a local counter sees one import
    // for `a1` and admits it — but `a1` already has 20 imports in the graph, all with smaller ids, so the
    // full path drops this one. Counting locally re-adds it on every tick.
    it('ranks a cross-file import edge against the imports the current graph already keeps', () => {
      const deps: NodeRow[] = Array.from({ length: 25 }, (_, i) => ({
        id: `t${i + 1}`, kind: 'function', name: `dep${i + 1}`, filePath: `src/dep${i + 1}.ts`, line: 1,
      }));
      const importEdges: EdgeRow[] = deps.map((d, i) => ({
        id: i + 1, source: 'a1', target: d.id, kind: 'imports', line: 1,
      }));
      // A late-id import from the same source; the full path drops it (a1 is already at the cap).
      const crossFile: EdgeRow = { id: 30, source: 'a1', target: 'b1', kind: 'imports', line: 1 };
      createWorkspace(tempDir, [A1, ...deps, B1], [...importEdges, crossFile]);

      const current = graphFrom([A1, ...deps, B1], [...importEdges, crossFile]);
      expect(current.edges.filter((e) => e.type === 'import')).toHaveLength(20);
      expect(current.edges.some((e) => e.id === '30')).toBe(false);

      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/b.ts'], current });
      expect(result).not.toBeNull();
      expect(result!.delta.addedEdges).toEqual([]);
      expect(result!.delta).toEqual(EMPTY_DELTA);
    });

    // `keptImportIds` is rebuilt from the held graph on every tick, so the import marker has to survive
    // the fold. If the incremental path published edges without `properties.__source`, the second tick
    // would stop recognising the kept imports and start admitting the capped-out ones again.
    it('keeps the import cap stable across consecutive ticks', () => {
      const deps: NodeRow[] = Array.from({ length: 25 }, (_, i) => ({
        id: `t${i + 1}`, kind: 'function', name: `dep${i + 1}`, filePath: `src/dep${i + 1}.ts`, line: 1,
      }));
      const importEdges: EdgeRow[] = deps.map((d, i) => ({
        id: i + 1, source: 'a1', target: d.id, kind: 'imports', line: 1,
      }));
      const crossFile: EdgeRow = { id: 30, source: 'a1', target: 'b1', kind: 'imports', line: 1 };
      createWorkspace(tempDir, [A1, ...deps, B1], [...importEdges, crossFile]);

      const first = buildIncrementalUpdate({
        workspacePath: tempDir, changedFiles: ['src/b.ts'], current: graphFrom([A1, ...deps, B1], [...importEdges, crossFile]),
      });
      expect(first!.delta).toEqual(EMPTY_DELTA);
      expect(first!.next.edges.filter((e) => e.type === 'import')).toHaveLength(20);

      const second = buildIncrementalUpdate({
        workspacePath: tempDir, changedFiles: ['src/b.ts'], current: first!.next,
      });
      expect(second!.delta).toEqual(EMPTY_DELTA);
      expect(second!.next.edges.filter((e) => e.type === 'import')).toHaveLength(20);
    });
  });

  // ── P0：跨工作区污染 ──────────────────────────────────────────────────────
  // host 只有一个 `lastGraphData` 槽，而客户端可以在同一次会话里浏览多个工作区。当浏览器先给
  // "正在建索引"的工作区跑了后台建图，那个（可能是空的）图会占住槽位；此后 watcher 为另一个仓库
  // 产出的增量就会拿"别人的图"当 `current` 来 diff。实测后果：改动文件里的节点在 `current` 里找不到
  // 对应项，全部被判为 added，折叠后的 `next` 还带着旧工作区的 repoId 写回 host 权威图 —— 4790 节点的
  // 全量图被替换成 2 个节点。这里锁住"不同源直接拒绝、让调用方落回全量拉取"的行为。
  describe('cross-workspace guard', () => {
    it('refuses to diff a graph that belongs to another workspace', () => {
      createWorkspace(tempDir, [A1, A2]);
      const current = graphFrom([A1], [], 'D:\\Projects\\TraeProjects\\Studying');
      expect(buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current })).toBeNull();
    });

    it('treats a path with different separators as the same workspace', () => {
      createWorkspace(tempDir, [A1, A2]);
      // The watcher reports a native Windows path while the client may hold the same root with
      // forward slashes; both name the same directory and must not be mistaken for two workspaces.
      const current = graphFrom([A1], [], tempDir.replace(/\\/g, '/'));
      const result = buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current });
      expect(result).not.toBeNull();
      expect(result!.delta.addedNodes.map((n) => n.id)).toEqual(['a2']);
    });

    it('refuses a graph with no workspace identity rather than guessing', () => {
      createWorkspace(tempDir, [A1, A2]);
      const graph = graphFrom([A1]);
      // `RepoId` refuses to build an empty id, so an identity-less graph can only be fabricated —
      // which is exactly what a partially-initialised host slot looks like.
      const current: GraphData = { ...graph, metadata: { ...graph.metadata, repoId: '' as RepoId } };
      expect(buildIncrementalUpdate({ workspacePath: tempDir, changedFiles: ['src/a.ts'], current })).toBeNull();
    });
  });
});
