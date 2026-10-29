/**
 * XuanjiAdapter 宿主集成测试。
 *
 * 三个层次，缺一不可：
 * 1) **映射正确性**：GraphData ⇄ GraphSpace 的字段/边类型/多重边不丢信息；
 * 2) **读法正确性**：路径枚举、环枚举、可达集合在已知图上得到可手算的答案；
 * 3) **增量等价（宿主级 C3）**：通过 applyDelta 维护的索引，与「用新图重新
 *    loadGraph + 全量枚举」得到的 live 路径集合逐哈希一致。这一条是「璇玑图
 *    改一字只重读经过该字的诗」在真实宿主数据结构上的唯一可信证据。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  XuanjiAdapter,
  DEFAULT_PATH_EDGE_TYPES,
} from '../../src/shared/analysis/XuanjiAdapter.ts';
import type { GraphData, GraphDelta, GraphEdge, GraphNode } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { PathRule } from '../../src/xuanji/core/path-rule.ts';
import { RuleCompositionError } from '../../src/xuanji/core/path-rule.ts';
import { GraphSpace } from '../../src/xuanji/core/graph-space.ts';
import { PathIndex } from '../../src/xuanji/index/path-index.ts';
import { enumerate } from '../../src/xuanji/query/query-engine.ts';

let seq = 0;
function node(id: string, type: GraphNode['type'] = 'function', properties: Record<string, unknown> = {}): GraphNode {
  return { id: NodeId(id), label: id, type, filePath: `src/${id}.ts`, properties };
}

function edge(source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(`e${++seq}`), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

function graphData(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return {
    nodes,
    edges,
    metadata: {
      repoId: 'repo' as GraphData['metadata']['repoId'],
      timestamp: 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

function emptyDelta(): GraphDelta {
  return {
    addedNodes: [],
    removedNodes: [],
    modifiedNodes: [],
    addedEdges: [],
    removedEdges: [],
    modifiedEdges: [],
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

function indexHashes(adapter: XuanjiAdapter, ruleName: string): string[] {
  const index = adapter.getIndex(ruleName);
  if (!index) return [];
  return [...index.hashIndex.values()].filter((e) => !e.stale).map((e) => e.hash).sort();
}

function materializeAll(adapter: XuanjiAdapter, rule: PathRule): void {
  // XJ-05：registerRule 现在返回 { index, validation }，errors 非空时 index 为 null（规则未注册）。
  const index = adapter.getIndex(rule.name) ?? adapter.registerRule(rule).index;
  if (!index) throw new Error(`rule "${rule.name}" was rejected by validateRule`);
  enumerate(adapter.graph, rule, [...adapter.graph.nodeIds()], index);
}

describe('XuanjiAdapter 映射层', () => {
  it('loadGraph 映射节点属性与边类型', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b', 'import')]));
    expect(adapter.stats()).toMatchObject({ nodes: 2, edges: 1 });
    const attrs = adapter.graph.getNodeAttrs('a');
    expect(attrs?.role).toBe('function');
    expect(attrs?.filePath).toBe('src/a.ts');
  });

  it('同端不同型的两条边都进入图空间（多重边不被覆盖）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b', 'call'), edge('a', 'b', 'import')]));
    expect(adapter.stats().edges).toBe(2);
    expect(adapter.graph.hasEdge('a', 'b', 'call')).toBe(true);
    expect(adapter.graph.hasEdge('a', 'b', 'import')).toBe(true);
  });

  it('isExported 从两种宿主属性拼写映射', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a', 'function', { isExported: true }), node('b', 'function', { is_exported: 1 })], []));
    expect(adapter.graph.getNodeAttrs('a')?.isExported).toBe(true);
    expect(adapter.graph.getNodeAttrs('b')?.isExported).toBe(true);
  });

  it('未知节点不抛错，只返回空结果', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a')], []));
    expect(adapter.findPathsBetween('a', 'ghost').paths).toEqual([]);
    expect(adapter.reachableFrom(['ghost']).size).toBe(0);
  });
});

describe('XuanjiAdapter.findPathsBetween', () => {
  it('菱形图枚举出两条不同路径', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    ));
    const result = adapter.findPathsBetween('a', 'd');
    expect(result.total).toBe(2);
    expect(result.paths.map((p) => p.join('>')).sort()).toEqual(['a>b>d', 'a>c>d']);
    expect(result.truncated).toBe(false);
  });

  it('minHops/maxHops 限定长度区间', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')],
    ));
    expect(adapter.findPathsBetween('a', 'd', { minHops: 1, maxHops: 1 }).paths).toEqual([['a', 'd']]);
    expect(adapter.findPathsBetween('a', 'd', { minHops: 2, maxHops: 2 }).paths).toEqual([]);
    expect(adapter.findPathsBetween('a', 'd', { minHops: 3, maxHops: 3 }).paths).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('edgeTypes 过滤只走指定边类型', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b', 'import'), edge('b', 'c', 'call')],
    ));
    expect(adapter.findPathsBetween('a', 'c').total).toBe(1);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['call'] }).total).toBe(0);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['import'] }).total).toBe(0);
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['import', 'call'] }).total).toBe(1);
  });

  it('limit 截断并置 truncated', () => {
    const adapter = new XuanjiAdapter();
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id));
    const edges = ['b', 'c', 'd', 'e'].flatMap((mid) => [edge('a', mid), edge(mid, 'z')]);
    adapter.loadGraph(graphData([...nodes, node('z')], edges));
    const result = adapter.findPathsBetween('a', 'z', { limit: 2 });
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
    expect(adapter.findPathsBetween('a', 'z', { limit: 10 }).truncated).toBe(false);
  });

  it('简单路径不重复节点（有环图不会无限展开）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('c', 'd'), edge('d', 'b')],
    ));
    const result = adapter.findPathsBetween('a', 'd', { maxHops: 6 });
    expect(result.paths).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('默认边类型不含 contains（结构包含不是调用路径）', () => {
    expect(DEFAULT_PATH_EDGE_TYPES).not.toContain('contains');
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('m', 'module'), node('f')], [edge('m', 'f', 'contains')]));
    expect(adapter.findPathsBetween('m', 'f').total).toBe(0);
    expect(adapter.findPathsBetween('m', 'f', { edgeTypes: ['contains'] }).total).toBe(1);
  });
});

describe('XuanjiAdapter.cycles（闭合路径 + Booth 规范化）', () => {
  it('三角形只出现一次（三个起点同一等价类）', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    ));
    const result = adapter.cycles();
    expect(result.total).toBe(1);
    const cycleNodes = result.paths[0]!;
    expect(cycleNodes[0]).toBe(cycleNodes[cycleNodes.length - 1]);
    expect(new Set(cycleNodes).size).toBe(3);
  });

  it('两个独立环各出现一次', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'a'), edge('c', 'd'), edge('d', 'c')],
    ));
    expect(adapter.cycles().total).toBe(2);
  });

  it('自环是长度 1 的环', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a')], [edge('a', 'a')]));
    const result = adapter.cycles();
    expect(result.total).toBe(1);
    expect(result.paths[0]).toEqual(['a', 'a']);
  });

  it('maxLength 截断长环', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'a')],
    ));
    expect(adapter.cycles({ maxLength: 3 }).total).toBe(0);
    expect(adapter.cycles({ maxLength: 4 }).total).toBe(1);
  });

  it('与 detectCyclesDFS 的环集合兼容：DFS 找到的每个环都能被适配层找到', async () => {
    const { detectCyclesDFS } = await import('../../src/shared/analysis/CycleDFS.ts');
    const adapter = new XuanjiAdapter();
    const edges = [
      edge('a', 'b'), edge('b', 'c'), edge('c', 'a'),
      edge('c', 'd'), edge('d', 'a'),
      edge('e', 'f'), edge('f', 'e'),
    ];
    adapter.loadGraph(graphData(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)), edges));

    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source as string) ?? [];
      list.push(e.target as string);
      adjacency.set(e.source as string, list);
    }
    const dfsCycles = detectCyclesDFS(adjacency);
    expect(dfsCycles.length).toBeGreaterThan(0);
    const adapterCycles = adapter.cycles({ maxLength: 6 }).paths;
    const keyOf = (nodes: string[]): string => {
      const open = nodes[nodes.length - 1] === nodes[0] ? nodes.slice(0, -1) : nodes;
      const rotations = open.map((_, i) => [...open.slice(i), ...open.slice(0, i)].join('>'));
      return rotations.sort()[0]!;
    };
    const adapterKeys = new Set(adapterCycles.map(keyOf));
    for (const cycle of dfsCycles) {
      expect(adapterKeys.has(keyOf(cycle))).toBe(true);
    }
  });
});

describe('XuanjiAdapter.reachableFrom', () => {
  it('沿边类型 BFS', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('d', 'a')],
    ));
    expect([...adapter.reachableFrom(['a'])].sort()).toEqual(['a', 'b', 'c']);
    expect([...adapter.reachableFrom(['a'], ['call'])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('多个起点合并结果且去重', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'c'), edge('b', 'c')],
    ));
    expect([...adapter.reachableFrom(['a', 'b', 'a'])].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('XuanjiAdapter.applyDelta 增量等价（宿主级 C3）', () => {
  it('注册规则后增量加边 = 新图全量枚举', () => {
    const base = graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);

    const newEdge = edge('c', 'a');
    const delta = emptyDelta();
    delta.addedEdges.push(newEdge);
    const result = adapter.applyDelta(delta);
    expect(result.addedPaths).toBeGreaterThan(0);

    const fresh = new XuanjiAdapter();
    fresh.loadGraph(graphData(base.nodes, [...base.edges, newEdge]));
    fresh.registerRule(CYCLES_RULE);
    materializeAll(fresh, CYCLES_RULE);

    expect(indexHashes(adapter, 'cycles')).toEqual(indexHashes(fresh, 'cycles'));
  });

  it('删除边只置 stale、不重建索引，且查询结果排除失效路径（stale ≤ 30%）', () => {
    // 5 个互不相交的三角形 ⇒ 5 条物化环；删掉其中一个三角形的一条边 ⇒ 1/5 = 20% stale，
    // 低于 XJ-04 的 0.3 阈值，因此这里测的仍是「只置 stale、不清索引」。
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 5; i++) {
      const [a, b, c] = [`a${i}`, `b${i}`, `c${i}`];
      nodes.push(node(a), node(b), node(c));
      edges.push(edge(a, b), edge(b, c), edge(c, a));
    }
    const base = graphData(nodes, edges);
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);
    expect(indexHashes(adapter, 'cycles').length).toBe(5);

    const removed = edges.find((e) => e.source === 'a0' && e.target === 'b0')!;
    const delta = emptyDelta();
    delta.removedEdges.push(removed);
    const result = adapter.applyDelta(delta);
    expect(result.stalePaths).toBe(1);
    expect(result.degradedRules).toEqual([]);
    expect(adapter.getIndex('cycles')!.liveCount()).toBe(4);

    const fresh = new XuanjiAdapter();
    fresh.loadGraph(graphData(base.nodes, base.edges.filter((e) => e !== removed)));
    fresh.registerRule(CYCLES_RULE);
    materializeAll(fresh, CYCLES_RULE);
    expect(indexHashes(adapter, 'cycles')).toEqual(indexHashes(fresh, 'cycles'));
  });

  it('stale 超 30% ⇒ 该规则索引被清空并进入 degradedRules（XJ-04）', () => {
    const base = graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);
    expect(adapter.getIndex('cycles')!.liveCount()).toBe(1);

    const removed = base.edges.find((e) => e.source === 'a' && e.target === 'b')!;
    const delta = emptyDelta();
    delta.removedEdges.push(removed);
    const result = adapter.applyDelta(delta);

    expect(result.stalePaths).toBe(1); // 1/1 = 100% > 0.3
    expect(result.degradedRules).toContain('cycles');
    // 降级 = 索引清空，等待全量重枚举；绝不留下「半成品索引」冒充完整结果。
    const index = adapter.getIndex('cycles')!;
    expect(index.liveCount()).toBe(0);
    expect(index.counters).toEqual({ total: 0, stale: 0 });

    // 图空间本身仍然是正确的（全量装载同一版图后重新枚举即可恢复）。
    const fresh = new XuanjiAdapter();
    fresh.loadGraph(graphData(base.nodes, base.edges.filter((e) => e !== removed)));
    fresh.registerRule(CYCLES_RULE);
    materializeAll(fresh, CYCLES_RULE);
    expect(indexHashes(fresh, 'cycles')).toEqual([]);
  });

  it('降级后本次 delta 内不再向该索引增量写入（不留半成品）', () => {
    const base = graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(base);
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);

    const delta = emptyDelta();
    // 先删一条（触发 100% stale 降级），再加一条新边（若继续增量写入会得到「只含新边路径」的残缺索引）。
    delta.removedEdges.push(base.edges.find((e) => e.source === 'a' && e.target === 'b')!);
    delta.addedEdges.push(edge('c', 'b'));
    const result = adapter.applyDelta(delta);

    expect(result.degradedRules).toEqual(['cycles']);
    const index = adapter.getIndex('cycles')!;
    expect(index.liveCount()).toBe(0);
    expect(result.addedPaths).toBe(0);
  });
});

describe('XuanjiAdapter.applyDelta 的 I4 体检（XJ-04 第 3 步 / D-10）', () => {
  /** 三个不相交的三角形 ⇒ 3 条物化环；删掉任一三角形的一条边 ⇒ 1/3 = 33% > 0.3。 */
  function threeTriangles(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 3; i++) {
      const [a, b, c] = [`a${i}`, `b${i}`, `c${i}`];
      nodes.push(node(a), node(b), node(c));
      edges.push(edge(a, b), edge(b, c), edge(c, a));
    }
    return graphData(nodes, edges);
  }

  it('体检通过时 byRule 有该规则的 I4=ok 结论，degradedRules 为空', () => {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(threeTriangles());
    adapter.registerRule(CYCLES_RULE);
    materializeAll(adapter, CYCLES_RULE);

    const delta = emptyDelta();
    delta.addedNodes.push(node('d0'));
    delta.addedEdges.push(edge('a0', 'd0'));
    const result = adapter.applyDelta(delta);

    expect(result.degradedRules).toEqual([]);
    const i4 = result.invariants.byRule.get('cycles');
    expect(i4?.id).toBe('I4');
    expect(i4?.ok).toBe(true);
    expect(result.invariants.violated).toEqual([]);
    // 分母是**全量**计数（含 stale），detail 里能直接读到分数
    expect(i4?.detail).toContain('stale/total');
  });

  it('没有注册任何规则时体检结论是空表，而不是「全 ok」', () => {
    // 「空集冒充全绿」是本仓库的复发形态：空 byRule 必须能被调用方与「全部通过」区分开。
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b')]));
    const result = adapter.applyDelta(emptyDelta());
    expect(result.invariants.byRule.size).toBe(0);
    expect(result.invariants.violated).toEqual([]);
    expect(result.degradedRules).toEqual([]);
  });

  it('删节点会把经过它的路径置 stale（接线前 counters.stale 纹丝不动，这是真缺陷）', () => {
    // 这条用例覆盖接线时发现的真缺陷：旧实现只做 space.removeNode(id)，
    // 内部删掉的邻边**不经过** stale 通道，于是 counters.stale 纹丝不动、I4 报假健康。
    // 必须同时看两个子场景，只看一个会漏掉半边：
    //   (a) 失效比例低于阈值 ⇒ 只标记、不降级（证明「真的标记了」而非「碰巧被清空」）；
    //   (b) 失效比例超阈值 ⇒ 降级（证明标记会汇入既有降级通道）。
    const triRule: PathRule = CYCLES_RULE;

    // (a) 10 个互不相交的三角形；删掉某一三角形的中间节点 ⇒ 1/10 = 10% < 30%
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 10; i++) {
      const [a, b, c] = [`a${i}`, `b${i}`, `c${i}`];
      nodes.push(node(a), node(b), node(c));
      edges.push(edge(a, b), edge(b, c), edge(c, a));
    }
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(nodes, edges));
    const index = adapter.registerRule(triRule).index!;
    enumerate(adapter.graph, triRule, [...adapter.graph.nodeIds()], index);
    expect(index.counters.total).toBe(10);

    const deltaA = emptyDelta();
    deltaA.removedNodes.push(node('b0'));
    const resultA = adapter.applyDelta(deltaA);

    // 接线前这里是 0（条目仍指向已删节点，计数却干净）；现在至少 1 条被如实标记。
    expect(resultA.stalePaths).toBeGreaterThan(0);
    expect(index.counters.stale).toBe(resultA.stalePaths);
    // 10% 未超阈值 ⇒ 不降级：证明「标记」与「清空」是两件被正确区分的事
    expect(resultA.degradedRules).toEqual([]);
    expect(adapter.graph.hasNode('b0')).toBe(false);

    // (b) 单三角形；删中间节点 ⇒ 该三角形相关路径全部失效 ⇒ 超阈值降级
    const adapterB = new XuanjiAdapter();
    adapterB.loadGraph(
      graphData([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]),
    );
    const indexB = adapterB.registerRule(triRule).index!;
    enumerate(adapterB.graph, triRule, ['a', 'b', 'c'], indexB);
    expect(indexB.counters.total).toBe(1);

    const deltaB = emptyDelta();
    deltaB.removedNodes.push(node('b'));
    const resultB = adapterB.applyDelta(deltaB);

    expect(resultB.stalePaths).toBeGreaterThan(0);
    expect(resultB.degradedRules).toContain('cycles');
    expect(indexB.counters).toEqual({ total: 0, stale: 0 });
    expect(adapterB.graph.hasNode('b')).toBe(false);
  });

  it('I4 是终态兜底：若其它路径把索引弄脏而逐边通道没拦，末尾体检会降级它', () => {
    // 诚实边界（实测）：在「纯删边 / 删节点」的 delta 上，逐边的 needsRebuild 与末尾 I4
    // 阈值同为 0.3，前者先触发，I4 拿到的是已清空的索引——此时两者判定等价。
    // I4 真正独立的价值是**终态兜底**：任何「把条目标成 stale 但没有检查阈值」的通道
    // （本次修的删节点、将来新增的失效来源）都会在这里被抓住。
    // 这里直接调用库的 markStale 来模拟这种通道，若没有末尾体检，索引会带着
    // 100% 失效继续对外服务。
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(
      graphData([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]),
    );
    const index = adapter.registerRule(CYCLES_RULE).index!;
    materializeAll(adapter, CYCLES_RULE);
    expect(index.counters.total).toBe(1);

    // 模拟「别的通道"标记了失效却不检查比例"」：直接把唯一一条路径置 stale
    index.markStale('a->b');
    expect(index.counters.stale).toBe(1);
    expect(index.liveCount()).toBe(0);

    // 一个**不涉及任何边增删**的 delta：逐边通道完全不会跑，只有末尾 I4 能发现
    const delta = emptyDelta();
    delta.addedNodes.push(node('d'));
    const result = adapter.applyDelta(delta);

    expect(result.invariants.violated).toEqual(['cycles']);
    expect(result.degradedRules).toContain('cycles');
    expect(index.counters).toEqual({ total: 0, stale: 0 });
  });

  it('thetaStale 由构造函数传入检查器：严格阈值下同一比例结论相反', () => {
    // 钉住「参数真的抵达了 InvariantChecker」，而不是被丢掉后用了缺省 0.3。
    // 造 1/3 ≈ 33% stale：缺省 0.3 会判不达标，thetaStale=0.9 会判达标。
    function staleRatioOf(thetaStale: number | undefined): boolean {
      const adapter = thetaStale === undefined ? new XuanjiAdapter() : new XuanjiAdapter({ thetaStale });
      adapter.loadGraph(
        graphData([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]),
      );
      const index = adapter.registerRule(CYCLES_RULE).index!;
      materializeAll(adapter, CYCLES_RULE);
      index.markStale('a->b'); // 1/1 = 100%
      const result = adapter.applyDelta(emptyDelta());
      return result.invariants.byRule.get('cycles')?.ok ?? true;
    }

    expect(staleRatioOf(undefined)).toBe(false); // 100% > 0.3
    expect(staleRatioOf(0.9)).toBe(false); // 100% > 0.9 仍不达标
    expect(staleRatioOf(1)).toBe(true); // 100% <= 1 ⇒ 达标（阈值确实生效）
  });

  it('lastInvariantReport 暴露最近一次结论（未跑过时为 null）', () => {
    const adapter = new XuanjiAdapter();
    expect(adapter.lastInvariantReport).toBeNull();
    adapter.loadGraph(graphData([node('a'), node('b')], [edge('a', 'b')]));
    adapter.registerRule(CYCLES_RULE);
    const result = adapter.applyDelta(emptyDelta());
    expect(adapter.lastInvariantReport).toBe(result.invariants);
  });
});

