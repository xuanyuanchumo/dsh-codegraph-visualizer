/**
 * XuanjiAdapterPool 宿主接线测试（XJ-02）。
 *
 * 这一层要证明的不是「库里有个池类」，而是三件在真实宿主里会出错的事：
 *
 * 1. **同一个 repoId 复用同一个适配层**：`pool.get` 返回同一实例（`toBe`），
 *    并且第二次 `syncGraph` 判定为 `'none'`、`loadGraph` 只被调用 1 次。
 *    —— 实现里 `fetchMergedGraph` 每次都 `Date.now()` 造新 metadata，所以「同一份图」
 *    只能靠结构比较认出来；如果 syncGraph 恒返回 `'full'`，这条计数断言就会红。
 * 2. **缓存陈旧是正确性风险**：图变了必须能反映出来（增补走 `'delta'`），
 *    图删了东西必须走 `'full'` 重建——绝不能返回上一版的路径。
 * 3. **真实 delta**：delta 不是手搓的，而是生产路径 `merger.applyDelta` + `computeGraphDiff`
 *    产出的结构差；把它喂给池之后，增量维护的索引必须与「从零全量物化」逐哈希一致。
 *
 * 末尾还有一条**工具级**接线断言：`graph_path_enumerate` / `graph_cycles` 必须共用池
 * （两次调用只装载一次图），否则池类本身再正确也只是死代码。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  XuanjiAdapter,
  XuanjiAdapterPool,
} from '../../src/shared/analysis/XuanjiAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { computeGraphDiff } from '../../src/merger/DiffEngine.ts';
import type { GraphData, GraphEdge, GraphNode } from '../../src/types/index.ts';
import { NodeId, EdgeId, RepoId } from '../../src/types/index.ts';
import type { PathRule } from '../../src/xuanji/core/path-rule.ts';
import type { PathIndex } from '../../src/xuanji/index/path-index.ts';
import { enumerate } from '../../src/xuanji/query/query-engine.ts';
import type { Context } from '@deepseek-ai/cordis';

// ── Mock adapters so createGraphTools never touches .codegraph/ (same shape as tools.test.ts) ──
vi.mock('../../src/adapters/CodeGraphAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
    source: 'codegraph' as const,
    timestamp: 1,
  });
  return {
    CodeGraphAdapter: vi.fn().mockImplementation(() => ({
      fetchData: mockFetchData,
      source: 'codegraph' as const,
    })),
  };
});

vi.mock('../../src/adapters/LensAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
    source: 'lens' as const,
    timestamp: 1,
  });
  return {
    LensAdapter: vi.fn().mockImplementation(() => ({
      fetchData: mockFetchData,
      source: 'lens' as const,
    })),
  };
});

const { createGraphTools } = await import('../../src/tools.ts');
const { CodeGraphAdapter } = await import('../../src/adapters/CodeGraphAdapter.ts');

// ── Fixtures ───────────────────────────────────────────────────────────

let seq = 0;

function node(id: string, type: GraphNode['type'] = 'function', properties: Record<string, unknown> = {}): GraphNode {
  return { id: NodeId(id), label: id, type, filePath: `src/${id}.ts`, properties };
}

function edge(source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(`e${++seq}`), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

function graphData(nodes: GraphNode[], edges: GraphEdge[], timestamp = 1): GraphData {
  return {
    nodes,
    edges,
    metadata: {
      repoId: RepoId('repo'),
      timestamp,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

const CYCLES_RULE: PathRule = {
  name: 'cycles',
  version: 1,
  start: () => true,
  edgeTypes: new Set(['call']),
  lMin: 1,
  lMax: 4,
  simple: true,
  closed: true,
  normalize: 'canonical',
  output: (nodes) => nodes,
};

function materialize(adapter: XuanjiAdapter, rule: PathRule): PathIndex {
  const index = adapter.getIndex(rule.name) ?? adapter.registerRule(rule).index;
  if (!index) throw new Error(`rule "${rule.name}" was rejected by validateRule`);
  enumerate(adapter.graph, rule, [...adapter.graph.nodeIds()], index);
  return index;
}

function liveHashes(index: PathIndex): string[] {
  return [...index.hashIndex.values()]
    .filter((entry) => !entry.stale)
    .map((entry) => entry.hash)
    .sort();
}

/** 链 a→b→c（无环），供「新增一条边闭合出环」的增量用例使用。 */
function chain(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('a', 'b'), edge('b', 'c')],
  };
}

