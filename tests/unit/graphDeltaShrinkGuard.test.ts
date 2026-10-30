// P0-3（graphify 借鉴）：图写入防缩水守卫。
//
// 两个部分：
//   A. 纯函数 `canApplyGraphDelta` 的规模维度 —— 默认关闭（既有 20+ 用例的行为一字不变），
//      显式开启后按「delta 应用后的保留比例」判定；阈值边界、规模下限、旧的悬空/篡改判定都各有用例。
//   B. 两个**真实调用点**的接线（client store 与 host incrementalUpdate）—— 本项目「参数加了没人传」
//      是复发缺陷，所以这里不靠默认值，而是断言「一次本来合法、只是缩水过大的 delta 会被拒绝」。
//      删掉任一处传参，这两组用例就会变红。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  canApplyGraphDelta,
  applyGraphDelta,
  GRAPH_DELTA_SHRINK,
} from '../../src/shared/graphDelta.ts';
import type { GraphDelta } from '../../src/types/index.ts';
import type { GraphSkeleton } from '../../src/shared/graphDelta.ts';
import { RepoId } from '../../src/types/index.ts';
import { makeEdge, makeNode } from '../helpers.ts';
import { useGraphStore, disposeStore } from '../../src/client/store/graphStore.ts';
import { buildIncrementalUpdate } from '../../src/host/incrementalUpdate.ts';
import {
  closeAllDbConnections,
  mapRowsToGraphNodes,
  mapRowsToGraphEdges,
} from '../../src/adapters/CodeGraphAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import type { GraphData } from '../../src/types/index.ts';

function emptyDelta(overrides: Partial<GraphDelta> = {}): GraphDelta {
  return {
    addedNodes: [], removedNodes: [], modifiedNodes: [],
    addedEdges: [], removedEdges: [], modifiedEdges: [],
    ...overrides,
  };
}

/** `edgeCount` edges are all `n1 -> n2`, so any skeleton with edges needs at least 2 nodes. */
function skeleton(nodeCount: number, edgeCount = 0): GraphSkeleton {
  const nodes = Array.from({ length: nodeCount }, (_, i) => makeNode(`n${i + 1}`, `N${i + 1}`, 'function', 'a.ts', i + 1));
  const edges = Array.from({ length: edgeCount }, (_, i) => makeEdge(`e${i + 1}`, 'n1', 'n2', 'call'));
  return { nodes, edges };
}

function removeNodes(current: GraphSkeleton, count: number): GraphDelta {
  return emptyDelta({ removedNodes: current.nodes.slice(0, count) });
}

function removeEdges(current: GraphSkeleton, count: number): GraphDelta {
  return emptyDelta({ removedEdges: current.edges.slice(0, count) });
}

const RATIO = GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO;

