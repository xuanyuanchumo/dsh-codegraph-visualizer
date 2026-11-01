/**
 * cycle-128：原生 SQLite 索引契约（写侧 + 指纹去重 + 读侧兼容性证明）。
 *
 * 核心主张：原生索引**逐列复用上游 schema**（nodes/edges 同列名同语义），
 * 因此既有读侧函数（readGraphFromDbPaged / readTopLevelNodesFromDb /
 * readNodeChildrenFromDb / readEdgesFromDb）在原生库上**零改动可用**——
 * 「实现兼容代码图谱」的实质不是复制上游实现，而是共享数据契约。
 * 兼容性用例（NB-5~NB-7）就是这条主张的现场证明：写原生库 → 用上游读侧读 →
 * 逐字段断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeNativeIndex, readNativeIndexMeta, resolveNativeIndexPath, closeNativeIndexConnections,
} from '../../src/adapters/nativeIndex.ts';
import {
  readGraphFromDbPaged, readTopLevelNodesFromDb, readNodeChildrenFromDb, closeAllDbConnections,
} from '../../src/adapters/codeGraphDb.ts';
import { readEdgesFromDb } from '../../src/adapters/codeGraphEdgeReads.ts';
import { mapRowsToGraphNodes, mapRowsToGraphEdges } from '../../src/adapters/codeGraphRows.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, type: GraphNode['type'], filePath: string, label = id): GraphNode {
  return { id: NodeId(id), label, type, filePath, lineNumber: 1, properties: {} };
}

function makeEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'contains', line?: number): GraphEdge {
  return {
    id: EdgeId(id), source: NodeId(source), target: NodeId(target), type,
    properties: line !== undefined ? { line } : {},
  };
}

describe('原生 SQLite 索引（cycle-128）', () => {
  let workRoot: string;
  let workspace: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'native-index-test-'));
    workspace = join(workRoot, 'proj');
    // workspace 目录本身无需存在（resolveNativeIndexPath 只做路径规整；mkdirSync
    // 在写侧打开时递归建父目录）。
  });

  afterEach(() => {
    // 两个池都要清：写侧（nativeIndex）与读侧（codeGraphDb 的 dbPool）——
    // Windows 上 SQLite 未关闭的句柄会让 rmSync EPERM（NB-3 首跑实证）。
    closeNativeIndexConnections();
    closeAllDbConnections();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('NB-1 写入后 meta 可读（指纹/规模/时间戳）', () => {
    const nodes = [makeNode('n1', 'function', 'a.ts'), makeNode('n2', 'class', 'b.ts')];
    const edges = [makeEdge('e1', 'n1', 'n2')];
    expect(writeNativeIndex(workspace, 'fp-1', nodes, edges)).toBe(true);
    const meta = readNativeIndexMeta(workspace);
    expect(meta).not.toBeNull();
    expect(meta!.fingerprint).toBe('fp-1');
    expect(meta!.nodeCount).toBe(2);
    expect(meta!.edgeCount).toBe(1);
    expect(meta!.indexedAt).toBeGreaterThan(0);
  });

  it('NB-2 同指纹同规模零写入（去重返回 false）', () => {
    const nodes = [makeNode('n1', 'function', 'a.ts')];
    expect(writeNativeIndex(workspace, 'fp-1', nodes, [])).toBe(true);
    // 同指纹同规模 ⇒ 去重。
    expect(writeNativeIndex(workspace, 'fp-1', nodes, [])).toBe(false);
    // 指纹或规模任一变化 ⇒ 重写。
    expect(writeNativeIndex(workspace, 'fp-2', nodes, [])).toBe(true);
    expect(writeNativeIndex(workspace, 'fp-2', [...nodes, makeNode('n2', 'class', 'b.ts')], [])).toBe(true);
  });

  it('NB-3 重写替换旧内容（全量 DELETE + INSERT，无残留）', () => {
    writeNativeIndex(workspace, 'fp-1', [makeNode('old', 'function', 'a.ts')], []);
    writeNativeIndex(workspace, 'fp-2', [makeNode('new', 'class', 'b.ts')], []);
    const indexPath = resolveNativeIndexPath(workspace);
    const rows = readGraphFromDbPaged(indexPath, null, 100);
    expect(rows).not.toBeNull();
    expect(rows!.nodes.map((r) => r.id)).toEqual(['new']);
  });

  it('NB-4 非法路径（.. 穿越）写失败且不抛出', () => {
    expect(writeNativeIndex('D:/evil/../..', 'fp', [], [])).toBe(false);
  });

  // ── 读侧兼容性证明：上游读侧函数零改动读原生库 ─────────────────────────

  it('NB-5 readGraphFromDbPaged 读原生库：分页游标语义与上游库一致', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => makeNode(`n${i}`, 'function', `f${i}.ts`));
    const edges = [makeEdge('e1', 'n0', 'n1', 'contains', 3)];
    writeNativeIndex(workspace, 'fp', nodes, edges);
    const indexPath = resolveNativeIndexPath(workspace);

    // 第一页 3 条 + 游标。
    const page1 = readGraphFromDbPaged(indexPath, null, 3);
    expect(page1).not.toBeNull();
    expect(page1!.nodes.length).toBe(3);
    expect(page1!.nextCursor).not.toBeNull();
    // 第二页续读。
    const page2 = readGraphFromDbPaged(indexPath, page1!.nextCursor, 3);
    expect(page2!.nodes.length).toBe(3);
    // 读完。
    const page3 = readGraphFromDbPaged(indexPath, page2!.nextCursor, 3);
    expect(page3!.nodes.length).toBe(1);
    expect(page3!.nextCursor).toBeNull();
    // 全量合并 = 写入集合。
    const all = [...page1!.nodes, ...page2!.nodes, ...page3!.nodes];
    expect(new Set(all.map((r) => r.id))).toEqual(new Set(nodes.map((n) => String(n.id))));
  });

  it('NB-6 readTopLevelNodesFromDb / readNodeChildrenFromDb 读原生库：kind/file_path 语义一致', () => {
    // 上游顶层 kind = file/module/import；TreeSitter 的目录节点 type='module'。
    // readNodeChildrenFromDb 的语义是「同一 file_path 内的非顶层符号」——
    // parent 是 file 节点（file_path 与符号相同），不是目录树（本仓目录树由
    // FileSystemAdapter 图生成，不走此函数）。
    writeNativeIndex(workspace, 'fp', [
      makeNode('file:src/a.ts', 'module', 'src/a.ts'),
      makeNode('fn:a', 'function', 'src/a.ts', 'a'),
      makeNode('cls:A', 'class', 'src/a.ts', 'A'),
      makeNode('fn:other', 'function', 'src/b.ts', 'other'),
    ], [makeEdge('c1', 'file:src/a.ts', 'fn:a')]);
    const indexPath = resolveNativeIndexPath(workspace);

    const top = readTopLevelNodesFromDb(indexPath, 10);
    expect(top).not.toBeNull();
    expect(top!.total).toBe(1); // module ×1（function/class 不算顶层）
    expect(top!.nodes.map((r) => r.id)).toEqual(['file:src/a.ts']);

    // 同文件符号子节点：a.ts 内的 function/class，不含 b.ts 的。
    const children = readNodeChildrenFromDb(indexPath, 'file:src/a.ts', null, 10);
    expect(children).not.toBeNull();
    expect(children!.nodes.map((r) => r.id).sort()).toEqual(['cls:A', 'fn:a']);
    expect(children!.total).toBe(2);
  });

  it('NB-7 mapRowsToGraph* 往返：写入的图从原生库读回后逐字段等价', () => {
    const src = [makeNode('fn:main', 'function', 'src/m.ts', 'main'), makeNode('cls:A', 'class', 'src/A.ts', 'A')];
    const sedges = [makeEdge('x1', 'fn:main', 'cls:A', 'extend', 42)];
    writeNativeIndex(workspace, 'fp', src, sedges);
    const indexPath = resolveNativeIndexPath(workspace);

    const page = readGraphFromDbPaged(indexPath, null, 100);
    expect(page).not.toBeNull();
    const validIds = new Set(page!.nodes.map((r) => r.id));
    const nodes = mapRowsToGraphNodes(page!.nodes);
    const edges = mapRowsToGraphEdges(page!.edges, validIds);

    expect(nodes.map((n) => String(n.id)).sort()).toEqual(['cls:A', 'fn:main']);
    expect(nodes.map((n) => n.type).sort()).toEqual(['class', 'function']);
    expect(edges.length).toBe(1);
    expect(String(edges[0]!.source)).toBe('fn:main');
    expect(String(edges[0]!.target)).toBe('cls:A');
    expect(edges[0]!.type).toBe('extend');
    // line 属性经上游行契约（edges.line 列）往返保真。
    expect(edges[0]!.properties?.line).toBe(42);
  });

  it('NB-8 readEdgesFromDb 读原生库：edges 读取路径零改动可用', () => {
    writeNativeIndex(workspace, 'fp',
      [makeNode('a', 'function', 'a.ts'), makeNode('b', 'function', 'b.ts')],
      [makeEdge('e1', 'a', 'b', 'contains')]);
    const indexPath = resolveNativeIndexPath(workspace);
    // 真实签名：(dbPath, nodeId, scope, cursor, limit) → {edges, total}。
    const result = readEdgesFromDb(indexPath, 'a', 'symbol', 0, 100);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(1);
    expect(result!.edges[0]!.source).toBe('a');
    expect(result!.edges[0]!.target).toBe('b');
  });
});