/** 跟踪 loadGraph spy，便于逐个用例还原（池内部会自己调用 loadGraph）。 */
const activeSpies: Array<{ mockRestore(): void }> = [];

function spyOnLoadGraph() {
  const spy = vi.spyOn(XuanjiAdapter.prototype, 'loadGraph');
  activeSpies.push(spy);
  return spy;
}

afterEach(() => {
  // 只还原本文件显式创建的 spy：`vi.restoreAllMocks()` 会连 vi.mock 工厂里的 vi.fn 一起重置，
  // 让后面用例的 `new CodeGraphAdapter()` 变成空实现（本仓库踩过同类坑）。
  while (activeSpies.length > 0) activeSpies.pop()!.mockRestore();
});

// ── 池本身 ─────────────────────────────────────────────────────────────

describe('XuanjiAdapterPool：同 repoId 复用同一个适配层', () => {
  it('两次 get 返回同一实例，且第二次 syncGraph 为 none、loadGraph 只调 1 次', () => {
    const pool = new XuanjiAdapterPool();
    const loadGraph = spyOnLoadGraph();
    const data = graphData([node('a'), node('b')], [edge('a', 'b')], 100);

    const first = pool.get('repo-x');
    expect(first.syncGraph(data)).toBe('full');

    const second = pool.get('repo-x');
    expect(second).toBe(first);
    // 生产里 fetchMergedGraph 每次都会造新的 timestamp：结构没变就必须仍然是 none。
    expect(second.syncGraph(graphData(data.nodes, data.edges, 200))).toBe('none');

    expect(loadGraph).toHaveBeenCalledTimes(1);
  });

  it('同一份数据连读两次，路径结果逐项相同（复用空间不改变答案）', () => {
    const pool = new XuanjiAdapterPool();
    const data = graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
      10,
    );
    const adapter = pool.get('repo-y');
    adapter.syncGraph(data);
    const first = adapter.findPathsBetween('a', 'd').paths.map((p) => p.join('>')).sort();

    expect(adapter.syncGraph(graphData(data.nodes, data.edges, 11))).toBe('none');
    const second = adapter.findPathsBetween('a', 'd').paths.map((p) => p.join('>')).sort();

    expect(first).toEqual(['a>b>d', 'a>c>d']);
    expect(second).toEqual(first);
  });

  it('LRU：capacity=1 时新 repo 挤掉旧 repo；命中会刷新顺序', () => {
    const pool = new XuanjiAdapterPool(1);
    const a1 = pool.get('a');
    pool.get('b');
    expect(pool.get('a')).not.toBe(a1);

    const two = new XuanjiAdapterPool(2);
    const first = two.get('a');
    const second = two.get('b');
    expect(two.get('a')).toBe(first); // 命中 a ⇒ b 变成 LRU
    two.get('c');
    expect(two.get('a')).toBe(first);
    expect(two.get('b')).not.toBe(second);
  });

  it('invalidate 丢弃派生状态，dispose 清空全部缓存', () => {
    const pool = new XuanjiAdapterPool();
    const before = pool.get('repo');
    pool.invalidate('repo');
    expect(pool.get('repo')).not.toBe(before);

    const kept = pool.get('repo');
    pool.dispose();
    expect(pool.get('repo')).not.toBe(kept);
  });
});

// ── syncGraph 的三态判定 ───────────────────────────────────────────────