describe('canApplyGraphDelta — shrink guard (pure function)', () => {
  it('is OFF when the caller passes no options: a 90% removal is still accepted (backward compatible)', () => {
    const current = skeleton(100);
    expect(canApplyGraphDelta(current, removeNodes(current, 90))).toBe(true);
  });

  it('treats an explicit minRetainRatio of 0 as off, identical to omitting it', () => {
    const current = skeleton(100);
    const delta = removeNodes(current, 90);
    expect(canApplyGraphDelta(current, delta, { minRetainRatio: 0 })).toBe(canApplyGraphDelta(current, delta));
    expect(canApplyGraphDelta(current, delta, {})).toBe(true);
  });

  it('rejects a delta that would retain only 20% of the nodes once the guard is enabled', () => {
    const current = skeleton(100);
    expect(canApplyGraphDelta(current, removeNodes(current, 80), { minRetainRatio: RATIO })).toBe(false);
  });

  it('accepts a normal small deletion (5% of the nodes)', () => {
    const current = skeleton(100);
    expect(canApplyGraphDelta(current, removeNodes(current, 5), { minRetainRatio: RATIO })).toBe(true);
  });

  // 阈值语义被钉死在「严格小于才拒绝」：恰好等于阈值时通过。`<` 与 `<=` 都"看起来合理"，
  // 所以必须有一条用例把这一侧钉死（否则改一个字符也没人发现）。
  it('accepts a delta that retains EXACTLY the threshold ratio', () => {
    const current = skeleton(100);
    expect(canApplyGraphDelta(current, removeNodes(current, 50), { minRetainRatio: 0.5 })).toBe(true);
  });

  it('rejects a delta one node below the threshold ratio', () => {
    const current = skeleton(100);
    expect(canApplyGraphDelta(current, removeNodes(current, 51), { minRetainRatio: 0.5 })).toBe(false);
  });

  it('applies the same retention rule to the edge dimension', () => {
    const current = skeleton(100, 100);
    expect(canApplyGraphDelta(current, removeEdges(current, 60), { minRetainRatio: RATIO })).toBe(false);
    expect(canApplyGraphDelta(current, removeEdges(current, 5), { minRetainRatio: RATIO })).toBe(true);
  });

  // 规模下限：比例在极小图上没有意义（3 个节点删 2 个就是 0.33）。既有测试里大量 1~3 节点的
  // fixture 正是靠这条不被误伤 —— 阈值只在图还有一定规模时生效。
  it('does not judge the ratio below the node size floor', () => {
    const current = skeleton(10);
    expect(current.nodes.length).toBeLessThan(GRAPH_DELTA_SHRINK.MIN_GUARDED_NODES);
    expect(canApplyGraphDelta(current, removeNodes(current, 9), { minRetainRatio: RATIO })).toBe(true);
  });

  it('does not judge the edge ratio below the edge size floor', () => {
    const current = skeleton(100, 10);
    expect(current.edges.length).toBeLessThan(GRAPH_DELTA_SHRINK.MIN_GUARDED_EDGES);
    expect(canApplyGraphDelta(current, removeEdges(current, 9), { minRetainRatio: RATIO })).toBe(true);
  });

  it('never refuses because the graph grew or was merely modified', () => {
    const current = skeleton(100);
    const grown = emptyDelta({
      addedNodes: [makeNode('extra', 'X', 'function', 'x.ts', 1)],
      modifiedNodes: [makeNode('n1', 'N1 renamed', 'function', 'a.ts', 2)],
    });
    expect(canApplyGraphDelta(current, grown, { minRetainRatio: RATIO })).toBe(true);
  });

  it('keeps the pre-existing structural verdicts intact when the guard is enabled', () => {
    const current = skeleton(100);
    // 不存在的节点：旧判定（描述了一个我们没有的版本）优先于规模判定
    const ghost = emptyDelta({ removedNodes: [makeNode('ghost', 'G', 'function', 'g.ts', 1)] });
    expect(canApplyGraphDelta(current, ghost, { minRetainRatio: RATIO })).toBe(false);
    // 悬空新边：同样先被旧判定拦下
    const dangling = emptyDelta({ addedEdges: [makeEdge('e-x', 'n1', 'nowhere', 'call')] });
    expect(canApplyGraphDelta(current, dangling, { minRetainRatio: RATIO })).toBe(false);
  });

  it('treats an empty current graph as fully retained', () => {
    expect(canApplyGraphDelta({ nodes: [], edges: [] }, emptyDelta(), { minRetainRatio: RATIO })).toBe(true);
  });

  it('is a pure decision: the same inputs always give the same verdict', () => {
    const current = skeleton(40);
    const delta = removeNodes(current, 30);
    expect(canApplyGraphDelta(current, delta, { minRetainRatio: RATIO }))
      .toBe(canApplyGraphDelta(current, delta, { minRetainRatio: RATIO }));
    // 拒绝的 delta 不能被"部分应用"：判定与折叠是两个函数，判定为 false 时调用方不会调用它
    expect(applyGraphDelta(current, delta).nodes).toHaveLength(10);
  });
});

// ── B. wiring: the client store must actually PASS the threshold ─────────────

function clientGraph(nodeCount: number): { nodes: ReturnType<typeof makeNode>[]; edges: ReturnType<typeof makeEdge>[] } {
  const nodes = Array.from({ length: nodeCount }, (_, i) => makeNode(`n${i + 1}`, `N${i + 1}`, 'function', 'a.ts', i + 1));
  // 边只挂在不会从图里删除的节点上，避免"删除节点顺带悬空边"干扰本组断言
  const edges = Array.from({ length: 5 }, (_, i) => makeEdge(`e${i + 1}`, 'n1', 'n2', 'call'));
  return { nodes, edges };
}

