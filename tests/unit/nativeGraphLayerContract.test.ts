/**
 * cycle-127 · T1/T4：原生代码图谱层降级链契约。
 *
 * 决定性取证（规划 §3）：
 * - `fetchMergedGraph` auto 模式曾宣称「built-in analysis always available」
 *   （src/tools.ts:134 旧日志），但 createGraphToolDeps 只实例化 codegraph/lens
 *   两个**上游**适配器——上游双缺席时 merge 结果是空图，承诺是假的。
 * - `FileSystemAdapter.fetchDataWithSymbols` 是能力完备的原生图生成器
 *   （目录树 + 9 语言 TreeSitter 符号 + contains/extend/implement 边），但生产
 *   代码零实例化（「导出但 0 生产调用点」X5 家族第三次复发）。
 *
 * 本契约钉住四条：
 * - N-1 auto + 双缺席 + 原生通道在场 ⇒ 非空图（假承诺清偿的核心红灯）。
 * - N-2 graphLayer 标记：upstream 在场 = 'upstream'；双缺席启用原生 = 'native'。
 * - N-3 上游在场时原生通道不启用（兼容矩阵：上游行为逐字节不变）。
 * - N-4 原生通道缺席（nativeAdapter: null）+ 双缺席 ⇒ 空图 + 'empty' 标记
 *   （诚实空态，不再假装有内置分析）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeNativeIndexConnections } from '../../src/adapters/nativeIndex.ts';
import { closeAllDbConnections } from '../../src/adapters/codeGraphDb.ts';
import { fetchMergedGraph, type GraphToolDeps, type NativeGraphAdapter } from '../../src/tools.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import type { AdapterResult, GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

/** invoke 桩：恒返 null = 上游工具双缺席（最严酷场景）。 */
const nullInvoke = vi.fn(async () => null);

function makeNode(id: string, type: GraphNode['type'] = 'module'): GraphNode {
  return { id: NodeId(id), label: id, type, filePath: `src/${id}.ts`, lineNumber: 1, properties: {} };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type: 'contains', properties: {} };
}

/** 原生适配桩：返回确定性的目录树 + 符号图。 */
function makeNativeAdapter(nodes: GraphNode[], edges: GraphEdge[]): NativeGraphAdapter {
  return {
    source: 'tree-sitter',
    fetchDataWithSymbols: async () => ({ nodes, edges, source: 'tree-sitter', timestamp: 1 }) as AdapterResult,
  };
}

/** 上游双缺席的 deps（两个真实适配器 + null invoke 天然产出空结果）。 */
function makeDeps(native: NativeGraphAdapter | null): GraphToolDeps {
  return {
    codegraphAdapter: new CodeGraphAdapter(),
    lensAdapter: new LensAdapter(),
    merger: new GraphDataMerger(),
    nativeAdapter: native,
  } as unknown as GraphToolDeps;
}