describe('XuanjiAdapter.syncGraph：不确定就全量重建', () => {
  it('纯增补 ⇒ delta；节点属性变化 / 删除节点 / 删除边 ⇒ full', () => {
    const pool = new XuanjiAdapterPool();
    const adapter = pool.get('repo');
    const base = chain();
    expect(adapter.syncGraph(graphData(base.nodes, base.edges, 1))).toBe('full');

    const grown = {
      nodes: [...base.nodes, node('d')],
      edges: [...base.edges, edge('b', 'd')],
    };
    expect(adapter.syncGraph(graphData(grown.nodes, grown.edges, 2))).toBe('delta');
    expect(adapter.stats().nodes).toBe(4);
    expect(adapter.findPathsBetween('a', 'd').paths).toEqual([['a', 'b', 'd']]);

    // 属性变化（label 参与 attrs，可能参与规则谓词）⇒ 不能走增量
    const relabelled = grown.nodes.map((n) => (n.id === 'a' ? { ...n, label: 'A renamed' } : n));
    expect(adapter.syncGraph(graphData(relabelled, grown.edges, 3))).toBe('full');
    expect(adapter.graph.getNodeAttrs('a')?.label).toBe('A renamed');

    // 删除节点 / 删除边 ⇒ 重建
    expect(adapter.syncGraph(graphData([node('a')], [], 4))).toBe('full');
    expect(adapter.stats()).toMatchObject({ nodes: 1, edges: 0 });
  });

  it('图变小后不得返回旧路径（缓存陈旧 = 正确性缺陷）', () => {
    const pool = new XuanjiAdapterPool();
    const adapter = pool.get('repo');
    const base = chain();
    adapter.syncGraph(graphData(base.nodes, base.edges, 1));
    expect(adapter.findPathsBetween('a', 'c').total).toBe(1);

    // 同一份 nodes、少掉 b→c 这条边：旧实现会把 a→b→c 继续当作可用路径返回。
    const shrunk = graphData(base.nodes, [base.edges[0]!], 2);
    expect(adapter.syncGraph(shrunk)).toBe('full');
    expect(adapter.findPathsBetween('a', 'c').total).toBe(0);
  });

  it('首次装载一律 full（不能只靠 delta 拼出图）', () => {
    const adapter = new XuanjiAdapter();
    expect(adapter.isReady).toBe(false);
    expect(adapter.syncGraph(graphData([node('a')], [], 1))).toBe('full');
    expect(adapter.isReady).toBe(true);
  });
});

// ── applyDelta：真实 delta（merger.applyDelta + computeGraphDiff）────────

describe('XuanjiAdapterPool.applyDelta：真实 delta 驱动增量索引', () => {
  it('池层增量结果与「新图从零全量物化」逐哈希一致', () => {
    const pool = new XuanjiAdapterPool();
    const base = chain();
    const baseData = graphData(base.nodes, base.edges, 1);
    const adapter = pool.get('repo');
    expect(adapter.syncGraph(baseData)).toBe('full');
    materialize(adapter, CYCLES_RULE);
    expect(adapter.getIndex('cycles')!.liveCount()).toBe(0); // 链上没有环

    // 生产路径：缓存基线 + 新结果 ⇒ merger.applyDelta ⇒ computeGraphDiff（不手搓 delta）
    const freshNodes = [...base.nodes];
    const freshEdges = [...base.edges, edge('c', 'a')];
    const merged = new GraphDataMerger().applyDelta(baseData, {
      nodes: freshNodes,
      edges: freshEdges,
      source: 'codegraph',
      timestamp: 2,
    });
    const delta = computeGraphDiff(baseData.nodes, baseData.edges, merged.nodes, merged.edges);
    expect(delta.addedEdges).toHaveLength(1);

    const applied = pool.applyDelta('repo', delta);
    expect(applied.applied).toBe(true);
    expect(applied.addedPaths).toBeGreaterThan(0);
    expect(applied.degradedRules).toEqual([]);

    // 对照：全新适配层装载合并后的图 + 从零全量物化
    const reference = new XuanjiAdapter();
    reference.loadGraph(merged);
    const referenceIndex = materialize(reference, CYCLES_RULE);

    expect(liveHashes(adapter.getIndex('cycles')!)).toEqual(liveHashes(referenceIndex));
    // 新增的 c→a 让 c 也能读到 b：增量维护后的图空间本身必须正确
    expect(adapter.findPathsBetween('c', 'b').paths).toEqual([['c', 'a', 'b']]);
    expect(adapter.cycles().total).toBe(reference.cycles().total);
  });

  it('基线不匹配 ⇒ 不应用 delta，并丢弃缓存（下次从零重建）', () => {
    const pool = new XuanjiAdapterPool();
    const adapter = pool.get('repo');
    // 适配层的基线：只有 a→b
    adapter.syncGraph(graphData([node('a'), node('b')], [edge('a', 'b')], 1));

    // 另一版修订（a,b,c + a→b,b→c）回退到上一版的 delta：它描述的删除在适配层里根本不存在
    const newerNodes = [node('a'), node('b'), node('c')];
    const newerEdges = [edge('a', 'b'), edge('b', 'c')];
    const staleDelta = computeGraphDiff(newerNodes, newerEdges, [node('a'), node('b')], [edge('a', 'b')]);
    expect(staleDelta.removedNodes.map((n) => n.id as string)).toEqual(['c']);

    const applied = pool.applyDelta('repo', staleDelta);

    expect(applied.applied).toBe(false);
    expect(applied.addedPaths).toBe(0);
    // 丢弃缓存：下一次 get 拿到新实例，而不是被混进两版图的旧实例
    expect(pool.get('repo')).not.toBe(adapter);
  });

  it('尚未装载过图的 repo 不接受 delta（空空间 + delta 会是残缺图）', () => {
    const pool = new XuanjiAdapterPool();
    pool.get('repo'); // 只建了对象，没有 syncGraph/loadGraph
    const delta = computeGraphDiff([], [], [node('a'), node('b')], [edge('a', 'b')]);

    expect(pool.applyDelta('repo', delta)).toEqual({
      applied: false,
      addedPaths: 0,
      stalePaths: 0,
      degradedRules: [],
      // 没体检过 ⇒ 空结论，不是「全 ok」：调用方必须能区分
      // 「体检通过」与「根本没体检」（空集冒充全绿是本仓库的复发形态）。
      invariants: { byRule: new Map(), violated: [] },
    });
    // 没有被应用 ⇒ 空间仍然是空的
    expect(pool.get('repo').isReady).toBe(false);
  });

  it('没有缓存的 repo：applyDelta 是安全 no-op', () => {
    const pool = new XuanjiAdapterPool();
    const delta = computeGraphDiff([], [], [node('a')], []);
    expect(pool.applyDelta('never-seen', delta).applied).toBe(false);
  });
});