describe('wiring — client store applyGraphDelta', () => {
  beforeEach(() => {
    disposeStore();
    useGraphStore.getState().clearGraph();
  });

  afterEach(() => {
    disposeStore();
  });

  it('has a non-zero shared threshold (a zero constant would make the wiring untestable)', () => {
    expect(GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO).toBeGreaterThan(0);
  });

  it('refuses a 75% node loss, which the old checks alone would have accepted', () => {
    const { nodes, edges } = clientGraph(40);
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');

    const removed = nodes.slice(10);
    const ok = useGraphStore.getState().applyGraphDelta(emptyDelta({ removedNodes: removed }));

    expect(ok).toBe(false);
    expect(useGraphStore.getState().rawNodes).toHaveLength(40);
  });

  it('still applies a normal small delta through the same call site', () => {
    const { nodes, edges } = clientGraph(40);
    useGraphStore.getState().setClusterDepth(0);
    useGraphStore.getState().setGraphData(nodes, edges, 'repo-1');

    const ok = useGraphStore.getState().applyGraphDelta(emptyDelta({ removedNodes: nodes.slice(38) }));

    expect(ok).toBe(true);
    expect(useGraphStore.getState().rawNodes).toHaveLength(38);
  });
});

// ── B. wiring: the host incremental update must actually PASS the threshold ──

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  line: number;
}

const require = createRequire(import.meta.url);

function writeIndex(dir: string, nodes: NodeRow[]): void {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const codegraphDir = join(dir, '.codegraph');
  mkdirSync(codegraphDir, { recursive: true });
  const db = new DatabaseSync(join(codegraphDir, 'codegraph.db'));
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, metadata TEXT, line INTEGER);
  `);
  const insertNode = db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1)');
  for (const n of nodes) insertNode.run(n.id, n.kind, n.name, n.filePath, n.line);
  db.close();
}

/** Drop the pooled SQLite connections, then replace the index with exactly `nodes`. */
function replaceIndex(dir: string, nodes: NodeRow[]): void {
  closeAllDbConnections();
  rmSync(join(dir, '.codegraph'), { recursive: true, force: true });
  writeIndex(dir, nodes);
}

function graphFrom(rows: NodeRow[], repoId: string): GraphData {
  const graphNodes = mapRowsToGraphNodes(rows.map((n) => ({
    id: n.id, kind: n.kind, name: n.name, file_path: n.filePath,
    start_line: n.line, signature: null, docstring: null, is_exported: 1,
  })));
  const validIds = new Set<string>(graphNodes.map((n) => n.id as string));
  const graphEdges = mapRowsToGraphEdges([], validIds);
  return new GraphDataMerger().merge(
    [{ nodes: graphNodes, edges: graphEdges, source: 'codegraph', timestamp: 1 }],
    RepoId(repoId),
  );
}

function repoRows(count: number): NodeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i + 1}`, kind: 'function', name: `alpha${i + 1}`, filePath: 'src/a.ts', line: i + 1,
  }));
}

describe('wiring — host buildIncrementalUpdate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-shrink-'));
  });

  afterEach(() => {
    closeAllDbConnections();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null (falls back to a full fetch) when the targeted read would drop 80% of the nodes', () => {
    const all = repoRows(30);
    writeIndex(tempDir, all);
    const current = graphFrom(all, tempDir);
    expect(current.nodes).toHaveLength(30);

    // 索引现在只报回 6 个符号 —— 对同一文件来说，这只能是索引不完整，而不是一次正常改动
    replaceIndex(tempDir, all.slice(0, 6));

    const result = buildIncrementalUpdate({
      workspacePath: tempDir, changedFiles: ['src/a.ts'], current,
    });
    expect(result).toBeNull();
  });

  it('still produces a delta for a normal one-symbol deletion through the same call site', () => {
    const all = repoRows(30);
    writeIndex(tempDir, all);
    const current = graphFrom(all, tempDir);

    replaceIndex(tempDir, all.slice(0, 29));

    const result = buildIncrementalUpdate({
      workspacePath: tempDir, changedFiles: ['src/a.ts'], current,
    });
    expect(result).not.toBeNull();
    expect(result!.delta.removedNodes.map((n) => n.id as string)).toEqual(['a30']);
    expect(result!.next.nodes).toHaveLength(29);
  });
});
