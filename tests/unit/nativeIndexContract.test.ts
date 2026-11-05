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
import { readEdgesFromDb, readEdgesForNodesFromDb } from '../../src/adapters/codeGraphEdgeReads.ts';
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

  // ── cycle-141 第五轮：顶层读取优先级（dsh-anic 真机症结的直接回归钉）──────
  //
  // 症结复现：1777 个裸路径 id（盘符 `D:\...` 开头）的 `<import_statement>` 伪节点
  // 字母序全部排在 `dir:`（小写 d = 0x64）之前 ⇒ LIMIT 50 选出的顶层节点全是
  // 伪节点（0 出边 0 入边），342 个真实目录节点被挤出，画布塌缩成单簇。
  // 修复：ORDER BY 分层——dir: 优先、file: 次之、其他垫底。
  it('NB-8 顶层读取 dir:/file: 优先于裸路径 id（字母序不再挤掉目录树）', () => {
    const nodes: GraphNode[] = [
      // 40 个裸路径伪节点（字母序 < dir:，模拟 dsh-anic 的 <import_statement>）
      ...Array.from({ length: 40 }, (_, i) =>
        makeNode(`D:\\proj/file${i}.ts:<import_statement>:${i}`, 'module', `D:\\proj/file${i}.ts`, '<import_statement>')),
      // 真实目录树节点（dir: 前缀）
      makeNode('dir:D:\\proj/src', 'module', 'D:\\proj/src'),
      makeNode('dir:D:\\proj/docs', 'module', 'D:\\proj/docs'),
      // file: 节点
      makeNode('file:D:\\proj/src/main.ts', 'module', 'D:\\proj/src/main.ts'),
    ];
    writeNativeIndex(workspace, 'fp', nodes, []);
    const indexPath = resolveNativeIndexPath(workspace);

    // LIMIT 3 必须是 dir: ×2 + file: ×1——伪节点一个都不进
    const top = readTopLevelNodesFromDb(indexPath, 3);
    expect(top).not.toBeNull();
    expect(top!.total).toBe(43); // 全部 kind=module
    const ids = top!.nodes.map((r) => r.id);
    expect(ids).toContain('dir:D:\\proj/src');
    expect(ids).toContain('dir:D:\\proj/docs');
    expect(ids).toContain('file:D:\\proj/src/main.ts');
    expect(ids.filter((id) => id.includes('<import_statement>'))).toHaveLength(0);
  });

  it('NB-9 同层内排序确定性：dir 间按路径长度再 id（稳定分页）', () => {
    const nodes = [
      makeNode('dir:D:\\proj/aa', 'module', 'D:\\proj/aa'),
      makeNode('dir:D:\\proj/b/ccc', 'module', 'D:\\proj/b/ccc'),
      makeNode('dir:D:\\proj/a', 'module', 'D:\\proj/a'),
    ];
    writeNativeIndex(workspace, 'fp', nodes, []);
    const indexPath = resolveNativeIndexPath(workspace);
    const top = readTopLevelNodesFromDb(indexPath, 10);
    // 同为 dir: 层：按 LENGTH(file_path) 升序（a=9 < aa=10 < b/ccc=13），同长按 id
    expect(top!.nodes.map((r) => r.id)).toEqual([
      'dir:D:\\proj/a',
      'dir:D:\\proj/aa',
      'dir:D:\\proj/b/ccc',
    ]);
  });

  // ── cycle-141 第六轮：dir: 目录节点的展开语义（dsh-anic 真机复现 total=0）──────
  //
  // 现有 children 语义（file_path = 父.file_path AND kind NOT IN 顶层）只为上游
  // 索引的 file→符号 设计：对 dir: 目录节点该查询恒返回 0（原生索引的目录树是
  // contains 边）。修复：dir: 分支按 contains 边读孩子；file: 分支语义不变。
  it('NB-10 dir: 节点的展开按 contains 边读孩子（现有语义对 dir 恒 0 的回归钉）', () => {
    const nodes = [
      makeNode('dir:D:\\proj/src', 'module', 'D:\\proj/src'),
      makeNode('dir:D:\\proj/src/adapters', 'module', 'D:\\proj/src/adapters'),
      makeNode('dir:D:\\proj/src/host', 'module', 'D:\\proj/src/host'),
      makeNode('file:D:\\proj/src/index.ts', 'module', 'D:\\proj/src/index.ts'),
      makeNode('fn:main', 'function', 'D:\\proj/src/index.ts', 'main'),
    ];
    const edges = [
      makeEdge('c1', 'dir:D:\\proj/src', 'dir:D:\\proj/src/adapters', 'contains'),
      makeEdge('c2', 'dir:D:\\proj/src', 'dir:D:\\proj/src/host', 'contains'),
      makeEdge('c3', 'dir:D:\\proj/src', 'file:D:\\proj/src/index.ts', 'contains'),
      makeEdge('c4', 'file:D:\\proj/src/index.ts', 'fn:main', 'contains'),
    ];
    writeNativeIndex(workspace, 'fp', nodes, edges);
    const indexPath = resolveNativeIndexPath(workspace);

    const kids = readNodeChildrenFromDb(indexPath, 'dir:D:\\proj/src', null, 10);
    expect(kids).not.toBeNull();
    expect(kids!.total).toBe(3);
    // 按 target 排序：adapters < host < file（字母序 D:\proj/src/adapters < .../host < .../index.ts）
    expect(kids!.nodes.map((r) => r.id)).toEqual([
      'dir:D:\\proj/src/adapters',
      'dir:D:\\proj/src/host',
      'file:D:\\proj/src/index.ts',
    ]);
  });

  it('NB-11 dir: 分支分页游标：第二页续读且不重复', () => {
    const nodes = [
      makeNode('dir:D:\\proj/src', 'module', 'D:\\proj/src'),
      ...['a', 'b', 'c'].map((s) => makeNode(`dir:D:\\proj/src/${s}`, 'module', `D:\\proj/src/${s}`)),
    ];
    const edges = ['a', 'b', 'c'].map((s) =>
      makeEdge(`c-${s}`, 'dir:D:\\proj/src', `dir:D:\\proj/src/${s}`, 'contains'));
    writeNativeIndex(workspace, 'fp', nodes, edges);
    const indexPath = resolveNativeIndexPath(workspace);

    const page1 = readNodeChildrenFromDb(indexPath, 'dir:D:\\proj/src', null, 2);
    expect(page1!.total).toBe(3);
    expect(page1!.nodes).toHaveLength(2);
    // 第二页：cursor = 本页最后一条 id（dataRoutes /children 的既有约定）
    const lastId = page1!.nodes[page1!.nodes.length - 1]!.id;
    const page2 = readNodeChildrenFromDb(indexPath, 'dir:D:\\proj/src', lastId, 2);
    expect(page2!.total).toBe(3);
    expect(page2!.nodes).toHaveLength(1);
    const seen = [...page1!.nodes, ...page2!.nodes].map((r) => r.id);
    expect(new Set(seen).size).toBe(3);
  });

  it('NB-12 file: 节点的展开语义不变（上游行为逐字节兼容）', () => {
    const nodes = [
      makeNode('file:src/a.ts', 'module', 'src/a.ts'),
      makeNode('fn:a', 'function', 'src/a.ts', 'a'),
    ];
    const edges = [makeEdge('c1', 'file:src/a.ts', 'fn:a', 'contains')];
    writeNativeIndex(workspace, 'fp', nodes, edges);
    const indexPath = resolveNativeIndexPath(workspace);
    // file: 走原语义（file_path 匹配），返回 fn:a
    const kids = readNodeChildrenFromDb(indexPath, 'file:src/a.ts', null, 10);
    expect(kids!.total).toBe(1);
    expect(kids!.nodes.map((r) => r.id)).toEqual(['fn:a']);
  });

  // ── cycle-141 第六轮：双重转义（存量脏库）兼容 ───────────────────────────
  //
  // 真机实证：workspace/repoId 沿 LLM 工具调用传递时 JSON 转义层数不恒定，
  // dsh-anic 的 index_meta 同分钟两条记录（单/双反斜杠），后者写出的整库
  // id/file_path/边端点全带双反斜杠。写侧消毒只管新写入；存量库靠读侧
  // 双形态查询兼容——单形态查询 0 命中且含反斜杠时按折叠形态再查。
  it('NB-13 存量脏库：单反斜杠查询命中双反斜杠存储的 dir 子树', async () => {
    // 直接绕过 writeNativeIndex（它已消毒），用原始 SQL 模拟修复前的脏库形态。
    // 用 writeNativeIndex 写干净数据，再手动 UPDATE 成脏形态。
    const nodes = [
      makeNode('dir:D:\\proj/src', 'module', 'D:\\proj/src'),
      makeNode('dir:D:\\proj/src/adapters', 'module', 'D:\\proj/src/adapters'),
    ];
    const edges = [makeEdge('c1', 'dir:D:\\proj/src', 'dir:D:\\proj/src/adapters', 'contains')];
    writeNativeIndex(workspace, 'fp', nodes, edges);
    const indexPath = resolveNativeIndexPath(workspace);
    // 先关掉写/读两池连接——SQLite 连接缓存了页数据，UPDATE 跨连接不可见。
    closeNativeIndexConnections();
    closeAllDbConnections();
    // 手动污染成修复前的形态（id/file_path/边端点全部双反斜杠）
    const { DatabaseSync } = await import('node:sqlite');
    const dirty = new DatabaseSync(indexPath);
    dirty.exec("UPDATE nodes SET id = REPLACE(id, '\\', '\\\\'), file_path = REPLACE(file_path, '\\', '\\\\')");
    dirty.exec("UPDATE edges SET source = REPLACE(source, '\\', '\\\\'), target = REPLACE(target, '\\', '\\\\')");
    dirty.close();

    // 客户端视角：折叠后的单反斜杠 id。直接查必须命中（双形态回查生效）。
    const kids = readNodeChildrenFromDb(indexPath, 'dir:D:\\proj/src', null, 10);
    expect(kids).not.toBeNull();
    expect(kids!.total).toBe(1);
    // 返回行已折叠回单形态（与 bootstrap id 同域）
    expect(kids!.nodes.map((r) => r.id)).toEqual(['dir:D:\\proj/src/adapters']);

    // 顶层读取同样返回折叠形态
    const top = readTopLevelNodesFromDb(indexPath, 10);
    expect(top!.nodes.every((r) => !r.id.includes('\\\\'))).toBe(true);

    // 边 join 双形态命中
    const edgesFor = readEdgesForNodesFromDb(indexPath, ['dir:D:\\proj/src', 'dir:D:\\proj/src/adapters']);
    expect(edgesFor).toHaveLength(1);
    expect(edgesFor[0]!.kind).toBe('contains');
    // 返回行端点必须折叠回单形态——调用方 id 域（节点行已消毒）与边端点同域，
    // 否则客户端聚类聚合映射不上、边全丢（真机 "50 节点 · 0 边" 的直接根因）。
    expect(edgesFor[0]!.source).toBe('dir:D:\\proj/src');
    expect(edgesFor[0]!.target).toBe('dir:D:\\proj/src/adapters');
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