// ── 工具级接线：只有 tool 真的走池，池才算被用上 ─────────────────────────

describe('graph_path_enumerate / graph_cycles 共用池化适配层（生产接线）', () => {
  const mockExec = {
    deferContext: vi.fn(),
    concludeTurn: vi.fn(),
  } as unknown as Parameters<
    Awaited<ReturnType<typeof createGraphTools>>['graphPathEnumerate']['execute']
  >[1];

  function mockCtx(): Context {
    return {
      tools: {
        register: vi.fn(),
        execute: vi.fn().mockResolvedValue({ isError: false, value: null }),
        get: vi.fn().mockReturnValue(undefined),
      },
      on: vi.fn(),
      emit: vi.fn(),
      effect: vi.fn(),
    } as unknown as Context;
  }

  it('同一 repoId 的两次读法只装载一次图（pool.get 复用 + syncGraph 判定 none）', async () => {
    const fetchData = new CodeGraphAdapter().fetchData as ReturnType<typeof vi.fn>;
    fetchData.mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
        { id: 'n4', label: 'D', type: 'function', filePath: 'd.ts', lineNumber: 4, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n3', target: 'n1', type: 'call', properties: {} },
        { id: 'e4', source: 'n2', target: 'n4', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });

    const tools = await createGraphTools(mockCtx());
    const loadGraph = spyOnLoadGraph();
    try {
      const paths = await tools.graphPathEnumerate.execute(
        { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n4' },
        mockExec,
      ) as unknown as { paths: string[][]; total: number } | null;
      const cycles = await tools.graphCycles.execute({ repoId: 'r1' }, mockExec) as unknown as {
        total: number;
      } | null;

      expect(paths?.total).toBe(1);
      expect(paths?.paths).toEqual([['n1', 'n2', 'n4']]);
      expect(cycles?.total).toBe(1);
      expect(loadGraph).toHaveBeenCalledTimes(1);

      // 第三次调用仍然复用同一空间：结果稳定，装载次数不涨。
      const again = await tools.graphPathEnumerate.execute(
        { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n4' },
        mockExec,
      ) as unknown as { paths: string[][] } | null;
      expect(again?.paths).toEqual([['n1', 'n2', 'n4']]);
      expect(loadGraph).toHaveBeenCalledTimes(1);
    } finally {
      tools.dispose();
    }
  });

  it('不同 repoId 互不干扰（池按 repo 隔离）', async () => {
    const fetchData = new CodeGraphAdapter().fetchData as ReturnType<typeof vi.fn>;
    const tools = await createGraphTools(mockCtx());
    const loadGraph = spyOnLoadGraph();
    try {
      fetchData.mockResolvedValueOnce({
        nodes: [
          { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
          { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
        source: 'codegraph',
        timestamp: 1,
      });
      await tools.graphPathEnumerate.execute(
        { repoId: 'repo-a', sourceSymbol: 'n1', targetSymbol: 'n2' },
        mockExec,
      );

      fetchData.mockResolvedValueOnce({
        nodes: [
          { id: 'm1', label: 'X', type: 'function', filePath: 'x.ts', lineNumber: 1, properties: {} },
          { id: 'm2', label: 'Y', type: 'function', filePath: 'y.ts', lineNumber: 2, properties: {} },
        ],
        edges: [{ id: 'f1', source: 'm1', target: 'm2', type: 'call', properties: {} }],
        source: 'codegraph',
        timestamp: 2,
      });
      const other = await tools.graphPathEnumerate.execute(
        { repoId: 'repo-b', sourceSymbol: 'm1', targetSymbol: 'm2' },
        mockExec,
      ) as unknown as { paths: string[][] } | null;

      expect(other?.paths).toEqual([['m1', 'm2']]);
      expect(loadGraph).toHaveBeenCalledTimes(2);
    } finally {
      tools.dispose();
    }
  });

  it('graph_data 把 merger.applyDelta 产出的真实 delta 转发给池（XJ-02 第 4 点）', async () => {
    const fetchData = new CodeGraphAdapter().fetchData as ReturnType<typeof vi.fn>;
    fetchData.mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
      source: 'codegraph',
      timestamp: 1,
    });

    const tools = await createGraphTools(mockCtx());
    try {
      // 1) 首次 graph_data：没有缓存基线 ⇒ 只可能是全量（池内若有旧状态会被丢弃）
      await tools.graphData.execute({ repoId: 'r1' }, mockExec);
      // 2) 让池里有一个已装载、与缓存同版的适配层
      await tools.graphPathEnumerate.execute(
        { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n2' },
        mockExec,
      );

      const poolApply = vi.spyOn(XuanjiAdapterPool.prototype, 'applyDelta');
      activeSpies.push(poolApply);
      // 3) 第二次 graph_data：有缓存 ⇒ merger.applyDelta + computeGraphDiff ⇒ 转发
      await tools.graphData.execute({ repoId: 'r1' }, mockExec);

      expect(poolApply).toHaveBeenCalledTimes(1);
      const [repoId, delta] = poolApply.mock.calls[0]!;
      expect(repoId).toBe('r1');
      // 上游没变 ⇒ delta 必须是「真实算出来的空差」，而不是伪造的全量
      expect(delta).toEqual({
        addedNodes: [],
        removedNodes: [],
        modifiedNodes: [],
        addedEdges: [],
        removedEdges: [],
        modifiedEdges: [],
      });
      // 适配层与缓存同版 ⇒ delta 被真正应用（不是被基线校验拒绝）
      expect(poolApply.mock.results[0]!.value).toMatchObject({ applied: true });
    } finally {
      tools.dispose();
    }
  });

  it('每次读法都执行 validateRule（生产路径上的必然校验调用，XJ-05 方案 A）', async () => {
    const fetchData = new CodeGraphAdapter().fetchData as ReturnType<typeof vi.fn>;
    fetchData.mockResolvedValue({
      nodes: [
        { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
        { id: 'n2', label: 'B', type: 'function', filePath: 'b.ts', lineNumber: 2, properties: {} },
        { id: 'n3', label: 'C', type: 'function', filePath: 'c.ts', lineNumber: 3, properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
        { id: 'e3', source: 'n3', target: 'n1', type: 'call', properties: {} },
      ],
      source: 'codegraph',
      timestamp: 1,
    });

    const tools = await createGraphTools(mockCtx());
    const validate = vi.spyOn(XuanjiAdapter.prototype, 'validateRule');
    activeSpies.push(validate);
    try {
      await tools.graphPathEnumerate.execute(
        { repoId: 'r1', sourceSymbol: 'n1', targetSymbol: 'n3' },
        mockExec,
      );
      expect(validate).toHaveBeenCalledTimes(1);

      await tools.graphCycles.execute({ repoId: 'r1' }, mockExec);
      expect(validate).toHaveBeenCalledTimes(2);

      // 校验的是本次读法真正拿去枚举的那条规则（不是一次无关的空跑）
      const [enumeratedRule] = validate.mock.calls[1]!;
      expect(enumeratedRule.name).toBe('cycles');
      expect(enumeratedRule.closed).toBe(true);
      expect(enumeratedRule.lMax).toBe(6);
    } finally {
      tools.dispose();
    }
  });
});