describe('原生代码图谱层降级链（cycle-127）', () => {
  // cycle-131：per-test 独立 workspace——实时扫描会把索引回写到磁盘（writeNativeIndex），
  // 共用 workspace 会让后跑的用例被先跑用例的索引命中挡住（N-5 假失败实证）。
  let workspace: string;
  let workRoot: string;
  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'native-layer-'));
    workspace = join(workRoot, 'proj');
  });
  afterEach(() => {
    closeNativeIndexConnections();
    closeAllDbConnections();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('N-1 auto + 上游双缺席 + 原生通道在场 ⇒ 非空图（假承诺清偿）', async () => {
    const native = makeNativeAdapter(
      [makeNode('dir:src'), makeNode('file:a.ts', 'module'), makeNode('a:fn:main', 'function')],
      [makeEdge('c1', 'dir:src', 'file:a.ts'), makeEdge('c2', 'file:a.ts', 'a:fn:main')],
    );
    const deps = makeDeps(native);
    const data = await fetchMergedGraph(nullInvoke, workspace, 'auto', deps);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });

  it('N-2 graphLayer 标记：原生降级成功 = native', async () => {
    const native = makeNativeAdapter([makeNode('dir:src')], []);
    const deps = makeDeps(native);
    const data = await fetchMergedGraph(nullInvoke, workspace, 'auto', deps);
    expect(data.metadata.graphLayer).toBe('native');
  });

  it('N-3 上游在场（DB 读取成功）时原生通道不启用', async () => {
    // 用一个「上游有产出」的桩适配器替代真实 CodeGraphAdapter（真实读 DB 的路径
    // 在 routes.test.ts 已覆盖；这里只验证降级链的分支判定）。
    const upstreamNodes = [makeNode('db:node1', 'function')];
    const deps = makeDeps(makeNativeAdapter([makeNode('dir:native')], []));
    const upstreamStub = {
      fetchData: async () => ({ nodes: upstreamNodes, edges: [], source: 'codegraph', timestamp: 1 }) as AdapterResult,
    } as unknown as CodeGraphAdapter;
    deps.codegraphAdapter = upstreamStub;
    const data = await fetchMergedGraph(nullInvoke, workspace, 'auto', deps);
    expect(data.metadata.graphLayer).toBe('upstream');
    // 原生节点不得混入（兼容矩阵：上游在场 = 现行为）。
    expect(data.nodes.some((n) => String(n.id).startsWith('dir:native'))).toBe(false);
  });

  it('N-4 原生通道缺席 + 双缺席 ⇒ 空图 + empty 标记（诚实空态）', async () => {
    const deps = makeDeps(null);
    const data = await fetchMergedGraph(nullInvoke, workspace, 'auto', deps);
    expect(data.nodes.length).toBe(0);
    expect(data.metadata.graphLayer).toBe('empty');
  });

  it('N-5 source=both（非 auto）不触发原生降级', async () => {
    const calls: string[] = [];
    const native = makeNativeAdapter([makeNode('dir:src')], []);
    const spy = {
      ...native,
      fetchDataWithSymbols: async (p: string) => { calls.push(p); return native.fetchDataWithSymbols(p); },
    };
    const deps = makeDeps(spy);
    await fetchMergedGraph(nullInvoke, workspace, 'both', deps);
    // cycle-131 语义反转：'both' 双缺席**必须**触发原生补位（生产主路径硬编码
    // 'both'——降级链只认 auto 使原生层在真实宿主零可达，真机取证后修复）。
    expect(calls.length).toBe(1);
  });

  it('N-6 source=both + 双缺席 + 原生在场 ⇒ 非空图 + native 标记（cycle-131 P0 守卫）', async () => {
    const native = makeNativeAdapter(
      [makeNode('dir:src'), makeNode('file:a.ts', 'module')],
      [makeEdge('c1', 'dir:src', 'file:a.ts')],
    );
    const deps = makeDeps(native);
    const data = await fetchMergedGraph(nullInvoke, workspace, 'both', deps);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.metadata.graphLayer).toBe('native');
  });

  it('N-7 source=both + 上游在场 ⇒ 原生不启用（兼容不变量回归）', async () => {
    const calls: string[] = [];
    const native = makeNativeAdapter([makeNode('dir:native')], []);
    const spy = {
      ...native,
      fetchDataWithSymbols: async (p: string) => { calls.push(p); return native.fetchDataWithSymbols(p); },
    };
    const deps = makeDeps(spy);
    const upstreamStub = {
      fetchData: async () => ({ nodes: [makeNode('db:node1', 'function')], edges: [], source: 'codegraph', timestamp: 1 }) as AdapterResult,
    } as unknown as CodeGraphAdapter;
    deps.codegraphAdapter = upstreamStub;
    const data = await fetchMergedGraph(nullInvoke, workspace, 'both', deps);
    expect(calls).toEqual([]);
    expect(data.metadata.graphLayer).toBe('upstream');
  });
});