describe('XuanjiAdapter.registerRule 校验闸门（XJ-05）', () => {
  /** 合法但可被逐项改坏的规则模板。 */
  function templateRule(overrides: Partial<PathRule> = {}): PathRule {
    return {
      name: 'template',
      version: 1,
      start: () => true,
      edgeTypes: new Set(['call']),
      lMin: 1,
      lMax: 4,
      simple: true,
      normalize: 'none',
      ...overrides,
    };
  }

  function callGraphAdapter(): XuanjiAdapter {
    const adapter = new XuanjiAdapter();
    adapter.loadGraph(graphData(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c')],
    ));
    return adapter;
  }

  it('无界 lMax 且未声明 simple ⇒ errors 非空、规则未注册', () => {
    const adapter = callGraphAdapter();
    // 刻意不写 simple 字段（exactOptionalPropertyTypes 下不能显式给 undefined）。
    const rule: PathRule = {
      name: 'unbounded',
      version: 1,
      start: () => true,
      edgeTypes: new Set(['call']),
      lMin: 1,
      lMax: Number.POSITIVE_INFINITY,
      normalize: 'none',
    };

    const registration = adapter.registerRule(rule);

    expect(registration.validation.errors).toContain(
      'unbounded lMax requires simple: true (otherwise the path set is infinite)',
    );
    expect(registration.index).toBeNull();
    expect(adapter.getIndex('unbounded')).toBeUndefined();
    expect(adapter.getRule('unbounded')).toBeUndefined();
  });

  it('edgeTypes 含图中不存在的类型 ⇒ errors 非空、规则未注册', () => {
    const adapter = callGraphAdapter();
    const registration = adapter.registerRule(
      templateRule({ name: 'unknown-type', edgeTypes: new Set(['telepathy']) }),
    );

    expect(registration.validation.errors.some((e) => e.includes('is not present in the graph space'))).toBe(true);
    expect(registration.index).toBeNull();
    expect(adapter.getIndex('unknown-type')).toBeUndefined();
  });

  it('合法规则 errors 为空，且同名重复注册返回同一 PathIndex（幂等）', () => {
    const adapter = callGraphAdapter();
    const first = adapter.registerRule(templateRule());
    const second = adapter.registerRule(templateRule());

    expect(first.validation.errors).toEqual([]);
    // warnings 不阻断注册，但必须原样透传（lMax 4 > |V| 3 对 simple 规则只是提醒）。
    expect(first.validation.warnings).toEqual(['lMax (4) exceeds |V| (3): simple paths cannot be that long']);
    expect(first.index).toBeInstanceOf(PathIndex);
    expect(second.index).toBe(first.index);
    expect(second.index).toBe(adapter.getIndex('template'));
  });

  it('显式传入 graph 时用该图空间的边类型校验（而不是已装载的图）', () => {
    const adapter = callGraphAdapter(); // 只有 call 边
    const other = new GraphSpace();
    other.addNode('x', { label: 'x' });
    other.addNode('y', { label: 'y' });
    other.addEdge({ id: 'x->y->data', source: 'x', target: 'y', type: 'data' });

    expect(adapter.registerRule(templateRule({ name: 'data-only', edgeTypes: new Set(['data']) })).index).toBeNull();
    expect(
      adapter.registerRule(templateRule({ name: 'data-only', edgeTypes: new Set(['data']) }), other).validation.errors,
    ).toEqual([]);
  });

  it('内联读法只走图中真实存在的边类型（请求不存在的类型不报错、只是走不通）', () => {
    const adapter = callGraphAdapter(); // a -call-> b -call-> c
    // 'extend' 不在这个图里：裁剪后为空 ⇒ 空结果，而不是让整次读法被校验判死。
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['extend'] }).total).toBe(0);
    // 混着请求时只保留存在的那一类，仍然能读到路径。
    expect(adapter.findPathsBetween('a', 'c', { edgeTypes: ['extend', 'call'] }).total).toBe(1);
  });

  it('内联读法的校验关口是必然执行的（每次枚举都调 validateRule）', () => {
    const adapter = callGraphAdapter(); // a -call-> b -call-> c
    const validate = vi.spyOn(XuanjiAdapter.prototype, 'validateRule');
    try {
      expect(validate).toHaveBeenCalledTimes(0);
      adapter.findPathsBetween('a', 'c');
      expect(validate).toHaveBeenCalledTimes(1);
      adapter.cycles();
      expect(validate).toHaveBeenCalledTimes(2);
      // 传进来的规则就是这一次读法构造的那条（证明校验发生在枚举之前、且对象是本次规则）
      const [checkedRule] = validate.mock.calls[0]!;
      expect(checkedRule.name).toBe('between:a->c');
    } finally {
      validate.mockRestore();
    }
  });

  it('非法的内联读法参数被闸门拒绝，而不是静默返回空结果', () => {
    const adapter = callGraphAdapter();

    // 非有限的 minHops ⇒ lMin/lMax 不是有限数，validateRule 必须报错
    expect(() => adapter.findPathsBetween('a', 'c', { minHops: Number.NaN })).toThrow(RuleCompositionError);
    expect(() => adapter.findPathsBetween('a', 'c', { minHops: Number.NaN })).toThrow(
      /rule\.lMin must be a finite number/,
    );
    expect(() => adapter.cycles({ maxLength: Number.NaN })).toThrow(/rule\.lMax must be/);

    // 反向：合法参数不得被闸门误杀（否则「必然执行」会退化成「必然抛错」）
    expect(() => adapter.cycles()).not.toThrow();
    expect(() => adapter.findPathsBetween('a', 'c')).not.toThrow();
    expect(adapter.findPathsBetween('a', 'c').total).toBe(1);
  });
});
